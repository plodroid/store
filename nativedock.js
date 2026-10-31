/* iPhone app only: the bottom bar becomes a real iOS tab bar (Liquid Glass on iOS 26+, the normal system bar before that).
   The page keeps deciding what the tabs are and what a tap does; this file just mirrors the page's own bar to the phone.
   Anywhere else (browser, Android, an older iOS build without the plugin) nothing happens and the web bar stays. */
export function startNativeDock({ items, read, tap, watch }) {
  const cap = window.Capacitor;
  let plugin;
  try { if (!cap || !cap.isNativePlatform || !cap.isNativePlatform() || cap.getPlatform() !== "ios") return; plugin = cap.registerPlugin("NativeDock"); } catch { return; }
  const root = document.documentElement;
  const hex = c => { const m = /(\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(c || ""); return m ? "#" + [m[1], m[2], m[3]].map(n => (+n).toString(16).padStart(2, "0")).join("") : undefined; };
  let sig = "", busy = false, again = false, dead = false;

  async function push() {
    if (dead) return;
    if (busy) { again = true; return; }
    busy = true;
    try {
      const s = read();
      const payload = {
        hidden: !!s.hidden, selected: s.selected, tint: hex(getComputedStyle(s.tintEl || root).color),
        items: items.map(i => ({ id: i.id, title: (s.titles && s.titles[i.id]) || i.title, symbol: i.symbol, badge: (s.badges && s.badges[i.id]) || 0, more: i.more })),
      };
      const key = JSON.stringify(payload) + "|" + innerWidth + "x" + innerHeight;
      if (key !== sig) {
        const r = await plugin.update(payload);
        sig = key;
        const on = !payload.hidden;
        root.classList.toggle("native-dock", on);
        root.style.setProperty("--dock-h", (on ? Math.ceil(r.height) + 8 : 0) + "px");
      }
    } catch { dead = true; root.classList.remove("native-dock"); root.style.removeProperty("--dock-h"); }    // old build without the plugin: keep the web bar
    busy = false;
    if (again) { again = false; schedule(); }
  }
  let raf = 0;
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; push(); }); };

  try { plugin.addListener("tap", e => { try { tap(e && e.id); } catch {} setTimeout(schedule, 60); }); } catch { return; }
  const mo = new MutationObserver(schedule);
  for (const [el, opt] of watch()) if (el) mo.observe(el, opt);
  addEventListener("resize", schedule); addEventListener("orientationchange", schedule); addEventListener("hashchange", schedule);
  document.addEventListener("langchange", schedule);
  schedule();
}
