/* Exact addresses and real phone numbers.
   One place that knows what a good address looks like for each country we ship to, so the checkout, the account page and the
   tests all agree. Pure functions (no DOM) except addressFormHtml/readAddressForm. */
import { normalisePostcode } from "./uk.js?v=16";

const US = "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(" ");
const CA = "AB BC MB NB NL NS NT NU ON PE QC SK YT".split(" ");
const AU = "ACT NSW NT QLD SA TAS VIC WA".split(" ");
const d = n => new RegExp(`^\\d{${n}}$`);

/* [ISO code, name, calling code, postcode pattern (null = none used), postcode example, state list (null = free text / optional), number after street?] */
const RAW = [
  ["GB", "United Kingdom", "44", /^(GIR ?0AA|[A-PR-UWYZ]([0-9]{1,2}|([A-HK-Y][0-9]([0-9ABEHMNPRV-Y])?)|[0-9][A-HJKPS-UW]) ?[0-9][ABD-HJLNP-UW-Z]{2})$/i, "SW1A 1AA"],
  ["IE", "Ireland", "353", /^[AC-FHKNPRTV-Y]\d{2} ?[0-9AC-FHKNPRTV-Y]{4}$/i, "D02 X285"],
  ["FR", "France", "33", d(5), "75001"],
  ["DE", "Germany", "49", d(5), "10115", null, true],
  ["ES", "Spain", "34", d(5), "28013"],
  ["IT", "Italy", "39", d(5), "00184"],
  ["PT", "Portugal", "351", /^\d{4}-\d{3}$/, "1000-001"],
  ["NL", "Netherlands", "31", /^\d{4} ?[A-Z]{2}$/i, "1012 AB", null, true],
  ["BE", "Belgium", "32", d(4), "1000", null, true],
  ["LU", "Luxembourg", "352", d(4), "1009"],
  ["CH", "Switzerland", "41", d(4), "8001", null, true],
  ["AT", "Austria", "43", d(4), "1010", null, true],
  ["DK", "Denmark", "45", d(4), "1050", null, true],
  ["SE", "Sweden", "46", /^\d{3} ?\d{2}$/, "111 21", null, true],
  ["NO", "Norway", "47", d(4), "0150", null, true],
  ["FI", "Finland", "358", d(5), "00100", null, true],
  ["PL", "Poland", "48", /^\d{2}-\d{3}$/, "00-001", null, true],
  ["CZ", "Czechia", "420", /^\d{3} ?\d{2}$/, "110 00", null, true],
  ["GR", "Greece", "30", /^\d{3} ?\d{2}$/, "105 57", null, true],
  ["RO", "Romania", "40", d(6), "010011", null, true],
  ["HU", "Hungary", "36", d(4), "1051", null, true],
  ["US", "United States", "1", /^\d{5}(-\d{4})?$/, "10001", US],
  ["CA", "Canada", "1", /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z] ?\d[ABCEGHJ-NPRSTV-Z]\d$/i, "M5V 2T6", CA],
  ["AU", "Australia", "61", d(4), "2000", AU],
  ["NZ", "New Zealand", "64", d(4), "6011"],
  ["AE", "United Arab Emirates", "971", null, ""],
  ["SA", "Saudi Arabia", "966", d(5), "11564"],
  ["TR", "Türkiye", "90", d(5), "34000"],
  ["DZ", "Algeria", "213", d(5), "16000"],
  ["MA", "Morocco", "212", d(5), "20000"],
  ["TN", "Tunisia", "216", d(4), "1000"],
  ["EG", "Egypt", "20", d(5), "11511"],
  ["IN", "India", "91", d(6), "110001"],
  ["PK", "Pakistan", "92", d(5), "44000"],
  ["JP", "Japan", "81", /^\d{3}-?\d{4}$/, "100-0001"],
];
export const COUNTRIES = RAW.map(([code, name, dial, re, example, states, numberLast]) => ({ code, name, dial, re, example, states: states || null, numberLast: !!numberLast }));
export const countryOf = code => COUNTRIES.find(c => c.code === String(code || "").toUpperCase()) || null;
export const countryName = code => (countryOf(code) || {}).name || String(code || "");

/** Real postcode shape for the country, tidied ("sw1a1aa" → "SW1A 1AA"); "" when it isn't one. Countries without postcodes return "-". */
export function tidyPostcode(country, raw) {
  const c = countryOf(country), s = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!c) return "";
  if (!c.re) return s || "-";
  if (c.code === "GB") return normalisePostcode(s);
  if (!c.re.test(s)) return "";
  const up = s.toUpperCase();
  if (c.code === "CA" || c.code === "IE") return up.replace(/\s/g, "").replace(/^(.{3})(.+)$/, "$1 $2");
  if (c.code === "NL") return up.replace(/^(\d{4}) ?([A-Z]{2})$/, "$1 $2");
  if (c.code === "SE" || c.code === "CZ" || c.code === "GR") return up.replace(/^(\d{3}) ?(\d{2})$/, "$1 $2");
  if (c.code === "JP") return up.replace(/^(\d{3})-?(\d{4})$/, "$1-$2");
  return up;
}

const clean = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
export const ERR = {
  country: "Please choose a country we ship to.",
  postcode: c => `That doesn't look like a ${c.name} postcode${c.example ? `, like ${c.example}` : ""}.`,
  number: "Please add your house number or name.",
  street: "Please add your street name.",
  city: "Please add your town or city.",
  state: "Please choose your state, province or region.",
};

/** raw: { country, postcode, number, street, line2, city, state } → { ok, errors:{field:message}, value:{country,line1,line2,city,state,postcode} } */
export function validateAddress(raw, { allowed } = {}) {
  const errors = {}, c = countryOf(raw && raw.country);
  if (!c || (allowed && allowed.length && !allowed.includes(c.code))) errors.country = ERR.country;
  const number = clean(raw && raw.number, 20), street = clean(raw && raw.street, 90), line2 = clean(raw && raw.line2, 80), city = clean(raw && raw.city, 60);
  let state = clean(raw && raw.state, 40);
  if (!number || !/[\p{L}\p{N}]/u.test(number)) errors.number = ERR.number;
  if (street.length < 2 || !/\p{L}/u.test(street)) errors.street = ERR.street;
  if (city.length < 2 || !/\p{L}/u.test(city)) errors.city = ERR.city;
  let postcode = "";
  if (c) {
    postcode = tidyPostcode(c.code, raw && raw.postcode);
    if (!postcode) errors.postcode = ERR.postcode(c);
    if (c.states) { state = state.toUpperCase(); if (!c.states.includes(state)) errors.state = ERR.state; }
  }
  const line1 = c && c.numberLast ? `${street} ${number}` : `${number} ${street}`;
  return { ok: !Object.keys(errors).length, errors, value: { country: c ? c.code : "", line1, line2, city, state, postcode } };
}

/** Lines to print under each other, e.g. ["12 High Street", "Flat 2", "Leicester", "LE1 1AA", "United Kingdom"]. */
export function formatAddress(a) {
  if (!a) return [];
  return [a.line1, a.line2, a.city, a.state, a.postcode && a.postcode !== "-" ? a.postcode : "", a.country ? countryName(a.country) : ""].filter(Boolean);
}

/** Splits a saved line1 back into the two boxes (number + street) for editing. */
export function splitLine1(line1, country) {
  const s = String(line1 || "").trim(), c = countryOf(country);
  const m = c && c.numberLast ? /^(.+?)\s+(\d+[A-Za-z]?(?:\s?[-–/]\s?\d+[A-Za-z]?)?)$/.exec(s) : /^(\d+[A-Za-z]?(?:\s?[-–/]\s?\d+[A-Za-z]?)?)\s+(.+)$/.exec(s);
  if (!m) return { number: "", street: s };
  return c && c.numberLast ? { number: m[2], street: m[1] } : { number: m[1], street: m[2] };
}

/* ── phone numbers (libphonenumber, bundled in vendor/phone.js and loaded only when needed) ── */
let lib;
const phoneLib = () => (lib ||= import("./vendor/phone.js?v=1"));

/** → { ok, e164, display, country } or { ok:false }. `country` is the default when the number has no +code. A number must really exist in that country's numbering plan, so 199929292931 is rejected. */
export async function validatePhone(raw, country = "GB") {
  const s = String(raw ?? "").trim();
  if (!s) return { ok: false, reason: "empty" };
  const { parsePhoneNumberFromString } = await phoneLib();
  let p;
  try { p = parsePhoneNumberFromString(s.startsWith("00") ? "+" + s.slice(2) : s, s.startsWith("+") || s.startsWith("00") ? undefined : String(country || "GB").toUpperCase()); } catch { p = null; }
  if (!p || !p.isValid()) return { ok: false, reason: "invalid" };
  return { ok: true, e164: p.number, display: p.formatInternational(), country: p.country || "" };
}
export const PHONE_HELP = c => `Please enter a real phone number for ${countryName(c) || "that country"}, like ${PHONE_EXAMPLE[c] || "+44 7123 456789"}.`;
const PHONE_EXAMPLE = { GB: "07123 456789", FR: "06 12 34 56 78", IE: "085 123 4567", DE: "0151 23456789", ES: "612 34 56 78", IT: "312 345 6789", NL: "06 12345678", BE: "0470 12 34 56", US: "(201) 555-0123", CA: "(204) 234-5678", AU: "0412 345 678", DZ: "0550 12 34 56" };

/* ── the form ── */
const esc = s => String(s ?? "").replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

/** The exact-address form fields. a = a saved address (or {}), allowed = country codes the shop ships to. */
export function addressFormHtml(a = {}, allowed) {
  const list = COUNTRIES.filter(c => !allowed || !allowed.length || allowed.includes(c.code));
  const cc = a.country && list.some(c => c.code === a.country) ? a.country : (list[0] || COUNTRIES[0]).code, c = countryOf(cc);
  const { number, street } = splitLine1(a.line1, cc);
  const stateField = c.states
    ? `<label class="inp"><span>State / province*</span><select name="state" autocomplete="address-level1"><option value="">Choose…</option>${c.states.map(s => `<option ${a.state === s ? "selected" : ""}>${s}</option>`).join("")}</select></label>`
    : `<label class="inp"><span>County / region <em>(optional)</em></span><input name="state" autocomplete="address-level1" maxlength="40" value="${esc(a.state || "")}"></label>`;
  return `
    <label class="inp"><span>Country*</span><select name="country" autocomplete="country">${list.map(x => `<option value="${x.code}" ${x.code === cc ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>
    <label class="inp"><span>Postcode / ZIP*</span><input name="postcode" autocomplete="postal-code" autocapitalize="characters" maxlength="10" placeholder="${esc(c.example || "")}" value="${esc(a.postcode && a.postcode !== "-" ? a.postcode : "")}"></label>
    <p class="pc-status" data-pcstatus role="status" aria-live="polite"></p>
    <div class="inp-row">
      <label class="inp num"><span>No.*</span><input name="number" autocomplete="off" maxlength="20" placeholder="12" value="${esc(number)}" aria-label="House number or name"></label>
      <label class="inp"><span>Street*</span><input name="street" autocomplete="address-line1" maxlength="90" placeholder="High Street" value="${esc(street)}"></label>
    </div>
    <label class="inp"><span>Flat, building, floor <em>(optional)</em></span><input name="line2" autocomplete="address-line2" maxlength="80" value="${esc(a.line2 || "")}"></label>
    <label class="inp"><span>Town / city*</span><input name="city" autocomplete="address-level2" maxlength="60" value="${esc(a.city || "")}"></label>
    ${stateField}`;
}

export const readAddressForm = f => ({
  country: f.elements.country.value, postcode: f.elements.postcode.value, number: f.elements.number.value,
  street: f.elements.street.value, line2: f.elements.line2.value, city: f.elements.city.value, state: f.elements.state ? f.elements.state.value : "",
});
