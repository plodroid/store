/* Storefront: renders products + site copy. Reads live from Firestore once
   firebase-config.js has real keys; until then it shows labelled samples. */

const DEF = window.STORE_DEFAULTS;
const PATHS = window.STORE_PATHS;
const FB = "https://www.gstatic.com/firebasejs/10.12.2/";

/* ── MOCK DATA — placeholder products and prices for previewing the design.
      Not real stock, not real prices. Only used while Firebase isn't set up. */
const SAMPLE = [
  { id: "s1",  name: "Medjool Dates 500g",        category: "Dates",     price: 6.50, stock: 14, featured: true, description: "Soft, large and naturally sweet." },
  { id: "s2",  name: "Deglet Nour Dates 1kg",     category: "Dates",     price: 5.25, stock: 3,  description: "Golden, firm and lightly honeyed." },
  { id: "s3",  name: "Stuffed Dates with Almonds", category: "Dates",    price: 4.80, stock: 9,  description: "Whole dates filled with a roasted almond." },
  { id: "s4",  name: "Sparkling Water 6 × 500ml", category: "Drinks",    price: 2.40, stock: 24, description: "Lightly carbonated mineral water." },
  { id: "s5",  name: "Orange Juice 1L",           category: "Drinks",    price: 1.85, stock: 0,  description: "Pressed oranges, no added sugar." },
  { id: "s6",  name: "Mango Nectar 1L",           category: "Drinks",    price: 1.95, stock: 11, featured: true, description: "Thick, smooth and very mango." },
  { id: "s7",  name: "Basmati Rice 2kg",          category: "Groceries", price: 3.90, stock: 18, description: "Long grain, aged for a fluffier cook." },
  { id: "s8",  name: "Extra Virgin Olive Oil 750ml", category: "Groceries", price: 6.75, stock: 9, featured: true, description: "Cold pressed, fruity and peppery." },
  { id: "s9",  name: "Mint Green Tea, 80 bags",   category: "Groceries", price: 2.95, stock: 16, description: "Gunpowder green tea with spearmint." },
  { id: "s10", name: "Mixed Nuts 400g",           category: "Food",      price: 4.50, stock: 20, description: "Almonds, cashews, hazelnuts and walnuts." },
  { id: "s11", name: "Flatbreads, pack of 4",     category: "Food",      price: 1.60, stock: 5,  description: "Soft and ready to warm." },
  { id: "s12", name: "Harissa Paste 190g",        category: "Food",      price: 2.20, stock: 12, description: "Roasted red pepper and chilli." },
];

/* ── helpers ─────────────────────────────────────────── */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const store = {
  get(k, f) { try { return JSON.parse(localStorage.getItem(k)) ?? f; } catch { return f; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
const money = v => gbp.format(Number(v) || 0);
const stockOf = p => (p.stock == null || p.stock === "") ? Infinity : Math.max(0, Number(p.stock) || 0);
const reduced = matchMedia("(prefers-reduced-motion: reduce)");

const I = {
  plus:  `<svg class="i-plus" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
  check: `<svg class="i-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 10 17 19 7"/></svg>`,
  grid:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/></svg>`,
  arrow: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>`,
};

/* ── state ───────────────────────────────────────────── */
const S = {
  products: [],
  site: { ...DEF },
  state: "loading",          // loading | ready | error
  sample: false,
  cat: "All", q: "", sort: "feat",
  cart: store.get("cart", {}),
  catKey: "",
};
const find = id => S.products.find(p => p.id === id);

/* Pure: filter + sort. Kept separate so the self-check can exercise it. */
function visible(list, { cat, q, sort }) {
  const needle = q.trim().toLowerCase();
  const out = list.filter(p =>
    (cat === "All" || p.category === cat) &&
    (!needle || `${p.name} ${p.category ?? ""} ${p.description ?? ""}`.toLowerCase().includes(needle)));
  const by = {
    lo: (a, b) => a.price - b.price,
    hi: (a, b) => b.price - a.price,
    az: (a, b) => String(a.name).localeCompare(String(b.name)),
    feat: (a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || (a.order ?? 0) - (b.order ?? 0),
  }[sort];
  return out.sort(by);
}

/* ── data ────────────────────────────────────────────── */
function configured() {
  const c = window.FIREBASE_CONFIG || {};
  return !!c.projectId && !String(c.projectId).startsWith("PASTE");
}

async function connect() {
  if (!configured()) {
    Object.assign(S, { products: SAMPLE, state: "ready", sample: true });
    render();
    return;
  }
  try {
    const [{ initializeApp }, { getFirestore, collection, doc, onSnapshot }] = await Promise.all([
      import(FB + "firebase-app.js"), import(FB + "firebase-firestore.js"),
    ]);
    const db = getFirestore(initializeApp(window.FIREBASE_CONFIG));

    let first = true;
    onSnapshot(collection(db, PATHS.products), snap => {
      S.products = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => p.active !== false);
      S.state = "ready";
      render(first);            // live edits after the first load shouldn't replay entrances
      first = false;
    }, err => { console.error(err); if (S.state !== "ready") { S.state = "error"; render(); } });

    onSnapshot(doc(db, PATHS.settings, PATHS.siteDoc), snap => {
      if (snap.exists()) { S.site = { ...DEF, ...snap.data() }; renderSite(); }
    }, err => console.error(err));
  } catch (e) {
    console.error(e);
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
  const cats = ["All", ...new Set(S.products.map(p => p.category).filter(Boolean))];
  if (!cats.includes(S.cat)) S.cat = "All";

  const key = cats.join("\u0000");
  if (key !== S.catKey) {
    S.catKey = key;
    $("#catList").replaceChildren($("#tabInd"), ...cats.map(c => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "tab"; b.dataset.c = c; b.textContent = c;
      return b;
    }));
    $("#suggest").innerHTML = [
      ["All", "Shop all products", I.grid],
      ...cats.slice(1, 3).map(c => [c, `Browse ${c.toLowerCase()}`, I.arrow]),
    ].map(([c, label, icon]) =>
      `<li><button type="button" data-c="${esc(c)}">${icon}<span>${esc(label)}</span></button></li>`).join("");
  }
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

function tile(p) {
  const max = stockOf(p), out = max === 0, low = max > 0 && max <= 5;
  return `
  <article class="tile${out ? " is-out" : ""}">
    <button class="tile-media" type="button" data-open="${esc(p.id)}" aria-label="View ${esc(p.name)}">
      ${media(p)}${out ? `<span class="flag">Sold out</span>` : ""}
    </button>
    <div class="tile-body">
      <button class="tile-name" type="button" data-open="${esc(p.id)}">${esc(p.name)}</button>
      <div class="tile-meta">${esc(p.category || "")}${low ? ` · <span class="low">Only ${max} left</span>` : ""}</div>
      <div class="tile-foot">
        <span class="price">${money(p.price)}</span>
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
  renderCats();
  const grid = $("#grid");
  const empty = (title, text, action) => {
    $("#empty").hidden = !title;
    if (!title) return;
    $("#emptyTitle").textContent = title;
    $("#emptyText").textContent = text;
    $("#emptyAction").hidden = !action;
  };

  $("#sampleNote").hidden = !S.sample;

  if (S.state === "loading") {
    grid.innerHTML = Array.from({ length: 8 }, () =>
      `<div class="tile in sk" aria-hidden="true"><div class="tile-media"></div><div class="sk-line"></div><div class="sk-line short"></div></div>`).join("");
    $("#resultCount").textContent = "";
    empty();
    return;
  }
  if (S.state === "error") {
    grid.innerHTML = "";
    $("#resultCount").textContent = "";
    empty("We couldn't load the products just now.", "Please refresh the page to try again.");
    return;
  }

  const items = visible(S.products, S);
  $("#shopTitle").textContent = S.cat === "All" ? "All products" : S.cat;
  $("#resultCount").textContent = `${items.length} ${items.length === 1 ? "item" : "items"}`;
  grid.innerHTML = items.map(tile).join("");

  if (!items.length) {
    S.q.trim()
      ? empty(`No results for “${S.q.trim()}”`, "Try a different word, or browse all products.", true)
      : empty("Nothing here yet", "Check back soon.");
  } else empty();

  $$("img[data-fallback]", grid).forEach(img => img.addEventListener("error", onImgError, { once: true }));
  const tiles = $$(".tile", grid);
  if (animate && !reduced.matches) tiles.forEach(t => io.observe(t));
  else tiles.forEach(t => t.classList.add("in"));

  drawCart();
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

function drawCart(bump = false) {
  // keep the basket honest against current stock (only once real data is in)
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
  const total = lines.reduce((t, l) => t + Number(l.p.price || 0) * l.qty, 0);

  const c = $("#cartCount");
  c.textContent = count;
  if (bump && !reduced.matches) { c.classList.remove("bump"); c.offsetWidth; c.classList.add("bump"); }
  $("#cartBtn").setAttribute("aria-label", `Open basket, ${count} ${count === 1 ? "item" : "items"}`);

  $("#cartTotal").textContent = money(total);
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
      <div class="line-total">${money(p.price * qty)}</div>
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

function checkout() {
  const lines = cartLines();
  if (!lines.length) return;
  if (!S.site.whatsapp) { toast("Online ordering isn't available yet"); return; }
  const total = lines.reduce((t, l) => t + Number(l.p.price || 0) * l.qty, 0);
  const text = [
    `Hi! I'd like to order from ${S.site.storeName}:`, "",
    ...lines.map(l => `• ${l.p.name} × ${l.qty} — ${money(l.p.price * l.qty)}`),
    "", `Total: ${money(total)}`,
  ].join("\n");
  const base = S.site.whatsapp.split("?")[0];
  window.open(`${base}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
}

/* ── product dialog ──────────────────────────────────── */
const pd = $("#pd");

function openProduct(id) {
  const p = find(id); if (!p) return;
  const max = stockOf(p);
  const stock = max === Infinity ? "" : max === 0 ? "Sold out" : max <= 5 ? `Only ${max} left` : "In stock";
  pd.dataset.id = id;
  pd.dataset.qty = "1";
  $("#pdBody").innerHTML = `
    <div class="pd-media">${media(p)}</div>
    <div class="pd-info">
      ${p.category ? `<div class="pd-cat">${esc(p.category)}</div>` : ""}
      <h2 class="pd-name" id="pdName">${esc(p.name)}</h2>
      <div class="pd-price">${money(p.price)}</div>
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
  pd.showModal();
  requestAnimationFrame(() => pd.classList.add("open"));
}

function closeProduct() {
  if (!pd.open) return;
  pd.classList.remove("open");
  setTimeout(() => pd.close(), reduced.matches ? 0 : 200);
}

pd.addEventListener("cancel", e => { e.preventDefault(); closeProduct(); });
pd.addEventListener("click", e => {
  if (e.target === pd || e.target.closest("[data-close]")) return closeProduct();
  const step = e.target.closest("[data-pd-step]");
  if (step) {
    const p = find(pd.dataset.id), max = stockOf(p);
    const q = Math.max(1, Math.min(max, +pd.dataset.qty + +step.dataset.pdStep));
    pd.dataset.qty = q;
    $("#pdQty").textContent = q;
    $('[data-pd-step="-1"]', pd).disabled = q <= 1;
    $('[data-pd-step="1"]', pd).disabled = q >= max;
    return;
  }
  if (e.target.closest("[data-pd-add]") && addToCart(pd.dataset.id, +pd.dataset.qty)) closeProduct();
});

/* ── toast ───────────────────────────────────────────── */
let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1800);
}

/* ── wiring ──────────────────────────────────────────── */
function init() {
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

  // categories
  $("#catList").addEventListener("click", e => {
    const b = e.target.closest("[data-c]"); if (b) pickCat(b.dataset.c);
  });
  $("#suggest").addEventListener("click", e => {
    const b = e.target.closest("[data-c]"); if (b) pickCat(b.dataset.c, { scroll: true });
  });

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
  $("#checkout").addEventListener("click", checkout);
  $("#cartItems").addEventListener("click", e => {
    const b = e.target.closest("[data-step]"); if (b) stepCart(b.dataset.id, +b.dataset.step);
  });
  addEventListener("keydown", e => {
    if (e.key === "Escape" && $("#drawer").classList.contains("open")) openCart(false);
  });

  connect();
}

init();

/* ── self-check: open the page with ?selftest and read the console ── */
if (new URLSearchParams(location.search).has("selftest")) {
  const ok = (c, m) => console.assert(c, m) ?? (c && console.log("ok:", m));
  ok(money(2.4) === "£2.40", "money formats GBP");
  ok(money(undefined) === "£0.00", "missing price is £0.00");
  ok(stockOf({}) === Infinity && stockOf({ stock: -2 }) === 0 && stockOf({ stock: "3" }) === 3, "stock parsing");
  const dates = visible(SAMPLE, { cat: "Dates", q: "", sort: "lo" });
  ok(dates.length === 3 && dates.every(p => p.category === "Dates"), "category filter");
  ok(dates.every((p, i) => !i || dates[i - 1].price <= p.price), "price sort ascending");
  ok(visible(SAMPLE, { cat: "All", q: "  JUICE ", sort: "feat" }).map(p => p.id).join() === "s5", "search is trimmed + case-insensitive");
  ok(visible(SAMPLE, { cat: "All", q: "", sort: "feat" })[0].featured === true, "featured first");
  console.log("selftest done");
}
