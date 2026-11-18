/* "Continue with Google" for the website (customer shop + owner page).

   Why not Firebase's own signInWithPopup/Redirect: they bounce through beehive-shop-uk.firebaseapp.com while the shop lives on
   plodroid.github.io. Chrome (and every phone browser) blocks storage shared between those two sites, so the popup hangs on
   a blank handler page and redirects fail with "missing initial state". Google Identity Services instead opens Google's own
   small window from this page and hands the result straight back; Firebase just checks it with signInWithCredential().
   (The Android app uses its native Google plugin instead, see auth.js / admin/main.js.) */

const CLIENT_ID = window.GOOGLE_CLIENT_ID || "81393078838-f08l6ni20ttne8djd57b136n0atorlhh.apps.googleusercontent.com";   // Firebase's web client (needs https://plodroid.github.io as an authorised origin)
const SRC = "https://accounts.google.com/gsi/client";

let loading = null, client = null, waiting = null;

const fail = (code, message) => Object.assign(new Error(message || code), { code });

/** Starts loading Google's script (call it early, e.g. when the sign-in box opens, so the click itself needs no waiting). */
export function preloadGoogle() {
  if (window.google && window.google.accounts && window.google.accounts.oauth2) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SRC; s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { loading = null; s.remove(); reject(fail("google/script-blocked", "Google's sign-in script couldn't load")); };
    document.head.append(s);
    setTimeout(() => { if (!(window.google && window.google.accounts)) { loading = null; reject(fail("auth/network-request-failed", "timeout")); } }, 10000);
  });
  loading.catch(() => {});
  return loading;
}

/** Opens the Google account chooser and resolves with an OAuth access token for the chosen account.
    Must be called from a click handler. If the script is already loaded the window opens instantly. */
export async function googleAccessToken() {
  await preloadGoogle();
  const oauth = window.google.accounts.oauth2;
  if (!client) {
    client = oauth.initTokenClient({
      client_id: CLIENT_ID,
      scope: "openid email profile",
      prompt: "select_account",
      callback: r => { const w = waiting; waiting = null; if (!w) return; r && r.access_token ? w.resolve(r.access_token) : w.reject(fail(r && r.error === "access_denied" ? "auth/popup-closed-by-user" : "google/no-token", r && (r.error_description || r.error))); },
      error_callback: e => { const w = waiting; waiting = null; if (!w) return; w.reject(e && e.type === "popup_closed" ? fail("auth/popup-closed-by-user") : e && e.type === "popup_failed_to_open" ? fail("auth/popup-blocked") : fail("google/no-token", e && e.message)); },
    });
  }
  return new Promise((resolve, reject) => { waiting = { resolve, reject }; client.requestAccessToken(); });
}
