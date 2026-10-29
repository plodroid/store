import { serve, launch, closeAll, SEED } from "./harness.mjs";
const { srv, url } = await serve();
const S = "/tmp/claude-0/-home-claude/fa786b1c-808f-5474-a40b-c6b83a368183/scratchpad/";
const T = { __ts: 1700000100000 };
const seed = { ...SEED, products: { ...SEED.products,
  p4: { name: "Ajwa Dates 250g", price: 5, salePrice: 3.5, stock: 4, categoryId: "c1", visible: true, archived: false, description: "Dark, soft and naturally sweet. Grown in Madinah.", updatedAt: T, createdAt: T },
  p5: { name: "Zamzam Water", price: 9, stock: 7, categoryId: "c2", visible: true, archived: false, updatedAt: T, createdAt: T } } };
for (const [tag, vp, theme] of [["d-light", { width: 1280, height: 900 }, "light"], ["d-dark", { width: 1280, height: 900 }, "dark"], ["m-light", { width: 390, height: 844 }, "light"], ["m-dark", { width: 390, height: 844 }, "dark"]]) {
  const t = await launch(url, { seed, viewport: vp }); const p = t.page;
  await p.goto(url + "/index.html"); await p.waitForSelector("[data-add]");
  if (theme === "dark") await p.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await p.locator("#grid .tile", { hasText: "Medjool" }).locator("[data-wish]").click();
  await p.waitForTimeout(500);
  await p.screenshot({ path: S + `s-${tag}-shop.png` });
  await p.click("#filterBtn"); await p.waitForTimeout(300);
  await p.screenshot({ path: S + `s-${tag}-filters.png` });
  await p.goto(url + "/index.html#/p/p4"); await p.waitForSelector("#vProduct:not([hidden]) .pp-name"); await p.waitForTimeout(500);
  await p.screenshot({ path: S + `s-${tag}-product.png` });
  await p.goto(url + "/index.html#/saved"); await p.waitForTimeout(500);
  await p.screenshot({ path: S + `s-${tag}-saved.png` });
  await p.goto(url + "/index.html"); await p.waitForSelector("[data-add]");
  if (theme === "dark") await p.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await p.evaluate(() => { window.__FAKE.nextGoogle = { email: "me@example.com", name: "Me", uid: "g_me" }; });
  await p.click(vp.width < 900 ? "#dockAcct" : "#signInBtn"); await p.waitForTimeout(500);
  await p.screenshot({ path: S + `s-${tag}-auth.png` });
  await p.click("[data-google]"); await p.waitForTimeout(800);
  await p.click(vp.width < 900 ? "#dockAcct" : "#acctBtn"); await p.waitForTimeout(500);
  await p.screenshot({ path: S + `s-${tag}-menu.png` });
  await p.keyboard.press("Escape");
  await p.click("[data-add]"); await p.waitForTimeout(300);
  await p.click(vp.width < 900 ? "#dockCart" : "#cartBtn"); await p.waitForTimeout(700);
  await p.screenshot({ path: S + `s-${tag}-cart.png` });
  await t.close();
}
await closeAll(); srv.close();
