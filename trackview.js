/* Customer: the map on a delivery order while it's on its way. Shows the shop's van coming and how long it will take.
   The shop only shares its position while the owner is on a delivery, and stops when he finishes. */
import { makeMap, icon, drive, fmtDist, fmtTime, metres } from "./geo.js?v=15";

const LIVE_MS = 3 * 60 * 1000;           // a position older than this means "not sharing right now"

/** → { box, update(order), destroy() }. `box` is a detached element: put it where the map should show. */
export function mountTracker(order, FS) {
  const { db, fs } = FS, dest = { lat: order.address.lat, lng: order.address.lng };
  const box = document.createElement("div");
  box.className = "mo-map";
  box.innerHTML = `<div class="mo-map-el"></div><p class="mo-map-cap muted" role="status">Loading the map…</p>`;
  const mapEl = box.firstElementChild, cap = box.lastElementChild;
  let map, L, van, pin, pos = null, eta = null, etaAt = 0, etaFrom = null, status = order.status, dead = false, fitted = false;

  const say = () => {
    if (status === "arrived") return "The shop has arrived. Please come to the door.";
    if (!pos) return "The shop will share its live position here when it sets off.";
    return eta ? `The shop is about ${fmtTime(eta.duration)} away (${fmtDist(eta.distance)}).` : "The shop is on its way.";
  };
  const draw = () => {
    cap.textContent = say();
    if (!map) return;
    if (pos) { const ll = [pos.lat, pos.lng]; if (!van) van = L.marker(ll, { icon: icon(L, "van"), zIndexOffset: 400 }).addTo(map); else van.setLatLng(ll); }
    else if (van) { van.remove(); van = null; }
    if (!fitted || pos) { const pts = pos ? [[pos.lat, pos.lng], [dest.lat, dest.lng]] : [[dest.lat, dest.lng]]; if (pts.length > 1) map.fitBounds(pts, { padding: [40, 40], maxZoom: 16 }); else map.setView(pts[0], 15); fitted = !!pos; }
  };

  makeMap(mapEl).then(m => { if (dead) return m.map.remove(); ({ L, map } = m); pin = L.marker([dest.lat, dest.lng], { icon: icon(L, "dest") }).addTo(map); draw(); setTimeout(() => map.invalidateSize(), 60); })
    .catch(() => { cap.textContent = say(); mapEl.hidden = true; });

  const unsub = fs.onSnapshot(fs.doc(db, "tracking", order.id), snap => {
    const d = snap.exists() ? snap.data() : null, t = d && d.updatedAt && typeof d.updatedAt.toMillis === "function" ? d.updatedAt.toMillis() : Date.now();
    pos = d && typeof d.lat === "number" && typeof d.lng === "number" && Date.now() - t < LIVE_MS ? { lat: d.lat, lng: d.lng } : null;
    draw();
    if (pos && (!etaFrom || metres(pos, etaFrom) > 60 || Date.now() - etaAt > 25000)) {
      etaAt = Date.now(); etaFrom = { ...pos };
      drive(pos, dest).then(r => { if (!dead && r) { eta = r; cap.textContent = say(); } });
    }
  }, err => { console.warn("[track]", err && err.code); });

  return {
    box,
    update(o) { status = o.status; cap.textContent = say(); },
    refit() { if (map) { map.invalidateSize(); fitted = false; draw(); } },
    destroy() { dead = true; unsub(); if (map) map.remove(); box.remove(); },
  };
}
