/* Owner analytics — everything is computed in the browser from the orders already loaded.
   One hue (honey) for magnitude, one cool hue for the second category, text always in ink. */

import { esc, money, millis, priceOf } from "./ui.js?v=16";

const DAY = 864e5, RANGES = { 7: "7 days", 30: "30 days", 90: "90 days" };
const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const val = o => o.total != null ? o.total : (o.estTotal || 0);
const when = o => millis(o.createdAt) || Date.now();
const startOfDay = ms => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
const fmtDay = ms => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const itemCount = o => (o.items || []).reduce((n, i) => n + (i.qty || 0), 0);
const niceMax = v => { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)), f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; };
const short = v => v >= 1000 ? `£${+(v / 1000).toFixed(1)}k` : `£${Math.round(v)}`;

function delta(cur, prev) {
  if (!prev) return cur ? `<span class="dl up">New</span>` : `<span class="dl">–</span>`;
  const pct = Math.round((cur - prev) / prev * 100);
  return `<span class="dl ${pct > 0 ? "up" : pct < 0 ? "down" : ""}">${pct > 0 ? "▲" : pct < 0 ? "▼" : "•"} ${Math.abs(pct)}%</span>`;
}

export function analyticsHtml(allOrders, products, range) {
  const orders = allOrders.filter(o => o.status !== "cancelled");
  const today = startOfDay(Date.now());
  const from = today - (range - 1) * DAY, prevFrom = from - range * DAY, end = today + DAY;
  const cur = orders.filter(o => when(o) >= from && when(o) < end);
  const prev = orders.filter(o => when(o) >= prevFrom && when(o) < from);
  const sum = list => list.reduce((t, o) => t + val(o), 0);
  const rev = sum(cur), prevRev = sum(prev);
  const avg = cur.length ? rev / cur.length : 0, prevAvg = prev.length ? prevRev / prev.length : 0;
  const items = cur.reduce((n, o) => n + itemCount(o), 0), prevItems = prev.reduce((n, o) => n + itemCount(o), 0);
  const cancelled = allOrders.filter(o => o.status === "cancelled" && when(o) >= from && when(o) < end).length;

  if (!cur.length && !prev.length) {
    return `<section class="adm-card an"><div class="an-head"><h3>Sales &amp; insights</h3>${rangeChips(range)}</div>
      <p class="adm-empty small">No orders in the last ${RANGES[range]} yet. Charts appear here as soon as customers start ordering.</p></section>`;
  }

  /* ── trend: daily buckets, weekly for 90 days ── */
  const step = range > 30 ? 7 : 1, nb = Math.ceil(range / step);
  const buckets = Array.from({ length: nb }, (_, i) => ({ t: from + i * step * DAY, rev: 0, n: 0 }));
  for (const o of cur) { const b = buckets[Math.min(nb - 1, Math.floor((startOfDay(when(o)) - from) / (step * DAY)))]; b.rev += val(o); b.n++; }
  const W = Math.max(300, Math.min(680, (innerWidth || 400) - 70)), H = Math.round(W * .5), L = 38, R = 8, T = 10, B = 24, pw = W - L - R, ph = H - T - B;
  const ymax = niceMax(Math.max(...buckets.map(b => b.rev)));
  const x = i => L + (nb === 1 ? pw / 2 : pw * i / (nb - 1)), y = v => T + ph - ph * v / ymax;
  const grid = [0, .25, .5, .75, 1].map(f => `<line class="gl" x1="${L}" x2="${W - R}" y1="${y(ymax * f)}" y2="${y(ymax * f)}"/><text class="ax" x="${L - 6}" y="${y(ymax * f) + 3.5}" text-anchor="end">${short(ymax * f)}</text>`).join("");
  const ticks = [...new Set([0, 1, 2, 3, 4].map(k => Math.round(k * (nb - 1) / 4)))].map(i => `<text class="ax" x="${x(i)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : i === nb - 1 ? "end" : "middle"}">${fmtDay(buckets[i].t)}</text>`).join("");
  const pts = buckets.map((b, i) => `${x(i).toFixed(1)},${y(b.rev).toFixed(1)}`).join(" ");
  const area = `${L},${y(0)} ${pts} ${x(nb - 1).toFixed(1)},${y(0)}`;
  const dots = nb <= 14 ? buckets.map((b, i) => b.n ? `<circle class="pt" cx="${x(i).toFixed(1)}" cy="${y(b.rev).toFixed(1)}" r="3.5"/>` : "").join("") : "";
  const bw = Math.max(3, Math.min(10, pw / nb - 3)), nmax = Math.max(1, ...buckets.map(b => b.n));
  const obars = buckets.map((b, i) => { const h = Math.max(b.n ? 2 : 0, Math.round(b.n / nmax * 34)); return h ? `<rect class="ob" x="${(x(i) - bw / 2).toFixed(1)}" y="${40 - h}" width="${bw.toFixed(1)}" height="${h}" rx="2"/>` : ""; }).join("");
  const label = b => step === 1 ? fmtDay(b.t) : `${fmtDay(b.t)} – ${fmtDay(Math.min(b.t + 6 * DAY, today))}`;
  const data = esc(JSON.stringify(buckets.map((b, i) => ({ x: +(x(i) / W).toFixed(4), d: label(b), r: money(b.rev), n: b.n }))));

  /* ── top products ── */
  const byId = new Map(products.map(p => [p.id, p])), agg = new Map();
  for (const o of cur) {
    const locked = Array.isArray(o.lines);
    for (const l of (locked ? o.lines : o.items || [])) {
      const id = l.productId || l.name, p = byId.get(l.productId);
      const price = locked ? (l.unitPrice || 0) : (p ? priceOf(p) || 0 : 0);
      const e = agg.get(id) || { name: l.name || p?.name || "Unknown", qty: 0, rev: 0 };
      e.qty += l.qty || 0; e.rev += price * (l.qty || 0); agg.set(id, e);
    }
  }
  const top = [...agg.values()].sort((a, b) => b.rev - a.rev || b.qty - a.qty).slice(0, 6), tmax = Math.max(1, ...top.map(t => t.rev || t.qty));
  const topHtml = top.map((t, i) => `<li><span class="rk">${i + 1}</span><div class="tp"><div class="tp-l"><span class="adm-clip">${esc(t.name)}</span><b>${t.rev ? money(t.rev) : "–"}<small> · ${t.qty} sold</small></b></div><div class="trk"><i style="width:${Math.max(3, (t.rev || t.qty) / tmax * 100).toFixed(1)}%"></i></div></div></li>`).join("");

  /* ── when people order ── */
  const hours = Array(24).fill(0), wd = Array(7).fill(0);
  for (const o of cur) { const d = new Date(when(o)); hours[d.getHours()]++; wd[(d.getDay() + 6) % 7]++; }
  const hmax = Math.max(1, ...hours), wmax = Math.max(1, ...wd);
  const peakH = hours.indexOf(Math.max(...hours)), peakD = wd.indexOf(Math.max(...wd));
  const hh = h => `${String(h).padStart(2, "0")}:00`;
  const heat = hours.map((n, h) => `<i class="hc" style="--a:${(n / hmax).toFixed(2)}" title="${hh(h)}–${hh((h + 1) % 24)}: ${n} order${n === 1 ? "" : "s"}"></i>`).join("");
  const wdBars = wd.map((n, i) => `<div class="wd" title="${WD[i]}: ${n} order${n === 1 ? "" : "s"}"><span class="wn">${n || ""}</span><i style="height:${Math.max(n ? 4 : 2, n / wmax * 56)}px" class="${n ? "" : "z"}"></i><em>${WD[i][0]}</em></div>`).join("");

  /* ── pick-up vs delivery, new vs returning ── */
  const del = cur.filter(o => o.fulfilment === "delivery").length, pick = cur.length - del;
  const firstSeen = new Map();
  for (const o of [...orders].sort((a, b) => when(a) - when(b))) {
    const k = (o.customer?.email || o.customer?.phone || "").toLowerCase(); if (k && !firstSeen.has(k)) firstSeen.set(k, when(o));
  }
  const keys = new Set(); let ret = 0, fresh = 0;
  for (const o of cur) {
    const k = (o.customer?.email || o.customer?.phone || "").toLowerCase(); if (!k || keys.has(k)) continue;
    keys.add(k); firstSeen.get(k) < from ? ret++ : fresh++;
  }
  const split = (a, b, la, lb, ca, cb) => {
    const t = a + b || 1;
    return `<div class="split" role="img" aria-label="${la} ${a}, ${lb} ${b}"><i class="${ca}" style="flex:${a}"></i><i class="${cb}" style="flex:${b}"></i></div>
      <div class="lg"><span><s class="${ca}"></s>${la} <b>${a}</b> <small>${Math.round(a / t * 100)}%</small></span><span><s class="${cb}"></s>${lb} <b>${b}</b> <small>${Math.round(b / t * 100)}%</small></span></div>`;
  };

  const kpi = (l, v, d, sub) => `<div class="kpi"><span>${l}</span><b>${v}</b><div>${d}<small>${sub}</small></div></div>`;
  return `<section class="adm-card an">
    <div class="an-head"><h3>Sales &amp; insights</h3>${rangeChips(range)}</div>
    <div class="kpis">
      ${kpi("Sales", money(rev), delta(rev, prevRev), `vs ${money(prevRev)} before`)}
      ${kpi("Orders", cur.length, delta(cur.length, prev.length), `vs ${prev.length} before`)}
      ${kpi("Average order", money(avg), delta(avg, prevAvg), cur.length ? `${(items / cur.length).toFixed(1)} items each` : "")}
      ${kpi("Items sold", items, delta(items, prevItems), cancelled ? `${cancelled} cancelled` : "none cancelled")}
    </div>
    <h4>Sales per ${step === 1 ? "day" : "week"}</h4>
    <div class="aw" data-an="${data}">
      <svg class="achart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Sales per ${step === 1 ? "day" : "week"}, last ${RANGES[range]}: total ${money(rev)}">
        ${grid}${ticks}<polygon class="ar" points="${area}"/><polyline class="ln" points="${pts}"/>${dots}
        <line class="cx" x1="0" x2="0" y1="${T}" y2="${T + ph}" hidden/><circle class="cd" r="4.5" hidden/>
      </svg>
      <div class="tip" hidden></div>
    </div>
    <h4>Orders per ${step === 1 ? "day" : "week"}</h4>
    <svg class="achart short" viewBox="0 0 ${W} 44" role="img" aria-label="Orders per ${step === 1 ? "day" : "week"}"><line class="gl" x1="${L}" x2="${W - R}" y1="40.5" y2="40.5"/>${obars}</svg>

    <div class="an-grid">
      <div><h4>Best sellers</h4>${top.length ? `<ol class="top">${topHtml}</ol>` : `<p class="muted small">Nothing sold yet.</p>`}</div>
      <div>
        <h4>Busiest times</h4>
        <div class="heat">${heat}</div><div class="hax"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>
        <p class="note">Most orders around <b>${hh(peakH)}</b>, busiest day <b>${["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][peakD]}</b>.</p>
        <div class="wds">${wdBars}</div>
        <h4>Pick-up or delivery</h4>${split(pick, del, "Pick-up", "Delivery", "c1", "c2")}
        <h4>Customers</h4>${split(fresh, ret, "New", "Returning", "c1", "c2")}
      </div>
    </div>
  </section>`;
}

const rangeChips = r => `<div class="rng" role="group" aria-label="Time range">${Object.entries(RANGES).map(([k, l]) => `<button type="button" class="fchip" data-act="arange" data-r="${k}" aria-pressed="${+k === r}">${l}</button>`).join("")}</div>`;

/* crosshair + tooltip; call after each paint */
export function wireAnalytics(root) {
  const wrap = root.querySelector(".aw"); if (!wrap) return;
  const pts = JSON.parse(wrap.dataset.an), svg = wrap.querySelector("svg"), tip = wrap.querySelector(".tip");
  const cx = svg.querySelector(".cx"), cd = svg.querySelector(".cd"), vb = svg.viewBox.baseVal;
  const hide = () => { tip.hidden = cx.hidden = cd.hidden = true; };
  wrap.onpointermove = e => {
    const r = svg.getBoundingClientRect(), fx = (e.clientX - r.left) / r.width;
    const p = pts.reduce((a, b) => Math.abs(b.x - fx) < Math.abs(a.x - fx) ? b : a);
    const px = p.x * vb.width;
    cx.setAttribute("x1", px); cx.setAttribute("x2", px); cx.hidden = false;
    const ys = [...svg.querySelectorAll(".ln")][0].points, idx = pts.indexOf(p);
    cd.setAttribute("cx", ys[idx].x); cd.setAttribute("cy", ys[idx].y); cd.hidden = false;
    tip.innerHTML = `<b>${esc(p.r)}</b><span>${esc(p.d)} · ${p.n} order${p.n === 1 ? "" : "s"}</span>`;
    tip.hidden = false;
    const left = p.x * r.width, w = tip.offsetWidth;
    tip.style.left = Math.min(Math.max(left - w / 2, 0), r.width - w) + "px";
  };
  wrap.onpointerleave = hide;
}
