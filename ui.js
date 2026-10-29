/* Small shared helpers used by app.js, auth.js and admin.js. No app state in here. */

export const $  = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const store = {
  get(k, f) { try { return JSON.parse(localStorage.getItem(k)) ?? f; } catch { return f; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  sget(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } },
  sset(k, v) { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
export const money = v => gbp.format(Number(v) || 0);
export const pence = v => Math.round((Number(v) || 0) * 100);
export const reduced = matchMedia("(prefers-reduced-motion: reduce)");
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

/* ── dialogs (shared open/close animation) ───────────── */
export function openDialog(d) {
  if (!d.open) d.showModal();
  requestAnimationFrame(() => d.classList.add("open"));
}
export function closeDialog(d) {
  if (!d.open) return;
  d.classList.remove("open");
  setTimeout(() => d.close(), reduced.matches ? 0 : 200);
}
export function wireDialogs() {
  for (const d of $$("dialog")) {
    d.addEventListener("cancel", e => { e.preventDefault(); if (!d.dataset.busy) closeDialog(d); });
    d.addEventListener("click", e => {
      if ((e.target === d || e.target.closest("[data-close]")) && !d.dataset.busy) closeDialog(d);
    });
  }
}

/* ── toast ───────────────────────────────────────────── */
let toastTimer;
export function toast(msg, ms = 1800) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), ms);
}

/* ── form helpers ────────────────────────────────────── */
export function showError(target, msg) {
  const el = typeof target === "string" ? $(target) : target;
  if (!el) return;
  el.textContent = msg;
  el.hidden = !msg;
}
export function setBusy(dialog, btn, busy) {
  btn.classList.toggle("busy", busy);
  btn.disabled = busy;
  btn.setAttribute("aria-busy", String(busy));
  if (dialog) { if (busy) dialog.dataset.busy = "1"; else delete dialog.dataset.busy; }
}

/** Firestore Timestamp | Date | number | null → milliseconds (0 when unknown). */
export const millis = t => !t ? 0 : typeof t.toMillis === "function" ? t.toMillis() : t instanceof Date ? t.getTime() : Number(t) || 0;

export const timeAgo = ms => {
  if (!ms) return "";
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};
