/* Owner: turn-by-turn directions to a delivery, and (if he leaves it on) the customer sees him coming on their map.
   Opens full screen over the admin. Uses the phone's GPS (watchPosition), OSRM for the route and OpenStreetMap for the map. */
import { makeMap, icon, drive, geocodeAddress, fmtDist, fmtTime, metres, arrowSvg } from "./geo.js?v=16";
import { esc } from "./ui.js?v=16";
import { lookupPostcode } from "./uk.js?v=16";

/** ctx: { FS, order, getAction: () => ({label, run}) | null, onClose } */
export async function openNav(ctx) {
  const { FS, order: o } = ctx, { db, fs } = FS, a = o.address || {};
  const root = document.createElement("div");
  root.className = "nav-panel"; root.setAttribute("role", "dialog"); root.setAttribute("aria-label", `Directions to ${o.ref}`);
  root.innerHTML = `
    <div class="nav-map" id="navMap"></div>
    <div class="nav-top"><div class="nav-arrow" id="navArrow"></div><div class="nav-next"><b id="navNext">Finding the best way…</b><span id="navDist"></span></div>
      <button type="button" class="nav-x" id="navClose" aria-label="Close directions"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>
    <div class="nav-sheet" id="navSheet">
      <div class="nav-eta"><div><b id="navEta">–</b><span id="navEtaSub">to ${esc(o.customer?.name || "the customer")}</span></div><div class="nav-where">${[a.line1, a.postcode].filter(Boolean).map(esc).join(", ")}</div></div>
      <label class="check nav-share"><input type="checkbox" id="navShare"><span>Let customers watch me arrive (only while I deliver)</span></label>
      <p class="nav-note" id="navNote" role="status"></p>
      <div class="nav-btns"><button class="btn-primary" type="button" id="navAct" hidden></button>
        <a class="btn-ghost" id="navG" target="_blank" rel="noopener">Open in Google Maps</a>
        <button class="btn-quiet" type="button" id="navSteps">All steps</button></div>
      <ol class="nav-steps" id="navList" hidden></ol>
    </div>`;
  document.body.append(root);
  document.body.classList.add("nav-open");
  const $ = s => root.querySelector(s), note = t => { $("#navNote").textContent = t || ""; };

  let dest = typeof a.lat === "number" && typeof a.lng === "number" ? { lat: a.lat, lng: a.lng } : null;
  let me = null, route = null, routeFrom = null, routeAt = 0, idx = 1, map, L, meM, destM, line, watch = null, stopped = false, fitted = false;

  const gmaps = () => { $("#navG").href = dest ? `https://www.google.com/maps/dir/?api=1&destination=${dest.lat},${dest.lng}&travelmode=driving` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([a.line1, a.city, a.postcode].filter(Boolean).join(", "))}`; };
  gmaps();

  try { ({ L, map } = await makeMap($("#navMap"))); }
  catch { note("The map couldn't load. Use “Open in Google Maps” instead."); }

  // where exactly is the customer? the house if OpenStreetMap knows it, else the middle of the postcode
  (async () => {
    const exact = await geocodeAddress(a);
    if (exact) dest = exact;
    else if (!dest && a.postcode) { const p = await lookupPostcode(a.postcode); if (p.ok && p.lat != null) dest = { lat: p.lat, lng: p.lng }; }
    if (stopped) return;
    if (!dest) return note("We couldn't place this address on the map. Use “Open in Google Maps”.");
    gmaps();
    if (map) { destM = L.marker([dest.lat, dest.lng], { icon: icon(L, "dest") }).addTo(map); map.setView([dest.lat, dest.lng], 15); }
    refresh(true);
  })();

  const act = () => {
    const x = ctx.getAction && ctx.getAction(), b = $("#navAct");
    b.hidden = !x; if (x) b.textContent = x.label;
  };
  act(); const actTimer = setInterval(act, 2000);
  $("#navAct").addEventListener("click", async e => { const x = ctx.getAction && ctx.getAction(); if (!x) return; e.target.disabled = true; try { await x.run(); } finally { e.target.disabled = false; act(); } });

  async function refresh(force) {
    if (!me || !dest || stopped) return;
    const moved = routeFrom ? metres(me, routeFrom) : Infinity;
    if (!force && moved < 120 && Date.now() - routeAt < 30000) return paint();
    if (!force && moved < 25) return paint();
    routeAt = Date.now(); routeFrom = { ...me };
    const r = await drive(me, dest);
    if (stopped) return;
    if (!r) { if (!route) note("Couldn't work out the route right now. Use “Open in Google Maps”."); return paint(); }
    note(""); route = r; idx = r.steps.length > 1 ? 1 : 0;
    if (map) { if (line) line.remove(); line = L.polyline(r.line, { color: "#1A73E8", weight: 6, opacity: .9 }).addTo(map); if (!fitted) { map.fitBounds(line.getBounds(), { padding: [50, 50] }); fitted = true; } }
    $("#navList").innerHTML = r.steps.map(s => `<li><span class="nav-ic">${arrowSvg(s.mod)}</span><span>${esc(s.text)}</span><em>${fmtDist(s.dist)}</em></li>`).join("");
    paint();
  }

  function paint() {
    if (!route || !me) return;
    while (idx < route.steps.length - 1 && metres(me, { lat: route.steps[idx].at[0], lng: route.steps[idx].at[1] }) < 30) idx++;
    const s = route.steps[idx], left = Math.max(0, route.distance - (routeFrom ? metres(routeFrom, me) : 0));
    const near = dest && metres(me, dest) < 45;
    $("#navNext").textContent = near ? "You have arrived" : s.text;
    $("#navArrow").innerHTML = arrowSvg(near ? "arrive" : s.mod);
    $("#navDist").textContent = near ? "" : `in ${fmtDist(metres(me, { lat: s.at[0], lng: s.at[1] }))}`;
    $("#navEta").textContent = near ? "Here" : fmtTime(route.duration * (left / Math.max(1, route.distance)));
    $("#navEtaSub").textContent = near ? "Tap the green button when you hand it over" : `${fmtDist(left)} to ${o.customer?.name || "the customer"}`;
  }

  // sharing is done for the whole app by track.js (it starts when the order goes "on its way"); this box just switches it on or off
  const tr = ctx.tracker;
  if (tr) { $("#navShare").checked = tr.state().wants; $("#navShare").addEventListener("change", e => tr.setShare(e.target.checked)); }
  else $("#navShare").closest("label").hidden = true;

  if (!navigator.geolocation) note("This phone can't share its position. Use “Open in Google Maps”.");
  else watch = navigator.geolocation.watchPosition(p => {
    me = { lat: p.coords.latitude, lng: p.coords.longitude };
    if (map) { if (!meM) meM = L.marker([me.lat, me.lng], { icon: icon(L, "me"), zIndexOffset: 500 }).addTo(map); else meM.setLatLng([me.lat, me.lng]); }
    refresh(!route);
  }, err => note(err && err.code === 1 ? "Location is switched off for this app. Allow it in the phone's settings, or use “Open in Google Maps”." : "Waiting for a GPS signal…"),
  { enableHighAccuracy: true, maximumAge: 4000, timeout: 20000 });

  $("#navSteps").addEventListener("click", () => { const l = $("#navList"); l.hidden = !l.hidden; root.classList.toggle("steps", !l.hidden); setTimeout(() => map && map.invalidateSize(), 50); });

  const close = async () => {
    stopped = true; clearInterval(actTimer);
    if (watch != null) navigator.geolocation.clearWatch(watch);
    if (map) map.remove();
    root.remove(); document.body.classList.remove("nav-open");
    ctx.onClose && ctx.onClose();
  };
  $("#navClose").addEventListener("click", close);
  addEventListener("keydown", function esc_(e) { if (e.key === "Escape" && !stopped) close(); if (stopped) removeEventListener("keydown", esc_); });
  return { close };
}
