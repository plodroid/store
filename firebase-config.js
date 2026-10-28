/* ──────────────────────────────────────────────────────────────
   STORE CONFIG — the only website file you need to edit.

   Firebase console → Project settings → Your apps → Web app (</>)
   → copy the firebaseConfig values over the placeholders below.

   Modes (the page also logs which one is active in the console):
     • Keys filled in            → LIVE: real products, real (test) orders.
     • Placeholders, normal URL  → NOT CONNECTED: customers see "getting ready".
     • Placeholders + ?preview   → PREVIEW: labelled sample data, ordering off.
   ────────────────────────────────────────────────────────────── */

window.FIREBASE_CONFIG = {
  apiKey:            "PASTE_API_KEY",
  authDomain:        "PASTE_PROJECT.firebaseapp.com",
  projectId:         "PASTE_PROJECT_ID",
  storageBucket:     "PASTE_PROJECT.firebasestorage.app",
  messagingSenderId: "PASTE_SENDER_ID",
  appId:             "PASTE_APP_ID",
};

/* Must match the region in functions/index.js */
window.FUNCTIONS_REGION = "europe-west2";

/* Firestore paths shared with the owner app. */
window.STORE_PATHS = {
  products:   "products",
  categories: "categories",
  settings:   "settings",
  siteDoc:    "site",
};

/* Used until settings/site loads. The owner app edits these live. */
window.STORE_DEFAULTS = {
  storeName:    "Plodroid Store",
  heroTitle:    "Everyday essentials,\nall in one place.",
  heroSubtitle: "Explore food, drinks, groceries and more.",
  announcement: "",
  whatsapp:     "",
  collection:   true,    // customers can collect
  delivery:     false,   // delivery off until the owner turns it on
  deliveryFee:  0,
};
