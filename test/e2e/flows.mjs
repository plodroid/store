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

/* email -> "Send code" -> type the 4 digits that the stand-in mailer "emailed" */
const askCode = async (p, email) => {
  await p.click("#signInBtn");
  await p.locator('form[data-form="in"] [name="email"]').fill(email);
  await p.locator('form[data-form="in"] button[type="submit"]').click();
  await p.locator('[data-form="code"]').waitFor({ state: "visible" });
};
const signedIn = async (p, t, email = "gina@example.com") => {
  await askCode(p, email);
  await p.locator("#otp input").first().click();
  await p.keyboard.type(t.mail.codes[email]);                    // boxes auto-advance, 4th digit submits
  await p.waitForSelector("#acctBtn:not([hidden])");
};
const googleIn = async (p, g) => {
  if (g) await F(p, x => { window.__FAKE.nextGoogle = x; }, g);
  await p.click("#signInBtn"); await p.click("[data-google]");
  await p.waitForSelector("#acctBtn:not([hidden])");
};
const setLocation = async p => {
  await p.locator('#locForm [name="postcode"]').fill("SW1A 1AA");
  await p.waitForFunction(() => document.querySelector("#locStatus").textContent.length > 0);
  await p.locator('#locForm [name="line1"]').fill("10 Example Road");
  await p.locator('#locForm [name="city"]').fill("London");
};

/* ── look & theme ─────────────────────────────────── */
await test("light by default (#F4F3EE), toggle to dark, remembered after reload", async ({ page: p }) => {
  assert.equal(await p.evaluate(() => document.documentElement.dataset.theme || "light"), "light");
  assert.equal(await p.evaluate(() => getComputedStyle(document.body).backgroundColor), "rgb(244, 243, 238)");
  await p.click("#themeBtn");
  assert.equal(await p.evaluate(() => document.documentElement.dataset.theme), "dark");
  assert.notEqual(await p.evaluate(() => getComputedStyle(document.body).backgroundColor), "rgb(244, 243, 238)");
  await p.reload(); await p.waitForSelector("[data-add]");
  assert.equal(await p.evaluate(() => document.documentElement.dataset.theme), "dark");
  await p.click("#themeBtn");
  assert.equal(await p.evaluate(() => localStorage.getItem("theme")), "light");
});

await test("no gradients left in the CSS (solid blue only)", async () => {
  const fs = await import("node:fs");
  const found = ["styles.css", "admin.css"].filter(f => fs.readFileSync(new URL("../../" + f, import.meta.url), "utf8").split("\n").some(l => /gradient/.test(l) && !/appearance: none/.test(l)))   // (the select chevron is drawn with two tiny gradients);
  assert.deepEqual(found, []);
});

await test("signed-out: Sign in button shown, manage/account hidden", async ({ page: p }) => {
  assert.ok(await p.locator("#signInBtn").isVisible());
  assert.ok(!(await p.locator("#manageBtn").isVisible()));
  assert.ok(!(await p.locator("#acctBtn").isVisible()));
});

/* ── sign-in dialog ───────────────────────────────── */
await test("dialog offers email code + Google only (no Apple, no password)", async ({ page: p }) => {
  await p.click("#signInBtn");
  const txt = await p.locator("#au").innerText();
  assert.doesNotMatch(txt, /apple/i);
  assert.equal(await p.locator('#au input[type="password"]').count(), 0);
  assert.ok(await p.locator("[data-google]").isVisible());
  assert.match(txt, /4-digit code/);
});

await test("checkout while signed-out asks to sign in (no order)", async ({ page: p }) => {
  await p.click("[data-add]"); await p.click("#cartBtn"); await p.click("#checkout");
  await p.waitForSelector("#au[open]");
  assert.equal(await p.locator("#co[open]").count(), 0);
  assert.equal(Object.keys((await db(p)).orders || {}).length, 0);
});

await test("email -> code boxes -> typing 4 digits signs in; profile gets created; icon is a person", async (t) => {
  const p = t.page;
  await askCode(p, "Gina@Example.com");
  assert.equal(t.mail.sent.length, 1);
  assert.equal(t.mail.calls[0].email, "gina@example.com");
  assert.match(await p.locator("#au").innerText(), /gina@example\.com/);
  await p.locator("#otp input").first().click();
  await p.keyboard.type(t.mail.codes["gina@example.com"]);
  await p.waitForSelector("#acctBtn:not([hidden])");
  assert.ok(!(await p.locator("#signInBtn").isVisible()));
  assert.equal(await p.locator("#acctBtn svg circle").count(), 1, "person icon: head circle");
  assert.equal(await p.locator("#acctBtn svg path").count(), 1, "person icon: shoulders");
  assert.equal((await p.locator("#acctBtn").innerText()).trim(), "");
  await p.click("#acctBtn");
  assert.equal(await p.locator("#menuEmail").textContent(), "gina@example.com");   // email comes from the token claim
});

await test("pasting the 4-digit code fills all boxes and signs in", async (t) => {
  const p = t.page;
  await askCode(p, "gina@example.com");
  await F(p, c => { const dt = new DataTransfer(); dt.setData("text", c);
    document.querySelector("#otp input").dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); }, t.mail.codes["gina@example.com"]);
  await p.waitForSelector("#acctBtn:not([hidden])");
});

await test("wrong code: shows tries left, clears the boxes; third wrong asks for a new code; resend works", async (t) => {
  const p = t.page;
  await askCode(p, "gina@example.com");
  const real = t.mail.codes["gina@example.com"], bad = real === "0000" ? "1111" : "0000";
  await p.locator("#otp input").first().click(); await p.keyboard.type(bad);
  await p.waitForFunction(() => /2 tries left/.test(document.querySelector("#au .form-error:not([hidden])")?.textContent || ""));
  assert.equal(await p.locator("#otp input").evaluateAll(b => b.map(x => x.value).join("")), "");
  assert.equal(await p.locator("#acctBtn").isVisible(), false);
  await p.keyboard.type(bad); await p.waitForTimeout(150); await p.keyboard.type(bad);
  await p.waitForFunction(() => /expired|new one/i.test(document.querySelector("#au .form-error:not([hidden])")?.textContent || ""));
  assert.ok(await p.locator("[data-resend]").isDisabled(), "resend is on a cooldown");
  await F(p, () => { document.querySelector("[data-resend]").disabled = false; });    // skip the 30s wait
  await p.click("[data-resend]");
  await p.waitForFunction(() => /new code sent/i.test(document.querySelector("#toast").textContent));
  assert.equal(t.mail.sent.length, 2);
  await p.locator("#otp input").first().click(); await p.keyboard.type(t.mail.codes["gina@example.com"]);
  await p.waitForSelector("#acctBtn:not([hidden])");
});

await test("owner's email via code is refused: tells them to use Google", async (t) => {
  const p = t.page;
  await p.click("#signInBtn");
  await p.locator('form[data-form="in"] [name="email"]').fill("housikiki@gmail.com");
  await p.locator('form[data-form="in"] button[type="submit"]').click();
  await p.waitForFunction(() => /Google/.test(document.querySelector("#au .form-error:not([hidden])")?.textContent || ""));
  assert.equal(await p.locator('[data-form="code"]').count(), 0);
});

await test("bad email is caught before anything is sent", async (t) => {
  const p = t.page;
  await p.click("#signInBtn");
  await p.locator('form[data-form="in"] [name="email"]').fill("not-an-email");
  await p.locator('form[data-form="in"] button[type="submit"]').click();
  await p.waitForFunction(() => /valid email/.test(document.querySelector("#au .form-error:not([hidden])")?.textContent || ""));
  assert.equal(t.mail.calls.length, 0);
});

await test("mailer not set up yet: friendly message, Google still offered", async (t) => {
  const p = t.page;
  await p.click("#signInBtn");
  await p.locator('form[data-form="in"] [name="email"]').fill("gina@example.com");
  await p.locator('form[data-form="in"] button[type="submit"]').click();
  await p.waitForFunction(() => /aren.t set up yet/.test(document.querySelector("#au .form-error:not([hidden])")?.textContent || ""));
  assert.ok(await p.locator("[data-google]").isVisible());
}, { mailer: false });

await test("Google sign-in works and is verified straight away", async ({ page: p }) => {
  await googleIn(p);
  assert.equal(await p.locator('[data-form="code"]').count(), 0);
});

/* ── owner ────────────────────────────────────────── */
await test("owner = housikiki@gmail.com via Google: Manage shows; other Google users and code users don't get it", async (t) => {
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
await test("postcode: unknown → invalid, real → accepted; save writes the address", async (t) => {
  const p = t.page; await signedIn(p, t);
  await p.click("#acctBtn"); await p.click("#menuAcct"); await p.click("#acctLoc");
  await p.locator('#locForm [name="postcode"]').fill("LE99 9ZZ");
  await p.waitForFunction(() => /couldn.t find|invalid|not a real|doesn.t exist|unknown/i.test(document.querySelector("#locStatus").textContent));
  assert.ok(await p.locator("#locSave").isDisabled());
  await setLocation(p);
  await p.waitForFunction(() => document.querySelector("#locStatus").classList.contains("ok"));
  await p.click("#locSave");
  await p.waitForFunction(() => Object.values(window.__FAKE.dump().users || {}).some(u => u.address && u.address.postcode === "SW1A 1AA" && u.address.verified === true));
});

await test("town that doesn't match the postcode gets a soft warning (still saveable)", async (t) => {
  const p = t.page; await signedIn(p, t);
  await p.click("#acctBtn"); await p.click("#menuAcct"); await p.click("#acctLoc");
  await p.locator('#locForm [name="postcode"]').fill("SW1A 1AA");
  await p.locator('#locForm [name="line1"]').fill("10 Example Road");
  await p.locator('#locForm [name="city"]').fill("Manchester");
  await p.waitForFunction(() => /double-check your town/i.test(document.querySelector("#locStatus").textContent));
  assert.ok(await p.locator("#locSave").isEnabled());
});

await test("collection order end-to-end (code login): valid order, email from the token", async (t) => {
  const p = t.page; await signedIn(p, t);
  await p.click("[data-add]"); await p.click("#cartBtn"); await p.click("#checkout");
  await p.waitForSelector("#co[open]");
  assert.equal(await p.locator("#coEmail").textContent(), "gina@example.com");
  assert.equal(await p.locator('input[name="how"]').count(), 2);
  await p.locator('#coForm [name="name"]').fill("Gina Test");
  await p.click("#coSubmit");
  await p.waitForSelector("#coDone:not([hidden])");
  const d = await db(p);
  const [id, o] = Object.entries(d.orders)[0];
  assert.match(id, /^o_/); assert.equal(o.fulfilment, "collection"); assert.equal(o.status, "new");
  assert.equal(o.customer.email, "gina@example.com"); assert.equal(o.address ?? null, null);
  assert.ok(Object.values(d.users).some(u => u.lastOrderAt));
});

await test("delivery without an address is blocked; with address succeeds", async (t) => {
  const p = t.page; await signedIn(p, t);
  await p.click("[data-add]"); await p.click("#cartBtn"); await p.click("#checkout");
  await p.waitForSelector("#co[open]");
  await p.check('input[name="how"][value="delivery"]');
  await p.locator('#coForm [name="name"]').fill("Gina Test");
  await p.locator('#coForm [name="phone"]').fill("07123 456789");
  await p.click("#coSubmit");
  await p.waitForFunction(() => /location/i.test(document.querySelector("#coError").textContent));
  assert.equal(Object.keys((await db(p)).orders || {}).length, 0);
  await p.click("#coAddrBtn"); await p.waitForSelector("#loc[open]");
  await setLocation(p); await p.click("#locSave");
  await p.waitForFunction(() => !document.querySelector("#loc").open);
  await p.click("#coSubmit");
  await p.waitForSelector("#coDone:not([hidden])");
  const o = Object.values((await db(p)).orders)[0];
  assert.equal(o.fulfilment, "delivery"); assert.equal(o.address.postcode, "SW1A 1AA"); assert.equal(o.customer.phone, "+447123456789");
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
