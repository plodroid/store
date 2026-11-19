/* Customer accounts: log in with email + password (or Google), the account page and the exact-address form. */

import { $, $$, esc, openDialog, closeDialog, showError, setBusy, toast } from "./ui.js?v=16";
import { preloadGoogle, googleAccessToken } from "./google.js?v=1";
import { lookupPostcode, REASONS } from "./uk.js?v=16";
import { addressFormHtml, readAddressForm, validateAddress, tidyPostcode, countryOf, countryName, formatAddress, validatePhone, PHONE_HELP, ERR } from "./address.js?v=1";

const GOOGLE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.7v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.5 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.4 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.4a12 12 0 0 0 0 10.8z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8z"/></svg>`;

const MESSAGES = {
  "app/no-plugin": "Google sign-in isn't built into this app. Log in with email for now.",
  "auth/invalid-credential": "That email and password don't match. Try again, or tap \"Forgot password?\".",
  "auth/wrong-password": "That email and password don't match. Try again, or tap \"Forgot password?\".",
  "auth/user-not-found": "That email and password don't match. Try again, or tap \"Forgot password?\".",
  "auth/email-already-in-use": "There's already an account with that email. Log in instead, or use Google if you signed up with it.",
  "auth/weak-password": "Please choose a password with at least 6 characters.",
  "auth/invalid-email": "Please enter a valid email address.",
  "auth/operation-not-allowed": "Email and password sign-in isn't switched on yet. The shop owner needs to enable it.",
  "auth/network-request-failed": "We couldn't reach the server. Check your connection and try again.",
  "auth/too-many-requests": "Too many attempts. Please wait a few minutes and try again.",
  "auth/popup-blocked": "Your browser blocked the Google window. Allow pop-ups for this site and try again, or log in with email.",
  "google/script-blocked": "Google sign-in couldn't load (an ad blocker or the network may be blocking it). Log in with email instead, or try again.",
  "auth/unauthorized-domain": "This website address isn't approved for sign-in yet. The shop owner needs to add it in Firebase.",
  "auth/user-disabled": "This account has been disabled.",
};
const SILENT = new Set(["auth/popup-closed-by-user", "auth/cancelled-popup-request"]);

/** Inside the Android app Google blocks its sign-in page, so newer app builds carry a native Google sign-in plugin instead.
    Returns it when this build has it (older builds don't, and keep the button hidden). */
function nativeGoogle() {
  try {
    const c = window.Capacitor; if (!c || !c.isNativePlatform || !c.isNativePlatform()) return null;
    const p = (typeof c.registerPlugin === "function" ? c.registerPlugin("FirebaseAuthentication") : c.Plugins && c.Plugins.FirebaseAuthentication);
    if (p) return p;
    if (typeof c.nativePromise === "function") return { signInWithGoogle: o => c.nativePromise("FirebaseAuthentication", "signInWithGoogle", o || {}), signOut: () => c.nativePromise("FirebaseAuthentication", "signOut", {}) };   // the bridge itself, if the page got no plugin objects
    return null;
  } catch { return null; }
}
if (nativeGoogle()) document.documentElement.dataset.gnative = "1";
const CANCELLED = /popup-closed|cancelled|canceled|12501|-5\b|user.?cancel/i;
const errText = e => MESSAGES[e && e.code] || (/DEVELOPER_ERROR|\b10\b|12500/.test(`${e && e.code} ${e && e.message}`) && nativeGoogle() && "Google doesn't recognise this app build yet. Please sign in with email and password instead, and tell the shop.") || (e && e.code === "google/no-token" && "Google didn't send back a sign-in. Please try again.") || (nativeGoogle() && e && (e.code || e.message) ? `Google sign-in failed (${e.code || ""} ${String(e.message || "").slice(0, 120)}). Please try again or use email.` : "Something went wrong. Please try again in a moment.");

export function createAuth({ FS, onChange = () => {} }) {
  const { db, fs, auth, au } = FS;
  const st = { user: null, email: "", verified: false, profile: {}, owner: false, ready: false };
  let pending = null;            // { resolve } while requireLogin() is waiting
  let markReady; const readyP = new Promise(r => (markReady = r));   // first auth answer from Firebase
  let view = "in", reason = "", pendingEmail = "";

  const dlg = $("#au"), acct = $("#acct"), loc = $("#loc");

  /* ── who is this, are they verified, are they the owner ── */
  async function loadProfile(user) {
    st.profile = {}; st.owner = false; st.email = ""; st.verified = false;
    if (!user) return;
    try {
      const tok = await user.getIdTokenResult();
      st.email = user.email || tok.claims.mail || "";
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
    $("#menuEmail").textContent = st.email;
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
    <div class="social"><button class="soc" type="button" data-google>${GOOGLE}<span>Continue with Google</span></button></div>`;

  const VIEWS = {
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
    view = next;
    $("#auView").innerHTML = VIEWS[next]();
    $("#auView input")?.focus({ preventScroll: true });
  }

  function openAuth(why = "") {
    reason = why;
    pendingEmail = "";
    go("in");
    openDialog(dlg);
    if (!nativeGoogle()) preloadGoogle().catch(() => {});      // so the Google window can open the instant the button is tapped
  }

  dlg.addEventListener("click", e => {
    const goBtn = e.target.closest("[data-go]");
    if (goBtn) return go(goBtn.dataset.go);
    if (e.target.closest("[data-google]")) return withBusy(e.target.closest("button"), googleSignIn);
  });

  dlg.addEventListener("submit", async e => {
    e.preventDefault();
    const form = e.target.closest("form");
    const kind = form?.dataset.form;
    const btn = form.querySelector(".btn-grad");
    const err = form.querySelector(".form-error");
    showError(err, ""); err.classList.remove("ok");
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

  const inApp = () => { try { const c = window.Capacitor; return !!(c && c.isNativePlatform && c.isNativePlatform()); } catch { return false; } };
  async function googleSignIn() {
    const g = nativeGoogle();
    if (!g && inApp()) throw Object.assign(new Error("the Google sign-in plugin is missing from this app build"), { code: "app/no-plugin" });
    if (g) {
      await persistence();   // the Android app: ask the phone's own Google account picker, then hand the token to Firebase
      const r = await g.signInWithGoogle();
      const idToken = r && r.credential && r.credential.idToken;
      if (!idToken) throw Object.assign(new Error("no token"), { code: "google/no-token" });
      const { user } = await au.signInWithCredential(auth, au.GoogleAuthProvider.credential(idToken));
      return afterSignIn(user);
    }
    // the website: Google's own small window (google.js). It opens straight from this click; Firebase then just verifies the result.
    const accessToken = await googleAccessToken();
    const { user } = await au.signInWithCredential(auth, au.GoogleAuthProvider.credential(null, accessToken));
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
    await Promise.race([readyP, new Promise(r => setTimeout(r, 4000))]);   // a saved login may still be loading, but never leave the button dead
    if (st.user && st.verified) return true;
    return new Promise(resolve => {
      pending = { resolve };
      openAuth(why);
    });
  }

  /* ── account page ─────────────────────────────────── */
  const addrText = a => a ? formatAddress(a).map(esc).join("<br>") : "";

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
          <label class="inp"><span>Mobile number</span><input name="phone" type="tel" autocomplete="tel" inputmode="tel" maxlength="24" placeholder="+44 7123 456789" value="${esc(p.phone || "")}"></label>
          <div class="inp"><span>Email</span>
            <div class="static">${esc(st.email)} <span class="badge ok">Verified</span></div>
          </div>
        </div>
        <div class="form-section">
          <h3>Delivery address</h3>
          <div class="addr-card" id="acctAddr">${a ? `<div class="addr-text">${addrText(a)}</div>` : `<div class="addr-empty">No address saved yet.</div>`}</div>
          <button class="btn-ghost tight" type="button" id="acctLoc">${a ? "Change address" : "Add address"}</button>
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
      $("#acctLoc").textContent = "Change address";
    });
    if (e.target.closest("#acctOut")) { closeDialog(acct); signOut(); }
  });
  acct.addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target, err = $("#acctErr"), btn = $("#acctSave");
    const name = f.elements.name.value.trim();
    const rawPhone = f.elements.phone.value.trim();
    f.elements.phone.removeAttribute("aria-invalid");
    showError(err, "");
    setBusy(acct, btn, true);
    try {
      let phone = "";
      if (rawPhone) {                                  // must be a number that really exists (country from the saved address, else UK)
        const ph = await validatePhone(rawPhone, (st.profile.address && st.profile.address.country) || "GB");
        if (!ph.ok) { f.elements.phone.setAttribute("aria-invalid", "true"); return showError(err, PHONE_HELP((st.profile.address && st.profile.address.country) || "GB")); }
        phone = ph.e164;
      }
      await saveProfile({ name, phone });
      toast("Saved");
      closeDialog(acct);
    } catch (e2) {
      console.warn("[account]", e2 && e2.code);
      showError(err, "We couldn't save that. Please try again.");
    } finally { setBusy(acct, btn, false); }
  });

  /* ── delivery address form (shared by account + checkout): every part in its own box, checked per country ── */
  let locDone = null, locSeq = 0, locTimer;

  const fieldErr = (f, errors) => {
    ["country", "postcode", "number", "street", "city", "state"].forEach(k => { const el = f.elements[k]; if (el) errors[k] ? el.setAttribute("aria-invalid", "true") : el.removeAttribute("aria-invalid"); });
    const first = Object.keys(errors)[0];
    return first ? errors[first] : "";
  };
  const setStatus = (kind, html) => { const el = $("#locForm [data-pcstatus]"); if (el) { el.className = `pc-status ${kind || ""}`; el.innerHTML = html || ""; } };

  function openLocation(done) {
    locDone = done || null;
    const a = st.profile.address || {};
    $("#locBody").innerHTML = `
      <h2 id="locTitle">Delivery address</h2>
      <p class="muted modal-sub">Fill in every box exactly as it appears on your door and post, so the courier finds you first time.</p>
      <form id="locForm" novalidate><div id="locFields">${addressFormHtml(a, api.shipTo)}</div>
        <p class="form-error" id="locErr" role="alert" hidden></p>
        <button class="btn-primary wide" id="locSave" type="submit">Save address</button>
      </form>`;
    openDialog(loc);
    if (a.postcode) checkPostcode();
  }

  /** UK postcodes are also looked up for real (postcodes.io); other countries are checked by their postcode shape. */
  async function checkPostcode() {
    const f = $("#locForm"); if (!f) return true;
    const country = f.elements.country.value, raw = f.elements.postcode.value.trim(), mine = ++locSeq;
    if (!raw) return setStatus("", ""), false;
    const pc = tidyPostcode(country, raw), c = countryOf(country);
    if (!pc) return setStatus("bad", esc(ERR.postcode(c))), f.elements.postcode.setAttribute("aria-invalid", "true"), false;
    f.elements.postcode.removeAttribute("aria-invalid");
    f.elements.postcode.value = pc === "-" ? "" : pc;
    if (country !== "GB") return setStatus("", ""), true;
    setStatus("wait", "Checking postcode…");
    const info = await lookupPostcode(pc);
    if (mine !== locSeq) return true;
    if (!info.ok) { setStatus(info.reason === "network" ? "warn" : "bad", esc(REASONS[info.reason] || "")); return info.reason === "network"; }
    setStatus("ok", `${esc(info.postcode)} is a real postcode${info.district ? ` · ${esc(info.district)}` : ""}.`);
    if (!f.elements.city.value.trim() && info.district) f.elements.city.value = info.district;
    return true;
  }

  loc.addEventListener("change", e => {
    const f = $("#locForm"); if (!f) return;
    if (e.target.name === "country") {                               // each country has its own state list / postcode shape
      const keep = readAddressForm(f);
      $("#locFields").innerHTML = addressFormHtml({ country: keep.country, line1: "", line2: keep.line2, city: keep.city }, api.shipTo);
      const g = $("#locForm");
      g.elements.number.value = keep.number; g.elements.street.value = keep.street; g.elements.postcode.value = keep.postcode;
      setStatus("", "");
    }
  });
  loc.addEventListener("input", e => {
    if (e.target.name === "postcode") { clearTimeout(locTimer); ++locSeq; setStatus("", ""); locTimer = setTimeout(() => { const f = $("#locForm"); if (f && tidyPostcode(f.elements.country.value, f.elements.postcode.value)) checkPostcode(); }, 400); }
  });
  loc.addEventListener("focusout", e => { if (e.target.name === "postcode") { clearTimeout(locTimer); checkPostcode(); } });

  loc.addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target, err = $("#locErr"), btn = $("#locSave");
    const v = validateAddress(readAddressForm(f), { allowed: api.shipTo });
    if (!v.ok) return showError(err, fieldErr(f, v.errors));
    fieldErr(f, {});
    showError(err, "");
    setBusy(loc, btn, true);
    try {
      if (!(await checkPostcode())) return showError(err, "That postcode isn't real. Please check it.");
      const address = { ...v.value, verified: true };
      await saveProfile({ address });
      closeDialog(loc);
      if (locDone) locDone(address);
    } catch (e2) {
      console.warn("[location]", e2 && e2.code);
      showError(err, "We couldn't save your address. Please try again.");
    } finally { setBusy(loc, btn, false); }
  });

  const api = {
    get user() { return st.user; },
    get profile() { return st.profile; },
    get isOwner() { return st.owner; },
    get ready() { return st.ready; },
    get email() { return st.email; },
    get verified() { return st.verified; },
    shipTo: null,                              // country codes the shop delivers to (set by the shop page)
    requireLogin, openAccount, openLocation, openAuth, saveProfile, signOut,
  };
  return api;
}
