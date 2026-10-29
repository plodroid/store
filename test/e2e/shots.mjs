import { serve, launch, closeAll } from "./harness.mjs";
const { srv, url } = await serve();
const S = "/tmp/claude-0/-home-claude/fa786b1c-808f-5474-a40b-c6b83a368183/scratchpad/";
for (const [tag, vp] of [["d", { width: 1280, height: 860 }], ["m", { width: 390, height: 800 }]]) {
  const t = await launch(url, { viewport: vp });
  const p = t.page;
  await p.goto(url + "/index.html"); await p.waitForSelector("[data-add]");
  await p.screenshot({ path: S + `s-${tag}-shop.png` });
  await p.click("#signInBtn"); await p.waitForTimeout(500);
  await p.screenshot({ path: S + `s-${tag}-signin.png` });
  await p.click('[data-go="up"]'); await p.waitForTimeout(400);
  await p.screenshot({ path: S + `s-${tag}-signup.png` });
  await p.locator('form[data-form="up"] [name="name"]').fill("Gina Test");
  await p.locator('form[data-form="up"] [name="email"]').fill("gina@example.com");
  await p.locator('form[data-form="up"] input[type="password"]').first().fill("password1");
  await p.locator('form[data-form="up"] button[type="submit"]').click();
  await p.waitForSelector('[data-form="verify"]'); await p.waitForTimeout(400);
  await p.screenshot({ path: S + `s-${tag}-verify.png` });
  await p.evaluate(() => window.__FAKE.verifyEmail("gina@example.com")); await p.click("[data-check]");
  await p.waitForSelector("#acctBtn:not([hidden])"); await p.waitForTimeout(300);
  await p.click("[data-add]"); await p.click("#cartBtn"); await p.click("#checkout");
  await p.waitForSelector("#co[open]"); await p.check('input[name="how"][value="delivery"]').catch(async()=>{ await p.locator('#coChoices label').nth(1).click(); });
  await p.waitForTimeout(400);
  await p.screenshot({ path: S + `s-${tag}-checkout.png` });
  await t.close();
}
await closeAll(); srv.close();
