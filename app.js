/* Plodroid Store — customer website.
   Products, categories and site copy come live from Firestore (edited by the owner in the admin panel).
   Customers sign in (auth.js); orders and feedback are written straight to Firestore and locked down
   by firestore.rules, so the whole thing runs on the free Firebase plan. */

import { $, $$, esc, store, money, pence, reduced, uid, openDialog, closeDialog, wireDialogs,
         toast, showError, setBusy } from "./ui.js";
import { createAuth } from "./auth.js";
import { normaliseUkPhone, showUkPhone } from "./uk.js";

const DEF = window.STORE_DEFAULTS;
const PATHS = window.STORE_PATHS;
const FB = "https://www.gstatic.com/firebasejs/10.12.2/";

function paintTheme() {
  const dark = document.documentElement.dataset.theme === "dark";
  $("#themeBtn").setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#161616" : "#F4F3EE");
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
  console.warn(`[store] Firebase isn't configured (mode: ${MODE}). Fill in firebase-config.js to go live.` +
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
    { id: "pv1", name: "Medjool Dates 500g", categoryId: "pv-a", price: 6.5, stock: 14, featured: true, description: "Soft, large and naturally sweet." },
    { id: "pv2", name: "Deglet Nour Dates 1kg", categoryId: "pv-a", price: 5.25, stock: 3, description: "Golden, firm and lightly honeyed." },
    { id: "pv3", name: "Sparkling Water 6 × 500ml", categoryId: "pv-b", price: 2.4, stock: 24, description: "Lightly carbonated mineral water." },
    { id: "pv4", name: "Orange Juice 1L", categoryId: "pv-b", price: 1.85, stock: 0, description: "Pressed oranges, no added sugar." },
    { id: "pv5", name: "Basmati Rice 2kg", categoryId: "pv-c", price: 3.9, stock: 18, description: "Long grain, aged for a fluffier cook." },
    { id: "pv6", name: "Olive Oil 750ml", categoryId: "pv-c", price: 6.75, stock: 9, featured: true, unit: "bottle", description: "Cold pressed, fruity and peppery." },
  ].map(p => ({ ...p, visible: true, archived: false })),
};

/* ── helpers ─────────────────────────────────────────── */
const stockOf = p => (p.stock == null || p.stock === "") ? Infinity : Math.max(0, Number(p.stock) || 0);
const lowAt = p => Number.isInteger(p.lowStockThreshold) ? p.lowStockThreshold : 5;

const I = {
  plus:  `<svg class="i-plus" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
  check: `<svg class="i-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 10 17 19 7"/></svg>`,
  grid:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/></svg>`,
  arrow: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>`,
  star:  `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>`,
};

/* ── state ───────────────────────────────────────────── */
const S = {
  products: [],       // raw docs from the backend
  categories: [],     // visible categories, ordered
  site: { ...DEF },
  state: MODE === "unconfigured" ? "unconfigured" : "loading",   // loading | ready | error | unconfigured
  cat: "All", q: "", sort: "feat",
  cart: store.get("cart", {}),
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
function visible(list, { cat, q, sort }) {
  const needle = q.trim().toLowerCase();
  const out = list.filter(p =>
    (cat === "All" || p.categoryId === cat) &&
    (!needle || `${p.name} ${p.category ?? ""} ${p.description ?? ""}`.toLowerCase().includes(needle)));
  const by = {
    lo: (a, b) => a.price - b.price,
    hi: (a, b) => b.price - a.price,
    az: (a, b) => String(a.name).localeCompare(String(b.name)),
    feat: (a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) ||
      (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.name).localeCompare(String(b.name)),
  }[sort];
  return out.sort(by);
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
    const app = initializeApp(window.FIREBASE_CONFIG);
    const db = fs.getFirestore(app);
    FS = { db, fs, auth: au.getAuth(app), au };
    acct = createAuth({ FS, onChange: onAccountChange });

    // If nothing arrives from the server in time, say so instead of showing an empty shop.
    const slow = setTimeout(() => { if (S.state === "loading") { S.state = "error"; render(); } }, 15000);

    let first = true, haveProducts = false, haveCats = false;
    const ready = () => {
      if (!haveProducts || !haveCats) return;
      clearTimeout(slow);
      S.state = "ready";
      render(first);              // live edits after the first paint don't replay entrances
      first = false;
    };
    const onErr = err => {
      console.error("[store]", err);
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
      renderSite();
    }, err => console.error("[store] settings", err));
  } catch (e) {
    console.error("[store]", e);
    S.state = "error";
    render();
  }
}

/* ── site copy ───────────────────────────────────────── */
function renderSite() {
  $$("[data-bind]").forEach(el => {
    const v = S.site[el.dataset.bind];
    if (v != null && v !== "") el.innerHTML = esc(v).replace(/\n/g, "<br>");
  });
  $("#announce").hidden = !S.site.announcement;
  const c = $("#contact");
  c.hidden = !S.site.whatsapp;
  if (S.site.whatsapp) c.href = S.site.whatsapp;
  document.title = S.site.storeName || DEF.storeName;
  syncNavHeight();
}

function syncNavHeight() {
  document.documentElement.style.setProperty("--nav-h", `${$("#nav").offsetHeight}px`);
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
    $("#suggest").innerHTML = [
      ["All", "Shop all products", I.grid],
      ...S.categories.slice(0, 2).map(c => [c.id, `Browse ${c.name.toLowerCase()}`, I.arrow]),
    ].map(([id, label, icon]) =>
      `<li><button type="button" data-c="${esc(id)}">${icon}<span>${esc(label)}</span></button></li>`).join("");
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
  render();
  const active = $$(".tab").find(b => b.dataset.c === c);
  active?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reduced.matches ? "auto" : "smooth" });
  if (scroll) goToShop();
}

const goToShop = () => $("#shop").scrollIntoView({ behavior: reduced.matches ? "auto" : "smooth" });

/* ── catalogue ───────────────────────────────────────── */
function media(p) {
  return p.image
    ? `<img src="${esc(p.image)}" alt="" loading="lazy" decoding="async" data-fallback="${esc((p.name || "?").trim()[0])}">`
    : `<span class="ph" aria-hidden="true">${esc((p.name || "?").trim()[0])}</span>`;
}
const per = p => p.unit && p.unit !== "each" ? `<span class="per"> / ${esc(p.unit)}</span>` : "";

function tile(p) {
  const max = stockOf(p), out = max === 0, low = max > 0 && max <= lowAt(p);
  return `
  <article class="tile${out ? " is-out" : ""}">
    <button class="tile-media" type="button" data-open="${esc(p.id)}" aria-label="View ${esc(p.name)}">
      ${media(p)}${out ? `<span class="flag">Sold out</span>` : ""}
    </button>
    <div class="tile-body">
      <button class="tile-name" type="button" data-open="${esc(p.id)}">${esc(p.name)}</button>
      <div class="tile-meta">${esc(p.category || "")}${low ? `${p.category ? " · " : ""}<span class="low">Only ${max} left</span>` : ""}</div>
      <div class="tile-foot">
        <span class="price">${money(p.price)}${per(p)}</span>
        <button class="add" type="button" data-add="${esc(p.id)}" ${out ? "disabled" : ""}
                aria-label="${out ? `${esc(p.name)} is sold out` : `Add ${esc(p.name)} to basket`}">${I.plus}${I.check}</button>
      </div>
    </div>
  </article>`;
}

const io = new IntersectionObserver(entries => {
  let k = 0;
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    e.target.style.setProperty("--d", `${Math.min(k++, 8) * 40}ms`);
    e.target.classList.add("in");
    io.unobserve(e.target);
  }
}, { rootMargin: "0px 0px -4% 0px" });

function render(animate = true) {
  SHOP = shopProducts();
  renderCats();
  const grid = $("#grid");
  const empty = (title, text, action) => {
    $("#empty").hidden = !title;
    if (!title) return;
    $("#emptyTitle").textContent = title;
    $("#emptyText").textContent = text;
    $("#emptyAction").hidden = !action;
  };

  $("#modeNote").hidden = MODE !== "preview";

  if (S.state === "loading") {
    grid.innerHTML = Array.from({ length: 8 }, () =>
      `<div class="tile in sk" aria-hidden="true"><div class="tile-media"></div><div class="sk-line"></div><div class="sk-line short"></div></div>`).join("");
    $("#resultCount").textContent = "";
    empty();
    return;
  }
  if (S.state === "error" || S.state === "unconfigured") {
    grid.innerHTML = "";
    $("#resultCount").textContent = "";
    S.state === "error"
      ? empty("We couldn't load the shop just now.", "Please check your connection and refresh the page.")
      : empty("The shop is getting ready.", "Products will appear here soon. Please check back later.");
    drawCart();
    return;
  }

  const items = visible(SHOP, S);
  const cat = S.categories.find(c => c.id === S.cat);
  $("#shopTitle").textContent = cat ? cat.name : "All products";
  $("#resultCount").textContent = `${items.length} ${items.length === 1 ? "item" : "items"}`;
  grid.innerHTML = items.map(tile).join("");

  if (!items.length) {
    if (S.q.trim()) empty(`No results for “${S.q.trim()}”`, "Try a different word, or browse all products.", true);
    else if (cat) empty("Nothing in this category yet", "Have a look at all products instead.");
    else empty("No products yet", "New products will appear here as soon as they're added.");
  } else empty();

  $$("img[data-fallback]", grid).forEach(img => img.addEventListener("error", onImgError, { once: true }));
  const tiles = $$(".tile", grid);
  if (animate && !reduced.matches) tiles.forEach(t => io.observe(t));
  else tiles.forEach(t => t.classList.add("in"));

  drawCart();
  if ($("#co").open && !$("#coForm").hidden) drawCheckout();
}

function onImgError(e) {
  const ph = document.createElement("span");
  ph.className = "ph"; ph.setAttribute("aria-hidden", "true");
  ph.textContent = e.target.dataset.fallback;
  e.target.replaceWith(ph);
}

/* ── search (hero + toolbar share one query) ─────────── */
let qTimer;
function setQuery(v, from) {
  S.q = v;
  for (const el of [$("#q"), $("#heroQ")]) if (el !== from) el.value = v;
  $("#heroSearch").classList.toggle("has-text", !!v.trim());
  clearTimeout(qTimer);
  qTimer = setTimeout(render, 120);
}

/* ── basket ──────────────────────────────────────────── */
const saveCart = () => store.set("cart", S.cart);

function addToCart(id, n = 1, btn) {
  const p = find(id); if (!p) return false;
  const have = S.cart[id] || 0, max = stockOf(p);
  if (have >= max) { toast(max === 0 ? "This item is sold out" : "That's all we have of this item"); return false; }
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
const subtotalOf = lines => lines.reduce((t, l) => t + pence(l.p.price) * l.qty, 0) / 100;

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
  $("#cartBtn").setAttribute("aria-label", `Open basket, ${count} ${count === 1 ? "item" : "items"}`);

  $("#cartTotal").textContent = money(subtotalOf(lines));
  $("#checkout").disabled = !lines.length;
  $("#cartItems").innerHTML = lines.length ? lines.map(({ p, qty }) => `
    <div class="line">
      <div class="line-thumb">${media(p)}</div>
      <div class="line-main">
        <div class="line-name">${esc(p.name)}</div>
        <div class="line-unit">${money(p.price)} each</div>
        <div class="stepper">
          <button class="step" type="button" data-id="${esc(p.id)}" data-step="-1" aria-label="Remove one ${esc(p.name)}">−</button>
          <output>${qty}</output>
          <button class="step" type="button" data-id="${esc(p.id)}" data-step="1" aria-label="Add one ${esc(p.name)}" ${qty >= stockOf(p) ? "disabled" : ""}>+</button>
        </div>
      </div>
      <div class="line-end">
        <div class="line-total">${money(pence(p.price) * qty / 100)}</div>
        <button class="line-remove" type="button" data-remove="${esc(p.id)}">Remove</button>
      </div>
    </div>`).join("")
    : `<p class="drawer-empty">Your basket is empty.</p>`;
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
  if (open) setTimeout(() => $("#closeCart").focus({ preventScroll: true }), 60);
  else $("#cartBtn").focus({ preventScroll: true });
}

/* ── product dialog ──────────────────────────────────── */
const pd = $("#pd");

function openProduct(id) {
  const p = find(id); if (!p) return;
  const max = stockOf(p);
  const stock = max === Infinity ? "" : max === 0 ? "Sold out" : max <= lowAt(p) ? `Only ${max} left` : "In stock";
  pd.dataset.id = id;
  pd.dataset.qty = "1";
  $("#pdBody").innerHTML = `
    <div class="pd-media">${media(p)}</div>
    <div class="pd-info">
      ${p.category ? `<div class="pd-cat">${esc(p.category)}</div>` : ""}
      <h2 class="pd-name" id="pdName">${esc(p.name)}</h2>
      <div class="pd-price">${money(p.price)}${per(p)}</div>
      ${stock ? `<div class="pd-stock">${stock}</div>` : ""}
      ${p.description ? `<p class="pd-desc">${esc(p.description)}</p>` : ""}
      <div class="pd-actions">
        <div class="stepper">
          <button class="step" type="button" data-pd-step="-1" aria-label="Decrease quantity" disabled>−</button>
          <output id="pdQty">1</output>
          <button class="step" type="button" data-pd-step="1" aria-label="Increase quantity" ${max <= 1 ? "disabled" : ""}>+</button>
        </div>
        <button class="btn-primary" type="button" data-pd-add ${max === 0 ? "disabled" : ""}>${max === 0 ? "Sold out" : "Add to basket"}</button>
      </div>
    </div>`;
  $$("img[data-fallback]", pd).forEach(img => img.addEventListener("error", onImgError, { once: true }));
  openDialog(pd);
}

pd.addEventListener("click", e => {
  const step = e.target.closest("[data-pd-step]");
  if (step) {
    const p = find(pd.dataset.id); if (!p) return;
    const max = stockOf(p);
    const q = Math.max(1, Math.min(max, +pd.dataset.qty + +step.dataset.pdStep));
    pd.dataset.qty = q;
    $("#pdQty").textContent = q;
    $('[data-pd-step="-1"]', pd).disabled = q <= 1;
    $('[data-pd-step="1"]', pd).disabled = q >= max;
    return;
  }
  if (e.target.closest("[data-pd-add]") && addToCart(pd.dataset.id, +pd.dataset.qty)) closeDialog(pd);
});

/* ── checkout ────────────────────────────────────────── */
const co = $("#co");
const coForm = $("#coForm");
const fulfil = () => {
  const s = S.site;
  const fee = Number(s.deliveryFee);
  return { collection: s.collection !== false, delivery: s.delivery === true, fee: Number.isFinite(fee) && fee > 0 ? fee : 0 };
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
        <span>${label}</span><span class="fee">${fee}</span></label>`).join("")
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
    `<div class="sum-row"><span>${esc(l.p.name)} × ${l.qty}</span><span>${money(pence(l.p.price) * l.qty / 100)}</span></div>`).join("");
  $("#coSum").innerHTML = `
    <div class="sum-row"><span>Subtotal</span><span>${money(sub)}</span></div>
    ${how === "delivery" ? `<div class="sum-row"><span>Delivery</span><span>${fee ? money(fee) : "Free"}</span></div>` : ""}
    <div class="sum-row total"><span>Total</span><span>${money(sub + fee)}</span></div>
    <p class="sum-note">The shop confirms prices and stock when it accepts your order.</p>`;

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
  return "PS-" + [...b].map(x => REF_ALPHABET[x % REF_ALPHABET.length]).join("");
};

/** Writes the order + the rate-limit stamp in one batch. Prices are NOT sent: the owner re-prices on confirm. */
async function writeOrder(p) {
  const { db, fs, auth } = FS;
  const user = auth.currentUser;
  const orderRef = fs.doc(db, "orders", `o_${p.requestId}`);
  const ref = makeRef();
  const doc = {
    uid: user.uid, ref, requestId: p.requestId, status: "new", paymentStatus: "mock", isTest: true,
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
  setBusy(co, btn, true);
  try {
    const lines = cartLines();
    const ref = await writeOrder(payload);
    store.sset("pendingOrder", null);
    // remember their phone for next time
    if (payload.customer.phone && payload.customer.phone !== acct.profile.phone) acct.saveProfile({ phone: payload.customer.phone }).catch(() => {});
    const fee = payload.fulfilment === "delivery" ? fulfil().fee : 0;
    const done = {
      ref, fulfilment: payload.fulfilment, deliveryFee: fee, total: payload.estTotal,
      items: lines.map(l => ({ name: l.p.name, qty: l.qty, lineTotal: pence(l.p.price) * l.qty / 100 })),
    };
    S.cart = {}; saveCart(); drawCart(true);
    showOrderDone(done);
  } catch (err) {
    console.error("[store] order", err);
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
    setBusy(co, btn, false);
    drawCheckout();
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
  if (payload.orderRef && !/^PS-[A-Z0-9]{6}$/.test(payload.orderRef)) { showError("#fbError", "Order references look like PS-ABC234."); fbForm.elements.orderRef.focus(); return; }
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
    console.error("[store] feedback", err);
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
let adminMod = null;
function onAccountChange(a) {
  if ($("#co").open && !coForm.hidden) { $("#coEmail").textContent = a.email || "Sign in to order"; drawCheckout(); }
  // the owner gets the admin panel (loaded only for them) and live alerts
  if (a.isOwner && !adminMod) {
    adminMod = import("./admin.js").then(m => { m.watchAlerts({ FS, acct: a, getSite: () => S.site }); return m; })
      .catch(err => { console.error("[admin]", err); adminMod = null; });
  } else if (!a.isOwner && adminMod) {
    const p = adminMod; adminMod = null;
    p.then(m => m && m.stopAlerts()).catch(() => {});
  }
}

function init() {
  wireDialogs();
  $("#yr").textContent = new Date().getFullYear();
  renderSite();
  render();

  // nav gains its glass once the page moves
  const nav = $("#nav");
  const onScroll = () => nav.classList.toggle("scrolled", scrollY > 8);
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  addEventListener("resize", () => { syncNavHeight(); moveIndicator(); });
  document.fonts?.ready.then(() => { syncNavHeight(); moveIndicator(); });

  // connection status
  const net = () => {
    $("#netbar").hidden = navigator.onLine;
    syncNavHeight();
    if (co.open && !coForm.hidden) drawCheckout();
  };
  addEventListener("online", net);
  addEventListener("offline", net);
  net();

  // categories
  $("#catList").addEventListener("click", e => {
    const b = e.target.closest("[data-c]"); if (b) pickCat(b.dataset.c);
  });
  $("#suggest").addEventListener("click", e => {
    const b = e.target.closest("[data-c]"); if (b) pickCat(b.dataset.c, { scroll: true });
  });

  // light / dark (light is the default; the choice is remembered on this device)
  $("#themeBtn").addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme !== "dark";
    if (dark) document.documentElement.dataset.theme = "dark"; else delete document.documentElement.dataset.theme;
    try { localStorage.setItem("theme", dark ? "dark" : "light"); } catch {}
    paintTheme();
  });
  paintTheme();

  // search
  $("#q").addEventListener("input", e => setQuery(e.target.value, e.target));
  $("#heroQ").addEventListener("input", e => setQuery(e.target.value, e.target));
  $("#heroSearch").addEventListener("submit", e => {
    e.preventDefault();
    clearTimeout(qTimer); render();
    $("#heroQ").blur();
    goToShop();
  });
  $("#navSearch").addEventListener("click", () => {
    goToShop();
    setTimeout(() => $("#q").focus({ preventScroll: true }), reduced.matches ? 0 : 450);
  });
  $("#emptyAction").addEventListener("click", () => { setQuery(""); clearTimeout(qTimer); render(); $("#q").focus(); });
  $("#sort").addEventListener("change", e => { S.sort = e.target.value; render(); });

  // catalogue
  $("#grid").addEventListener("click", e => {
    const add = e.target.closest("[data-add]");
    if (add) return addToCart(add.dataset.add, 1, add);
    const open = e.target.closest("[data-open]");
    if (open) openProduct(open.dataset.open);
  });

  // basket
  $("#cartBtn").addEventListener("click", () => openCart(true));
  $("#closeCart").addEventListener("click", () => openCart(false));
  $("#scrim").addEventListener("click", () => openCart(false));
  $("#checkout").addEventListener("click", startCheckout);
  $("#cartItems").addEventListener("click", e => {
    const b = e.target.closest("[data-step]"); if (b) return stepCart(b.dataset.id, +b.dataset.step);
    const r = e.target.closest("[data-remove]");
    if (r) { delete S.cart[r.dataset.remove]; saveCart(); drawCart(true); }
  });
  addEventListener("keydown", e => {
    if (e.key === "Escape" && $("#drawer").classList.contains("open")) openCart(false);
  });

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

  // sign-in only exists once Firebase is connected
  if (MODE !== "live") $("#signInBtn").addEventListener("click", () => toast("Sign-in isn't available in preview mode"));

  // owner admin panel
  $("#manageBtn").addEventListener("click", async () => {
    try { const m = await adminMod; if (m) m.openAdmin({ FS, acct, getSite: () => S.site }); else toast("The admin panel is still loading…"); }
    catch { toast("Couldn't open the admin panel. Please refresh."); }
  });

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
  ok(dates.every((p, i) => !i || dates[i - 1].price <= p.price), "price sort ascending");
  ok(visible(list, { cat: "All", q: "  JUICE ", sort: "feat" }).map(p => p.id).join() === "pv4", "search is trimmed + case-insensitive");
  ok(visible(list, { cat: "All", q: "", sort: "feat" })[0].featured === true, "featured first");
  console.log("selftest done");
}
