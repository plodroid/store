/* Owner page (plodroid.github.io/store/admin/). A page of its own: sign in with Google, then the admin panel.
   Only the owner's Google account gets past the gate, and the security rules decide who that is, not this file. */
import { $, wireDialogs, toast } from "../ui.js?v=16";

const FB = "https://www.gstatic.com/firebasejs/10.12.2/";
const cfg = window.FIREBASE_CONFIG || {};
const cap = window.Capacitor;
const native = !!(cap && cap.isNativePlatform && cap.isNativePlatform());     // inside the Android owner app
if (native) $("#gateBack").hidden = true;

const msg = (t, bad) => { const el = $("#gateMsg"); el.textContent = t; el.classList.toggle("bad", !!bad); };
// small grey line with the real technical reason, so a phone problem can be read off the screen instead of guessed
let step = "start";
const env = () => `${native ? "app" : "browser"} · ${(navigator.userAgent.match(/Chrome\/(\d+)/) || [])[1] ? "webview " + navigator.userAgent.match(/Chrome\/(\d+)/)[1] : "unknown webview"} · ${navigator.onLine ? "online" : "OFFLINE"}`;
const why = e => { const el = $("#gateWhy"); if (el) { el.textContent = e ? `${e.code || e.name || "error"}: ${String(e.message || e).slice(0, 160)}\nstep: ${step} · ${env()}` : ""; el.hidden = !e; } };
const gate = on => { $("#gate").hidden = !on; $("#admin").hidden = on; if (on) document.title = "Manage shop · Bee Hive"; };

async function main() {
  wireDialogs();
  if (!cfg.apiKey || /PASTE|YOUR_/i.test(cfg.apiKey)) return msg("This shop isn't connected yet.", true);
  step = "loading Firebase";
  const [{ initializeApp }, fs, au] = await Promise.all([import(FB + "firebase-app.js"), import(FB + "firebase-firestore.js"), import(FB + "firebase-auth.js")]);
  step = "starting Firebase";
  const app = initializeApp(cfg);
  const FS = { db: fs.getFirestore(app), fs, auth: au.getAuth(app), au };
  const PATHS = window.STORE_PATHS || { settings: "settings", siteDoc: "site" };
  let nativeAuth = null;
  if (native) { try { nativeAuth = cap.registerPlugin("FirebaseAuthentication"); } catch (e) { console.warn("[admin] native plugin", e); why(e); } }

  let site = {}, siteUnsub = null, panel = null;
  const signOut = async () => {
    try { if (nativeAuth) await nativeAuth.signOut(); } catch {}
    await au.signOut(FS.auth);
  };
  const acct = { get email() { return FS.auth.currentUser?.email || ""; }, signOut };

  async function google() {
    const btn = $("#gateGoogle"); btn.disabled = true; msg(""); why(null);
    try {
      if (nativeAuth) {          // the Android app: Google blocks its sign-in page inside web views, so ask the phone itself
        step = "Google sign-in (phone)";
      const r = await nativeAuth.signInWithGoogle();
        const idToken = r && r.credential && r.credential.idToken;
        if (!idToken) throw Object.assign(new Error("no token"), { code: "owner/no-token" });
        await au.signInWithCredential(FS.auth, au.GoogleAuthProvider.credential(idToken));
      } else {
        const provider = new au.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: "select_account" });
        await au.signInWithPopup(FS.auth, provider);
      }
    } catch (e) {
      console.warn("[admin] sign-in", e && e.code, e && e.message);
      const quiet = /popup-closed|cancelled|canceled|12501|-5/.test(`${e && e.code} ${e && e.message}`);
      if (!quiet) why(e);
      const setup = /DEVELOPER_ERROR|\b10\b|12500|invalid_audience|auth\/invalid-credential/i.test(`${e && e.code} ${e && e.message}`);
      if (!quiet) msg(e && e.code === "auth/popup-blocked" ? "Your browser blocked the sign-in window. Allow pop-ups and try again."
        : setup && native ? "Google doesn't recognise this app build yet. Send the grey line below to your developer." : "Couldn't sign in. Please try again.", true);
    } finally { btn.disabled = false; }
  }
  step = "waiting for sign-in";
  $("#gateGoogle").addEventListener("click", google);
  $("#gateOut").addEventListener("click", signOut);

  au.onAuthStateChanged(FS.auth, async user => {
    if (siteUnsub) { siteUnsub(); siteUnsub = null; }
    if (panel) { panel.stopAlerts(); }
    gate(true);
    $("#gateOut").hidden = true;
    if (!user) { $("#gateGoogle").hidden = false; return msg("Sign in with the Google account of the shop owner."); }
    $("#gateGoogle").hidden = true;
    msg("Checking your account…");
    let owner = false;
    step = "checking the owner account";
    try { await fs.getDoc(fs.doc(FS.db, "settings", "owner")); owner = true; }      // only the owner is allowed to read this
    catch (e) { if (!e || e.code !== "permission-denied") { console.warn("[admin] owner check", e && e.code); why(e); $("#gateGoogle").hidden = false; return msg("We couldn't check your account. Check your connection and try again.", true); } }
    if (!owner) { $("#gateOut").hidden = false; return msg(`${user.email || "This account"} isn't the shop owner. Sign out and use the owner's Google account.`, true); }

    siteUnsub = fs.onSnapshot(fs.doc(FS.db, PATHS.settings, PATHS.siteDoc), s => { site = s.exists() ? s.data() : {}; panel && panel.refresh && panel.refresh(); }, () => {});
    panel = await import("../admin.js?v=16");
    gate(false);
    panel.openAdmin({ FS, acct, getSite: () => site, page: true, app: native });
  });
}
const failed = e => { console.error("[admin]", e); msg("Something went wrong loading this page.", true); why(e); const r = $("#gateRetry"); if (r) r.hidden = false; };
main().catch(failed);
// anything that blows up before the sign-in screen shows (old phone browser, blocked script...) is shown instead of leaving "Loading…" forever
addEventListener("error", ev => { if ($("#gateMsg").textContent === "Loading…") failed(ev.error || new Error(ev.message || "script error")); });
addEventListener("unhandledrejection", ev => { if ($("#gateMsg").textContent === "Loading…") failed(ev.reason || new Error("rejected")); });
setTimeout(() => { if ($("#gateMsg").textContent === "Loading…") failed(new Error("still loading after 12s (Firebase scripts blocked or no internet?)")); }, 12000);
