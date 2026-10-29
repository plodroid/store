import { serve, launch, closeAll } from "./harness.mjs";
const { srv, url } = await serve();
const S = "/tmp/claude-0/-home-claude/fa786b1c-808f-5474-a40b-c6b83a368183/scratchpad/";
for (const theme of ["light", "dark"]) for (const [tag, vp] of [["d", { width: 1280, height: 860 }], ["m", { width: 390, height: 800 }]]) {
  const t = await launch(url, { viewport: vp });
  const p = t.page;
  await p.addInitScript(th => { try { localStorage.setItem("theme", th); } catch {} }, theme);
  await p.goto(url + "/index.html"); await p.waitForSelector("[data-add]");
  const n = `${theme}-${tag}`;
  await p.screenshot({ path: S + `s-${n}-shop.png` });
  await p.click("#signInBtn"); await p.waitForTimeout(400);
  await p.screenshot({ path: S + `s-${n}-signin.png` });
  await p.locator('form[data-form="in"] [name="email"]').fill("gina@example.com");
  await p.locator('form[data-form="in"] button[type="submit"]').click();
  await p.waitForSelector('[data-form="code"]'); await p.waitForTimeout(400);
  await p.screenshot({ path: S + `s-${n}-code.png` });
  await p.locator("#otp input").first().click(); await p.keyboard.type(t.mail.codes["gina@example.com"]);
  await p.waitForSelector("#acctBtn:not([hidden])"); await p.waitForTimeout(300);
  await p.click("#acctBtn"); await p.waitForTimeout(250);
  await p.screenshot({ path: S + `s-${n}-menu.png` });
  await p.keyboard.press("Escape");
  await p.mouse.click(5, 5);
  await p.click("[data-add]"); await p.click("#cartBtn"); await p.click("#checkout");
  await p.waitForSelector("#co[open]"); await p.waitForTimeout(400);
  await p.screenshot({ path: S + `s-${n}-checkout.png` });
  await t.close();
}
await closeAll(); srv.close();
