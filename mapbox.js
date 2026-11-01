/* Mapbox GL under the same small API the screens already use for Leaflet (marker / setView / fitBounds / polyline …),
   so the delivery map, the customer's tracking map and the owner's directions all switch to Mapbox by just adding a token.
   Loaded only when window.MAPBOX_TOKEN is set (a public "pk." token, restricted to the shop's web address in the Mapbox dashboard). */

const VER = "3.9.0";
let loading;
export function loadMapbox() {
  if (window.mapboxgl) return Promise.resolve(window.mapboxgl);
  return (loading ??= new Promise((ok, no) => {
    const css = document.createElement("link"); css.rel = "stylesheet"; css.href = `https://api.mapbox.com/mapbox-gl-js/v${VER}/mapbox-gl.css`; document.head.append(css);
    const js = document.createElement("script"); js.src = `https://api.mapbox.com/mapbox-gl-js/v${VER}/mapbox-gl.js`;
    js.onload = () => ok(window.mapboxgl); js.onerror = () => { loading = null; no(new Error("Mapbox didn't load")); };
    document.head.append(js);
  }));
}

const ll = p => Array.isArray(p) ? [p[1], p[0]] : [p.lng, p.lat];          // Leaflet order [lat,lng] / {lat,lng} → Mapbox [lng,lat]
const pad = p => Array.isArray(p) ? { top: p[1], bottom: p[1], left: p[0], right: p[0] } : p;

class Marker {
  constructor(gl, pos, o = {}) {
    this.gl = gl; this.pos = ll(pos); this.z = o.zIndexOffset || 0; this.o = o; this.fn = {};
    this.el = document.createElement("div");
    this.setIcon(o.icon);
    if (o.title) this.el.title = o.title;
    if (o.interactive === false) this.el.style.pointerEvents = "none";
    this.mk = new gl.Marker({ element: this.el, anchor: "center", offset: this.off }).setLngLat(this.pos);
    this.el.addEventListener("click", e => { e.stopPropagation(); (this.fn.click || []).forEach(f => f(e)); });
  }
  setIcon(i) {
    if (!i) return this;
    const [w, h] = i.iconSize || [0, 0], [ax, ay] = i.iconAnchor || [w / 2, h / 2];
    this.el.className = i.className || ""; this.el.innerHTML = i.html || "";
    this.el.style.width = w + "px"; this.el.style.height = h + "px";
    this.off = [w / 2 - ax, h / 2 - ay];
    if (this.mk) this.mk.setOffset(this.off);
    return this;
  }
  setZIndexOffset(z) { this.z = z; this.el.style.zIndex = String(1000 + z); return this; }
  addTo(map) { this.map = map; this.setZIndexOffset(this.z); this.mk.addTo(map.gl); return this; }
  remove() { cancelAnimationFrame(this.raf); this.mk.remove(); return this; }
  on(ev, f) { (this.fn[ev] ||= []).push(f); return this; }
  getLatLng() { return { lat: this.pos[1], lng: this.pos[0] }; }
  /** glides to the new spot instead of jumping: a moving van looks like it is driving, not teleporting */
  setLatLng(p) {
    const from = this.pos, to = ll(p), t0 = performance.now(), D = 900;
    cancelAnimationFrame(this.raf);
    if (Math.abs(from[0] - to[0]) + Math.abs(from[1] - to[1]) < 1e-9) return this;
    const step = now => {
      const k = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - k, 3);
      this.pos = [from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e]; this.mk.setLngLat(this.pos);
      if (k < 1) this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
    return this;
  }
}

class Line {
  constructor(map, pts, o = {}) { this.map = map; this.pts = pts; this.o = o; this.id = "ln" + Math.random().toString(36).slice(2, 8); }
  addTo(map) {
    const g = map.gl, add = () => {
      g.addSource(this.id, { type: "geojson", data: { type: "Feature", geometry: { type: "LineString", coordinates: this.pts.map(ll) } } });
      g.addLayer({ id: this.id + "c", type: "line", source: this.id, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#fff", "line-width": (this.o.weight || 6) + 4, "line-opacity": .9 } });
      g.addLayer({ id: this.id, type: "line", source: this.id, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": this.o.color || "#1A73E8", "line-width": this.o.weight || 6, "line-opacity": this.o.opacity ?? 1 } });
    };
    this.added = true; map.ready(add); return this;
  }
  getBounds() { return this.pts; }
  remove() { const g = this.map.gl; if (this.added) { for (const id of [this.id, this.id + "c"]) if (g.getLayer(id)) g.removeLayer(id); if (g.getSource(this.id)) g.removeSource(this.id); } return this; }
}

class MapFacade {
  constructor(gl, map) { this.gl = map; this.mb = gl; this.q = []; this.loaded = false; map.on("load", () => { this.loaded = true; this.q.splice(0).forEach(f => f()); }); }
  ready(f) { this.loaded ? f() : this.q.push(f); }
  setView(p, z) { this.gl.jumpTo({ center: ll(p), zoom: Math.max(0, (z || 12) - 1) }); return this; }             // Leaflet zoom z ≈ Mapbox zoom z-1 (512px tiles)
  fitBounds(pts, o = {}) {
    const b = new this.mb.LngLatBounds();
    pts.forEach(p => b.extend(ll(p)));
    this.gl.fitBounds(b, { padding: pad(o.padding || [40, 40]), maxZoom: o.maxZoom ? o.maxZoom - 1 : 17, duration: o.animate === false ? 0 : 600 });
    return this;
  }
  panTo(p) { this.gl.easeTo({ center: ll(p), duration: 500 }); return this; }
  invalidateSize() { try { this.gl.resize(); } catch {} return this; }
  remove() { try { this.gl.remove(); } catch {} }
}

export async function makeMapboxMap(el, token, dark) {
  const gl = await loadMapbox();
  gl.accessToken = token;
  const map = new gl.Map({ container: el, style: `mapbox://styles/mapbox/navigation-${dark ? "night" : "day"}-v1`, center: [-1.13, 52.63], zoom: 11, attributionControl: true, dragRotate: false, pitchWithRotate: false });
  map.touchZoomRotate.disableRotation();
  map.addControl(new gl.NavigationControl({ showCompass: false }), "bottom-right");
  const facade = new MapFacade(gl, map);
  const L = {
    marker: (pos, o) => new Marker(gl, pos, o),
    polyline: (pts, o) => new Line(facade, pts, o),
    divIcon: o => o,
  };
  return { L, map: facade };
}
