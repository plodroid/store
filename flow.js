/* The steps of an order, shared by the customer's "My orders" and the owner's panel: one bar, one idea.
   Delivery: Confirmed & paid > Preparing > On its way > Outside > Delivered.  Pick-up: Confirmed & paid > Preparing > Ready > Collected. */
import { esc } from "./ui.js?v=16";

export const stepsOf = o => o.fulfilment === "delivery"
  ? [o.paymentStatus === "paid" ? "Confirmed & paid" : "Confirmed", "Preparing", "On its way", "Outside", "Delivered"]
  : [o.paymentStatus === "paid" ? "Confirmed & paid" : "Confirmed", "Preparing", "Ready to collect", "Collected"];

/** Index of the step the order is on (-1 = not confirmed yet). */
export function stepIndex(o) {
  const last = stepsOf(o).length - 1;
  switch (o.status) {
    case "confirmed": return 0;
    case "preparing": return 1;
    case "ontheway": return 2;
    case "ready": return 2;                       // old orders: "ready" = out for delivery / ready to collect
    case "arrived": return 3;
    case "completed": return last;
    default: return -1;
  }
}

/** The bar. `done` steps are filled; the current one pulses until the order is finished. */
export function trackerHtml(o, { compact = false } = {}) {
  if (o.status === "cancelled") return "";
  const steps = stepsOf(o), i = stepIndex(o), n = steps.length, fin = o.status === "completed";
  const label = i < 0 ? "Waiting for the shop to confirm" : `Step ${i + 1} of ${n}: ${steps[i]}`;
  return `<ol class="trk${compact ? " sm" : ""}" style="--n:${n};--i:${Math.max(i, 0)}" role="img" aria-label="${esc(label)}">
    <span class="trk-line" aria-hidden="true"><b style="width:${i < 0 ? 0 : (i / (n - 1)) * 100}%"></b></span>
    ${steps.map((s, k) => `<li data-s="${k < i || (fin && k === i) ? "done" : k === i ? "now" : "todo"}"><i aria-hidden="true">${k < i || (fin && k === i) ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 10 17 19 7"/></svg>` : ""}</i><span>${esc(s)}</span></li>`).join("")}
  </ol>`;
}
