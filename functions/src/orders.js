const crypto = require("node:crypto");
const { HttpsError } = require("firebase-functions/v2/https");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const logic = require("./shop-logic");
const { getProvider } = require("./payments");
const { clientKey, checkRate } = require("./rate-limit");

/** What the customer's browser gets back. Never includes other customers' data. */
function publicResult(orderId, o, duplicate) {
  return {
    orderId,
    ref: o.ref,
    status: o.status,
    paymentStatus: o.paymentStatus,
    isTest: o.isTest === true,
    fulfilment: o.fulfilment,
    items: (o.items || []).map(l => ({ name: l.name, qty: l.qty, unitPrice: l.unitPrice, lineTotal: l.lineTotal })),
    subtotal: o.subtotal,
    deliveryFee: o.deliveryFee,
    total: o.total,
    duplicate: !!duplicate,
  };
}

/**
 * Callable: placeOrder
 * The browser sends product ids + quantities only. Prices, availability and stock
 * are read here, inside one transaction, so two customers can't buy the last unit twice.
 */
async function placeOrder(request) {
  let input;
  try {
    input = logic.validateOrderInput(request.data);
  } catch (e) {
    if (e instanceof logic.InputError) throw new HttpsError("invalid-argument", e.message, { problems: e.problems });
    throw e;
  }

  const db = getFirestore();
  const orderId = logic.orderIdFor(input.requestId);
  const orderRef = db.collection("orders").doc(orderId);

  // Retry after a slow/failed network request → return the order that already exists.
  const existing = await orderRef.get();
  if (existing.exists) return publicResult(existing.id, existing.data(), true);

  await checkRate(db, clientKey(request, "order"), 8, 10 * 60 * 1000);

  let provider;
  try {
    provider = getProvider(input.paymentMethod);
  } catch {
    throw new HttpsError("failed-precondition", "That payment method isn't available.");
  }

  const result = await db.runTransaction(async tx => {
    const again = await tx.get(orderRef);
    if (again.exists) return { id: again.id, data: again.data(), duplicate: true };

    const siteSnap = await tx.get(db.doc("settings/site"));
    const productRefs = input.items.map(i => db.collection("products").doc(i.productId));
    const productSnaps = await tx.getAll(...productRefs);
    const products = new Map(productSnaps.map(s => [s.id, s.exists ? s.data() : null]));

    const catIds = [...new Set([...products.values()].filter(p => p && p.categoryId).map(p => String(p.categoryId)))];
    const catSnaps = catIds.length ? await tx.getAll(...catIds.map(id => db.collection("categories").doc(id))) : [];
    const categories = new Map(catSnaps.map(s => [s.id, s.exists ? s.data() : null]));

    let built;
    try {
      built = logic.buildOrder(input.items, products, categories, input.fulfilment, siteSnap.exists ? siteSnap.data() : {});
    } catch (e) {
      if (e instanceof logic.InputError) throw new HttpsError("failed-precondition", e.message);
      throw e;
    }
    if (built.conflicts.length) {
      throw new HttpsError("failed-precondition", "Some items are no longer available in that quantity.", { conflicts: built.conflicts });
    }

    // Mock provider is pure. A live provider (Stripe) must create its PaymentIntent
    // outside this retried transaction — see payments/stripe.js.
    const payment = await provider.authorize({ orderId, totalPence: built.totalPence, currency: "GBP" });
    const now = FieldValue.serverTimestamp();
    const order = {
      ref: logic.makeRef(crypto.randomBytes(6)),
      status: "new",
      paymentStatus: payment.paymentStatus,
      paymentProvider: provider.name,
      providerRef: payment.providerRef || null,
      isTest: payment.isTest === true,
      currency: "GBP",
      items: built.lines.map(l => ({
        productId: l.productId,
        name: l.name,
        unit: l.unit,
        qty: l.qty,
        unitPrice: logic.fromPence(l.unitPricePence),
        lineTotal: logic.fromPence(l.lineTotalPence),
      })),
      productIds: built.lines.map(l => l.productId),
      itemCount: built.lines.reduce((n, l) => n + l.qty, 0),
      subtotal: logic.fromPence(built.subtotalPence),
      deliveryFee: logic.fromPence(built.deliveryFeePence),
      total: logic.fromPence(built.totalPence),
      totalPence: built.totalPence,
      fulfilment: input.fulfilment,
      customer: input.customer,
      address: input.address,
      note: input.note || "",
      restocked: false,
      createdAt: now,
      updatedAt: now,
    };

    for (const l of built.lines) {
      tx.update(db.collection("products").doc(l.productId), { stock: l.stockBefore - l.qty, updatedAt: now });
    }
    tx.create(orderRef, order);
    return { id: orderId, data: order, duplicate: false };
  });

  return publicResult(result.id, result.data, result.duplicate);
}

module.exports = { placeOrder, publicResult };
