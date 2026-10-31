/* Scrolling bar, order progress bar, postcode → street, live map + directions, language dropdown. */
import assert from "node:assert/strict";
import { serve, launch, closeAll, SEED } from "./harness.mjs";
const { srv, url } = await serve();
const results = [];
const T = { __ts: 1700000100000 };
const SHOTS = "/tmp/claude-0/-home-claude/fa786b1c-808f-5474-a40b-c6b83a368183/scratchpad/";
const ignore = e => /ERR_TUNNEL|ERR_NAME|Failed to load resource|ERR_FAILED/.test(e);
const seedWith = (extra = {}, site = {}) => ({ ...SEED, settings: { site: { ...SEED.settings.site, ...site } }, ...extra });

/* the free map services, answered locally so the test never touches the internet */
const ROUTE = { code: "Ok", routes: [{ distance: 3200, duration: 540, geometry: { coordinates: [[-0.15, 51.51], [-0.145, 51.505], [-0.14, 51.5]] },
  legs: [{ steps: [
    { distance: 1200, name: "Pall Mall", maneuver: { type: "depart", modifier: "straight", location: [-0.15, 51.51] } },
    { distance: 2000, name: "The Mall", maneuver: { type: "turn", modifier: "right", location: [-0.145, 51.505] } },
    { distance: 0, name: "", maneuver: { type: "arrive", location: [-0.14, 51.5] } }] }] }] };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
async function mockNet(ctx, { street = { road: "Thoresby Street", suburb: "North Evington", city: "Leicester" } } = {}) {
  const calls = { nominatim: [], osrm: 0 };
  const h = { "access-control-allow-origin": "*" };
  await ctx.route("https://nominatim.openstreetmap.org/**", r => {
    const u = new URL(r.request().url()); calls.nominatim.push(u.pathname);
    if (u.pathname === "/reverse") return r.fulfill({ status: 200, headers: h, json: { address: street } });
    return r.fulfill({ status: 200, headers: h, json: [{ lat: "51.5005", lon: "-0.1405" }] });
  });
  await ctx.route("https://router.project-osrm.org/**", r => { calls.osrm++; r.fulfill({ status: 200, headers: h, json: ROUTE }); });
  await ctx.route(/tile\.openstreetmap\.org|basemaps\.cartocdn\.com/, r => r.fulfill({ status: 200, contentType: "image/png", headers: h, body: PNG }));
  return calls;
}

async function test(name, fn, { seed = seedWith(), viewport, path = "/index.html", ready = "[data-add]", geo, init } = {}) {
  const t = await launch(url, { seed, viewport });
  try {
    t.page.setDefaultTimeout(8000);
    t.net = await mockNet(t.ctx);
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
const db = p => p.evaluate(() => window.__FAKE.dump());
const signedIn = async (p, t, email = "gina@example.com") => {
  await p.click("#signInBtn");
  await p.locator('form[data-form="in"] [name="email"]').fill(email);
  await p.locator('form[data-form="in"] button[type="submit"]').click();
  await p.locator('[data-form="code"]').waitFor({ state: "visible" });
  await p.locator("#otp input").first().click();
  await p.keyboard.type(t.mail.codes[email]);
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
  if (how === "delivery") {
    await p.locator('#coForm [name="phone"]').fill("07123 456789");
    await p.click("#coAddrBtn"); await p.waitForSelector("#loc[open]");
    await p.locator('#locForm [name="postcode"]').fill("SW1A 1AA");
    await p.waitForFunction(() => document.querySelector("#locStatus").classList.contains("ok"));
    await p.waitForFunction(() => document.querySelector('#locForm [name="line1"]').value.length > 0);
    await p.locator('#locForm [name="number"]').fill("10"); await p.locator('#locForm [name="line1"]').fill("Example Road");
    await p.click("#locSave"); await p.waitForFunction(() => !document.querySelector("#loc").open);
  }
  await p.click("#coSubmit"); await p.waitForSelector("#coDone:not([hidden])");
  await p.keyboard.press("Escape");
  const d = await db(p); const id = Object.keys(d.orders)[0];
  return { id, order: d.orders[id] };
};
const setStatus = (p, id, over) => p.evaluate(([id, over]) => { const o = window.__FAKE.dump().orders[id]; window.__FAKE.inject("orders", id, { ...o, ...over }); }, [id, over]);
const steps = p => p.locator("#moList .trk li span").allInnerTexts();
const states = p => p.locator("#moList .trk li").evaluateAll(l => l.map(x => x.dataset.s));
await test("order bar: delivery has Confirmed & paid › Preparing › On its way › Outside › Delivered and follows the status", async (t) => {
  const p = t.page; const { id } = await orderFlow(t, "delivery");
  await p.click("#acctBtn"); await p.click("#menuOrders"); await p.waitForSelector("#moList .trk");
  assert.deepEqual(await steps(p), ["Confirmed", "Preparing", "On its way", "Outside", "Delivered"]);
  assert.deepEqual(await states(p), ["todo", "todo", "todo", "todo", "todo"]);                       // not confirmed yet
  await setStatus(p, id, { status: "confirmed", paymentStatus: "paid" });
  await p.waitForFunction(() => document.querySelector("#moList .trk li span").textContent === "Confirmed & paid");
  assert.deepEqual(await states(p), ["now", "todo", "todo", "todo", "todo"]);
  await setStatus(p, id, { status: "ontheway" });
  await p.waitForFunction(() => document.querySelectorAll("#moList .trk li[data-s=done]").length === 2);
  assert.deepEqual(await states(p), ["done", "done", "now", "todo", "todo"]);
  await setStatus(p, id, { status: "arrived" });
  await p.waitForFunction(() => document.querySelector("#moList .trk li:nth-child(5)") && document.querySelectorAll("#moList .trk li[data-s=done]").length === 3);
  await setStatus(p, id, { status: "completed" });
  await p.waitForFunction(() => document.querySelectorAll("#moList .trk li[data-s=done]").length === 5);
  assert.match(await p.locator("#moList .trk").getAttribute("aria-label"), /Step 5 of 5: Delivered/);
});
await test("order bar: pick-up has its own steps; a cancelled order has no bar", async (t) => {
  const p = t.page; const { id } = await orderFlow(t, "collection");
  await p.click("#acctBtn"); await p.click("#menuOrders"); await p.waitForSelector("#moList .trk");
  assert.deepEqual(await steps(p), ["Confirmed", "Preparing", "Ready to collect", "Collected"]);
  await setStatus(p, id, { status: "cancelled" });
  await p.waitForFunction(() => !document.querySelector("#moList .trk"));
});

/* ── postcode → street + town ────────────────────────── */
await test("postcode: typing a postcode fills the street and town, asks for the house number, and never overwrites typing", async (t) => {
  const p = t.page; await signedIn(p, t);
  await p.click("[data-add]"); await p.click("#cartBtn"); await p.click("#checkout"); await p.waitForSelector("#co[open]");
  await p.check('input[name="how"][value="delivery"]'); await p.click("#coAddrBtn"); await p.waitForSelector("#loc[open]");
  await p.locator('#locForm [name="postcode"]').fill("SW1A 1AA");
  await p.waitForFunction(() => document.querySelector('#locForm [name="line1"]').value === "Thoresby Street");
  assert.equal(await p.locator('#locForm [name="city"]').inputValue(), "Leicester");
  assert.match(await p.locator("#locStatus").innerText(), /add your door number so the shop knows where to knock/i);
  assert.equal(await p.evaluate(() => document.activeElement.name), "number");                    // cursor waits in the door-number box
  await p.keyboard.type("1");
  assert.equal(await p.locator('#locForm [name="number"]').inputValue(), "1");
  assert.equal(await p.locator('#locForm [name="line1"]').inputValue(), "Thoresby Street");
  await p.locator('#locForm [name="postcode"]').fill("EH1 1YZ"); await p.waitForTimeout(900);
  assert.equal(await p.locator('#locForm [name="number"]').inputValue(), "1", "what he typed stays");
  assert.equal(await p.locator('#locForm [name="line1"]').inputValue(), "Thoresby Street", "street stays");
});

/* ── customer live map ───────────────────────────────── */
const ADDR = { line1: "10 Example Road", line2: "", city: "London", postcode: "SW1A 1AA", lat: 51.5, lng: -0.14, verified: true };
await test("live map: shows only while on its way; the van appears from the shop's shared position and ETA is worked out", async (t) => {
  const p = t.page; const { id } = await orderFlow(t, "delivery");
  await p.click("#acctBtn"); await p.click("#menuOrders"); await p.waitForSelector("#moList .trk");
  assert.equal(await p.locator("#moList .mo-map").count(), 0);                                   // not out yet: no map
  await setStatus(p, id, { status: "ontheway", paymentStatus: "paid", address: ADDR });
  await p.waitForSelector("#moList .mo-map .leaflet-container");
  assert.match(await p.locator(".mo-map-cap").innerText(), /will share its live position/);
  await p.evaluate(id => window.__FAKE.inject("tracking", id, { lat: 51.51, lng: -0.15, updatedAt: { __ts: Date.now() } }), id);
  await p.waitForFunction(() => /is about 9 min away/.test(document.querySelector(".mo-map-cap").textContent));
  assert.ok(await p.locator(".mo-map .pin-van, .mo-map .leaflet-marker-icon").count() >= 2);   // destination + van
  assert.ok(t.net.osrm >= 1);
  await setStatus(p, id, { status: "arrived" });
  await p.waitForFunction(() => /has arrived/.test(document.querySelector(".mo-map-cap").textContent));
  await setStatus(p, id, { status: "completed" });
  await p.waitForFunction(() => !document.querySelector("#moList .mo-map"));
});
await test("live map: an old shared position (over 3 minutes) is treated as not live", async (t) => {
  const p = t.page; const { id } = await orderFlow(t, "delivery");
  await p.click("#acctBtn"); await p.click("#menuOrders"); await p.waitForSelector("#moList .trk");
  await setStatus(p, id, { status: "ontheway", address: ADDR });
  await p.waitForSelector("#moList .mo-map .leaflet-container");
  await p.evaluate(id => window.__FAKE.inject("tracking", id, { lat: 51.51, lng: -0.15, updatedAt: { __ts: Date.now() - 10 * 60 * 1000 } }), id);
  await p.waitForTimeout(600);
  assert.match(await p.locator(".mo-map-cap").innerText(), /will share its live position/);
});
await test("tracking rules replica: only the owner and that order's customer can read; only the owner writes", async (t) => {
  const p = t.page; const { id } = await orderFlow(t, "delivery");
  const ask = (col, doc) => p.evaluate(([col, doc]) => new Promise(res => { const f = window.__FAKE.fs; f.onSnapshot(f.doc({}, col, doc), () => res("allowed"), e => res(e.code)); }), [col, doc]);
  await p.evaluate(id => window.__FAKE.inject("tracking", id, { lat: 51.5, lng: -0.1, updatedAt: { __ts: Date.now() } }), id);
  assert.equal(await ask("tracking", id), "allowed");               // his own order
  assert.equal(await ask("tracking", "someone_elses_order"), "permission-denied");
  const w = await p.evaluate(id => { const f = window.__FAKE.fs; return f.setDoc(f.doc({}, "tracking", id), { lat: 1, lng: 1, updatedAt: f.serverTimestamp() }).then(() => "wrote", e => e.code); }, id);
  assert.equal(w, "permission-denied");
});

/* ── owner: directions ───────────────────────────────── */
const DELIVERY = (o = {}) => ({ uid: "cust1", ref: "BH-ABC123", requestId: "abc12345", status: "confirmed", paymentStatus: "paid", isTest: true, fulfilment: "delivery",
  items: [{ productId: "p1", qty: 2, name: "Medjool Dates 500g" }], customer: { name: "Gina Test", phone: "+447123456789", email: "gina@example.com" }, note: "", estTotal: 13, total: 13,
  address: ADDR, createdAt: T, updatedAt: T, ...o });
const ownerOpen = async p => {
  await p.evaluate(() => { window.__FAKE.nextGoogle = { email: "housikiki@gmail.com", name: "Owner", uid: "g_owner" }; });
  await p.click("#gateGoogle"); await p.waitForSelector("#admin:not([hidden]) .adm-tab");
  await p.click('[data-act="tab"][data-tab="orders"]');
};
await test("owner: order card shows the progress bar and a Directions button for delivery only", async ({ page: p }) => {
  await ownerOpen(p);
  const cards = p.locator('[data-act="open-order"]');
  await p.waitForSelector(".trk");
  assert.equal(await p.locator('[data-act="nav-order"]').count(), 1);                              // the pick-up order has none
  assert.match(await p.locator('[data-act="nav-order"]').innerText(), /Directions to SW1A 1AA/);
}, { path: "/admin/index.html", ready: "#gateGoogle:not([hidden])", seed: seedWith({ orders: { o1: DELIVERY(), o2: DELIVERY({ fulfilment: "collection", address: undefined, ref: "BH-PICKUP" }) } }) });
await test("owner: directions screen finds the route, shows the next turn + ETA, shares his position, advances the order and stops sharing", async (t) => {
  const p = t.page; await ownerOpen(p);
  await p.click('[data-act="nav-order"]');
  await p.waitForSelector(".nav-panel .leaflet-container");
  await p.waitForFunction(() => /Pall Mall|Head out|Turn right|Continue/.test(document.querySelector("#navNext").textContent));
  assert.match(await p.locator("#navEta").innerText(), /\d+ min/);
  assert.match(await p.locator(".nav-where").innerText(), /SW1A 1AA/);
  assert.match(await p.locator("#navG").getAttribute("href"), /google\.com\/maps/);
  assert.equal(await p.locator("#navShare").isChecked(), false);                                      // desktop: sharing starts off
  assert.ok(!((await db(p)).tracking || {}).o1, "nothing shared until he switches it on");
  await p.check("#navShare");
  await p.waitForFunction(() => window.__FAKE.dump().tracking && window.__FAKE.dump().tracking.o1);   // position shared (order is on its way)
  const tr = (await db(p)).tracking.o1; assert.ok(Math.abs(tr.lat - 51.51) < 0.001 && Math.abs(tr.lng + 0.15) < 0.001);
  // the primary button moves the order along
  await p.waitForSelector("#navAct:not([hidden])");
  await p.click("#navAct");
  await p.waitForFunction(() => window.__FAKE.dump().orders.o1.status !== "ontheway");
  // turning sharing off removes the position straight away
  await p.uncheck("#navShare");
  await p.waitForFunction(() => !(window.__FAKE.dump().tracking || {}).o1);
  await p.check("#navShare");
  await p.waitForFunction(() => (window.__FAKE.dump().tracking || {}).o1);
  // when the order is finished nobody is tracked any more
  await p.evaluate(() => window.__FAKE.inject("orders", "o1", { ...window.__FAKE.dump().orders.o1, status: "delivered" }));
  await p.waitForFunction(() => !(window.__FAKE.dump().tracking || {}).o1);
  await p.click("#navClose");
  await p.waitForFunction(() => !document.querySelector(".nav-panel"));
}, { path: "/admin/index.html", ready: "#gateGoogle:not([hidden])", geo: { latitude: 51.51, longitude: -0.15 }, seed: seedWith({ orders: { o1: DELIVERY({ status: "ontheway" }) } }) });
await test("owner: if the phone can't share its position, he is told and Google Maps still works", async (t) => {
  const p = t.page; await ownerOpen(p);
  await p.click('[data-act="nav-order"]');
  await p.waitForSelector(".nav-panel");
  await p.waitForFunction(() => document.querySelector("#navNote").textContent.length > 0);
  assert.match(await p.locator("#navG").getAttribute("href"), /google\.com\/maps/);
  await p.click("#navClose");
}, { path: "/admin/index.html", ready: "#gateGoogle:not([hidden])", seed: seedWith({ orders: { o1: DELIVERY() } }) });

/* ── door number ─────────────────────────────────────── */
await test("door number: its own required box; saved address reads '10 Example Road'", async (t) => {
  const p = t.page; await signedIn(p, t);
  await p.click("[data-add]"); await p.click("#cartBtn"); await p.click("#checkout"); await p.waitForSelector("#co[open]");
  await p.check('input[name="how"][value="delivery"]'); await p.click("#coAddrBtn"); await p.waitForSelector("#loc[open]");
  await p.locator('#locForm [name="postcode"]').fill("SW1A 1AA");
  await p.waitForFunction(() => document.querySelector('#locForm [name="line1"]').value.length > 0);
  assert.equal(await p.locator("#locSave").isDisabled(), true, "no door number, no save");
  await p.locator('#locForm [name="number"]').fill("10");
  await p.waitForFunction(() => !document.querySelector("#locSave").disabled);
  await p.locator('#locForm [name="line1"]').fill("Example Road");
  await p.click("#locSave"); await p.waitForSelector("#loc", { state: "hidden" });
  const a = (await db(p)).users; const addr = Object.values(a)[0].address; assert.equal(addr.line1, "10 Example Road");
  await p.click("#coAddrBtn"); await p.waitForSelector("#loc[open]");                       // reopening splits it back into the two boxes
  assert.equal(await p.locator('#locForm [name="number"]').inputValue(), "10");
  assert.equal(await p.locator('#locForm [name="line1"]').inputValue(), "Example Road");
});

/* ── owner: deliveries map + automatic location sharing ── */
const signOwner = async p => { await p.evaluate(() => { window.__FAKE.nextGoogle = { email: "housikiki@gmail.com", name: "Owner", uid: "g_owner" }; }); await p.click("#gateGoogle"); await p.waitForSelector("#admin:not([hidden]) .adm-tab"); };
const TWO = () => ({ o1: DELIVERY({ status: "preparing" }), o2: DELIVERY({ ref: "BH-SECOND", status: "confirmed", customer: { name: "Sam Second", phone: "07000", email: "s@example.com" }, address: { ...ADDR, line1: "12 Other Road", lat: 51.52, lng: -0.12 } }), o3: DELIVERY({ ref: "BH-PICKUP", fulfilment: "collection", address: undefined }) });
await test("owner: Today has a big deliveries map with numbered pins, chips and one big button that opens the directions", async ({ page: p }) => {
  await signOwner(p);
  await p.waitForSelector(".dm .leaflet-container");
  assert.equal(await p.locator(".dm .dm-pin").count(), 2, "only the delivery orders are pinned");
  assert.equal(await p.locator(".dm .dm-chip").count(), 2);
  const box = await p.locator(".dm-map").boundingBox(); assert.ok(box.height >= 220, "map is big: " + box.height);
  const btn = await p.locator(".dm-go").boundingBox(); assert.ok(btn.height >= 48, "button is big: " + btn.height);
  await p.locator(".dm-chip").nth(1).click();
  assert.equal(await p.locator(".dm-chip").nth(1).getAttribute("aria-selected"), "true");
  assert.match(await p.locator(".dm-go").innerText(), /Start directions · 12 Other Road, SW1A 1AA/);
  await p.click(".dm-go"); await p.waitForSelector(".nav-panel .leaflet-container");
  assert.match(await p.locator(".nav-where").innerText(), /12 Other Road/);
}, { path: "/admin/index.html", ready: "#gateGoogle:not([hidden])", seed: seedWith({ orders: TWO() }) });
await test("owner: no delivery out → no map and nothing tracked; stale position docs are cleaned up", async ({ page: p }) => {
  await signOwner(p);
  await p.waitForFunction(() => !(window.__FAKE.dump().tracking || {}).stale);
  assert.equal(await p.locator(".dm").count(), 0);
}, { path: "/admin/index.html", ready: "#gateGoogle:not([hidden])", seed: seedWith({ orders: { o3: DELIVERY({ ref: "BH-PICKUP", fulfilment: "collection", address: undefined }) }, tracking: { stale: { lat: 1, lng: 1, updatedAt: { __ts: Date.now() } } } }) });
await test("owner: location is only shared while a delivery is on its way, and stops by itself", async (t) => {
  const p = t.page;
  await p.evaluate(() => localStorage.setItem("shareLoc", "1")); await p.reload(); await p.waitForSelector("#gateGoogle:not([hidden])");
  await signOwner(p);
  await p.waitForSelector(".locbar");
  await p.waitForTimeout(500);
  assert.ok(!((await db(p)).tracking || {}).o1, "confirmed: nobody is tracked");
  await p.evaluate(() => window.__FAKE.inject("orders", "o1", { ...window.__FAKE.dump().orders.o1, status: "ontheway" }));
  await p.waitForFunction(() => (window.__FAKE.dump().tracking || {}).o1);
  const tr = (await db(p)).tracking.o1; assert.ok(Math.abs(tr.lat - 51.51) < 0.001);
  assert.match(await p.locator(".locbar").innerText(), /Sharing your location/);
  await p.click('[data-act="loc-off"]');                                                    // pause
  await p.waitForFunction(() => !(window.__FAKE.dump().tracking || {}).o1);
  await p.click('[data-act="loc-on"]');
  await p.waitForFunction(() => (window.__FAKE.dump().tracking || {}).o1);
  await p.evaluate(() => window.__FAKE.inject("orders", "o1", { ...window.__FAKE.dump().orders.o1, status: "delivered" }));
  await p.waitForFunction(() => !(window.__FAKE.dump().tracking || {}).o1);
  assert.match(await p.locator(".locbar").innerText(), /only shared while a delivery is on its way/);
}, { path: "/admin/index.html", ready: "#gateGoogle:not([hidden])", geo: { latitude: 51.51, longitude: -0.15 }, seed: seedWith({ orders: { o1: DELIVERY({ status: "confirmed" }) } }) });
await test("owner: when location is blocked he is told how to fix it", async ({ page: p }) => {
  await p.evaluate(() => localStorage.setItem("shareLoc", "1")); await p.reload(); await p.waitForSelector("#gateGoogle:not([hidden])");
  await signOwner(p);
  await p.waitForSelector(".locbar");
  assert.match(await p.locator(".locbar").innerText(), /Location is blocked|Let customers see you|Allow location/);
}, { path: "/admin/index.html", ready: "#gateGoogle:not([hidden])", seed: seedWith({ orders: { o1: DELIVERY({ status: "ontheway" }) } }) });

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
}, { path: "/admin/index.html", ready: "#gateGoogle:not([hidden])", viewport: { width: 390, height: 844 }, init: IOS, seed: seedWith({ orders: { o1: DELIVERY({ status: "ontheway" }) } }) });

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
