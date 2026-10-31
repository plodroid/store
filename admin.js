/* Owner admin panel — loaded only after an account with an owners/{uid} document signs in.
   Everything here talks to Firestore directly; firestore.rules is what actually protects it.
   Free-plan design: orders arrive as requests, and "Confirm" re-prices and re-checks stock in a
   transaction (so customers can never choose their own price). */

import { $, $$, esc, money, openDialog, closeDialog, showError, setBusy, toast, millis, timeAgo, store, priceOf, onSale } from "./ui.js?v=15";
import { lookupPostcode } from "./uk.js?v=15";
import { trackerHtml } from "./flow.js?v=15";
import { LOOKS, SWATCHES, isLive, todayUK, heroHtml, heroVars } from "./events.js?v=15";

const css = document.createElement("link");
css.rel = "stylesheet"; css.href = new URL("./admin.css", import.meta.url).href;
const css2 = document.createElement("link");
css2.rel = "stylesheet"; css2.href = new URL("./events.css?v=15", import.meta.url).href;
document.head.append(css, css2);

let X = null;                 // { FS, acct, getSite }
const A = {
  products: [], categories: [], orders: [], feedback: [], alerts: [], events: [],
  loaded: { products: false, categories: false, orders: false, feedback: false, alerts: false, events: false },
  errors: {}, tab: "home", open: false, started: false, unsubs: [],
  pf: "all", pq: "", of: "active", ff: "inbox",
};

/* ── small helpers ───────────────────────────────────── */
const db = () => X.FS.db, F = () => X.FS.fs;
const parsePrice = v => { const n = Number(String(v).replace(/[£,\s]/g, "")); return Number.isFinite(n) && n >= 0 && n <= 100000 ? Math.round(n * 100) / 100 : null; };
const parseCount = v => /^\d{1,7}$/.test(String(v).trim()) ? Number(v) : null;
const catName = id => A.categories.find(c => c.id === id)?.name || "";
const lowAt = p => Number.isInteger(p.lowStockThreshold) ? p.lowStockThreshold : 5;
const waiting = id => A.alerts.filter(a => a.productId === id);
const stockState = p => p.stock <= 0 ? "out" : p.stock <= lowAt(p) ? "low" : "ok";
const created = o => millis(o.createdAt) || Date.now();       // a just-sent order has no server time yet
const KIND = { feedback: "Feedback", bug: "Problem", question: "Question" };
const ICON = {
  close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>`,
  bell: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9a6 6 0 1 1 12 0c0 6 2 7.5 2 7.5H4S6 15 6 9z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
  nav: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m4 11 16-7-7 16-2-7z"/></svg>`,
  up: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>`,
  down: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`,
};

/* ── live data + alerts ──────────────────────────────── */
export function watchAlerts(ctx) {
  X = ctx;
  if (A.started) return;
  A.started = true;
  const { fs } = X.FS, d = db();
  const sub = (key, q, onAdd, keep = () => true) => {
    let first = true;
    A.unsubs.push(fs.onSnapshot(q, snap => {
      const had = new Set(A[key].map(x => x.id));
      const docs = snap.docs.filter(x => keep(x.data()));
      A[key] = docs.map(x => ({ id: x.id, ...x.data() }));
      A.loaded[key] = true; delete A.errors[key];
      if (!first && onAdd) docs.forEach(x => { if (!had.has(x.id) && !x.metadata.hasPendingWrites) onAdd({ id: x.id, ...x.data() }); });
      first = false;
      paintDot(); if (A.open) paint();
    }, err => {
      console.error("[admin]", key, err && err.code);
      A.errors[key] = err && err.code === "permission-denied" ? "The database rules don't allow this yet." : "Couldn't load this right now.";
      A.loaded[key] = true;
      if (A.open) paint();
    }));
  };
  sub("products", fs.collection(d, "products"));
  sub("categories", fs.collection(d, "categories"));
  sub("alerts", fs.collection(d, "stockAlerts"));
  sub("events", fs.collection(d, "events"));
  sub("orders", fs.query(fs.collection(d, "orders"), fs.orderBy("createdAt", "desc"), fs.limit(300)),
    o => alertMe("New order " + (o.ref || ""), `${(o.items || []).reduce((n, i) => n + (i.qty || 0), 0)} items · ${o.fulfilment === "delivery" ? "Delivery" : "Pick-up"}`),
    o => !(o.status === "new" && o.paymentStatus === "awaiting"));      // a checkout the customer hasn't paid yet isn't an order
  sub("feedback", fs.query(fs.collection(d, "feedback"), fs.orderBy("createdAt", "desc"), fs.limit(200)),
    f => alertMe(f.kind === "bug" ? "New problem report" : f.kind === "question" ? "New question" : "New feedback", (f.message || "").slice(0, 80)));
}

/** Owner signed out (or someone else signed in): stop listening and drop the shop data from memory. */
export function stopAlerts() {
  A.unsubs.forEach(u => { try { u(); } catch {} });
  A.unsubs = []; A.started = false;
  for (const k of ["products", "categories", "orders", "feedback", "alerts", "events"]) { A[k] = []; A.loaded[k] = false; }
  A.errors = {};
  if (A.open) close();
  paintDot();
}

const attention = () => ({
  newOrders: A.orders.filter(o => o.status === "new" || o.status === "confirmed").length,      // waiting for the owner to start
  unread: A.feedback.filter(f => !f.read && !f.archived).length,
});
function paintDot() {
  const a = attention();
  const dot = $("#manageDot");
  if (dot) dot.hidden = !(a.newOrders || a.unread);
  const btn = $("#manageBtn");
  if (btn) btn.title = a.newOrders || a.unread ? `${a.newOrders} new order(s), ${a.unread} unread message(s)` : "";
  if (X && X.page) document.title = (a.newOrders || a.unread ? `(${a.newOrders + a.unread}) ` : "") + "Manage shop · Bee Hive";
}

let audio;
function beep() {
  if (!store.get("adm.sound", true)) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    [660, 880].forEach((f, i) => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = f; o.type = "sine";
      g.gain.setValueAtTime(0.0001, t + i * 0.16); g.gain.exponentialRampToValueAtTime(0.18, t + i * 0.16 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.16 + 0.22);
      o.connect(g).connect(audio.destination); o.start(t + i * 0.16); o.stop(t + i * 0.16 + 0.25);
    });
  } catch {}
}
function alertMe(title, body) {
  beep();
  toast(`${title}${body ? ` · ${body}` : ""}`, 4200);
  try {
    if ("Notification" in window && Notification.permission === "granted" && document.hidden) new Notification(title, { body });
  } catch {}
}

/* ── shell ───────────────────────────────────────────── */
const TABS = [["home", "Today"], ["products", "Products"], ["orders", "Orders"], ["feedback", "Messages"], ["events", "Events"], ["categories", "Categories"], ["settings", "Settings"]];

/** Page mode: the settings doc changed, so redraw what is showing. */
export function refresh() { if (A.open) paint(); }

export function openAdmin(ctx) {
  X = ctx;
  watchAlerts(ctx);
  const el = $("#admin");
  if (!el.dataset.built) {
    el.dataset.built = "1";
    el.innerHTML = `
      <div class="adm-shell">
        <header class="adm-top">
          ${X.page ? "" : `<button class="icon-btn" type="button" data-act="close" aria-label="Back to the shop">${ICON.close}</button>`}
          <h2>Manage shop</h2>
          ${X.page ? `${X.app ? "" : `<a class="btn-quiet sm" href="../">View shop</a>`}<button class="btn-quiet sm" type="button" data-act="signout">Sign out</button>` : `<span class="adm-spacer"></span>`}
        </header>
        <nav class="adm-tabs" id="admTabs" aria-label="Admin sections"></nav>
        <main class="adm-main" id="admMain"></main>
      </div>`;
    el.addEventListener("click", onClick);
    el.addEventListener("input", onInput);
    el.addEventListener("change", onInput);
    if (!X.page) addEventListener("keydown", e => { if (e.key === "Escape" && A.open && !$("dialog[open]")) close(); });
  }
  el.hidden = false; A.open = true;
  document.body.style.overflow = "hidden";
  paint();
}
function close() {
  if (X.page) return;                       // the owner page has nothing to go back to
  A.open = false; $("#admin").hidden = true; document.body.style.overflow = "";
  $("#manageBtn")?.focus({ preventScroll: true });
}

function paint() {
  const a = attention();
  const badge = { orders: a.newOrders, feedback: a.unread };
  $("#admTabs").innerHTML = TABS.map(([k, label]) =>
    `<button type="button" class="adm-tab" data-act="tab" data-tab="${k}" aria-pressed="${A.tab === k}">${label}${badge[k] ? `<span class="adm-badge">${badge[k]}</span>` : ""}</button>`).join("");
  const main = $("#admMain");
  const keep = main.scrollTop, focused = document.activeElement;
  const refocus = focused && main.contains(focused) && focused.matches("input[type=search]") ? { sel: "#" + focused.id, pos: focused.selectionStart } : null;
  main.innerHTML = VIEW[A.tab]();
  main.scrollTop = keep;
  if (refocus) { const f = $(refocus.sel, main); if (f) { f.focus(); try { f.setSelectionRange(refocus.pos, refocus.pos); } catch {} } }
}

const errorBanner = keys => {
  const msgs = keys.map(k => A.errors[k] && `${k}: ${A.errors[k]}`).filter(Boolean);
  return msgs.length ? `<p class="form-error">${esc(msgs.join(" "))}</p>` : "";
};
const loading = keys => keys.some(k => !A.loaded[k]);

/* ═════════ HOME ═════════ */
function dayKey(ms) { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }
function homeView() {
  if (loading(["products", "orders", "feedback"])) return `<p class="adm-empty">Loading…</p>`;
  const live = A.orders.filter(o => o.status !== "cancelled");
  const now = Date.now(), DAY = 864e5;
  const since = n => live.filter(o => created(o) >= now - n * DAY);
  const orderValue = o => o.total != null ? o.total : (o.estTotal || 0);
  const open = A.orders.filter(o => ["preparing", "ontheway", "arrived", "ready"].includes(o.status)).length;
  const jobs = A.orders.filter(o => !["completed", "cancelled"].includes(o.status)).sort((x, y) => created(x) - created(y));
  const sellable = A.products.filter(p => !p.archived);
  const low = sellable.filter(p => stockState(p) === "low"), out = sellable.filter(p => stockState(p) === "out");
  const a = attention();

  const days = Array.from({ length: 14 }, (_, i) => {
    const t = now - (13 - i) * DAY;
    return { t, n: live.filter(o => dayKey(created(o)) === dayKey(t)).length };
  });
  const max = Math.max(1, ...days.map(d => d.n));
  const bars = days.map((d, i) => {
    const h = Math.round((d.n / max) * 92);
    return `<g><rect x="${i * 28 + 4}" y="${100 - h}" width="20" height="${Math.max(h, d.n ? 3 : 1)}" rx="5" class="${d.n ? "bar" : "bar zero"}"><title>${new Date(d.t).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}: ${d.n} order${d.n === 1 ? "" : "s"}</title></rect></g>`;
  }).join("");

  const todo = [
    ...A.feedback.filter(f => !f.read && !f.archived).slice(0, 3).map(f => `<button class="adm-row" data-act="tab" data-tab="feedback"><span class="chip ${f.kind === "bug" ? "bad" : "info"}">${KIND[f.kind] || "Feedback"}</span><span class="adm-grow adm-clip">${esc(f.message)}</span><span class="muted">${timeAgo(millis(f.createdAt))}</span></button>`),
    ...out.slice(0, 4).map(p => `<button class="adm-row" data-act="edit-product" data-id="${esc(p.id)}"><span class="chip bad">Out of stock</span><span class="adm-grow">${esc(p.name)}</span></button>`),
    ...sellable.filter(p => p.stock > 0 && waiting(p.id).length).slice(0, 4).map(p => `<button class="adm-row" data-act="notify-stock" data-id="${esc(p.id)}"><span class="chip info">Back in stock</span><span class="adm-grow">${esc(p.name)}</span><span class="muted">email ${waiting(p.id).length} waiting</span></button>`),
    ...low.slice(0, 4).map(p => `<button class="adm-row" data-act="edit-product" data-id="${esc(p.id)}"><span class="chip warn">Low</span><span class="adm-grow">${esc(p.name)}</span><span class="muted">${p.stock} left</span></button>`),
  ];

  return `${errorBanner(["products", "orders", "feedback"])}
    <section class="adm-card"><h3>Orders to do${jobs.length ? ` <span class="adm-badge">${jobs.length}</span>` : ""}</h3>
      ${jobs.length ? jobs.slice(0, 12).map(orderCard).join("") : `<p class="adm-empty small">No orders waiting. When a customer pays, you get an email and a beep here, and the order shows up on this screen.</p>`}
    </section>
    <div class="stats">
      <button class="stat ${a.newOrders ? "hot" : ""}" data-act="go-orders" data-f="active"><span>Orders waiting for you</span><b>${a.newOrders}</b></button>
      <button class="stat" data-act="go-orders" data-f="active"><span>On the go right now</span><b>${open}</b></button>
      <div class="stat"><span>Orders this week</span><b>${since(7).length}</b></div>
      <div class="stat"><span>Sales · last 30 days</span><b>${money(since(30).reduce((t, o) => t + orderValue(o), 0))}</b><small>orders placed, paid or not</small></div>
      <button class="stat ${a.unread ? "hot" : ""}" data-act="tab" data-tab="feedback"><span>New messages</span><b>${a.unread}</b></button>
      <button class="stat" data-act="tab" data-tab="products"><span>Low or out of stock</span><b>${low.length + out.length}</b></button>
    </div>
    <section class="adm-card"><h3>Orders, last 14 days</h3>
      <svg class="chart" viewBox="0 0 392 108" role="img" aria-label="Orders per day over the last 14 days: ${days.map(d => d.n).join(", ")}" preserveAspectRatio="none">${bars}</svg>
    </section>
    <section class="adm-card"><h3>Also worth a look</h3>
      ${todo.length ? `<div class="adm-list">${todo.join("")}</div>` : `<p class="adm-empty small">All clear. Nothing else needs you right now.</p>`}
    </section>
    <details class="adm-card guide" id="admGuide" ${store.get("adm.guideSeen", false) ? "" : "open"}><summary><h3>How does this work?</h3></summary>
      <ol>
        <li><b>A customer pays.</b> They choose pick-up or delivery in the shop and pay by card. You get an email and a beep, and the order appears at the top of this screen.</li>
        <li><b>Delivery:</b> press <b>I'm on my way</b> when you set off. The customer gets an email. Press <b>I've arrived</b> when you're outside (they get another email). Press <b>Delivered. All done</b> at the end.</li>
        <li><b>Pick-up:</b> press <b>Order is ready to collect</b> (the customer gets an email), then <b>Handed over. All done</b> when they take it.</li>
        <li><b>You only ever press the one big button.</b> Tap an order's name to see the address, phone number and what they bought.</li>
        <li><b>Stock goes down by itself</b> when someone pays. To change what you sell, prices or how many you have, use the <b>Products</b> tab.</li>
        <li><b>Problem?</b> You can cancel an order from its details. If they already paid, give the money back from your Stripe dashboard.</li>
      </ol>
    </details>`;
}

/* ═════════ PRODUCTS ═════════ */
function productsView() {
  if (loading(["products", "categories"])) return `<p class="adm-empty">Loading…</p>`;
  const q = A.pq.trim().toLowerCase();
  const f = A.pf;
  const list = A.products
    .filter(p => (!q || `${p.name} ${catName(p.categoryId)}`.toLowerCase().includes(q)) &&
      (f === "all" ? !p.archived : f === "archived" ? p.archived : f === "hidden" ? !p.archived && !p.visible
        : f === "low" ? !p.archived && stockState(p) === "low" : f === "out" ? !p.archived && stockState(p) === "out" : !p.archived))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const chip = (k, label) => `<button type="button" class="fchip" data-act="pfilter" data-f="${k}" aria-pressed="${f === k}">${label}</button>`;
  return `${errorBanner(["products"])}
    <p class="muted tabhelp">What you sell. Tap a product to change its price, photo or how many you have. Use the − and + to fix the stock count.</p>
    <div class="adm-bar">
      <label class="adm-search"><input id="admPq" type="search" placeholder="Search products" value="${esc(A.pq)}" autocomplete="off"></label>
      <button class="btn-primary sm" type="button" data-act="new-product">${ICON.plus} Add product</button>
    </div>
    <div class="fchips">${chip("all", "All")}${chip("hidden", "Hidden")}${chip("low", "Low stock")}${chip("out", "Out of stock")}${chip("archived", "Archived")}</div>
    ${list.length ? `<div class="adm-list">${list.map(productRow).join("")}</div>`
      : `<p class="adm-empty">${A.products.length ? "No products match." : "No products yet. Tap “Add product” to create your first one."}</p>`}`;
}
function productRow(p) {
  const st = stockState(p);
  const thumb = p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : `<span>${esc((p.name || "?")[0])}</span>`;
  return `<div class="prow ${p.archived ? "dim" : ""}">
    <button class="pthumb" type="button" data-act="edit-product" data-id="${esc(p.id)}" aria-label="Edit ${esc(p.name)}">${thumb}</button>
    <div class="pmain">
      <button class="pname" type="button" data-act="edit-product" data-id="${esc(p.id)}">${esc(p.name)}</button>
      <div class="muted pmeta">${onSale(p) ? `<s>${money(p.price)}</s> <b class="sale-now">${money(priceOf(p))}</b>` : money(p.price)}${p.unit && p.unit !== "each" ? ` / ${esc(p.unit)}` : ""}${catName(p.categoryId) ? ` · ${esc(catName(p.categoryId))}` : ""}${p.archived ? " · archived" : !p.visible ? " · hidden" : ""}</div>
      ${waiting(p.id).length ? (p.stock > 0
        ? `<button class="pwait ready" type="button" data-act="notify-stock" data-id="${esc(p.id)}">Back in stock: email ${waiting(p.id).length} waiting</button>`
        : `<span class="pwait">${waiting(p.id).length} waiting for it to come back</span>`) : ""}
    </div>
    <div class="pstock ${st}">
      <button type="button" data-act="stock" data-id="${esc(p.id)}" data-d="-1" aria-label="One less ${esc(p.name)}" ${p.stock <= 0 ? "disabled" : ""}>−</button>
      <output>${p.stock}</output>
      <button type="button" data-act="stock" data-id="${esc(p.id)}" data-d="1" aria-label="One more ${esc(p.name)}">+</button>
    </div>
    <button class="sale-btn${onSale(p) ? " on" : ""}" type="button" data-act="sale" data-id="${esc(p.id)}" aria-label="${onSale(p) ? "Change or end the sale on" : "Put on sale:"} ${esc(p.name)}" ${p.archived ? "disabled" : ""}>${onSale(p) ? "On sale" : "Sale"}</button>
    <label class="switch" title="${p.visible ? "Shown in the shop" : "Hidden from the shop"}"><input type="checkbox" data-act="toggle-visible" data-id="${esc(p.id)}" ${p.visible ? "checked" : ""} ${p.archived ? "disabled" : ""} aria-label="Show ${esc(p.name)} in the shop"><span></span></label>
  </div>`;
}

async function shrinkImage(file, max = 360) {
  const bmp = await createImageBitmap(file);
  let side = Math.min(max, Math.max(bmp.width, bmp.height));
  for (let tries = 0; tries < 6; tries++, side = Math.round(side * 0.8)) {
    const k = Math.min(1, side / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    for (const q of [0.82, 0.7, 0.58, 0.46]) {
      const url = c.toDataURL("image/jpeg", q);
      if (url.length <= 55000) return url;
    }
  }
  throw new Error("image too large");
}

let draft = null;       // the product being edited
function productDialog(id) {
  const p = id ? A.products.find(x => x.id === id) : null;
  draft = { id: p?.id || null, image: p?.image || "", createdAt: p?.createdAt || null };
  const opt = A.categories.slice().sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map(c => `<option value="${esc(c.id)}" ${p?.categoryId === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("");
  $("#admDlgBody").innerHTML = `
    <h2>${p ? "Edit product" : "Add product"}</h2>
    <form id="prodForm" novalidate>
      <label class="inp"><span>Name*</span><input name="name" maxlength="120" required value="${esc(p?.name || "")}"></label>
      <div class="row2">
        <label class="inp"><span>Price (£)*</span><input name="price" inputmode="decimal" placeholder="2.50" required value="${p ? esc(String(p.price)) : ""}"></label>
        <label class="inp"><span>Sale price (£) <em>(optional)</em></span><input name="salePrice" inputmode="decimal" placeholder="Leave empty for no sale" value="${onSale(p || {}) ? esc(String(p.salePrice)) : ""}"></label>
      </div>
      <div class="row2">
        <label class="inp"><span>Stock*</span><input name="stock" inputmode="numeric" placeholder="0" required value="${p ? esc(String(p.stock)) : ""}"></label>
        <label class="inp"><span>Category</span><select name="categoryId"><option value="">No category</option>${opt}</select></label>
      </div>
      <div class="row2">
        <label class="inp"><span>Sold by <em>(optional)</em></span><input name="unit" maxlength="30" placeholder="each, kg, bottle…" value="${esc(p?.unit || "")}"></label>
        <label class="inp"><span>Low-stock alert at <em>(optional)</em></span><input name="low" inputmode="numeric" placeholder="5" value="${Number.isInteger(p?.lowStockThreshold) ? p.lowStockThreshold : ""}"></label>
      </div>
      <label class="inp"><span>Description <em>(optional)</em></span><textarea name="description" rows="3" maxlength="2000">${esc(p?.description || "")}</textarea></label>
      <div class="form-section"><h3>Photo</h3>
        <div class="imgbox"><div class="imgprev" id="imgPrev">${p?.image ? `<img src="${esc(p.image)}" alt="">` : "<span>No photo</span>"}</div>
          <div class="imgctl">
            <label class="btn-ghost tight file">Choose photo<input type="file" id="imgFile" accept="image/*" hidden></label>
            <button class="btn-ghost tight" type="button" data-act="img-clear">Remove</button>
            <p class="hint">Photos are shrunk automatically to keep the shop fast.</p>
          </div></div>
        <label class="inp"><span>…or paste an image link <em>(optional)</em></span><input name="imageUrl" placeholder="https://" maxlength="2000" value="${p?.image && !p.image.startsWith("data:") ? esc(p.image) : ""}"></label>
      </div>
      <div class="inp"><span>Options</span>
        <label class="check"><input type="checkbox" name="visible" ${p ? (p.visible ? "checked" : "") : "checked"}><span>Show in the shop</span></label>
        <label class="check"><input type="checkbox" name="featured" ${p?.featured ? "checked" : ""}><span>Feature at the top</span></label>
      </div>
      <p class="form-error" id="prodErr" role="alert" hidden></p>
      <button class="btn-primary wide" id="prodSave" type="submit">${p ? "Save changes" : "Add product"}</button>
      ${p ? `<div class="adm-danger"><button class="btn-quiet" type="button" data-act="archive-product" data-id="${esc(p.id)}">${p.archived ? "Restore to shop list" : "Archive (remove from sale)"}</button>
      <button class="btn-quiet danger" type="button" data-act="delete-product" data-id="${esc(p.id)}">Delete permanently</button></div>` : ""}
    </form>`;
  openDialog($("#admDlg"));
}

async function saveProduct(form) {
  const v = n => (form.elements[n]?.value || "").trim();
  const err = $("#prodErr");
  const bad = (n, m) => { form.elements[n].setAttribute("aria-invalid", "true"); showError(err, m); form.elements[n].focus(); };
  for (const el of form.elements) el.removeAttribute?.("aria-invalid");
  const price = parsePrice(v("price")), stock = parseCount(v("stock"));
  if (!v("name")) return bad("name", "Please give the product a name.");
  if (price === null) return bad("price", "Enter a price like 2.50.");
  if (stock === null) return bad("stock", "Stock must be a whole number, 0 or more.");
  const sale = v("salePrice") ? parsePrice(v("salePrice")) : null;
  if (v("salePrice") && (sale === null || sale >= price)) return bad("salePrice", "The sale price must be lower than the normal price.");
  const low = v("low") ? parseCount(v("low")) : null;
  if (v("low") && low === null) return bad("low", "Low-stock alert must be a whole number.");
  if (v("imageUrl") && !/^https:\/\//i.test(v("imageUrl"))) return bad("imageUrl", "Image links must start with https://");
  const image = v("imageUrl") || draft.image || "";

  const { fs } = X.FS;
  const doc = { name: v("name"), price, stock, visible: form.elements.visible.checked, archived: draft.id ? !!A.products.find(x => x.id === draft.id)?.archived : false, updatedAt: fs.serverTimestamp() };
  if (sale !== null) doc.salePrice = sale;
  if (v("categoryId")) doc.categoryId = v("categoryId");
  if (v("unit")) doc.unit = v("unit");
  if (v("description")) doc.description = v("description");
  if (image) doc.image = image;
  if (low !== null) doc.lowStockThreshold = low;
  if (form.elements.featured.checked) doc.featured = true;
  const old = draft.id ? A.products.find(x => x.id === draft.id) : null;
  if (old && Number.isInteger(old.sortOrder)) doc.sortOrder = old.sortOrder;
  doc.createdAt = old?.createdAt || fs.serverTimestamp();

  showError(err, "");
  const btn = $("#prodSave"), dlg = $("#admDlg");
  setBusy(dlg, btn, true);
  try {
    await fs.setDoc(draft.id ? fs.doc(db(), "products", draft.id) : fs.doc(fs.collection(db(), "products")), doc);
    closeDialog(dlg);
    toast(draft.id ? "Product saved" : "Product added");
  } catch (e) {
    console.error("[admin] save product", e);
    showError(err, e && e.code === "permission-denied" ? "The database refused that. Check the details and try again." : "Couldn't save. Check your connection and try again.");
  } finally { setBusy(dlg, btn, false); }
}

/* ── sale prices ── */
function saleDialog(id) {
  const p = A.products.find(x => x.id === id); if (!p) return;
  const on = onSale(p);
  $("#admDlgBody").innerHTML = `
    <h2>${on ? "Change the sale" : "Put on sale"}</h2>
    <p class="muted modal-sub">${esc(p.name)} · normal price ${money(p.price)}</p>
    <form id="saleForm" data-id="${esc(id)}" novalidate>
      <label class="inp"><span>Sale price (£)</span><input name="sale" inputmode="decimal" placeholder="${(Math.round(p.price * 80) / 100).toFixed(2)}" value="${on ? esc(String(p.salePrice)) : ""}"></label>
      <div class="fchips">${[10, 20, 30, 50].map(n => `<button type="button" class="fchip" data-act="sale-pct" data-pct="${n}">${n}% off</button>`).join("")}</div>
      <p class="hint">Customers see the normal price crossed out and a sale badge. It applies the moment you save.</p>
      <p class="form-error" id="saleErr" role="alert" hidden></p>
      <button class="btn-primary wide" id="saleSave" type="submit">${on ? "Save sale price" : "Start the sale"}</button>
      ${on ? `<button class="btn-quiet" type="button" data-act="sale-off" data-id="${esc(id)}">End the sale</button>` : ""}
    </form>`;
  openDialog($("#admDlg"));
}
async function saveSale(form) {
  const p = A.products.find(x => x.id === form.dataset.id), err = $("#saleErr");
  const sale = parsePrice(form.elements.sale.value);
  if (!p) return;
  if (sale === null || sale >= p.price) { form.elements.sale.setAttribute("aria-invalid", "true"); return showError(err, `Enter a price lower than ${money(p.price)}.`); }
  const { fs } = X.FS, btn = $("#saleSave"), dlg = $("#admDlg");
  setBusy(dlg, btn, true);
  try { await fs.updateDoc(fs.doc(db(), "products", p.id), { salePrice: sale, updatedAt: fs.serverTimestamp() }); closeDialog(dlg); toast("Sale started"); }
  catch (e) { console.error("[admin] sale", e); showError(err, "Couldn't save that. Please try again."); }
  finally { setBusy(dlg, btn, false); }
}
async function endSale(id) {
  const { fs } = X.FS;
  try { await fs.updateDoc(fs.doc(db(), "products", id), { salePrice: null, updatedAt: fs.serverTimestamp() }); closeDialog($("#admDlg")); toast("Sale ended"); }
  catch (e) { console.error("[admin] sale", e); toast("Couldn't end the sale."); }
}

/* ── "back in stock" emails ── */
const MAIL_ERR = {
  not_owner: "Only the shop owner can send these.", busy: "The daily email limit is used up. Try again tomorrow.",
  bad_request: "That request wasn't valid.", server: "The email service had a problem. Try again in a minute.",
};
async function notifyWaiting(id) {
  const p = A.products.find(x => x.id === id), list = waiting(id);
  if (!p || !list.length) return;
  if (p.stock <= 0) return toast("Add some stock first, then email the waiting customers.");
  const url = String(window.STORE_AUTH_URL || "");
  if (!/^https:\/\/script\.google\.com\//.test(url)) return toast("The email service isn't set up yet.");
  if (!(await confirmBox({ title: `Email ${list.length} customer${list.length === 1 ? "" : "s"}?`, text: `They asked to hear when “${p.name}” is back. This sends one short email each.`, ok: "Send emails" }))) return;
  const { fs } = X.FS;
  try {
    const idToken = await X.FS.auth.currentUser.getIdToken(true);
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ a: "notify", idToken, product: p.name, link: location.origin + location.pathname + "#/p/" + id, emails: list.map(a => a.email) }) });
    const data = await res.json();
    if (!data.ok) return toast(MAIL_ERR[data.error] || "Couldn't send the emails.");
    const done = new Set(data.sentTo || []);
    await Promise.all(list.filter(a => done.has(a.email)).map(a => fs.deleteDoc(fs.doc(db(), "stockAlerts", a.id)).catch(() => {})));
    toast(`Emailed ${data.sent} customer${data.sent === 1 ? "" : "s"}${data.sent < list.length ? `. ${list.length - data.sent} left for tomorrow.` : ""}`, 3500);
  } catch (e) { console.error("[admin] notify", e); toast("Couldn't reach the email service."); }
}

const orderUses = id => A.orders.filter(o => (o.items || []).some(i => i.productId === id)).length;

/* ═════════ CATEGORIES ═════════ */
function categoriesView() {
  if (loading(["categories", "products"])) return `<p class="adm-empty">Loading…</p>`;
  const list = A.categories.slice().sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.name).localeCompare(String(b.name)));
  return `${errorBanner(["categories"])}
    <div class="adm-bar"><span class="muted">Categories show as tabs in the shop, in this order.</span>
      <button class="btn-primary sm" type="button" data-act="new-cat">${ICON.plus} Add category</button></div>
    ${list.length ? `<div class="adm-list">${list.map((c, i) => {
      const n = A.products.filter(p => p.categoryId === c.id && !p.archived).length;
      return `<div class="prow">
        <div class="pmain"><button class="pname" type="button" data-act="edit-cat" data-id="${esc(c.id)}">${esc(c.name)}</button>
          <div class="muted pmeta">${n} product${n === 1 ? "" : "s"}${c.visible ? "" : " · hidden"}</div></div>
        <button class="btn-quiet sm" type="button" data-act="edit-cat" data-id="${esc(c.id)}">Edit</button>
        <div class="reorder"><button type="button" data-act="cat-move" data-id="${esc(c.id)}" data-d="-1" aria-label="Move ${esc(c.name)} up" ${i === 0 ? "disabled" : ""}>${ICON.up}</button>
          <button type="button" data-act="cat-move" data-id="${esc(c.id)}" data-d="1" aria-label="Move ${esc(c.name)} down" ${i === list.length - 1 ? "disabled" : ""}>${ICON.down}</button></div>
        <label class="switch"><input type="checkbox" data-act="cat-visible" data-id="${esc(c.id)}" ${c.visible ? "checked" : ""} aria-label="Show ${esc(c.name)} in the shop"><span></span></label>
      </div>`;
    }).join("")}</div>` : `<p class="adm-empty">No categories yet. Add the ones your shop needs, like “Drinks”.</p>`}`;
}
function catDialog(id) {
  const c = id ? A.categories.find(x => x.id === id) : null;
  $("#admDlgBody").innerHTML = `
    <h2>${c ? "Edit category" : "Add category"}</h2>
    <form id="catForm" novalidate data-id="${esc(id || "")}">
      <label class="inp"><span>Name*</span><input name="name" maxlength="60" required value="${esc(c?.name || "")}"></label>
      <label class="check"><input type="checkbox" name="visible" ${c ? (c.visible ? "checked" : "") : "checked"}><span>Show in the shop</span></label>
      <p class="form-error" id="catErr" role="alert" hidden></p>
      <button class="btn-primary wide" id="catSave" type="submit">${c ? "Save changes" : "Add category"}</button>
      ${c ? `<div class="adm-danger"><button class="btn-quiet danger" type="button" data-act="delete-cat" data-id="${esc(c.id)}">Delete category</button></div>` : ""}
    </form>`;
  openDialog($("#admDlg"));
}
async function saveCategory(form) {
  const name = form.elements.name.value.trim(), id = form.dataset.id || null;
  const err = $("#catErr");
  if (!name) { form.elements.name.setAttribute("aria-invalid", "true"); return showError(err, "Please give the category a name."); }
  if (A.categories.some(c => c.id !== id && c.name.toLowerCase() === name.toLowerCase())) return showError(err, "You already have a category with that name.");
  const { fs } = X.FS, old = id ? A.categories.find(c => c.id === id) : null;
  const doc = { name, visible: form.elements.visible.checked, sortOrder: old ? (old.sortOrder ?? 0) : A.categories.reduce((m, c) => Math.max(m, c.sortOrder ?? 0), -1) + 1, updatedAt: fs.serverTimestamp(), createdAt: old?.createdAt || fs.serverTimestamp() };
  if (old?.description) doc.description = old.description;
  const btn = $("#catSave"), dlg = $("#admDlg");
  setBusy(dlg, btn, true);
  try {
    await fs.setDoc(id ? fs.doc(db(), "categories", id) : fs.doc(fs.collection(db(), "categories")), doc);
    closeDialog(dlg); toast(id ? "Category saved" : "Category added");
  } catch (e) { console.error(e); showError(err, "Couldn't save. Please try again."); }
  finally { setBusy(dlg, btn, false); }
}
async function deleteCategory(id) {
  const c = A.categories.find(x => x.id === id); if (!c) return;
  const inside = A.products.filter(p => p.categoryId === id);
  const others = A.categories.filter(x => x.id !== id);
  const { fs } = X.FS;
  if (inside.length) {
    // products must go somewhere safe first
    const target = await pickBox({
      title: `“${c.name}” has ${inside.length} product${inside.length === 1 ? "" : "s"}`,
      text: "Choose where they should go before this category is deleted.",
      options: [...others.map(o => [o.id, `Move to “${o.name}”`]), ["", "Leave without a category"], ["__archive", "Archive them (remove from sale)"]],
    });
    if (target === null) return;
    const batch = fs.writeBatch(db());
    for (const p of inside) {
      const next = { ...stripId(p), updatedAt: fs.serverTimestamp() };
      delete next.categoryId;
      if (target === "__archive") { next.archived = true; next.visible = false; } else if (target) next.categoryId = target;
      batch.set(fs.doc(db(), "products", p.id), next);
    }
    batch.delete(fs.doc(db(), "categories", id));
    try { await batch.commit(); closeDialog($("#admDlg")); toast("Category deleted"); } catch (e) { console.error(e); toast("Couldn't delete that. Please try again."); }
    return;
  }
  if (!(await confirmBox({ title: `Delete “${c.name}”?`, text: "It has no products. This can't be undone.", ok: "Delete", danger: true }))) return;
  try { await fs.deleteDoc(fs.doc(db(), "categories", id)); closeDialog($("#admDlg")); toast("Category deleted"); } catch (e) { console.error(e); toast("Couldn't delete that."); }
}
const stripId = o => { const { id, ...rest } = o; return rest; };

/* ═════════ EVENTS ═════════ */
const fmtDay = d => new Date(d + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const evState = e => !e.active ? ["Off", ""]
  : isLive(e) ? ["Live now", "ready"]
  : e.startsAt && e.startsAt > todayUK() ? [`Starts ${fmtDay(e.startsAt)}`, "info"] : ["Finished", "warn"];
function eventsView() {
  if (loading(["events", "products"])) return `<p class="adm-empty">Loading…</p>`;
  const list = A.events.slice().sort((a, b) => millis(b.createdAt) - millis(a.createdAt));
  return `${errorBanner(["events"])}
    <div class="adm-bar"><span class="muted">Your own sales and seasons, like “Halloween Week”. Pick what goes on sale and the shop dresses up for it.</span>
      <button class="btn-primary sm" type="button" data-act="new-event">${ICON.plus} New event</button></div>
    ${list.length ? `<div class="adm-list">${list.map(e => {
      const [label, cls] = evState(e), n = (e.productIds || []).length;
      const bits = [LOOKS[e.look]?.label, e.percentOff > 0 ? `${e.percentOff}% off ${n} item${n === 1 ? "" : "s"}` : "look only",
        e.startsAt || e.endsAt ? `${e.startsAt ? fmtDay(e.startsAt) : "now"} – ${e.endsAt ? fmtDay(e.endsAt) : "no end"}` : ""].filter(Boolean);
      return `<div class="prow">
        <div class="pmain"><button class="pname" type="button" data-act="edit-event" data-id="${esc(e.id)}">${esc(e.name)}</button>
          <div class="muted pmeta">${esc(bits.join(" · "))}</div></div>
        <span class="chip ${cls}">${esc(label)}</span>
        <button class="btn-quiet sm" type="button" data-act="edit-event" data-id="${esc(e.id)}">Edit</button>
        <label class="switch"><input type="checkbox" data-act="ev-live" data-id="${esc(e.id)}" ${e.active ? "checked" : ""} aria-label="Show ${esc(e.name)} in the shop"><span></span></label>
      </div>`;
    }).join("")}</div>
    <p class="hint">If two events are on at once, the newest one decides how the shop looks. A product in both gets the better price.</p>`
    : `<p class="adm-empty">No events yet. Tap “New event”, type your own name (Halloween, Black Friday, anything) and pick the items to put on sale.</p>`}`;
}

function eventDialog(id) {
  const e = id ? A.events.find(x => x.id === id) : null;
  const look = e?.look || "plain", color = e?.color || SWATCHES[0], picked = new Set(e?.productIds || []);
  const prods = A.products.filter(p => !p.archived).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  $("#admDlgBody").innerHTML = `
    <h2>${e ? "Edit event" : "New event"}</h2>
    <form id="evForm" novalidate data-id="${esc(id || "")}" data-last="${look}">
      <div class="ev-preview ev-hero" id="evPreview" aria-label="Preview"></div>
      <p class="hint ev-hint">This is how the top of your shop will look.</p>
      <fieldset class="ev-looks"><legend>Look</legend>
        ${Object.entries(LOOKS).map(([k, l]) => `<label class="ev-look"><input type="radio" name="look" value="${k}" ${k === look ? "checked" : ""}><span><b>${esc(l.label)}</b><small>${esc(l.blurb)}</small></span></label>`).join("")}
      </fieldset>
      <label class="inp"><span>Event name*</span><input name="name" maxlength="60" required placeholder="e.g. Halloween Week" value="${esc(e?.name || "")}"></label>
      <label class="inp"><span>Line under the name (optional)</span><input name="tagline" maxlength="120" placeholder="e.g. Spooky savings on sweets" value="${esc(e?.tagline || "")}"></label>
      <label class="inp"><span>Scrolling bar text (optional)</span><input name="ticker" maxlength="120" placeholder="Empty = “20% off for your event name”" value="${esc(e?.ticker || "")}"></label>
      <div class="inp" id="evColor" ${look === "plain" ? "" : "hidden"}><span>Colour</span>
        <div class="ev-swatches">${SWATCHES.map(c => `<label class="ev-sw" style="--c:${c}"><input type="radio" name="color" value="${c}" ${c.toLowerCase() === color.toLowerCase() ? "checked" : ""} aria-label="Colour ${c}"><span></span></label>`).join("")}
          <label class="ev-sw custom" title="Pick any colour"><input type="color" name="colorCustom" value="${/^#[0-9a-f]{6}$/i.test(color) ? color : SWATCHES[0]}" aria-label="Custom colour"><span></span></label></div></div>
      <div class="ev-two">
        <label class="inp"><span>Discount (% off)</span><input name="pct" inputmode="numeric" maxlength="2" placeholder="0" value="${e?.percentOff ? e.percentOff : ""}"></label>
        <div class="fchips ev-pcts">${[10, 20, 30, 50].map(n => `<button type="button" class="fchip" data-act="ev-pct" data-pct="${n}">${n}%</button>`).join("")}</div>
      </div>
      <p class="hint">Leave empty if the event is just a look with no sale prices.</p>
      <div class="ev-two">
        <label class="inp"><span>Starts (optional)</span><input type="date" name="startsAt" value="${esc(e?.startsAt || "")}"></label>
        <label class="inp"><span>Ends (optional)</span><input type="date" name="endsAt" value="${esc(e?.endsAt || "")}"></label>
      </div>
      <p class="hint">With dates it switches on and off by itself (UK time). Without them it runs until you turn it off.</p>
      <div class="inp ev-prodbox"><span>Items on sale <b id="evCount"></b></span>
        <div class="ev-prodbar"><input type="search" id="evQ" placeholder="Search items" aria-label="Search items"><button type="button" class="fchip" data-act="ev-all">All</button><button type="button" class="fchip" data-act="ev-none">None</button></div>
        <div class="ev-prods">${prods.length ? prods.map(p => `<label class="check ev-prod" data-n="${esc(String(p.name).toLowerCase())}"><input type="checkbox" name="p" value="${esc(p.id)}" ${picked.has(p.id) ? "checked" : ""}><span class="ev-pname">${esc(p.name)}</span><span class="muted">${money(p.price)}</span></label>`).join("") : `<p class="muted">Add products first.</p>`}</div>
      </div>
      <label class="check"><input type="checkbox" name="active" ${e ? (e.active ? "checked" : "") : "checked"}><span>Show this event in the shop</span></label>
      <p class="form-error" id="evErr" role="alert" hidden></p>
      <button class="btn-primary wide" id="evSave" type="submit">${e ? "Save changes" : "Create event"}</button>
      ${e ? `<div class="adm-danger"><button class="btn-quiet danger" type="button" data-act="delete-event" data-id="${esc(id)}">Delete event</button></div>` : ""}
    </form>`;
  openDialog($("#admDlg"));
  evSync($("#evForm"));
}

/** Read the form into the event it describes (also used for the live preview). */
function evRead(form) {
  const f = form.elements, look = f.look.value;
  const custom = f.colorCustom.dataset.on === "1" ? f.colorCustom.value : null;
  const swatch = [...form.querySelectorAll('input[name="color"]')].find(r => r.checked)?.value;
  const raw = f.pct.value.trim();
  return { look, name: f.name.value.trim(), tagline: f.tagline.value.trim(), ticker: f.ticker.value.trim(), color: custom || swatch || SWATCHES[0],
    percentOff: raw === "" ? 0 : /^\d{1,2}$/.test(raw) ? Number(raw) : NaN, startsAt: f.startsAt.value, endsAt: f.endsAt.value,
    productIds: [...form.querySelectorAll('input[name="p"]:checked')].map(c => c.value), active: f.active.checked };
}
function evSync(form, changed) {
  const f = form.elements;
  if (changed === "look") {            // suggest the template's wording, but never overwrite what he typed himself
    const was = LOOKS[form.dataset.last] || LOOKS.plain, now = LOOKS[f.look.value];
    if (!f.name.value.trim() || f.name.value === was.name) f.name.value = now.name;
    if (!f.tagline.value.trim() || f.tagline.value === was.tagline) f.tagline.value = now.tagline;
    form.dataset.last = f.look.value;
  }
  $("#evColor").hidden = f.look.value !== "plain";
  const ev = evRead(form), pv = $("#evPreview");
  pv.dataset.look = ev.look; pv.style.cssText = heroVars(ev);
  pv.innerHTML = heroHtml({ ...ev, name: ev.name || "Your event name", percentOff: Number.isFinite(ev.percentOff) ? ev.percentOff : 0 }, { cta: false });
  $("#evCount").textContent = `(${ev.productIds.length} picked)`;
}
async function saveEvent(form) {
  const err = $("#evErr"), id = form.dataset.id || null, ev = evRead(form);
  const bad = (msg, field) => { if (field) form.elements[field].setAttribute("aria-invalid", "true"); showError(err, msg); };
  form.querySelectorAll("[aria-invalid]").forEach(x => x.removeAttribute("aria-invalid"));
  if (!ev.name) return bad("Please type a name for your event.", "name");
  if (!Number.isInteger(ev.percentOff) || ev.percentOff < 0 || ev.percentOff > 90) return bad("The discount must be a whole number from 1 to 90, or empty.", "pct");
  if (ev.percentOff > 0 && !ev.productIds.length) return bad("Pick at least one item for the sale, or empty the discount.");
  if (ev.startsAt && ev.endsAt && ev.endsAt < ev.startsAt) return bad("The end date can't be before the start date.", "endsAt");
  const { fs } = X.FS, old = id ? A.events.find(x => x.id === id) : null;
  const doc = { name: ev.name, look: ev.look, active: ev.active, percentOff: ev.percentOff, productIds: ev.productIds,
    updatedAt: fs.serverTimestamp(), createdAt: old?.createdAt || fs.serverTimestamp() };
  if (ev.tagline) doc.tagline = ev.tagline;
  if (ev.ticker) doc.ticker = ev.ticker;
  if (ev.look === "plain") doc.color = ev.color;
  if (ev.startsAt) doc.startsAt = ev.startsAt;
  if (ev.endsAt) doc.endsAt = ev.endsAt;
  const btn = $("#evSave"), dlg = $("#admDlg");
  setBusy(dlg, btn, true);
  try {
    await fs.setDoc(id ? fs.doc(db(), "events", id) : fs.doc(fs.collection(db(), "events")), doc);
    closeDialog(dlg); toast(id ? "Event saved" : ev.active ? "Event is live" : "Event saved (switched off)");
  } catch (e) { console.error("[admin] event", e); showError(err, "Couldn't save. Please try again."); }
  finally { setBusy(dlg, btn, false); }
}
async function deleteEvent(id) {
  const e = A.events.find(x => x.id === id); if (!e) return;
  if (!(await confirmBox({ title: `Delete “${e.name}”?`, text: "The shop goes back to normal and the sale prices end. This can't be undone.", ok: "Delete", danger: true }))) return;
  const { fs } = X.FS;
  try { await fs.deleteDoc(fs.doc(db(), "events", id)); closeDialog($("#admDlg")); toast("Event deleted"); } catch (err) { console.error(err); toast("Couldn't delete that."); }
}

/* ═════════ ORDERS ═════════ */
const STATUS = { new: "New", confirmed: "Paid", preparing: "Preparing", ontheway: "On the way", arrived: "Arrived", ready: "Ready to collect", completed: "Done", cancelled: "Cancelled" };
const statusLabel = o => o.status === "confirmed" && o.paymentStatus !== "paid" ? "Confirmed" : STATUS[o.status] || o.status;
/* The ONE button an order needs next. Delivery: on my way > arrived > done. Pick-up: ready > done. */
const STEP = {
  confirmed: o => o.fulfilment === "delivery"
    ? ["ontheway", "I'm on my way", "The customer gets an email saying you're on your way."]
    : ["ready", "Order is ready to collect", "The customer gets an email saying it's ready."],
  ontheway: () => ["arrived", "I've arrived", "The customer gets an email saying you're outside."],
  arrived: () => ["completed", "Delivered. All done", "Finishes the order. No email is sent."],
  ready: () => ["completed", "Handed over. All done", "Finishes the order. No email is sent."],
};
STEP.preparing = STEP.confirmed;
const stepOf = o => { const f = STEP[o.status]; if (!f) return null; const [to, label, hint] = f(o); return { to, label, hint }; };
const MAILED = ["ontheway", "arrived", "ready"];

/** Tells the customer the order's new step by email (the script decides the wording). Resolves true if it was sent. */
async function emailStage(orderId) {
  const url = String(window.STORE_AUTH_URL || "");
  if (!/^https:\/\/script\.google\.com\//.test(url)) return false;
  try {
    const idToken = await X.FS.auth.currentUser.getIdToken(true);
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ a: "stage", idToken, orderId }) });
    const j = await res.json();
    return j.ok === true && j.sent > 0;
  } catch (e) { console.error("[admin] stage email", e); return false; }
}

/** Moves an order to its next step, then emails the customer. Returns the message to show. */
async function advance(o) {
  const st = stepOf(o); if (!st) return "";
  const { fs } = X.FS;
  await fs.updateDoc(fs.doc(db(), "orders", o.id), { status: st.to, updatedAt: fs.serverTimestamp() });
  if (st.to === "completed") fs.deleteDoc(fs.doc(db(), "tracking", o.id)).catch(() => {});      // he's done: stop showing his position
  if (!MAILED.includes(st.to)) return "Order finished. Nice one!";
  return (await emailStage(o.id)) ? "Done. The customer has been emailed." : "Saved, but the email didn't send. Message the customer yourself.";
}

/** Delivery orders that have been confirmed and aren't finished: he can get directions to them. */
const canNavigate = o => o.fulfilment === "delivery" && o.address && ["confirmed", "preparing", "ontheway", "arrived", "ready"].includes(o.status);

/** Full-screen directions + live position for the customer. */
async function navigateTo(id) {
  const o = A.orders.find(x => x.id === id); if (!o) return;
  closeDialog($("#admDlg"));
  try {
    const { openNav } = await import("./nav.js?v=15");
    await openNav({ FS: X.FS, order: o,
      getAction: () => { const cur = A.orders.find(x => x.id === id), st = cur && stepOf(cur); return st ? { label: st.label, run: async () => toast(await advance(cur), 3500) } : null; } });
  } catch (e) { console.error("[admin] nav", e); toast("Couldn't open the map. Check your connection."); }
}

/** An order as a card with its one big button: used on the Today screen. */
function orderCard(o) {
  const st = stepOf(o), n = (o.items || []).reduce((t, i) => t + (i.qty || 0), 0), total = o.total != null ? o.total : o.estTotal;
  const where = o.fulfilment === "delivery" ? `Deliver to ${esc(o.address?.postcode || "the customer")}` : "Customer collects";
  return `<article class="ocard">
    <button class="ocard-top" type="button" data-act="open-order" data-id="${esc(o.id)}">
      <span class="chip ${o.status}">${esc(statusLabel(o))}</span>
      <span class="adm-grow"><b>${esc(o.customer?.name || "Customer")}</b> · ${esc(o.ref)}<br><span class="muted">${where} · ${n} item${n === 1 ? "" : "s"} · ${total != null ? money(total) : ""}${o.paymentStatus === "paid" ? " · <b>Paid</b>" : ""}</span></span>
    </button>
    ${trackerHtml(o, { compact: true })}
    ${canNavigate(o) ? `<button class="btn-ghost wide nav-btn" type="button" data-act="nav-order" data-id="${esc(o.id)}">${ICON.nav} Directions to ${esc(o.address?.postcode || "the customer")}</button>` : ""}
    ${st ? `<button class="btn-primary wide" type="button" data-act="advance-order" data-id="${esc(o.id)}">${esc(st.label)}</button><p class="hint">${esc(st.hint)}</p>`
      : `<button class="btn-primary wide" type="button" data-act="open-order" data-id="${esc(o.id)}">Check this order</button>`}
  </article>`;
}

function ordersView() {
  if (loading(["orders"])) return `<p class="adm-empty">Loading…</p>`;
  const f = A.of;
  const pass = o => f === "all" ? true : f === "active" ? !["completed", "cancelled"].includes(o.status) : o.status === f;
  const list = A.orders.filter(pass);
  const chip = (k, label) => `<button type="button" class="fchip" data-act="ofilter" data-f="${k}" aria-pressed="${f === k}">${label}</button>`;
  return `${errorBanner(["orders"])}
    <p class="muted tabhelp">Every order, newest first. Tap one to see the details and the button for its next step.</p>
    <div class="fchips">${chip("active", "To do")}${chip("completed", "Done")}${chip("cancelled", "Cancelled")}${chip("all", "All")}</div>
    ${list.length ? `<div class="adm-list">${list.map(o => {
      const n = (o.items || []).reduce((t, i) => t + (i.qty || 0), 0);
      const total = o.total != null ? o.total : o.estTotal;
      return `<article class="owrap"><button class="orow" type="button" data-act="open-order" data-id="${esc(o.id)}">
        <span class="chip ${o.status}">${esc(statusLabel(o))}</span>
        <span class="adm-grow"><b>${esc(o.ref)}</b> · ${esc(o.customer?.name || "Customer")}${o.paymentStatus === "paid" ? " · <b>Paid</b>" : ""}<br><span class="muted">${n} item${n === 1 ? "" : "s"} · ${o.fulfilment === "delivery" ? "Delivery" : "Pick-up"} · ${timeAgo(created(o))}</span></span>
        <span class="otot">${total != null ? money(total) : ""}${o.total == null ? `<small>estimate</small>` : ""}</span></button>
        ${trackerHtml(o, { compact: true })}
        ${canNavigate(o) ? `<button class="btn-ghost wide nav-btn" type="button" data-act="nav-order" data-id="${esc(o.id)}">${ICON.nav} Directions to ${esc(o.address?.postcode || "the customer")}</button>` : ""}</article>`;
    }).join("")}</div>` : `<p class="adm-empty">${A.orders.length ? "Nothing here." : "No orders yet. They'll appear here the moment a customer orders."}</p>`}`;
}

let viewing = null;
function orderDialog(id) {
  const o = A.orders.find(x => x.id === id); if (!o) return;
  viewing = id;
  const prod = pid => A.products.find(p => p.id === pid);
  const locked = Array.isArray(o.lines);
  const lines = locked ? o.lines : (o.items || []).map(i => {
    const p = prod(i.productId);
    return { productId: i.productId, name: p?.name || i.name || "Unknown product", qty: i.qty, unitPrice: p ? priceOf(p) : null, stock: p ? p.stock : null, gone: !p || p.archived || !p.visible };
  });
  const sub = lines.reduce((t, l) => t + (l.unitPrice != null ? Math.round(l.unitPrice * 100) * l.qty : 0), 0) / 100;
  const site = X.getSite() || {};
  const fee = o.fulfilment === "delivery" ? (locked ? (o.deliveryFee || 0) : (Number(site.deliveryFee) || 0)) : 0;
  const total = locked ? o.total : sub + fee;
  const problems = !locked ? lines.filter(l => l.gone || l.stock == null || l.stock < l.qty) : [];
  const mismatch = !locked && o.estTotal != null && Math.abs(o.estTotal - total) > 0.005;
  const a = o.address;
  const canCancel = !["completed", "cancelled"].includes(o.status);
  const next = stepOf(o);

  $("#admDlgBody").innerHTML = `
    <h2>${esc(o.ref)} <span class="chip ${o.status}">${esc(statusLabel(o))}</span></h2>
    ${trackerHtml(o)}
    <p class="muted modal-sub">${new Date(created(o)).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} · ${o.paymentStatus === "paid" ? "Paid by card" : "Not paid online yet (pay at pick-up or delivery)"}</p>
    <div class="form-section"><h3>Customer</h3>
      <div class="kv"><span>Name</span><b>${esc(o.customer?.name || "")}</b></div>
      ${o.customer?.phone ? `<div class="kv"><span>Phone</span><a href="tel:${esc(o.customer.phone)}">${esc(o.customer.phone)}</a></div>` : ""}
      ${o.customer?.email ? `<div class="kv"><span>Email</span><a href="mailto:${esc(o.customer.email)}">${esc(o.customer.email)}</a></div>` : ""}
    </div>
    <div class="form-section"><h3>${o.fulfilment === "delivery" ? "Delivery to" : "Pick-up from the shop"}</h3>
      ${a ? `<div class="addr-card"><div class="addr-text">${[a.line1, a.line2, a.city, a.postcode].filter(Boolean).map(esc).join("<br>")}</div></div>
        <p class="pc-status wait" id="ordPc">Checking postcode…</p>
        ${canNavigate(o) ? `<button class="btn-primary tight nav-btn" type="button" data-act="nav-order" data-id="${esc(o.id)}">${ICON.nav} Directions &amp; live map</button> ` : ""}
        <a class="btn-ghost tight" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([a.line1, a.city, a.postcode].filter(Boolean).join(", "))}">Open in Maps</a>` : `<p class="muted">The customer will collect this order.</p>`}
    </div>
    <div class="form-section"><h3>Items</h3>
      ${lines.map(l => `<div class="sum-row"><span>${esc(l.name)} × ${l.qty}${!locked && (l.gone || (l.stock != null && l.stock < l.qty)) ? ` <span class="chip bad">${l.gone ? "unavailable" : `only ${l.stock} in stock`}</span>` : ""}</span><span>${l.unitPrice != null ? money(Math.round(l.unitPrice * 100) * l.qty / 100) : "—"}</span></div>`).join("")}
      ${fee ? `<div class="sum-row"><span>Delivery</span><span>${money(fee)}</span></div>` : ""}
      <div class="sum-row total"><span>${locked ? "Total (confirmed)" : "Total at today's prices"}</span><span>${money(total)}</span></div>
      ${mismatch ? `<p class="form-error">The customer saw ${money(o.estTotal)}, but today's prices make it ${money(total)}. Prices changed since they ordered.</p>` : ""}
      ${o.note ? `<div class="note-box"><span class="muted">Note from the customer</span><p>${esc(o.note)}</p></div>` : ""}
    </div>
    <p class="form-error" id="ordErr" role="alert" hidden></p>
    ${o.status === "new" ? `<button class="btn-primary wide" id="ordMain" type="button" data-act="confirm-order" ${problems.length ? "disabled" : ""}>Confirm order &amp; reserve stock</button>
      ${problems.length ? `<p class="hint">Fix the stock first (edit the product), or cancel this order.</p>` : ""}`
    : next ? `<button class="btn-primary wide" id="ordMain" type="button" data-act="advance-order" data-id="${esc(o.id)}">${esc(next.label)}</button><p class="hint">${esc(next.hint)}</p>` : ""}
    ${canCancel ? `<button class="btn-quiet danger" type="button" data-act="cancel-order">Cancel order</button>` : ""}`;
  openDialog($("#admDlg"));

  if (a && a.postcode) lookupPostcode(a.postcode).then(info => {
    const el = $("#ordPc"); if (!el || viewing !== id) return;
    el.className = `pc-status ${info.ok ? "ok" : info.reason === "network" ? "warn" : "bad"}`;
    el.textContent = info.ok ? `✓ ${info.postcode} is a real postcode · ${[info.district, info.country].filter(Boolean).join(", ")}`
      : info.reason === "network" ? "Couldn't check the postcode right now." : "⚠ That postcode doesn't exist. Call the customer to confirm the address.";
  });
}

async function runOrderAction(label, fn) {
  const btn = $("#ordMain") || $("[data-act=cancel-order]");
  const err = $("#ordErr"); showError(err, "");
  setBusy($("#admDlg"), btn, true);
  let msg;
  try { msg = await fn(); } catch (e) {
    console.error("[admin] order", e);
    showError(err, e.userMessage || (e.code === "permission-denied" ? "The database refused that change." : "Couldn't do that. Check your connection and try again."));
    return;
  } finally { setBusy($("#admDlg"), btn, false); }
  toast(typeof msg === "string" && msg ? msg : label);
  const fresh = A.orders.find(o => o.id === viewing);
  if (fresh && !["completed", "cancelled"].includes(fresh.status)) setTimeout(() => orderDialog(viewing), 250); else closeDialog($("#admDlg"));
}

/** Locks prices and takes stock — all in one transaction, so two orders can't both take the last item. */
async function confirmOrder(o) {
  const { fs } = X.FS, d = db();
  const site = X.getSite() || {};
  await fs.runTransaction(d, async tx => {
    const oref = fs.doc(d, "orders", o.id);
    const cur = await tx.get(oref);
    if (!cur.exists() || cur.data().status !== "new") throw Object.assign(new Error("changed"), { userMessage: "This order was already handled. Close this and reopen it." });
    const items = cur.data().items || [];
    const snaps = await Promise.all(items.map(i => tx.get(fs.doc(d, "products", i.productId))));
    const lines = [];
    snaps.forEach((s, k) => {
      const i = items[k];
      if (!s.exists()) throw Object.assign(new Error("gone"), { userMessage: `“${i.name || i.productId}” no longer exists. Cancel this order or ask the customer.` });
      const p = s.data();
      if (p.archived || !p.visible) throw Object.assign(new Error("hidden"), { userMessage: `“${p.name}” isn't for sale right now.` });
      if (p.stock < i.qty) throw Object.assign(new Error("stock"), { userMessage: `Only ${p.stock} of “${p.name}” in stock (the customer wants ${i.qty}).` });
      const now = priceOf(p);
      lines.push({ productId: s.id, name: p.name, unit: p.unit || null, unitPrice: now, qty: i.qty, lineTotal: Math.round(now * 100) * i.qty / 100, _s: s, _p: p });
    });
    // all reads done; now write
    for (const l of lines) tx.update(l._s.ref, { stock: l._p.stock - l.qty, updatedAt: fs.serverTimestamp() });
    const subtotal = lines.reduce((t, l) => t + Math.round(l.unitPrice * 100) * l.qty, 0) / 100;
    const fee = cur.data().fulfilment === "delivery" ? (Number(site.deliveryFee) || 0) : 0;
    tx.update(oref, {
      status: "confirmed", lines: lines.map(({ _s, _p, ...l }) => l), subtotal, deliveryFee: fee,
      total: Math.round((subtotal + fee) * 100) / 100, updatedAt: fs.serverTimestamp(),
    });
  });
}

async function cancelOrder(o) {
  const { fs } = X.FS, d = db();
  await fs.runTransaction(d, async tx => {
    const oref = fs.doc(d, "orders", o.id);
    const cur = await tx.get(oref); const c = cur.data();
    if (c.status === "cancelled" || c.status === "completed") throw Object.assign(new Error("final"), { userMessage: "This order can't be cancelled any more." });
    const lines = Array.isArray(c.lines) ? c.lines : [];
    const snaps = await Promise.all(lines.map(l => tx.get(fs.doc(d, "products", l.productId))));
    snaps.forEach((s, k) => { if (s.exists()) tx.update(s.ref, { stock: s.data().stock + lines[k].qty, updatedAt: fs.serverTimestamp() }); });   // give the stock back
    tx.update(oref, { status: "cancelled", updatedAt: fs.serverTimestamp() });
  });
}

/* ═════════ FEEDBACK ═════════ */
function feedbackView() {
  if (loading(["feedback"])) return `<p class="adm-empty">Loading…</p>`;
  const inbox = A.ff === "inbox";
  const list = A.feedback.filter(f => inbox ? !f.archived : f.archived);
  const chip = (k, label) => `<button type="button" class="fchip" data-act="ffilter" data-f="${k}" aria-pressed="${A.ff === k}">${label}</button>`;
  return `${errorBanner(["feedback"])}
    <div class="fchips">${chip("inbox", "Inbox")}${chip("archived", "Archived")}</div>
    ${list.length ? `<div class="adm-list">${list.map(f => `
      <article class="fb ${f.read ? "" : "unread"}">
        <div class="fb-head"><span class="chip ${f.kind === "bug" ? "bad" : f.kind === "question" ? "warn" : "info"}">${KIND[f.kind] || "Feedback"}</span>
          ${f.rating ? `<span class="stars-ro" aria-label="${f.rating} out of 5 stars">${"★".repeat(f.rating)}<i>${"★".repeat(5 - f.rating)}</i></span>` : ""}
          <span class="muted adm-grow">${esc(f.name || "Anonymous")}${f.orderRef ? ` · ${esc(f.orderRef)}` : ""} · ${timeAgo(millis(f.createdAt))}</span></div>
        <p>${esc(f.message)}</p>
        <div class="fb-act">
          <button type="button" class="btn-quiet sm" data-act="fb-read" data-id="${esc(f.id)}">${f.read ? "Mark unread" : "Mark read"}</button>
          <button type="button" class="btn-quiet sm" data-act="fb-archive" data-id="${esc(f.id)}">${f.archived ? "Move to inbox" : "Archive"}</button>
          <button type="button" class="btn-quiet sm danger" data-act="fb-delete" data-id="${esc(f.id)}">Delete</button>
        </div>
      </article>`).join("")}</div>` : `<p class="adm-empty">${inbox ? "Inbox is empty. Customer feedback and problem reports land here." : "Nothing archived."}</p>`}`;
}

/* ═════════ SETTINGS ═════════ */
function settingsView() {
  const s = X.getSite() || {};
  const perm = "Notification" in window ? Notification.permission : "unsupported";
  return `<form class="adm-card" id="setForm" novalidate>
      <h3>Shop details</h3>
      <label class="inp"><span>Shop name</span><input name="storeName" maxlength="60" value="${esc(s.storeName || "")}"></label>
      <label class="inp"><span>Headline</span><input name="heroTitle" maxlength="120" value="${esc((s.heroTitle || "").replace(/\n/g, " "))}"></label>
      <label class="inp"><span>Sub-headline</span><input name="heroSubtitle" maxlength="200" value="${esc(s.heroSubtitle || "")}"></label>
      <label class="inp"><span>Scrolling bar at the top <em>(optional, one message per line)</em></span><textarea name="announcement" rows="3" maxlength="400" placeholder="Free delivery over £30&#10;Closed on Sunday">${esc(s.announcement || "")}</textarea></label>
      <label class="inp"><span>WhatsApp link <em>(optional)</em></span><input name="whatsapp" maxlength="200" value="${esc(s.whatsapp || "")}" placeholder="https://wa.me/447123456789"></label>
      <h3 class="gap">How customers get their order</h3>
      <label class="check"><input type="checkbox" name="collection" ${s.collection !== false ? "checked" : ""}><span>Pick-up from the shop</span></label>
      <label class="check"><input type="checkbox" name="delivery" ${s.delivery !== false ? "checked" : ""}><span>Delivery (UK addresses)</span></label>
      <label class="inp"><span>Delivery fee (£)</span><input name="deliveryFee" inputmode="decimal" value="${s.deliveryFee ? esc(String(s.deliveryFee)) : "0"}"></label>
      <p class="form-error" id="setErr" role="alert" hidden></p>
      <button class="btn-primary wide" id="setSave" type="submit">Save settings</button>
    </form>
    <section class="adm-card"><h3>Alerts</h3>
      <p class="muted">New orders, feedback and problem reports make a sound and show a banner while this page is open. ${perm === "granted" ? "Desktop alerts are on." : perm === "denied" ? "Desktop alerts are blocked in your browser settings." : perm === "unsupported" ? "" : "You can also turn on desktop alerts."}</p>
      <label class="check"><input type="checkbox" data-act="sound" ${store.get("adm.sound", true) ? "checked" : ""}><span>Play a sound</span></label>
      ${perm === "default" ? `<button class="btn-ghost tight" type="button" data-act="notify-perm">Turn on desktop alerts</button>` : ""}
      <p class="hint">Alerts only work while the website is open in a tab. Phone and WhatsApp alerts for a closed browser need a small always-on server, which isn't part of the free setup yet.</p>
    </section>
    <section class="adm-card"><h3>Your account</h3>
      <p class="muted">Signed in as ${esc(X.acct.email || "")}</p>
      <button class="btn-quiet danger" type="button" data-act="signout">Sign out</button>
    </section>`;
}
async function saveSettings(form) {
  const v = n => (form.elements[n]?.value || "").trim();
  const err = $("#setErr");
  const fee = v("deliveryFee") === "" ? 0 : parsePrice(v("deliveryFee"));
  if (fee === null || fee > 1000) return showError(err, "Delivery fee must be a number between 0 and 1000.");
  if (v("whatsapp") && !/^https:\/\//i.test(v("whatsapp"))) return showError(err, "The WhatsApp link must start with https://");
  const { fs } = X.FS;
  const doc = {
    storeName: v("storeName"), heroTitle: v("heroTitle"), heroSubtitle: v("heroSubtitle"), announcement: v("announcement"), whatsapp: v("whatsapp"),
    collection: form.elements.collection.checked, delivery: form.elements.delivery.checked, deliveryFee: fee, updatedAt: fs.serverTimestamp(),
  };
  showError(err, "");
  const btn = $("#setSave"); setBusy(null, btn, true);
  try { await fs.setDoc(fs.doc(db(), "settings", "site"), doc); toast("Settings saved"); }
  catch (e) { console.error(e); showError(err, "Couldn't save settings. Please try again."); }
  finally { setBusy(null, btn, false); }
}

const VIEW = { home: homeView, products: productsView, orders: ordersView, feedback: feedbackView, categories: categoriesView, events: eventsView, settings: settingsView };

/* ── dialogs: confirm + choose ───────────────────────── */
function confirmBox({ title, text, ok = "Confirm", danger = false }) {
  return new Promise(resolve => {
    const d = $("#admConfirm");
    $("#admConfirmBody").innerHTML = `<h2>${esc(title)}</h2><p class="muted modal-sub">${esc(text)}</p>
      <div class="done-actions"><button class="btn-ghost" type="button" data-no>Cancel</button><button class="btn-primary ${danger ? "danger" : ""}" type="button" data-yes>${esc(ok)}</button></div>`;
    let done = false;
    const finish = v => { if (done) return; done = true; d.removeEventListener("click", onClick); d.removeEventListener("close", onClose); closeDialog(d); resolve(v); };
    const onClick = e => { if (e.target.closest("[data-yes]")) finish(true); else if (e.target.closest("[data-no]")) finish(false); };
    const onClose = () => finish(false);
    d.addEventListener("click", onClick); d.addEventListener("close", onClose);
    openDialog(d);
  });
}
function pickBox({ title, text, options }) {
  return new Promise(resolve => {
    const d = $("#admConfirm");
    $("#admConfirmBody").innerHTML = `<h2>${esc(title)}</h2><p class="muted modal-sub">${esc(text)}</p>
      <label class="inp form-section"><select id="pickSel">${options.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("")}</select></label>
      <div class="done-actions"><button class="btn-ghost" type="button" data-no>Cancel</button><button class="btn-primary" type="button" data-yes>Continue</button></div>`;
    let done = false;
    const finish = v => { if (done) return; done = true; d.removeEventListener("click", onClick); d.removeEventListener("close", onClose); closeDialog(d); resolve(v); };
    const onClick = e => { if (e.target.closest("[data-yes]")) finish($("#pickSel").value); else if (e.target.closest("[data-no]")) finish(null); };
    const onClose = () => finish(null);
    d.addEventListener("click", onClick); d.addEventListener("close", onClose);
    openDialog(d);
  });
}

/* ── events ──────────────────────────────────────────── */
function onInput(e) {
  if (e.target.id === "admPq") { A.pq = e.target.value; paint(); return; }
  const t = e.target.closest("[data-act]");
  if (!t || e.type !== "change") return;
  const { fs } = X.FS;
  if (t.dataset.act === "toggle-visible") fs.updateDoc(fs.doc(db(), "products", t.dataset.id), { visible: t.checked, updatedAt: fs.serverTimestamp() }).catch(() => { toast("Couldn't change that."); paint(); });
  if (t.dataset.act === "cat-visible") fs.updateDoc(fs.doc(db(), "categories", t.dataset.id), { visible: t.checked, updatedAt: fs.serverTimestamp() }).catch(() => { toast("Couldn't change that."); paint(); });
  if (t.dataset.act === "ev-live") fs.updateDoc(fs.doc(db(), "events", t.dataset.id), { active: t.checked, updatedAt: fs.serverTimestamp() }).then(() => toast(t.checked ? "Event is live" : "Event switched off")).catch(() => { toast("Couldn't change that."); paint(); });
  if (t.dataset.act === "sound") store.set("adm.sound", t.checked);
}

async function onClick(e) {
  const t = e.target.closest("[data-act]");
  if (!t || t.tagName === "INPUT" && t.type === "checkbox") return;
  const act = t.dataset.act, id = t.dataset.id, { fs } = X.FS;
  switch (act) {
    case "close": return close();
    case "tab": A.tab = t.dataset.tab; return paint();
    case "go-orders": A.tab = "orders"; A.of = t.dataset.f; return paint();
    case "pfilter": A.pf = t.dataset.f; return paint();
    case "ofilter": A.of = t.dataset.f; return paint();
    case "ffilter": A.ff = t.dataset.f; return paint();
    case "new-product": return productDialog(null);
    case "edit-product": return productDialog(id);
    case "sale": return saleDialog(id);
    case "sale-pct": { const f = $("#saleForm"), p = A.products.find(x => x.id === f.dataset.id); if (p) f.elements.sale.value = (Math.round(p.price * (1 - Number(t.dataset.pct) / 100) * 100) / 100).toFixed(2); return; }
    case "sale-off": return endSale(id);
    case "notify-stock": return notifyWaiting(id);
    case "nav-order": return navigateTo(id);
    case "new-event": return eventDialog(null);
    case "edit-event": return eventDialog(id);
    case "delete-event": return deleteEvent(id);
    case "ev-pct": { const f = $("#evForm"); f.elements.pct.value = t.dataset.pct; return evSync(f); }
    case "ev-all": case "ev-none": { const f = $("#evForm"); f.querySelectorAll('input[name="p"]').forEach(c => { if (!c.closest("[hidden]")) c.checked = act === "ev-all"; }); return evSync(f); }
    case "new-cat": return catDialog(null);
    case "edit-cat": return catDialog(id);
    case "open-order": return orderDialog(id);
    case "stock": {
      const p = A.products.find(x => x.id === id); if (!p) return;
      const next = Math.max(0, p.stock + Number(t.dataset.d));
      return fs.updateDoc(fs.doc(db(), "products", id), { stock: next, updatedAt: fs.serverTimestamp() }).catch(() => toast("Couldn't change the stock."));
    }
    case "cat-move": {
      const list = A.categories.slice().sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.name).localeCompare(String(b.name)));
      const i = list.findIndex(c => c.id === id), j = i + Number(t.dataset.d);
      if (i < 0 || j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      const batch = fs.writeBatch(db());
      list.forEach((c, k) => { if (c.sortOrder !== k) batch.update(fs.doc(db(), "categories", c.id), { sortOrder: k, updatedAt: fs.serverTimestamp() }); });
      return batch.commit().catch(() => toast("Couldn't reorder."));
    }
    case "notify-perm": { try { await Notification.requestPermission(); } catch {} return paint(); }
    case "signout": close(); return X.acct.signOut();
    case "fb-read": { const f = A.feedback.find(x => x.id === id); return fs.updateDoc(fs.doc(db(), "feedback", id), { read: !f.read, archived: !!f.archived }).catch(() => toast("Couldn't update that.")); }
    case "fb-archive": { const f = A.feedback.find(x => x.id === id); return fs.updateDoc(fs.doc(db(), "feedback", id), { archived: !f.archived, read: true }).catch(() => toast("Couldn't update that.")); }
    case "fb-delete":
      if (await confirmBox({ title: "Delete this message?", text: "This can't be undone.", ok: "Delete", danger: true }))
        fs.deleteDoc(fs.doc(db(), "feedback", id)).catch(() => toast("Couldn't delete that."));
      return;
    case "img-clear": draft.image = ""; $("#imgPrev").innerHTML = "<span>No photo</span>"; { const u = $("#prodForm")?.elements.imageUrl; if (u) u.value = ""; } return;
    case "archive-product": {
      const p = A.products.find(x => x.id === id); if (!p) return;
      try {
        await fs.setDoc(fs.doc(db(), "products", id), { ...stripId(p), archived: !p.archived, visible: p.archived ? p.visible : false, updatedAt: fs.serverTimestamp() });
        closeDialog($("#admDlg")); toast(p.archived ? "Restored" : "Archived. It's no longer for sale.");
      } catch (err) { console.error(err); toast("Couldn't change that."); }
      return;
    }
    case "delete-product": {
      const p = A.products.find(x => x.id === id); if (!p) return;
      const used = orderUses(id);
      if (used) {
        if (await confirmBox({ title: "This product is in past orders", text: `“${p.name}” appears in ${used} order${used === 1 ? "" : "s"}, so it can't be deleted without breaking order history. Archive it instead?`, ok: "Archive" }))
          fs.setDoc(fs.doc(db(), "products", id), { ...stripId(p), archived: true, visible: false, updatedAt: fs.serverTimestamp() }).then(() => { closeDialog($("#admDlg")); toast("Archived"); }).catch(() => toast("Couldn't archive that."));
        return;
      }
      if (await confirmBox({ title: `Delete “${p.name}”?`, text: "It's not in any order. This can't be undone.", ok: "Delete", danger: true }))
        fs.deleteDoc(fs.doc(db(), "products", id)).then(() => { closeDialog($("#admDlg")); toast("Deleted"); }).catch(() => toast("Couldn't delete that."));
      return;
    }
    case "delete-cat": return deleteCategory(id);
    case "confirm-order": { const o = A.orders.find(x => x.id === viewing); return runOrderAction("Order confirmed. Stock reserved.", () => confirmOrder(o)); }
    case "advance-order": {
      const o = A.orders.find(x => x.id === id); if (!o) return;
      if (t.id === "ordMain") return runOrderAction("Updated", () => advance(o));
      t.disabled = true;                                  // the big button on a Today card
      try { toast(await advance(o), 3500); } catch (err) { console.error("[admin] advance", err); toast("Couldn't update that order. Check your connection and try again."); t.disabled = false; }
      return;
    }
    case "cancel-order": {
      const o = A.orders.find(x => x.id === viewing);
      if (await confirmBox({ title: `Cancel ${o.ref}?`, text: (o.paymentStatus === "paid" ? "This customer already paid by card. Cancelling does NOT refund them: refund the payment in your Stripe dashboard too. " : "") + (o.status === "new" ? "The customer's request will be cancelled." : "Any reserved stock goes back on the shelf. This can't be undone."), ok: "Cancel order", danger: true }))
        runOrderAction("Order cancelled", () => cancelOrder(o));
      return;
    }
  }
}

document.addEventListener("toggle", e => { if (e.target.id === "admGuide") store.set("adm.guideSeen", true); }, true);

// dialog-level events (forms, file picker) — the dialogs live outside #admin
document.addEventListener("submit", e => {
  const f = e.target;
  if (f.id === "prodForm") { e.preventDefault(); saveProduct(f); }
  else if (f.id === "catForm") { e.preventDefault(); saveCategory(f); }
  else if (f.id === "setForm") { e.preventDefault(); saveSettings(f); }
  else if (f.id === "saleForm") { e.preventDefault(); saveSale(f); }
  else if (f.id === "evForm") { e.preventDefault(); saveEvent(f); }
});
// the event form: keep the preview + wording in step as he types, filter the item list
document.addEventListener("input", e => {
  const f = e.target.closest("#evForm"); if (!f) return;
  if (e.target.id === "evQ") { const q = e.target.value.trim().toLowerCase(); f.querySelectorAll(".ev-prod").forEach(r => { r.hidden = !!q && !r.dataset.n.includes(q); }); return; }
  if (e.target.name === "colorCustom") { e.target.dataset.on = "1"; f.querySelectorAll('input[name="color"]').forEach(r => { r.checked = false; }); }
  if (e.target.name === "color") f.elements.colorCustom.dataset.on = "";
  evSync(f, e.target.name === "look" ? "look" : "");
});
document.addEventListener("change", e => { const f = e.target.closest("#evForm"); if (f && e.target.name === "look") evSync(f, "look"); });
document.addEventListener("click", e => {          // buttons inside #admDlg (dialog is outside #admin)
  const dlg = e.target.closest("#admDlg");
  if (dlg && e.target.closest("[data-act]")) onClick(e);
});
document.addEventListener("change", async e => {
  if (e.target.id !== "imgFile" || !e.target.files[0]) return;
  const err = $("#prodErr");
  try {
    draft.image = await shrinkImage(e.target.files[0]);
    $("#imgPrev").innerHTML = `<img src="${draft.image}" alt="">`;
    const u = $("#prodForm")?.elements.imageUrl; if (u) u.value = "";
    showError(err, "");
  } catch { showError(err, "That photo couldn't be used. Try a different one."); }
});
