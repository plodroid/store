/* ──────────────────────────────────────────────────────────────
   FIREBASE CONFIG — the only file you need to touch.

   1. Firebase console → Project settings → Your apps → Web app
   2. Copy the config object over the placeholders below
   3. Commit. Done. The site goes live the second the app writes.

   Leave it as-is and the site runs on demo products instead,
   so you can look at the design before Firebase exists.
   ────────────────────────────────────────────────────────────── */

window.FIREBASE_CONFIG = {
  apiKey:            "PASTE_API_KEY",
  authDomain:        "PASTE_PROJECT.firebaseapp.com",
  projectId:         "PASTE_PROJECT_ID",
  storageBucket:     "PASTE_PROJECT.appspot.com",
  messagingSenderId: "PASTE_SENDER_ID",
  appId:             "PASTE_APP_ID",
};

/* Firestore paths the Android app writes to. Keep these identical
   on both sides or the two halves stop talking. */
window.STORE_PATHS = {
  products: "products",    // collection — one document per product
  settings: "settings",    // collection
  siteDoc:  "site",        // settings/site — the doc holding site copy
};

/* Shown until settings/site arrives from Firestore. */
window.STORE_DEFAULTS = {
  storeName:    "Plodroid Store",
  tagline:      "A storefront that never disagrees with the till.",
  heroTitle:    "Your shop counter,\nnow a storefront.",
  heroSubtitle: "Ring up a sale, change a price, restock a shelf — the website follows in the same second. One Firebase line between the till in your hand and the shop the world sees.",
  announcement: "",                       // non-empty → banner appears
  whatsapp:     "https://wa.me/213000000000",
  downloadUrl:  "#",                      // APK link
  currency:     "DZD",
  rates:        { DZD: 1, GBP: 1 / 300, USD: 1 / 224 },  // 1 DZD → x
};
