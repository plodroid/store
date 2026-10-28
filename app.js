import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, doc, onSnapshot }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ══ state ══════════════════════════════════════════════════ */
const S = {
  products: [],
  site: { ...window.STORE_DEFAULTS },
  cat: "All",
  q: "",
  sort: "feat",
  cur: localStorage.getItem("cur") || window.STORE_DEFAULTS.currency,
  cart: JSON.parse(localStorage.getItem("cart") || "{}"),
};

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ══ money ══════════════════════════════════════════════════ */
const SYM = { DZD: "DZD", GBP: "£", USD: "$" };

function money(dzd, cur = S.cur) {
  const rate = (S.site.rates || window.STORE_DEFAULTS.rates)[cur] ?? 1;
  const v = Number(dzd || 0) * rate;
  if (cur === "DZD") return `${Math.round(v).toLocaleString("en-US").replace(/,/g, " ")} DZD`;
  return `${SYM[cur]}${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/* ══ demo fallback — only used until Firebase is configured ══ */
const DEMO = [
  { id: "d1", name: "Espresso Beans 1kg",     price: 2400, category: "Grocery",     stock: 18, featured: true,  image: "https://images.unsplash.com/photo-1559056199-641a0ac8b55e?w=600&q=70", description: "Dark roast, ground to order at the counter." },
  { id: "d2", name: "Wireless Earbuds Pro",   price: 11900, category: "Electronics", stock: 6,  featured: true,  image: "https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=600&q=70", description: "Active noise cancelling, 28h with the case." },
  { id: "d3", name: "Ceramic Pour-Over",      price: 3600, category: "Home",        stock: 11, image: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=600&q=70", description: "Slow brew, zero electricity." },
  { id: "d4", name: "Mechanical Keyboard 65%", price: 16500, category: "Electronics", stock: 0, image: "https://images.unsplash.com/photo-1618384887929-16ec33fab9ef?w=600&q=70", description: "Hot-swap switches, gasket mount." },
  { id: "d5", name: "Canvas Tote",            price: 1800, category: "Apparel",     stock: 34, image: "https://images.unsplash.com/photo-1544816155-12df9643f363?w=600&q=70", description: "Heavy cotton, takes a beating." },
  { id: "d6", name: "Desk Lamp — Warm",       price: 5400, category: "Home",        stock: 9,  featured: true, image: "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=600&q=70", description: "Stepless dimming down to candlelight." },
  { id: "d7", name: "Matte Sunglasses",       price: 4200, category: "Apparel",     stock: 15, image: "https://images.unsplash.com/photo-1511499767150-a48a237f0083?w=600&q=70", description: "Polarised, UV400." },
  { id: "d8", name: "Loose Leaf Tea Tin",     price: 1500, category: "Grocery",     stock: 22, image: "https://images.unsplash.com/photo-1564890369478-c89ca6d9cde9?w=600&q=70", description: "Mint and green, loose, 120g." },
];

/* ══ firebase ═══════════════════════════════════════════════ */
function configured() {
  const c = window.FIREBASE_CONFIG || {};
  return c.projectId && !String(c.projectId).startsWith("PASTE");
}

function connect() {
  if (!configured()) {
    S.products = DEMO;
    setConn("demo mode — add your Firebase keys", false);
    render(); renderSettings();
    return;
  }
  try {
    const db = getFirestore(initializeApp(window.FIREBASE_CONFIG));
    const P = window.STORE_PATHS;

    onSnapshot(collection(db, P.products), snap => {
      S.products = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(p => p.active !== false);
      setConn("live", true);
      stamp();
      render();
    }, err => {
      console.error(err);
      S.products = DEMO;
      setConn("offline — showing samples", false);
      render();
    });

    onSnapshot(doc(db, P.settings, P.siteDoc), snap => {
      if (snap.exists()) S.site = { ...window.STORE_DEFAULTS, ...snap.data() };
      renderSettings(); render();
    }, () => {});
  } catch (e) {
    console.error(e);
    S.products = DEMO;
    setConn("config error — showing samples", false);
    render(); renderSettings();
  }
}

const setConn = (t, ok) => {
  const el = $("#connState");
  if (el) { el.textContent = t; el.previousElementSibling.style.background = ok ? "#4ade80" : "#FFB020"; }
};
const stamp = () => {
  const el = $("#lastSync");
  if (el) el.textContent = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
};

/* ══ settings → DOM ═════════════════════════════════════════ */
function renderSettings() {
  $$("[data-bind]").forEach(el => {
    const v = S.site[el.dataset.bind];
    if (v != null && v !== "") el.innerHTML = esc(v).replace(/\n/g, "<br>");
  });
  $$("[data-bind-href]").forEach(el => {
    const v = S.site[el.dataset.bindHref];
    if (v) el.href = v;
  });
  const dl = $("#dlBtn"); if (dl && S.site.downloadUrl) dl.href = S.site.downloadUrl;
  const a = $("#announce");
  if (a) a.classList.toggle("hidden", !S.site.announcement);
  document.title = `${S.site.storeName} — ${S.site.tagline}`;
}

/* ══ products ═══════════════════════════════════════════════ */
function visible() {
  const q = S.q.trim().toLowerCase();
  let out = S.products.filter(p =>
    (S.cat === "All" || p.category === S.cat) &&
    (!q || `${p.name} ${p.category} ${p.description || ""}`.toLowerCase().includes(q)));

  const by = {
    lo: (a, b) => a.price - b.price,
    hi: (a, b) => b.price - a.price,
    az: (a, b) => String(a.name).localeCompare(String(b.name)),
    feat: (a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || (a.order ?? 0) - (b.order ?? 0),
  }[S.sort];
  return out.sort(by);
}

function render() {
  const grid = $("#grid"); if (!grid) return;
  const items = visible();

  // category pills
  const cats = ["All", ...new Set(S.products.map(p => p.category).filter(Boolean))];
  $("#cats").innerHTML = cats.map(c =>
    `<button class="pill rounded-full px-4 py-[7px]" data-c="${esc(c)}" aria-pressed="${c === S.cat}">${esc(c)}</button>`).join("");

  $("#statSku").textContent = S.products.length || "—";
  $("#empty").classList.toggle("hidden", items.length > 0);

  grid.innerHTML = items.map((p, i) => {
    const out = Number(p.stock) <= 0;
    const low = !out && Number(p.stock) <= 5;
    return `
    <article class="tile rv" data-d="${(i % 5) + 1}">
      <div class="shot">
        ${p.image
          ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" decoding="async"
                  onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'w-full h-full skel'}))">`
          : `<div class="w-full h-full skel"></div>`}
        ${out ? `<div class="absolute inset-0 grid place-items-center" style="background:rgba(6,7,12,.66);backdrop-filter:blur(2px)">
                   <span class="text-[11.5px] uppercase tracking-[.16em] text-white/75">Sold out</span></div>` : ""}
        ${p.featured && !out ? `<span class="absolute top-3 left-3 text-[10px] uppercase tracking-[.14em] px-2.5 py-1 rounded-full"
             style="background:linear-gradient(100deg,rgba(76,141,255,.9),rgba(138,92,246,.9))">Pick</span>` : ""}
      </div>

      <div class="pt-4">
        <div class="text-[11px] uppercase tracking-[.14em] text-white/32">${esc(p.category || "Shop")}</div>
        <h3 class="font-display font-semibold text-[15.5px] leading-snug mt-1.5">${esc(p.name)}</h3>
        ${p.description ? `<p class="text-white/38 text-[12.5px] mt-1.5 leading-relaxed line-clamp-2">${esc(p.description)}</p>` : ""}
        <div class="flex items-end justify-between gap-3 mt-3.5">
          <div>
            <div class="font-display font-bold text-[17px] tabular-nums">${money(p.price)}</div>
            <div class="text-[11px] mt-0.5 ${out ? "text-white/28" : low ? "text-amber" : "text-white/32"}">
              ${out ? "Back soon" : low ? `Only ${p.stock} left` : `${p.stock} in stock`}
            </div>
          </div>
          <button class="add pill rounded-full w-9 h-9 grid place-items-center shrink-0 disabled:opacity-25 disabled:cursor-not-allowed"
                  data-id="${esc(p.id)}" ${out ? "disabled" : ""} aria-label="Add ${esc(p.name)} to basket">
            <svg class="w-[15px] h-[15px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
          </button>
        </div>
      </div>
    </article>`;
  }).join("");

  observe(grid);
  drawCart();
}

/* ══ basket ═════════════════════════════════════════════════ */
const save = () => localStorage.setItem("cart", JSON.stringify(S.cart));

function addToCart(id) {
  const p = S.products.find(x => x.id === id); if (!p) return;
  const have = S.cart[id] || 0;
  if (have >= Number(p.stock)) return toast("That's all the stock there is");
  S.cart[id] = have + 1; save(); drawCart(); toast(`${p.name} added`);
}

function drawCart() {
  const n = Object.values(S.cart).reduce((a, b) => a + b, 0);
  $("#cartCount").textContent = n;

  const lines = Object.entries(S.cart)
    .map(([id, qty]) => ({ p: S.products.find(x => x.id === id), qty }))
    .filter(l => l.p);

  const total = lines.reduce((t, l) => t + l.p.price * l.qty, 0);
  $("#cartTotal").textContent = money(total);

  $("#cartItems").innerHTML = lines.length ? lines.map(({ p, qty }) => `
    <div class="flex gap-3.5">
      <div class="w-14 h-14 rounded-xl overflow-hidden shrink-0 border border-white/[.08]">
        ${p.image ? `<img src="${esc(p.image)}" alt="" class="w-full h-full object-cover">` : `<div class="w-full h-full skel"></div>`}
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-[13.5px] font-medium truncate">${esc(p.name)}</div>
        <div class="text-[12px] text-white/40 tabular-nums mt-0.5">${money(p.price)}</div>
        <div class="flex items-center gap-2 mt-2">
          <button class="qty pill rounded-full w-6 h-6 grid place-items-center text-[14px] leading-none" data-id="${esc(p.id)}" data-step="-1" aria-label="Less">−</button>
          <span class="text-[13px] tabular-nums w-4 text-center">${qty}</span>
          <button class="qty pill rounded-full w-6 h-6 grid place-items-center text-[14px] leading-none" data-id="${esc(p.id)}" data-step="1" aria-label="More">+</button>
        </div>
      </div>
      <div class="text-[13.5px] font-semibold tabular-nums shrink-0">${money(p.price * qty)}</div>
    </div>
    <div class="rule"></div>`).join("")
    : `<p class="text-white/32 text-[13.5px] text-center py-16">Nothing in here yet.</p>`;
}

function stepQty(id, step) {
  const p = S.products.find(x => x.id === id); if (!p) return;
  const next = (S.cart[id] || 0) + step;
  if (next <= 0) delete S.cart[id];
  else if (next > Number(p.stock)) return toast("That's all the stock there is");
  else S.cart[id] = next;
  save(); drawCart();
}

function checkout() {
  const lines = Object.entries(S.cart)
    .map(([id, qty]) => ({ p: S.products.find(x => x.id === id), qty })).filter(l => l.p);
  if (!lines.length) return toast("Your basket is empty");

  const total = lines.reduce((t, l) => t + l.p.price * l.qty, 0);
  const body = [
    `Order from ${S.site.storeName}`, "",
    ...lines.map(l => `• ${l.p.name} ×${l.qty} — ${money(l.p.price * l.qty, "DZD")}`),
    "", `Total: ${money(total, "DZD")}`,
  ].join("\n");

  const base = (S.site.whatsapp || "").split("?")[0];
  window.open(`${base}?text=${encodeURIComponent(body)}`, "_blank", "noopener");
}

let tt;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.style.opacity = 1; el.style.transform = "translate(-50%,0)";
  clearTimeout(tt);
  tt = setTimeout(() => { el.style.opacity = 0; el.style.transform = "translate(-50%,12px)"; }, 1900);
}

/* ══ scroll reveal — reverses on the way back up ════════════ */
const io = new IntersectionObserver(
  es => es.forEach(e => e.target.classList.toggle("in", e.isIntersecting)),
  { rootMargin: "-6% 0px -8% 0px", threshold: 0.08 });

const observe = root => $$(".rv", root).forEach(el => io.observe(el));

/* nav active link */
const navIO = new IntersectionObserver(es => es.forEach(e => {
  const l = document.querySelector(`.nlink[href="#${e.target.id}"]`);
  if (l) l.dataset.active = e.isIntersecting ? "1" : "0";
}), { rootMargin: "-45% 0px -50% 0px" });
["shop", "how", "sync", "why", "app"].forEach(id => {
  const s = document.getElementById(id);
  if (s) navIO.observe(s);
});

/* ══ count-up ═══════════════════════════════════════════════ */
function countUp(el) {
  const target = parseFloat(el.dataset.count), suf = el.dataset.suffix || "";
  const dec = (target % 1) ? 1 : 0;
  const t0 = performance.now(), dur = 1300;
  const tick = now => {
    const k = Math.min(1, (now - t0) / dur);
    el.textContent = (target * (1 - Math.pow(1 - k, 3))).toFixed(dec) + suf;
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/* ══ wiring ═════════════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", () => {
  $("#yr").textContent = new Date().getFullYear();
  observe(document);
  $$("[data-count]").forEach(countUp);

  // nav blur on scroll + orb parallax
  const orbs = $$(".orb");
  let ticking = false;
  const onScroll = () => {
    if (ticking) return; ticking = true;
    requestAnimationFrame(() => {
      const y = window.scrollY;
      $("#nav").classList.toggle("nav-on", y > 14);
      orbs.forEach(o => { o.style.transform = `translate3d(0,${y * +o.dataset.par}px,0)`; });
      ticking = false;
    });
  };
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // mobile nav
  const mb = $("#menuBtn"), mn = $("#mobNav");
  mb.onclick = () => {
    const open = mn.classList.toggle("hidden") === false;
    mb.setAttribute("aria-expanded", open);
  };
  $$("#mobNav a").forEach(a => a.onclick = () => mn.classList.add("hidden"));

  // currency
  const paintCur = () => $$(".cur").forEach(b =>
    b.classList.toggle("bg-white/10", b.dataset.cur === S.cur));
  $$(".cur").forEach(b => b.onclick = () => {
    S.cur = b.dataset.cur; localStorage.setItem("cur", S.cur);
    paintCur(); render();
  });
  paintCur();

  // filters
  $("#cats").onclick = e => {
    const b = e.target.closest("[data-c]"); if (!b) return;
    S.cat = b.dataset.c; render();
  };
  let qt;
  $("#q").oninput = e => { clearTimeout(qt); qt = setTimeout(() => { S.q = e.target.value; render(); }, 140); };
  $("#sort").onchange = e => { S.sort = e.target.value; render(); };

  // basket
  $("#grid").onclick = e => {
    const b = e.target.closest(".add"); if (b) addToCart(b.dataset.id);
  };
  $("#cartItems").onclick = e => {
    const b = e.target.closest(".qty"); if (b) stepQty(b.dataset.id, +b.dataset.step);
  };
  const openCart = o => {
    $("#drawer").classList.toggle("open", o);
    $("#scrim").classList.toggle("open", o);
    document.body.style.overflow = o ? "hidden" : "";
  };
  $("#cartBtn").onclick   = () => openCart(true);
  $("#closeCart").onclick = () => openCart(false);
  $("#scrim").onclick     = () => openCart(false);
  $("#checkout").onclick  = checkout;
  addEventListener("keydown", e => e.key === "Escape" && openCart(false));

  // hero device: cycle values so the "live edit" idea reads instantly
  const demo = [
    ["Espresso Beans 1kg", 2400, 18],
    ["Wireless Earbuds Pro", 11900, 6],
    ["Desk Lamp — Warm", 5400, 9],
  ];
  let i = 0;
  setInterval(() => {
    i = (i + 1) % demo.length;
    const [n, p, s] = demo[i];
    const set = (el, v) => {
      el.style.opacity = 0;
      setTimeout(() => { el.textContent = v; el.style.opacity = 1; }, 180);
    };
    $("#demoName") && set($("#demoName"), n);
    $("#demoPrice") && set($("#demoPrice"), money(p, "DZD"));
    $("#demoStock") && set($("#demoStock"), s);
  }, 3400);
  $$("#demoName,#demoPrice,#demoStock").forEach(el => el.style.transition = "opacity .25s ease");

  connect();
});

/* ── self-check: run with `node app.js --test` style checks in a
   browser console. Guards the money math, the only logic worth a test. */
if (location.search.includes("selftest")) {
  const r = { DZD: 1, GBP: 1 / 300, USD: 1 / 224 };
  S.site.rates = r;
  console.assert(money(1000, "DZD") === "1 000 DZD", "DZD format", money(1000, "DZD"));
  console.assert(money(300, "GBP") === "£1.00", "GBP convert", money(300, "GBP"));
  console.assert(money(0, "USD") === "$0.00", "zero USD", money(0, "USD"));
  console.assert(money(undefined, "DZD") === "0 DZD", "missing price", money(undefined, "DZD"));
  console.log("selftest done");
}
