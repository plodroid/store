const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../src/shop-logic");

const okInput = (over = {}) => ({
  requestId: "req-12345678",
  items: [{ productId: "p1", qty: 2 }],
  customer: { name: "Sam", phone: "07700 900123", email: "" },
  fulfilment: "collection",
  ...over,
});

test("money: pence round-trip avoids float drift", () => {
  assert.equal(L.toPence(0.1) + L.toPence(0.2), 30);
  assert.equal(L.toPence(2.4) * 3, 720);
  assert.equal(L.formatGBP(1240), "£12.40");
});

test("order input: valid input is cleaned, duplicate lines merged", () => {
  const v = L.validateOrderInput(okInput({ items: [{ productId: "p1", qty: 2 }, { productId: "p1", qty: 3 }], customer: { name: " Sam ", email: "SAM@X.CO" } }));
  assert.deepEqual(v.items, [{ productId: "p1", qty: 5 }]);
  assert.equal(v.customer.name, "Sam");
  assert.equal(v.customer.email, "sam@x.co");
});

test("order input: rejects empty basket, bad qty, missing contact, honeypot", () => {
  assert.throws(() => L.validateOrderInput(okInput({ items: [] })), L.InputError);
  assert.throws(() => L.validateOrderInput(okInput({ items: [{ productId: "p1", qty: 0 }] })), L.InputError);
  assert.throws(() => L.validateOrderInput(okInput({ items: [{ productId: "p1", qty: 1.5 }] })), L.InputError);
  assert.throws(() => L.validateOrderInput(okInput({ items: [{ productId: "../x", qty: 1 }] })), L.InputError);
  assert.throws(() => L.validateOrderInput(okInput({ customer: { name: "Sam" } })), /phone number or email/);
  assert.throws(() => L.validateOrderInput(okInput({ hp: "http://spam" })), L.InputError);
  assert.throws(() => L.validateOrderInput(okInput({ requestId: "x" })), L.InputError);
});

test("order input: delivery needs an address", () => {
  assert.throws(() => L.validateOrderInput(okInput({ fulfilment: "delivery" })), /delivery address/);
  const v = L.validateOrderInput(okInput({ fulfilment: "delivery", address: { line1: "1 High St", city: "Leeds", postcode: "ls1 1aa" } }));
  assert.equal(v.address.postcode, "LS1 1AA");
});

const products = () => new Map([
  ["p1", { name: "Dates", price: 6.5, stock: 3, visible: true, archived: false, categoryId: "c1" }],
  ["p2", { name: "Water", price: 0.1, stock: 100, visible: true, archived: false }],
  ["p3", { name: "Hidden", price: 1, stock: 9, visible: false, archived: false }],
  ["p4", { name: "Archived", price: 1, stock: 9, visible: true, archived: true }],
  ["p5", { name: "In hidden cat", price: 1, stock: 9, visible: true, archived: false, categoryId: "c2" }],
]);
const cats = new Map([["c1", { visible: true }], ["c2", { visible: false }]]);

test("buildOrder: server prices, totals in pence, delivery fee", () => {
  const r = L.buildOrder([{ productId: "p1", qty: 2 }, { productId: "p2", qty: 3 }], products(), cats, "delivery", { delivery: true, deliveryFee: 2.5 });
  assert.equal(r.conflicts.length, 0);
  assert.equal(r.subtotalPence, 1300 + 30);
  assert.equal(r.deliveryFeePence, 250);
  assert.equal(r.totalPence, 1580);
});

test("buildOrder: more than stock, hidden, archived, hidden category, missing → conflicts", () => {
  const r = L.buildOrder(
    ["p1", "p3", "p4", "p5", "nope"].map((id, i) => ({ productId: id, qty: i === 0 ? 4 : 1 })),
    products(), cats, "collection", {});
  assert.deepEqual(r.conflicts.map(c => [c.productId, c.available]), [["p1", 3], ["p3", 0], ["p4", 0], ["p5", 0], ["nope", 0]]);
  assert.equal(r.lines.length, 0);
});

test("buildOrder: fulfilment respects owner settings (collection on, delivery off by default)", () => {
  assert.doesNotThrow(() => L.buildOrder([{ productId: "p2", qty: 1 }], products(), cats, "collection", {}));
  assert.throws(() => L.buildOrder([{ productId: "p2", qty: 1 }], products(), cats, "delivery", {}), /Delivery isn't available/);
  assert.throws(() => L.buildOrder([{ productId: "p2", qty: 1 }], products(), cats, "collection", { collection: false }), /Collection isn't available/);
  assert.equal(L.buildOrder([{ productId: "p2", qty: 1 }], products(), cats, "collection", { deliveryFee: 9 }).deliveryFeePence, 0);
});

test("feedback input", () => {
  assert.deepEqual(L.validateFeedbackInput({ message: "Lovely dates, quick collection.", rating: 5, orderRef: "ps-abc234" }),
    { name: "", orderRef: "PS-ABC234", rating: 5, message: "Lovely dates, quick collection." });
  assert.throws(() => L.validateFeedbackInput({ message: "short" }), /at least/);
  assert.throws(() => L.validateFeedbackInput({ message: "x".repeat(1001) }), /under/);
  assert.throws(() => L.validateFeedbackInput({ message: "valid message here", rating: 6 }), /1 to 5/);
  assert.throws(() => L.validateFeedbackInput({ message: "valid message here", orderRef: "123" }), /PS-/);
  assert.throws(() => L.validateFeedbackInput({ message: "buy http://a http://b http://c now" }), /links/);
  assert.throws(() => L.validateFeedbackInput({ message: "valid message here", hp: "x" }), L.InputError);
});

test("stockAlert fires only when crossing a line", () => {
  const p = (stock, extra = {}) => ({ stock, ...extra });
  assert.equal(L.stockAlert(p(6), p(5), 5), "low");
  assert.equal(L.stockAlert(p(5), p(4), 5), null, "already low → no repeat");
  assert.equal(L.stockAlert(p(2), p(0), 5), "out");
  assert.equal(L.stockAlert(p(0), p(0), 5), null);
  assert.equal(L.stockAlert(p(3), p(8), 5), null, "restock never alerts");
  assert.equal(L.stockAlert(p(20), p(9), 5), null);
  assert.equal(L.stockAlert(p(20), p(9, { lowStockThreshold: 10 }), 5), "low", "per-product threshold wins");
  assert.equal(L.stockAlert(p(2), p(0, { archived: true }), 5), null);
});

test("rate window", () => {
  let s = null, now = 1000;
  for (let i = 0; i < 3; i++) { const r = L.rateWindow(s, now, 3, 60000); assert.equal(r.allowed, true); s = r.next; }
  assert.equal(L.rateWindow(s, now + 10, 3, 60000).allowed, false);
  assert.equal(L.rateWindow(s, now + 60000, 3, 60000).allowed, true, "window resets");
});

test("refs are PS- + 6 unambiguous chars", () => {
  const ref = L.makeRef(Buffer.from([0, 1, 2, 3, 250, 255]));
  assert.match(ref, /^PS-[2-9A-HJ-NP-Z]{6}$/);
});

test("notification copy carries no customer details", () => {
  const n = L.orderNotice({ ref: "PS-ABC234", items: [{ qty: 2 }, { qty: 1 }], totalPence: 1240, fulfilment: "collection", isTest: true, customer: { name: "Sam Secret", phone: "0770" } });
  assert.equal(n.body, "3 items · £12.40 · Collection · test order");
  assert.ok(!JSON.stringify(n).includes("Sam"));
  assert.equal(L.feedbackNotice({ rating: 4, message: "private words" }).body, "4★ rating · tap to read");
});
