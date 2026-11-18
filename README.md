# Bee Hive

A small shop website (https://plodroid.github.io/store/) on **GitHub Pages + Firebase's free Spark plan**. No card details, no billing, all orders are test orders.

**Shop features:** product pages (big photo, "You may also like", recently viewed), sale prices (owner taps **Sale** on a product), saved items (wishlist, synced to the account), "email me when it's back" on sold-out items (owner taps the **Back in stock** button to email the people waiting), filters and price sorting, My orders.

**Sign-in:** email + password (Firebase Auth, with a "Forgot password?" link) or "Continue with Google". The Apps Script is now only used for Stripe payments and back-in-stock emails.

---

## Setup, step by step

Time: about 15 minutes. You need to be signed in to Google as **housikiki@gmail.com** for all of it.

### 1. Check Google sign-in is on (already done for `beehive-shop-uk`)
Firebase console → **Authentication → Sign-in method** → **Google** = Enabled.
**Settings → Authorized domains** has `plodroid.github.io`.

Optional: switch **Email/Password** off there. The site doesn't use passwords any more.

### 2. Publish the security rules
1. Firebase console → **Firestore Database → Rules**.
2. Delete everything in the editor and paste the whole of [`firestore.rules`](firestore.rules).
3. Click **Publish**.

Do this *before* step 7, otherwise new logins can't read or write anything.

### 3. Download your Firebase service-account key
It lets the script mint a login for someone who typed the right code. Treat it like a password.
1. Firebase console → ⚙ **Project settings → Service accounts**.
2. **Generate new private key** → confirm → a `.json` file downloads.
3. Keep it private. **Never** put it in GitHub, the website, or a chat.

### 4. Create the Apps Script
1. Go to https://script.google.com → **New project**. Name it `store-login`.
2. Delete the default code and paste the whole of [`apps-script/Code.gs`](apps-script/Code.gs).
3. Change `STORE_NAME` at the top if you want. Save (Ctrl+S).

### 5. Give the script the key
1. In the script editor: ⚙ **Project settings → Script properties → Add script property**. Add two:

   | Property | Value |
   |---|---|
   | `FB_CLIENT_EMAIL` | `client_email` from the JSON file (looks like `firebase-adminsdk-xxxx@beehive-shop-uk.iam.gserviceaccount.com`) |
   | `FB_PRIVATE_KEY` | `private_key` from the JSON file: everything from `-----BEGIN PRIVATE KEY-----` to `-----END PRIVATE KEY-----`, without the surrounding quotes. The `\n` pieces are fine as they are. |

2. **Save script properties.**
3. Delete the downloaded JSON from your computer once it's saved.

### 6. Authorise and test
1. In the editor pick the function **`checkSetup`** → **Run**.
2. Google asks for permission → **Review permissions** → pick housikiki@gmail.com → *"Google hasn't verified this app"* → **Advanced → Go to store-login (unsafe)** → **Allow**. (It's your own script; it only needs "send email as you".)
3. The log should say the key works and the email limit left. If it says a property is missing, redo step 5.

### 7. Deploy it as a web app
1. **Deploy → New deployment** → ⚙ type **Web app**.
2. *Execute as:* **Me**. *Who has access:* **Anyone**.
3. **Deploy** → copy the **Web app URL** (starts with `https://script.google.com/macros/s/…/exec`).

### 8. Put the URL in the site
In the repo edit [`firebase-config.js`](firebase-config.js):

```js
window.STORE_AUTH_URL = "https://script.google.com/macros/s/XXXX/exec";
```

Commit and push to `main`. GitHub Pages can take up to ~10 minutes to show it (hard refresh: Ctrl+Shift+R).

### 9. Try it
1. Open the site → **Sign in** → type any *other* email you own → **Send code** → check that inbox (and spam the first time) → type the 4 digits. You're in.
2. Sign out, **Sign in → Continue with Google** with housikiki@gmail.com. **Manage** appears top left. That's the owner panel.

Done. 🎉

---

## How it behaves

- **Owner:** the rules treat `housikiki@gmail.com` as owner only when signed in with **Google** and the email is verified. A 4-digit code can never make someone the owner, and the script refuses to send a code to that address.
- **To change the owner:** edit the email in three places: `firestore.rules` (`isOwner()`), `apps-script/Code.gs` (`GOOGLE_ONLY`), then re-publish the rules and re-deploy the script (step 10).
- **Code rules:** valid for 10 minutes, resend after 30 seconds, 3 wrong tries kills the code, 6 wrong guesses in an hour locks that email for the hour, 5 codes per email per hour. All adjustable in `SETTINGS` at the top of `Code.gs`.
- **Google vs code accounts are separate.** The same person signing in once with a code and once with Google gets two accounts (two profiles, order histories).
- **Theme:** warm white `#F4F3EE` by default, the moon/sun button switches to dark and the choice is remembered on that device.

## Limits of the free plan (on purpose)

- **Emails:** a normal Gmail can send about **100 a day**, so the script stops at 80 sign-in codes a day. After that people can still use Google sign-in. A shop with real traffic should move to a proper email sender later.
- 4 digits is weak by nature. The limits above are what make it acceptable. Anything that handles real money should use something stronger.
- The Apps Script URL is public (it has to be). It only sends codes and checks them; it can't read your shop data.
- `housikiki@gmail.com` is visible in the public repo (rules file). That's fine: the email alone gives no access.
- A postcode is checked to be real; the street/house number can't be verified for free.
- No push notifications when the site is closed. Alerts (sound, toast, desktop notification) work while the page is open.
- Prices/stock aren't enforced at order time: orders hold product ids and quantities, and the owner's **Confirm** locks prices and takes stock. Overselling is possible until then.
- Product photos are stored inside Firestore (shrunk to ≤ ~55 KB) because Storage needs a paid plan.
- Rate limits: one order per 30 s and one message per 60 s per customer.

## Step 10: changing the script later
Editing `Code.gs` does nothing until you redeploy: **Deploy → Manage deployments → ✏ edit → Version: New version → Deploy**. The URL stays the same.

## Step 11: card payments with Stripe (optional)

With card payments on, checkout goes **straight to Stripe's card page**: the customer pays first, and only then does the shop get the order (it is confirmed and the stock is taken automatically). The script works out the price itself from the live shop data (sale prices + delivery fee), so the browser can never choose what is charged. The owner gets an email for every paid order, and the customer gets a receipt email. Card details never touch this site. Without a Stripe key the shop falls back to the old way: place the order, the owner confirms it, pay at pick-up or delivery.

1. Make a free account at <https://dashboard.stripe.com/register> (the shop owner's own account). Stay in **Test mode** (the switch at the top) until you've tried it.
2. In Stripe: **Developers → API keys**. Copy the **Secret key** (starts with `sk_test_`). Never paste it anywhere public.
3. In the Apps Script: **Project Settings (the cog) → Script properties → Add script property**. Name `STRIPE_SECRET_KEY`, value = the key. Save.
4. Redeploy (Step 10): **Deploy → Manage deployments → pencil → Version: New version → Deploy**.
5. Test: add something to the basket, check out, press **Pay**, use card `4242 4242 4242 4242`, any future date, any CVC. You come back to the shop, the order shows **Paid · Confirmed** in *My orders*, and the owner sees it at the top of the **Today** screen.
6. Going live: in Stripe turn Test mode off, finish Stripe's business details, copy the **live** secret key (`sk_live_`) and replace the script property in step 3, then redo step 4.

An order is only marked paid after the script asks Stripe itself whether it was paid. Refunds are done in the Stripe dashboard.

### What the owner does

Open the shop, tap **Manage** (the **Today** tab). Every paid order is a card with one big button: shipping orders go **Shipped → Delivered. All done** (buy the label in Easyship first); pick-up orders go **Order is ready to collect → Handed over. All done**. The first buttons email the customer. The *How does this work?* box on that screen explains it in plain words.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Email sign-in isn't set up yet" | `STORE_AUTH_URL` in `firebase-config.js` is still the placeholder, or the push hasn't gone live yet (wait ~10 min). |
| Code never arrives | Check spam. Run `checkSetup` and look at the email quota in the log. After 80 codes a day it pauses until tomorrow. |
| "Something went wrong" after typing the right code | The script properties are wrong. Run `checkSetup`; re-copy `FB_CLIENT_EMAIL` and `FB_PRIVATE_KEY` from the JSON. |
| Signed in but orders/feedback fail with permission errors | Rules weren't published (step 2) or are an old copy. |
| No **Manage** button | You must sign in with **Google** as housikiki@gmail.com (not a code), and the rules must be published. |
| Google popup blocked / "unauthorized domain" | Allow popups for the site; check `plodroid.github.io` is in Authorized domains (step 1). |
| Script says "Authorization required" when the site calls it | Re-run `checkSetup` once to authorise, then do step 10. |

## Files

| File | What |
|---|---|
| `index.html`, `styles.css`, `app.js` | the shop |
| `auth.js`, `uk.js`, `ui.js` | login (email code + Google), UK postcode/phone helpers, shared UI bits |
| `admin.js`, `admin.css` | owner panel (loaded only for the owner) |
| `firebase-config.js` | public web config + the Apps Script URL (safe to commit; the rules are the security) |
| `firestore.rules` | security rules |
| `apps-script/Code.gs` | the free email-code service (lives in your Google account, not on the website) |
| `test/` | `node --test test/*.test.mjs` (unit + Apps Script logic) and `node test/e2e/flows.mjs`, `node test/e2e/admin.mjs`, `node test/e2e/features.mjs` (browser tests against a fake Firebase; needs Playwright) |
| `functions/`, `android/`, `.github/workflows/android-apk.yml` | **legacy** Blaze-plan backend and owner Android app. Not used by the website. |

## Developing
Open `index.html` through any static server. `?preview` shows sample data when `firebase-config.js` has placeholders.

## Look & brand
Honey-yellow bee theme (colour tokens at the top of `styles.css`). The **beehive** wordmark is an inline SVG in `index.html` / `admin/index.html` (letters drawn as strokes, the "i" dot is a little bee, the crossbars of the e's are honey stripes). App icons are generated by `python3 scripts/make-icons.py`.

## Temporary test photos
The four test products point at free Wikimedia Commons photos (hot-linked): *DATES MEDJOOL.jpg* (CC BY-SA 4.0), *Ajwa dates.JPG* (public domain), *Orange juice 1 edit1.jpg* (public domain), *Sparkling-bottled-water.jpg* (CC BY-SA 2.0). Replace them with the shop's own photos (Manage → Products → Choose photo) before going live; the author and licence of each file are on its Commons page.

## Demo products (temporary)
For the owner demo there are 15 extra products (Hamoud Selecto/Cola, Slim, Freez, Monster, Coke, Fanta, Deglet Nour, baklava, honey, olive oil) plus the categories *Snacks & Sweets* and *Pantry*. Their document ids all start with `demo-` (categories `demo-snacks`, `demo-pantry`), with product photos hot-linked from the brands' sites and Wikimedia Commons (`img/freez.svg` is our own drawing). To remove them: Manage → Products → delete each one, or delete the `demo-*` documents in the Firebase console (Firestore → products / categories).


## Events (owner-made sales + seasonal looks)
Owner page → **Events** → *New event*. He types his own event name (Halloween Week, Black Friday, anything), picks the items and a % off, optional start/end dates (UK time), then switches it on.
- **Look**: *Plain colour* (any colour, for his own events), or the *Ramadan* / *Eid* templates (original SVG art in `events.js`, colours in `events.css`). A template only suggests wording; he can type whatever he wants. Light + dark mode are both handled.
- **Prices are real**: `events.js` (shop) and `liveEvents_`/`quote_` in `apps-script/Code.gs` use the same maths, so the basket and the Stripe charge always match. Best price wins (a product's own sale price, or the event's, never stacked).
- Data: `events/{id}` (owner write, customers can read only `active == true`), rules in `firestore.rules` (`validEvent`). Publish the rules in the Firebase console and make a **new version** of the Apps Script web app after changing them.
- Several live events: the newest decides the page look; every event's prices apply.

## Courier shipping (Easyship), exact address, phone check
The shop's own delivery (map, directions, live tracking) is gone. Orders are **shipped by courier**, priced live by [Easyship](https://www.easyship.com) (Royal Mail, Evri, DPD, UPS and more), or collected.

- **Progress bar**: shipping orders show *Confirmed & paid › Preparing › Shipped › Delivered* (pick-up: *… › Ready to collect › Collected*) on **My orders** and the owner's Today / Orders tabs. Once shipped, the customer gets a **Track parcel** link. One definition in `flow.js`.
- **Checkout**: the customer picks *Collection* or *Shipping*, fills the address, and sees the live courier prices from Easyship (cheapest first, with delivery days). The price they pick is re-checked on the server at pay time, and the total is worked out by the Apps Script, never the browser.
- **Exact address form** (`address.js`): Country, Address line 1 (+ house/flat number), Line 2, Town / city, County / state (where the country has them), Postcode / ZIP. Each country has its own postcode pattern and whether the number goes first (10 Example Road) or last (Hauptstraße 10). UK postcodes are also checked to really exist (postcodes.io). Nothing can be saved half-filled.
- **Phone check**: numbers are validated with libphonenumber-js (vendored in `vendor/phone.js`, loaded only when needed), per country and type, so `199929292931` or `07000000000` is refused and a valid UK mobile is stored as `+447…`.
- **Setup** (once):
  1. Make an Easyship account at <https://app.easyship.com>, connect a courier/payment method, then **Connect → API → Create token** (a *Sandbox* token first is wise).
  2. Apps Script → **Project Settings → Script properties** → add `EASYSHIP_TOKEN` = the token (keep `STRIPE_SECRET_KEY`, `FB_CLIENT_EMAIL`, `FB_PRIVATE_KEY` as before). Redeploy (Step 10).
  3. In the shop: **Manage → Settings → Courier shipping**: tick it, fill the address you post **from**, pick the countries you ship to, free-shipping threshold, default weight, packaging weight and box size, and the Easyship item category (`fashion`, `health_beauty`, `toys`, `home_appliances`…).
  4. In each product's editor set **Weight (grams)** so the courier prices are right.
  5. Publish the updated `firestore.rules` (Firebase console → Firestore → Rules).
- **After a paid shipping order**: the script creates the shipment in Easyship and stores the tracking link on the order. The owner opens Easyship, pays for and prints the label, hands it to the courier, then presses **Shipped** (the customer gets an email). If Easyship can't create it automatically the owner is emailed and the card says so, create it by hand with the address shown.
- Rates are limited per signed-in user (40 an hour) so nobody can burn the Easyship quota.

## Scrolling bar + languages
- **Scrolling bar** at the very top (`ticker.js`): the live event's line ("20% off for Ramadan", or the event's own *Scrolling bar text*) then the owner's own messages (Settings → *Scrolling bar*, one per line). Hidden when empty; still for people who prefer reduced motion.
- **Language button** next to the basket, English (EN) by default: EN, US, FR, AR, ES, DE, TR, IT, HI (Hindi), UR (Urdu), BN, PA, PL, RO, PT, NL, RU, ZH, JA, KO, ID, each with a flag. Arabic and Urdu flip the page right-to-left. `i18n.js` translates the page from the dictionaries in `lang/*.js` (English text → translation, `{x}` = copied part). Product names/descriptions are the owner's own words and are not translated. To add a language: add it to `LANGS` in `i18n.js`, a flag in `flags.js` and a `lang/xx.js`. Missing strings simply stay in English. The owner page stays English.
- **Footer**: dark "Let us help you" column (account, orders, saved, delivery & pick-up, help & feedback, WhatsApp) and "© year Shop. All rights reserved." at the very bottom.


## Analytics + product photos
- **Today tab → Sales & insights**: pick 7 / 30 / 90 days. Four headline numbers (sales, orders, average order, items sold) each compared with the previous period, a sales line chart with £ axis and hover tooltip, orders bars, best sellers, busiest hours/weekdays, pick-up vs delivery and new vs returning customers. All computed in the browser from the orders already loaded; nothing extra is stored.
- **Several photos per product** (up to 5): in the product editor add many at once, make any the cover, reorder or remove. The cover (360px) stays on the product doc so the shop list is small; the full photos (900px) live in `productImages/{productId}` and a customer only fetches them when they open that product, then swipes (native scroll-snap, dots, arrows on desktop, arrow keys). **`firestore.rules` changed** (new `imageCount` field and `productImages` collection): publish the rules again.
