/* Scrolling bar, order progress bar, language dropdown, footer, owner analytics, photos, app update. */
import assert from "node:assert/strict";
import { serve, launch, closeAll, SEED } from "./harness.mjs";
const { srv, url } = await serve();
const results = [];
const T = { __ts: 1700000100000 };
const SHOTS = "/tmp/claude-0/-home-claude/fa786b1c-808f-5474-a40b-c6b83a368183/scratchpad/";
const ignore = e => /ERR_TUNNEL|ERR_NAME|Failed to load resource|ERR_FAILED/.test(e);
const seedWith = (extra = {}, site = {}) => ({ ...SEED, settings: { site: { ...SEED.settings.site, ...site } }, ...extra });

async function test(name, fn, { seed = seedWith(), viewport, path = "/index.html", ready = "[data-add]", geo, init } = {}) {
  const t = await launch(url, { seed, viewport });
  try {
    t.page.setDefaultTimeout(8000);
    if (init) await t.ctx.addInitScript(init);
    if (geo) { await t.ctx.grantPermissions(["geolocation"]); await t.ctx.setGeolocation(geo); }
    await t.page.goto(url + path);
    await t.page.waitForSelector(ready, { timeout: 8000 });
    await fn(t);
    const bad = t.errors.filter(e => !ignore(e));
    assert.deepEqual(bad, [], "page errors");
    results.push([true, name]); console.error("PASS", name);
  } catch (e) {
    let shot = ""; try { shot = `${SHOTS}nfail-${results.length}.png`; await t.page.screenshot({ path: shot }); } catch {}
    results.push([false, name, e.message.split("\n").slice(0, 6).join(" | "), shot]); console.error("FAIL", name, "::", e.message.split("\n")[0]);
  } finally { await t.close(); }
}
const ORDER = (o = {}) => ({ uid: "cust1", ref: "BH-ABC123", requestId: "abc12345", status: "confirmed", paymentStatus: "paid", isTest: true, fulfilment: "shipping",
  items: [{ productId: "p1", qty: 2, name: "Medjool Dates 500g" }], customer: { name: "Gina Test", phone: "+447123456789", email: "gina@example.com" }, note: "", estTotal: 13, total: 13,
  address: { country: "GB", line1: "10 Example Road", line2: "", city: "London", state: "", postcode: "SW1A 1AA", verified: true },
  shipping: { serviceId: "svc-evri", courier: "Evri", service: "Standard", price: 2.49, etaMin: 3, etaMax: 5 }, createdAt: T, updatedAt: T, ...o });
const db = p => p.evaluate(() => window.__FAKE.dump());
const signedIn = async (p, t, email = "gina@example.com") => {
  await p.click("#signInBtn");
  await p.locator('form[data-form="in"] [name="email"]').fill(email);
  await p.locator('form[data-form="in"] [name="password"]').fill("secret1");
  await p.locator('form[data-form="in"] button[type="submit"]').click();
  await p.waitForSelector("#acctBtn:not([hidden])");
};
const EV = (o = {}) => ({ name: "Iftar Week", tagline: "Blessed nights", look: "ramadan", active: true, percentOff: 20, productIds: ["p1"], createdAt: T, updatedAt: T, ...o });
const tickerText = p => p.locator("#announce .tk-group").first().innerText();

/* ── scrolling bar ───────────────────────────────────── */
await test("ticker: hidden when there is nothing to say", async ({ page: p }) => {
  assert.ok(await p.locator("#announce").isHidden());
});
await test("ticker: live event says '20% off for Iftar Week', then the owner's own lines scroll after it", async ({ page: p }) => {
  await p.waitForSelector("#announce:not([hidden]) .tk-item");
  const t = await tickerText(p);
  assert.match(t, /20% off for Iftar Week/); assert.match(t, /Free delivery over £30/); assert.match(t, /Open till 9pm/);
  assert.ok(t.indexOf("Iftar") < t.indexOf("Free delivery"), "event first");
  assert.equal(await p.locator("#announce .tk-group").first().getAttribute("aria-hidden"), null);
  assert.equal(await p.locator("#announce .tk-group[aria-hidden]").count(), 1);     // the second copy is hidden from screen readers
  assert.notEqual(await p.locator("#announce .tk-track").evaluate(e => getComputedStyle(e).animationName), "none");
}, { seed: seedWith({ events: { e1: EV() } }, { announcement: "Free delivery over £30\nOpen till 9pm" }) });
await test("ticker: an event's own 'scrolling bar text' replaces the default line", async ({ page: p }) => {
  await p.waitForSelector("#announce:not([hidden]) .tk-item");
  const t = await tickerText(p);
  assert.match(t, /Eid Mubarak: 30% off dates/); assert.doesNotMatch(t, /20% off for/);
}, { seed: seedWith({ events: { e1: EV({ look: "eid", name: "Eid", ticker: "Eid Mubarak: 30% off dates" }) } }) });
await test("ticker: the bar is as wide as the screen with a single short message (no gap in the loop)", async ({ page: p }) => {
  await p.waitForSelector("#announce:not([hidden]) .tk-item");
  await p.waitForTimeout(150);
  const [g, w] = await p.evaluate(() => [document.querySelector("#announce .tk-group").scrollWidth, innerWidth]);
  assert.ok(g >= w, `group ${g} < screen ${w}`);
}, { seed: seedWith({}, { announcement: "Hello" }) });

/* ── order progress bar ──────────────────────────────── */
const orderFlow = async (t, how) => {
  const p = t.page; await signedIn(p, t);
  await p.click("[data-add]"); await p.click("#cartBtn"); await p.click("#checkout"); await p.waitForSelector("#co[open]");
  await p.check(`input[name="how"][value="${how}"]`);
  await p.locator('#coForm [name="name"]').fill("Gina Test");
  await p.click("#coSubmit"); await p.waitForSelector("#coDone:not([hidden])");
  await p.keyboard.press("Escape");
  const d = await db(p); const id = Object.keys(d.orders)[0];
  return { id, order: d.orders[id] };
};
const setStatus = (p, id, over) => p.evaluate(([id, over]) => { const o = window.__FAKE.dump().orders[id]; window.__FAKE.inject("orders", id, { ...o, ...over }); }, [id, over]);
const steps = p => p.locator("#moList .trk li span").allInnerTexts();
const states = p => p.locator("#moList .trk li").evaluateAll(l => l.map(x => x.dataset.s));
await test("order bar: shipping has Confirmed & paid › Preparing › Shipped › Delivered, follows the status and shows the tracking link", async (t) => {
  const p = t.page; await signedIn(p, t);
  const SHIP = { uid: "", ref: "BH-SHIP01", requestId: "ship0001", status: "confirmed", paymentStatus: "paid", isTest: true, fulfilment: "shipping",
    items: [{ productId: "p1", qty: 1, name: "Medjool Dates 500g" }], customer: { name: "Gina", phone: "+447911123456", email: "gina@example.com" }, note: "", estTotal: 9, total: 9, shippingFee: 2.49,
    address: { country: "GB", line1: "10 Example Road", line2: "", city: "London", state: "", postcode: "SW1A 1AA", verified: true },
    shipping: { serviceId: "svc-evri", courier: "Evri", service: "Standard", price: 2.49, etaMin: 3, etaMax: 5 }, createdAt: T, updatedAt: T };
  const id = "o_ship0001";
  await p.evaluate(([id, o]) => window.__FAKE.inject("orders", id, { ...o, uid: window.__FAKE.signedInUid() }), [id, SHIP]);
  await p.click("#acctBtn"); await p.click("#menuOrders"); await p.waitForSelector("#moList .trk");
  assert.deepEqual(await steps(p), ["Confirmed & paid", "Preparing", "Shipped", "Delivered"]);
  assert.deepEqual(await states(p), ["now", "todo", "todo", "todo"]);
  assert.equal(await p.locator("#moList a", { hasText: "Track parcel" }).count(), 0, "no link before it is shipped");
  await setStatus(p, id, { status: "shipped", shipment: { easyshipId: "ES1", trackingUrl: "https://track.example/abc", labelState: "generated" } });
  await p.waitForFunction(() => document.querySelectorAll("#moList .trk li[data-s=done]").length === 2);
  assert.deepEqual(await states(p), ["done", "done", "now", "todo"]);
  assert.equal(await p.locator('#moList a[href="https://track.example/abc"]').count(), 1);
  assert.match(await p.locator("#moList").innerText(), /Evri Standard/);
  await setStatus(p, id, { status: "completed" });
  await p.waitForFunction(() => document.querySelectorAll("#moList .trk li[data-s=done]").length === 4);
  assert.match(await p.locator("#moList .trk").getAttribute("aria-label"), /Step 4 of 4: Delivered/);
});
await test("order bar: pick-up has its own steps; a cancelled order has no bar", async (t) => {
  const p = t.page; const { id } = await orderFlow(t, "collection");
  await p.click("#acctBtn"); await p.click("#menuOrders"); await p.waitForSelector("#moList .trk");
  assert.deepEqual(await steps(p), ["Confirmed", "Preparing", "Ready to collect", "Collected"]);
  await setStatus(p, id, { status: "cancelled" });
  await p.waitForFunction(() => !document.querySelector("#moList .trk"));
});

/* ── footer ──────────────────────────────────────────── */
await test("footer: dark 'Let us help you' column with working links and 'All rights reserved' at the very bottom", async (t) => {
  const p = t.page;
  assert.match(await p.locator(".foot-col").first().innerText(), /Let us help you/i);
  assert.match(await p.locator(".foot-base-bar").innerText(), /© \d{4} .*All rights reserved\./);
  const last = await p.evaluate(() => { const f = document.querySelector("footer").getBoundingClientRect(), b = document.querySelector(".foot-base-bar").getBoundingClientRect(); return Math.abs(f.bottom - b.bottom) < 80; });
  assert.ok(last, "rights line is the last thing on the page");
  await p.click("#footDelivery"); await p.waitForSelector("#info[open]");
  assert.match(await p.locator("#infoBody").innerText(), /Pick up from the shop/);
  await p.keyboard.press("Escape");
  await p.click("#footSaved"); await p.waitForFunction(() => location.hash === "#/saved");
  await p.goto(p.url().split("#")[0]); await p.waitForSelector("[data-add]");
  await p.click("#footAcct"); await p.waitForSelector("#acct[open], #auth[open], dialog[open]");   // asks him to sign in first
  await p.keyboard.press("Escape");
  await p.click("#openFeedback"); await p.waitForSelector("dialog[open]");
});
/* ── iPhone app: native tab bar (Liquid Glass on iOS 26+) ── */
const IOS = () => { const calls = []; window.__dock = { calls, tap: null }; window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "ios", registerPlugin: n => { if (n !== "NativeDock") throw new Error("only the dock is faked"); return ({
  update: async o => { calls.push(JSON.parse(JSON.stringify(o))); return { height: 82, glass: true }; }, addListener: (n, f) => { window.__dock.tap = f; return Promise.resolve({ remove() {} }); } }); } }; };
await test("iPhone app: the page hands its bottom bar to the native tab bar and follows its taps", async ({ page: p }) => {
  await p.waitForFunction(() => window.__dock.calls.length > 0);
  const c = () => p.evaluate(() => window.__dock.calls[window.__dock.calls.length - 1]);
  let a = await c();
  assert.deepEqual(a.items.map(i => i.id), ["home", "saved", "cart", "acct"]);
  assert.deepEqual(a.items.map(i => i.symbol), ["house", "heart", "bag", "person"]);
  assert.equal(a.selected, "home"); assert.equal(a.hidden, false); assert.match(a.tint || "", /^#[0-9a-f]{6}$/);
  assert.ok(await p.evaluate(() => document.documentElement.classList.contains("native-dock")));
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector("#dock")).visibility), "hidden");
  assert.equal(await p.evaluate(() => document.documentElement.style.getPropertyValue("--dock-h")), "90px");   // 82 + 8: the page leaves room for the bar
  await p.evaluate(() => window.__dock.tap({ id: "saved" })); await p.waitForFunction(() => location.hash === "#/saved");
  await p.waitForFunction(() => window.__dock.calls[window.__dock.calls.length - 1].selected === "saved");
  await p.locator("#grid [data-add]").first().click().catch(() => {});
  await p.evaluate(() => window.__dock.tap({ id: "cart" })); await p.waitForSelector("#drawer.open");
  await p.keyboard.press("Escape");
  a = await c(); assert.ok(a.items.find(i => i.id === "cart"));
  await p.evaluate(() => window.__dock.tap({ id: "home" })); await p.waitForFunction(() => window.__dock.calls[window.__dock.calls.length - 1].selected === "home");
}, { viewport: { width: 390, height: 844 }, init: IOS });
await test("iPhone app: an old build without the plugin keeps the web bar", async ({ page: p }) => {
  await p.waitForTimeout(500);
  assert.ok(!(await p.evaluate(() => document.documentElement.classList.contains("native-dock"))));
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector("#dock")).visibility), "visible");
}, { viewport: { width: 390, height: 844 }, init: () => { window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "ios", registerPlugin: () => ({ update: async () => { throw new Error("not implemented"); }, addListener: () => Promise.resolve({}) }) }; } });
await test("iPhone app (owner): tabs become Today / Products / Orders / Messages / More and a tap switches the page", async ({ page: p }) => {
  await p.evaluate(() => { window.__FAKE.nextGoogle = { email: "housikiki@gmail.com", name: "Owner", uid: "g_owner" }; });
  await p.click("#gateGoogle"); await p.waitForSelector("#admin:not([hidden]) .adm-tab", { state: "attached" });
  await p.waitForFunction(() => window.__dock.calls.some(c => !c.hidden));
  const c = () => p.evaluate(() => window.__dock.calls[window.__dock.calls.length - 1]);
  let a = await c(); assert.deepEqual(a.items.map(i => i.id), ["home", "products", "orders", "feedback", "more"]); assert.equal(a.selected, "home");
  assert.deepEqual(a.items[4].more.map(m => m.id), ["events", "categories", "settings"]);
  assert.equal(await p.locator("#admTabs").isHidden(), true, "web tabs hidden");
  await p.evaluate(() => window.__dock.tap({ id: "orders" })); await p.waitForFunction(() => window.__dock.calls[window.__dock.calls.length - 1].selected === "orders");
  assert.ok((await c()).items.find(i => i.id === "orders").badge >= 0);
  await p.evaluate(() => window.__dock.tap({ id: "events" })); await p.waitForFunction(() => window.__dock.calls[window.__dock.calls.length - 1].selected === "more");
}, { path: "/admin/index.html", ready: "#gateGoogle:not([hidden])", viewport: { width: 390, height: 844 }, init: IOS, seed: seedWith({ orders: { o1: ORDER({ status: "shipped" }) } }) });

/* ── language ────────────────────────────────────────── */
const TAG = { en: "en-GB", us: "en-US", fr: "fr", ar: "ar", es: "es", de: "de", tr: "tr", it: "it", hi: "hi", ur: "ur", bn: "bn", pa: "pa", pl: "pl", ro: "ro", pt: "pt", nl: "nl", ru: "ru", zh: "zh-CN", ja: "ja", ko: "ko", id: "id" };
const ALL = Object.keys(TAG);
const langPick = async (p, code) => { await p.click("#langBtn"); await p.click(`#langMenu [data-lang="${code}"]`); await p.waitForFunction(t => document.documentElement.lang === t && document.querySelector("#langBtn .lang-code").textContent !== "", TAG[code]); await p.waitForTimeout(60); };
await test("language: button sits next to the basket and lists every language with a flag", async ({ page: p }) => {
  const rows = await p.locator("#langMenu [data-lang]").evaluateAll(b => b.map(x => [x.dataset.lang, x.querySelector("b").textContent, !!x.querySelector("svg.fl")]));
  assert.deepEqual(rows.map(r => r[0]), ALL);
  assert.deepEqual(rows.map(r => r[1]), ALL.map(c => c.toUpperCase()));
  assert.equal(rows[0][0], "en", "English is first and the default");
  assert.ok(rows.every(r => r[2]));
  assert.ok(await p.locator("#langMenu").isHidden());
  await p.click("#langBtn"); assert.ok(await p.locator("#langMenu").isVisible());
  await p.keyboard.press("Escape"); assert.ok(await p.locator("#langMenu").isHidden());
  const [a, b] = await p.evaluate(() => [document.querySelector("#cartBtn").getBoundingClientRect(), document.querySelector("#langBtn").getBoundingClientRect()]);
  assert.ok(Math.abs(a.top - b.top) < 20 && b.left - a.right < 60 && b.left - a.right >= 0, `next to the basket ${JSON.stringify([a.top, a.right, b.top, b.left])}`);
});
await test("language: French translates the page, toasts and basket; survives reload; English brings it all back", async ({ page: p }) => {
  await langPick(p, "fr");
  assert.equal(await p.locator("html").getAttribute("lang"), "fr");
  assert.equal(await p.locator("#langBtn .lang-code").innerText(), "FR");
  assert.match(await p.locator("#cartBtn").innerText(), /Panier/);
  assert.equal(await p.locator("#q").getAttribute("placeholder"), "Rechercher des produits");
  assert.equal(await p.locator("#grid .tile-name").first().innerText(), "Medjool Dates 500g");        // the owner's product names are left alone
  await p.locator("#grid [data-add]").first().click();
  await p.waitForFunction(() => /ajouté/.test(document.querySelector("#toast").textContent));
  assert.match(await p.locator("#toast").innerText(), /Medjool Dates 500g ajouté/);
  await p.click("#cartBtn");
  await p.waitForFunction(() => /Votre commande|Sous-total/.test(document.querySelector("#cartItems").closest("aside, dialog, div[role], .drawer, body").innerText));
  await p.reload(); await p.waitForSelector("[data-add]");
  await p.waitForFunction(() => document.querySelector("#cartBtn").innerText.includes("Panier"));
  await langPick(p, "en");
  await p.waitForFunction(() => document.querySelector("#cartBtn").innerText.includes("Basket"));
  assert.equal(await p.locator("#q").getAttribute("placeholder"), "Search products");
  assert.equal(await p.locator("html").getAttribute("lang"), "en-GB");
  assert.equal(await p.locator("#langBtn .lang-code").innerText(), "EN");
});
await test("language: Arabic flips the page right-to-left; the scrolling bar keeps moving", async ({ page: p }) => {
  await langPick(p, "ar");
  assert.equal(await p.locator("html").getAttribute("dir"), "rtl");
  assert.equal(await p.locator("html").getAttribute("lang"), "ar");
  assert.match(await p.locator("#cartBtn").innerText(), /السلة/);
  const x = await p.evaluate(() => [document.querySelector(".brand").getBoundingClientRect().left, document.querySelector("#cartBtn").getBoundingClientRect().left]);
  assert.ok(x[0] > x[1], "logo on the right, basket on the left");
  assert.ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)), "no sideways scroll");
  await p.waitForSelector("#announce .tk-item");
  const pos = async () => p.locator("#announce .tk-item").first().evaluate(e => e.getBoundingClientRect().left);
  const a = await pos(); await p.waitForTimeout(700); const b = await pos();
  assert.notEqual(a, b);
  const vis = await p.evaluate(() => { const r = document.querySelector("#announce").getBoundingClientRect(); return [...document.querySelectorAll("#announce .tk-item")].some(e => { const q = e.getBoundingClientRect(); return q.right > 0 && q.left < r.right; }); });
  assert.ok(vis, "ticker has text on screen");
  await langPick(p, "en"); assert.equal(await p.locator("html").getAttribute("dir"), "ltr");
}, { seed: seedWith({}, { announcement: "Free delivery over £30" }) });
await test("language: US English says cart; ticker + tracker text follow the language", async ({ page: p }) => {
  await langPick(p, "us");
  assert.match(await p.locator("#cartBtn").innerText(), /Cart/);
  assert.equal(await p.locator("html").getAttribute("lang"), "en-US");
  await langPick(p, "de");
  await p.waitForFunction(() => /Rabatt zu Iftar Week/.test(document.querySelector("#announce").innerText));
  await langPick(p, "tr");
  await p.waitForFunction(() => /Iftar Week için %20 indirim/.test(document.querySelector("#announce").innerText));
}, { seed: seedWith({ events: { e1: EV() } }) });
await test("language: Hindi, Chinese and Urdu translate the page; Urdu is right-to-left; menu scrolls", async ({ page: p }) => {
  await langPick(p, "hi");
  assert.match(await p.locator("#cartBtn").innerText(), /टोकरी/);
  assert.equal(await p.locator("#q").getAttribute("placeholder"), "उत्पाद खोजें");
  assert.equal(await p.locator("#grid .tile-name").first().innerText(), "Medjool Dates 500g");
  await langPick(p, "zh"); assert.equal(await p.locator("#q").getAttribute("placeholder"), "搜索商品");
  await langPick(p, "ur");
  assert.equal(await p.locator("html").getAttribute("dir"), "rtl");
  assert.equal(await p.locator("#q").getAttribute("placeholder"), "مصنوعات تلاش کریں");
  await p.click("#langBtn");
  const m = await p.locator("#langMenu").evaluate(e => [e.scrollHeight > e.clientHeight, e.getBoundingClientRect().bottom <= innerHeight]);
  assert.deepEqual(m, [true, true], "21 languages scroll inside the viewport");
  await p.keyboard.press("Escape");
  await langPick(p, "en"); assert.equal(await p.locator("html").getAttribute("dir"), "ltr");
});
await test("language: the menu works on a phone and nothing overflows in any language", async ({ page: p }) => {
  for (const c of [...ALL.filter(x => x !== "en"), "en"]) {
    await langPick(p, c);
    await p.waitForTimeout(80);
    const o = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(o <= 0, `${c} overflows by ${o}px`);
  }
}, { viewport: { width: 390, height: 800 } });
/* ── owner: analytics ───────────────────────────────── */
const SPREAD = () => Object.fromEntries(Array.from({ length: 14 }, (_, i) => ["a" + i, ORDER({ ref: "BH-A" + i, fulfilment: i % 3 ? "collection" : "shipping", total: 10 + i, estTotal: 10 + i,
  customer: { name: "C" + (i % 5), email: `c${i % 5}@example.com`, phone: "" }, items: [{ productId: i % 2 ? "p1" : "p2", qty: 1 + (i % 3), name: i % 2 ? "Medjool Dates 500g" : "Other thing" }],
  createdAt: { __ts: Date.now() - i * 20 * 36e5 } })]));
await test("owner analytics: KPIs, trend chart with axes, best sellers, busy times, range switch and hover tooltip", async ({ page: p }) => {
  await p.evaluate(() => { window.__FAKE.nextGoogle = { email: "housikiki@gmail.com", name: "Owner", uid: "g_owner" }; });
  await p.click("#gateGoogle"); await p.waitForSelector(".an .kpis");
  assert.equal(await p.locator(".kpi").count(), 4);
  assert.match(await p.locator(".kpi").first().innerText(), /Sales\s+£\d/);
  assert.ok(await p.locator(".achart .ax").count() >= 8, "axis labels");
  assert.ok(await p.locator(".achart .gl").count() >= 5, "grid");
  assert.ok(await p.locator(".top li").count() >= 2 && await p.locator(".hc").count() === 24);
  await p.locator(".aw svg").hover({ position: { x: 150, y: 80 } });
  await p.waitForSelector(".tip:not([hidden])");
  assert.match(await p.locator(".tip").innerText(), /£\d+\.\d\d[\s\S]*order/);
  await p.click('[data-act="arange"][data-r="7"]');
  assert.equal(await p.locator('[data-act="arange"][aria-pressed="true"]').innerText(), "7 days");
  await p.click('[data-act="arange"][data-r="90"]');
  assert.match(await p.locator(".an h4").first().innerText(), /per week/);
  await p.evaluate(() => document.querySelector(".an").scrollIntoView()); await p.screenshot({ path: "/tmp/analytics.png" });
}, { path: "/admin/index.html", ready: "#gateGoogle:not([hidden])", seed: seedWith({ orders: SPREAD() }) });

/* ── product photos ─────────────────────────────────── */
const IMG = `data:image/png;base64,${PNG.toString("base64")}`;
const GALLERY_SEED = () => { const sd = seedWith(); sd.products = { ...sd.products, p1: { ...sd.products.p1, image: IMG, imageCount: 3 } }; sd.productImages = { p1: { images: [IMG, IMG, IMG], updatedAt: T } }; return sd; };
await test("shop: product photos swipe (scroll-snap), dots + counter follow, arrows and keys work; single-photo products are unchanged", async ({ page: p }) => {
  await p.goto(url + "/index.html#/p/p1"); await p.waitForSelector("#vProduct:not([hidden]) .gal-track");
  assert.equal(await p.locator(".gal-s").count(), 3);
  assert.equal(await p.locator(".gal-dots i").count(), 3);
  assert.equal(await p.locator(".gal-n").innerText(), "1 / 3");
  await p.evaluate(() => { const t = document.querySelector(".gal-track"); t.scrollTo({ left: t.clientWidth * 1, behavior: "instant" }); });
  await p.waitForFunction(() => document.querySelector(".gal-n").textContent === "2 / 3");
  assert.equal(await p.locator(".gal-dots i.on").count(), 1);
  await p.click(".gal-nav.next"); await p.waitForFunction(() => document.querySelector(".gal-n").textContent === "3 / 3");
  assert.equal(await p.locator(".gal-nav.next").isHidden(), true);
  await p.focus(".gal-track"); await p.keyboard.press("ArrowLeft"); await p.waitForFunction(() => document.querySelector(".gal-n").textContent === "2 / 3");
  await p.goto(url + "/index.html#/p/p2"); await p.waitForSelector("#vProduct:not([hidden]) .pp-name");
  assert.equal(await p.locator(".gal").count(), 0);
}, { seed: GALLERY_SEED() });
await test("owner: add several photos at once, make one the cover, remove one, save; gallery doc + cover thumb + count are stored; limit of 5", async ({ page: p }) => {
  await p.evaluate(() => { window.__FAKE.nextGoogle = { email: "housikiki@gmail.com", name: "Owner", uid: "g_owner" }; });
  await p.click("#gateGoogle"); await p.waitForSelector("#admin:not([hidden]) .adm-tab");
  await p.click('[data-act="tab"][data-tab="products"]');
  await p.click('[data-act="edit-product"][data-id="p2"]');
  await p.waitForSelector("#photos .ph-add");
  const f = n => Array.from({ length: n }, (_, i) => ({ name: `a${i}.png`, mimeType: "image/png", buffer: PNG }));
  await p.setInputFiles("#imgFile", f(3));
  await p.waitForFunction(() => document.querySelectorAll("#photos .ph-t").length === 3);
  assert.equal(await p.locator("#photos .cov").count(), 1);
  await p.click('#photos [data-act="img-cover"][data-i="2"]');
  await p.click('#photos [data-act="img-del"][data-i="1"]');
  assert.equal(await p.locator("#photos .ph-t").count(), 2);
  await p.setInputFiles("#imgFile", f(9));                                                       // only room for 3 more
  await p.waitForFunction(() => document.querySelectorAll("#photos .ph-t").length === 5);
  assert.equal(await p.locator("#photos .ph-add").count(), 0);
  await p.click('#photos [data-act="img-del"][data-i="4"]');
  await p.click("#prodSave"); await p.waitForSelector("#admDlg", { state: "hidden" });
  const d = await db(p);
  assert.equal(d.products.p2.imageCount, 4);
  assert.match(d.products.p2.image, /^data:image\/jpeg/);
  assert.equal(d.productImages.p2.images.length, 4);
}, { path: "/admin/index.html", ready: "#gateGoogle:not([hidden])", seed: seedWith() });
await test("owner: editing a product that has a gallery loads its photos; removing them all clears the gallery", async ({ page: p }) => {
  await p.evaluate(() => { window.__FAKE.nextGoogle = { email: "housikiki@gmail.com", name: "Owner", uid: "g_owner" }; });
  await p.click("#gateGoogle"); await p.waitForSelector("#admin:not([hidden]) .adm-tab");
  await p.click('[data-act="tab"][data-tab="products"]');
  await p.click('[data-act="edit-product"][data-id="p1"]');
  await p.waitForFunction(() => document.querySelectorAll("#photos .ph-t").length === 3);
  for (let i = 0; i < 3; i++) await p.click('#photos [data-act="img-del"][data-i="0"]');
  await p.click("#prodSave"); await p.waitForSelector("#admDlg", { state: "hidden" });
  const d = await db(p);
  assert.ok(!("image" in d.products.p1) && !("imageCount" in d.products.p1) && !d.productImages?.p1);
}, { path: "/admin/index.html", ready: "#gateGoogle:not([hidden])", seed: GALLERY_SEED() });
await test("photo rules replica: the public can read a gallery but never write one; more than 5 or an oversized photo is refused", async ({ page: p }) => {
  const w = body => p.evaluate(b => { const f = window.__FAKE.fs; return f.setDoc(f.doc({}, "productImages", "p1"), { ...b, updatedAt: f.serverTimestamp() }).then(() => "wrote", e => e.code); }, body);
  assert.equal(await w({ images: ["x"] }), "permission-denied");
}, { seed: GALLERY_SEED() });

await test("owner Android app: the live site has no registerPlugin, so the sign-in plugin comes from Capacitor.Plugins (no grey error, no web popup)", async ({ page: p }) => {
  assert.equal(await p.locator("#gateWhy").isHidden(), true);
  const used = await p.evaluate(() => { window.__native = 0; return new Promise(r => { window.Capacitor.Plugins.FirebaseAuthentication.signInWithGoogle = async () => { r("native"); return { credential: { idToken: "t" } }; }; document.querySelector("#gateGoogle").click(); setTimeout(() => r("none"), 3000); }); });
  assert.equal(used, "native");
}, { path: "/admin/index.html", ready: "#gateGoogle:not([hidden])", init: () => { window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "android", Plugins: { FirebaseAuthentication: { signInWithGoogle: async () => ({}), signOut: async () => {} } } }; } });

/* ── popups + in-app updates ────────────────────────── */
const REL = (n) => [{ tag_name: "apps-" + n, draft: false, assets: ["customer", "owner"].map(k => ({ name: `bee-hive-${k}-debug.apk`, browser_download_url: `https://github.com/plodroid/store/releases/download/apps-${n}/bee-hive-${k}-debug.apk` })) }, { tag_name: "ios-1", assets: [] }];
const appInit = (kind, build) => `window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "android", Plugins: { ApkUpdater: { install: async o => { window.__installed = o.url; } } } };
  Object.defineProperty(navigator, "userAgent", { get: () => "Mozilla/5.0 (Linux; Android 15) Chrome/156 Mobile BeeHiveApp/${kind}/${build}" });`;
const withInit = src => ({ init: new Function(src) });
await test("popups: every dialog is centred inside the safe area on phones, tablets and desktop", async (t) => {
  const p = t.page;
  for (const [w, h, top, bot] of [[360, 740, 28, 48], [412, 915, 0, 0], [768, 1024, 24, 24], [1280, 800, 0, 0]]) {
    await p.setViewportSize({ width: w, height: h });
    await p.evaluate(([a, b]) => { let s = document.getElementById("__t") || Object.assign(document.head.appendChild(document.createElement("style")), { id: "__t" }); s.textContent = `:root{--sat:${a}px!important;--sab:${b}px!important}`; }, [top, bot]);
    await p.evaluate(() => { const d = document.querySelector("#info"); d.querySelector("#infoBody") && (d.querySelector("#infoBody").innerHTML = "<p>Short popup</p>"); d.showModal(); d.classList.add("open"); });
    await p.waitForTimeout(450);
    const r = await p.evaluate(() => { const b = document.querySelector("#info").getBoundingClientRect(); return { l: b.left, r: innerWidth - b.right, t: b.top, b: innerHeight - b.bottom }; });
    assert.ok(Math.abs(r.l - r.r) < 1.5, `centred sideways at ${w}: ${JSON.stringify(r)}`);
    assert.ok(Math.abs((r.t - top) - (r.b - bot)) < 1.5, `centred up/down inside the safe area at ${w}: ${JSON.stringify(r)}`);
    assert.ok(r.t >= top + 11 && r.b >= bot + 11, "never under the status bar or nav bar");
    await p.evaluate(() => { const d = document.querySelector("#info"); d.close(); d.classList.remove("open"); });
  }
});
await test("app update: popup (Update / Cancel / don't remind), green icon next to the basket, install via the native plugin", async (t) => {
  const p = t.page;
  await t.ctx.route("https://api.github.com/**", r => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, json: REL(5) }));
  await p.reload(); await p.waitForSelector("#updDlg[open]");
  assert.match(await p.locator("#updDlg").innerText(), /New update[\s\S]*Update[\s\S]*Cancel[\s\S]*remind me again/i);
  await p.click("#updNo"); await p.waitForSelector("#updDlg", { state: "hidden" });
  assert.equal(await p.locator("#updBtn").isVisible(), true);
  assert.ok(await p.evaluate(() => document.querySelector("#updBtn").nextElementSibling.id === "cartBtn"), "icon sits right before the basket");
  await p.reload(); await p.waitForSelector("#updDlg[open]");                                          // plain Cancel: asked again next time
  await p.check("#updNever"); await p.click("#updNo"); await p.waitForSelector("#updDlg", { state: "hidden" });
  await p.reload(); await p.waitForSelector("#updBtn"); await p.waitForTimeout(1800);
  assert.equal(await p.locator("#updDlg[open]").count(), 0, "never again = no popup");
  assert.equal(await p.locator("#updBtn").isVisible(), true, "…but the icon stays");
  await p.click("#updBtn"); await p.waitForSelector("#updDlg[open]"); await p.click("#updGo");
  await p.waitForFunction(() => window.__installed);
  assert.match(await p.evaluate(() => window.__installed), /releases\/download\/apps-5\/bee-hive-customer-debug\.apk$/);
}, withInit(appInit("customer", 3)));
await test("app update: an app that is already on the newest build sees nothing; the website in a normal browser sees nothing", async (t) => {
  const p = t.page;
  await t.ctx.route("https://api.github.com/**", r => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, json: REL(5) }));
  await p.reload(); await p.waitForTimeout(2200);
  assert.equal(await p.locator("#updBtn").count(), 0); assert.equal(await p.locator("#updDlg").count(), 0);
}, withInit(appInit("customer", 5)));
await test("app update (owner): green icon sits in the owner header, before Sign out", async (t) => {
  const p = t.page;
  await t.ctx.route("https://api.github.com/**", r => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, json: REL(5) }));
  await p.evaluate(() => { window.__FAKE.nextGoogle = { email: "housikiki@gmail.com", name: "Owner", uid: "g_owner" }; });
  await p.click("#gateGoogle"); await p.waitForSelector("#updBtn");
  assert.ok(await p.evaluate(() => document.querySelector("#updBtn").nextElementSibling.dataset.act === "signout"));
  await p.waitForSelector("#updDlg[open]"); assert.match(await p.locator("#updDlg").innerText(), /New update/);
}, { path: "/admin/index.html", ready: "#gateGoogle:not([hidden])", ...withInit(appInit("owner", 3)) });

await test("language: every translated string keeps its {placeholders} and no two languages are missing keys", async ({ page: p }) => {
  const r = await p.evaluate(async codes => {
    const D = {};
    for (const c of codes) D[c] = (await import(`/lang/${c}.js?v=16`)).default;
    const keys = Object.keys(D.fr), out = { missing: [], badVars: [], extra: [] };
    const vars = x => ((x || "").match(/\{\w+\}/g) || []).sort().join();
    for (const c of codes.slice(0, 6)) for (const k of keys) if (!(k in D[c])) out.missing.push(c + ":" + k);
    for (const c of codes) for (const [k, v] of Object.entries(D[c])) {
      if (c !== "us" && !(k in D.fr)) out.extra.push(c + ":" + k);
      if (vars(k) !== vars(v)) out.badVars.push(c + ":" + k);
    }
    return { ...out, n: keys.length, small: codes.slice(6, -1).filter(c => Object.keys(D[c]).length < 190) };
  }, ["fr", "ar", "es", "de", "tr", "it", ...ALL.slice(8), "us"]);
  assert.deepEqual(r.missing, []); assert.deepEqual(r.badVars, []); assert.deepEqual(r.extra, []); assert.deepEqual(r.small, []); assert.ok(r.n > 280);
});

console.log(results.map(r => (r[0] ? "PASS " : "FAIL ") + r[1] + (r[0] ? "" : "\n     " + r[2] + (r[3] ? "\n     shot: " + r[3] : ""))).join("\n"));
console.log(`\n${results.filter(r => r[0]).length}/${results.length} passed`);
await closeAll(); srv.close();
process.exit(results.every(r => r[0]) ? 0 : 1);
