/* UK-only helpers: postcode format + lookup (postcodes.io, free, no key) and phone numbers.
   Pure functions where possible so they can be unit-tested in Node. */

// Official GOV.UK postcode pattern (spaces optional, case-insensitive).
const POSTCODE_RE = /^(GIR ?0AA|[A-PR-UWYZ]([0-9]{1,2}|([A-HK-Y][0-9]([0-9ABEHMNPRV-Y])?)|[0-9][A-HJKPS-UW]) ?[0-9][ABD-HJLNP-UW-Z]{2})$/i;

/** Lower-case, no space → tidy "XX1 1XX" form. Returns "" when it isn't shaped like a UK postcode. */
export function normalisePostcode(raw) {
  const s = String(raw ?? "").toUpperCase().replace(/\s+/g, "");
  if (!POSTCODE_RE.test(s)) return "";
  return `${s.slice(0, -3)} ${s.slice(-3)}`;
}

/** Normalises a UK phone number to +44… form, or "" if it doesn't look like one. */
export function normaliseUkPhone(raw) {
  let s = String(raw ?? "").replace(/[\s()-]/g, "");
  if (s.startsWith("+44")) s = "0" + s.slice(3);
  else if (s.startsWith("0044")) s = "0" + s.slice(4);
  if (s.startsWith("0") && s.slice(1).startsWith("0")) return "";     // 0(0)… typo
  if (!/^0\d{9,10}$/.test(s)) return "";
  return "+44" + s.slice(1);
}

/** Friendly "07123 456789"-style display for a normalised +44 number. */
export function showUkPhone(e164) {
  const s = String(e164 ?? "");
  if (!s.startsWith("+44")) return s;
  const n = "0" + s.slice(3);
  return n.startsWith("07") ? `${n.slice(0, 5)} ${n.slice(5)}` : `${n.slice(0, 5)} ${n.slice(5)}`;
}

const API = "https://api.postcodes.io";

/**
 * Checks that a postcode really exists in the UK.
 * → { ok:true, postcode, country, region, district, lat, lng, areas:[…] }
 * → { ok:false, reason:"format"|"unknown"|"network" }
 * Note: this proves the *postcode* is real. Free data can't confirm a house number or street.
 */
export async function lookupPostcode(raw, fetchImpl = globalThis.fetch) {
  const pc = normalisePostcode(raw);
  if (!pc) return { ok: false, reason: "format" };
  let res;
  try {
    res = await fetchImpl(`${API}/postcodes/${encodeURIComponent(pc)}`, { headers: { accept: "application/json" } });
  } catch { return { ok: false, reason: "network" }; }
  if (res.status === 404) return { ok: false, reason: "unknown" };
  if (!res.ok) return { ok: false, reason: "network" };
  let body;
  try { body = await res.json(); } catch { return { ok: false, reason: "network" }; }
  return shape(body && body.result);
}

/** Nearest postcode for GPS coordinates (used by "Use my current location"). */
export async function nearestPostcode(lat, lng, fetchImpl = globalThis.fetch) {
  let res;
  try {
    res = await fetchImpl(`${API}/postcodes?lon=${encodeURIComponent(lng)}&lat=${encodeURIComponent(lat)}&limit=1`);
  } catch { return { ok: false, reason: "network" }; }
  if (!res.ok) return { ok: false, reason: "network" };
  let body;
  try { body = await res.json(); } catch { return { ok: false, reason: "network" }; }
  const hit = body && Array.isArray(body.result) ? body.result[0] : null;
  return hit ? shape(hit) : { ok: false, reason: "unknown" };
}

function shape(r) {
  if (!r || !r.postcode) return { ok: false, reason: "unknown" };
  const areas = [r.admin_district, r.parish, r.admin_ward, r.region, r.post_town].filter(Boolean);
  return {
    ok: true, postcode: r.postcode, country: r.country || "", region: r.region || "",
    district: r.admin_district || r.parish || "", lat: r.latitude ?? null, lng: r.longitude ?? null, areas,
  };
}

/** Soft check: does the town the customer typed appear in the postcode's known areas? */
export function townMatches(town, info) {
  const t = String(town ?? "").trim().toLowerCase();
  if (!t || !info || !info.ok) return true;
  return info.areas.some(a => {
    const x = String(a).toLowerCase();
    return x.includes(t) || t.includes(x);
  });
}

export const REASONS = {
  format: "That doesn't look like a UK postcode. Please check it and try again.",
  unknown: "We couldn't find that postcode. Please check it and try again.",
  network: "We couldn't check the postcode right now. Check your connection and try again.",
};
