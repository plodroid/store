/* Customer accounts: log in with email + password (or Google), the account page and the UK location picker. */

import { $, $$, esc, openDialog, closeDialog, showError, setBusy, toast } from "./ui.js?v=16";
import { flag } from "./flags.js?v=17";
import { streetFor, geocodeAddress, makeMap } from "./geo.js?v=20";
import { normalisePostcode, normaliseUkPhone, showUkPhone, lookupPostcode, nearestPostcode, townMatches, REASONS } from "./uk.js?v=16";

const GOOGLE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.7v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.5 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.4 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.4a12 12 0 0 0 0 10.8z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8z"/></svg>`;

const MAIL_URL = () => String(window.STORE_AUTH_URL || "");
const mailerReady = () => /^https:\/\/script\.google\.com\//.test(MAIL_URL());

const MESSAGES = {
  "auth/invalid-phone-number": "That phone number doesn't look right. Include the country code, like +44 7700 900123.",
  "auth/missing-phone-number": "Enter your phone number first.",
  "auth/invalid-verification-code": "That code isn't right. Check the text message and try again.",
  "auth/code-expired": "That code has expired. Go back and request a new one.",
  "auth/quota-exceeded": "We've sent too many texts today. Please log in with email or Google instead.",
  "auth/too-many-requests": "Too many attempts. Please wait a bit, or log in with email or Google.",
  "auth/captcha-check-failed": "Couldn't verify you're human. Please reload the page and try again.",
  "auth/invalid-credential": "That email and password don't match. Try again, or tap \"Forgot password?\".",
  "auth/wrong-password": "That email and password don't match. Try again, or tap \"Forgot password?\".",
  "auth/user-not-found": "That email and password don't match. Try again, or tap \"Forgot password?\".",
  "auth/email-already-in-use": "There's already an account with that email. Log in instead, or use Google if you signed up with it.",
  "auth/weak-password": "Please choose a password with at least 6 characters.",
  "auth/invalid-email": "Please enter a valid email address.",
  "auth/operation-not-allowed": "Email and password sign-in isn't switched on yet. The shop owner needs to enable it.",
  "auth/network-request-failed": "We couldn't reach the server. Check your connection and try again.",
  "auth/too-many-requests": "Too many attempts. Please wait a few minutes and try again.",
  "auth/popup-blocked": "Your browser blocked the sign-in window. Allow pop-ups for this site and try again.",
  "auth/operation-not-allowed": "This way of signing in isn't switched on yet. The shop owner needs to enable it.",
  "auth/unauthorized-domain": "This website address isn't approved for sign-in yet. The shop owner needs to add it in Firebase.",
  "auth/user-disabled": "This account has been disabled.",
  "store/not-configured": "Email codes aren't set up yet. You can still continue with Google.",
  "store/bad-reply": "Something went wrong on our side. Please try again in a moment.",
};
const CODE_ERRORS = {
  bad_email: () => "Please enter a valid email address.",
  wait: d => `Please wait ${d.wait || 30} seconds before asking for another code.`,
  limit: () => "Too many codes requested for this email. Please try again in an hour.",
  busy: () => "We can't send more codes today. Please continue with Google or try again tomorrow.",
  use_google: () => document.documentElement.dataset.native && !document.documentElement.dataset.gnative
    ? "This account signs in with Google, which needs the newest Bee Hive app. Update the app, or sign in on the website."
    : "This account signs in with Google. Tap \"Continue with Google\" instead.",
  send_failed: () => "We couldn't send the email just now. Please try again in a minute.",
  bad_code: d => d.left ? `That code isn't right. ${d.left} ${d.left === 1 ? "try" : "tries"} left.` : "That code isn't right.",
  expired: () => "That code has expired or was used up. Tap \"Resend code\" to get a new one.",
  locked: () => "Too many wrong codes. Please try again in an hour.",
};
const PHONE = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/></svg>`;
/* Calling codes for the phone login: [ISO country, name, dial code]. */
const COUNTRIES = [["GB","United Kingdom","44"],["FR","France","33"],["DZ","Algeria","213"],["US","United States","1"],["CA","Canada","1"],["IE","Ireland","353"],["DE","Germany","49"],["ES","Spain","34"],["IT","Italy","39"],["NL","Netherlands","31"],["BE","Belgium","32"],["CH","Switzerland","41"],["PT","Portugal","351"],["PL","Poland","48"],["RO","Romania","40"],["TR","Turkey","90"],["MA","Morocco","212"],["TN","Tunisia","216"],["EG","Egypt","20"],["SA","Saudi Arabia","966"],["AE","United Arab Emirates","971"],["IN","India","91"],["PK","Pakistan","92"],["BD","Bangladesh","880"],["RU","Russia","7"],["CN","China","86"],["JP","Japan","81"],["KR","South Korea","82"],["ID","Indonesia","62"],["AU","Australia","61"]];
const TZ = { "Europe/London": "GB", "Europe/Paris": "FR", "Africa/Algiers": "DZ", "Europe/Dublin": "IE", "Europe/Berlin": "DE", "Europe/Madrid": "ES", "Europe/Rome": "IT", "Europe/Amsterdam": "NL", "Europe/Brussels": "BE", "Europe/Zurich": "CH", "Europe/Lisbon": "PT", "Europe/Warsaw": "PL", "Europe/Bucharest": "RO", "Europe/Istanbul": "TR", "Africa/Casablanca": "MA", "Africa/Tunis": "TN", "Africa/Cairo": "EG", "Asia/Riyadh": "SA", "Asia/Dubai": "AE", "Asia/Kolkata": "IN", "Asia/Karachi": "PK", "Asia/Dhaka": "BD", "Europe/Moscow": "RU", "Asia/Shanghai": "CN", "Asia/Tokyo": "JP", "Asia/Seoul": "KR", "Asia/Jakarta": "ID", "America/New_York": "US", "America/Chicago": "US", "America/Denver": "US", "America/Los_Angeles": "US", "America/Toronto": "CA", "Australia/Sydney": "AU" };
const known = c => COUNTRIES.some(x => x[0] === c);
/** Best guess at the customer's country from their browser language, then their time zone, else the UK. No permission needed. */
function guessCountry() {
  try { for (const l of navigator.languages || [navigator.language]) { const r = (l.split("-")[1] || "").toUpperCase(); if (known(r)) return r; } } catch {}
  try { const c = TZ[Intl.DateTimeFormat().resolvedOptions().timeZone]; if (c) return c; } catch {}
  return "GB";
}
const dialOf = c => (COUNTRIES.find(x => x[0] === c) || COUNTRIES[0])[2];
const SILENT = new Set(["auth/popup-closed-by-user", "auth/cancelled-popup-request"]);

/** Inside the Android app Google blocks its sign-in page, so newer app builds carry a native Google sign-in plugin instead.
    Returns it when this build has it (older builds don't, and keep the button hidden). */
function nativeGoogle() {
  try {
    const c = window.Capacitor; if (!c || !c.isNativePlatform || !c.isNativePlatform()) return null;
    if (c.isPluginAvailable && !c.isPluginAvailable("FirebaseAuthentication")) return null;
    return (typeof c.registerPlugin === "function" ? c.registerPlugin("FirebaseAuthentication") : c.Plugins && c.Plugins.FirebaseAuthentication) || null;
  } catch { return null; }
}
if (nativeGoogle()) document.documentElement.dataset.gnative = "1";
const CANCELLED = /popup-closed|cancelled|canceled|12501|-5\b|user.?cancel/i;
const errText = e => MESSAGES[e && e.code] || (/DEVELOPER_ERROR|\b10\b|12500/.test(`${e && e.code} ${e && e.message}`) && nativeGoogle() && "Google doesn't recognise this app build yet. Please sign in with email and password instead, and tell the shop.") || (e && e.code === "google/no-token" && "Google didn't send back a sign-in. Please try again.") || `Something went wrong. Please try again in a moment.${e && e.code ? " (" + e.code + ")" : ""}`;

/** One call to the mailer script. Resolves to its JSON reply; throws {code} only when it can't be reached. */
async function mailer(body) {
  if (!mailerReady()) throw Object.assign(new Error("not configured"), { code: "store/not-configured" });
  let res;
  try {
    // text/plain keeps this a "simple" request, so the browser doesn't need a CORS preflight
    res = await fetch(MAIL_URL(), { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body) });
  } catch { throw Object.assign(new Error("network"), { code: "auth/network-request-failed" }); }
  let data = null;
  try { data = await res.json(); } catch {}
  if (!data || typeof data !== "object") throw Object.assign(new Error("bad reply"), { code: "store/bad-reply" });
  return data;
}

export function createAuth({ FS, onChange = () => {} }) {
  const { db, fs, auth, au } = FS;
  const st = { user: null, email: "", verified: false, profile: {}, owner: false, ready: false };
  let pending = null;            // { resolve } while requireLogin() is waiting
  let markReady; const readyP = new Promise(r => (markReady = r));   // first auth answer from Firebase
  let view = "in", reason = "", pendingEmail = "", pendingPhone = "", pendingPhoneLocal = "", confirmation = null, country = guessCountry(), ccOpen = false;

  const dlg = $("#au"), acct = $("#acct"), loc = $("#loc");

  /* ── who is this, are they verified, are they the owner ── */
  async function loadProfile(user) {
    st.profile = {}; st.owner = false; st.email = ""; st.phone = ""; st.verified = false;
    if (!user) return;
    try {
      const tok = await user.getIdTokenResult();
      st.email = user.email || tok.claims.mail || ""; st.phone = user.phoneNumber || "";
      st.verified = !!user;   // password and Google accounts can order; payment itself goes through Stripe
    } catch (e) { console.warn("[auth] token", e && e.code); }
    if (!st.verified) return;
    try {
      const snap = await fs.getDoc(fs.doc(db, "users", user.uid));
      st.profile = snap.exists() ? snap.data() : {};
    } catch (e) { console.warn("[auth] profile", e && e.code); }
    // The owner is whoever the security rules say can read settings/owner; the rules decide, not this file.
    try { await fs.getDoc(fs.doc(db, "settings", "owner")); st.owner = true; }
    catch (e) { st.owner = false; if (!e || e.code !== "permission-denied") console.warn("[auth] owner check", e && e.code); }
    if (!Object.keys(st.profile).length && user.displayName) saveProfile({ name: user.displayName }).catch(() => {});
  }

  async function saveProfile(patch) {
    if (!st.user) throw new Error("not signed in");
    await fs.setDoc(fs.doc(db, "users", st.user.uid), { ...patch, updatedAt: fs.serverTimestamp() }, { merge: true });
    st.profile = { ...st.profile, ...patch };
    paintNav();
  }

  au.onAuthStateChanged(auth, async user => {
    st.user = user;
    await loadProfile(user);
    st.ready = true;
    markReady();
    paintNav();
    onChange(api);
  });

  /* ── nav ──────────────────────────────────────────── */
  function paintNav() {
    const signed = !!st.user && st.verified;
    $("#signInBtn").hidden = signed;
    $("#acctBtn").hidden = !signed;
    $("#manageBtn").hidden = !st.owner;
    $("#dockAcctLabel").textContent = signed ? "Account" : "Sign in";
    if (!signed) closeMenu();
  }
  const menu = $("#menu");
  const dockAcct = $("#dockAcct");
  const phone = () => !matchMedia("(min-width: 900px)").matches;
  const tell = () => document.dispatchEvent(new Event("dockchange"));
  function closeMenu() {
    menu.hidden = true;
    $("#acctBtn").setAttribute("aria-expanded", "false");
    dockAcct.setAttribute("aria-expanded", "false");
    tell();
  }
  /** Desktop: a popover right under the avatar. Phones: a glass sheet above the tab bar (see .menu in the CSS). */
  function placeMenu() {
    menu.classList.toggle("pop", !phone());
    if (phone()) { menu.style.top = menu.style.left = menu.style.right = ""; return; }
    const r = $("#acctBtn").getBoundingClientRect(), w = menu.offsetWidth;
    menu.style.top = `${Math.round(r.bottom + 8)}px`;
    menu.style.left = `${Math.round(Math.max(12, Math.min(innerWidth - w - 12, r.right - w)))}px`;
    menu.style.right = "auto";
  }
  function toggleMenu() {
    const open = menu.hidden;
    menu.hidden = !open;
    $("#acctBtn").setAttribute("aria-expanded", String(open));
    dockAcct.setAttribute("aria-expanded", String(open));
    $("#menuEmail").textContent = st.email || st.phone;
    if (open) { placeMenu(); $("#menuAcct").focus({ preventScroll: true }); }
    tell();
  }
  $("#signInBtn").addEventListener("click", () => openAuth());
  $("#acctBtn").addEventListener("click", toggleMenu);
  // on phones the tab bar's last button is the account: signed out it opens sign-in, signed in it opens the menu
  dockAcct.addEventListener("click", () => (st.user && st.verified ? toggleMenu() : openAuth()));
  addEventListener("resize", () => { if (!menu.hidden) placeMenu(); });
  $("#menuAcct").addEventListener("click", () => { closeMenu(); openAccount(); });
  $("#menuOut").addEventListener("click", async () => { closeMenu(); await signOut(); });
  addEventListener("click", e => { if (!menu.hidden && !e.target.closest("#menu, #acctBtn, #dockAcct")) closeMenu(); });
  addEventListener("keydown", e => { if (e.key === "Escape" && !menu.hidden) { closeMenu(); (phone() ? dockAcct : $("#acctBtn")).focus(); } });

  async function signOut() {
    try { await nativeGoogle()?.signOut(); } catch {}
    await au.signOut(auth);
    toast("Signed out");
  }

  /* ── sign-in dialog ───────────────────────────────── */
  const social = () => `
    <div class="or"><span>or</span></div>
    <div class="social"><button class="soc" type="button" data-google>${GOOGLE}<span>Continue with Google</span></button>
    <button class="soc" type="button" data-go="phone">${PHONE}<span>Continue with phone</span></button></div>`;

  const ccFlag = c => flag(c.toLowerCase());
  const ccFace = () => `${ccFlag(country)}<span translate="no">+${dialOf(country)}</span><svg class="lang-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`;
  function pickCountry(c) {
    country = c; const f = $("#auView form"); if (!f) return;
    f.querySelector(".cc-btn").innerHTML = ccFace();
    f.querySelectorAll("[data-cc]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.cc === c)));
    toggleCc(false);
  }
  function toggleCc(on) {
    const f = $("#auView form"), m = f && f.querySelector(".cc-menu"); if (!m) return;
    ccOpen = on; m.hidden = !on; f.querySelector(".cc-btn").setAttribute("aria-expanded", String(on));
    if (on) m.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "center" });
  }
  /** Asks the browser for the position (only when the customer taps the button), then turns it into a country. */
  async function locateCountry(btn, err) {
    if (!navigator.geolocation) return showError(err, "Your browser can't share its location. Pick your country from the list.");
    setBusy(dlg, btn, true);
    try {
      const pos = await new Promise((ok, no) => navigator.geolocation.getCurrentPosition(ok, no, { timeout: 10000, maximumAge: 600000 }));
      const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${pos.coords.latitude}&longitude=${pos.coords.longitude}&localityLanguage=en`).then(x => x.json());
      const c = String(r.countryCode || "").toUpperCase();
      if (known(c)) pickCountry(c); else showError(err, "We can't text that country yet. Please log in with email or Google.");
    } catch (e) { showError(err, e && e.code === 1 ? "Location is blocked for this site. Pick your country from the list." : "Couldn't work out your location. Pick your country from the list."); }
    finally { setBusy(dlg, btn, false); }
  }

  const VIEWS = {
    phone: () => `
      <form class="auth-form" data-form="phone" novalidate>
        <h2 id="auTitle">Log in with phone</h2>
        <p class="auth-sub">Choose your country and enter your number. We'll text you a one-time code.</p>
        <div class="inp"><span>Phone number</span>
          <div class="phone-row">
            <div class="cc">
              <button class="cc-btn" type="button" data-cc-toggle aria-haspopup="listbox" aria-expanded="false" aria-label="Country calling code">${ccFace()}</button>
              <div class="lang-menu glass-strong cc-menu" role="listbox" translate="no" hidden>${COUNTRIES.map(c => `<button type="button" role="option" data-cc="${c[0]}" aria-selected="${c[0] === country}">${ccFlag(c[0])}<span class="lang-name">${esc(c[1])}</span><b>+${c[2]}</b></button>`).join("")}</div>
            </div>
            <input name="phone" type="tel" autocomplete="tel-national" inputmode="tel" placeholder="7700 900123" required maxlength="18" value="${esc(pendingPhoneLocal)}">
          </div>
        </div>
        <button class="btn-quiet" type="button" data-locate>Use my location to pick the country</button>
        <p class="form-error" role="alert" hidden></p>
        <button class="btn-grad" type="submit">Text me a code</button>
        <p class="auth-switch"><button class="link" type="button" data-go="in">Use email instead</button></p>
      </form>`,
    code: () => `
      <form class="auth-form" data-form="code" novalidate>
        <h2 id="auTitle">Enter your code</h2>
        <p class="auth-sub">We texted a 6-digit code to ${esc(pendingPhone)}. Enter it below to continue. It can take a minute to arrive.</p>
        <label class="inp"><span>6-digit code</span><input name="code" type="text" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]*" placeholder="123456" required maxlength="6"></label>
        <p class="form-error" role="alert" hidden></p>
        <button class="btn-grad" type="submit">Log in</button>
        <p class="auth-switch"><button class="link" type="button" data-go="phone">Wrong number?</button></p>
      </form>`,
    in: () => passView("in"),
    up: () => passView("up"),
    reset: () => `
      <form class="auth-form" data-form="reset" novalidate>
        <h2 id="auTitle">Reset password</h2>
        <p class="auth-sub">Enter your email and we'll send you a link to choose a new password.</p>
        <label class="inp"><span>Email address</span><input name="email" type="email" autocomplete="email" inputmode="email" placeholder="you@example.com" required maxlength="120" value="${esc(pendingEmail)}"></label>
        <p class="form-error" role="alert" hidden></p>
        <button class="btn-grad" type="submit">Send reset link</button>
        <p class="auth-switch"><button class="link" type="button" data-go="in">Back to log in</button></p>
      </form>`,
  };
  function passView(mode) {
    const up = mode === "up";
    return `
      <form class="auth-form" data-form="${mode}" novalidate>
        <h2 id="auTitle">${up ? "Create account" : "Log in"}</h2>
        <p class="auth-sub">${esc(reason || (up ? "Pick a password and you're in. No codes to wait for." : "Welcome back. Enter your email and password."))}</p>
        <label class="inp"><span>Email address</span><input name="email" type="email" autocomplete="email" inputmode="email" placeholder="you@example.com" required maxlength="120" value="${esc(pendingEmail)}"></label>
        <label class="inp"><span>Password</span><input name="password" type="password" autocomplete="${up ? "new-password" : "current-password"}" placeholder="${up ? "At least 6 characters" : "Your password"}" required minlength="6" maxlength="128"></label>
        <p class="form-error" role="alert" hidden></p>
        <button class="btn-grad" type="submit">${up ? "Create account" : "Log in"}</button>
        ${up ? "" : `<button class="btn-quiet" type="button" data-go="reset">Forgot password?</button>`}
        ${social()}
        <p class="auth-switch">${up ? `Already have an account? <button class="link" type="button" data-go="in">Log in</button>` : `New here? <button class="link" type="button" data-go="up">Create an account</button>`}</p>
      </form>`;
  }

  function go(next) {
    view = next; ccOpen = false;
    $("#auView").innerHTML = VIEWS[next]();
    $("#auView input")?.focus({ preventScroll: true });
  }

  function openAuth(why = "") {
    reason = why;
    pendingEmail = "";
    go("in");
    openDialog(dlg);
  }

  dlg.addEventListener("click", e => {
    const goBtn = e.target.closest("[data-go]");
    if (goBtn) return go(goBtn.dataset.go);
    if (e.target.closest("[data-cc-toggle]")) return toggleCc(!ccOpen);
    const cc = e.target.closest("[data-cc]"); if (cc) return pickCountry(cc.dataset.cc);
    if (e.target.closest("[data-locate]")) return locateCountry(e.target.closest("button"), $("#auView .form-error"));
    if (ccOpen && !e.target.closest(".cc")) toggleCc(false);
    if (e.target.closest("[data-google]")) return withBusy(e.target.closest("button"), googleSignIn);
  });

  dlg.addEventListener("submit", async e => {
    e.preventDefault();
    const form = e.target.closest("form");
    const kind = form?.dataset.form;
    const btn = form.querySelector(".btn-grad");
    const err = form.querySelector(".form-error");
    showError(err, ""); err.classList.remove("ok");
    if (kind === "phone" || kind === "code") return phoneStep(kind, form, btn, err);
    const email = form.elements.email.value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) {
      form.elements.email.setAttribute("aria-invalid", "true");
      return showError(err, "Please enter a valid email address.");
    }
    pendingEmail = email;
    const password = form.elements.password?.value || "";
    if (kind !== "reset" && password.length < 6) return showError(err, "Your password needs at least 6 characters.");
    setBusy(dlg, btn, true);
    try {
      if (kind === "reset") {
        await au.sendPasswordResetEmail(auth, email);
        showError(err, "If that email has an account, a reset link is on its way. Check your spam folder too."); err.classList.add("ok"); return;
      }
      await persistence();
      const { user } = kind === "up" ? await au.createUserWithEmailAndPassword(auth, email, password) : await au.signInWithEmailAndPassword(auth, email, password);
      await afterSignIn(user);
    } catch (e2) { console.warn("[auth]", e2 && (e2.code || e2.message)); showError(err, errText(e2)); }
    finally { setBusy(dlg, btn, false); }
  });

  /* Phone login: ONE text per attempt (the free Firebase plan allows only ~10 a day), so there is no resend button. */
  /** Country + what they typed → +E.164. A number typed with its own +code or 00 wins; a leading 0 (UK-style) is dropped. */
  const e164 = raw => {
    let n = raw.replace(/[\s().-]/g, "");
    if (n.startsWith("00")) n = "+" + n.slice(2);
    if (!n.startsWith("+")) { n = n.replace(/\D/g, ""); if (country !== "IT") n = n.replace(/^0+/, ""); n = "+" + dialOf(country) + n; }
    return /^\+[1-9]\d{7,14}$/.test(n) ? n : "";
  };
  let verifier = null;
  async function phoneStep(kind, form, btn, err) {
    setBusy(dlg, btn, true);
    try {
      await persistence();
      if (kind === "phone") {
        const n = e164(form.elements.phone.value.trim());
        if (!n) return showError(err, MESSAGES["auth/invalid-phone-number"]);
        pendingPhone = n; pendingPhoneLocal = form.elements.phone.value.trim();
        try { verifier?.clear(); } catch {}
        document.getElementById("rcv")?.remove();
        const box = Object.assign(document.createElement("div"), { id: "rcv" }); form.append(box);
        verifier = new au.RecaptchaVerifier(auth, box, { size: "invisible" });
        confirmation = await au.signInWithPhoneNumber(auth, n, verifier);
        go("code");
      } else {
        const c = form.elements.code.value.replace(/\D/g, "");
        if (c.length !== 6) return showError(err, MESSAGES["auth/invalid-verification-code"]);
        const { user } = await confirmation.confirm(c);
        await afterSignIn(user);
      }
    } catch (e) { console.warn("[auth]", e && (e.code || e.message)); try { verifier?.clear(); } catch {} verifier = null; showError(err, errText(e)); }
    finally { setBusy(dlg, btn, false); }
  }

  async function persistence() {
    try { await au.setPersistence(auth, au.browserLocalPersistence); } catch {}
  }

  async function withBusy(btn, fn) {
    const err = $("#auView .form-error");
    showError(err, "");
    setBusy(dlg, btn, true);
    try { await fn(); }
    catch (e) { console.warn("[auth]", e && e.code, e && e.message); if (!SILENT.has(e && e.code) && !CANCELLED.test(`${e && e.code} ${e && e.message}`)) showError(err, errText(e)); }
    finally { setBusy(dlg, btn, false); }
  }

  async function googleSignIn() {
    await persistence();
    const g = nativeGoogle();
    if (g) {   // the Android app: ask the phone's own Google account picker, then hand the token to Firebase
      const r = await g.signInWithGoogle(), idToken = r && r.credential && r.credential.idToken;
      if (!idToken) throw Object.assign(new Error("no token"), { code: "google/no-token" });
      const { user } = await au.signInWithCredential(auth, au.GoogleAuthProvider.credential(idToken));
      return afterSignIn(user);
    }
    const provider = new au.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    const { user } = await au.signInWithPopup(auth, provider);
    await afterSignIn(user);
  }

  async function afterSignIn(user) {
    st.user = user;
    await loadProfile(user);
    paintNav();
    onChange(api);
    finish(true);
  }

  function finish(ok) {
    const p = pending; pending = null;
    closeDialog(dlg);
    if (p) p.resolve(ok);
  }

  dlg.addEventListener("close", () => { if (pending) { const p = pending; pending = null; p.resolve(false); } });

  /** Resolves true once the customer is signed in and verified; false if they close the dialog. */
  async function requireLogin(why = "") {
    await readyP;                                   // a saved login may still be loading
    if (st.user && st.verified) return true;
    return new Promise(resolve => {
      pending = { resolve };
      openAuth(why);
    });
  }

  /* ── account page ─────────────────────────────────── */
  const addrText = a => a ? [a.line1, a.line2, a.city, a.postcode].filter(Boolean).map(esc).join("<br>") : "";

  function openAccount() {
    if (!st.user) return openAuth("in");
    const p = st.profile, a = p.address;
    $("#acctBody").innerHTML = `
      <h2 id="acctTitle">Your account</h2>
      <p class="muted modal-sub">These details are filled in for you at checkout.</p>
      <form id="acctForm" novalidate>
        <div class="form-section">
          <h3>Details</h3>
          <label class="inp"><span>Full name</span><input name="name" autocomplete="name" maxlength="80" value="${esc(p.name || st.user.displayName || "")}"></label>
          <label class="inp"><span>Mobile number <em>(UK)</em></span><input name="phone" type="tel" autocomplete="tel" inputmode="tel" maxlength="20" placeholder="07123 456789" value="${esc(showUkPhone(p.phone || ""))}"></label>
          <div class="inp"><span>Email</span>
            <div class="static">${esc(st.email || st.phone)} <span class="badge ok">Verified</span></div>
          </div>
        </div>
        <div class="form-section">
          <h3>Location</h3>
          <div class="addr-card" id="acctAddr">${a ? `<div class="addr-text">${addrText(a)}</div>` : `<div class="addr-empty">No address saved yet.</div>`}</div>
          <button class="btn-ghost tight" type="button" id="acctLoc">${a ? "Change location" : "Set location"}</button>
        </div>
        <p class="form-error" id="acctErr" role="alert" hidden></p>
        <button class="btn-primary wide" id="acctSave" type="submit">Save changes</button>
      </form>
      <button class="btn-quiet danger" type="button" id="acctOut">Sign out</button>`;
    openDialog(acct);
  }
  acct.addEventListener("click", e => {
    if (e.target.closest("#acctLoc")) openLocation(a => {
      $("#acctAddr").innerHTML = `<div class="addr-text">${addrText(a)}</div>`;
      $("#acctLoc").textContent = "Change location";
    });
    if (e.target.closest("#acctOut")) { closeDialog(acct); signOut(); }
  });
  acct.addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target, err = $("#acctErr"), btn = $("#acctSave");
    const name = f.elements.name.value.trim();
    const rawPhone = f.elements.phone.value.trim();
    const phone = rawPhone ? normaliseUkPhone(rawPhone) : "";
    f.elements.phone.removeAttribute("aria-invalid");
    if (rawPhone && !phone) {
      f.elements.phone.setAttribute("aria-invalid", "true");
      return showError(err, "Please enter a UK mobile or landline number, like 07123 456789.");
    }
    showError(err, "");
    setBusy(acct, btn, true);
    try {
      await saveProfile({ name, phone });
      toast("Saved");
      closeDialog(acct);
    } catch (e2) {
      console.warn("[account]", e2 && e2.code);
      showError(err, "We couldn't save that. Please try again.");
    } finally { setBusy(acct, btn, false); }
  });

  /* ── location picker (shared by account + checkout) ── */
  let locDone = null, locCheck = null, locSeq = 0, locTimer, pinMap = null, pinOk = false, pinTimer, pinSeq = 0, pinGuess = null;

  /** "1 Thoresby Street" → { number: "1", street: "Thoresby Street" } (a house name stays in the street box). */
  const split = line => { const m = /^(\d+[A-Za-z]?(?:\s?[-–/]\s?\d+[A-Za-z]?)?)\s+(.+)$/.exec(String(line || "").trim()); return m ? { number: m[1], street: m[2] } : { number: "", street: String(line || "") }; };

  function openLocation(done) {
    locDone = done || null;
    const a = st.profile.address || {};
    $("#locBody").innerHTML = `
      <h2 id="locTitle">Your location</h2>
      <p class="muted modal-sub">United Kingdom only. We check your postcode is real so deliveries go to the right place.</p>
      <form id="locForm" novalidate>
        <button class="btn-ghost tight geo" type="button" id="locGeo">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7.5"/></svg>
          Use my current location</button>
        <label class="inp"><span>Postcode*</span><input name="postcode" autocomplete="postal-code" autocapitalize="characters" placeholder="Postcode" maxlength="9" required value="${esc(a.postcode || "")}"></label>
        <p class="pc-status" id="locStatus" role="status" aria-live="polite"></p>
        <div class="inp-row">
          <label class="inp num"><span>Door no.*</span><input name="number" autocomplete="off" placeholder="1" maxlength="20" required value="${esc(split(a.line1).number)}" aria-label="Door number or house name"></label>
          <label class="inp"><span>Street*</span><input name="line1" autocomplete="address-line1" placeholder="Street" maxlength="100" required value="${esc(split(a.line1).street)}"></label>
        </div>
        <label class="inp"><span>Flat, building or area <em>(optional)</em></span><input name="line2" autocomplete="address-line2" maxlength="120" value="${esc(a.line2 || "")}"></label>
        <label class="inp"><span>Town or city*</span><input name="city" autocomplete="address-level2" maxlength="60" required value="${esc(a.city || "")}"></label>
        <div class="pinwrap" id="locPinWrap" hidden>
          <h3>Pin your exact door</h3>
          <p class="hint">Drag the map so the pin sits on your front door. Streets can be long, and this lets the shop find you exactly.</p>
          <div class="pinbox"><div id="locMap" class="pinmap"></div>
            <svg class="pin-cross" viewBox="0 0 30 38" aria-hidden="true"><path d="M15 37C15 37 2 23.5 2 14a13 13 0 0 1 26 0c0 9.500-13 23-13 23Z" fill="#D93025" stroke="#fff" stroke-width="2"/><circle cx="15" cy="14" r="4.500" fill="#fff"/></svg></div>
          <button class="btn-ghost tight" type="button" id="pinConfirm">The pin is on my door</button>
        </div>
        <label class="inp ro"><span>Country</span><input value="United Kingdom" readonly tabindex="-1"></label>
        <p class="form-error" id="locErr" role="alert" hidden></p>
        <button class="btn-primary wide" id="locSave" type="submit" disabled>Save location</button>
      </form>`;
    locCheck = null; pinMap = null; pinOk = false; pinGuess = null; pinSeq++;
    openDialog(loc);
    if (a.postcode) runCheck();
    else paintLoc();
  }

  function paintLoc() {
    const f = $("#locForm"); if (!f) return;
    const ok = locCheck && locCheck.ok && f.elements.number.value.trim() && f.elements.line1.value.trim() && f.elements.city.value.trim() && (!pinMap || pinOk);
    $("#locSave").disabled = !ok;
    const c = $("#pinConfirm"); if (c) { c.textContent = pinOk ? "Pin confirmed ✓" : "The pin is on my door"; c.classList.toggle("on", pinOk); }
    queuePin();
  }

  function setStatus(kind, html) {
    const el = $("#locStatus");
    el.className = `pc-status ${kind || ""}`;
    el.innerHTML = html || "";
  }

  /** Pin picker: the map sits under a fixed pin, the customer drags it onto their door. Starts from the best guess for the address. */
  function queuePin() { clearTimeout(pinTimer); pinTimer = setTimeout(placePin, 500); }
  async function placePin() {
    const f = $("#locForm"); if (!f || !locCheck || !locCheck.ok || !f.elements.number.value.trim() || !f.elements.line1.value.trim()) return;
    const mine = pinSeq, wrap = $("#locPinWrap");
    const guess = (await geocodeAddress({ line1: `${f.elements.number.value.trim()} ${f.elements.line1.value.trim()}`, city: f.elements.city.value.trim(), postcode: locCheck.postcode })) || { lat: locCheck.lat, lng: locCheck.lng };
    if (mine !== pinSeq || !$("#locForm") || guess.lat == null) return;
    pinGuess = { lat: Math.round(guess.lat * 1e6) / 1e6, lng: Math.round(guess.lng * 1e6) / 1e6 };
    if (!pinMap) {
      wrap.hidden = false;
      try {
        const m = await makeMap($("#locMap"), { satellite: true });
        if (mine !== pinSeq) return m.map.remove();
        pinMap = m.map; pinMap.setView([guess.lat, guess.lng], 19);
        const touch = () => { if (!pinOk) { pinOk = true; paintLoc(); } };
        $("#locMap").addEventListener("pointerdown", touch); $("#locMap").addEventListener("wheel", touch, { passive: true });
        setTimeout(() => pinMap && pinMap.invalidateSize(), 300); paintLoc();
      } catch (e) { console.warn("[pin] map unavailable", e); wrap.hidden = true; pinMap = null; }
    } else if (!pinOk) pinMap.setView([guess.lat, guess.lng], 19);          // keep moving the pin while he types, until he has placed it himself
  }
  loc.addEventListener("click", e => { if (e.target.closest("#pinConfirm")) { pinOk = !pinOk; paintLoc(); } });

  async function runCheck() {
    const f = $("#locForm"); if (!f) return;
    const raw = f.elements.postcode.value;
    const pc = normalisePostcode(raw);
    const mine = ++locSeq;
    locCheck = null; paintLoc();
    if (!raw.trim()) return setStatus("", "");
    if (!pc) return setStatus("bad", REASONS.format);
    setStatus("wait", "Checking postcode…");
    const info = await lookupPostcode(pc);
    if (mine !== locSeq) return;                       // a newer check is already running
    locCheck = info;
    if (!info.ok) setStatus(info.reason === "network" ? "warn" : "bad", REASONS[info.reason]);
    else {
      f.elements.postcode.value = info.postcode;
      const where = [info.district, info.country].filter(Boolean).map(esc).join(", ");
      const soft = !townMatches(f.elements.city.value, info) ? ` <span class="soft">That postcode is in ${esc(info.district || info.region)}. Double-check your town.</span>` : "";
      setStatus("ok", `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5 10 17 19 7"/></svg> ${esc(info.postcode)} is real${where ? ` · ${where}` : ""}.${soft}`);
      fillStreet(f, info, mine);
    }
    paintLoc();
  }

  /** From the postcode, fill in the street and town (like "Thoresby Street, Leicester"); the customer adds the house number. */
  async function fillStreet(f, info, mine) {
    if (info.lat == null) return;
    const s = await streetFor(info.lat, info.lng);
    if (!s || mine !== locSeq) return;
    const line1 = f.elements.line1, city = f.elements.city;
    const mayLine = !line1.value.trim() || line1.dataset.auto === "1", mayCity = !city.value.trim() || city.dataset.auto === "1";
    if (s.street && mayLine) { line1.value = s.street; line1.dataset.auto = "1"; }
    if ((s.town || info.district) && mayCity) { city.value = s.town || info.district; city.dataset.auto = "1"; }
    if (s.street && line1.dataset.auto === "1") {
      if (!f.elements.number.value.trim()) setStatus("ok", `${$("#locStatus").innerHTML} <span class="hl">Now add your door number so the shop knows where to knock.</span>`);
      if (!f.elements.number.value.trim() && (document.activeElement === f.elements.postcode || document.activeElement === document.body)) f.elements.number.focus({ preventScroll: true });
    }
    paintLoc();
  }

  loc.addEventListener("input", e => {
    if (e.target.name === "postcode") {
      clearTimeout(locTimer);
      locCheck = null; paintLoc();
      const f = $("#locForm");
      if (normalisePostcode(f.elements.postcode.value)) locTimer = setTimeout(runCheck, 350);
      else setStatus("", "");
    } else {
      e.target.dataset.auto = "";                        // he typed here himself: never overwrite it
      paintLoc();
      if (e.target.name === "city" && locCheck && locCheck.ok) runCheck();
    }
  });
  loc.addEventListener("focusout", e => { if (e.target.name === "postcode") { clearTimeout(locTimer); runCheck(); } });

  loc.addEventListener("click", async e => {
    if (!e.target.closest("#locGeo")) return;
    const btn = e.target.closest("#locGeo"), err = $("#locErr");
    showError(err, "");
    if (!navigator.geolocation) return showError(err, "Your browser can't share its location. Please type your postcode instead.");
    setBusy(null, btn, true);
    navigator.geolocation.getCurrentPosition(async pos => {
      const hit = await nearestPostcode(pos.coords.latitude, pos.coords.longitude);
      setBusy(null, btn, false);
      if (!hit.ok) return showError(err, hit.reason === "network" ? REASONS.network : "We couldn't match your position to a UK postcode. Please type it in.");
      const f = $("#locForm");
      f.elements.postcode.value = hit.postcode;
      if (!f.elements.city.value.trim() && hit.district) f.elements.city.value = hit.district;
      runCheck();
      (f.elements.number.value.trim() ? f.elements.line1 : f.elements.number).focus({ preventScroll: true });
    }, () => {
      setBusy(null, btn, false);
      showError(err, "We couldn't get your location. You can allow it in your browser, or just type your postcode.");
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
  });

  loc.addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target, err = $("#locErr"), btn = $("#locSave");
    if (!(locCheck && locCheck.ok)) return showError(err, "Please enter a valid UK postcode first.");
    const address = {
      line1: `${f.elements.number.value.trim()} ${f.elements.line1.value.trim()}`.trim(), line2: f.elements.line2.value.trim(), city: f.elements.city.value.trim(),
      postcode: locCheck.postcode, lat: locCheck.lat, lng: locCheck.lng, verified: true,
    };
    if (pinMap && pinOk) { const c = pinMap.getCenter(); address.lat = Math.round(c.lat * 1e6) / 1e6; address.lng = Math.round(c.lng * 1e6) / 1e6; }
    else if (pinGuess) { address.lat = pinGuess.lat; address.lng = pinGuess.lng; }            // no map available: still prefer the house over the middle of the postcode
    if (!f.elements.number.value.trim() || !f.elements.line1.value.trim() || !address.city) return showError(err, "Please fill in the door number, street and town.");
    showError(err, "");
    setBusy(loc, btn, true);
    try {
      await saveProfile({ address });
      closeDialog(loc);
      if (locDone) locDone(address);
    } catch (e2) {
      console.warn("[location]", e2 && e2.code);
      showError(err, "We couldn't save your location. Please try again.");
    } finally { setBusy(loc, btn, false); }
  });

  loc.addEventListener("close", () => { pinSeq++; try { pinMap && pinMap.remove(); } catch {} pinMap = null; clearTimeout(pinTimer); });

  const api = {
    get user() { return st.user; },
    get profile() { return st.profile; },
    get isOwner() { return st.owner; },
    get ready() { return st.ready; },
    get email() { return st.email; },
    get verified() { return st.verified; },
    requireLogin, openAccount, openLocation, openAuth, saveProfile, signOut,
  };
  return api;
}
