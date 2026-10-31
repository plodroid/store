/* Languages for the shop. The page is written in English; each language is one small file in lang/ that maps the
   English text to its translation. A tiny translator walks the page (and watches for changes), so every label,
   toast and message follows the language with no per-string code. Product names and descriptions are the owner's
   own words and are left alone (translate="no"). Arabic flips the page right-to-left. */
import { flag } from "./flags.js?v=15";

export const LANGS = [
  { code: "en", tag: "en-GB", short: "EN", name: "English", flag: "gb" },
  { code: "us", tag: "en-US", short: "US", name: "English (US)", flag: "us" },
  { code: "fr", tag: "fr", short: "FR", name: "Français", flag: "fr" },
  { code: "ar", tag: "ar", short: "AR", name: "العربية", flag: "dz", dir: "rtl" },
  { code: "es", tag: "es", short: "ES", name: "Español", flag: "es" },
  { code: "de", tag: "de", short: "DE", name: "Deutsch", flag: "de" },
  { code: "tr", tag: "tr", short: "TR", name: "Türkçe", flag: "tr" },
  { code: "it", tag: "it", short: "IT", name: "Italiano", flag: "it" },
];
const ATTRS = ["placeholder", "aria-label", "title", "alt"];
const SKIP = "SCRIPT,STYLE,TEXTAREA,CODE,NOSCRIPT";
const texts = new WeakMap(), attrs = new WeakMap();     // node -> { en, out }
let cur = LANGS[0], dict = Object.create(null), tpl = [], obs = null;
export const missing = new Set();                       // English strings with no translation (for tests)

const esc = s => s.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
const compile = d => Object.keys(d).filter(k => k.includes("{")).map(k => {
  const names = []; const re = new RegExp("^" + esc(k).replace(/\{(\w+)\}/g, (_, n) => (names.push(n), /^[nm]$/.test(n) ? "(\\d+)" : "([\\s\\S]+?)")).replace(/\{/g, "\\{") + "$");
  return { re, names, out: d[k] };
});
function tr(s) {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s), core = m[2];
  if (!core || cur.code === "en" || !/\p{L}/u.test(core)) return s;
  let out = dict[core];
  if (out == null) for (const t of tpl) { const x = t.re.exec(core); if (x) { out = t.out.replace(/\{(\w+)\}/g, (_, n) => { const v = x[t.names.indexOf(n) + 1] ?? ""; return dict[v] ?? v; }); break; } }
  if (out == null) { missing.add(core); return s; }
  return m[1] + out + m[3];
}
const skipped = el => el.closest?.(`${SKIP},[translate="no"]`);

function node(n) {
  if (n.nodeType === 3) {
    const p = n.parentElement; if (!p || skipped(p)) return;
    const r = texts.get(n), en = r && n.data === r.out ? r.en : n.data, out = tr(en);
    if (out !== n.data) n.data = out;
    texts.set(n, { en, out });
  } else if (n.nodeType === 1) {
    if (skipped(n)) return;
    for (const a of ATTRS) if (n.hasAttribute(a)) attr(n, a);
    for (let c = n.firstChild; c; c = c.nextSibling) node(c);
  }
}
function attr(el, a) {
  if (skipped(el)) return;
  const map = attrs.get(el) || attrs.set(el, {}).get(el), r = map[a], v = el.getAttribute(a);
  const en = r && v === r.out ? r.en : v, out = tr(en);
  if (out !== v) el.setAttribute(a, out);
  map[a] = { en, out };
}
const watch = () => {
  obs ||= new MutationObserver(list => {
    for (const m of list) {
      if (m.type === "childList") m.addedNodes.forEach(node);
      else if (m.type === "characterData") node(m.target);
      else attr(m.target, m.attributeName);
    }
  });
  obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
};

export const currentLang = () => cur;
/** Switch language (and remember it). */
export async function setLang(code, { save = true } = {}) {
  const l = LANGS.find(x => x.code === code) || LANGS[0];
  dict = Object.create(null); tpl = [];
  if (l.code !== "en") {
    try { dict = Object.assign(Object.create(null), (await import(`./lang/${l.code}.js?v=15`)).default); } catch { dict = {}; }
    tpl = compile(dict);
  }
  cur = l;
  const h = document.documentElement;
  h.lang = l.tag; h.dir = l.dir || "ltr";
  if (save) try { localStorage.setItem("lang", l.code); } catch {}
  obs?.disconnect();
  node(document.body);
  if (l.code !== "en") watch();
  paintButton();
  document.dispatchEvent(new CustomEvent("langchange", { detail: l }));
}

/* ── the button and its dropdown ─────────────────────── */
function paintButton() {
  const b = document.getElementById("langBtn"); if (!b) return;
  b.querySelector(".lang-flag").innerHTML = flag(cur.flag);
  b.querySelector(".lang-code").textContent = cur.short;
  document.querySelectorAll("#langMenu [data-lang]").forEach(x => x.setAttribute("aria-checked", String(x.dataset.lang === cur.code)));
}
export function mountLangMenu() {
  const btn = document.getElementById("langBtn"), menu = document.getElementById("langMenu");
  if (!btn || !menu) return;
  menu.innerHTML = LANGS.map(l => `<button type="button" role="menuitemradio" data-lang="${l.code}" aria-checked="false" lang="${l.tag}">${flag(l.flag)}<span class="lang-name">${l.name}</span><b>${l.short}</b></button>`).join("");
  const open = on => { menu.hidden = !on; btn.setAttribute("aria-expanded", String(on)); if (on) menu.querySelector('[aria-checked="true"]')?.focus({ preventScroll: true }); };
  btn.addEventListener("click", () => open(menu.hidden));
  menu.addEventListener("click", async e => {
    const b = e.target.closest("[data-lang]"); if (!b) return;
    open(false); btn.focus({ preventScroll: true });
    await setLang(b.dataset.lang);
  });
  document.addEventListener("click", e => { if (!menu.hidden && !e.target.closest(".lang")) open(false); });
  document.addEventListener("keydown", e => {
    if (menu.hidden) return;
    if (e.key === "Escape") { open(false); btn.focus(); }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault(); const all = [...menu.querySelectorAll("button")], i = all.indexOf(document.activeElement);
      all[(i + (e.key === "ArrowDown" ? 1 : -1) + all.length) % all.length].focus();
    }
  });
  paintButton();
}

export async function initI18n() {
  mountLangMenu();
  let saved = "en"; try { saved = localStorage.getItem("lang") || "en"; } catch {}
  await setLang(saved, { save: false });
}
