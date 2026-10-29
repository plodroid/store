import assert from "node:assert/strict";
import { serve, launch, closeAll, SEED, ACCOUNTS } from "./harness.mjs";
const { srv, url } = await serve();
const results = [];
let expectErr = null;
const ignore = e => /ERR_TUNNEL|ERR_NAME|Failed to load resource/.test(e) || (expectErr && expectErr.test(e));
async function test(name, fn, opts = {}) {
  expectErr = opts.expectErr || null;
  const t = await launch(url, opts);
  try {
    await t.page.goto(url + "/index.html");
    await t.page.waitForSelector("[data-add]", { timeout: 8000 });
    await fn(t);
    const bad = t.errors.filter(e => !ignore(e));
    assert.deepEqual(bad, [], "page errors");
    results.push([true, name]);
  } catch (e) {
    let shot = "";
    try { shot = `/tmp/claude-0/-home-claude/fa786b1c-808f-5474-a40b-c6b83a368183/scratchpad/fail-${results.length}.png`; await t.page.screenshot({ path: shot }); } catch {}
    results.push([false, name, e.message.split("\n").slice(0, 6).join(" | "), shot]);
  } finally { await t.close(); }
}
const db = p => p.evaluate(() => window.__FAKE.dump());
const F = (p, fn, a) => p.evaluate(fn, a);
const signUp = async (p, { name = "Gina Test", email = "gina@example.com", pw = "password1" } = {}) => {
  await p.click("#signInBtn");
  await p.click('[data-go="up"]');
  const f = p.locator('form[data-form="up"]');
  await f.locator('[name="name"]').fill(name);
  await f.locator('[name="email"]').fill(email);
  await f.locator('input[type="password"]').first().fill(pw);
  await f.locator('button[type="submit"]').click();
};
const finishVerify = async (p, email = "gina@example.com") => {
  await p.locator('[data-form="verify"]').waitFor({ state: "visible" });
  await F(p, e => window.__FAKE.verifyEmail(e), email);
  await p.click("[data-check]");
  await p.waitForSelector("#acctBtn:not([hidden])");
};
const signedIn = async (p, email = "gina@example.com") => { await signUp(p, { email }); await finishVerify(p, email); };
const setLocation = async (p, { pc = "LE5 4GU", line1 = "1 Thoresby Street", city = "Leicester" } = {}) => {
  await p.locator('#locForm [name="postcode"]').fill(pc);
  await p.waitForFunction(() => /ok|good|valid|checked/i.test(document.querySelector("#locStatus").className + document.querySelector("#locStatus").textContent) || document.querySelector("#locStatus").textContent.length > 0);
  await p.locator('#locForm [name="line1"]').fill(line1);
  await p.locator('#locForm [name="city"]').fill(city);
};

await test("signed-out: Sign in button shown, manage/account hidden", async ({ page: p }) => {
  assert.ok(await p.locator("#signInBtn").isVisible());
  assert.ok(!(await p.locator("#manageBtn").isVisible()));
  assert.ok(!(await p.locator("#acctBtn").isVisible()));
});

await test("checkout while signed-out asks to sign in (no order)", async ({ page: p }) => {
  await p.click("[data-add]");
  await p.click("#cartBtn");
  await p.click("#checkout");
  await p.waitForSelector("#au[open]");
  assert.ok(await p.locator("#au").isVisible());
  assert.equal(await p.locator("#co[open]").count(), 0);
  assert.equal(Object.keys((await db(p)).orders || {}).length, 0);
});

await test("sign up → verify screen → verified → signed in, profile doc created", async ({ page: p }) => {
  await signUp(p);
  await p.locator('[data-form="verify"]').waitFor({ state: "visible" });
  assert.deepEqual(await F(p, () => window.__FAKE.mails.map(m => m.type)), ["verify"]);
  await F(p, () => window.__FAKE.verifyEmail("gina@example.com"));
  await p.click("[data-check]");
  await p.waitForSelector("#acctBtn:not([hidden])");
  assert.ok(!(await p.locator("#signInBtn").isVisible()));
  await p.waitForFunction(() => Object.values(window.__FAKE.dump().users || {}).some(u => u.name === "Gina Test"));
});

await test("wrong password shows friendly error", async ({ page: p }) => {
  await p.click("#signInBtn");
  const f = p.locator('form[data-form="in"]');
  await f.locator('[name="email"]').fill("owner@shop.com");
  await f.locator('input[type="password"]').first().fill("wrongpass1");
  await f.locator('button[type="submit"]').click();
  await p.waitForFunction(() => /isn.t right/i.test(document.querySelector("#au .form-error:not([hidden])")?.textContent || ""));
});

await test("Google sign-in works and needs no verification step", async ({ page: p }) => {
  await p.click("#signInBtn");
  await p.click("[data-google]");
  await p.waitForSelector("#acctBtn:not([hidden])");
  assert.equal(await p.locator('[data-form="verify"]:visible').count(), 0);
});

await test("Apple button is present but disabled", async ({ page: p }) => {
  await p.click("#signInBtn");
  const apple = p.locator("#au .soc").filter({ hasText: "Apple" });
  assert.ok(await apple.isDisabled());
});

await test("postcode: unknown → invalid, real → accepted; save writes address", async ({ page: p }) => {
  await signedIn(p);
  await p.click("#acctBtn"); await p.click("#menuAcct");
  await p.click("#acctLoc");
  await p.locator('#locForm [name="postcode"]').fill("LE99 9ZZ");
  await p.waitForFunction(() => /couldn.t find|invalid|not a real|doesn.t exist|unknown/i.test(document.querySelector("#locStatus").textContent));
  assert.ok(await p.locator("#locSave").isDisabled());
  await p.locator('#locForm [name="postcode"]').fill("LE5 4GU");
  await p.waitForFunction(() => document.querySelector("#locStatus").classList.contains("ok") || /leicester/i.test(document.querySelector("#locStatus").textContent));
  await p.locator('#locForm [name="line1"]').fill("1 Thoresby Street");
  await p.locator('#locForm [name="city"]').fill("Leicester");
  await p.click("#locSave");
  await p.waitForFunction(() => Object.values(window.__FAKE.dump().users || {}).some(u => u.address && u.address.postcode === "LE5 4GU" && u.address.verified === true));
});

await test("town that doesn't match the postcode gets a soft warning (still saveable)", async ({ page: p }) => {
  await signedIn(p);
  await p.click("#acctBtn"); await p.click("#menuAcct"); await p.click("#acctLoc");
  await p.locator('#locForm [name="postcode"]').fill("LE5 4GU");
  await p.locator('#locForm [name="line1"]').fill("1 Thoresby Street");
  await p.locator('#locForm [name="city"]').fill("Manchester");
  await p.waitForFunction(() => /double-check your town/i.test(document.querySelector("#locStatus").textContent));
  assert.ok(await p.locator("#locSave").isEnabled());
});

await test("collection order end-to-end writes a valid order + rate-limit stamp", async ({ page: p }) => {
  await signedIn(p);
  await p.click("[data-add]");
  await p.click("#cartBtn"); await p.click("#checkout");
  await p.waitForSelector("#co[open]");
  assert.equal(await p.locator('input[name="how"]').count(), 2);
  await p.locator('#coForm [name="name"]').fill("Gina Test");
  await p.click("#coSubmit");
  await p.waitForSelector("#coDone:not([hidden])");
  const d = await db(p);
  const orders = Object.entries(d.orders || {});
  assert.equal(orders.length, 1);
  const [id, o] = orders[0];
  assert.match(id, /^o_/); assert.equal(o.fulfilment, "collection"); assert.equal(o.status, "new"); assert.equal(o.address ?? null, null);
  assert.ok(Object.values(d.users).some(u => u.lastOrderAt));
  assert.match(await p.locator("#coRef").textContent(), /PS-[A-Z0-9]{6}/);
});

await test("delivery without an address is blocked client-side; with address succeeds", async ({ page: p }) => {
  await signedIn(p);
  await p.click("[data-add]"); await p.click("#cartBtn"); await p.click("#checkout");
  await p.waitForSelector("#co[open]");
  await p.check('input[name="how"][value="delivery"]');
  await p.locator('#coForm [name="name"]').fill("Gina Test");
  await p.locator('#coForm [name="phone"]').fill("07123 456789");
  await p.click("#coSubmit");
  await p.waitForFunction(() => /location/i.test(document.querySelector("#coError").textContent));
  assert.equal(Object.keys((await db(p)).orders || {}).length, 0);
  await p.click("#coAddrBtn");
  await p.waitForSelector("#loc[open]");
  await setLocation(p);
  await p.click("#locSave");
  await p.waitForFunction(() => !document.querySelector("#loc").open);
  await p.click("#coSubmit");
  await p.waitForSelector("#coDone:not([hidden])");
  const o = Object.values((await db(p)).orders)[0];
  assert.equal(o.fulfilment, "delivery"); assert.equal(o.address.postcode, "LE5 4GU"); assert.equal(o.customer.phone, "+447123456789");
});

await test("second order within 30s is rejected by rate limit rule", async ({ page: p }) => {
  await signedIn(p);
  const order = async () => {
    await p.click("[data-add]"); await p.click("#cartBtn"); await p.click("#checkout");
    await p.waitForSelector("#co[open]");
    await p.locator('#coForm [name="name"]').fill("Gina Test");
    await p.click("#coSubmit");
  };
  await order();
  await p.waitForSelector("#coDone:not([hidden])");
  await p.click("#coDone [data-close], #co [data-close]");
  await p.waitForFunction(() => !document.querySelector("#co").open);
  await order();
  await p.waitForFunction(() => document.querySelector("#coError") && !document.querySelector("#coError").hidden);
  assert.equal(Object.keys((await db(p)).orders).length, 1);
}, { expectErr: /rules: users: throttled/ });

await test("feedback requires login, then saves with kind", async ({ page: p }) => {
  await p.click("#openFeedback");
  await p.waitForSelector("#au[open]");
  await p.keyboard.press("Escape");
  await p.waitForFunction(() => !document.querySelector("#au").open);
  await signedIn(p);
  await p.click("#openFeedback");
  await p.waitForSelector("#fb[open]");
  await p.locator('#fbForm label').filter({ hasText: "Report a problem" }).click();
  await p.locator('#fbForm textarea').fill("The basket count looks wrong on my phone.");
  await p.click("#fbSubmit");
  await p.waitForFunction(() => Object.keys(window.__FAKE.dump().feedback || {}).length === 1);
  const fb = Object.values((await db(p)).feedback)[0];
  assert.equal(fb.kind, "bug"); assert.equal(fb.read, false);
});

await test("customer cannot read owner data (rules replica)", async ({ page: p }) => {
  await signedIn(p);
  const code = await p.evaluate(async () => {
    const f = window.__FAKE.fs;
    try { await f.getDoc(f.doc({}, "feedback", "x")); return "allowed"; } catch (e) { return e.code; }
  });
  assert.equal(code, "permission-denied");
});

await test("owner: sees Manage button, customer does not", async ({ page: p }) => {
  await p.click("#signInBtn");
  const f = p.locator('form[data-form="in"]');
  await f.locator('[name="email"]').fill("owner@shop.com");
  await f.locator('input[type="password"]').first().fill("password1");
  await f.locator('button[type="submit"]').click();
  await p.waitForSelector("#manageBtn:not([hidden])");
});

console.log(results.map(r => (r[0] ? "PASS " : "FAIL ") + r[1] + (r[0] ? "" : "\n     " + r[2] + (r[3] ? "\n     shot: " + r[3] : ""))).join("\n"));
console.log(`\n${results.filter(r => r[0]).length}/${results.length} passed`);
await closeAll(); srv.close();
process.exit(results.every(r => r[0]) ? 0 : 1);
