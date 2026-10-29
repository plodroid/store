/* Customer accounts: sign in / sign up / forgot password / email verification,
   the account page and the UK location picker.

   Free-plan note: Firebase can only send a verification LINK (not a 4-digit code) without a server,
   so "verified" here means the customer clicked the link in the email Firebase sent them. */

import { $, $$, esc, openDialog, closeDialog, showError, setBusy, toast } from "./ui.js";
import { normalisePostcode, normaliseUkPhone, showUkPhone, lookupPostcode, nearestPostcode, townMatches, REASONS } from "./uk.js";

const EYE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_OFF = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.5 6.6A16.6 16.6 0 0 0 2 12s3.6 7 10 7a10 10 0 0 0 4.4-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>`;
const GOOGLE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.7v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.5 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.4 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.4a12 12 0 0 0 0 10.8z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8z"/></svg>`;
const APPLE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.4 12.6c0-2.4 2-3.5 2.1-3.6a4.5 4.5 0 0 0-3.5-1.9c-1.5-.1-2.9.9-3.6.9s-1.9-.9-3.1-.9a4.6 4.6 0 0 0-3.9 2.4c-1.7 2.9-.4 7.2 1.2 9.5.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.1-.8s1.9.8 3.1.7c1.3 0 2.1-1.2 2.9-2.3a10 10 0 0 0 1.3-2.7 4.2 4.2 0 0 1-2.6-3.7zM14.1 5.6A4.3 4.3 0 0 0 15.1 2.5a4.4 4.4 0 0 0-2.9 1.5 4.1 4.1 0 0 0-1 3 3.6 3.6 0 0 0 2.9-1.4z"/></svg>`;

const MESSAGES = {
  "auth/email-already-in-use": "An account with that email already exists. Try signing in instead.",
  "auth/invalid-email": "That email address doesn't look right.",
  "auth/weak-password": "Please choose a stronger password (at least 8 characters).",
  "auth/invalid-credential": "That email or password isn't right.",
  "auth/wrong-password": "That email or password isn't right.",
  "auth/user-not-found": "That email or password isn't right.",
  "auth/too-many-requests": "Too many attempts. Please wait a few minutes and try again.",
  "auth/network-request-failed": "We couldn't reach the server. Check your connection and try again.",
  "auth/popup-blocked": "Your browser blocked the sign-in window. Allow pop-ups for this site and try again.",
  "auth/operation-not-allowed": "This way of signing in isn't switched on yet. The shop owner needs to enable it.",
  "auth/unauthorized-domain": "This website address isn't approved for sign-in yet. The shop owner needs to add it in Firebase.",
  "auth/user-disabled": "This account has been disabled.",
};
const SILENT = new Set(["auth/popup-closed-by-user", "auth/cancelled-popup-request"]);
const errText = e => MESSAGES[e && e.code] || "Something went wrong. Please try again in a moment.";

export function createAuth({ FS, onChange = () => {} }) {
  const { db, fs, auth, au } = FS;
  const st = { user: null, profile: {}, owner: false, ready: false };
  let pending = null;            // { resolve } while requireLogin() is waiting
  let markReady; const readyP = new Promise(r => (markReady = r));   // first auth answer from Firebase
  let view = "in", reason = "";
  let cooldownTimer = null;

  const dlg = $("#au"), acct = $("#acct"), loc = $("#loc");

  /* ── profile + owner flag ─────────────────────────── */
  async function loadProfile(user) {
    st.profile = {}; st.owner = false;
    if (!user) return;
    try {
      const snap = await fs.getDoc(fs.doc(db, "users", user.uid));
      st.profile = snap.exists() ? snap.data() : {};
    } catch (e) { console.warn("[auth] profile", e && e.code); }
    try {
      st.owner = (await fs.getDoc(fs.doc(db, "owners", user.uid))).exists();
    } catch (e) { console.warn("[auth] owner check", e && e.code); }
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
  const initial = () => ((st.profile.name || st.user?.displayName || st.user?.email || "?").trim()[0] || "?").toUpperCase();
  function paintNav() {
    const signed = !!st.user;
    $("#signInBtn").hidden = signed;
    $("#acctBtn").hidden = !signed;
    $("#acctBtn").textContent = signed ? initial() : "";
    $("#manageBtn").hidden = !st.owner;
    if (!signed) closeMenu();
  }
  const menu = $("#menu");
  function closeMenu() { menu.hidden = true; $("#acctBtn").setAttribute("aria-expanded", "false"); }
  function toggleMenu() {
    const open = menu.hidden;
    menu.hidden = !open;
    $("#acctBtn").setAttribute("aria-expanded", String(open));
    $("#menuEmail").textContent = st.user?.email || "";
    if (open) $("#menuAcct").focus({ preventScroll: true });
  }
  $("#signInBtn").addEventListener("click", () => openAuth("in"));
  $("#acctBtn").addEventListener("click", toggleMenu);
  $("#menuAcct").addEventListener("click", () => { closeMenu(); openAccount(); });
  $("#menuOut").addEventListener("click", async () => { closeMenu(); await signOut(); });
  addEventListener("click", e => { if (!menu.hidden && !e.target.closest("#menu, #acctBtn")) closeMenu(); });
  addEventListener("keydown", e => { if (e.key === "Escape" && !menu.hidden) { closeMenu(); $("#acctBtn").focus(); } });

  async function signOut() {
    await au.signOut(auth);
    toast("Signed out");
  }

  /* ── auth dialog ──────────────────────────────────── */
  const pw = (name, label, ac) => `
    <label class="inp pw"><span>${label}</span>
      <input name="${name}" type="password" autocomplete="${ac}" placeholder="••••••••" required minlength="8" maxlength="128">
      <button class="eye" type="button" aria-label="Show password" aria-pressed="false">${EYE}</button>
    </label>`;
  const social = () => `
    <div class="or"><span>Or continue with</span></div>
    <div class="social">
      <button class="soc" type="button" data-google>${GOOGLE}<span>Google</span></button>
      <button class="soc" type="button" disabled title="Apple sign-in needs an Apple Developer account. Coming soon.">${APPLE}<span>Apple</span><small>soon</small></button>
    </div>`;

  const VIEWS = {
    in: () => `
      <form class="auth-form" data-form="in" novalidate>
        <h2 id="auTitle">Welcome back!</h2>
        <p class="auth-sub">${esc(reason || "Sign in to order, save your address and follow your orders.")}</p>
        <label class="inp"><span>Email address*</span><input name="email" type="email" autocomplete="email" placeholder="example@gmail.com" required maxlength="120"></label>
        ${pw("password", "Password*", "current-password")}
        <div class="auth-row">
          <label class="check"><input type="checkbox" name="remember" checked><span>Remember me</span></label>
          <button class="link" type="button" data-go="forgot">Forgot password?</button>
        </div>
        <p class="form-error" role="alert" hidden></p>
        <button class="btn-grad" type="submit">Sign in</button>
        ${social()}
        <p class="auth-switch">Don't have an account? <button class="link strong" type="button" data-go="up">Sign up</button></p>
      </form>`,
    up: () => `
      <form class="auth-form" data-form="up" novalidate>
        <h2 id="auTitle">Create your account</h2>
        <p class="auth-sub">${esc(reason || "Create an account to order from the shop and save your details.")}</p>
        <label class="inp"><span>Full name*</span><input name="name" autocomplete="name" placeholder="Alex Smith" required minlength="2" maxlength="80"></label>
        <label class="inp"><span>Email address*</span><input name="email" type="email" autocomplete="email" placeholder="example@gmail.com" required maxlength="120"></label>
        ${pw("password", "Password*", "new-password")}
        <p class="auth-hint">At least 8 characters.</p>
        <p class="form-error" role="alert" hidden></p>
        <button class="btn-grad" type="submit">Register</button>
        ${social()}
        <p class="auth-switch">Already have an account? <button class="link strong" type="button" data-go="in">Sign in</button></p>
      </form>`,
    forgot: () => `
      <form class="auth-form" data-form="forgot" novalidate>
        <h2 id="auTitle">Forgot password?</h2>
        <p class="auth-sub">Enter your email and we'll send you a link to choose a new one.</p>
        <label class="inp"><span>Email address*</span><input name="email" type="email" autocomplete="email" placeholder="example@gmail.com" required maxlength="120"></label>
        <p class="form-error" role="alert" hidden></p>
        <p class="form-ok" role="status" hidden></p>
        <button class="btn-grad" type="submit">Send link</button>
        <p class="auth-switch">Remembered it? <button class="link strong" type="button" data-go="in">Sign in</button></p>
      </form>`,
    verify: () => `
      <div class="auth-form" data-form="verify">
        <h2 id="auTitle">Check your email</h2>
        <p class="auth-sub">We sent a verification link to <strong>${esc(st.user?.email || "")}</strong>. Open it, then come back here. It can take a minute, and it may land in spam.</p>
        <p class="form-error" role="alert" hidden></p>
        <button class="btn-grad" type="button" data-check>I've verified, continue</button>
        <button class="btn-quiet" type="button" data-resend>Resend email</button>
        <p class="auth-switch"><button class="link" type="button" data-other>Use a different account</button></p>
      </div>`,
  };

  function go(next) {
    view = next;
    $("#auView").innerHTML = VIEWS[next]();
    $("#auBack").hidden = next === "in" || next === "up" || next === "verify";
    dlg.dataset.view = next;
    $("#auView input")?.focus({ preventScroll: true });
    if (next === "verify") startCooldown();
  }

  function openAuth(start = "in", why = "") {
    reason = why;
    go(st.user && !st.user.emailVerified ? "verify" : start);
    openDialog(dlg);
  }

  $("#auBack").addEventListener("click", () => go("in"));

  dlg.addEventListener("click", async e => {
    const goBtn = e.target.closest("[data-go]");
    if (goBtn) return go(goBtn.dataset.go);

    const eye = e.target.closest(".eye");
    if (eye) {
      const input = eye.parentElement.querySelector("input");
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      eye.innerHTML = show ? EYE_OFF : EYE;
      eye.setAttribute("aria-pressed", String(show));
      eye.setAttribute("aria-label", show ? "Hide password" : "Show password");
      return;
    }
    if (e.target.closest("[data-google]")) return withBusy(e.target.closest("button"), googleSignIn);
    if (e.target.closest("[data-check]")) return withBusy(e.target.closest("button"), checkVerified);
    if (e.target.closest("[data-resend]")) return resend(e.target.closest("button"));
    if (e.target.closest("[data-other]")) { await signOut(); go("in"); }
  });

  dlg.addEventListener("submit", async e => {
    e.preventDefault();
    const form = e.target.closest("form");
    const kind = form?.dataset.form;
    const btn = form.querySelector(".btn-grad");
    const err = form.querySelector(".form-error");
    showError(err, "");
    const v = n => (form.elements[n]?.value || "").trim();
    const bad = (el, msg) => { el.setAttribute("aria-invalid", "true"); showError(err, msg); el.focus(); };
    for (const el of form.elements) el.removeAttribute?.("aria-invalid");

    if (kind !== "verify") {
      const email = v("email");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad(form.elements.email, "Please enter a valid email address.");
      if (kind !== "forgot" && (form.elements.password.value.length < 8)) return bad(form.elements.password, "Your password needs at least 8 characters.");
      if (kind === "up" && v("name").length < 2) return bad(form.elements.name, "Please enter your full name.");
    }

    setBusy(dlg, btn, true);
    try {
      if (kind === "in") {
        await persistence(form.elements.remember.checked);
        const { user } = await au.signInWithEmailAndPassword(auth, v("email"), form.elements.password.value);
        await afterSignIn(user);
      } else if (kind === "up") {
        await persistence(true);
        const { user } = await au.createUserWithEmailAndPassword(auth, v("email"), form.elements.password.value);
        await au.updateProfile(user, { displayName: v("name") });
        st.user = user;
        await saveProfile({ name: v("name") }).catch(() => {});
        await au.sendEmailVerification(user).catch(e => console.warn("[auth] verification email", e && e.code));
        go("verify");
      } else if (kind === "forgot") {
        try { await au.sendPasswordResetEmail(auth, v("email")); }
        catch (e2) { if (e2.code !== "auth/user-not-found") throw e2; }
        const ok = form.querySelector(".form-ok");
        ok.textContent = "If there's an account for that email, a reset link is on its way. Check your spam folder too.";
        ok.hidden = false;
      }
    } catch (e2) {
      console.warn("[auth]", e2 && e2.code);
      if (!SILENT.has(e2 && e2.code)) showError(err, errText(e2));
    } finally {
      setBusy(dlg, btn, false);
    }
  });

  async function persistence(remember) {
    try { await au.setPersistence(auth, remember ? au.browserLocalPersistence : au.browserSessionPersistence); } catch {}
  }

  async function withBusy(btn, fn) {
    const err = $("#auView .form-error");
    showError(err, "");
    setBusy(dlg, btn, true);
    try { await fn(); }
    catch (e) { console.warn("[auth]", e && e.code); if (!SILENT.has(e && e.code)) showError(err, errText(e)); }
    finally { setBusy(dlg, btn, false); }
  }

  async function googleSignIn() {
    await persistence(true);
    const provider = new au.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    const { user } = await au.signInWithPopup(auth, provider);
    await afterSignIn(user);
  }

  async function afterSignIn(user) {
    st.user = user;
    await loadProfile(user);
    paintNav();
    if (user.emailVerified) return finish(true);
    go("verify");                                       // they can press "Resend email" if the first one got lost
  }

  async function checkVerified() {
    const user = auth.currentUser;
    if (!user) return go("in");
    await user.reload();
    await user.getIdToken(true);                       // refresh so rules see email_verified = true
    if (user.emailVerified) { st.user = user; await loadProfile(user); paintNav(); onChange(api); return finish(true); }
    showError($("#auView .form-error"), "Not verified yet. Open the link in the email we sent, then tap this again.");
  }

  function startCooldown(secs = 30) {
    clearInterval(cooldownTimer);
    const btn = $("#auView [data-resend]");
    if (!btn) return;
    let left = secs;
    const tick = () => {
      btn.disabled = left > 0;
      btn.textContent = left > 0 ? `Resend email (${left}s)` : "Resend email";
      if (left-- <= 0) clearInterval(cooldownTimer);
    };
    tick();
    cooldownTimer = setInterval(tick, 1000);
  }

  async function resend(btn) {
    try {
      await au.sendEmailVerification(auth.currentUser);
      toast("Verification email sent");
      startCooldown();
    } catch (e) {
      showError($("#auView .form-error"), e.code === "auth/too-many-requests" ? errText(e) : "We couldn't send that just now. Please try again in a minute.");
    }
  }

  function finish(ok) {
    const p = pending; pending = null;
    closeDialog(dlg);
    if (p) p.resolve(ok);
  }
  dlg.addEventListener("close", () => { clearInterval(cooldownTimer); if (pending) { const p = pending; pending = null; p.resolve(false); } });

  /** Resolves true once the customer is signed in AND email-verified; false if they close the dialog. */
  async function requireLogin(why = "") {
    await readyP;                                       // a saved login may still be loading
    if (st.user && st.user.emailVerified) return true;
    return new Promise(resolve => {
      pending = { resolve };
      openAuth("in", why);
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
            <div class="static">${esc(st.user.email || "")} <span class="badge ${st.user.emailVerified ? "ok" : "warn"}">${st.user.emailVerified ? "Verified" : "Not verified"}</span></div>
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
  let locDone = null, locCheck = null, locSeq = 0, locTimer;

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
        <label class="inp"><span>Postcode*</span><input name="postcode" autocomplete="postal-code" autocapitalize="characters" placeholder="LE5 4GU" maxlength="9" required value="${esc(a.postcode || "")}"></label>
        <p class="pc-status" id="locStatus" role="status" aria-live="polite"></p>
        <label class="inp"><span>House number and street*</span><input name="line1" autocomplete="address-line1" placeholder="1 Thoresby Street" maxlength="120" required value="${esc(a.line1 || "")}"></label>
        <label class="inp"><span>Flat, building or area <em>(optional)</em></span><input name="line2" autocomplete="address-line2" maxlength="120" value="${esc(a.line2 || "")}"></label>
        <label class="inp"><span>Town or city*</span><input name="city" autocomplete="address-level2" placeholder="Leicester" maxlength="60" required value="${esc(a.city || "")}"></label>
        <label class="inp ro"><span>Country</span><input value="United Kingdom" readonly tabindex="-1"></label>
        <p class="form-error" id="locErr" role="alert" hidden></p>
        <button class="btn-primary wide" id="locSave" type="submit" disabled>Save location</button>
      </form>`;
    locCheck = null;
    openDialog(loc);
    if (a.postcode) runCheck();
    else paintLoc();
  }

  function paintLoc() {
    const f = $("#locForm"); if (!f) return;
    const ok = locCheck && locCheck.ok && f.elements.line1.value.trim() && f.elements.city.value.trim();
    $("#locSave").disabled = !ok;
  }

  function setStatus(kind, html) {
    const el = $("#locStatus");
    el.className = `pc-status ${kind || ""}`;
    el.innerHTML = html || "";
  }

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
      f.elements.line1.focus({ preventScroll: true });
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
      line1: f.elements.line1.value.trim(), line2: f.elements.line2.value.trim(), city: f.elements.city.value.trim(),
      postcode: locCheck.postcode, lat: locCheck.lat, lng: locCheck.lng, verified: true,
    };
    if (!address.line1 || !address.city) return showError(err, "Please fill in the house number, street and town.");
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

  const api = {
    get user() { return st.user; },
    get profile() { return st.profile; },
    get isOwner() { return st.owner; },
    get ready() { return st.ready; },
    get verified() { return !!(st.user && st.user.emailVerified); },
    requireLogin, openAccount, openLocation, openAuth, saveProfile, signOut,
  };
  return api;
}
