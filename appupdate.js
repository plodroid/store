/* In-app updates for the Android apps (customer + owner).
   The apps are thin shells around this website, so almost every change arrives instantly. Only when the shell itself
   changes is a new APK published (GitHub release "apps-N", N = build number, also stamped into the app's user agent
   as "BeeHiveApp/<customer|owner>/<N>"). This module compares the two and offers the update:
     popup (Update / Cancel / "Don't remind me again")  →  green download icon stays in the header until updated. */

import { $, esc, openDialog, closeDialog, toast, store } from "./ui.js?v=16";

const API = "https://api.github.com/repos/plodroid/store/releases?per_page=20";
const TTL = 3 * 3600e3;
const cap = window.Capacitor;
const isApp = !!(cap && cap.isNativePlatform && cap.isNativePlatform() && (!cap.getPlatform || cap.getPlatform() === "android"));
const marker = (navigator.userAgent.match(/BeeHiveApp\/(customer|owner)\/(\d+)/) || []);
const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/></svg>`;

let info = null, asked = false, busy = false;

async function latest(kind) {
  const c = store.get("upd.cache", null);
  if (c && c.kind === kind && Date.now() - c.t < TTL) return c;
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const list = await fetch(API, { signal: ctl.signal, headers: { accept: "application/vnd.github+json" } }).then(r => r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status)));
    let best = null;
    for (const r of list) {
      const m = /^apps-(\d+)$/.exec(r.tag_name || ""); if (!m || r.draft) continue;
      const a = (r.assets || []).find(x => x.name === `bee-hive-${kind}-debug.apk`);
      if (a && (!best || +m[1] > best.build)) best = { build: +m[1], url: a.browser_download_url };
    }
    if (!best) return null;
    const out = { kind, t: Date.now(), ...best };
    store.set("upd.cache", out);
    return out;
  } finally { clearTimeout(timer); }
}

export async function startUpdate() {
  if (!info || busy) return;
  const plugin = cap && cap.Plugins && cap.Plugins.ApkUpdater;
  busy = true; paint("Downloading…");
  try {
    if (!plugin) { location.assign(info.url); toast("Opening the download. Tap the file when it finishes."); return; }
    await plugin.install({ url: info.url });          // downloads, then Android's installer opens; installing restarts the app
  } catch (e) {
    const msg = String((e && (e.code || e.message)) || e);
    if (/needs-permission/.test(msg)) toast("Allow installs from this app on the screen that opened, then press Update again.");
    else { toast("Couldn't update here. Opening the download instead."); try { location.assign(info.url); } catch {} }
  } finally { busy = false; paint(); }
}

function paint(busyText) {
  const b = $("#updBtn"); if (!b) return;
  b.disabled = !!busyText; b.title = busyText || "Update the app";
  const d = $("#updGo"); if (d) { d.disabled = !!busyText; d.textContent = busyText || "Update"; }
}

function icon(host, before) {
  let b = $("#updBtn");
  if (!b) {
    b = document.createElement("button");
    b.id = "updBtn"; b.type = "button"; b.className = "icon-btn upd-btn"; b.setAttribute("aria-label", "Update the app"); b.innerHTML = ICON;
    b.addEventListener("click", () => ask(true));
    host.insertBefore(b, before && before.parentNode === host ? before : host.firstChild);
  }
  b.hidden = false;
}

function ask(force) {
  if (!info) return;
  let d = $("#updDlg");
  if (!d) {
    d = document.createElement("dialog");
    d.className = "pd modal upd"; d.id = "updDlg"; d.setAttribute("aria-labelledby", "updTitle");
    d.innerHTML = `<div class="modal-body">
      <h2 id="updTitle">New update</h2>
      <p class="modal-sub">A newer version of the app is ready. It only takes a few seconds, and the app restarts when it's done.</p>
      <button class="btn-primary wide upd-go" id="updGo" type="button">Update</button>
      <button class="btn-quiet" id="updNo" type="button">Cancel</button>
      <label class="check"><input type="checkbox" id="updNever"><span>Don't remind me again</span></label>
    </div>`;
    document.body.append(d);
    $("#updGo", d).addEventListener("click", startUpdate);
    $("#updNo", d).addEventListener("click", () => { if ($("#updNever", d).checked) store.set("upd.never", info.build); closeDialog(d); });
    d.addEventListener("close", () => { /* the green icon stays until the app is updated */ });
  }
  $("#updNever", d).checked = false;
  paint();
  if (!d.open) openDialog(d);
}

/* host = element the green icon goes into; before = the element it sits in front of (the basket / sign-out button) */
export async function initAppUpdate({ host, before, kind }) {
  if (!isApp || !host) return;
  kind = kind || marker[1] || (location.pathname.includes("/admin") ? "owner" : "customer");
  const mine = +(marker[2] || 0);
  try { info = await latest(kind); } catch (e) { console.warn("[update]", e && e.message); return; }
  if (!info || info.build <= mine) { const b = $("#updBtn"); if (b) b.hidden = true; return; }
  icon(host, before);
  if (!asked && store.get("upd.never", 0) !== info.build) { asked = true; setTimeout(() => ask(false), 1200); }
}
