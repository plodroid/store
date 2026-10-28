const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { orderNotice, feedbackNotice, stockNotice, stockAlert } = require("./shop-logic");
const { notifyOwner } = require("./notify");

const onOrderCreated = onDocumentCreated("orders/{orderId}", async event => {
  const o = event.data && event.data.data();
  if (!o) return;
  const id = event.params.orderId;
  await notifyOwner({ key: `order_${id}`, type: "order", ...orderNotice(o), refId: id });
});

const onFeedbackCreated = onDocumentCreated("feedback/{feedbackId}", async event => {
  const fb = event.data && event.data.data();
  if (!fb) return;
  const id = event.params.feedbackId;
  await notifyOwner({ key: `feedback_${id}`, type: "feedback", ...feedbackNotice(fb), refId: id });
});

/** Low / out-of-stock alerts, only when stock crosses a line. */
const onProductUpdated = onDocumentUpdated("products/{productId}", async event => {
  const before = event.data.before.data();
  const after = event.data.after.data();
  if (!before || !after || !(Number(after.stock) < Number(before.stock))) return;

  const owner = await getFirestore().doc("settings/owner").get();
  const def = owner.exists && Number.isInteger(owner.get("defaultLowStock")) ? owner.get("defaultLowStock") : 5;
  const level = stockAlert(before, after, def);
  if (!level) return;

  const id = event.params.productId;
  await notifyOwner({ key: `stock_${id}_${event.id}`, type: "stock", ...stockNotice(after, level), refId: id });
});

/** Cancelling an order puts its items back on the shelf — exactly once. */
const onOrderUpdated = onDocumentUpdated("orders/{orderId}", async event => {
  const before = event.data.before.data();
  const after = event.data.after.data();
  if (!after || after.status !== "cancelled" || before.status === "cancelled" || after.restocked === true) return;

  const db = getFirestore();
  const orderRef = event.data.after.ref;
  await db.runTransaction(async tx => {
    const snap = await tx.get(orderRef);
    const o = snap.data();
    if (!o || o.status !== "cancelled" || o.restocked === true) return;
    const items = o.items || [];
    const snaps = items.length ? await tx.getAll(...items.map(i => db.collection("products").doc(i.productId))) : [];
    snaps.forEach((s, i) => {
      if (s.exists) tx.update(s.ref, { stock: FieldValue.increment(items[i].qty), updatedAt: FieldValue.serverTimestamp() });
    });
    tx.update(orderRef, { restocked: true, restockedAt: FieldValue.serverTimestamp() });
  });
});

/** Nudge the owner about orders nobody has confirmed after 2 hours. */
const remindStaleOrders = onSchedule({ schedule: "every 30 minutes", timeZone: "Europe/London" }, async () => {
  const db = getFirestore();
  const cutoff = Timestamp.fromMillis(Date.now() - 2 * 60 * 60 * 1000);
  const snap = await db.collection("orders")
    .where("status", "==", "new").where("createdAt", "<=", cutoff)
    .orderBy("createdAt").limit(20).get();
  for (const d of snap.docs) {
    if (d.get("remindedAt")) continue;
    await notifyOwner({
      key: `reminder_${d.id}`,
      type: "reminder",
      title: `Order ${d.get("ref")} is waiting`,
      body: "It was placed over 2 hours ago and hasn't been confirmed yet.",
      refId: d.id,
    });
    await d.ref.update({ remindedAt: FieldValue.serverTimestamp() });
  }
});

module.exports = { onOrderCreated, onFeedbackCreated, onProductUpdated, onOrderUpdated, remindStaleOrders };
