/* ──────────────────────────────────────────────────────────────
   SHOP CONFIG — the only website file you need to edit.

   Firebase console → Project settings → Your apps → Web app (</>)
   → copy the firebaseConfig values over the placeholders below.

   Modes (the page also logs which one is active in the console):
     • Keys filled in            → LIVE: real products, real (test) orders.
     • Placeholders, normal URL  → NOT CONNECTED: customers see "getting ready".
     • Placeholders + ?preview   → PREVIEW: labelled sample data, ordering off.
   ────────────────────────────────────────────────────────────── */

window.FIREBASE_CONFIG = {
  apiKey:            "AIzaSyAyEC7cTlTsNibzK7zVFm3NTds1ezcJDa0",
  authDomain:        "asimsstore.firebaseapp.com",
  projectId:         "asimsstore",
  storageBucket:     "asimsstore.firebasestorage.app",
  messagingSenderId: "696286412872",
  appId:             "1:696286412872:web:f6ef9d5a8bd27cfb1cd87d",
};

/* Must match the region in functions/index.js */
window.FUNCTIONS_REGION = "europe-west2";

/* Email-code sign-in: the web-app URL of the Apps Script in apps-script/Code.gs (README step 5).
   Public by design: it only ever emails a code to the address typed in. Leave the placeholder and
   customers can still use "Continue with Google". */
window.STORE_AUTH_URL = "https://script.google.com/macros/s/AKfycbz5X6rKkjzrKq5wBIhFFWkgBVKXi3fb26h7McPT90VnUQd6bSEiP3Bodh6-TEPfe1cL/exec";

/* Firestore paths shared with the owner app. */
window.STORE_PATHS = {
  products:   "products",
  categories: "categories",
  settings:   "settings",
  siteDoc:    "site",
};

/* Used until settings/site loads. The owner app edits these live. */
window.STORE_DEFAULTS = {
  storeName:    "Bee Hive",
  heroTitle:    "Everyday essentials,\nall in one place.",
  heroSubtitle: "Food, drinks, groceries and more. Order online, then pick up from the shop.",
  announcement: "",
  whatsapp:     "",
  collection:   true,    // customers can collect
  delivery:     false,   // delivery off until the owner turns it on
  deliveryFee:  0,
};
