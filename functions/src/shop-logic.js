/**
 * Pure business rules shared by the Cloud Functions.
 * No Firebase imports here, so every rule can be unit-tested with plain Node.
 * Money is handled in whole pence internally to avoid floating-point drift;
 * Firestore stores prices in pounds (e.g. 2.4 = £2.40) for the website's sake.
 */

const ORDER_STATUSES = ["new", "confirmed", "preparing", "ready", "completed", "cancelled"];
const PAYMENT_STATUSES = ["mock", "pending", "paid", "failed", "refunded"];
const FULFILMENT = ["collection", "delivery"];

const LIMITS = {
  maxLines: 50,
  maxQty: 99,
  name: [2, 80],
  phone: [7, 20],
  email: 120,
  addressLine: 120,
  city: 60,
  postcode: 12,
  note: 500,
  feedback: [10, 1000],
  feedbackName: 60,
};

class InputError extends Error {
  constructor(problems) {
    super(problems.join(" "));
    this.problems = problems;
  }
}

const toPence = pounds => Math.round(Number(pounds) * 100);
const fromPence = pence => Math.round(pence) / 100;
const formatGBP = pence => `£${(pence / 100).toFixed(2)}`;

const str = v => (typeof v === "string" ? v.trim() : "");
const isInt = v => Number.isInteger(v);

/* ── order input ─────────────────────────────────────────── */

function validateOrderInput(raw) {
  const problems = [];
  const input = raw && typeof raw === "object" ? raw : {};

  // A hidden "website" field that people never see; bots fill it in.
  if (str(input.hp)) problems.push("Request rejected.");

  const requestId = str(input.requestId);
  if (!/^[A-Za-z0-9-]{8,64}$/.test(requestId)) problems.push("Missing request id.");

  // items: merge duplicates, keep order stable
  const merged = new Map();
  const items = Array.isArray(input.items) ? input.items : [];
  if (!items.length) problems.push("Your basket is empty.");
  if (items.length > LIMITS.maxLines) problems.push(`Too many different items (max ${LIMITS.maxLines}).`);
  for (const it of items.slice(0, LIMITS.maxLines)) {
    const id = str(it && it.productId);
    const qty = it && it.qty;
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || !isInt(qty) || qty < 1 || qty > LIMITS.maxQty) {
      problems.push("One of the basket items is invalid.");
      break;
    }
    merged.set(id, Math.min(LIMITS.maxQty, (merged.get(id) || 0) + qty));
  }

  const c = input.customer && typeof input.customer === "object" ? input.customer : {};
  const name = str(c.name);
  const phone = str(c.phone);
  const email = str(c.email).toLowerCase();
  if (name.length < LIMITS.name[0] || name.length > LIMITS.name[1]) problems.push("Please enter your name.");
  if (!phone && !email) problems.push("Please add a phone number or email so the shop can reach you.");
  if (phone && !(/^\+?[0-9 ()-]+$/.test(phone) && phone.replace(/\D/g, "").length >= LIMITS.phone[0] && phone.length <= LIMITS.phone[1]))
    problems.push("That phone number doesn't look right.");
  if (email && !(email.length <= LIMITS.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))
    problems.push("That email address doesn't look right.");

  const fulfilment = str(input.fulfilment);
  if (!FULFILMENT.includes(fulfilment)) problems.push("Please choose collection or delivery.");

  let address = null;
  if (fulfilment === "delivery") {
    const a = input.address && typeof input.address === "object" ? input.address : {};
    address = {
      line1: str(a.line1).slice(0, LIMITS.addressLine),
      line2: str(a.line2).slice(0, LIMITS.addressLine),
      city: str(a.city).slice(0, LIMITS.city),
      postcode: str(a.postcode).toUpperCase().slice(0, LIMITS.postcode),
    };
    if (!address.line1 || !address.city || !address.postcode) problems.push("Please fill in the delivery address.");
  }

  const note = str(input.note);
  if (note.length > LIMITS.note) problems.push(`Notes can be up to ${LIMITS.note} characters.`);

  const method = str(input.payment && input.payment.method) || "mock";

  if (problems.length) throw new InputError([...new Set(problems)]);
  return {
    requestId,
    items: [...merged].map(([productId, qty]) => ({ productId, qty })),
    customer: { name, phone, email },
    fulfilment,
    address,
    note,
    paymentMethod: method,
  };
}

/* ── fulfilment settings ─────────────────────────────────── */

function fulfilmentOptions(site = {}) {
  const fee = Number(site.deliveryFee);
  return {
    collection: site.collection !== false,          // default: collection on
    delivery: site.delivery === true,               // default: delivery off
    deliveryFeePence: Number.isFinite(fee) && fee > 0 ? toPence(fee) : 0,
  };
}

/* ── pricing + stock (server-authoritative) ──────────────── */

/**
 * @param {Array<{productId:string, qty:number}>} items
 * @param {Map<string, object|null>} products  current product docs (null = missing)
 * @param {Map<string, object|null>} categories current category docs referenced by products
 * @param {string} fulfilment
 * @param {object} site settings/site doc
 */
function buildOrder(items, products, categories, fulfilment, site) {
  const conflicts = [];
  const lines = [];
  const opts = fulfilmentOptions(site);

  if (fulfilment === "collection" && !opts.collection) throw new InputError(["Collection isn't available right now."]);
  if (fulfilment === "delivery" && !opts.delivery) throw new InputError(["Delivery isn't available right now."]);

  for (const { productId, qty } of items) {
    const p = products.get(productId);
    const cat = p && p.categoryId ? categories.get(p.categoryId) : undefined;
    const sellable = !!p && p.visible === true && p.archived !== true &&
      (!p.categoryId || (cat && cat.visible === true));
    const stock = sellable && isInt(p.stock) ? Math.max(0, p.stock) : 0;
    const pricePence = p ? toPence(p.price) : NaN;

    if (!sellable || !Number.isFinite(pricePence) || pricePence < 0) {
      conflicts.push({ productId, name: p ? String(p.name || "") : "", requested: qty, available: 0 });
      continue;
    }
    if (qty > stock) {
      conflicts.push({ productId, name: String(p.name || ""), requested: qty, available: stock });
      continue;
    }
    lines.push({
      productId,
      name: String(p.name || ""),
      unit: p.unit ? String(p.unit) : null,
      unitPricePence: pricePence,
      qty,
      lineTotalPence: pricePence * qty,
      stockBefore: stock,
    });
  }

  const subtotalPence = lines.reduce((t, l) => t + l.lineTotalPence, 0);
  const deliveryFeePence = fulfilment === "delivery" ? opts.deliveryFeePence : 0;
  return { lines, conflicts, subtotalPence, deliveryFeePence, totalPence: subtotalPence + deliveryFeePence };
}

/* ── identifiers ─────────────────────────────────────────── */

const REF_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no 0/O/1/I

function makeRef(bytes) {
  let s = "";
  for (let i = 0; i < 6; i++) s += REF_ALPHABET[bytes[i] % REF_ALPHABET.length];
  return `PS-${s}`;
}

const orderIdFor = requestId => `o_${requestId}`;

/* ── feedback input ──────────────────────────────────────── */

function validateFeedbackInput(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  const problems = [];
  if (str(input.hp)) problems.push("Request rejected.");

  const message = str(input.message);
  if (message.length < LIMITS.feedback[0]) problems.push(`Please write at least ${LIMITS.feedback[0]} characters.`);
  if (message.length > LIMITS.feedback[1]) problems.push(`Please keep it under ${LIMITS.feedback[1]} characters.`);

  const name = str(input.name);
  if (name.length > LIMITS.feedbackName) problems.push("That name is too long.");

  const orderRef = str(input.orderRef).toUpperCase();
  if (orderRef && !/^PS-[A-Z0-9]{6}$/.test(orderRef)) problems.push("That order reference doesn't look right (it starts with PS-).");

  let rating = null;
  if (input.rating !== undefined && input.rating !== null && input.rating !== "") {
    if (!isInt(input.rating) || input.rating < 1 || input.rating > 5) problems.push("Rating must be 1 to 5 stars.");
    else rating = input.rating;
  }

  // crude link-spam guard: real feedback rarely needs several links
  if ((message.match(/https?:\/\//gi) || []).length > 2) problems.push("Please remove links from your message.");

  if (problems.length) throw new InputError([...new Set(problems)]);
  return { name, orderRef: orderRef || null, rating, message };
}

/* ── stock alerts ────────────────────────────────────────── */

/**
 * Returns "out" | "low" | null. Only fires when stock CROSSES a line,
 * so repeated edits at the same level never spam the owner.
 */
function stockAlert(before, after, defaultThreshold = 5) {
  if (!before || !after) return null;
  if (after.archived === true) return null;
  const b = Number(before.stock), a = Number(after.stock);
  if (!Number.isFinite(b) || !Number.isFinite(a) || a >= b) return null;
  const t = isInt(after.lowStockThreshold) && after.lowStockThreshold >= 0 ? after.lowStockThreshold : defaultThreshold;
  if (a <= 0 && b > 0) return "out";
  if (t > 0 && a <= t && b > t) return "low";
  return null;
}

/* ── simple fixed-window rate limit ──────────────────────── */

function rateWindow(state, nowMs, limit, windowMs) {
  const start = state && state.windowStart ? state.windowStart : 0;
  const count = state && state.count ? state.count : 0;
  if (nowMs - start >= windowMs) return { allowed: true, next: { windowStart: nowMs, count: 1 } };
  if (count >= limit) return { allowed: false, next: { windowStart: start, count } };
  return { allowed: true, next: { windowStart: start, count: count + 1 } };
}

/* ── notification copy (no customer personal details) ────── */

function orderNotice(order) {
  const items = (order.items || []).reduce((n, l) => n + (l.qty || 0), 0);
  const how = order.fulfilment === "delivery" ? "Delivery" : "Collection";
  return {
    title: `New order ${order.ref}`,
    body: `${items} item${items === 1 ? "" : "s"} · ${formatGBP(order.totalPence)} · ${how}${order.isTest ? " · test order" : ""}`,
  };
}

function feedbackNotice(fb) {
  return {
    title: "New customer feedback",
    body: fb.rating ? `${fb.rating}★ rating · tap to read` : "Tap to read the message",
  };
}

function stockNotice(product, level) {
  const name = String(product.name || "A product");
  return level === "out"
    ? { title: "Out of stock", body: `${name} has sold out and is no longer orderable.` }
    : { title: "Running low", body: `${name} has ${product.stock} left.` };
}

module.exports = {
  ORDER_STATUSES, PAYMENT_STATUSES, FULFILMENT, LIMITS, InputError,
  toPence, fromPence, formatGBP,
  validateOrderInput, fulfilmentOptions, buildOrder, makeRef, orderIdFor,
  validateFeedbackInput, stockAlert, rateWindow,
  orderNotice, feedbackNotice, stockNotice,
};
