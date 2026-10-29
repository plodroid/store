import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { MODULES } from "./fake-modules.mjs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const ROOT = path.resolve(import.meta.dirname, "../..");
const FAKE = fs.readFileSync(path.join(import.meta.dirname, "fake-core.js"), "utf8");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };

export function serve() {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404).end("nf"); return; }
    res.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" }).end(fs.readFileSync(f));
  });
  return new Promise(r => srv.listen(0, "127.0.0.1", () => r({ srv, url: `http://127.0.0.1:${srv.address().port}` })));
}

const PC = {
  "SW1A1AA": { postcode: "SW1A 1AA", admin_district: "Westminster", post_town: "London", latitude: 51.5, longitude: -0.14, country: "England" },
  "EH11YZ": { postcode: "EH1 1YZ", admin_district: "City of Edinburgh", post_town: "Edinburgh", latitude: 55.95, longitude: -3.19, country: "Scotland" },
};
const T0 = { __ts: 1700000000000 };
export const SEED = {
  owners: { owner1: { createdAt: T0 } },
  categories: { c1: { name: "Dates", visible: true, sortOrder: 0, updatedAt: T0 }, c2: { name: "Drinks", visible: true, sortOrder: 1, updatedAt: T0 } },
  products: {
    p1: { name: "Medjool Dates 500g", price: 6.5, stock: 10, categoryId: "c1", visible: true, archived: false, description: "Soft.", updatedAt: T0, createdAt: T0 },
    p2: { name: "Sparkling Water", price: 2.4, stock: 3, categoryId: "c2", visible: true, archived: false, updatedAt: T0, createdAt: T0 },
    p3: { name: "Sold Out Juice", price: 1.85, stock: 0, categoryId: "c2", visible: true, archived: false, updatedAt: T0, createdAt: T0 },
  },
  settings: { site: { storeName: "Bee Hive", collection: true, delivery: true, deliveryFee: 2.5, updatedAt: T0 } },
};
export const ACCOUNTS = {};

export async function launch(base, { seed = SEED, accounts = {}, viewport, mailer = true } = {}) {
  const browser = globalThis.__browser || (globalThis.__browser = await chromium.launch());
  const ctx = await browser.newContext({ viewport: viewport || { width: 1280, height: 900 }, serviceWorkers: "block" });
  await ctx.route("https://www.gstatic.com/firebasejs/10.12.2/*", r => {
    const name = r.request().url().split("/").pop();
    r.fulfill({ status: MODULES[name] ? 200 : 404, contentType: "text/javascript", headers: { "access-control-allow-origin": "*" }, body: MODULES[name] || "" });
  });
  // stand-in for the Apps Script mailer: same replies as apps-script/Code.gs, codes kept here so tests can "read the email"
  const mail = { codes: {}, sent: [], tries: {}, calls: [] };
  const CONFIG = fs.readFileSync(path.join(ROOT, "firebase-config.js"), "utf8");
  await ctx.route("**/firebase-config.js", r => r.fulfill({ contentType: "text/javascript",
    body: mailer ? CONFIG : CONFIG.replace(/window\.STORE_AUTH_URL\s*=\s*"[^"]*"/, 'window.STORE_AUTH_URL = "PASTE_APPS_SCRIPT_URL"') }));
  await ctx.route("https://script.google.com/**", r => {
    const h = { "access-control-allow-origin": "*" };
    const b = JSON.parse(r.request().postData() || "{}");
    mail.calls.push(b);
    const reply = j => r.fulfill({ status: 200, headers: h, json: j });
    if (["housikiki@gmail.com"].includes(b.email)) return reply({ ok: false, error: "use_google" });
    if (b.a === "notify") return reply({ ok: true, sent: (b.emails || []).length, sentTo: b.emails || [] });
    if (b.a === "send") {
      mail.codes[b.email] = String(Math.floor(Math.random() * 10000)).padStart(4, "0"); mail.tries[b.email] = 0; mail.sent.push(b.email);
      return reply({ ok: true });
    }
    const code = mail.codes[b.email];
    if (!code) return reply({ ok: false, error: "expired" });
    if (b.code !== code) {
      if (++mail.tries[b.email] >= 3) { delete mail.codes[b.email]; return reply({ ok: false, error: "expired" }); }
      return reply({ ok: false, error: "bad_code", left: 3 - mail.tries[b.email] });
    }
    delete mail.codes[b.email];
    return reply({ ok: true, token: JSON.stringify({ mail: b.email, uid: "e_" + b.email }) });
  });
  const pcCalls = [];
  await ctx.route("https://api.postcodes.io/**", r => {
    const u = new URL(r.request().url());
    const h = { "access-control-allow-origin": "*" };
    pcCalls.push(u.pathname + u.search);
    if (u.pathname.startsWith("/postcodes/")) {
      const hit = PC[decodeURIComponent(u.pathname.split("/").pop()).replace(/\s/g, "").toUpperCase()];
      return r.fulfill(hit ? { status: 200, headers: h, json: { status: 200, result: hit } } : { status: 404, headers: h, json: { status: 404, error: "Postcode not found" } });
    }
    return r.fulfill({ status: 200, headers: h, json: { status: 200, result: [PC.SW1A1AA] } });
  });
  await ctx.addInitScript(({ code, seed, accounts }) => {
    eval(code);
    if (!localStorage.getItem("fake.seeded")) { window.__FAKE.seed(seed, accounts); localStorage.setItem("fake.seeded", "1"); }
  }, { code: FAKE, seed, accounts });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });
  return { ctx, page, errors, pcCalls, mail, close: () => ctx.close() };
}
export const closeAll = async () => { if (globalThis.__browser) await globalThis.__browser.close(); };
