/* Maps, routes and street lookups — all free services, no keys:
     • OpenStreetMap tiles (CARTO dark tiles at night) drawn with Leaflet (vendored in /vendor/leaflet)
     • OSRM for driving routes and turn-by-turn steps (router.project-osrm.org, public demo server: fine for one small shop)
     • Nominatim (OpenStreetMap) for "which street is this postcode on" and for finding a house on the map
   Every call returns null / false on any failure, never throws: the screens show a calm "couldn't load" instead of a broken page. */

const here = new URL(".", import.meta.url);
let leaflet;
/** Loads Leaflet once, only when a map is first needed (keeps the shop's first load light). */
export function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  return (leaflet ??= new Promise((ok, no) => {
    const css = document.createElement("link"); css.rel = "stylesheet"; css.href = new URL("vendor/leaflet/leaflet.css", here).href; document.head.append(css);
    const js = document.createElement("script"); js.src = new URL("vendor/leaflet/leaflet.js", here).href;
    js.onload = () => ok(window.L); js.onerror = () => { leaflet = null; no(new Error("map library didn't load")); };
    document.head.append(js);
  }));
}

const json = async (url, ms = 9000) => {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { signal: ctl.signal, headers: { accept: "application/json" } }); return r.ok ? await r.json() : null; }
  catch { return null; } finally { clearTimeout(t); }
};

/** The street and town a UK postcode sits on, from its position. → { street, area, town } or null. */
const streets = new Map();
export async function streetFor(lat, lng) {
  const k = `${(+lat).toFixed(4)},${(+lng).toFixed(4)}`;
  if (streets.has(k)) return streets.get(k);
  const r = await json(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&addressdetails=1&accept-language=en-GB&lat=${lat}&lon=${lng}`);
  const a = r && r.address; if (!a) return null;
  const street = a.road || a.pedestrian || a.residential || "";
  const out = street || a.city || a.town ? { street, area: a.suburb || a.neighbourhood || "", town: a.city || a.town || a.village || a.municipality || "" } : null;
  if (out) streets.set(k, out);
  return out;
}

const found = new Map();
/** Finds the actual house on the map (better than the middle of the postcode). → { lat, lng } or null. */
export async function geocodeAddress(a) {
  const q = [a.line1, a.city, a.postcode, "United Kingdom"].filter(Boolean).join(", ");
  if (found.has(q)) return found.get(q);
  const r = await json(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=gb&q=${encodeURIComponent(q)}`);
  const hit = Array.isArray(r) && r[0] ? { lat: Number(r[0].lat), lng: Number(r[0].lon) } : null;
  if (hit && Number.isFinite(hit.lat) && Number.isFinite(hit.lng)) { found.set(q, hit); return hit; }
  return null;
}

/** Driving route. from/to = { lat, lng }. → { distance (m), duration (s), line: [[lat,lng]…], steps: [{ text, dist, mod, at: [lat,lng] }] } or null. */
export async function drive(from, to) {
  const r = await json(`https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&steps=true`);
  const rt = r && r.code === "Ok" && r.routes && r.routes[0]; if (!rt) return null;
  return {
    distance: rt.distance, duration: rt.duration,
    line: rt.geometry.coordinates.map(([x, y]) => [y, x]),
    steps: rt.legs.flatMap(l => l.steps).map(s => ({ text: stepText(s), dist: s.distance, mod: s.maneuver.type === "arrive" ? "arrive" : s.maneuver.modifier || "straight", at: [s.maneuver.location[1], s.maneuver.location[0]] })),
  };
}

const TURN = { uturn: "Make a U-turn", "sharp right": "Turn sharp right", right: "Turn right", "slight right": "Bear right", straight: "Continue straight", "slight left": "Bear left", left: "Turn left", "sharp left": "Turn sharp left" };
export function stepText(s) {
  const m = s.maneuver || {}, name = s.name ? ` onto ${s.name}` : "";
  switch (m.type) {
    case "depart": return s.name ? `Head out on ${s.name}` : "Set off";
    case "arrive": return "You have arrived";
    case "roundabout": case "rotary": case "roundabout turn": return `At the roundabout, take exit ${m.exit || ""}${name}`.replace("exit ", "exit ").trim();
    case "merge": return `Merge${name}`;
    case "on ramp": case "off ramp": return `Take the ramp${name}`;
    case "fork": return `${m.modifier && m.modifier.includes("left") ? "Keep left" : "Keep right"} at the fork${name}`;
    case "end of road": return `${TURN[m.modifier] || "Turn"}${name} at the end of the road`;
    case "new name": case "continue": return `Continue${s.name ? " on " + s.name : ""}`;
    default: return `${TURN[m.modifier] || "Continue"}${name}`;
  }
}
const ANGLE = { straight: 0, "slight right": 35, right: 90, "sharp right": 135, uturn: 180, "sharp left": -135, left: -90, "slight left": -35 };
/** Little arrow for a step (arrives = a pin). */
export const arrowSvg = mod => mod === "arrive"
  ? `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.500a2.5 2.5 0 0 1 0 5z"/></svg>`
  : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="transform:rotate(${ANGLE[mod] ?? 0}deg)"><path d="M12 20V5M6 10.500l6-6 6 6"/></svg>`;

/** UK roads use miles. */
export const fmtDist = m => m < 160 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : m < 1000 ? `${Math.round(m / 50) * 50} m` : `${(m / 1609.34).toFixed(1)} mi`;
export const fmtTime = s => s < 90 ? "1 min" : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
/** Metres between two points (flat-earth maths is plenty at street scale). */
export const metres = (a, b) => { const k = 111320, dx = (a.lng - b.lng) * k * Math.cos(a.lat * Math.PI / 180), dy = (a.lat - b.lat) * k; return Math.hypot(dx, dy); };

const car = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5.500 11l1.400-4A2 2 0 0 1 8.800 5.500h6.400a2 2 0 0 1 1.900 1.500l1.400 4A2 2 0 0 1 20 13v4a1 1 0 0 1-1 1h-1a1.500 1.500 0 0 1-3 0H9a1.500 1.500 0 0 1-3 0H5a1 1 0 0 1-1-1v-4a2 2 0 0 1 1.500-2zM8.200 11h7.600l-1-3H9.200z"/></svg>`;
export function icon(L, kind) {
  const html = kind === "dest" ? `<div class="pin pin-dest"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.500A2.500 2.500 0 1 1 12 6.500a2.500 2.500 0 0 1 0 5z"/></svg></div>`
    : kind === "van" ? `<div class="pin pin-van">${car}</div>` : `<div class="pin pin-me"><i></i></div>`;
  return L.divIcon({ html, className: "pin-wrap", iconSize: kind === "dest" ? [34, 40] : [34, 34], iconAnchor: kind === "dest" ? [17, 38] : [17, 17] });
}

/** A map in `el`: light OpenStreetMap by day, CARTO dark at night. */
export async function makeMap(el) {
  const L = await loadLeaflet();
  const dark = document.documentElement.dataset.theme === "dark";
  const map = L.map(el, { zoomControl: false, attributionControl: true, tap: true }).setView([52.63, -1.13], 12);
  L.control.zoom({ position: "bottomright" }).addTo(map);
  map.attributionControl.setPrefix(false);
  L.tileLayer(dark ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" : "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    { maxZoom: 19, subdomains: "abcd", attribution: dark ? "© OpenStreetMap contributors © CARTO" : "© OpenStreetMap contributors" }).addTo(map);
  return { L, map };
}
