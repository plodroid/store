/* Owner: one map with every delivery on it (numbered pins), his own position, and one big button to start the directions.
   Built once and moved back into the page after each redraw, so the map doesn't flicker when orders change. */
import { makeMap } from "./geo.js?v=16";
import { esc } from "./ui.js?v=16";

const LIVE = ["confirmed", "preparing", "ontheway", "arrived", "ready"];
const rank = o => (o.status === "arrived" ? 0 : o.status === "ontheway" || o.status === "ready" ? 1 : 2);
export const deliveries = (orders, created = o => 0) => orders
  .filter(o => o.fulfilment === "delivery" && LIVE.includes(o.status) && o.address && typeof o.address.lat === "number" && typeof o.address.lng === "number")
  .sort((a, b) => rank(a) - rank(b) || created(a) - created(b));

/** → { box, update(orders, me), destroy() }. onGo(orderId) opens the directions. */
export function createDeliveryMap({ onGo, created }) {
  const box = document.createElement("section");
  box.className = "adm-card dm";
  box.innerHTML = `<h3>Deliveries map <span class="adm-badge" data-n></span></h3>
    <div class="dm-map" role="application" aria-label="Map of the deliveries"></div>
    <div class="dm-chips" role="tablist" aria-label="Choose a delivery"></div>
    <button class="btn-primary wide dm-go" type="button"></button>
    <p class="hint dm-hint"></p>`;
  const mapEl = box.querySelector(".dm-map"), chips = box.querySelector(".dm-chips"), go = box.querySelector(".dm-go"), hint = box.querySelector(".dm-hint");
  let L, map, pins = new Map(), meM = null, list = [], sel = null, me = null, fitKey = "", dead = false;

  const pin = (n, on) => L.divIcon({ className: "dm-pin" + (on ? " on" : ""), html: `<b><i>${n}</i></b>`, iconSize: [34, 42], iconAnchor: [17, 41] });
  const meIcon = () => L.divIcon({ className: "pin-wrap pin-me", html: "<i></i>", iconSize: [18, 18], iconAnchor: [9, 9] });

  function draw() {
    if (dead) return;
    box.querySelector("[data-n]").textContent = list.length;
    if (!list.find(o => o.id === sel)) sel = list[0] && list[0].id;
    chips.innerHTML = list.map((o, i) => `<button type="button" role="tab" class="dm-chip" aria-selected="${o.id === sel}" data-id="${esc(o.id)}"><b>${i + 1}</b>${esc(o.customer?.name || "Customer")}</button>`).join("");
    const cur = list.find(o => o.id === sel), i = list.indexOf(cur);
    go.hidden = !cur;
    if (cur) {
      const a = cur.address, out = ["ontheway", "arrived", "ready"].includes(cur.status);
      go.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 11 16-7-7 16-2-7z"/></svg><span>${out ? "Continue directions" : "Start directions"} · ${esc([a.line1, a.postcode].filter(Boolean).join(", "))}</span>`;
      hint.textContent = `${i + 1} of ${list.length} · ${cur.customer?.name || "Customer"}${cur.customer?.phone ? " · " + cur.customer.phone : ""}`;
    }
    if (!map) return;
    const keep = new Set(list.map(o => o.id));
    for (const [id, m] of pins) if (!keep.has(id)) { m.remove(); pins.delete(id); }
    list.forEach((o, k) => {
      const ll = [o.address.lat, o.address.lng], on = o.id === sel;
      let m = pins.get(o.id);
      if (!m) { m = L.marker(ll, { icon: pin(k + 1, on), keyboard: false, title: o.customer?.name || "Customer" }).addTo(map); m.on("click", () => { sel = o.id; draw(); }); pins.set(o.id, m); }
      else { m.setLatLng(ll); m.setIcon(pin(k + 1, on)); }
      m.setZIndexOffset(on ? 800 : 0);
    });
    if (me) { if (!meM) meM = L.marker([me.lat, me.lng], { icon: meIcon(), zIndexOffset: 900, interactive: false }).addTo(map); else meM.setLatLng([me.lat, me.lng]); }
    else if (meM) { meM.remove(); meM = null; }
    const key = list.map(o => o.id).join();
    if (key !== fitKey && list.length) {                                  // frame everything once per set of deliveries; never fight his panning
      fitKey = key;
      const pts = list.map(o => [o.address.lat, o.address.lng]); if (me) pts.push([me.lat, me.lng]);
      if (pts.length > 1) map.fitBounds(pts, { padding: [36, 36], maxZoom: 16, animate: false }); else map.setView(pts[0], 15, { animate: false });
    }
  }

  chips.addEventListener("click", e => { const b = e.target.closest("[data-id]"); if (!b) return; sel = b.dataset.id; draw(); const m = pins.get(sel); if (m && map) map.panTo(m.getLatLng()); });
  go.addEventListener("click", () => { if (sel) onGo(sel); });
  makeMap(mapEl).then(m => { if (dead) return m.map.remove(); ({ L, map } = m); draw(); setTimeout(() => { if (!dead) try { map.invalidateSize(); } catch {} }, 60); })
    .catch(() => { mapEl.hidden = true; hint.textContent = "The map couldn't load. The button below still opens the directions."; });

  return {
    box,
    update(orders, pos) { list = deliveries(orders, created); me = pos || null; draw(); },
    refit() { if (map && !dead) try { map.invalidateSize(); } catch {} },
    destroy() { dead = true; try { map && map.remove(); } catch {} box.remove(); },
  };
}
