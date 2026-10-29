import assert from "node:assert/strict";
import { serve, launch, closeAll, SEED } from "./harness.mjs";
const { srv, url } = await serve();
const results = [];
const T = { __ts: 1700000100000 };
const ORDER = (over = {}) => ({ uid: "cust1", ref: "PS-ABC123", requestId: "abc12345", status: "new", paymentStatus: "mock", isTest: true, fulfilment: "collection",
  items: [{ productId: "p1", qty: 2, name: "Medjool Dates 500g" }], customer: { name: "Gina Test", phone: "", email: "gina@example.com" }, note: "", estTotal: 13, createdAt: T, updatedAt: T, ...over });
const FB = (over = {}) => ({ uid: "cust1", kind: "bug", message: "The basket count looks wrong.", name: "Gina", read: false, archived: false, createdAt: T, ...over });
const seedWith = (extra) => ({ ...SEED, ...extra });

async function test(name, fn, extra = {}, vp) {
  const t = await launch(url, { seed: seedWith(extra), viewport: vp });
  try {
    t.page.setDefaultTimeout(8000);
    await t.page.goto(url + "/index.html");
    await t.page.waitForSelector("[data-add]", { timeout: 8000 });
    await t.page.evaluate(() => { window.__FAKE.nextGoogle = { email: "housikiki@gmail.com", name: "Owner", uid: "g_owner" }; });
    await t.page.click("#signInBtn"); await t.page.click("[data-google]");
    await t.page.waitForSelector("#manageBtn:not([hidden])");
    await fn(t);
    const bad = t.errors.filter(e => !/ERR_TUNNEL|Failed to load resource/.test(e));
    assert.deepEqual(bad, [], "page errors");
    results.push([true, name]);
  } catch (e) {
    let shot = "";
    try { shot = `/tmp/claude-0/-home-claude/fa786b1c-808f-5474-a40b-c6b83a368183/scratchpad/afail-${results.length}.png`; await t.page.screenshot({ path: shot }); } catch {}
    results.push([false, name, e.message.split("\n").slice(0, 6).join(" | "), shot]);
  } finally { await t.close(); }
}
const db = p => p.evaluate(() => window.__FAKE.dump());
const openAdmin = async p => { await p.click("#manageBtn"); await p.waitForSelector("#admin:not([hidden]) .adm-tab, #admin .adm-tab"); };
const tab = async (p, k) => { await p.click(`[data-act="tab"][data-tab="${k}"]`); };

await test("opens the panel with the five/six tabs", async ({ page: p }) => {
  await openAdmin(p);
  const tabs = await p.locator("#admTabs [data-tab]").evaluateAll(b => b.map(x => x.dataset.tab));
  assert.ok(["products", "orders", "feedback"].every(k => tabs.includes(k)), tabs.join());
});

await test("add a product → saved with correct types", async ({ page: p }) => {
  await openAdmin(p); await tab(p, "products");
  await p.click('[data-act="new-product"]');
  const f = p.locator("#prodForm");
  await f.locator('[name="name"]').fill("Ajwa Dates 250g");
  await f.locator('[name="price"]').fill("3.5");
  await f.locator('[name="stock"]').fill("5");
  await f.locator('[name="categoryId"]').selectOption("c1");
  await p.click("#prodSave");
  await p.waitForFunction(() => Object.values(window.__FAKE.dump().products).some(x => x.name === "Ajwa Dates 250g"));
  const prod = Object.values((await db(p)).products).find(x => x.name === "Ajwa Dates 250g");
  assert.equal(prod.price, 3.5); assert.equal(prod.stock, 5); assert.equal(prod.visible, true); assert.equal(prod.archived, false); assert.equal(prod.categoryId, "c1");
});

await test("bad price is rejected in the form (no write)", async ({ page: p }) => {
  await openAdmin(p); await tab(p, "products");
  await p.click('[data-act="new-product"]');
  const f = p.locator("#prodForm");
  await f.locator('[name="name"]').fill("Bad");
  await f.locator('[name="price"]').fill("-2");
  await f.locator('[name="stock"]').fill("1");
  await p.click("#prodSave");
  await p.waitForFunction(() => !document.querySelector("#prodErr").hidden);
  assert.equal(Object.keys((await db(p)).products).length, 3);
});

await test("stock − / + and hide toggle write through", async ({ page: p }) => {
  await openAdmin(p); await tab(p, "products");
  await p.click('[data-act="stock"][data-id="p1"][data-d="1"]');
  await p.waitForFunction(() => window.__FAKE.dump().products.p1.stock === 11);
  await p.click('[data-act="stock"][data-id="p1"][data-d="-1"]');
  await p.waitForFunction(() => window.__FAKE.dump().products.p1.stock === 10);
  await p.click('[data-act="toggle-visible"][data-id="p2"]');
  await p.waitForFunction(() => window.__FAKE.dump().products.p2.visible === false);
});

await test("category: add one", async ({ page: p }) => {
  await openAdmin(p); await tab(p, "categories");
  await p.click('[data-act="new-cat"]');
  await p.locator('#catForm [name="name"]').fill("Snacks");
  await p.click("#catSave");
  await p.waitForFunction(() => Object.values(window.__FAKE.dump().categories).some(c => c.name === "Snacks"));
});

await test("order: confirm reserves stock + locks price; cancel restores it", async ({ page: p }) => {
  await openAdmin(p); await tab(p, "orders");
  await p.click('[data-act="open-order"]');
  await p.click("#ordMain");
  await p.waitForFunction(() => window.__FAKE.dump().orders.o_abc12345.status === "confirmed");
  let d = await db(p);
  assert.equal(d.products.p1.stock, 8); assert.equal(d.orders.o_abc12345.total, 13); assert.equal(d.orders.o_abc12345.lines.length, 1);
  await p.click("[data-act=cancel-order]");
  const ok = p.locator("#admConfirm button.danger, #admConfirm [data-yes], #admConfirm .btn-primary");
  if (await ok.count()) await ok.first().click();
  await p.waitForFunction(() => window.__FAKE.dump().orders.o_abc12345.status === "cancelled");
  d = await db(p);
  assert.equal(d.products.p1.stock, 10);
}, { orders: { o_abc12345: ORDER() } });

await test("order: not enough stock blocks confirm; stock untouched", async ({ page: p }) => {
  await openAdmin(p); await tab(p, "orders");
  await p.click('[data-act="open-order"]');
  const btn = p.locator("#ordMain");
  if (!(await btn.isDisabled())) { await btn.click(); await p.waitForTimeout(500); }
  const d = await db(p);
  assert.equal(d.orders.o_abc12345.status, "new"); assert.equal(d.products.p2.stock, 3);
}, { orders: { o_abc12345: ORDER({ items: [{ productId: "p2", qty: 5, name: "Sparkling Water" }], estTotal: 12 }) } });

await test("order: delivery order shows address + advance statuses to completed", async ({ page: p }) => {
  await openAdmin(p); await tab(p, "orders");
  await p.click('[data-act="open-order"]');
  assert.match(await p.locator("#admDlg").innerText(), /Thoresby/);
  await p.click("#ordMain");
  await p.waitForFunction(() => window.__FAKE.dump().orders.o_abc12345.status === "confirmed");
  for (const s of ["preparing", "ready", "completed"]) {
    await p.waitForTimeout(500);   // the dialog redraws itself ~250ms after each action
    await p.click("#ordMain");
    await p.waitForFunction(st => window.__FAKE.dump().orders.o_abc12345.status === st, s);
  }
}, { orders: { o_abc12345: ORDER({ fulfilment: "delivery", customer: { name: "Gina", phone: "+447123456789", email: "g@e.com" },
  address: { line1: "1 Thoresby Street", line2: "", city: "Leicester", postcode: "LE5 4GU", lat: 52.63, lng: -1.09, verified: true } }) } });

await test("feedback: shows, mark read, archive", async ({ page: p }) => {
  await openAdmin(p); await tab(p, "feedback");
  await p.click('[data-act="fb-read"]');
  await p.waitForFunction(() => window.__FAKE.dump().feedback.f1.read === true);
  await p.click('[data-act="fb-archive"]');
  await p.waitForFunction(() => window.__FAKE.dump().feedback.f1.archived === true);
}, { feedback: { f1: FB() } });

await test("settings: save delivery fee", async ({ page: p }) => {
  await openAdmin(p); await tab(p, "settings");
  await p.locator('#setForm [name="deliveryFee"]').fill("3");
  await p.click("#setSave");
  await p.waitForFunction(() => window.__FAKE.dump().settings.site.deliveryFee === 3);
});

await test("alert: new order while panel is closed lights the dot + toast", async ({ page: p }) => {
  await p.waitForTimeout(400);
  await p.evaluate(o => window.__FAKE.inject("orders", "o_new99999", o), ORDER({ requestId: "new99999", ref: "PS-NEW999" }));
  await p.waitForFunction(() => !document.querySelector("#manageDot").hidden || document.querySelector("#manageDot").offsetParent !== null);
  await p.waitForFunction(() => /order/i.test(document.querySelector("#toast").textContent));
});

await test("owner panel is usable on a phone (390px) with no sideways scroll", async ({ page: p }) => {
  await openAdmin(p); await tab(p, "products");
  const w = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  assert.ok(w[0] <= w[1] + 1, w.join(" > "));
}, {}, { width: 390, height: 800 });

console.log(results.map(r => (r[0] ? "PASS " : "FAIL ") + r[1] + (r[0] ? "" : "\n     " + r[2] + (r[3] ? "\n     shot: " + r[3] : ""))).join("\n"));
console.log(`\n${results.filter(r => r[0]).length}/${results.length} passed`);
await closeAll(); srv.close();
process.exit(results.every(r => r[0]) ? 0 : 1);
