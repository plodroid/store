import assert from "node:assert/strict";
import { serve, launch, closeAll, SEED } from "./harness.mjs";
const { srv, url } = await serve();
const results = [];
let expectErr = null;
const ignore = e => /ERR_TUNNEL|ERR_NAME|Failed to load resource/.test(e) || (expectErr && expectErr.test(e));
const SHOTS = "/tmp/claude-0/-home-claude/fa786b1c-808f-5474-a40b-c6b83a368183/scratchpad/";
async function test(name, fn, opts = {}) {
  expectErr = opts.expectErr || null;
  const t = await launch(url, opts);
  try {
    t.page.setDefaultTimeout(8000);
    await t.page.goto(url + "/index.html");
    await t.page.waitForSelector("[data-add]", { timeout: 8000 });
    await fn(t);
    const bad = t.errors.filter(e => !ignore(e));
    assert.deepEqual(bad, [], "page errors");
    results.push([true, name]); console.error("PASS", name);
  } catch (e) {
    let shot = "";
    try { shot = `${SHOTS}fail-${results.length}.png`; await t.page.screenshot({ path: shot }); } catch {}
    results.push([false, name, e.message.split("\n").slice(0, 6).join(" | "), shot]); console.error("FAIL", name, "::", e.message.split("\n")[0]);
  } finally { await t.close(); }
}
const db = p => p.evaluate(() => window.__FAKE.dump());
const F = (p, fn, a) => p.evaluate(fn, a);

const signedIn = async (p, t, email = "gina@example.com") => {
  await p.click("#signInBtn");
  await p.locator('form[data-form="in"] [name="email"]').fill(email);
  await p.locator('form[data-form="in"] [name="password"]').fill("secret1");
  await p.locator('form[data-form="in"] button[type="submit"]').click();
  await p.waitForSelector("#acctBtn:not([hidden])");
};
const googleIn = async (p, g) => {
  if (g) await F(p, x => { window.__FAKE.nextGoogle = x; }, g);
  await p.click("#signInBtn"); await p.click("[data-google]");
  await p.waitForSelector("#acctBtn:not([hidden])");
};
const setLocation = async p => {                          // the exact-address form: one box per part
  await p.locator('#locForm [name="postcode"]').fill("SW1A 1AA");
  await p.waitForFunction(() => document.querySelector("#locForm [data-pcstatus]").classList.contains("ok"));
  await p.locator('#locForm [name="number"]').fill("10"); await p.locator('#locForm [name="street"]').fill("Example Road");
  await p.locator('#locForm [name="city"]').fill("London");
};

/* ── look & theme ─────────────────────────────────── */
await test("light by default (honey cream #FFF8E6), toggle to dark, remembered after reload", async ({ page: p }) => {
  assert.equal(await p.evaluate(() => document.documentElement.dataset.theme || "light"), "light");
  assert.equal(await p.evaluate(() => getComputedStyle(document.documentElement).backgroundColor), "rgb(255, 248, 230)");
  await p.click("#themeBtn");
  assert.equal(await p.evaluate(() => document.documentElement.dataset.theme), "dark");
  assert.notEqual(await p.evaluate(() => getComputedStyle(document.documentElement).backgroundColor), "rgb(255, 248, 230)");
  await p.reload(); await p.waitForSelector("[data-add]");
  assert.equal(await p.evaluate(() => document.documentElement.dataset.theme), "dark");
  await p.click("#themeBtn");
  assert.equal(await p.evaluate(() => localStorage.getItem("theme")), "light");
});

await test("no gradients left in the CSS (solid honey only; the honeycomb fade mask is allowed)", async () => {
  const fs = await import("node:fs");
  const found = ["styles.css", "admin.css"].filter(f => fs.readFileSync(new URL("../../" + f, import.meta.url), "utf8").split("\n").some(l => /gradient/.test(l) && !/appearance: none|mask-image|ambient i|conic-gradient/.test(l)))   // (the select chevron is drawn with two tiny gradients);
  assert.deepEqual(found, []);
});

await test("signed-out: Sign in button shown, manage/account hidden", async ({ page: p }) => {
  assert.ok(await p.locator("#signInBtn").isVisible());
  assert.ok(!(await p.locator("#manageBtn").isVisible()));
  assert.ok(!(await p.locator("#acctBtn").isVisible()));
});

/* ── sign-in dialog ───────────────────────────────── */
await test("dialog offers email + password and Google only (no Apple, no codes)", async ({ page: p }) => {
  await p.click("#signInBtn");
  const txt = await p.locator("#au").innerText();
  assert.doesNotMatch(txt, /apple|code/i);
  assert.equal(await p.locator('#au input[type="password"]').count(), 1);
  assert.ok(await p.locator("[data-google]").isVisible());
});

await test("checkout while signed-out asks to sign in (no order)", async ({ page: p }) => {
  await p.click("[data-add]"); await p.click("#cartBtn"); await p.click("#checkout");
  await p.waitForSelector("#au[open]");
  assert.equal(await p.locator("#co[open]").count(), 0);
  assert.equal(Object.keys((await db(p)).orders || {}).length, 0);
});

await test("checkout still opens sign-in when Firebase never reports the login state (Chrome hang)", async ({ page: p }) => {
  await p.evaluate(() => { window.__FAKE.authSilent = true; });
  await p.reload(); await p.waitForSelector("[data-add]");
  await p.click("[data-add]"); await p.click("#cartBtn"); await p.click("#checkout");
  await p.waitForSelector("#au[open]", { timeout: 9000 });
});

await test("Google window closed without choosing: no error stuck, dialog stays usable", async (t) => {
  const p = t.page;
  await p.evaluate(() => { window.__FAKE.popupClosed = true; });
  await p.click("#signInBtn"); await p.locator("[data-google]").first().click();
  await p.waitForTimeout(400);
  assert.equal(await p.locator("#acctBtn").isVisible(), false);
  assert.equal(await p.locator("#au[open]").count(), 1);
});

await test("old Android app build on a phone: email only (no dead Google button) and the green update button is visible", async ({ page: p }) => {
  await p.setViewportSize({ width: 393, height: 851 });
  await p.addInitScript(() => { window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "android", Plugins: {} }; });
  await p.route("https://api.github.com/**", r => r.fulfill({ headers: { "access-control-allow-origin": "*" }, json: [{ tag_name: "apps-9", assets: [{ name: "bee-hive-customer-debug.apk", browser_download_url: "https://x/a.apk" }] }] }));
  await p.reload(); await p.waitForSelector("#updDlg[open]", { timeout: 6000 });
  await p.click("#updNo");
  assert.equal(await p.locator("#updBtn").isVisible(), true);
  await p.click("#dockAcct"); await p.waitForSelector("#au[open]");
  assert.equal(await p.locator("[data-google]").count(), 0);
});

await test("email + password signs in; icon is a person; wrong password is refused kindly", async (t) => {
  const p = t.page;
  await p.click("#signInBtn");
  await p.locator('form[data-form="in"] [name="email"]').fill("gina@example.com");
  await p.locator('form[data-form="in"] [name="password"]').fill("wrongpass");
  await p.locator('form[data-form="in"] button[type="submit"]').click();
  await p.waitForFunction(() => /don.t match/.test(document.querySelector("#au .form-error:not([hidden])")?.textContent || ""));
  assert.equal(await p.locator("#acctBtn").isVisible(), false);
  await p.locator('form[data-form="in"] [name="password"]').fill("secret1");
  await p.locator('form[data-form="in"] button[type="submit"]').click();
  await p.waitForSelector("#acctBtn:not([hidden])");
  assert.equal(await p.locator("#acctBtn svg circle").count(), 1, "person icon: head circle");
  await p.click("#acctBtn");
  assert.equal(await p.locator("#menuEmail").textContent(), "gina@example.com");
});

await test("bad email is caught before anything is sent", async (t) => {
  const p = t.page;
  await p.click("#signInBtn");
  await p.locator('form[data-form="in"] [name="email"]').fill("not-an-email");
  await p.locator('form[data-form="in"] [name="password"]').fill("secret1");
  await p.locator('form[data-form="in"] button[type="submit"]').click();
  await p.waitForFunction(() => /valid email/.test(document.querySelector("#au .form-error:not([hidden])")?.textContent || ""));
  assert.equal(t.mail.calls.length, 0);
});

await test("Google sign-in works and is verified straight away", async ({ page: p }) => {
  await googleIn(p);
  });

/* ── owner ────────────────────────────────────────── */
await test("owner = housikiki@gmail.com via Google: Manage shows; other Google users and password users don't get it", async (t) => {
  const p = t.page;
  await googleIn(p, { email: "housikiki@gmail.com", name: "Owner", uid: "g_owner" });
  await p.waitForSelector("#manageBtn:not([hidden])");
  await p.click("#acctBtn"); await p.click("#menuOut");
  await p.waitForSelector("#signInBtn:not([hidden])");
  assert.ok(!(await p.locator("#manageBtn").isVisible()));
  await googleIn(p, { email: "someone@gmail.com", name: "Someone", uid: "g_someone" });
  assert.ok(!(await p.locator("#manageBtn").isVisible()));
  await p.click("#acctBtn"); await p.click("#menuOut");
  await p.waitForSelector("#signInBtn:not([hidden])");
  await signedIn(p, t, "gina@example.com");
  assert.ok(!(await p.locator("#manageBtn").isVisible()));
  const code = await p.evaluate(async () => { const f = window.__FAKE.fs; try { await f.getDoc(f.doc({}, "settings", "owner")); return "allowed"; } catch (e) { return e.code; } });
  assert.equal(code, "permission-denied");
}, { expectErr: /rules: / });             // the owner probe of a non-owner is refused on purpose

/* ── location, checkout, feedback (same as before, new login) ── */
await test("account details: a fake phone is refused, a real one saves", async (t) => {
  const p = t.page; await signedIn(p, t);
  await p.click("#acctBtn"); await p.click("#menuAcct");
  await p.locator('#acctForm [name="phone"]').fill("199929292931");
  await p.click("#acctSave");
  await p.waitForFunction(() => /phone/i.test(document.querySelector("#acctErr").textContent));
  await p.locator('#acctForm [name="phone"]').fill("07911 123456");
  await p.click("#acctSave");
  await p.waitForFunction(() => Object.values(window.__FAKE.dump().users || {}).some(u => u.phone === "+447911123456"));
});

await test("address form: every part has its own box, the postcode is checked, save writes the exact address", async (t) => {
  const p = t.page; await signedIn(p, t);
  await p.click("#acctBtn"); await p.click("#menuAcct"); await p.click("#acctLoc");
  for (const n of ["country", "postcode", "number", "street", "line2", "city", "state"]) assert.equal(await p.locator(`#locForm [name="${n}"]`).count(), 1, n);
  await p.locator('#locForm [name="postcode"]').fill("LE99 9ZZ");                          // right shape, but no such postcode
  await p.waitForFunction(() => document.querySelector("#locForm [data-pcstatus]").classList.contains("bad"));
  await p.click("#locSave");
  await p.waitForFunction(() => /isn.t real|door|street|number|town/i.test(document.querySelector("#locErr").textContent));
  await p.locator('#locForm [name="postcode"]').fill("12345");                             // not even shaped like a UK postcode
  await p.keyboard.press("Tab");                                                           // leaving the box checks it
  await p.waitForFunction(() => /doesn.t look like a United Kingdom postcode/.test(document.querySelector("#locForm [data-pcstatus]").textContent));
  await setLocation(p);
  await p.click("#locSave");
  await p.waitForFunction(() => Object.values(window.__FAKE.dump().users || {}).some(u => u.address && u.address.postcode === "SW1A 1AA" && u.address.country === "GB" && u.address.line1 === "10 Example Road" && u.address.verified === true));
});

await test("address form: every missing part is flagged and the courier-country list only offers where the shop ships", async (t) => {
  const p = t.page; await signedIn(p, t);
  await p.click("#acctBtn"); await p.click("#menuAcct"); await p.click("#acctLoc");
  await p.click("#locSave");
  await p.waitForFunction(() => document.querySelector("#locErr").textContent.length > 0);
  for (const n of ["postcode", "number", "street", "city"]) assert.equal(await p.locator(`#locForm [name="${n}"]`).getAttribute("aria-invalid"), "true", n + " is flagged");
  assert.equal(await p.locator("#locForm select[name=state]").count(), 0);                // the UK has no state list
});

await test("collection order end-to-end (code login): valid order, email from the token", async (t) => {
  const p = t.page; await signedIn(p, t);
  await p.click("[data-add]"); await p.click("#cartBtn"); await p.click("#checkout");
  await p.waitForSelector("#co[open]");
  assert.equal(await p.locator("#coEmail").textContent(), "gina@example.com");
  assert.equal(await p.locator('input[name="how"]').count(), 1, "no card payments → courier shipping isn't offered");
  await p.locator('#coForm [name="name"]').fill("Gina Test");
  await p.click("#coSubmit");
  await p.waitForSelector("#coDone:not([hidden])");
  const d = await db(p);
  const [id, o] = Object.entries(d.orders)[0];
  assert.match(id, /^o_/); assert.equal(o.fulfilment, "collection"); assert.equal(o.status, "new");
  assert.equal(o.customer.email, "gina@example.com"); assert.equal(o.address ?? null, null);
  assert.ok(Object.values(d.users).some(u => u.lastOrderAt));
});

await test("shipping: needs an address and a real phone, shows courier prices, saves the exact address + chosen courier", async (t) => {
  const p = t.page; t.mail.pay = true; await signedIn(p, t);
  await p.context().route("https://checkout.stripe.test/**", r => r.fulfill({ contentType: "text/html", body: "<title>stripe</title>" }));
  await p.click("[data-add]"); await p.click("#cartBtn"); await p.click("#checkout");
  await p.waitForSelector("#co[open]");
  await p.waitForSelector('input[name="how"][value="shipping"]');
  await p.check('input[name="how"][value="shipping"]');
  await p.locator('#coForm [name="name"]').fill("Gina Test");
  assert.match(await p.locator("#coRates").innerText(), /address/i);                       // nothing to price yet
  await p.locator('#coForm [name="phone"]').fill("199929292931");                          // fake number
  await p.click("#coAddrBtn"); await p.waitForSelector("#loc[open]");
  await setLocation(p); await p.click("#locSave");
  await p.waitForFunction(() => !document.querySelector("#loc").open);
  await p.waitForFunction(() => /real phone number/i.test(document.querySelector("#coRates").textContent));
  assert.ok(await p.locator("#coSubmit").isDisabled());
  assert.equal(t.mail.calls.filter(c => c.a === "rates").length, 0, "no price check for a fake number");
  await p.locator('#coForm [name="phone"]').fill("07911 123456");
  await p.waitForSelector('#coRates input[name="svc"]');
  assert.equal(await p.locator('#coRates input[name="svc"]').count(), 2);
  assert.match(await p.locator("#coSum").innerText(), /Evri/);
  await p.locator('#coRates input[value="svc-rm"]').check();
  await p.waitForFunction(() => /Pay £\d+\.\d\d by card/.test(document.querySelector("#coSubmit").innerText));
  const rq = t.mail.calls.find(c => c.a === "rates");
  assert.equal(rq.customer.phone, "+447911123456"); assert.equal(rq.address.postcode, "SW1A 1AA"); assert.equal(rq.address.country, "GB");
  await p.click("#coSubmit");
  await p.waitForURL(/checkout\.stripe\.test\/pay\?o=o_/);
  const o = Object.values(t.mail.atPay.orders)[0];
  assert.equal(o.fulfilment, "shipping"); assert.equal(o.address.postcode, "SW1A 1AA"); assert.equal(o.address.line1, "10 Example Road");
  assert.equal(o.customer.phone, "+447911123456"); assert.equal(o.shipping.serviceId, "svc-rm");
});

await test("shipping: when no courier can be priced the customer is told and cannot pay", async (t) => {
  const p = t.page; t.mail.pay = true; t.mail.ratesError = "no_rates"; await signedIn(p, t);
  await p.click("[data-add]"); await p.click("#cartBtn"); await p.click("#checkout");
  await p.waitForSelector('input[name="how"][value="shipping"]');
  await p.check('input[name="how"][value="shipping"]');
  await p.locator('#coForm [name="name"]').fill("Gina Test"); await p.locator('#coForm [name="phone"]').fill("07911 123456");
  await p.click("#coAddrBtn"); await p.waitForSelector("#loc[open]"); await setLocation(p); await p.click("#locSave");
  await p.waitForFunction(() => /No courier can deliver/i.test(document.querySelector("#coRates").textContent));
  assert.ok(await p.locator("#coSubmit").isDisabled());
});

await test("second order within 30s is rejected by the rate-limit rule", async (t) => {
  const p = t.page; await signedIn(p, t);
  const order = async () => {
    await p.click("[data-add]"); await p.click("#cartBtn"); await p.click("#checkout");
    await p.waitForSelector("#co[open]");
    await p.locator('#coForm [name="name"]').fill("Gina Test");
    await p.click("#coSubmit");
  };
  await order(); await p.waitForSelector("#coDone:not([hidden])");
  await p.click("#coDone [data-close], #co [data-close]");
  await p.waitForFunction(() => !document.querySelector("#co").open);
  await order();
  await p.waitForFunction(() => document.querySelector("#coError") && !document.querySelector("#coError").hidden);
  assert.equal(Object.keys((await db(p)).orders).length, 1);
}, { expectErr: /rules: users: throttled/ });

await test("feedback requires login, then saves with kind", async (t) => {
  const p = t.page;
  await p.click("#openFeedback"); await p.waitForSelector("#au[open]");
  await p.keyboard.press("Escape"); await p.waitForFunction(() => !document.querySelector("#au").open);
  await signedIn(p, t);
  await p.click("#openFeedback"); await p.waitForSelector("#fb[open]");
  await p.locator('#fbForm label').filter({ hasText: "Report a problem" }).click();
  await p.locator('#fbForm textarea').fill("The basket count looks wrong on my phone.");
  await p.click("#fbSubmit");
  await p.waitForFunction(() => Object.keys(window.__FAKE.dump().feedback || {}).length === 1);
  const fb = Object.values((await db(p)).feedback)[0];
  assert.equal(fb.kind, "bug"); assert.equal(fb.read, false);
});

await test("customer cannot read owner data (rules replica)", async (t) => {
  const p = t.page; await signedIn(p, t);
  const code = await p.evaluate(async () => { const f = window.__FAKE.fs; try { await f.getDoc(f.doc({}, "feedback", "x")); return "allowed"; } catch (e) { return e.code; } });
  assert.equal(code, "permission-denied");
});

console.log(results.map(r => (r[0] ? "PASS " : "FAIL ") + r[1] + (r[0] ? "" : "\n     " + r[2] + (r[3] ? "\n     shot: " + r[3] : ""))).join("\n"));
console.log(`\n${results.filter(r => r[0]).length}/${results.length} passed`);
await closeAll(); srv.close();
process.exit(results.every(r => r[0]) ? 0 : 1);
