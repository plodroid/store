/* Bee Hive — customer website.
   Products, categories and site copy come live from Firestore (edited by the owner in the admin panel).
   Customers sign in (auth.js); orders, feedback and stock alerts are written straight to Firestore and
   locked down by firestore.rules, so the whole thing runs on the free Firebase plan. */

import { $, $$, esc, store, money, pence, reduced, uid, openDialog, closeDialog, wireDialogs,
         toast, showError, setBusy, priceOf, onSale, percentOff, millis } from "./ui.js?v=12";
import { createAuth } from "./auth.js?v=12";
import { normaliseUkPhone, showUkPhone } from "./uk.js?v=12";

const DEF = window.STORE_DEFAULTS;
const PATHS = window.STORE_PATHS;
const FB = "https://www.gstatic.com/firebasejs/10.12.2/";

function paintTheme() {
  const dark = document.documentElement.dataset.theme === "dark";
  $("#themeBtn").setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  $("#themeBtn2").textContent = $("#menuTheme").textContent = dark ? "Light mode" : "Dark mode";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#161616" : "#FFF8E6");
}

/* ── mode ────────────────────────────────────────────── */
function configured() {
  const c = window.FIREBASE_CONFIG || {};
  return !!c.projectId && !String(c.projectId).startsWith("PASTE");
}
const params = new URLSearchParams(location.search);
const MODE = configured() ? "live" : params.has("preview") ? "preview" : "unconfigured";
document.documentElement.dataset.mode = MODE;
if (MODE !== "live") {
  console.warn(`[shop] Firebase isn't configured (mode: ${MODE}). Fill in firebase-config.js to go live.` +
    (MODE === "unconfigured" ? " Add ?preview to the URL to look around with labelled sample data." : ""));
}

/* ── PREVIEW DATA — only used with ?preview while Firebase isn't configured.
      Made-up categories, products and prices for checking the design. ───── */
const PREVIEW = {
  categories: [
    { id: "pv-a", name: "Dates", sortOrder: 0 },
    { id: "pv-b", name: "Drinks", sortOrder: 1 },
    { id: "pv-c", name: "Pantry", sortOrder: 2 },
  ],
  products: [
    { id: "pv1", name: "Medjool Dates 500g", categoryId: "pv-a", price: 6.5, salePrice: 5.2, stock: 14, featured: true, createdAt: 5, description: "Soft, large and naturally sweet." },
    { id: "pv2", name: "Deglet Nour Dates 1kg", categoryId: "pv-a", price: 5.25, stock: 3, createdAt: 4, description: "Golden, firm and lightly honeyed." },
    { id: "pv3", name: "Sparkling Water 6 × 500ml", categoryId: "pv-b", price: 2.4, stock: 24, createdAt: 3, description: "Lightly carbonated mineral water." },
    { id: "pv4", name: "Orange Juice 1L", categoryId: "pv-b", price: 1.85, stock: 0, createdAt: 2, description: "Pressed oranges, no added sugar." },
    { id: "pv5", name: "Basmati Rice 2kg", categoryId: "pv-c", price: 3.9, stock: 18, createdAt: 1, description: "Long grain, aged for a fluffier cook." },
    { id: "pv6", name: "Olive Oil 750ml", categoryId: "pv-c", price: 6.75, stock: 9, featured: true, createdAt: 6, unit: "bottle", description: "Cold pressed, fruity and peppery." },
  ].map(p => ({ ...p, visible: true, archived: false })),
};

/* ── helpers ─────────────────────────────────────────── */
const stockOf = p => (p.stock == null || p.stock === "") ? Infinity : Math.max(0, Number(p.stock) || 0);
const lowAt = p => Number.isInteger(p.lowStockThreshold) ? p.lowStockThreshold : 5;
const parseMoney = v => { const t = String(v ?? "").replace(/[£,\s]/g, ""); const n = Number(t); return t !== "" && Number.isFinite(n) && n >= 0 ? n : null; };
const noFilters = () => ({ stock: false, sale: false, saved: false, min: "", max: "" });

const ph = ch => `<span class="ph" aria-hidden="true"><b>${esc(String(ch || "?").toUpperCase())}</b></span>`;

const I = {
  plus:  `<svg class="i-plus" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
  check: `<svg class="i-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 10 17 19 7"/></svg>`,
  heart: `<svg viewBox="0 0 24 24" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z"/></svg>`,
  bell:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9a6 6 0 1 1 12 0c0 6 2 7.5 2 7.5H4S6 15 6 9z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>`,
  share: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 12v7h14v-7"/></svg>`,
  shop:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5 5.5 4h13L20 9.5"/><path d="M4 9.5c0 1.4 1.1 2.5 2.5 2.5S9 10.9 9 9.5c0 1.4 1.1 2.5 3 2.5s3-1.1 3-2.5c0 1.4 1.1 2.5 2.5 2.5S20 10.9 20 9.5"/><path d="M5.5 12v8h13v-8"/></svg>`,
  truck: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h11v10H3z"/><path d="M14 9h4l3 3v4h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/></svg>`,
  star:  `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>`,
  tick:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="m8.5 12.3 2.4 2.4 4.6-5"/></svg>`,
};

/* ── state ───────────────────────────────────────────── */
const S = {
  products: [],       // raw docs from the backend
  categories: [],     // visible categories, ordered
  site: { ...DEF },
  state: MODE === "unconfigured" ? "unconfigured" : "loading",   // loading | ready | error | unconfigured
  cat: "All", q: "", sort: "feat", f: noFilters(),
  cart: store.get("cart", {}),
  wish: new Set(store.get("wish", [])),        // saved items: on this device, and in the account once signed in
  recent: store.get("recent", []),             // recently viewed product ids, newest first
  alerts: new Map(),                           // productId → alert doc id, for the signed-in customer
  view: "shop",
  catKey: "",
};
let FS = null;     // { db, fs, auth, au } Firebase handles — live mode only
let acct = null;   // customer account helper from auth.js

const catMap = () => new Map(S.categories.map(c => [c.id, c]));

/** Products customers may see: visible, not archived, and not inside a hidden/removed category. */
function shopProducts() {
  const cats = catMap();
  return S.products
    .filter(p => p.visible === true && p.archived !== true && (!p.categoryId || cats.has(p.categoryId)))
    .map(p => ({ ...p, category: p.categoryId ? cats.get(p.categoryId).name : "" }));
}
let SHOP = [];
const find = id => SHOP.find(p => p.id === id);

/* Pure: filter + sort. Kept separate so the self-check can exercise it. */
function visible(list, { cat, q, sort, f = noFilters(), wish = new Set() }) {
  const needle = q.trim().toLowerCase();
  const min = parseMoney(f.min), max = parseMoney(f.max);
  const out = list.filter(p =>
    (cat === "All" || p.categoryId === cat) &&
    (!needle || `${p.name} ${p.category ?? ""} ${p.description ?? ""}`.toLowerCase().includes(needle)) &&
    (!f.stock || stockOf(p) > 0) && (!f.sale || onSale(p)) && (!f.saved || wish.has(p.id)) &&
    (min == null || priceOf(p) >= min) && (max == null || priceOf(p) <= max));
  const name = (a, b) => String(a.name).localeCompare(String(b.name));
  const by = {
    lo: (a, b) => priceOf(a) - priceOf(b) || name(a, b),
    hi: (a, b) => priceOf(b) - priceOf(a) || name(a, b),
    az: name,
    new: (a, b) => millis(b.createdAt) - millis(a.createdAt) || name(a, b),
    feat: (a, b) => (stockOf(a) === 0 ? 1 : 0) - (stockOf(b) === 0 ? 1 : 0) || (b.featured ? 1 : 0) - (a.featured ? 1 : 0) ||
      (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || name(a, b),
  }[sort];
  const gone = p => (stockOf(p) === 0 ? 1 : 0);   // sold-out items always sink to the bottom
  return out.sort((a, b) => gone(a) - gone(b) || by(a, b));
}

/* ── data ────────────────────────────────────────────── */
async function connect() {
  if (MODE === "unconfigured") { render(); return; }
  if (MODE === "preview") {
    Object.assign(S, { products: PREVIEW.products, categories: PREVIEW.categories, state: "ready" });
    render();
    return;
  }

  try {
    const [{ initializeApp }, fs, au] = await Promise.all([
      import(FB + "firebase-app.js"), import(FB + "firebase-firestore.js"), import(FB + "firebase-auth.js"),
    ]);
    // paint the last known shop straight away; the live data below replaces it a moment later
    const warm = store.get("shopCache", null);
    if (warm && Array.isArray(warm.p) && Array.isArray(warm.c)) {
      Object.assign(S, { products: warm.p, categories: warm.c, site: { ...DEF, ...(warm.s || {}) }, state: "ready" });
      renderSite(); render(false);
    }
    const app = initializeApp(window.FIREBASE_CONFIG);
    const db = fs.getFirestore(app);
    FS = { db, fs, auth: au.getAuth(app), au };
    acct = createAuth({ FS, onChange: onAccountChange });

    // If nothing arrives from the server in time, say so instead of showing an empty shop.
    const slow = setTimeout(() => { if (S.state === "loading") { S.state = "error"; render(); } }, 15000);

    let first = true, haveProducts = false, haveCats = false;
    const flat = d => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v && typeof v.toMillis === "function" ? v.toMillis() : v]));
    let saveT;
    const remember = () => { clearTimeout(saveT); saveT = setTimeout(() => store.set("shopCache", { p: S.products.map(flat), c: S.categories.map(flat), s: flat(S.site) }), 300); };
    const ready = () => {
      if (!haveProducts || !haveCats) return;
      clearTimeout(slow);
      S.state = "ready";
      render(first && !warm);     // live edits after the first paint don't replay entrances
      first = false;
      remember();
    };
    const onErr = err => {
      console.error("[shop]", err);
      if (S.state !== "ready") { clearTimeout(slow); S.state = "error"; render(); }
    };

    const productsQ = fs.query(fs.collection(db, PATHS.products),
      fs.where("visible", "==", true), fs.where("archived", "==", false));
    fs.onSnapshot(productsQ, { includeMetadataChanges: true }, snap => {
      if (snap.metadata.fromCache && !haveProducts) return;   // wait for the server's answer
      S.products = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      haveProducts = true; ready();
    }, onErr);

    const catsQ = fs.query(fs.collection(db, PATHS.categories), fs.where("visible", "==", true));
    fs.onSnapshot(catsQ, { includeMetadataChanges: true }, snap => {
      if (snap.metadata.fromCache && !haveCats) return;
      S.categories = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.name).localeCompare(String(b.name)));
      haveCats = true; ready();
    }, onErr);

    fs.onSnapshot(fs.doc(db, PATHS.settings, PATHS.siteDoc), snap => {
      S.site = { ...DEF, ...(snap.exists() ? snap.data() : {}) };
      renderSite(); if (haveProducts && haveCats) remember();
    }, err => console.error("[shop] settings", err));
  } catch (e) {
    console.error("[shop]", e);
    S.state = "error";
    render();
  }
}

/* ── site copy ───────────────────────────────────────── */
const storeName = () => S.site.storeName || DEF.storeName;
function setTitle(t) { document.title = t ? `${t} · ${storeName()}` : storeName(); }

function renderSite() {
  $$("[data-bind]").forEach(el => {
    const v = S.site[el.dataset.bind];
    if (v != null && v !== "") el.innerHTML = esc(v).replace(/\n/g, "<br>");
  });
  $("#announce").hidden = !S.site.announcement;
  const c = $("#contact");
  c.hidden = !S.site.whatsapp;
  if (S.site.whatsapp) c.href = S.site.whatsapp;
  if (S.view !== "product") setTitle("");
  renderFoot();
  syncNavHeight();
}

function syncNavHeight() {
  document.documentElement.style.setProperty("--nav-h", `${$("#nav").offsetHeight}px`);
}

function renderFoot() {
  const f = fulfil();
  $("#footerBlurb").textContent = [f.collection && "Pick-up", f.delivery && "UK delivery"].filter(Boolean).join(" · ");
}

/* ── routing: #/ (shop) · #/p/<id> (product page) · #/saved ───────── */
function route() {
  const h = location.hash;
  const m = h.match(/^#\/p\/([^/?#]+)/);
  if (m) return { name: "product", id: decodeURIComponent(m[1]) };
  if (h === "#/saved") return { name: "saved" };
  return { name: "shop", anchor: h === "#shop" };
}

function showView(scroll = true) {
  const r = route(), prev = S.view;
  S.view = r.name;
  $("#vShop").hidden = r.name !== "shop";
  $("#vProduct").hidden = r.name !== "product";
  $("#vSaved").hidden = r.name !== "saved";
  document.body.dataset.view = r.name;
  if (r.name !== "product") setTitle(r.name === "saved" ? "Saved items" : "");
  render(false);
  paintDock();
  if (!scroll) return;
  if (r.name === "shop" && r.anchor) goToShop();
  else if (r.name === "shop" && prev !== "shop" && S.y != null) scrollTo({ top: S.y, behavior: "auto" });   // "back" lands where you were
  else scrollTo({ top: 0, behavior: "auto" });
}

/* ── categories ──────────────────────────────────────── */
function renderCats() {
  const cats = [{ id: "All", name: "All" }, ...S.categories];
  if (!cats.some(c => c.id === S.cat)) S.cat = "All";

  const key = cats.map(c => `${c.id}:${c.name}`).join("\u0000");
  if (key !== S.catKey) {
    S.catKey = key;
    $("#catList").replaceChildren($("#tabInd"), ...cats.map(c => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "tab"; b.dataset.c = c.id; b.textContent = c.name;
      return b;
    }));
  }
  $(".tabs").hidden = S.categories.length === 0;
  $$(".tab").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.c === S.cat)));
  moveIndicator();
}

function moveIndicator() {
  const active = $$(".tab").find(b => b.dataset.c === S.cat);
  const ind = $("#tabInd");
  if (!active || !active.offsetWidth) return;
  const first = !ind.dataset.ready;
  if (first) ind.style.transition = "none";
  ind.style.width = `${active.offsetWidth}px`;
  ind.style.transform = `translateX(${active.offsetLeft}px)`;
  if (first) { ind.offsetWidth; ind.style.transition = ""; ind.dataset.ready = "1"; }
}

function pickCat(c, { scroll = false } = {}) {
  S.cat = c;
  if (S.view !== "shop") { location.hash = "#shop"; return; }
  render();
  const active = $$(".tab").find(b => b.dataset.c === c);
  active?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reduced.matches ? "auto" : "smooth" });
  if (scroll) goToShop();
}

const goToShop = () => $("#shop").scrollIntoView({ behavior: reduced.matches ? "auto" : "smooth" });

/* ── filters ─────────────────────────────────────────── */
function renderFilters() {
  const f = S.f;
  const n = [f.stock, f.sale, f.saved, parseMoney(f.min) != null, parseMoney(f.max) != null].filter(Boolean).length;
  $("#filterN").hidden = !n;
  $("#filterN").textContent = n;
  $("#filterBtn").classList.toggle("on", n > 0);
  $("#fStock").checked = f.stock; $("#fSale").checked = f.sale; $("#fSaved").checked = f.saved;
}
const clearFilters = () => {
  S.f = noFilters();
  $("#fMin").value = ""; $("#fMax").value = "";
};

/* ── catalogue ───────────────────────────────────────── */
function media(p) {
  return p.image
    ? `<img src="${esc(p.image)}" alt="" loading="lazy" decoding="async" data-fallback="${esc((p.name || "?").trim()[0])}">`
    : ph((p.name || "?").trim()[0]);
}
const per = p => p.unit && p.unit !== "each" ? `<span class="per"> / ${esc(p.unit)}</span>` : "";
const priceHtml = p => onSale(p)
  ? `<span class="now">${money(priceOf(p))}</span> <s class="was">${money(p.price)}</s>${per(p)}`
  : `<span class="now">${money(p.price)}</span>${per(p)}`;
const heartBtn = (p, cls = "heart") => {
  const on = S.wish.has(p.id);
  return `<button class="${cls}${on ? " on" : ""}" type="button" data-wish="${esc(p.id)}" aria-pressed="${on}" aria-label="${on ? "Remove from saved items" : "Save for later"}">${I.heart}</button>`;
};

function tile(p) {
  const max = stockOf(p), out = max === 0, low = max > 0 && max <= lowAt(p);
  const asked = S.alerts.has(p.id);
  return `
  <article class="tile${out ? " is-out" : ""}">
    <div class="tile-media-wrap">
      <a class="tile-media" href="#/p/${esc(p.id)}" aria-label="View ${esc(p.name)}">${media(p)}</a>
      ${out ? `<span class="flag">Sold out</span>` : onSale(p) ? `<span class="flag sale">−${percentOff(p)}%</span>` : ""}
      ${heartBtn(p)}
    </div>
    <div class="tile-body">
      <a class="tile-name" href="#/p/${esc(p.id)}">${esc(p.name)}</a>
      <div class="tile-meta">${esc(p.category || "")}${low ? `${p.category ? " · " : ""}<span class="low">Only ${max} left</span>` : ""}</div>
      <div class="tile-foot">
        <span class="price">${priceHtml(p)}</span>
        ${out
          ? `<button class="add bell${asked ? " on" : ""}" type="button" data-notify="${esc(p.id)}" aria-pressed="${asked}" title="${asked ? "We'll email you when it's back" : "Email me when it's back"}"
                     aria-label="${asked ? `Stop the back-in-stock alert for ${esc(p.name)}` : `Email me when ${esc(p.name)} is back in stock`}">${I.bell}</button>`
          : `<button class="add" type="button" data-add="${esc(p.id)}" aria-label="Add ${esc(p.name)} to basket">${I.plus}${I.check}</button>`}
      </div>
    </div>
  </article>`;
}

const io = new IntersectionObserver(entries => {
  let k = 0;
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    e.target.style.setProperty("--d", `${Math.min(k++, 6) * 25}ms`);
    e.target.classList.add("in");
    io.unobserve(e.target);
  }
}, { rootMargin: "0px 0px -4% 0px" });

function reveal(root, animate) {
  const tiles = $$(".tile", root);
  if (animate && !reduced.matches) tiles.forEach(t => io.observe(t));
  else tiles.forEach(t => t.classList.add("in"));
  $$("img[data-fallback]", root).forEach(img => img.addEventListener("error", onImgError, { once: true }));
}

function render(animate = true) {
  SHOP = shopProducts();
  renderCats();
  renderFilters();
  renderRestock();
  paintWish();

  if (S.view === "product") renderProduct();
  else if (S.view === "saved") renderSaved();
  else renderShop(animate);

  drawCart();
  if ($("#co").open && !$("#coForm").hidden) drawCheckout();
}

function renderShop(animate) {
  const grid = $("#grid");
  const empty = (title, text, action) => {
    $("#empty").hidden = !title;
    if (!title) return;
    $("#emptyTitle").textContent = title;
    $("#emptyText").textContent = text;
    $("#emptyAction").hidden = !action;
    if (action) $("#emptyAction").textContent = action;
  };

  $("#modeNote").hidden = MODE !== "preview";

  if (S.state === "loading") {
    grid.innerHTML = Array.from({ length: 8 }, () =>
      `<div class="tile in sk" aria-hidden="true"><div class="tile-media"></div><div class="sk-line"></div><div class="sk-line short"></div></div>`).join("");
    $("#resultCount").textContent = "";
    $("#recentShop").hidden = true;
    empty();
    return;
  }
  if (S.state === "error" || S.state === "unconfigured") {
    grid.innerHTML = "";
    $("#resultCount").textContent = "";
    $("#recentShop").hidden = true;
    S.state === "error"
      ? empty("We couldn't load the shop just now.", "Please check your connection and refresh the page.")
      : empty("The shop is getting ready.", "Products will appear here soon. Please check back later.");
    return;
  }

  const items = visible(SHOP, S);
  const cat = S.categories.find(c => c.id === S.cat);
  $("#shopTitle").textContent = S.q.trim() ? `Results for “${S.q.trim()}”` : cat ? cat.name : "All products";
  $("#resultCount").textContent = `${items.length} ${items.length === 1 ? "item" : "items"}`;
  grid.innerHTML = items.map(tile).join("");

  if (!items.length) {
    const filtered = S.f.stock || S.f.sale || S.f.saved || parseMoney(S.f.min) != null || parseMoney(S.f.max) != null;
    if (S.q.trim() || filtered) empty(S.q.trim() ? `No results for “${S.q.trim()}”` : "No products match these filters", "Try a different word, or loosen the filters.", "Clear search and filters");
    else if (cat) empty("Nothing in this category yet", "Have a look at all products instead.");
    else empty("No products yet", "New products will appear here as soon as they're added.");
  } else empty();

  reveal(grid, animate);
  renderRecent();
}

/* "Recently viewed" under the shop grid */
function recentProducts(excludeId) {
  return S.recent.map(find).filter(p => p && p.id !== excludeId);
}
function renderRecent() {
  const list = recentProducts().slice(0, 4);
  $("#recentShop").hidden = !list.length;
  $("#recentShopList").innerHTML = list.map(tile).join("");
  reveal($("#recentShopList"), false);
}
function pushRecent(id) {
  if (S.recent[0] === id) return;
  S.recent = [id, ...S.recent.filter(x => x !== id)].slice(0, 12);
  store.set("recent", S.recent);
}

function onImgError(e) {
  const holder = e.target;
  holder.insertAdjacentHTML("afterend", ph(holder.dataset.fallback));
  holder.remove();
}

/* ── product page ────────────────────────────────────── */
function related(p) {
  const rest = SHOP.filter(x => x.id !== p.id);
  const score = x => (x.categoryId === p.categoryId ? 0 : 2) + (stockOf(x) === 0 ? 1 : 0);
  return rest.sort((a, b) => score(a) - score(b) || (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || String(a.name).localeCompare(String(b.name))).slice(0, 4);
}

function renderProduct() {
  const root = $("#pp");
  const id = route().id;
  const back = `<nav class="crumbs" aria-label="Breadcrumb"><a href="#/">Shop</a><span aria-hidden="true">/</span>`;
  if (S.state === "loading") {
    root.dataset.id = "";
    root.innerHTML = `${back}<span>…</span></nav><div class="pp sk" aria-hidden="true"><div class="pp-media"></div><div class="pp-info"><div class="sk-line"></div><div class="sk-line short"></div></div></div>`;
    return;
  }
  const p = find(id);
  if (!p) {
    root.dataset.id = "";
    setTitle("Product not found");
    root.innerHTML = `${back}<span aria-current="page">Not found</span></nav>
      <div class="empty"><p class="empty-title">${S.state === "ready" ? "This product isn't available any more" : "We couldn't load this product"}</p>
      <p class="muted">${S.state === "ready" ? "It may have been removed or sold out for good." : "Please check your connection and try again."}</p>
      <a class="btn-ghost" href="#/">Back to the shop</a></div>`;
    return;
  }

  if (root.dataset.id !== id) { root.dataset.qty = "1"; root.dataset.id = id; pushRecent(id); }
  const max = stockOf(p), out = max === 0;
  const qty = Math.max(1, Math.min(out ? 1 : max, Number(root.dataset.qty) || 1));
  root.dataset.qty = qty;
  const state = max === Infinity ? "" : out ? "out" : max <= lowAt(p) ? "low" : "ok";
  const stock = { out: "Sold out", low: `Only ${max} left`, ok: "In stock" }[state] || "";
  const asked = S.alerts.has(p.id);
  const f = fulfil();
  const facts = [
    f.collection && "Pick up from the shop once it's confirmed",
    f.delivery && `UK delivery${f.fee ? ` from ${money(f.fee)}` : ", free"}`,
  ].filter(Boolean);
  const more = related(p);
  const seen = recentProducts(p.id).slice(0, 4);
  setTitle(p.name);

  const saved = S.wish.has(p.id);
  root.innerHTML = `
    ${back}${p.category ? `<a href="#shop" data-c="${esc(p.categoryId)}" data-scroll>${esc(p.category)}</a><span aria-hidden="true">/</span>` : ""}<span aria-current="page">${esc(p.name)}</span></nav>
    <article class="pp">
      <div class="pp-media">${media(p)}${out ? `<span class="flag">Sold out</span>` : onSale(p) ? `<span class="flag sale">−${percentOff(p)}%</span>` : ""}
        <div class="pp-float">
          <a class="icon-btn glass-s" href="#/" aria-label="Back to the shop"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="m15 5-7 7 7 7"/></svg></a>
          <span class="grp">
            <button class="icon-btn glass-s" type="button" data-share aria-label="Share">${I.share}</button>
            ${heartBtn(p, "icon-btn glass-s pp-heart")}
          </span>
        </div>
      </div>
      <div class="pp-info">
        ${p.category ? `<div class="pp-cat">${esc(p.category)}</div>` : ""}
        <h1 class="pp-name">${esc(p.name)}</h1>
        <div class="pp-price">${priceHtml(p)}${onSale(p) ? `<span class="save-chip">Save ${money(p.price - priceOf(p))}</span>` : ""}</div>
        ${stock ? `<div class="pp-stock ${state}"><i></i>${stock}</div>` : ""}
        ${p.description ? `<p class="pp-desc">${esc(p.description)}</p>` : ""}
        ${facts.length ? `<ul class="pp-facts">${facts.map(t => `<li>${I.tick}${esc(t)}</li>`).join("")}</ul>` : ""}
        <div class="pp-actions">
          ${out
            ? `<button class="btn-primary${asked ? " on" : ""}" type="button" data-notify="${esc(p.id)}">${I.bell}<span>${asked ? "We'll email you when it's back" : "Email me when it's back"}</span></button>`
            : `<div class="stepper">
                 <button class="step" type="button" data-pp-step="-1" aria-label="Decrease quantity" ${qty <= 1 ? "disabled" : ""}>−</button>
                 <output id="ppQty">${qty}</output>
                 <button class="step" type="button" data-pp-step="1" aria-label="Increase quantity" ${qty >= max ? "disabled" : ""}>+</button>
               </div>
               <button class="btn-primary" type="button" data-pp-add>Add to basket</button>`}
        </div>
        ${asked && out ? `<p class="hint pp-hint">Changed your mind? <button class="link" type="button" data-notify="${esc(p.id)}">Cancel the alert</button></p>` : ""}
        <div class="pp-sub">
          ${heartBtn(p, "pp-save").replace("</svg></button>", `</svg><span>${saved ? "Saved" : "Save for later"}</span></button>`)}
          <button class="pp-save" type="button" data-share>${I.share}<span>Share</span></button>
        </div>
      </div>
    </article>
    ${more.length ? `<section class="rail-sec"><h2>You may also like</h2><div class="grid rail" id="ppMore">${more.map(tile).join("")}</div></section>` : ""}
    ${seen.length ? `<section class="rail-sec"><h2>Recently viewed</h2><div class="grid rail" id="ppSeen">${seen.map(tile).join("")}</div></section>` : ""}`;
  reveal(root, false);
}

async function shareProduct() {
  const p = find(route().id); if (!p) return;
  const data = { title: `${p.name} · ${storeName()}`, url: location.href };
  try {
    if (navigator.share) { await navigator.share(data); return; }
    await navigator.clipboard.writeText(location.href);
    toast("Link copied");
  } catch (e) { if (e && e.name !== "AbortError") toast("Couldn't copy the link"); }
}

/* ── saved items (wishlist) ──────────────────────────── */
function renderSaved() {
  const items = [...S.wish].map(find).filter(Boolean);
  $("#savedGrid").innerHTML = items.map(tile).join("");
  reveal($("#savedGrid"), false);
  $("#savedCount").textContent = items.length ? `${items.length} ${items.length === 1 ? "item" : "items"}` : "";
  $("#savedEmpty").hidden = items.length > 0 || S.state === "loading";
}

function paintWish() {
  const n = [...S.wish].filter(id => S.state !== "ready" || find(id)).length;
  const pip = $("#wishCount");
  pip.hidden = !n; pip.textContent = n;
  const dp = $("#dockWish"); dp.hidden = !n; dp.textContent = n;
  $("#savedLink").setAttribute("aria-label", n ? `Saved items, ${n}` : "Saved items");
}

function toggleWish(id) {
  const had = S.wish.has(id);
  if (had) S.wish.delete(id); else S.wish.add(id);
  store.set("wish", [...S.wish]);
  syncWish();
  toast(had ? "Removed from saved items" : "Saved for later");
  // flip every heart for this product in place; pages that list saved items redraw
  $$(`[data-wish="${CSS.escape(id)}"]`).forEach(b => {
    const on = S.wish.has(id);
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
    b.setAttribute("aria-label", on ? "Remove from saved items" : "Save for later");
    const label = b.querySelector("span"); if (label) label.textContent = on ? "Saved" : "Save for later";
  });
  paintWish();
  if (S.view === "saved" || (S.view === "shop" && S.f.saved)) render(false);
}

let wishTimer;
function syncWish() {
  clearTimeout(wishTimer);
  if (!acct?.user || !acct.verified) return;
  wishTimer = setTimeout(() => acct.saveProfile({ wishlist: [...S.wish].slice(0, 100) }).catch(e => console.warn("[wishlist]", e && e.code)), 700);
}

/* ── "tell me when it's back" ────────────────────────── */
let alertsUnsub = null;
function watchMyAlerts() {
  if (alertsUnsub || !FS || !acct?.user || !acct.verified) return;
  const { db, fs } = FS;
  alertsUnsub = fs.onSnapshot(fs.query(fs.collection(db, "stockAlerts"), fs.where("uid", "==", acct.user.uid)), snap => {
    S.alerts = new Map(snap.docs.map(d => [d.data().productId, d.id]));
    render(false);
  }, err => console.warn("[alerts]", err && err.code));
}
function stopMyAlerts() {
  if (alertsUnsub) { alertsUnsub(); alertsUnsub = null; }
  if (S.alerts.size) { S.alerts = new Map(); render(false); }
}

async function toggleAlert(id) {
  const p = find(id); if (!p) return;
  if (MODE !== "live" || !acct) return toast("Alerts aren't available in preview mode");
  if (!(await acct.requireLogin("Sign in so we can email you when it's back in stock."))) return;
  watchMyAlerts();
  const { db, fs } = FS, me = acct.user.uid, ref = fs.doc(db, "stockAlerts", `${me}_${id}`);
  try {
    if (S.alerts.has(id)) { await fs.deleteDoc(ref); toast("Alert cancelled"); }
    else {
      await fs.setDoc(ref, { uid: me, productId: id, productName: String(p.name || "").slice(0, 120), email: acct.email, createdAt: fs.serverTimestamp() });
      toast("Done. We'll email you when it's back");
    }
  } catch (e) {
    console.warn("[alerts]", e && e.code);
    toast("Couldn't do that. Please try again.");
  }
}

/** A banner for products you asked about that are back on the shelf. */
function renderRestock() {
  const el = $("#restock");
  const back = S.state === "ready" ? [...S.alerts.keys()].map(find).filter(p => p && stockOf(p) > 0) : [];
  el.hidden = !back.length || S.view !== "shop";
  if (el.hidden) return;
  el.innerHTML = `<div class="wrap restock-in"><span>Back in stock: ${back.map(p => `<a href="#/p/${esc(p.id)}">${esc(p.name)}</a>`).join(", ")}</span>
    <button class="link" type="button" data-restock-dismiss>Dismiss</button></div>`;
}
async function dismissRestock() {
  const { db, fs } = FS;
  const back = [...S.alerts.entries()].filter(([pid]) => { const p = find(pid); return p && stockOf(p) > 0; });
  await Promise.all(back.map(([, docId]) => fs.deleteDoc(fs.doc(db, "stockAlerts", docId)).catch(() => {})));
}

/* ── my orders ───────────────────────────────────────── */
const mo = $("#mo");
let moUnsub = null;
const unpaid = o => o.status === "new" && o.paymentStatus === "awaiting";      // started checkout, never paid
const ORDER_STATUS = {
  new: o => unpaid(o) ? "Waiting for payment" : "Sent to the shop", confirmed: "Confirmed", preparing: "Being prepared",
  ontheway: "On its way", arrived: "Arrived",
  ready: o => o.fulfilment === "delivery" ? "Out for delivery" : "Ready to collect",
  completed: "Completed", cancelled: "Cancelled",
};
const statusText = o => { const t = ORDER_STATUS[o.status]; return typeof t === "function" ? t(o) : t || o.status; };
const STATUS_HELP = {
  new: o => unpaid(o) ? "Your order isn't placed until it's paid." : "The shop will check stock and confirm your order soon.",
  confirmed: o => o.paymentStatus === "paid" ? `Paid, thank you! We'll email you when it's ${o.fulfilment === "delivery" ? "on its way" : "ready to collect"}.` : "The shop has confirmed your order and reserved your items.",
  preparing: "The shop is getting your order ready.",
  ontheway: "The shop is on the way to you now.",
  arrived: "The shop has arrived with your order. Please come to the door.",
  completed: "All done. Thank you for ordering!",
  cancelled: "This order was cancelled.",
};
const helpText = o => { const t = o.status === "ready" ? (o.fulfilment === "delivery" ? "Your order is on its way." : "Your order is ready. Come and collect it.") : STATUS_HELP[o.status]; return typeof t === "function" ? t(o) : t || ""; };

/* ── card payments (Stripe Checkout via the Apps Script) ── */
const AUTH_URL = () => String(window.STORE_AUTH_URL || "");
let payReady = null;      // does the shop have card payments switched on? asked once, when My orders opens
const cardsOn = () => (payReady ??= /^https:\/\/script\.google\.com\//.test(AUTH_URL())
  ? fetch(AUTH_URL()).then(r => r.json()).then(j => j.pay === true).catch(() => false) : Promise.resolve(false));
const callPay = async body => {
  const idToken = await acct.user.getIdToken();
  const res = await fetch(AUTH_URL(), { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ ...body, idToken }) });
  return res.json();
};
const PAY_ERR = { not_ready: "The shop needs to confirm your order before you can pay.", already_paid: "This order is already paid.", not_set_up: "Card payments aren't switched on yet.",
  no_delivery: "Delivery isn't available right now. Please choose pick-up.", no_collection: "Pick-up isn't available right now. Please choose delivery.", too_small: "That order is too small to pay for by card." };
const payError = r => r.error === "stock" ? `Sorry, “${r.item}” just ran out. Please change your basket.` : PAY_ERR[r.error] || "Couldn't start the payment. Please try again.";
const canPay = o => o.paymentStatus !== "paid" && (unpaid(o) || (["confirmed", "preparing", "ready"].includes(o.status) && Number(o.total) > 0));
let lastOrders = [], cardsReady = false;
/** Ask (once) whether the shop takes cards; redraw whatever is showing the answer. */
function warmCards() {
  cardsOn().then(on => {
    if (on === cardsReady) return;
    cardsReady = on;
    if ($("#moList") && lastOrders.length) paintOrders(lastOrders);
    if ($("#co").open && !coForm.hidden) drawCheckout();
  });
}

async function startPay(btn) {
  setBusy(null, btn, true);
  try {
    const r = await callPay({ a: "pay", orderId: btn.dataset.pay });
    if (r.ok && r.url) { location.href = r.url; return; }
    toast(payError(r));
  } catch { toast("Couldn't start the payment. Please check your connection."); }
  setBusy(null, btn, false);
}

/** Back from Stripe: ask the shop's server to check the payment with Stripe, then show the orders. */
async function finishPay({ id, sid }) {
  try {
    const r = await callPay({ a: "paid", orderId: id, sid });
    if (r.ok) { S.cart = {}; saveCart(); drawCart(true); store.sset("pendingOrder", null); }      // the order is paid: empty the basket
    toast(r.ok ? "Payment received. Thank you!" : "We couldn't confirm that payment yet. If you were charged, tell the shop.");
  } catch { toast("We couldn't confirm that payment yet. Please check My orders."); }
  openMyOrders();
}

function paintOrders(list) {
  lastOrders = list;
  const box = $("#moList"); if (!box) return;
  list.sort((a, b) => (millis(b.createdAt) || Date.now()) - (millis(a.createdAt) || Date.now()));
  list = list.filter(o => !(unpaid(o) && Date.now() - (millis(o.createdAt) || Date.now()) > 864e5));      // forget checkouts abandoned yesterday
  if (!list.length) { box.innerHTML = `<p class="muted">You haven't placed any orders yet.</p>`; return; }
  box.innerHTML = list.map(o => {
    const lines = Array.isArray(o.lines) ? o.lines.map(l => ({ name: l.name, qty: l.qty })) : (o.items || []).map(i => ({ name: i.name, qty: i.qty }));
    const total = o.total != null ? o.total : o.estTotal;
    const help = helpText(o);
    return `<article class="mo-card">
      <div class="mo-top"><b>${esc(o.ref)}</b><span class="mo-chip" data-st="${esc(o.status)}">${esc(statusText(o))}</span></div>
      <p class="muted mo-meta">${new Date(millis(o.createdAt) || Date.now()).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} · ${o.fulfilment === "delivery" ? "Delivery" : "Pick-up"}</p>
      <ul class="mo-items">${lines.map(l => `<li><span>${esc(l.name)}</span><span>× ${l.qty}</span></li>`).join("")}</ul>
      <div class="sum-row total"><span>${o.total != null ? "Total" : "Estimated total"}${o.paymentStatus === "paid" ? ` <span class="mo-chip" data-st="completed">Paid</span>` : ""}</span><span>${total != null ? money(total) : ""}</span></div>
      ${cardsReady && canPay(o) ? `<button class="btn-primary wide" type="button" data-pay="${esc(o.id)}">Pay ${money(total)} by card</button>${unpaid(o) ? "" : `<p class="muted mo-help">Or pay when you ${o.fulfilment === "delivery" ? "receive" : "collect"} it.</p>`}` : ""}
      ${help ? `<p class="muted mo-help">${esc(help)}</p>` : ""}
    </article>`;
  }).join("");
}

async function openMyOrders() {
  if (MODE !== "live" || !acct) return toast("Orders aren't available in preview mode");
  if (!(await acct.requireLogin("Sign in to see your orders."))) return;
  $("#moBody").innerHTML = `<h2 id="moTitle">My orders</h2><p class="muted modal-sub">Live status from the shop.</p><div class="mo-list" id="moList"><p class="muted">Loading…</p></div>`;
  openDialog(mo);
  warmCards();
  const { db, fs } = FS;
  if (moUnsub) moUnsub();
  moUnsub = fs.onSnapshot(fs.query(fs.collection(db, "orders"), fs.where("uid", "==", acct.user.uid)),
    snap => paintOrders(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => { console.warn("[orders]", err && err.code); const b = $("#moList"); if (b) b.innerHTML = `<p class="form-error">We couldn't load your orders right now.</p>`; });
}
mo.addEventListener("click", e => { const b = e.target.closest("[data-pay]"); if (b) startPay(b); });
mo.addEventListener("close", () => { if (moUnsub) { moUnsub(); moUnsub = null; } });

/* ── search (one box in the header) ──────────────────── */
let qTimer;
function setQuery(v) {
  S.q = v;
  clearTimeout(qTimer);
  qTimer = setTimeout(() => render(false), 120);
}

/* ── basket ──────────────────────────────────────────── */
const saveCart = () => store.set("cart", S.cart);

function addToCart(id, n = 1, btn) {
  const p = find(id); if (!p) return false;
  const have = S.cart[id] || 0, max = stockOf(p);
  if (have >= max) { toast(max === 0 ? "This item is sold out" : `That's all we have: only ${max} available`); return false; }
  S.cart[id] = Math.min(max, have + n);
  saveCart();
  drawCart(true);
  if (btn) {
    btn.classList.add("done");
    clearTimeout(btn._t);
    btn._t = setTimeout(() => btn.classList.remove("done"), 1100);
  }
  toast(`Added ${p.name}`);
  return true;
}

function cartLines() {
  return Object.entries(S.cart).map(([id, qty]) => ({ p: find(id), qty })).filter(l => l.p);
}
const subtotalOf = lines => lines.reduce((t, l) => t + pence(priceOf(l.p)) * l.qty, 0) / 100;

function drawCart(bump = false) {
  // keep the basket honest against live stock (only once real data is in)
  if (S.state === "ready") {
    let changed = false;
    for (const [id, qty] of Object.entries(S.cart)) {
      const p = find(id);
      const ok = p ? Math.min(qty, stockOf(p)) : 0;
      if (ok !== qty) { ok > 0 ? (S.cart[id] = ok) : delete S.cart[id]; changed = true; }
    }
    if (changed) saveCart();
  }

  const lines = cartLines();
  const count = lines.reduce((n, l) => n + l.qty, 0);

  const c = $("#cartCount");
  c.textContent = count;
  if (bump && !reduced.matches) { c.classList.remove("bump"); c.offsetWidth; c.classList.add("bump"); }
  const dc = $("#dockCount"); dc.hidden = !count; dc.textContent = count;
  if (bump && !reduced.matches) { dc.classList.remove("bump"); dc.offsetWidth; dc.classList.add("bump"); }
  $("#cartBtn").setAttribute("aria-label", `Open basket, ${count} ${count === 1 ? "item" : "items"}`);

  $("#cartTotal").textContent = money(subtotalOf(lines));
  $("#checkout").disabled = !lines.length;
  $("#cartItems").innerHTML = lines.length ? lines.map(({ p, qty }) => `
    <div class="line">
      <a class="line-thumb" href="#/p/${esc(p.id)}" data-close-cart aria-label="View ${esc(p.name)}">${media(p)}</a>
      <div class="line-main">
        <div class="line-name">${esc(p.name)}</div>
        <div class="line-unit">${money(priceOf(p))} each${onSale(p) ? ` <s class="was">${money(p.price)}</s>` : ""}</div>
        <div class="stepper">
          <button class="step" type="button" data-id="${esc(p.id)}" data-step="-1" aria-label="Remove one ${esc(p.name)}">−</button>
          <output>${qty}</output>
          <button class="step" type="button" data-id="${esc(p.id)}" data-step="1" aria-label="Add one ${esc(p.name)}" ${qty >= stockOf(p) ? "disabled" : ""}>+</button>
        </div>
        ${qty >= stockOf(p) ? `<div class="line-cap">Only ${stockOf(p)} available</div>` : ""}
      </div>
      <div class="line-end">
        <div class="line-total">${money(pence(priceOf(p)) * qty / 100)}</div>
        <button class="line-remove" type="button" data-remove="${esc(p.id)}">Remove</button>
      </div>
    </div>`).join("")
    : `<div class="drawer-empty"><p>Your basket is empty.</p><button class="btn-ghost" type="button" data-close-cart>Start shopping</button></div>`;
}

function stepCart(id, step) {
  const p = find(id); if (!p) return;
  const next = (S.cart[id] || 0) + step;
  if (next <= 0) delete S.cart[id];
  else if (next > stockOf(p)) return;
  else S.cart[id] = next;
  saveCart();
  drawCart(true);
}

function openCart(open) {
  const d = $("#drawer");
  d.classList.toggle("open", open);
  d.setAttribute("aria-hidden", String(!open));
  $("#scrim").classList.toggle("open", open);
  document.body.style.overflow = open ? "hidden" : "";
  if (open && MODE === "live") warmCards();
  if (open) setTimeout(() => $("#closeCart").focus({ preventScroll: true }), 60);
  else if (innerWidth >= 900) $("#cartBtn").focus({ preventScroll: true });
  paintDock();
}

/* ── tab bar (phones): a glass pill slides to the active item ── */
function paintDock() {
  const dock = $("#dock"); if (!dock || !dock.offsetWidth) return;
  const key = $("#drawer").classList.contains("open") ? "cart" : !$("#menu").hidden ? "acct" : S.view === "saved" ? "saved" : S.view === "shop" ? "home" : "";
  const items = $$("[data-dock]", dock);
  items.forEach(i => i.classList.toggle("on", i.dataset.dock === key));
  const on = items.find(i => i.dataset.dock === key), ind = $("#dockInd");
  ind.hidden = !on;
  if (!on) return;
  const first = !ind.dataset.ready, was = ind.dataset.at;
  if (first) ind.style.transition = "none";
  ind.style.width = `${on.offsetWidth}px`;
  ind.style.translate = `${on.offsetLeft}px 0`;
  if (first) { ind.offsetWidth; ind.style.transition = ""; ind.dataset.ready = "1"; }
  else if (was !== key && !reduced.matches) { ind.classList.remove("go"); ind.offsetWidth; ind.classList.add("go"); }
  ind.dataset.at = key;
}

/* ── checkout ────────────────────────────────────────── */
const co = $("#co");
const coForm = $("#coForm");
const fulfil = () => {
  const s = S.site;
  const fee = Number(s.deliveryFee);
  return { collection: s.collection !== false, delivery: s.delivery !== false, fee: Number.isFinite(fee) && fee > 0 ? fee : 0 };
};
const chosen = () => coForm.querySelector('input[name="how"]:checked')?.value || null;
const addrHtml = a => [a.line1, a.line2, a.city, a.postcode].filter(Boolean).map(esc).join("<br>");

/** Basket → "Checkout" button. Signed-in + email-verified customers only. */
async function startCheckout() {
  if (!cartLines().length) return;
  openCart(false);
  if (MODE === "live" && acct) {
    const ok = await acct.requireLogin("Sign in to place your order.");
    if (!ok) return;
  }
  openCheckout();
}

function openCheckout() {
  if (!cartLines().length) return;
  coForm.hidden = false;
  $("#coDone").hidden = true;
  $("#coError").hidden = true;
  const f = fulfil();
  const opts = [
    f.collection && ["collection", "Pick up from the shop", "Free"],
    f.delivery && ["delivery", "Delivery (UK)", f.fee ? money(f.fee) : "Free"],
  ].filter(Boolean);
  const keep = chosen();
  $("#coChoices").innerHTML = opts.length
    ? opts.map(([v, label, fee], i) => `
        <label><input type="radio" name="how" value="${v}" ${keep === v || (!keep && i === 0) ? "checked" : ""}>
        <span>${label}</span><span class="fee">${fee}</span></label>`).join("") +
      (f.delivery ? "" : `<label class="is-off"><input type="radio" disabled><span>Delivery (UK)</span><span class="fee">Not available yet</span></label>`)
    : `<p class="muted">Online ordering is paused right now. Please check back soon.</p>`;

  // fill in what we already know about the customer
  const p = acct ? acct.profile : {};
  if (!coForm.elements.name.value) coForm.elements.name.value = p.name || acct?.user?.displayName || "";
  if (!coForm.elements.phone.value) coForm.elements.phone.value = showUkPhone(p.phone || "");
  $("#coEmail").textContent = acct?.email || "Sign in to order";
  drawCheckout();
  openDialog(co);
}

function drawCheckout() {
  const lines = cartLines();
  const how = chosen();
  const f = fulfil();
  const fee = how === "delivery" ? f.fee : 0;
  const sub = subtotalOf(lines);
  $("#coItems").innerHTML = lines.map(l =>
    `<div class="sum-row"><span>${esc(l.p.name)} × ${l.qty}</span><span>${money(pence(priceOf(l.p)) * l.qty / 100)}</span></div>`).join("");
  $("#coSum").innerHTML = `
    <div class="sum-row"><span>Subtotal</span><span>${money(sub)}</span></div>
    ${how === "delivery" ? `<div class="sum-row"><span>Delivery</span><span>${fee ? money(fee) : "Free"}</span></div>` : ""}
    <div class="sum-row total"><span>Total</span><span>${money(sub + fee)}</span></div>
    <p class="sum-note">${cardsReady ? "You'll see the final price on the payment page." : "The shop confirms prices and stock when it accepts your order."}</p>`;

  const addr = acct?.profile.address;
  $("#coAddress").hidden = how !== "delivery";
  $("#coAddrCard").innerHTML = addr
    ? `<div class="addr-text">${addrHtml(addr)}</div>${addr.verified ? `<span class="badge ok">Postcode checked</span>` : ""}`
    : `<div class="addr-empty">No delivery location yet.</div>`;
  $("#coAddrBtn").textContent = addr ? "Change location" : "Set location";
  $("#coPhoneHint").textContent = how === "delivery" ? "(UK, needed for delivery)" : "(UK, optional)";

  const blocked = MODE !== "live" ? "Ordering is switched off in preview mode."
    : !navigator.onLine ? "You're offline. Connect to the internet to place your order."
    : !how ? "Online ordering is paused right now."
    : !lines.length ? "Your basket is empty." : "";
  $("#coSubmit").disabled = !!blocked;
  $("#coSubmit").title = blocked;
  $("#coSubmit").textContent = cardsReady ? `Pay ${money(sub + fee)} by card` : "Place test order";
  $("#coNote").innerHTML = cardsReady
    ? `<strong>Test mode.</strong> You pay by card on the next page, and the shop gets your order straight away. Nothing real is charged.`
    : `<strong>Test checkout.</strong> Nothing is charged. The shop confirms your order, then you can pay at pick-up or delivery. Your order is marked as a test.`;
  if (blocked && MODE !== "live") showError("#coError", blocked);
}

function checkoutPayload() {
  const v = n => (coForm.elements[n]?.value || "").trim();
  const how = chosen();
  const lines = cartLines();
  const fee = how === "delivery" ? fulfil().fee : 0;
  const a = acct?.profile.address;
  return {
    items: lines.map(l => ({ productId: l.p.id, qty: l.qty, name: String(l.p.name || "").slice(0, 120) })),
    customer: { name: v("name"), phone: normaliseUkPhone(v("phone")), rawPhone: v("phone"), email: acct?.email || "" },
    fulfilment: how,
    address: how === "delivery" && a
      ? { line1: a.line1 || "", line2: a.line2 || "", city: a.city || "", postcode: a.postcode || "",
          lat: typeof a.lat === "number" ? a.lat : null, lng: typeof a.lng === "number" ? a.lng : null, verified: a.verified === true }
      : null,
    note: v("note"),
    estTotal: (subtotalOf(lines) * 100 + fee * 100) / 100,
    hp: v("website"),
  };
}

/** Client-side checks mirror firestore.rules so mistakes are caught instantly. */
function checkCheckout(p) {
  const mark = (name, isBad) => { const el = coForm.elements[name]; if (el) el.setAttribute("aria-invalid", String(isBad)); return isBad; };
  if (mark("name", p.customer.name.length < 2)) return "Please enter your name.";
  const phoneBad = p.customer.rawPhone ? !p.customer.phone : p.fulfilment === "delivery";
  if (mark("phone", phoneBad)) return p.customer.rawPhone
    ? "Please enter a UK number, like 07123 456789."
    : "Please add a mobile number so the shop can reach you about your delivery.";
  if (p.fulfilment === "delivery" && !p.address) return "Please set your delivery location first.";
  return "";
}

/** One id per basket+choice: a retry after a timeout can never create a second order. */
function requestIdFor(payload) {
  const sig = JSON.stringify([payload.items.map(i => [i.productId, i.qty]), payload.fulfilment]);
  const pending = store.sget("pendingOrder");
  if (pending && pending.sig === sig) return pending.id;
  const id = uid();
  store.sset("pendingOrder", { id, sig });
  return id;
}

const REF_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";      // no 0/O/1/I, so refs are easy to read out
const makeRef = () => {
  const b = crypto.getRandomValues(new Uint8Array(6));
  return "BH-" + [...b].map(x => REF_ALPHABET[x % REF_ALPHABET.length]).join("");
};

/** Writes the order + the rate-limit stamp in one batch. Prices are NOT sent: the owner re-prices on confirm. */
async function writeOrder(p, paymentStatus = "mock") {
  const { db, fs, auth } = FS;
  const user = auth.currentUser;
  const orderRef = fs.doc(db, "orders", `o_${p.requestId}`);
  const ref = makeRef();
  const doc = {
    uid: user.uid, ref, requestId: p.requestId, status: "new", paymentStatus, isTest: true,
    fulfilment: p.fulfilment,
    items: p.items,
    customer: { name: p.customer.name, phone: p.customer.phone || "", email: p.customer.email },
    note: p.note, estTotal: p.estTotal,
    createdAt: fs.serverTimestamp(), updatedAt: fs.serverTimestamp(),
  };
  if (p.address) doc.address = p.address;
  const batch = fs.writeBatch(db);
  batch.set(orderRef, doc);
  batch.set(fs.doc(db, "users", user.uid), { lastOrderAt: fs.serverTimestamp(), updatedAt: fs.serverTimestamp() }, { merge: true });
  try {
    await batch.commit();
    return ref;
  } catch (e) {
    // Retrying a request that already went through is denied by the rate limit; if the order is there, it worked.
    const snap = await fs.getDoc(orderRef).catch(() => null);
    if (snap && snap.exists()) return snap.data().ref;
    throw e;
  }
}

function setCheckoutNote(msg) { showError("#coError", msg); }

async function submitCheckout(e) {
  e.preventDefault();
  if (!FS || !acct?.user) return;
  const payload = checkoutPayload();
  for (const el of coForm.elements) el.removeAttribute?.("aria-invalid");
  const problem = checkCheckout(payload);
  if (problem) { setCheckoutNote(problem); coForm.querySelector('[aria-invalid="true"]')?.focus(); return; }
  if (payload.hp) { showOrderDone({ ref: makeRef(), items: [], total: 0, fulfilment: payload.fulfilment }); return; }   // bots get a fake success
  if (!acct.verified) { setCheckoutNote("Please verify your email first."); return; }
  setCheckoutNote("");
  payload.requestId = requestIdFor(payload);

  const btn = $("#coSubmit");
  let leaving = false;
  setBusy(co, btn, true);
  try {
    if (cardsReady) {            // pay on the spot: save the order, then go straight to the card page
      await writeOrder(payload, "awaiting");
      const r = await callPay({ a: "pay", orderId: `o_${payload.requestId}` });
      if (r.ok && r.url) { leaving = true; location.href = r.url; return; }       // (the basket is emptied when the payment comes back confirmed)
      setCheckoutNote(payError(r));
      return;
    }
    const lines = cartLines();
    const ref = await writeOrder(payload);
    store.sset("pendingOrder", null);
    // remember their phone for next time
    if (payload.customer.phone && payload.customer.phone !== acct.profile.phone) acct.saveProfile({ phone: payload.customer.phone }).catch(() => {});
    const fee = payload.fulfilment === "delivery" ? fulfil().fee : 0;
    const done = {
      ref, fulfilment: payload.fulfilment, deliveryFee: fee, total: payload.estTotal,
      items: lines.map(l => ({ name: l.p.name, qty: l.qty, lineTotal: pence(priceOf(l.p)) * l.qty / 100 })),
    };
    S.cart = {}; saveCart(); drawCart(true);
    showOrderDone(done);
  } catch (err) {
    console.error("[shop] order", err);
    const code = err && err.code;
    if (code === "permission-denied") {
      setCheckoutNote(!acct.verified
        ? "Please verify your email first, then try again."
        : "We couldn't place that order. If you just sent one, please wait about 30 seconds before the next.");
    } else if (code === "unavailable" || code === "deadline-exceeded" || !navigator.onLine) {
      setCheckoutNote("We couldn't reach the shop, so we can't be sure your order went through. Please try again. Trying again won't create a duplicate order.");
    } else {
      setCheckoutNote("Something went wrong on our side. Please try again in a moment.");
    }
  } finally {
    if (!leaving) { setBusy(co, btn, false); drawCheckout(); }
  }
}

function showOrderDone(o) {
  coForm.hidden = true;
  const done = $("#coDone");
  done.hidden = false;
  $("#coRef").textContent = `Order reference ${o.ref}`;
  $("#coDoneSum").innerHTML = `
    ${(o.items || []).map(l => `<div class="sum-row"><span>${esc(l.name)} × ${l.qty}</span><span>${money(l.lineTotal)}</span></div>`).join("")}
    ${o.fulfilment === "delivery" ? `<div class="sum-row"><span>Delivery</span><span>${o.deliveryFee ? money(o.deliveryFee) : "Free"}</span></div>` : ""}
    <div class="sum-row total"><span>Total (not charged)</span><span>${money(o.total)}</span></div>`;
  $("#coFeedback").dataset.ref = o.ref;
  done.querySelector(".btn-primary").focus({ preventScroll: true });
}

/* ── feedback ────────────────────────────────────────── */
const fb = $("#fb");
const fbForm = $("#fbForm");

async function openFeedback(orderRef = "") {
  if (MODE === "live" && acct) {
    const ok = await acct.requireLogin("Sign in to send feedback, so the shop can reply to you.");
    if (!ok) return;
  }
  fbForm.hidden = false;
  $("#fbDone").hidden = true;
  if (orderRef) fbForm.elements.orderRef.value = orderRef;
  if (!fbForm.elements.name.value && acct?.profile.name) fbForm.elements.name.value = acct.profile.name;
  const off = MODE !== "live";
  $("#fbSubmit").disabled = off;
  showError("#fbError", off ? "Feedback is switched off in preview mode." : "");
  openDialog(fb);
}

function paintStars() {
  const r = Number(fbForm.querySelector('input[name="rating"]:checked')?.value || 0);
  $$("#fbStars label").forEach((l, i) => l.classList.toggle("on", i < r));
  $("#fbClear").hidden = !r;
}

async function submitFeedback(e) {
  e.preventDefault();
  if (!FS || !acct?.user) return;
  const v = n => (fbForm.elements[n]?.value || "").trim();
  const rating = Number(fbForm.querySelector('input[name="rating"]:checked')?.value || 0) || null;
  const kind = fbForm.querySelector('input[name="kind"]:checked')?.value || "feedback";
  const payload = { kind, message: v("message"), name: v("name"), orderRef: v("orderRef").toUpperCase(), rating };

  const msgEl = fbForm.elements.message;
  if (payload.message.length < 10) { msgEl.setAttribute("aria-invalid", "true"); showError("#fbError", "Please write at least 10 characters."); msgEl.focus(); return; }
  msgEl.setAttribute("aria-invalid", "false");
  if (payload.orderRef && !/^(BH|PS)-[A-Z0-9]{6}$/.test(payload.orderRef)) { showError("#fbError", "Order references look like BH-ABC234."); fbForm.elements.orderRef.focus(); return; }
  showError("#fbError", "");

  const btn = $("#fbSubmit");
  setBusy(fb, btn, true);
  try {
    if (!v("website")) {                                            // a filled-in hidden field means a bot
      const { db, fs, auth } = FS;
      const user = auth.currentUser;
      const batch = fs.writeBatch(db);
      batch.set(fs.doc(fs.collection(db, "feedback")), {
        uid: user.uid, kind, message: payload.message, rating, name: payload.name, orderRef: payload.orderRef,
        read: false, archived: false, createdAt: fs.serverTimestamp(),
      });
      batch.set(fs.doc(db, "users", user.uid), { lastFeedbackAt: fs.serverTimestamp(), updatedAt: fs.serverTimestamp() }, { merge: true });
      await batch.commit();
    }
    fbForm.reset(); paintStars(); $("#fbCount").textContent = "0 / 1000";
    fbForm.hidden = true;
    $("#fbDone").hidden = false;
    $("#fbDone .btn-primary").focus({ preventScroll: true });
  } catch (err) {
    console.error("[shop] feedback", err);
    const code = err && err.code;
    showError("#fbError",
      code === "permission-denied" ? (acct.verified ? "Please wait a minute before sending another message." : "Please verify your email first, then try again.")
        : code === "unavailable" || !navigator.onLine ? "We couldn't send that. Please check your connection and try again."
        : "Something went wrong on our side. Please try again in a moment.");
  } finally {
    setBusy(fb, btn, false);
    if (MODE !== "live") btn.disabled = true;
  }
}

/* ── wiring ──────────────────────────────────────────── */
/** Called whenever the customer signs in or out (or their profile changes). */
let wasSigned = false;
const RET = (() => {
  const q = new URLSearchParams(location.search);
  const r = q.get("paid") && /^cs_(test|live)_/.test(q.get("sid") || "") ? { id: q.get("paid"), sid: q.get("sid") } : null;
  if (r || q.has("paycancel")) history.replaceState(null, "", location.pathname + location.hash);
  return { pay: r, cancelled: q.has("paycancel") };
})();
let retDone = false;

function onAccountChange(a) {
  if (!retDone && (RET.pay || RET.cancelled) && a.ready !== false) {
    if (RET.cancelled) { retDone = true; toast("Payment cancelled. You can pay any time from My orders."); }
    else if (a.user && a.verified) { retDone = true; finishPay(RET.pay); }
    else if (!a.user) { retDone = true; toast("Sign in to see your payment."); }
  }
  if ($("#co").open && !coForm.hidden) { $("#coEmail").textContent = a.email || "Sign in to order"; drawCheckout(); }
  const signed = !!a.user && a.verified;
  if (signed) {
    wasSigned = true;
    // saved items follow the account: merge what's on this device with what's saved online
    const online = Array.isArray(a.profile.wishlist) ? a.profile.wishlist.filter(x => typeof x === "string") : [];
    const merged = new Set([...online, ...S.wish]);
    if (merged.size !== S.wish.size) { S.wish = merged; store.set("wish", [...S.wish]); }
    if (merged.size !== online.length) syncWish();
    paintWish();
    watchMyAlerts();
  } else if (wasSigned) {            // signed out: don't leave this customer's saved items on a shared device
    wasSigned = false;
    S.wish = new Set(); store.set("wish", []);
    stopMyAlerts();
    render(false);
  }
}

function init() {
  wireDialogs();
  $("#yr").textContent = new Date().getFullYear();
  renderSite();
  showView(false);
  addEventListener("hashchange", () => { if (S.view === "shop") S.y = scrollY; showView(true); });

  // nav gains its glass once the page moves
  const nav = $("#nav");
  const onScroll = () => nav.classList.toggle("scrolled", scrollY > 8);
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  addEventListener("resize", () => { syncNavHeight(); moveIndicator(); paintDock(); });
  document.fonts?.ready.then(() => { syncNavHeight(); moveIndicator(); paintDock(); });
  document.addEventListener("dockchange", paintDock);
  $("#dockCart").addEventListener("click", () => openCart(!$("#drawer").classList.contains("open")));

  // connection status
  const net = () => {
    $("#netbar").hidden = navigator.onLine;
    syncNavHeight();
    if (co.open && !coForm.hidden) drawCheckout();
  };
  addEventListener("online", net);
  addEventListener("offline", net);
  net();

  // categories (tabs, hero tiles, breadcrumb links)
  document.addEventListener("click", e => {
    const b = e.target.closest("main [data-c]"); if (!b) return;
    e.preventDefault();
    pickCat(b.dataset.c, { scroll: b.hasAttribute("data-scroll") });
  });

  // light / dark (light is the default; the choice is remembered on this device)
  const flipTheme = () => {
    const dark = document.documentElement.dataset.theme !== "dark";
    if (dark) document.documentElement.dataset.theme = "dark"; else delete document.documentElement.dataset.theme;
    try { localStorage.setItem("theme", dark ? "dark" : "light"); } catch {}
    paintTheme();
  };
  $("#themeBtn").addEventListener("click", flipTheme);
  $("#themeBtn2").addEventListener("click", flipTheme);
  $("#menuTheme").addEventListener("click", flipTheme);
  paintTheme();

  // search: one box in the header
  const q = $("#q");
  q.addEventListener("input", e => {
    if (S.view !== "shop") location.hash = "#shop";
    setQuery(e.target.value);
  });
  $("#navSearch").addEventListener("submit", e => {
    e.preventDefault();
    clearTimeout(qTimer);
    if (S.view !== "shop") { location.hash = "#shop"; return; }
    render(false); q.blur(); goToShop();
  });
  $("#emptyAction").addEventListener("click", () => { q.value = ""; S.q = ""; clearFilters(); clearTimeout(qTimer); render(false); });

  // sorting + filters
  $("#sort").addEventListener("change", e => { S.sort = e.target.value; render(false); });
  $("#filterBtn").addEventListener("click", () => {
    const open = $("#filters").hidden;
    $("#filters").hidden = !open;
    $("#filterBtn").setAttribute("aria-expanded", String(open));
  });
  const readFilters = () => {
    S.f = { stock: $("#fStock").checked, sale: $("#fSale").checked, saved: $("#fSaved").checked, min: $("#fMin").value, max: $("#fMax").value };
    render(false);
  };
  let fTimer;
  for (const id of ["fStock", "fSale", "fSaved"]) $("#" + id).addEventListener("change", readFilters);
  for (const id of ["fMin", "fMax"]) $("#" + id).addEventListener("input", () => { clearTimeout(fTimer); fTimer = setTimeout(readFilters, 200); });
  $("#fClear").addEventListener("click", () => { clearFilters(); render(false); });

  // product tiles + product page (hearts, bells, add buttons live in several lists)
  document.addEventListener("click", e => {
    const heart = e.target.closest("[data-wish]"); if (heart) { e.preventDefault(); return toggleWish(heart.dataset.wish); }
    const bell = e.target.closest("[data-notify]"); if (bell) { e.preventDefault(); return void toggleAlert(bell.dataset.notify); }
    const add = e.target.closest("[data-add]"); if (add) return void addToCart(add.dataset.add, 1, add);
    if (e.target.closest("[data-share]")) return void shareProduct();
    if (e.target.closest("[data-restock-dismiss]")) return void dismissRestock();
    const step = e.target.closest("[data-pp-step]");
    if (step) {
      const root = $("#pp"), p = find(root.dataset.id); if (!p) return;
      const qty = Math.max(1, Math.min(stockOf(p), Number(root.dataset.qty) + Number(step.dataset.ppStep)));
      root.dataset.qty = qty; $("#ppQty").textContent = qty;
      $('[data-pp-step="-1"]', root).disabled = qty <= 1;
      $('[data-pp-step="1"]', root).disabled = qty >= stockOf(p);
      return;
    }
    if (e.target.closest("[data-pp-add]")) {
      const root = $("#pp"); addToCart(root.dataset.id, Number(root.dataset.qty) || 1, e.target.closest("[data-pp-add]"));
    }
  });

  // basket
  $("#cartBtn").addEventListener("click", () => openCart(true));
  $("#closeCart").addEventListener("click", () => openCart(false));
  $("#scrim").addEventListener("click", () => openCart(false));
  $("#checkout").addEventListener("click", startCheckout);
  $("#cartItems").addEventListener("click", e => {
    if (e.target.closest("[data-close-cart]")) { openCart(false); return; }
    const b = e.target.closest("[data-step]"); if (b) return stepCart(b.dataset.id, +b.dataset.step);
    const r = e.target.closest("[data-remove]");
    if (r) { delete S.cart[r.dataset.remove]; saveCart(); drawCart(true); }
  });
  addEventListener("keydown", e => {
    if (e.key === "Escape" && $("#drawer").classList.contains("open")) openCart(false);
  });

  // account menu extras
  const menuDone = () => { $("#menu").hidden = true; $("#acctBtn").setAttribute("aria-expanded", "false"); $("#dockAcct").setAttribute("aria-expanded", "false"); paintDock(); };
  $("#menuOrders").addEventListener("click", () => { menuDone(); openMyOrders(); });
  $("#menuSaved").addEventListener("click", () => { menuDone(); location.hash = "#/saved"; });
  $("#footOrders").addEventListener("click", openMyOrders);

  // checkout
  coForm.addEventListener("change", e => { if (e.target.name === "how") drawCheckout(); });
  coForm.addEventListener("input", e => {
    e.target.removeAttribute?.("aria-invalid");
    if (!$("#coError").hidden && MODE === "live") showError("#coError", "");
  });
  $("#coAddrBtn").addEventListener("click", () => {
    if (acct) acct.openLocation(() => drawCheckout());
  });
  coForm.addEventListener("submit", submitCheckout);
  $("#coFeedback").addEventListener("click", e => {
    const ref = e.currentTarget.dataset.ref || "";
    closeDialog(co);
    setTimeout(() => openFeedback(ref), reduced.matches ? 0 : 220);
  });
  $("#coOrders").addEventListener("click", () => {
    closeDialog(co);
    setTimeout(openMyOrders, reduced.matches ? 0 : 220);
  });

  // sign-in only exists once Firebase is connected
  if (MODE !== "live") $("#signInBtn").addEventListener("click", () => toast("Sign-in isn't available in preview mode"));

  // feedback
  $("#openFeedback").addEventListener("click", () => openFeedback());
  $("#fbStars").addEventListener("change", paintStars);
  $("#fbClear").addEventListener("click", () => { $$("#fbStars input").forEach(i => (i.checked = false)); paintStars(); });
  $$("#fbStars label").forEach(l => (l.innerHTML = I.star));
  fbForm.elements.message.addEventListener("input", e => ($("#fbCount").textContent = `${e.target.value.length} / 1000`));
  fbForm.addEventListener("input", e => {
    e.target.removeAttribute("aria-invalid");
    if (MODE === "live") showError("#fbError", "");
  });
  fbForm.addEventListener("submit", submitFeedback);

  connect();
}

init();

/* ── self-check: open the page with ?selftest and read the console ── */
if (params.has("selftest")) {
  const ok = (c, m) => console.assert(c, m) ?? (c && console.log("ok:", m));
  const list = PREVIEW.products.map(p => ({ ...p, category: PREVIEW.categories.find(c => c.id === p.categoryId).name }));
  ok(money(2.4) === "£2.40", "money formats GBP");
  ok(money(undefined) === "£0.00", "missing price is £0.00");
  ok(pence(0.1) * 3 === 30, "pence avoids float drift");
  ok(stockOf({}) === Infinity && stockOf({ stock: -2 }) === 0 && stockOf({ stock: "3" }) === 3, "stock parsing");
  const dates = visible(list, { cat: "pv-a", q: "", sort: "lo" });
  ok(dates.length === 2 && dates.every(p => p.categoryId === "pv-a"), "category filter");
  ok(dates.every((p, i) => !i || priceOf(dates[i - 1]) <= priceOf(p)), "price sort ascending (uses the sale price)");
  ok(visible(list, { cat: "All", q: "  JUICE ", sort: "feat" }).map(p => p.id).join() === "pv4", "search is trimmed + case-insensitive");
  ok(visible(list, { cat: "All", q: "", sort: "feat" })[0].featured === true, "featured first");
  ok(visible(list, { cat: "All", q: "", sort: "feat" }).at(-1).id === "pv4", "sold out goes last");
  ok(visible(list, { cat: "All", q: "", sort: "lo", f: { ...noFilters(), sale: true } }).map(p => p.id).join() === "pv1", "sale filter");
  ok(visible(list, { cat: "All", q: "", sort: "lo", f: { ...noFilters(), stock: true } }).every(p => p.stock > 0), "in-stock filter");
  ok(visible(list, { cat: "All", q: "", sort: "lo", f: { ...noFilters(), min: "2", max: "4" } }).map(p => p.id).join() === "pv3,pv5", "price range");
  console.log("selftest done");
}
