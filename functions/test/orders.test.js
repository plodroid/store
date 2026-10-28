const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { FakeDB, FieldValue } = require("./fake-firestore");

// Swap firebase-admin/firestore for the fake before loading the real function code.
let db;
const adminPath = require.resolve("firebase-admin/firestore");
require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: { getFirestore: () => db, FieldValue, Timestamp: { fromMillis: ms => ({ ms }) } },
};
const { placeOrder } = require(path.join(__dirname, "../src/orders"));

let n = 0;
const req = (data, ip = "1.2.3.4") => ({ data, rawRequest: { headers: { "x-forwarded-for": ip }, ip } });
const order = (over = {}) => ({
  requestId: `req-test-${String(++n).padStart(4, "0")}`,
  items: [{ productId: "dates", qty: 1 }],
  customer: { name: "Sam", phone: "07700900123" },
  fulfilment: "collection",
  ...over,
});

function seed() {
  db = new FakeDB();
  db.set("products/dates", { name: "Medjool Dates", price: 6.5, stock: 1, visible: true, archived: false, categoryId: "c1" });
  db.set("products/water", { name: "Water", price: 0.6, stock: 50, visible: true, archived: false });
  db.set("categories/c1", { name: "Dates", visible: true });
  db.set("settings/site", { collection: true, delivery: true, deliveryFee: 2 });
}

test("places a mock order: server price, stock decremented, flagged as test", async () => {
  seed();
  const r = await placeOrder(req(order({ items: [{ productId: "dates", qty: 1 }, { productId: "water", qty: 2 }] })));
  assert.match(r.ref, /^PS-/);
  assert.equal(r.total, 7.7);
  assert.equal(r.isTest, true);
  assert.equal(r.paymentStatus, "mock");
  assert.equal(db.docs.get("products/dates").stock, 0);
  assert.equal(db.docs.get("products/water").stock, 48);
  const saved = db.docs.get(`orders/${r.orderId}`);
  assert.equal(saved.status, "new");
  assert.equal(saved.totalPence, 770);
  assert.deepEqual(saved.productIds, ["dates", "water"]);
  assert.equal(saved.items[0].unitPrice, 6.5, "price snapshot kept on the order");
});

test("browser-supplied prices are ignored", async () => {
  seed();
  const r = await placeOrder(req(order({ items: [{ productId: "water", qty: 1, price: 0.01 }], total: 0.01 })));
  assert.equal(r.total, 0.6);
});

test("two customers racing for the last unit: exactly one wins", async () => {
  seed();
  const results = await Promise.allSettled([
    placeOrder(req(order(), "9.9.9.1")),
    placeOrder(req(order(), "9.9.9.2")),
  ]);
  const ok = results.filter(r => r.status === "fulfilled");
  const bad = results.filter(r => r.status === "rejected");
  assert.equal(ok.length, 1);
  assert.equal(bad.length, 1);
  assert.equal(bad[0].reason.code, "failed-precondition");
  assert.deepEqual(bad[0].reason.details.conflicts.map(c => c.available), [0]);
  assert.equal(db.docs.get("products/dates").stock, 0, "never negative");
});

test("retrying the same request returns the same order and never charges stock twice", async () => {
  seed();
  const o = order({ items: [{ productId: "water", qty: 5 }] });
  const a = await placeOrder(req(o));
  const b = await placeOrder(req(o));
  assert.equal(a.orderId, b.orderId);
  assert.equal(a.ref, b.ref);
  assert.equal(b.duplicate, true);
  assert.equal(db.docs.get("products/water").stock, 45);
  assert.equal([...db.docs.keys()].filter(k => k.startsWith("orders/")).length, 1);
});

test("hidden product or hidden category can't be bought", async () => {
  seed();
  db.set("categories/c1", { name: "Dates", visible: false });
  await assert.rejects(placeOrder(req(order())), e => e.code === "failed-precondition");
  assert.equal(db.docs.get("products/dates").stock, 1);
});

test("delivery adds the owner's fee; disabled delivery is refused", async () => {
  seed();
  const r = await placeOrder(req(order({ items: [{ productId: "water", qty: 1 }], fulfilment: "delivery", address: { line1: "1 High St", city: "Leeds", postcode: "LS1 1AA" } })));
  assert.equal(r.deliveryFee, 2);
  assert.equal(r.total, 2.6);
  db.set("settings/site", { delivery: false });
  await assert.rejects(placeOrder(req(order({ items: [{ productId: "water", qty: 1 }], fulfilment: "delivery", address: { line1: "1", city: "L", postcode: "L1" } }))), e => e.code === "failed-precondition");
});

test("invalid input is rejected before touching the database", async () => {
  seed();
  await assert.rejects(placeOrder(req({ items: [] })), e => e.code === "invalid-argument");
  assert.equal(db.txCount, 0);
});

test("rate limit: a 9th order in 10 minutes from one visitor is refused", async () => {
  seed();
  for (let i = 0; i < 8; i++) await placeOrder(req(order({ items: [{ productId: "water", qty: 1 }] }), "5.5.5.5"));
  await assert.rejects(placeOrder(req(order({ items: [{ productId: "water", qty: 1 }] }), "5.5.5.5")), e => e.code === "resource-exhausted");
  await placeOrder(req(order({ items: [{ productId: "water", qty: 1 }] }), "6.6.6.6"));
  assert.ok(![...db.docs.keys()].some(k => k.includes("5.5.5.5")), "raw IPs are never stored");
});
