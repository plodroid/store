/* The scrolling bar at the top of the shop: live event offers first, then the owner's own messages.
   Plain CSS animation (transform only, so it stays smooth on phones); paused on hover/focus and still for people who asked for less motion. */
import { esc } from "./ui.js?v=15";

let last = "";
export const resetTicker = () => { last = ""; };
/** items: plain strings. Pass [] to hide the bar. */
export function paintTicker(el, items) {
  const list = items.map(s => String(s).trim()).filter(Boolean);
  const key = JSON.stringify(list);
  if (key === last) return;
  last = key;
  el.hidden = !list.length;
  if (!list.length) { el.innerHTML = ""; return; }
  const dot = `<i class="tk-dot" aria-hidden="true"></i>`;
  const group = n => `<div class="tk-group"${n ? ` aria-hidden="true"` : ""}>${list.map(s => `<span class="tk-item">${esc(s)}</span>${dot}`).join("")}</div>`;
  el.innerHTML = `<div class="tk-track">${group(0)}${group(1)}</div>`;
  // one group must be wider than the screen, or the loop would show a gap: repeat the messages until it is
  requestAnimationFrame(() => {
    const track = el.firstElementChild, g = track && track.firstElementChild; if (!g) return;
    const w = g.scrollWidth || 1, need = Math.min(40, Math.max(1, Math.ceil((el.clientWidth + 40) / w)));
    if (need > 1) { for (const grp of track.children) grp.innerHTML = grp.innerHTML.repeat(need); }
    track.style.setProperty("--dur", `${Math.max(14, Math.round((g.scrollWidth * 1) / 55))}s`);   // ~55px per second
  });
}

/** Owner's messages: one per line (or separated by " | "). */
export const splitMessages = s => String(s || "").split(/\n|\s\|\s/).map(x => x.trim()).filter(Boolean);
