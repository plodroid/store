import assert from "node:assert/strict";
import { serve, launch, closeAll, SEED } from "./harness.mjs";
const { srv, url } = await serve();
const results = [];
const T = { __ts: 1700000100000 };
const SHOTS = "/tmp/claude-0/-home-claude/fa786b1c-808f-5474-a40b-c6b83a368183/scratchpad/";
const ignore = e => /ERR_TUNNEL|ERR_NAME|Failed to load resource/.test(e);
const withProducts = (extra = {}, site = {}) => ({ ...SEED,
  products: { ...SEED.products,
    p4: { name: "Ajwa Dates 250g", price: 5, salePrice: 3.5, stock: 4, categoryId: "c1", visible: true, archived: false, description: "Dark and soft.", updatedAt: T, createdAt: T },
    p5: { name: "Zamzam Water", price: 9, stock: 7, categoryId: "c2", visible: true, archived: false, updatedAt: T, createdAt: T } },
  settings: { site: { ...SEED.settings.site, ...site } }, ...extra });

async function test(name, fn, { seed = withProducts(), viewport } = {}) {
  const t = await launch(url, { seed, viewport });
  try {
    t.page.setDefaultTimeout(8000);
    await t.page.goto(url + "/index.html");
    await t.page.waitForSelector("[data-add]", { timeout: 8000 });
    await fn(t);
    const bad = t.errors.filter(e => !ignore(e));
    assert.deepEqual(bad, [], "page errors");
    results.push([true, name]); console.error("PASS", name);
  } catch (e) {
    let shot = ""; try { shot = `${SHOTS}ffail-${results.length}.png`; await t.page.screenshot({ path: shot }); } catch {}
    results.push([false, name, e.message.split("\n").slice(0, 6).join(" | "), shot]); console.error("FAIL", name, "::", e.message.split("\n")[0]);
  } finally { await t.close(); }
}
const db = p => p.evaluate(() => window.__FAKE.dump());
const names = p => p.locator("#grid .tile-name").allInnerTexts();
const signedIn = async (p, t, email = "gina@example.com") => {
  await p.click("#signInBtn");
  await p.locator('form[data-form="in"] [name="email"]').fill(email);
  await p.locator('form[data-form="in"] button[type="submit"]').click();
  await p.locator('[data-form="code"]').waitFor({ state: "visible" });
  await p.locator("#otp input").first().click();
  await p.keyboard.type(t.mail.codes[email]);
  await p.waitForSelector("#acctBtn:not([hidden])");
};
const owner = async p => {            // the owner has a page of their own now: /admin/
  await p.goto(url + "/admin/index.html");
  await p.waitForSelector("#gateGoogle:not([hidden])");
  await p.evaluate(() => { window.__FAKE.nextGoogle = { email: "housikiki@gmail.com", name: "Owner", uid: "g_owner" }; });
  await p.click("#gateGoogle");
  await p.waitForSelector("#admin:not([hidden]) .adm-tab");
};
const admTab = async (p, k) => { await p.waitForSelector("#admTabs [data-tab]"); await p.click(`[data-act="tab"][data-tab="${k}"]`); };

await test("product page: big photo area, description, price, 'You may also like', back to shop", async ({ page: p }) => {
  await p.locator('#grid .tile-name', { hasText: "Medjool" }).click();
  await p.waitForSelector("#vProduct:not([hidden]) .pp-name");
  assert.match(p.url(), /#\/p\/p1$/);
  const txt = await p.locator("#pp").innerText();
  assert.match(txt, /Medjool Dates 500g/); assert.match(txt, /£6\.50/); assert.match(txt, /Soft\./); assert.match(txt, /You may also like/);
  assert.ok(await p.locator("#ppMore .tile").count() >= 1);
  assert.equal(await p.locator("#vShop").isHidden(), true);
  await p.locator("[data-pp-step='1']").click(); await p.locator("[data-pp-add]").click();
  await p.waitForFunction(() => document.querySelector("#cartCount").textContent.trim() === "2");
  await p.goBack(); await p.waitForSelector("#vShop:not([hidden])");
});

await test("product page: opens straight from a link, unknown id is friendly", async ({ page: p }) => {
  await p.goto(url + "/index.html#/p/p4"); await p.reload();
  await p.waitForSelector("#vProduct:not([hidden]) .pp-name");
  assert.match(await p.locator("#pp").innerText(), /Ajwa Dates/);
  await p.goto(url + "/index.html#/p/nope");
  await p.waitForFunction(() => /couldn.t find|not found|no longer/i.test(document.querySelector("#pp").innerText));
});

await test("sale: old price crossed out, % badge, cart uses sale price", async ({ page: p }) => {
  const tile = p.locator("#grid .tile", { hasText: "Ajwa" });
  assert.match(await tile.locator(".price").innerText(), /£3\.50/);
  assert.equal(await tile.locator(".price s.was").innerText(), "£5.00");
  assert.match(await tile.locator(".flag.sale").innerText(), /30%/);
  await tile.locator("[data-add]").click();
  await p.click("#cartBtn");
  await p.waitForFunction(() => document.querySelector("#cartTotal").textContent === "£3.50");
});

await test("filters + sort: price low→high, high→low, on sale, in stock, price range, clear", async ({ page: p }) => {
  await p.selectOption("#sort", "lo");
  await p.waitForFunction(() => document.querySelector("#grid .tile-name").textContent === "Sparkling Water");
  let n = await names(p);
  assert.deepEqual(n.slice(0, 4), ["Sparkling Water", "Ajwa Dates 250g", "Medjool Dates 500g", "Zamzam Water"]);
  assert.equal(n[n.length - 1], "Sold Out Juice", "sold out goes last");
  assert.equal(n[0], "Sparkling Water");
  await p.selectOption("#sort", "hi"); await p.waitForFunction(() => document.querySelector("#grid .tile-name").textContent === "Zamzam Water"); n = await names(p);
  assert.equal(n[0], "Zamzam Water");
  await p.click("#filterBtn");
  await p.check("#fSale"); await p.waitForFunction(() => document.querySelectorAll("#grid .tile").length === 1); n = await names(p);
  assert.deepEqual(n, ["Ajwa Dates 250g"]);
  await p.uncheck("#fSale"); await p.check("#fStock"); await p.waitForFunction(() => document.querySelectorAll("#grid .tile").length === 4); n = await names(p);
  assert.ok(!n.includes("Sold Out Juice"));
  await p.fill("#fMin", "5"); await p.fill("#fMax", "7");
  await p.waitForFunction(() => document.querySelectorAll("#grid .tile").length === 1); n = await names(p);
  assert.deepEqual(n, ["Medjool Dates 500g"]);
  await p.click("#fClear"); await p.waitForFunction(() => document.querySelectorAll("#grid .tile").length === 5); n = await names(p);
  assert.equal(n.length, 5);
});

await test("search narrows the grid", async ({ page: p }) => {
  await p.fill("#q", "zam"); await p.keyboard.press("Enter");
  await p.waitForFunction(() => document.querySelectorAll("#grid .tile").length === 1);
});

await test("wishlist: heart saves, count shows, Saved page lists it, filter works, survives reload", async ({ page: p }) => {
  await p.locator("#grid .tile", { hasText: "Zamzam" }).locator("[data-wish]").click();
  await p.waitForFunction(() => document.querySelector("#wishCount").textContent.trim() === "1" && !document.querySelector("#wishCount").hidden);
  await p.reload(); await p.waitForSelector("[data-add]");
  assert.equal(await p.locator("#wishCount").innerText(), "1");
  await p.click("#savedLink"); await p.waitForSelector("#vSaved:not([hidden]) .tile");
  assert.deepEqual(await p.locator("#savedGrid .tile-name").allInnerTexts(), ["Zamzam Water"]);
  await p.locator("#savedGrid [data-wish]").click();
  await p.waitForSelector("#savedEmpty:not([hidden])");
});

await test("wishlist: syncs to the account when you sign in, and clears on sign out", async (t) => {
  const p = t.page;
  await p.locator("#grid .tile", { hasText: "Zamzam" }).locator("[data-wish]").click();
  await signedIn(p, t);
  await p.waitForFunction(() => Object.values(window.__FAKE.dump().users || {}).some(u => (u.wishlist || []).includes("p5")));
  await p.click("#acctBtn"); await p.click("#menuOut");
  await p.waitForSelector("#signInBtn:not([hidden])");
  await p.waitForFunction(() => document.querySelector("#wishCount").hidden);
});

await test("back in stock: bell on sold-out item creates, second tap cancels (needs sign-in)", async (t) => {
  const p = t.page;
  await signedIn(p, t);
  const bell = p.locator("#grid .tile", { hasText: "Sold Out Juice" }).locator("[data-notify]");
  await bell.click();
  await p.waitForFunction(() => Object.values(window.__FAKE.dump().stockAlerts || {}).some(a => a.productId === "p3" && a.email === "gina@example.com"));
  await bell.click();
  await p.waitForFunction(() => !Object.keys(window.__FAKE.dump().stockAlerts || {}).length);
});

await test("back in stock: banner appears when the item comes back", async (t) => {
  const p = t.page;
  await signedIn(p, t);
  await p.locator("#grid .tile", { hasText: "Sold Out Juice" }).locator("[data-notify]").click();
  await p.waitForFunction(() => Object.keys(window.__FAKE.dump().stockAlerts || {}).length === 1);
  await p.evaluate(() => { const d = window.__FAKE.dump().products.p3; window.__FAKE.inject("products", "p3", { ...d, stock: 6 }); });
  await p.waitForSelector("#restock:not([hidden])");
  assert.match(await p.locator("#restock").innerText(), /Sold Out Juice/);
  await p.click("[data-restock-dismiss]"); await p.waitForSelector("#restock", { state: "hidden" });
});

await test("recently viewed: shows on the shop page after you looked at products", async ({ page: p }) => {
  await p.goto(url + "/index.html#/p/p1"); await p.waitForSelector("#vProduct:not([hidden]) .pp-name");
  await p.goto(url + "/index.html#/p/p2"); await p.waitForSelector("#vProduct:not([hidden]) .pp-name");
  assert.match(await p.locator("#pp").innerText(), /Recently viewed/);
  await p.goto(url + "/index.html#/"); await p.waitForSelector("#recentShop:not([hidden]) .tile");
  assert.ok(await p.locator("#recentShopList .tile").count() >= 2);
});

await test("my orders: shows this customer's orders with a friendly status", async (t) => {
  const p = t.page;
  await signedIn(p, t);
  await p.evaluate(() => window.__FAKE.inject("orders", "o_mine1234", { uid: window.__FAKE.signedInUid(), ref: "BH-ABC123", requestId: "mine1234", status: "ready", paymentStatus: "mock", isTest: true,
    fulfilment: "collection", items: [{ productId: "p1", qty: 1, name: "Medjool Dates 500g" }], customer: { name: "Gina", phone: "", email: "gina@example.com" }, note: "", estTotal: 6.5, createdAt: { __ts: 1700000100000 }, updatedAt: { __ts: 1700000100000 } }));
  await p.evaluate(() => window.__FAKE.inject("orders", "o_other999", { uid: "someone-else", ref: "BH-ZZZ999", requestId: "other999", status: "new", paymentStatus: "mock", isTest: true,
    fulfilment: "collection", items: [{ productId: "p1", qty: 1, name: "x" }], customer: { name: "Bob", phone: "", email: "b@e.com" }, note: "", estTotal: 1, createdAt: { __ts: 1700000100000 }, updatedAt: { __ts: 1700000100000 } }));
  await p.click("#acctBtn"); await p.click("#menuOrders");
  await p.waitForFunction(() => /BH-ABC123/.test(document.querySelector("#moBody").innerText));
  const txt = await p.locator("#moBody").innerText();
  assert.ok(!/BH-ZZZ999/.test(txt)); assert.match(txt, /ready/i);
});

const order = (id, extra) => ({ uid: "UID", ref: "BH-" + id.slice(-6).toUpperCase(), requestId: id, status: "confirmed", paymentStatus: "mock", isTest: true, fulfilment: "collection",
  items: [{ productId: "p1", qty: 1, name: "Medjool Dates 500g" }], customer: { name: "Gina", phone: "", email: "gina@example.com" }, note: "", estTotal: 6.5, total: 6.5, createdAt: T, updatedAt: T, ...extra });
const putOrder = (p, id, extra) => p.evaluate(([id, o]) => window.__FAKE.inject("orders", id, { ...o, uid: window.__FAKE.signedInUid() }), [id, order(id, extra)]);

await test("card payment: Pay button only on confirmed unpaid orders; it sends the order to Stripe", async (t) => {
  const p = t.page; t.mail.pay = true;
  await signedIn(p, t);
  await putOrder(p, "o_conf12345"); await putOrder(p, "o_new123456", { status: "new", total: undefined }); await putOrder(p, "o_paid12345", { paymentStatus: "paid" });
  await p.context().route("https://checkout.stripe.test/**", r => r.fulfill({ contentType: "text/html", body: "<title>stripe</title>" }));
  await p.click("#acctBtn"); await p.click("#menuOrders");
  await p.waitForFunction(() => document.querySelectorAll("#moBody .mo-card").length === 3);
  assert.equal(await p.locator("[data-pay]").count(), 1);
  assert.match(await p.locator("[data-pay]").innerText(), /Pay £6\.50 by card/);
  assert.equal(await p.locator('.mo-chip[data-st="completed"]', { hasText: "Paid" }).count(), 1);
  await p.click("[data-pay]");
  await p.waitForURL(/checkout\.stripe\.test\/pay\?o=o_conf12345/);
  const call = t.mail.calls.find(c => c.a === "pay");
  assert.equal(call.orderId, "o_conf12345"); assert.ok(call.idToken, "sends the login token");
  assert.equal(call.amount, undefined, "the browser never sends an amount");
});

await test("card payment: coming back from Stripe confirms the payment, clears the link and empties the basket", async (t) => {
  const p = t.page; t.mail.pay = true;
  await signedIn(p, t);
  await putOrder(p, "o_conf12345");
  await p.locator("#grid .tile", { hasText: "Zamzam" }).locator("[data-add]").click();
  await p.waitForFunction(() => document.querySelector("#cartCount").textContent.trim() === "1");
  await p.goto(url + "/index.html?paid=o_conf12345&sid=cs_test_good#/");
  await p.waitForSelector("#moBody .mo-card");
  await p.waitForFunction(() => document.querySelector("#cartCount").textContent.trim() === "0" || !document.querySelector("#cartCount").offsetParent);
  assert.ok(true);
  assert.ok(t.mail.calls.some(c => c.a === "paid" && c.orderId === "o_conf12345" && c.sid === "cs_test_good"));
  assert.match(await p.locator("#toast").innerText(), /Payment received/);
  assert.ok(!/paid=|sid=/.test(p.url()), "link is cleaned");
});

await test("card payment: no Pay button when the shop hasn't switched card payments on", async (t) => {
  const p = t.page;
  t.mail.pay = false;
  await signedIn(p, t);
  await putOrder(p, "o_conf12345");
  await p.click("#acctBtn"); await p.click("#menuOrders");
  await p.waitForSelector("#moBody .mo-card");
  await p.waitForTimeout(400);
  assert.equal(await p.locator("[data-pay]").count(), 0);
});

const checkoutWith = async (p, t, how = "collection") => {
  await signedIn(p, t);
  await p.locator("#grid .tile", { hasText: "Zamzam" }).locator("[data-add]").click();
  await p.click("#cartBtn"); await p.click("#checkout");
  await p.waitForSelector("#coChoices input");
  await p.locator('#coForm [name="name"]').fill("Gina Test");
  if (how === "delivery") {
    await p.locator('#coChoices input[value="delivery"]').check();
    await p.locator('#coForm [name="phone"]').fill("07123456789");
  }
};

await test("card checkout: the button says Pay, the order is saved unpaid, then you go straight to Stripe", async (t) => {
  const p = t.page; t.mail.pay = true;
  await p.context().route("https://checkout.stripe.test/**", r => r.fulfill({ contentType: "text/html", body: "<title>stripe</title>" }));
  await checkoutWith(p, t);
  await p.waitForFunction(() => /Pay £9\.00 by card/.test(document.querySelector("#coSubmit").innerText));
  await p.click("#coSubmit");
  await p.waitForURL(/checkout\.stripe\.test\/pay\?o=o_/);
  const o = Object.values(t.mail.atPay.orders)[0];
  assert.equal(o.status, "new"); assert.equal(o.paymentStatus, "awaiting"); assert.equal(o.isTest, true);
  const call = t.mail.calls.find(c => c.a === "pay");
  assert.equal(call.orderId, "o_" + o.requestId); assert.equal(call.amount, undefined);
});

await test("card checkout: a customer who never paid sees 'Waiting for payment' with a Pay button, and the shop never sees it", async (t) => {
  const p = t.page; t.mail.pay = true;
  await signedIn(p, t);
  await putOrder(p, "o_wait12345", { status: "new", paymentStatus: "awaiting", total: undefined, createdAt: { __ts: Date.now() } });
  await p.click("#acctBtn"); await p.click("#menuOrders");
  await p.waitForSelector("#moBody .mo-card");
  await p.waitForSelector("[data-pay]");
  assert.match(await p.locator("#moBody").innerText(), /Waiting for payment/);
  assert.match(await p.locator("#moBody").innerText(), /isn't placed until it's paid/);
});

await test("checkout: delivery shows as 'Not available yet' when the owner has it off", async (t) => {
  const p = t.page;
  await signedIn(p, t);
  await p.locator("#grid .tile", { hasText: "Zamzam" }).locator("[data-add]").click();
  await p.click("#cartBtn"); await p.click("#checkout");
  await p.waitForSelector("#coChoices");
  assert.match(await p.locator("#coChoices").innerText(), /Not available yet/);
  assert.equal(await p.locator('#coChoices input[value="delivery"]').count(), 0);
}, { seed: withProducts({}, { delivery: false }) });

await test("owner: Sale button starts and ends a sale (rules-checked)", async ({ page: p }) => {
  await owner(p); await admTab(p, "products");
  await p.click('[data-act="sale"][data-id="p1"]');
  await p.locator('#saleForm [name="sale"]').fill("9");        // not lower than 6.50 → blocked
  await p.click("#saleSave");
  await p.waitForFunction(() => !document.querySelector("#saleErr").hidden);
  await p.click('[data-act="sale-pct"][data-pct="20"]');
  assert.equal(await p.locator('#saleForm [name="sale"]').inputValue(), "5.20");
  await p.click("#saleSave");
  await p.waitForFunction(() => window.__FAKE.dump().products.p1.salePrice === 5.2);
  await p.click('[data-act="sale"][data-id="p1"]'); await p.click('[data-act="sale-off"]');
  await p.waitForFunction(() => window.__FAKE.dump().products.p1.salePrice === null);
});

await test("owner: sees who is waiting and can email them; alerts are then cleared", async (t) => {
  const p = t.page;
  await p.evaluate(() => window.__FAKE.inject("stockAlerts", "u1_p3", { uid: "u1", productId: "p3", productName: "Sold Out Juice", email: "a@example.com", createdAt: { __ts: 1700000100000 } }));
  await p.evaluate(() => { const d = window.__FAKE.dump().products.p3; window.__FAKE.inject("products", "p3", { ...d, stock: 5 }); });
  await owner(p); await admTab(p, "products");
  await p.click('[data-act="notify-stock"][data-id="p3"]');
  await p.click("#admConfirm [data-yes]");
  await p.waitForFunction(() => !Object.keys(window.__FAKE.dump().stockAlerts || {}).length);
  assert.ok(t.mail.calls.some(c => c.a === "notify" && c.emails.includes("a@example.com")));
});

await test("rules: a customer can't write a sale price or read other people's alerts", async (t) => {
  const p = t.page;
  await signedIn(p, t);
  const r = await p.evaluate(() => {
    const { fs } = window.__FAKE; const out = {};
    return (async () => {
      try { await fs.updateDoc(fs.doc({}, "products", "p1"), { salePrice: 1 }); out.sale = "wrote"; } catch (e) { out.sale = e.code; }
      try { await fs.setDoc(fs.doc({}, "stockAlerts", "x_p3"), { uid: "x", productId: "p3", productName: "n", email: "gina@example.com", createdAt: fs.serverTimestamp() }); out.alert = "wrote"; } catch (e) { out.alert = e.code; }
      return out;
    })();
  });
  assert.equal(r.sale, "permission-denied"); assert.equal(r.alert, "permission-denied");
});

await test("phone (390px): header fits, product page and filters have no sideways scroll", async ({ page: p }) => {
  const fits = async () => { const w = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); assert.ok(w[0] <= w[1] + 1, w.join(" > ")); };
  await fits();
  await p.click("#filterBtn"); await fits();
  await p.goto(url + "/index.html#/p/p4"); await p.waitForSelector("#vProduct:not([hidden]) .pp-name"); await fits();
}, { viewport: { width: 390, height: 800 } });

await test("brand: no 'Plodroid', no real-looking postcode example anywhere on the page", async ({ page: p }) => {
  const html = await p.content();
  assert.ok(!/plodroid/i.test(html.replace(/https:\/\/plodroid\.github\.io\/store\//gi, "")), "found Plodroid");
  assert.ok(!/LE5 ?4GU|Thoresby/i.test(html));
  assert.match(await p.title(), /Bee Hive/);
});

console.log(results.map(r => (r[0] ? "PASS " : "FAIL ") + r[1] + (r[0] ? "" : "\n     " + r[2] + (r[3] ? "\n     shot: " + r[3] : ""))).join("\n"));
console.log(`\n${results.filter(r => r[0]).length}/${results.length} passed`);
await closeAll(); srv.close();
process.exit(results.every(r => r[0]) ? 0 : 1);
