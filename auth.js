/* Customer accounts: sign in with an emailed 4-digit code (or Google), the account page and the UK location picker.

How the code login works: the browser asks a tiny Google Apps Script (see apps-script/Code.gs and the README)
to email a random 4-digit code. The script remembers only a hash of the code, checks it, and hands back a
Firebase sign-in token. Firebase itself can't email codes on the free plan, so the script does that part. */

import { $, $$, esc, openDialog, closeDialog, showError, setBusy, toast } from "./ui.js?v=15";
import { streetFor } from "./geo.js?v=15";
import { normalisePostcode, normaliseUkPhone, showUkPhone, lookupPostcode, nearestPostcode, townMatches, REASONS } from "./uk.js?v=15";

const GOOGLE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.7v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.5 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.4 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.4a12 12 0 0 0 0 10.8z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8z"/></svg>`;

const MAIL_URL = () => String(window.STORE_AUTH_URL || "");
const mailerReady = () => /^https:\/\/script\.google\.com\//.test(MAIL_URL());

const MESSAGES = {
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
  use_google: () => "This account signs in with Google. Tap \"Continue with Google\" instead.",
  send_failed: () => "We couldn't send the email just now. Please try again in a minute.",
  bad_code: d => d.left ? `That code isn't right. ${d.left} ${d.left === 1 ? "try" : "tries"} left.` : "That code isn't right.",
  expired: () => "That code has expired or was used up. Tap \"Resend code\" to get a new one.",
  locked: () => "Too many wrong codes. Please try again in an hour.",
};
const SILENT = new Set(["auth/popup-closed-by-user", "auth/cancelled-popup-request"]);
const errText = e => MESSAGES[e && e.code] || "Something went wrong. Please try again in a moment.";

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
  let view = "in", reason = "", pendingEmail = "";
  let cooldownTimer = null;

  const dlg = $("#au"), acct = $("#acct"), loc = $("#loc");

  /* ── who is this, are they verified, are they the owner ── */
  async function loadProfile(user) {
    st.profile = {}; st.owner = false; st.email = ""; st.verified = false;
    if (!user) return;
    try {
      const tok = await user.getIdTokenResult();
      st.email = user.email || tok.claims.mail || "";
      st.verified = user.emailVerified === true || tok.claims.cv === true;   // cv = "code verified" claim set by the mailer script
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
    if (user && !st.verified) { await au.signOut(auth); return; }    // old unverified password accounts: signed out
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
    await au.signOut(auth);
    toast("Signed out");
  }

  /* ── sign-in dialog ───────────────────────────────── */
  const social = () => `
    <div class="or"><span>or</span></div>
    <div class="social"><button class="soc" type="button" data-google>${GOOGLE}<span>Continue with Google</span></button></div>`;

  const VIEWS = {
    in: () => `
      <form class="auth-form" data-form="in" novalidate>
        <h2 id="auTitle">Sign in</h2>
        <p class="auth-sub">${esc(reason || "Enter your email and we'll send you a 4-digit code. No password needed.")}</p>
        <label class="inp"><span>Email address</span><input name="email" type="email" autocomplete="email" inputmode="email" placeholder="you@example.com" required maxlength="120" value="${esc(pendingEmail)}"></label>
        <p class="form-error" role="alert" hidden></p>
        <button class="btn-grad" type="submit">Send code</button>
        ${social()}
      </form>`,
    code: () => `
      <form class="auth-form" data-form="code" novalidate>
        <h2 id="auTitle">Enter your code</h2>
        <p class="auth-sub">We sent a 4-digit code to <strong>${esc(pendingEmail)}</strong>. It expires in 10 minutes. Check your spam folder if it doesn't arrive.</p>
        <div class="otp" id="otp">${[0, 1, 2, 3].map(i => `<input inputmode="numeric" autocomplete="${i ? "off" : "one-time-code"}" aria-label="Digit ${i + 1} of 4">`).join("")}</div>
        <p class="form-error" role="alert" hidden></p>
        <button class="btn-grad" type="submit">Verify and sign in</button>
        <button class="btn-quiet" type="button" data-resend>Resend code</button>
        <p class="auth-switch"><button class="link" type="button" data-go="in">Use a different email</button></p>
      </form>`,
  };

  function go(next) {
    view = next;
    $("#auView").innerHTML = VIEWS[next]();
    clearInterval(cooldownTimer);
    if (next === "code") startCooldown();
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
    if (e.target.closest("[data-google]")) return withBusy(e.target.closest("button"), googleSignIn);
    if (e.target.closest("[data-resend]")) return resend(e.target.closest("button"));
  });

  /* the four code boxes: type, paste, or let the phone autofill; backspace walks back */
  const boxes = () => $$("#otp input");
  const readCode = () => boxes().map(b => b.value).join("");
  function fillFrom(i, digits) {
    const bs = boxes();
    digits.split("").slice(0, 4 - i).forEach((d, k) => { bs[i + k].value = d; });
    const next = Math.min(i + digits.length, 3);
    bs[next].focus();
    if (readCode().length === 4) $("#auView form").requestSubmit();
  }
  dlg.addEventListener("input", e => {
    const bs = boxes(), i = bs.indexOf(e.target);
    if (i < 0) return;
    const digits = e.target.value.replace(/\D/g, "");
    e.target.value = "";
    $("#otp").classList.remove("bad");
    if (digits) fillFrom(i, digits);
  });
  dlg.addEventListener("keydown", e => {
    const bs = boxes(), i = bs.indexOf(e.target);
    if (i < 0) return;
    if (e.key === "Backspace" && !e.target.value && i > 0) { bs[i - 1].value = ""; bs[i - 1].focus(); e.preventDefault(); }
    if (e.key === "ArrowLeft" && i > 0) bs[i - 1].focus();
    if (e.key === "ArrowRight" && i < 3) bs[i + 1].focus();
  });
  dlg.addEventListener("paste", e => {
    const bs = boxes(), i = bs.indexOf(e.target);
    if (i < 0) return;
    e.preventDefault();
    const digits = (e.clipboardData?.getData("text") || "").replace(/\D/g, "");
    if (digits) fillFrom(0, digits);
  });

  dlg.addEventListener("submit", async e => {
    e.preventDefault();
    const form = e.target.closest("form");
    const kind = form?.dataset.form;
    const btn = form.querySelector(".btn-grad");
    const err = form.querySelector(".form-error");
    showError(err, "");
    const fail = d => showError(err, (CODE_ERRORS[d.error] || (() => "Something went wrong. Please try again."))(d));

    if (kind === "in") {
      const email = form.elements.email.value.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) {
        form.elements.email.setAttribute("aria-invalid", "true");
        return showError(err, "Please enter a valid email address.");
      }
      setBusy(dlg, btn, true);
      try {
        const r = await mailer({ a: "send", email });
        if (!r.ok) return fail(r);
        pendingEmail = email;
        go("code");
      } catch (e2) { console.warn("[auth]", e2 && (e2.code || e2.message)); showError(err, errText(e2)); }
      finally { setBusy(dlg, btn, false); }
    }

    if (kind === "code") {
      const code = readCode();
      if (code.length < 4) return showError(err, "Please enter all 4 digits.");
      setBusy(dlg, btn, true);
      try {
        const r = await mailer({ a: "verify", email: pendingEmail, code });
        if (!r.ok || !r.token) {
          fail(r);
          $("#otp").classList.add("bad");
          boxes().forEach(b => { b.value = ""; });
          boxes()[0].focus();
          return;
        }
        await persistence();
        const { user } = await au.signInWithCustomToken(auth, r.token);
        await afterSignIn(user);
      } catch (e2) { console.warn("[auth]", e2 && (e2.code || e2.message)); showError(err, errText(e2)); }
      finally { setBusy(dlg, btn, false); }
    }
  });

  async function persistence() {
    try { await au.setPersistence(auth, au.browserLocalPersistence); } catch {}
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
    await persistence();
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

  function startCooldown(secs = 30) {
    const btn = $("#auView [data-resend]");
    if (!btn) return;
    let left = secs;
    const tick = () => {
      btn.disabled = left > 0;
      btn.textContent = left > 0 ? `Resend code (${left}s)` : "Resend code";
      if (left-- <= 0) clearInterval(cooldownTimer);
    };
    tick();
    cooldownTimer = setInterval(tick, 1000);
  }

  async function resend(btn) {
    const err = $("#auView .form-error");
    showError(err, "");
    try {
      const r = await mailer({ a: "send", email: pendingEmail });
      if (!r.ok) return showError(err, (CODE_ERRORS[r.error] || (() => "Something went wrong. Please try again."))(r));
      toast("New code sent");
      boxes().forEach(b => { b.value = ""; });
      boxes()[0]?.focus();
      startCooldown();
    } catch (e) { showError(err, errText(e)); }
  }

  function finish(ok) {
    const p = pending; pending = null;
    closeDialog(dlg);
    if (p) p.resolve(ok);
  }
  dlg.addEventListener("close", () => { clearInterval(cooldownTimer); if (pending) { const p = pending; pending = null; p.resolve(false); } });

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
            <div class="static">${esc(st.email)} <span class="badge ok">Verified</span></div>
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
        <label class="inp"><span>Postcode*</span><input name="postcode" autocomplete="postal-code" autocapitalize="characters" placeholder="Postcode" maxlength="9" required value="${esc(a.postcode || "")}"></label>
        <p class="pc-status" id="locStatus" role="status" aria-live="polite"></p>
        <label class="inp"><span>House number and street*</span><input name="line1" autocomplete="address-line1" placeholder="House number and street" maxlength="120" required value="${esc(a.line1 || "")}"></label>
        <label class="inp"><span>Flat, building or area <em>(optional)</em></span><input name="line2" autocomplete="address-line2" maxlength="120" value="${esc(a.line2 || "")}"></label>
        <label class="inp"><span>Town or city*</span><input name="city" autocomplete="address-level2" maxlength="60" required value="${esc(a.city || "")}"></label>
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
      setStatus("ok", `${$("#locStatus").innerHTML} <span class="hl">Add your house number before “${esc(s.street)}”.</span>`);
      if (document.activeElement === f.elements.postcode || document.activeElement === document.body) { line1.focus({ preventScroll: true }); line1.setSelectionRange(0, 0); }
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
    get email() { return st.email; },
    get verified() { return st.verified; },
    requireLogin, openAccount, openLocation, openAuth, saveProfile, signOut,
  };
  return api;
}
