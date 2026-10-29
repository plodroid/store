import { serve, launch, closeAll } from "./harness.mjs";
const { srv, url } = await serve();
const t = await launch(url);
await t.page.goto(url + "/index.html");
await t.page.waitForSelector(".add", { timeout: 8000 }).catch(e => console.log("no products:", e.message));
console.log("cards:", await t.page.locator("[data-add]").count());
console.log("signInBtn visible:", await t.page.locator("#signInBtn").isVisible());
console.log("errors:", t.errors);
await closeAll(); srv.close();
