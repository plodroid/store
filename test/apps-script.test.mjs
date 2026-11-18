// Runs apps-script/Code.gs against stand-ins for the Google services, with real RSA signing,
// so the sign-in logic and the token format are checked without a Google account.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import crypto from "node:crypto";

const SRC = fs.readFileSync(new URL("../apps-script/Code.gs", import.meta.url), "utf8");
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" });
const signed = buf => [...buf].map(b => (b > 127 ? b - 256 : b));    // Apps Script returns signed bytes
const bytes = x => (typeof x === "string" ? Buffer.from(x, "utf8") : Buffer.from(x.map(b => b & 255)));

function world(props = {}, lookup = null, hook = null) {
  const clock = { now: 1_800_000_000_000 };
  const mails = [];
  const store = new Map();
  const cache = {
    get: k => { const e = store.get(k); return e && e.exp > clock.now ? e.v : null; },
    put: (k, v, ttl) => store.set(k, { v, exp: clock.now + ttl * 1000 }),
    remove: k => store.delete(k),
  };
  const P = { FB_CLIENT_EMAIL: "svc@proj.iam.gserviceaccount.com", FB_PRIVATE_KEY: PEM.replace(/\n/g, "\\n"), ...props };
  class FakeDate extends Date {
    constructor(...a) { a.length ? super(...a) : super(clock.now); }
    static now() { return clock.now; }
  }
  const ctx = vm.createContext({
    console, Math, JSON, parseInt, Number, String, Date: FakeDate,
    Utilities: {
      Charset: { UTF_8: "utf8" }, DigestAlgorithm: { SHA_256: "sha256" },
      getUuid: () => crypto.randomUUID(),
      computeDigest: (_, s) => signed(crypto.createHash("sha256").update(s).digest()),
      computeRsaSha256Signature: (input, key) => signed(crypto.sign("RSA-SHA256", Buffer.from(input), key)),
      base64Encode: x => bytes(x).toString("base64"),
      base64EncodeWebSafe: x => bytes(x).toString("base64").replace(/\+/g, "-").replace(/\//g, "_"),   // padded, like the real one
      formatDate: (d, tz, fmt) => { const s = d.toISOString().slice(0, 10); return fmt && fmt.includes("-") ? s : s.replace(/-/g, ""); },
    },
    CacheService: { getScriptCache: () => cache },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (k in P ? P[k] : null), setProperty: (k, v) => { P[k] = v; },
      getKeys: () => Object.keys(P), deleteProperty: k => { delete P[k]; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    MailApp: { sendEmail: m => mails.push(m), getRemainingDailyQuota: () => 100 },
    // stand-in for Google's token lookup: `lookup` maps an idToken to the account it belongs to
    UrlFetchApp: { fetch: (url, opts) => {
      if (hook && !url.startsWith("https://identitytoolkit")) { const r = hook(url, opts); return { getResponseCode: () => r.code ?? 200, getContentText: () => JSON.stringify(r.body) }; }
      const u = lookup && lookup[JSON.parse(opts.payload).idToken];
      return { getResponseCode: () => (u ? 200 : 400), getContentText: () => JSON.stringify({ users: u ? [u] : [] }) };
    } },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: s => ({ s, setMimeType() { return this; } }) },
    Logger: { log() {} },
  });
  vm.runInContext(SRC, ctx);
  const call = body => JSON.parse(vm.runInContext("doPost", ctx)({ postData: { contents: typeof body === "string" ? body : JSON.stringify(body) } }).s);
  const codeOf = i => mails[i].body.match(/code is (\d{4})\./)[1];
  return { clock, mails, call, ctx, props: P, codeOf };
}
const wrong = c => (c === "0000" ? "1111" : "0000");

const OWNER = { email: "housikiki@gmail.com", emailVerified: true, providerUserInfo: [{ providerId: "google.com" }] };
const NOTIFY = (over = {}) => ({ a: "notify", idToken: "tok-owner", product: "Ajwa Dates <250g>", link: "https://plodroid.github.io/store/#/p/p1", emails: ["a@b.co", "A@B.co", "c@d.co", "bad"], ...over });

test("notify: the verified owner can email waiting customers (deduped, escaped, counted)", () => {
  const w = world({}, { "tok-owner": OWNER });
  const r = w.call(NOTIFY());
  assert.deepEqual(r, { ok: true, sent: 2, sentTo: ["a@b.co", "c@d.co"] });
  assert.equal(w.mails.length, 2);
  assert.match(w.mails[0].subject, /back in stock at Bee Hive$/);
  assert.ok(w.mails[0].htmlBody.includes("Ajwa Dates &lt;250g&gt;") && !w.mails[0].htmlBody.includes("<250g>"));
  assert.ok(w.mails[0].body.includes("https://plodroid.github.io/store/#/p/p1"));
});

test("notify: nobody else can use it", () => {
  const cases = {
    "tok-code": { email: "housikiki@gmail.com", emailVerified: true, providerUserInfo: [{ providerId: "custom" }] },
    "tok-other": { email: "x@y.co", emailVerified: true, providerUserInfo: [{ providerId: "google.com" }] },
    "tok-unverified": { email: "housikiki@gmail.com", emailVerified: false, providerUserInfo: [{ providerId: "google.com" }] },
  };
  const w = world({}, { ...cases, "tok-owner": OWNER });
  for (const t of Object.keys(cases)) assert.equal(w.call(NOTIFY({ idToken: t })).error, "not_owner", t);
  assert.equal(w.call(NOTIFY({ idToken: "forged" })).error, "not_owner");
  assert.equal(w.mails.length, 0);
});

test("notify: refuses other links, empty lists, and respects the daily cap", () => {
  const w = world({}, { "tok-owner": OWNER });
  assert.equal(w.call(NOTIFY({ link: "https://evil.example/x" })).error, "bad_request");
  assert.equal(w.call(NOTIFY({ emails: [] })).error, "bad_request");
  assert.equal(w.call(NOTIFY({ product: "" })).error, "bad_request");
  vm.runInContext("SETTINGS.SENDS_PER_DAY = 1", w.ctx);
  const r = w.call(NOTIFY());
  assert.equal(r.sent, 1); assert.deepEqual(r.sentTo, ["a@b.co"]);
  assert.equal(w.call(NOTIFY()).error, "busy");
});

/* ── Stripe card payments ── */
const enc = v => v === null ? { nullValue: null } : typeof v === "string" ? { stringValue: v } : typeof v === "boolean" ? { booleanValue: v }
  : typeof v === "number" ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
  : Array.isArray(v) ? { arrayValue: { values: v.map(enc) } } : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
const fsDoc = o => ({ fields: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, enc(v)])) });
const RATES = { rates: [
  { courier_service: { id: "svc-b", name: "Tracked 48", umbrella_name: "Royal Mail" }, total_charge: 3.95, min_delivery_time: 2, max_delivery_time: 3 },
  { courier_service: { id: "svc-a", name: "Standard", umbrella_name: "Evri" }, total_charge: 2.49, min_delivery_time: 3, max_delivery_time: 5 },
] };
const EASY_FAIL = { on: false };
function payWorld({ order, key = "sk_test_x", stripeSession, docs = {}, lookup = {}, easy = true } = {}) {
  const seen = { stripe: [], patch: [], easy: [] };
  const hook = (url, opts) => {
    if (url.startsWith("https://oauth2.googleapis.com/token")) return { body: { access_token: "AT" } };
    if (url.endsWith(":runQuery")) return { body: (docs.__events || []).map(e => ({ document: fsDoc(e) })).concat([{ readTime: "x" }]) };
    if (url.includes("firestore.googleapis.com")) {
      const path = decodeURIComponent(url.split("/documents/")[1].split("?")[0]);
      if (opts.method === "patch") { seen.patch.push({ url, path, body: JSON.parse(opts.payload) }); return { body: {} }; }
      const d = path.startsWith("orders/") ? order : docs[path];
      return d ? { body: fsDoc(d) } : { code: 404, body: {} };
    }
    if (url.startsWith("https://public-api.easyship.com")) {
      seen.easy.push({ url, method: opts.method, auth: opts.headers.Authorization, body: opts.payload ? JSON.parse(opts.payload) : null });
      return url.includes("/rates") ? { body: opts.easyRates || RATES } : (EASY_FAIL.on ? { code: 402, body: { error: { message: "plan" } } } : { body: { shipment: { easyship_shipment_id: "ESSG1", tracking_page_url: "https://track.example/x", label_state: "not_created" } } });
    }
    if (url.startsWith("https://api.stripe.com")) {
      seen.stripe.push({ url, method: opts.method, auth: opts.headers.Authorization, form: opts.payload });
      return { body: opts.method === "post" ? { url: "https://checkout.stripe.com/c/pay/cs_test_abc" } : stripeSession };
    }
    return { code: 500, body: {} };
  };
  const w = world({ ...(key ? { STRIPE_SECRET_KEY: key } : {}), ...(easy ? { EASYSHIP_TOKEN: "es_test" } : {}) }, { good: { localId: "u1", email: "a@b.co" }, other: { localId: "u2" }, ...lookup }, hook);
  return { ...w, seen };
}
const ORDER = { uid: "u1", ref: "BH-ABC123", status: "confirmed", paymentStatus: "mock", total: 7.5 };

test("pay: the Stripe amount comes from the order, in pence, never from the browser", () => {
  const w = payWorld({ order: ORDER });
  const r = w.call({ a: "pay", idToken: "good", orderId: "o_order12345", amount: 1 });
  assert.equal(r.ok, true); assert.match(r.url, /^https:\/\/checkout\.stripe\.com\//);
  const f = w.seen.stripe[0].form;
  assert.equal(f["line_items[0][price_data][unit_amount]"], "750");
  assert.equal(f["line_items[0][price_data][currency]"], "gbp");
  assert.equal(f.client_reference_id, "o_order12345");
  assert.equal(f["adaptive_pricing[enabled]"], "false");
  assert.match(f.success_url, /\?paid=o_order12345&sid=\{CHECKOUT_SESSION_ID\}$/);
  assert.equal(w.seen.stripe[0].auth, "Basic " + Buffer.from("sk_test_x:").toString("base64"));
});
test("pay: refuses someone else's order, unconfirmed orders, paid orders, bad logins and missing key", () => {
  assert.equal(payWorld({ order: ORDER }).call({ a: "pay", idToken: "other", orderId: "o_order12345" }).error, "not_found");
  assert.equal(payWorld({ order: ORDER }).call({ a: "pay", idToken: "nope", orderId: "o_order12345" }).error, "auth");
  assert.equal(payWorld({ order: { ...ORDER, status: "completed" } }).call({ a: "pay", idToken: "good", orderId: "o_order12345" }).error, "not_ready");
  assert.equal(payWorld({ order: { ...ORDER, paymentStatus: "paid" } }).call({ a: "pay", idToken: "good", orderId: "o_order12345" }).error, "already_paid");
  assert.equal(payWorld({ order: ORDER, key: "" }).call({ a: "pay", idToken: "good", orderId: "o_order12345" }).error, "not_set_up");
  assert.equal(payWorld({ order: ORDER }).call({ a: "pay", idToken: "good", orderId: "../x" }).error, "auth");
});
test("paid: marks the order paid only when Stripe says paid for the same order and amount", () => {
  const ok = { payment_status: "paid", client_reference_id: "o_order12345", currency: "gbp", amount_total: 750 };
  const w = payWorld({ order: ORDER, stripeSession: ok });
  assert.deepEqual(w.call({ a: "paid", idToken: "good", orderId: "o_order12345", sid: "cs_test_abc" }), { ok: true });
  const patch = w.seen.patch[0];
  assert.match(patch.url, /orders\/o_order12345\?currentDocument\.exists=true&updateMask\.fieldPaths=paymentStatus/);
  assert.equal(patch.body.fields.paymentStatus.stringValue, "paid");
  for (const bad of [{ payment_status: "unpaid" }, { client_reference_id: "other0000000" }, { amount_total: 100 }, { currency: "usd" }]) {
    const x = payWorld({ order: ORDER, stripeSession: { ...ok, ...bad } });
    assert.equal(x.call({ a: "paid", idToken: "good", orderId: "o_order12345", sid: "cs_test_abc" }).error, "not_paid");
    assert.equal(x.seen.patch.length, 0);
  }
  assert.equal(payWorld({ order: ORDER, stripeSession: ok }).call({ a: "paid", idToken: "other", orderId: "o_order12345", sid: "cs_test_abc" }).error, "not_found");
  assert.equal(payWorld({ order: ORDER, stripeSession: ok }).call({ a: "paid", idToken: "good", orderId: "o_order12345", sid: "whatever" }).error, "auth");
});
test("doGet reports whether card payments are set up", () => {
  const get = k => JSON.parse(vm.runInContext("doGet", payWorld({ key: k }).ctx)().s).pay;
  assert.equal(get("sk_test_x"), true); assert.equal(get(""), false);
});

/* ── pay at checkout: the server prices the order (items + the Easyship service picked), then confirms it when Stripe says it is paid ── */
const ADDR = { country: "GB", line1: "10 Road", line2: "", city: "London", state: "", postcode: "SW1A 1AA" };
const NEW = { uid: "u1", ref: "BH-NEW123", status: "new", paymentStatus: "awaiting", fulfilment: "shipping", shipping: { serviceId: "svc-a" },
  items: [{ productId: "p1", qty: 2, name: "Dates" }], customer: { name: "Gina", phone: "+447911123456", email: "gina@example.com" }, address: ADDR, estTotal: 1 };
const SHOP = { "products/p1": { name: "Dates", price: 3, salePrice: 2.5, stock: 5, visible: true, archived: false, weightG: 250 },
  "settings/site": { shipping: true, collection: true, shipTo: "GB,FR" },
  "settings/owner": { shipFrom: { name: "Bee", phone: "+447911123457", line1: "1 Hive Lane", city: "Leeds", postcode: "LS1 1AA", country: "GB" } } };
const PAY = { a: "pay", idToken: "good", orderId: "o_new1234567" };

test("rates: the customer gets cheapest-first Easyship options; the parcel is built from product weights", () => {
  const w = payWorld({ order: NEW, docs: SHOP });
  const r = w.call({ a: "rates", idToken: "good", items: NEW.items, address: ADDR, customer: NEW.customer });
  assert.equal(r.ok, true); assert.equal(r.subtotal, 5);
  assert.deepEqual(r.rates.map(x => [x.id, x.courier, x.price]), [["svc-a", "Evri", 2.49], ["svc-b", "Royal Mail", 3.95]]);
  const e = w.seen.easy[0];
  assert.equal(e.auth, "Bearer es_test"); assert.match(e.url, /\/2024-09\/rates/);
  assert.equal(e.body.destination_address.postal_code, "SW1A 1AA"); assert.equal(e.body.origin_address.city, "Leeds");
  assert.equal(e.body.parcels[0].total_actual_weight, 0.6);                    // 2 x 250g + 100g packaging
  assert.equal(e.body.parcels[0].items[0].actual_weight, 0.25);
});
test("rates: refuses logged-out callers, unshipped countries, half addresses, bad phones; reports missing setup", () => {
  const ask = (over, o = {}) => payWorld({ order: NEW, docs: SHOP, ...o }).call({ a: "rates", idToken: "good", items: NEW.items, address: ADDR, customer: NEW.customer, ...over });
  assert.equal(ask({ idToken: "nope" }).error, "auth");
  assert.equal(ask({ address: { ...ADDR, country: "US" } }).error, "bad_address");
  assert.equal(ask({ address: { ...ADDR, line1: "" } }).error, "bad_address");
  assert.equal(ask({ customer: { ...NEW.customer, phone: "07911123456" } }).error, "bad_address");   // must be international +44...
  assert.equal(ask({}, { easy: false }).error, "not_set_up");
  assert.equal(ask({}, { docs: { ...SHOP, "settings/owner": {} } }).error, "no_origin");
  assert.equal(ask({}, { docs: { ...SHOP, "settings/site": { shipping: false } } }).error, "no_shipping");
  assert.equal(ask({ items: [{ productId: "p1", qty: 9 }] }).error, "stock");
});
test("rates: free delivery over the shop's threshold (cheapest option, home country only); calls are throttled per person", () => {
  const w = payWorld({ order: NEW, docs: { ...SHOP, "settings/site": { ...SHOP["settings/site"], freeShippingOver: 5 } } });
  const r = w.call({ a: "rates", idToken: "good", items: NEW.items, address: ADDR, customer: NEW.customer });
  assert.deepEqual(r.rates.map(x => x.price), [0, 3.95]);
  const f = payWorld({ order: NEW, docs: { ...SHOP, "settings/site": { ...SHOP["settings/site"], freeShippingOver: 5 } } }).call({ a: "rates", idToken: "good", items: NEW.items, address: { ...ADDR, country: "FR", postcode: "75001" }, customer: NEW.customer });
  assert.equal(f.rates[0].price, 2.49);
  vm.runInContext("SETTINGS.RATES_PER_HOUR = 2", w.ctx);
  w.call({ a: "rates", idToken: "good", items: NEW.items, address: ADDR, customer: NEW.customer });
  assert.equal(w.call({ a: "rates", idToken: "good", items: NEW.items, address: ADDR, customer: NEW.customer }).error, "limit");
});
test("checkout pay: the shop prices the order itself (sale price + the re-quoted courier), ignoring the browser's estimate", () => {
  const w = payWorld({ order: NEW, docs: SHOP });
  const r = w.call(PAY);
  assert.equal(r.ok, true);
  assert.equal(w.seen.stripe[0].form["line_items[0][price_data][unit_amount]"], "749");      // 2 x £2.50 + £2.49 Evri
  const f = w.seen.patch[0].body.fields;
  assert.equal(w.seen.patch[0].path, "orders/o_new1234567");
  assert.equal(f.total.doubleValue, 7.49); assert.equal(f.shippingFee.doubleValue, 2.49);
  assert.equal(w.seen.patch[1].body.fields.shipping.mapValue.fields.serviceId.stringValue, "svc-a");
  assert.equal(f.status, undefined, "still new until it is paid");
  assert.equal(payWorld({ order: { ...NEW, shipping: { serviceId: "gone" } }, docs: SHOP }).call(PAY).error, "ship_rate");   // service no longer offered
});
test("checkout pay: a live event takes its % off the chosen products (never above the sale price); expired/other events do nothing", () => {
  const ev = (o = {}) => ({ name: "Eid", active: true, percentOff: 20, productIds: ["p1"], look: "eid", ...o });
  const pay = events => { const w = payWorld({ order: { ...NEW, fulfilment: "collection", address: null }, docs: { ...SHOP, "products/p1": { ...SHOP["products/p1"], salePrice: null }, __events: events } }); w.call(PAY); return w.seen.stripe[0].form["line_items[0][price_data][unit_amount]"]; };
  assert.equal(pay([]), "600");
  assert.equal(pay([ev()]), "480");
  assert.equal(pay([ev(), ev({ percentOff: 50 })]), "300");
  assert.equal(pay([ev({ productIds: ["other"] })]), "600");
  assert.equal(pay([ev({ endsAt: "2020-01-01" })]), "600");
  assert.equal(pay([ev({ startsAt: "2999-01-01" })]), "600");
  assert.equal(pay([ev({ startsAt: "2000-01-01", endsAt: "2999-01-01" })]), "480");
  assert.equal(pay([ev({ percentOff: 0 })]), "600");
  const w = payWorld({ order: { ...NEW, fulfilment: "collection", address: null }, docs: { ...SHOP, __events: [ev({ percentOff: 10 })] } });
  w.call(PAY); assert.equal(w.seen.stripe[0].form["line_items[0][price_data][unit_amount]"], "500");
});
test("checkout pay: pick-up has no shipping fee; refuses empty stock, hidden products, switched-off shipping and tiny orders", () => {
  const w = payWorld({ order: { ...NEW, fulfilment: "collection", address: null, shipping: null }, docs: SHOP });
  w.call(PAY); assert.equal(w.seen.stripe[0].form["line_items[0][price_data][unit_amount]"], "500"); assert.equal(w.seen.easy.length, 0);
  const err = (docs, order = NEW) => payWorld({ order, docs }).call(PAY);
  assert.deepEqual([err({ ...SHOP, "products/p1": { ...SHOP["products/p1"], stock: 1 } }).error, err({ ...SHOP, "products/p1": { ...SHOP["products/p1"], stock: 1 } }).item], ["stock", "Dates"]);
  assert.equal(err({ ...SHOP, "products/p1": { ...SHOP["products/p1"], visible: false } }).error, "stock");
  assert.equal(err({ "settings/site": SHOP["settings/site"] }).error, "stock");
  assert.equal(err({ ...SHOP, "settings/site": { shipping: false } }).error, "no_shipping");
  assert.equal(err({ ...SHOP, "products/p1": { ...SHOP["products/p1"], price: 0.05, salePrice: null } }, { ...NEW, fulfilment: "collection" }).error, "too_small");
  assert.equal(err(SHOP, { ...NEW, items: [{ productId: "p1", qty: 0 }] }).error, "stock");
  assert.equal(err(SHOP, { ...NEW, address: { ...ADDR, postcode: "" } }).error, "bad_address");
});
test("checkout paid: confirms the order, takes the stock, creates the Easyship shipment and emails owner + customer", () => {
  const priced = { ...NEW, total: 7.49, lines: [{ productId: "p1", name: "Dates", qty: 2, unitPrice: 2.5, lineTotal: 5 }], shippingFee: 2.49, subtotal: 5, shipping: { serviceId: "svc-a", courier: "Evri", service: "Standard" } };
  const ok = { payment_status: "paid", client_reference_id: "o_new1234567", currency: "gbp", amount_total: 749 };
  const w = payWorld({ order: priced, docs: SHOP, stripeSession: ok });
  assert.deepEqual(w.call({ a: "paid", idToken: "good", orderId: "o_new1234567", sid: "cs_test_abc" }), { ok: true });
  const byPath = Object.fromEntries(w.seen.patch.filter(x => !x.body.fields.shipment).map(x => [x.path, x.body.fields]));
  assert.equal(byPath["orders/o_new1234567"].status.stringValue, "confirmed");
  assert.equal(byPath["products/p1"].stock.integerValue, "3");
  const ship = w.seen.easy.find(x => x.url.endsWith("/shipments"));
  assert.equal(ship.body.courier_settings.courier_service_id, "svc-a"); assert.equal(ship.body.destination_address.line_1, "10 Road");
  assert.equal(ship.body.shipping_settings.buy_label, false);
  assert.equal(w.seen.patch.find(x => x.body.fields.shipment).body.fields.shipment.mapValue.fields.easyshipId.stringValue, "ESSG1");
  assert.deepEqual(w.mails.map(m => m.to), ["housikiki@gmail.com", "gina@example.com"]);
  assert.match(w.mails[0].subject, /New paid order BH-NEW123 \(SHIPPING, £7\.49\)/); assert.match(w.mails[0].body, /SW1A 1AA/); assert.match(w.mails[0].body, /Evri Standard/);
  // Easyship failing never loses the paid order: the owner just gets an email asking to create it by hand
  EASY_FAIL.on = true;
  const bad = payWorld({ order: priced, docs: SHOP, stripeSession: ok });
  assert.deepEqual(bad.call({ a: "paid", idToken: "good", orderId: "o_new1234567", sid: "cs_test_abc" }), { ok: true });
  EASY_FAIL.on = false;
  assert.ok(bad.mails.some(m => /Create the Easyship shipment/.test(m.subject)));
  assert.equal(bad.seen.patch.find(x => x.path === "orders/o_new1234567").body.fields.status.stringValue, "confirmed");
  assert.equal(bad.seen.patch.some(x => x.body.fields.shipment), false);
  const old = payWorld({ order: { ...priced, status: "confirmed" }, docs: SHOP, stripeSession: ok });
  old.call({ a: "paid", idToken: "good", orderId: "o_new1234567", sid: "cs_test_abc" });
  assert.equal(old.seen.patch.length, 1); assert.equal(old.mails.length, 0);
});
test("stage: only the owner can email 'shipped / ready', and only for the order's current step", () => {
  const S = { a: "stage", idToken: "tok-owner", orderId: "o_new1234567" };
  const world_ = status => payWorld({ order: { ...NEW, status, shipment: { trackingUrl: "https://track.example/x" } }, lookup: { "tok-owner": OWNER } });
  for (const [status, subject] of [["shipped", /has shipped/], ["ready", /ready to collect/]]) {
    const w = world_(status);
    assert.deepEqual(w.call(S), { ok: true, sent: 1 });
    assert.equal(w.mails[0].to, "gina@example.com"); assert.match(w.mails[0].subject, subject);
    if (status === "shipped") assert.match(w.mails[0].body, /track\.example/);
  }
  for (const status of ["new", "confirmed", "completed", "cancelled", "ontheway"]) { const w = world_(status); assert.equal(w.call(S).error, "bad_request"); assert.equal(w.mails.length, 0); }
  const w = world_("shipped");
  assert.equal(w.call({ ...S, idToken: "good" }).error, "not_owner");
  assert.equal(w.mails.length, 0);
});
test("doGet reports whether shipping is set up", () => {
  const get = e => JSON.parse(vm.runInContext("doGet", payWorld({ easy: e }).ctx)().s).ship;
  assert.equal(get(true), true); assert.equal(get(false), false);
});
