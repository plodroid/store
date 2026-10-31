/* Owner: shares his position with the customers whose order is on its way, and ONLY then.
   - starts by itself when an order goes "on its way"; stops (and deletes what it wrote) as soon as no delivery is out
   - asks the phone for location permission when the owner opens the app, and tells him plainly what is going on
   - works while the app is open (it keeps the screen awake while a delivery is out); a phone can't share from a closed app
   Written to tracking/{orderId} (rules: owner writes, only that order's customer reads). */

const OUT = ["ontheway", "arrived", "ready"];                   // "ready" on a delivery order = out for delivery (older orders)
export const isOut = o => o && o.fulfilment === "delivery" && OUT.includes(o.status);
const touch = () => { try { return !!(window.Capacitor?.isNativePlatform?.() || matchMedia("(pointer: coarse)").matches); } catch { return false; } };
const KEY = "shareLoc";

export function createTracker(getFS, onChange = () => {}) {
  let watch = null, wake = null, last = null, lastWrite = 0, perm = "unknown", out = [], wrote = new Set(), cleaned = false, permObj = null;

  const wants = () => { try { const v = localStorage.getItem(KEY); return v === null ? touch() : v === "1"; } catch { return touch(); } };
  const supported = () => !!navigator.geolocation;
  const state = () => ({ supported: supported(), perm, wants: wants(), tracking: watch != null, n: out.length, last });

  async function readPerm() {
    try {
      permObj ||= await navigator.permissions.query({ name: "geolocation" });
      permObj.onchange = () => { perm = permObj.state; onChange(state()); sync(); };
      perm = permObj.state;
    } catch { perm = "unknown"; }
    onChange(state());
  }

  async function lock() {
    try { if (!wake && navigator.wakeLock) { wake = await navigator.wakeLock.request("screen"); wake.addEventListener("release", () => { wake = null; }); } } catch {}
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && watch != null) lock(); });

  async function push() {
    const FS = getFS(); if (!FS || !last || !out.length) return;
    if (Date.now() - lastWrite < 5000) return;
    lastWrite = Date.now();
    const { db, fs } = FS;
    await Promise.all(out.map(o => fs.setDoc(fs.doc(db, "tracking", o.id), { lat: last.lat, lng: last.lng, ...(Number.isFinite(last.heading) ? { heading: Math.round(last.heading) } : {}), updatedAt: fs.serverTimestamp() })
      .then(() => wrote.add(o.id)).catch(e => console.warn("[track] write", e && e.code))));
  }

  function start() {
    if (watch != null || !supported()) return;
    watch = navigator.geolocation.watchPosition(p => {
      last = { lat: p.coords.latitude, lng: p.coords.longitude, heading: p.coords.heading, at: Date.now() };
      perm = "granted"; onChange(state()); push();
    }, err => { if (err && err.code === 1) perm = "denied"; onChange(state()); },
    { enableHighAccuracy: true, maximumAge: 4000, timeout: 20000 });
    lock(); onChange(state());
  }

  async function wipe(keep = []) {
    const FS = getFS(); if (!FS) return;
    const { db, fs } = FS, ids = [...wrote].filter(id => !keep.includes(id));
    await Promise.all(ids.map(id => fs.deleteDoc(fs.doc(db, "tracking", id)).then(() => wrote.delete(id)).catch(() => {})));
  }

  function stop() {
    if (watch != null) { try { navigator.geolocation.clearWatch(watch); } catch {} watch = null; }
    try { wake && wake.release(); } catch {} wake = null;
    last = null; lastWrite = 0;
    wipe(); onChange(state());
  }

  /** Call whenever the orders change. */
  async function sync(orders) {
    if (orders) out = orders.filter(isOut);
    const FS = getFS();
    if (FS && !cleaned && orders) {                                    // first look at the orders: remove positions left behind by a crash or a closed app
      cleaned = true;
      try { const { db, fs } = FS, snap = await fs.getDocs(fs.collection(db, "tracking")); snap.docs.forEach(d => { if (!out.some(o => o.id === d.id)) fs.deleteDoc(d.ref).catch(() => {}); }); } catch {}
    }
    if (out.length && wants() && supported()) { start(); if (last) push(); }
    else if (watch != null) stop();
    else wipe(out.map(o => o.id));
    onChange(state());
  }

  return {
    state, sync, stop, readPerm,
    /** The owner switched sharing on/off (kept on this phone). */
    setShare(on) { try { localStorage.setItem(KEY, on ? "1" : "0"); } catch {} sync(); },
    /** Ask the phone for location now (shows the system prompt once). */
    ask() {
      return new Promise(res => {
        if (!supported()) return res("unsupported");
        navigator.geolocation.getCurrentPosition(p => { perm = "granted"; last ||= { lat: p.coords.latitude, lng: p.coords.longitude, heading: null, at: Date.now() }; onChange(state()); res("granted"); },
          e => { perm = e && e.code === 1 ? "denied" : perm; onChange(state()); res(perm); }, { timeout: 15000, maximumAge: 60000 });
      });
    },
  };
}
