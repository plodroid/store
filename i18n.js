/* Languages for the shop. The page is written in English; each language is one small file in lang/ that maps the
   English text to its translation. A tiny translator walks the page (and watches for changes), so every label,
   toast and message follows the language with no per-string code. What the owner types (product names and
   descriptions, categories, events, the announcement bar) has no dictionary entry, so it is machine-translated on
   the fly (OWN below), cached on the device, and shown in English until the translation lands. Arabic flips the
   page right-to-left. */
import { flag } from "./flags.js?v=17";

export const LANGS = [
  { code: "en", tag: "en-GB", short: "EN", name: "English", flag: "gb" },
  { code: "us", tag: "en-US", short: "US", name: "English (US)", flag: "us" },
  { code: "fr", tag: "fr", short: "FR", name: "Français", flag: "fr" },
  { code: "ar", tag: "ar", short: "AR", name: "العربية", flag: "dz", dir: "rtl" },
  { code: "es", tag: "es", short: "ES", name: "Español", flag: "es" },
  { code: "de", tag: "de", short: "DE", name: "Deutsch", flag: "de" },
  { code: "tr", tag: "tr", short: "TR", name: "Türkçe", flag: "tr" },
  { code: "it", tag: "it", short: "IT", name: "Italiano", flag: "it" },
  { code: "hi", tag: "hi", short: "HI", name: "हिन्दी", flag: "in" },
  { code: "ur", tag: "ur", short: "UR", name: "اردو", flag: "pk", dir: "rtl" },
  { code: "bn", tag: "bn", short: "BN", name: "বাংলা", flag: "bd" },
  { code: "pa", tag: "pa", short: "PA", name: "ਪੰਜਾਬੀ", flag: "in" },
  { code: "pl", tag: "pl", short: "PL", name: "Polski", flag: "pl" },
  { code: "ro", tag: "ro", short: "RO", name: "Română", flag: "ro" },
  { code: "pt", tag: "pt", short: "PT", name: "Português", flag: "pt" },
  { code: "nl", tag: "nl", short: "NL", name: "Nederlands", flag: "nl" },
  { code: "ru", tag: "ru", short: "RU", name: "Русский", flag: "ru" },
  { code: "zh", tag: "zh-CN", short: "ZH", name: "中文", flag: "cn" },
  { code: "ja", tag: "ja", short: "JA", name: "日本語", flag: "jp" },
  { code: "ko", tag: "ko", short: "KO", name: "한국어", flag: "kr" },
  { code: "id", tag: "id", short: "ID", name: "Bahasa Indonesia", flag: "id" },
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
function tr(s, own) {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s), core = m[2];
  if (!core || cur.code === "en" || !/\p{L}/u.test(core)) return s;
  let out = dict[core];
  if (out == null) for (const t of tpl) { const x = t.re.exec(core); if (x) { out = t.out.replace(/\{(\w+)\}/g, (_, n) => { const v = x[t.names.indexOf(n) + 1] ?? ""; return dict[v] ?? v; }); break; } }
  if (out == null) { if (own) { const t = mt(core, own); return t ? m[1] + t + m[3] : s; } missing.add(core); return s; }
  return m[1] + out + m[3];
}
const skipped = el => el.closest?.(`${SKIP},[translate="no"]`);

/* ── the owner's own words: machine translation ─────────────────────────────────────────────
   Anything inside OWN (or marked data-own) that the dictionary doesn't know goes to a free translation service.
   Results are cached per language in localStorage, so each phrase is fetched once per device. */
const OWN = "[data-own],.tile-name,.pp-name,.pp-desc,.pp-cat,.line-name,.ev-name,.ev-tag,#announce,#catList .tab";
const mtCode = { us: null, en: null, zh: "zh-CN" };
const mem = {}, wait = new Map(), failed = new Set(); let q = [], busy = 0, saveT = 0, tickT = 0;
const cacheOf = lang => mem[lang] ||= (() => { try { return JSON.parse(localStorage.getItem("mt:" + lang)) || {}; } catch { return {}; } })();
const flush = () => { clearTimeout(saveT); saveT = setTimeout(() => { for (const l in mem) try { localStorage.setItem("mt:" + l, JSON.stringify(mem[l])); } catch {} }, 600); };
/* A single word is ambiguous ("Dates" is a fruit here, not a calendar), so short names get a shop hint that is cut off again. */
const HINT = " - groceries";
async function gtx(text, tl) {
  const hint = text.split(/\s+/).length <= 3 && !/\d/.test(text) ? HINT : "";
  const r = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${tl}&dt=t&q=${encodeURIComponent(text + hint)}`);
  if (!r.ok) throw 0;
  let out = (await r.json())[0].map(x => x[0]).join("").trim();
  if (hint) out = out.replace(/\s+[-–—]\s+[^-–—]+$/, "");
  if (!out) throw 0; return out;
}
async function memory(text, tl) {
  const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|${tl}`);
  const out = (await r.json())?.responseData?.translatedText;
  if (!out || /MYMEMORY|QUERY LENGTH/i.test(out)) throw 0; return out;
}
async function pump() {
  while (busy < 4 && q.length) {
    const job = q.shift(); busy++;
    (async () => {
      const [lang, text] = job, tl = mtCode[lang] === undefined ? lang : mtCode[lang];
      let out; try { out = await gtx(text, tl); } catch { try { out = await memory(text, tl); } catch {} }
      if (out) { cacheOf(lang)[text] = out; flush(); } else failed.add(lang + "\u0000" + text);
      const nodes = wait.get(lang + "\u0000" + text); wait.delete(lang + "\u0000" + text);
      if (out && lang === cur.code) { nodes?.forEach(n => n.isConnected && node(n)); clearTimeout(tickT); tickT = setTimeout(() => document.dispatchEvent(new CustomEvent("mtupdate")), 80); }
      busy--; pump();
    })();
  }
}
/** The cached translation, or null (and a fetch is started). */
function mt(core, n) {
  if (!/\p{L}/u.test(core) || core.length > 400) return null;
  const lang = cur.code; if (mtCode[lang] === null) return null;
  const hit = cacheOf(lang)[core]; if (hit) return hit;
  const key = lang + "\u0000" + core; if (failed.has(key)) return null;
  if (!wait.has(key)) { wait.set(key, new Set()); q.push([lang, core]); pump(); }
  wait.get(key).add(n); return null;
}

function node(n) {
  if (n.nodeType === 3) {
    const p = n.parentElement; if (!p || skipped(p)) return;
    const r = texts.get(n), en = r && n.data === r.out ? r.en : n.data, out = tr(en, p.closest(OWN) && n);
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
    try { dict = Object.assign(Object.create(null), (await import(`./lang/${l.code}.js?v=16`)).default); } catch { dict = {}; }
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
