/* ──────────────────────────────────────────────────────────────
   STORE CONFIG — the only file you need to edit.

   Firebase console → Project settings → Your apps → Web app.
   Paste the config over the placeholders and commit.

   Until real keys are in, the site shows sample products
   (clearly labelled as samples) so the design can be previewed.
   ────────────────────────────────────────────────────────────── */

window.FIREBASE_CONFIG = {
  apiKey:            "PASTE_API_KEY",
  authDomain:        "PASTE_PROJECT.firebaseapp.com",
  projectId:         "PASTE_PROJECT_ID",
  storageBucket:     "PASTE_PROJECT.appspot.com",
  messagingSenderId: "PASTE_SENDER_ID",
  appId:             "PASTE_APP_ID",
};

/* Firestore paths. Keep identical on the app side. */
window.STORE_PATHS = {
  products: "products",   // one document per product, price in GBP
  settings: "settings",
  siteDoc:  "site",       // settings/site — editable site copy
};

/* Shown until settings/site loads (or forever, if it doesn't exist). */
window.STORE_DEFAULTS = {
  storeName:    "Plodroid Store",
  heroTitle:    "Everyday essentials,\nall in one place.",
  heroSubtitle: "Explore food, drinks, groceries and more.",
  announcement: "",   // non-empty → thin banner above the nav
  whatsapp:     "",   // e.g. "https://wa.me/447700900000" — enables ordering + footer contact
};
