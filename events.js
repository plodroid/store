/* Events: the owner's own sales + seasonal looks (Ramadan, Eid, or a plain colour for anything he names himself).
   Shared by the shop (app.js) and the owner page (admin.js). The pricing here MUST match liveEvents_/quote_ in
   apps-script/Code.gs: the basket shows what the payment script then charges. The art is drawn here, all original SVG. */
import { priceOf, millis } from "./ui.js?v=16";

/* ── the looks an owner can pick ────────────────────── */
export const LOOKS = {
  plain:   { label: "Plain colour", blurb: "Your own event, in a colour you pick.", name: "", tagline: "" },
  ramadan: { label: "Ramadan", blurb: "Night sky, crescent moon, lanterns and gold.", name: "Ramadan Kareem", tagline: "Blessed nights, special prices" },
  eid:     { label: "Eid", blurb: "Warm cream and gold, arch, crescent and lanterns.", name: "Eid Mubarak", tagline: "Treats for the table, from our family to yours" },
};
export const SWATCHES = ["#F5B800", "#E8590C", "#D6336C", "#7048E8", "#1C7ED6", "#0CA678", "#2B8A3E", "#343A40"];

/* ── which events are on today ──────────────────────── */
/** Today's date in the UK as YYYY-MM-DD (dates the owner types mean UK days, wherever the phone is). */
export const todayUK = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
export const isLive = (e, today = todayUK()) =>
  !!e && e.active === true && (!e.startsAt || e.startsAt <= today) && (!e.endsAt || e.endsAt >= today);
/** Live events, newest first. The newest one decides how the shop looks. */
export const liveEvents = (list, today) =>
  list.filter(e => isLive(e, today)).sort((a, b) => millis(b.createdAt) - millis(a.createdAt) || String(a.name).localeCompare(String(b.name)));

/** Price after a percentage off, rounded to the penny exactly like the payment script. */
export const eventUnit = (price, pct) => Math.round(Math.round((Number(price) || 0) * 100) * (100 - pct) / 100) / 100;

/** Products with live events applied: a chosen product gets the best of its own sale price and the event's. */
export function withEvents(products, events) {
  const live = events.filter(e => (e.percentOff | 0) > 0 && Array.isArray(e.productIds));
  if (!live.length) return products;
  return products.map(p => {
    let best = priceOf(p), by = null;
    for (const e of live) {
      if (!e.productIds.includes(p.id)) continue;
      const u = eventUnit(p.price, e.percentOff);
      if (u < best) { best = u; by = e; }
    }
    return by ? { ...p, salePrice: best, eventName: by.name } : p;
  });
}

/* ── page theme ─────────────────────────────────────── */
const HEX = /^#[0-9a-f]{6}$/i;
const lum = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
const PLAIN_VARS = ["--accent", "--accent-hi", "--on-accent"];
const THEME_COLOR = { ramadan: ["#0C2C3B", "#07161E"], eid: ["#FBF1D9", "#17110A"] };      // [light, dark] browser-bar colours

/** Put the event's look on the whole page (or take it off when `ev` is null). */
export function applyTheme(ev, root = document.documentElement) {
  const look = ev && LOOKS[ev.look] ? ev.look : "";
  if (look) root.dataset.event = look; else delete root.dataset.event;
  const c = look === "plain" && HEX.test(ev.color || "") ? ev.color : null;
  PLAIN_VARS.forEach(v => root.style.removeProperty(v));
  if (c) {
    root.style.setProperty("--accent", c);
    root.style.setProperty("--accent-hi", `color-mix(in srgb, ${c} 86%, #000)`);
    root.style.setProperty("--on-accent", lum(c) > .36 ? "#241700" : "#FFFFFF");
  }
  paintMeta();
}
/** The phone's browser bar follows the event's colours (and light/dark). Called again whenever the theme is switched. */
export function paintMeta() {
  const r = document.documentElement, meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const dark = r.dataset.theme === "dark", t = THEME_COLOR[r.dataset.event];
  meta.content = t ? t[dark ? 1 : 0] : r.dataset.event === "plain" ? r.style.getPropertyValue("--accent") || "#F5B800" : dark ? "#161616" : "#FFF8E6";
}

/** What the scrolling bar says for an event: his own words if he typed some, else the offer. */
export const tickerText = e => e.ticker || ((e.percentOff | 0) > 0 && (e.productIds || []).length ? `${e.percentOff}% off for ${e.name}` : e.name);

/* ── hero ───────────────────────────────────────────── */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** The banner at the top of the shop. `cta` adds the "see the offers" button (off in the owner's preview). */
/** Inline CSS for a plain-colour banner (the owner's preview can't rely on the page-wide colour). */
export function heroVars(ev) {
  const c = ev.look === "plain" && HEX.test(ev.color || "") ? ev.color : null;
  return c ? `--accent:${c};--on-accent:${lum(c) > .36 ? "#241700" : "#FFFFFF"}` : "";
}

export function heroHtml(ev, { cta = true } = {}) {
  const pct = ev.percentOff | 0, n = (ev.productIds || []).length;
  const kicker = pct > 0 && n > 0 ? `${pct}% off ${n === 1 ? "one item" : "selected items"}` : "";
  return `<div class="ev-art" aria-hidden="true">${art(ev.look)}</div>
    <div class="ev-copy">
      ${kicker ? `<span class="ev-kicker">${esc(kicker)}</span>` : ""}
      <h2 class="ev-name">${esc(ev.name)}</h2>
      ${ev.tagline ? `<p class="ev-tag">${esc(ev.tagline)}</p>` : ""}
      ${cta && pct > 0 && n > 0 ? `<button class="ev-cta" id="evCta" type="button">See the offers</button>` : ""}
    </div>`;
}

/* ── art: original paper-cut style SVG, drawn from simple shapes ───────────────────────────
   Everything is coloured with CSS variables from events.css, so it follows light and dark mode.
   The viewBox is wide (1200x400) and the picture sits in the middle, so a phone, which crops
   the sides, still shows the moon and the lanterns. */
const seeded = seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

const star = (x, y, r, fill = "var(--ev-gold2)", o = 1) =>
  `<path transform="translate(${x} ${y}) scale(${r / 10})" opacity="${o}" fill="${fill}" d="M0-10Q1.3-1.3 10 0Q1.3 1.3 0 10Q-1.3 1.3-10 0Q-1.3-1.3 0-10Z"/>`;

/** Crescent centred on (x, y), radius r, opening to the right. Outer arc + inner arc, both drawn as plain paths. */
const crescent = (x, y, r, fill, stroke = "") =>
  `<path transform="translate(${x} ${y}) scale(${r / 60})" fill="${fill}" ${stroke} d="M17-57.6A60 60 0 1 0 48.2 35.8A50 50 0 1 1 17-57.6Z"/>`;

/** A hanging lantern: string from above the picture, cap, glowing body, tassel. */
const lantern = (x, y, s = 1, body = "var(--ev-gold)", glow = "var(--ev-glow)") =>
  `<g transform="translate(${x} ${y}) scale(${s})">
    <path d="M0 ${-(y + 30) / s}V0" stroke="${body}" stroke-width="${1.6 / s}" fill="none"/>
    <circle r="3.4" cy="-1" fill="none" stroke="${body}" stroke-width="2"/>
    <path d="M-7 3h14l6 9h-26z" fill="${body}"/>
    <path d="M-14 12h28c9 18 9 40 0 60h-28c-9-20-9-42 0-60z" fill="${body}"/>
    <path d="M-7.5 15c-6 17-6 39 0 54M7.5 15c6 17 6 39 0 54" fill="none" stroke="var(--ev-cut)" stroke-width="2.2" stroke-linecap="round"/>
    <ellipse cy="42" rx="5.5" ry="25" fill="${glow}"/>
    <path d="M-11 72h22l-5 8h-12z" fill="${body}"/>
    <path d="M0 80v13" stroke="${body}" stroke-width="2"/><circle cy="95" r="3" fill="${body}"/>
  </g>`;

/** A band of rounded paper clouds across the whole width, bottom-aligned at y=400. */
function clouds(top, bump, seed, fill, opacity = 1) {
  const r = seeded(seed);
  let d = `M-20 400V${top}`, x = -20;
  while (x < 1220) { const w = 70 + r() * 70, h = bump * (.55 + r() * .6); d += `a${(w / 2).toFixed(1)} ${h.toFixed(1)} 0 0 1 ${w.toFixed(1)} 0`; x += w; }
  return `<path d="${d}V400z" fill="${fill}" opacity="${opacity}"/>`;
}

const mosque = (x, base, s, fill) =>
  `<g transform="translate(${x} ${base}) scale(${s})" fill="${fill}">
    <path d="M-34 0v-46a34 34 0 0 1 68 0v46z"/><path d="M0-96v-14" stroke="${fill}" stroke-width="3"/><circle cy="-112" r="3"/>
    <path d="M-62 0v-86l7-14 7 14v86zM48 0v-86l7-14 7 14v86z"/><circle cx="-55" cy="-103" r="3"/><circle cx="55" cy="-103" r="3"/>
    <path d="M-100 0v-30a16 16 0 0 1 32 0v30zM68 0v-30a16 16 0 0 1 32 0v30z"/><path d="M-120 0H120v6H-120z"/>
  </g>`;

const DOTS = [[250, 80], [330, 150], [470, 60], [730, 70], [880, 140], [960, 60], [1010, 190], [180, 190], [545, 105], [655, 95]];

function art(look) {
  const open = `<svg viewBox="0 0 1200 400" preserveAspectRatio="xMidYMax slice" xmlns="http://www.w3.org/2000/svg" focusable="false">`;
  if (look === "ramadan") return open + `
    <rect width="1200" height="400" fill="var(--ev-bg)"/>
    ${DOTS.map(([x, y], i) => star(x, y, 5 + (i % 3) * 3, "var(--ev-gold2)", .85)).join("")}
    <g transform="translate(600 400) scale(.82) translate(-600 -400)">
    <circle cx="600" cy="196" r="168" fill="none" stroke="var(--ev-gold)" stroke-width="3"/>
    <circle cx="600" cy="196" r="152" fill="none" stroke="var(--ev-gold)" stroke-width="13" stroke-dasharray="19 9" opacity=".9"/>
    <circle cx="600" cy="196" r="136" fill="var(--ev-bg2)" stroke="var(--ev-gold)" stroke-width="2"/>
    ${crescent(609, 200, 82, "var(--ev-cut)")}
    ${crescent(600, 192, 82, "var(--ev-moon)")}
    ${star(668, 150, 17, "var(--ev-gold2)")}${star(520, 252, 7, "var(--ev-gold2)", .8)}${star(690, 238, 6, "var(--ev-gold2)", .7)}
    ${mosque(600, 356, 1.05, "var(--ev-sil)")}
    </g>
    ${lantern(318, 96, 1.25)}${lantern(222, 78, .95)}${lantern(886, 96, 1.25)}${lantern(986, 78, .95)}
    ${clouds(332, 22, 7, "var(--ev-cloud2)")}
    ${clouds(352, 20, 19, "var(--ev-cloud1)")}
    ${clouds(372, 16, 31, "var(--ev-bg)")}
  </svg>`;
  if (look === "eid") return open + `
    <defs><radialGradient id="evGlow"><stop offset="0" stop-color="var(--ev-gold2)" stop-opacity=".75"/><stop offset="1" stop-color="var(--ev-gold2)" stop-opacity="0"/></radialGradient></defs>
    <rect width="1200" height="400" fill="var(--ev-bg)"/>
    ${DOTS.map(([x, y], i) => star(x, y, 4 + (i % 3) * 2.5, "var(--ev-gold)", .55)).join("")}
    <g transform="translate(600 400) scale(.8) translate(-600 -400)">
    ${mosque(600, 400, 1.4, "var(--ev-sil)")}
    <path d="M426 400V206C426 112 530 74 600 14C670 74 774 112 774 206V400" fill="none" stroke="var(--ev-gold)" stroke-width="5" stroke-linejoin="round"/>
    <path d="M446 400V210C446 124 538 90 600 40C662 90 754 124 754 210V400" fill="none" stroke="var(--ev-gold)" stroke-width="1.8" opacity=".7"/>
    ${crescent(606, 168, 54, "var(--ev-gold)")}
    ${crescent(600, 162, 54, "var(--ev-moon)", 'stroke="var(--ev-gold)" stroke-width="2.6"')}
    ${star(654, 128, 14, "var(--ev-gold)")}${star(560, 224, 6, "var(--ev-gold)", .8)}
    </g>
    <circle cx="372" cy="128" r="78" fill="url(#evGlow)"/><circle cx="828" cy="164" r="96" fill="url(#evGlow)"/>
    ${lantern(372, 70, 1.3)}${lantern(828, 90, 1.6)}
  </svg>`;
  /* plain: soft shapes in the event's own colour */
  return open + `
    <rect width="1200" height="400" fill="var(--accent)"/>
    <circle cx="300" cy="360" r="190" fill="var(--on-accent)" opacity=".07"/><circle cx="930" cy="90" r="150" fill="var(--on-accent)" opacity=".07"/>
    <circle cx="640" cy="330" r="90" fill="var(--on-accent)" opacity=".06"/>
    ${[[160, 90, 9], [520, 70, 6], [760, 250, 8], [1050, 300, 10], [420, 210, 5]].map(([x, y, r]) => star(x, y, r * 2, "var(--on-accent)", .22)).join("")}
  </svg>`;
}
