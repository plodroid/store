/**
 * Bee Hive server helper (Google Apps Script). Setup: README.md.
 *
 *   rates  {idToken, address, customer, items}  -> shipping options + prices from Easyship (Evri, Royal Mail, UPS, DPD ...)
 *   pay    {idToken, orderId}   -> a customer's own order: prices it from the live shop data (items + the chosen Easyship
 *                                  service, re-quoted here, never trusted from the browser) and returns a Stripe Checkout link
 *   paid   {idToken, orderId, sid} -> after Stripe sends the customer back: checks the payment with Stripe, marks the order paid,
 *                                     takes the stock, creates the shipment in Easyship and emails the owner + customer
 *   stage  {idToken, orderId}   -> owner only: emails the customer the order's new step (shipped / ready to collect)
 *   notify {idToken, product, link, emails} -> owner only: emails customers that a product is back in stock
 *
 * Secrets live in Script properties (never in the website): STRIPE_SECRET_KEY, EASYSHIP_TOKEN, FB_CLIENT_EMAIL, FB_PRIVATE_KEY.
 */

const SETTINGS = {
  STORE_NAME: 'Bee Hive',
  SITE_URL: 'https://plodroid.github.io/store/',   // notify emails may only link here
  FIREBASE_API_KEY: 'AIzaSyDvXzdxig3eEGKAnQReP4HmjDKFISoJQH4',   // the public web key from firebase-config.js (used to check logins)
  SENDS_PER_DAY: 80,         // emails for the whole shop per day (a free Gmail can send about 100 a day)
  OWNER_EMAILS: ['housikiki@gmail.com'],   // owner must be signed in with Google as one of these
  NOTIFY_MAX: 40,            // customers per back-in-stock send
  PROJECT_ID: 'beehive-shop-uk',  // Firebase project (orders are read and marked paid here)
  OWNER_EMAIL: 'housikiki@gmail.com',   // gets an email for every paid order
  EASYSHIP: 'https://public-api.easyship.com/2024-09',
  RATES_PER_HOUR: 40,        // shipping quotes per customer per hour
};

/* ── web app entry points ─────────────────────────────── */

function doGet() { return out_({ ok: true, service: 'store', pay: !!stripeKey_(), ship: !!easyKey_() }); }

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (x) { return out_({ ok: false, error: 'bad_request' }); }
  if (!body || typeof body !== 'object') return out_({ ok: false, error: 'bad_request' });
  try {
    if (body.a === 'rates') return out_(rates_(body));          // read-only: no lock, so a slow quote never blocks a payment
  } catch (err) { console.error(err); return out_({ ok: false, error: 'server' }); }

  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (x) { return out_({ ok: false, error: 'server' }); }
  try {
    if (body.a === 'notify') return out_(notify_(body));
    if (body.a === 'pay') return out_(pay_(body));
    if (body.a === 'paid') return out_(paid_(body));
    if (body.a === 'stage') return out_(stage_(body));
    return out_({ ok: false, error: 'bad_request' });
  } catch (err) {
    console.error(err);
    return out_({ ok: false, error: 'server' });
  } finally {
    lock.releaseLock();
  }
}

/* ── back-in-stock emails (owner only) ───────────────── */

/** True only when the Firebase login token belongs to a Google-verified owner address. */
function ownerOf_(idToken) {
  const res = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + SETTINGS.FIREBASE_API_KEY,
    { method: 'post', contentType: 'application/json', payload: JSON.stringify({ idToken: idToken }), muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return false;
  const u = (JSON.parse(res.getContentText()).users || [])[0];
  if (!u || u.emailVerified !== true) return false;
  const viaGoogle = (u.providerUserInfo || []).some(function (p) { return p.providerId === 'google.com'; });
  return viaGoogle && SETTINGS.OWNER_EMAILS.indexOf(String(u.email || '').toLowerCase()) >= 0;
}

function notify_(b) {
  const idToken = String(b.idToken || ''), product = String(b.product || '').trim().slice(0, 120), link = String(b.link || '');
  const seen = {}, emails = (Array.isArray(b.emails) ? b.emails : []).map(function (x) { return String(x).trim().toLowerCase(); })
    .filter(function (x) { if (seen[x] || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x) || x.length > 120) return false; return (seen[x] = true); })
    .slice(0, SETTINGS.NOTIFY_MAX);
  if (!idToken || !product || link.indexOf(SETTINGS.SITE_URL) !== 0 || link.length > 300 || !emails.length) return { ok: false, error: 'bad_request' };
  if (!ownerOf_(idToken)) return { ok: false, error: 'not_owner' };

  const sentTo = [];
  for (let i = 0; i < emails.length; i++) {
    if (dayCount_() >= SETTINGS.SENDS_PER_DAY) break;
    try {
      MailApp.sendEmail({
        to: emails[i], name: SETTINGS.STORE_NAME,
        subject: product + ' is back in stock at ' + SETTINGS.STORE_NAME,
        body: 'Good news: ' + product + ' is back in stock.\n\n' + link + '\n\nYou asked us to tell you. This is the only email you will get about it.',
        htmlBody: '<div style="font-family:Arial,sans-serif;max-width:420px"><p style="margin:0 0 12px">Good news: <b>' + esc_(product) + '</b> is back in stock.</p>' +
                  '<p style="margin:0 0 16px"><a href="' + esc_(link) + '" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#1A6CE0;color:#fff;text-decoration:none">View it in the shop</a></p>' +
                  '<p style="margin:0;color:#666;font-size:13px">You asked us to tell you. This is the only email you will get about it.</p></div>',
      });
      bumpDay_(); sentTo.push(emails[i]);
    } catch (err) { console.error(err); }
  }
  if (!sentTo.length) return { ok: false, error: dayCount_() >= SETTINGS.SENDS_PER_DAY ? 'busy' : 'server' };
  return { ok: true, sent: sentTo.length, sentTo: sentTo };
}
function esc_(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

/* ── card payments (Stripe Checkout) ─────────────────────
   The secret key lives only in Script properties (STRIPE_SECRET_KEY). Amounts always come from the order in
   Firestore, never from the browser, and "paid" is only written after Stripe itself says so. */

function stripeKey_() { return PropertiesService.getScriptProperties().getProperty('STRIPE_SECRET_KEY') || ''; }

/** The Firebase account behind a login token, or null. */
function user_(idToken) {
  if (!idToken) return null;
  const res = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + SETTINGS.FIREBASE_API_KEY,
    { method: 'post', contentType: 'application/json', payload: JSON.stringify({ idToken: String(idToken) }), muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  const u = (JSON.parse(res.getContentText()).users || [])[0];
  return u && u.localId ? { uid: u.localId, email: u.email || '' } : null;
}

function stripe_(method, path, form) {
  const opts = { method: method, headers: { Authorization: 'Basic ' + Utilities.base64Encode(stripeKey_() + ':') }, muteHttpExceptions: true };
  if (form) opts.payload = form;
  const res = UrlFetchApp.fetch('https://api.stripe.com' + path, opts);
  const j = JSON.parse(res.getContentText());
  if (res.getResponseCode() >= 300) throw new Error('Stripe: ' + ((j.error && j.error.message) || res.getResponseCode()));
  return j;
}

function orderId_(v) { const id = String(v || ''); return /^o_[A-Za-z0-9_-]{6,60}$/.test(id) ? id : ''; }

/** The shop's public settings (settings/site) as a plain object. */
function site_() { const d = firestore_('get', 'settings/site'); return d ? fsFields_(d.fields || {}) : {}; }

/** The shop's price for each basket line, from live data (never from the browser). → { ok, lines, pence } or { ok:false, error } */
function lines_(o) {
  const items = Array.isArray(o.items) ? o.items : [], lines = [], events = liveEvents_();
  let pence = 0;
  for (let i = 0; i < items.length; i++) {
    const qty = Number(items[i].qty), d = qty >= 1 && qty <= 99 && Math.floor(qty) === qty ? firestore_('get', 'products/' + String(items[i].productId).replace(/[^A-Za-z0-9_-]/g, '')) : null;
    const p = d ? fsFields_(d.fields || {}) : null;
    if (!p || p.archived || !p.visible || !(Number(p.stock) >= qty)) return { ok: false, error: 'stock', item: String((p && p.name) || items[i].name || 'An item') };
    let unit = typeof p.salePrice === 'number' && p.salePrice >= 0 && p.salePrice < p.price ? p.salePrice : Number(p.price) || 0;
    const pid = String(items[i].productId);
    events.forEach(function (e) {        // owner's events: same maths as events.js in the shop, so the basket and the charge always agree
      if (e.productIds.indexOf(pid) < 0) return;
      const ev = Math.round(Math.round((Number(p.price) || 0) * 100) * (100 - e.percentOff) / 100) / 100;
      if (ev < unit) unit = ev;
    });
    const line = Math.round(unit * 100) * qty;
    pence += line;
    lines.push({ productId: pid, name: p.name, unit: p.unit || null, unitPrice: unit, qty: qty, lineTotal: line / 100, weightG: Number(p.weightG) || 0, hsCode: p.hsCode || '' });
  }
  return { ok: true, lines: lines, pence: pence };
}

/** Works out an order's price from the live shop data: items + (for shipping) the Easyship service the customer picked, re-quoted now. */
function quote_(o) {
  const st = site_();
  if (o.fulfilment === 'shipping' && st.shipping !== true) return { ok: false, error: 'no_shipping' };
  if (o.fulfilment !== 'shipping' && st.collection === false) return { ok: false, error: 'no_collection' };
  const l = lines_(o);
  if (!l.ok) return l;
  let fee = 0, ship = null;
  if (o.fulfilment === 'shipping') {
    const r = ratesFor_(o.address, o.customer, l, st);
    if (!r.ok) return { ok: false, error: r.error === 'bad_address' ? 'bad_address' : 'ship_rate' };
    const pick = r.rates.filter(function (x) { return x.id === String((o.shipping || {}).serviceId || ''); })[0];
    if (!pick) return { ok: false, error: 'ship_rate' };
    fee = Math.round(pick.price * 100); ship = { serviceId: pick.id, courier: pick.courier, service: pick.service, price: pick.price, etaMin: pick.etaMin, etaMax: pick.etaMax };
  }
  if (!l.lines.length || l.pence + fee < 30) return { ok: false, error: 'too_small' };   // Stripe's minimum is 30p
  return { ok: true, lines: l.lines.map(function (x) { return { productId: x.productId, name: x.name, unit: x.unit, unitPrice: x.unitPrice, qty: x.qty, lineTotal: x.lineTotal }; }),
    subtotal: l.pence / 100, shippingFee: fee / 100, shipping: ship, total: (l.pence + fee) / 100 };
}

/* ── shipping (Easyship) ──────────────────────────────────
   The Easyship token lives only in Script properties (EASYSHIP_TOKEN). The shop's own address comes from settings/owner (owner-only
   in Firestore), the parcel from the products' weights, and the customer's exact address from the order. */

function easyKey_() { return PropertiesService.getScriptProperties().getProperty('EASYSHIP_TOKEN') || ''; }

function easy_(method, path, payload) {
  const res = UrlFetchApp.fetch(SETTINGS.EASYSHIP + path, { method: method, contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + easyKey_() }, payload: payload ? JSON.stringify(payload) : undefined });
  let j = {}; try { j = JSON.parse(res.getContentText()); } catch (x) {}
  if (res.getResponseCode() >= 300) {
    const msg = (j.error && (j.error.message || j.error.details)) || j.message || res.getContentText().slice(0, 200);
    throw new Error('Easyship ' + res.getResponseCode() + ': ' + (typeof msg === 'string' ? msg : JSON.stringify(msg)));
  }
  return j;
}

function str_(v, n) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n); }

/** The destination, cleaned (and refused if it isn't a whole address in a country the shop ships to). */
function destination_(a, c, st) {
  a = a || {}; c = c || {};
  const d = { country_alpha2: str_(a.country, 2).toUpperCase(), line_1: str_(a.line1, 100), line_2: str_(a.line2, 80), city: str_(a.city, 60),
    state: str_(a.state, 40), postal_code: str_(a.postcode, 12), contact_name: str_(c.name, 80), contact_phone: str_(c.phone, 20), contact_email: str_(c.email, 120) };
  const allowed = String(st.shipTo || 'GB').toUpperCase().split(/[^A-Z]+/).filter(Boolean);
  if (!/^[A-Z]{2}$/.test(d.country_alpha2) || allowed.indexOf(d.country_alpha2) < 0 || !d.line_1 || !d.city || !d.postal_code || !d.contact_name || !/^\+\d{7,15}$/.test(d.contact_phone)) return null;
  return d;
}

/** → { ok, rates:[{id, courier, service, price, etaMin, etaMax}] sorted cheapest first } */
function ratesFor_(address, customer, l, st) {
  if (!easyKey_()) return { ok: false, error: 'not_set_up' };
  const dest = destination_(address, customer, st);
  if (!dest) return { ok: false, error: 'bad_address' };
  const od = firestore_('get', 'settings/owner'), from = od ? (fsFields_(od.fields || {}).shipFrom || {}) : {};
  if (!from.line1 || !from.city || !from.postcode || !from.country) return { ok: false, error: 'no_origin' };
  const parcel = parcel_(l, st, from);
  const body = { origin_address: origin_(from), destination_address: dest, output_currency: 'GBP', incoterms: 'DDU', parcels: [parcel] };
  const j = easy_('post', '/rates?per_page=50', body);
  const subtotal = l.pence / 100, freeOver = Number(st.freeShippingOver) || 0;
  const cs = function (r) { return r.courier_service || { id: r.courier_id, name: r.courier_name, umbrella_name: r.courier_name }; };   // 2024-09 nests the service; older replies are flat
  let rates = (j.rates || []).filter(function (r) { return cs(r).id && Number(r.total_charge) >= 0; }).map(function (r) {
    return { id: String(cs(r).id), courier: str_(cs(r).umbrella_name || cs(r).name, 40), service: str_(cs(r).name, 60),
      price: Math.round(Number(r.total_charge) * 100) / 100, etaMin: Number(r.min_delivery_time) || 0, etaMax: Number(r.max_delivery_time) || 0 };
  }).sort(function (x, y) { return x.price - y.price || x.etaMax - y.etaMax; }).slice(0, 8);
  if (freeOver > 0 && subtotal >= freeOver && rates.length && dest.country_alpha2 === String(from.country).toUpperCase()) rates[0].price = 0;   // free delivery: the shop pays for its cheapest option
  return rates.length ? { ok: true, rates: rates } : { ok: false, error: 'no_rates' };
}

function origin_(from) {
  return { country_alpha2: str_(from.country, 2).toUpperCase(), line_1: str_(from.line1, 100), line_2: str_(from.line2, 80), city: str_(from.city, 60), state: str_(from.state, 40),
    postal_code: str_(from.postcode, 12), company_name: str_(from.company, 80), contact_name: str_(from.name, 80), contact_phone: str_(from.phone, 20), contact_email: str_(from.email, 120) };
}

/** One parcel: the products' weights added up (+ packaging) in a box of the owner's usual size. */
function parcel_(l, st, from) {
  const def = Number(st.defaultWeightG) || 300, pack = Number(st.packagingG) || 100;
  let g = pack;
  const items = l.lines.map(function (x) {
    const w = x.weightG > 0 ? x.weightG : def;
    g += w * x.qty;
    const it = { description: str_(x.name, 100), category: str_(st.shipCategory || 'home_appliances', 40), sku: str_(x.productId, 40), quantity: x.qty, actual_weight: Math.round(w) / 1000,
      declared_currency: 'GBP', declared_customs_value: x.unitPrice, origin_country_alpha2: str_(from.country, 2).toUpperCase() };
    if (x.hsCode) it.hs_code = str_(x.hsCode, 12);
    return it;
  });
  return { total_actual_weight: Math.round(g) / 1000, box: { length: Number(st.boxL) || 25, width: Number(st.boxW) || 20, height: Number(st.boxH) || 12 }, items: items };
}

function rates_(b) {
  const u = user_(b.idToken);
  if (!u) return { ok: false, error: 'auth' };
  const c = CacheService.getScriptCache(), k = 'r_' + u.uid, n = Number(c.get(k) || 0);
  if (n >= SETTINGS.RATES_PER_HOUR) return { ok: false, error: 'limit' };
  c.put(k, String(n + 1), 3600);
  const st = site_();
  if (st.shipping !== true) return { ok: false, error: 'no_shipping' };
  const l = lines_({ items: b.items });
  if (!l.ok) return l;
  const r = ratesFor_(b.address, b.customer, l, st);
  return r.ok ? { ok: true, rates: r.rates, subtotal: l.pence / 100 } : r;
}

/** After payment: create the shipment in Easyship so the owner only has to buy the label there. Never fails the order. */
function createShipment_(id, o) {
  try {
    const st = site_(), sel = (o.shipping || {}).serviceId;
    const od = firestore_('get', 'settings/owner'), from = od ? (fsFields_(od.fields || {}).shipFrom || {}) : {};
    const dest = destination_(o.address, o.customer, st);
    if (!dest || !from.line1) throw new Error('missing address');
    const lines = (Array.isArray(o.lines) ? o.lines : []).map(function (x) {        // the order's own priced lines + each product's weight
      const d = firestore_('get', 'products/' + x.productId), p = d ? fsFields_(d.fields || {}) : {};
      return { productId: x.productId, name: x.name, unitPrice: x.unitPrice, qty: x.qty, weightG: Number(p.weightG) || 0, hsCode: p.hsCode || '' };
    });
    const j = easy_('post', '/shipments', {
      origin_address: origin_(from), destination_address: dest, incoterms: 'DDU', parcels: [parcel_({ lines: lines, pence: 0 }, st, from)],
      courier_settings: { courier_service_id: sel }, shipping_settings: { buy_label: false }, order_data: { platform_order_number: String(o.ref || id) },
    });
    const s = j.shipment || j;
    firestore_('patch', 'orders/' + id, { shipment: fsEnc_({ easyshipId: str_(s.easyship_shipment_id || s.id, 60), trackingUrl: str_(s.tracking_page_url, 300), labelState: str_(s.label_state, 30) }) });
    return true;
  } catch (err) {
    console.error(err);
    mail_(SETTINGS.OWNER_EMAIL, 'Create the Easyship shipment for order ' + o.ref, 'The shipment could not be created automatically (' + String(err.message).slice(0, 300) + ').\n\nPlease create it by hand at app.easyship.com using the order details in the shop (Manage > the order).');
    return false;
  }
}

/** Events the owner has switched on and whose dates include today (UK time). */
function liveEvents_() {
  const res = UrlFetchApp.fetch('https://firestore.googleapis.com/v1/projects/' + SETTINGS.PROJECT_ID + '/databases/(default)/documents:runQuery', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + accessToken_() },
    payload: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'events' }], limit: 50,
      where: { fieldFilter: { field: { fieldPath: 'active' }, op: 'EQUAL', value: { booleanValue: true } } } } }),
  });
  if (res.getResponseCode() >= 300) throw new Error('Firestore events ' + res.getResponseCode());
  const today = Utilities.formatDate(new Date(), 'Europe/London', 'yyyy-MM-dd');
  return JSON.parse(res.getContentText()).filter(function (r) { return r.document; }).map(function (r) { return fsFields_(r.document.fields || {}); })
    .filter(function (e) {
      return Array.isArray(e.productIds) && Number(e.percentOff) > 0 && Number(e.percentOff) <= 90 &&
        (!e.startsAt || e.startsAt <= today) && (!e.endsAt || e.endsAt >= today);
    });
}

function pay_(b) {
  if (!stripeKey_()) return { ok: false, error: 'not_set_up' };
  const u = user_(b.idToken), id = orderId_(b.orderId);
  if (!u || !id) return { ok: false, error: 'auth' };
  const o = order_(id);
  if (!o || o.uid !== u.uid) return { ok: false, error: 'not_found' };
  if (o.paymentStatus === 'paid') return { ok: false, error: 'already_paid' };
  if (o.status === 'new') {            // checkout: price it now, from the shop's own data
    const q = quote_(o);
    if (!q.ok) return q;
    firestore_('patch', 'orders/' + id, {
      lines: fsEnc_(q.lines), subtotal: fsEnc_(q.subtotal), shippingFee: fsEnc_(q.shippingFee), total: fsEnc_(q.total),
      updatedAt: { timestampValue: new Date().toISOString() },
    });
    if (q.shipping) firestore_('patch', 'orders/' + id, { shipping: fsEnc_(q.shipping) });
    o.total = q.total;
  } else if (['confirmed', 'preparing', 'ready'].indexOf(o.status) < 0 || !(Number(o.total) > 0)) return { ok: false, error: 'not_ready' };
  const form = {
    mode: 'payment', client_reference_id: id,
    success_url: SETTINGS.SITE_URL + '?paid=' + id + '&sid={CHECKOUT_SESSION_ID}',
    cancel_url: SETTINGS.SITE_URL + '?paycancel=1',
    'adaptive_pricing[enabled]': 'false',                  // UK shop: always charge in £, never offer a converted currency
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'gbp',
    'line_items[0][price_data][unit_amount]': String(Math.round(Number(o.total) * 100)),
    'line_items[0][price_data][product_data][name]': SETTINGS.STORE_NAME + ' order ' + String(o.ref || ''),
    'metadata[order_id]': id, 'payment_intent_data[description]': SETTINGS.STORE_NAME + ' order ' + String(o.ref || ''),
  };
  if (u.email) form.customer_email = u.email;
  return { ok: true, url: stripe_('post', '/v1/checkout/sessions', form).url };
}

function paid_(b) {
  if (!stripeKey_()) return { ok: false, error: 'not_set_up' };
  const u = user_(b.idToken), id = orderId_(b.orderId), sid = String(b.sid || '');
  if (!u || !id || !/^cs_(test|live)_[A-Za-z0-9]+$/.test(sid)) return { ok: false, error: 'auth' };
  const o = order_(id);
  if (!o || o.uid !== u.uid) return { ok: false, error: 'not_found' };
  if (o.paymentStatus === 'paid') return { ok: true, already: true };
  const s = stripe_('get', '/v1/checkout/sessions/' + sid);
  if (s.payment_status !== 'paid' || s.client_reference_id !== id || s.currency !== 'gbp' || s.amount_total !== Math.round(Number(o.total) * 100)) {
    return { ok: false, error: 'not_paid' };
  }
  const now = new Date().toISOString(), fresh = o.status === 'new';
  const f = {
    paymentStatus: { stringValue: 'paid' }, paymentMethod: { stringValue: 'card' }, stripeSession: { stringValue: sid },
    paidAt: { timestampValue: now }, updatedAt: { timestampValue: now },
  };
  if (fresh) f.status = { stringValue: 'confirmed' };       // paid at checkout = confirmed, no waiting for the owner
  firestore_('patch', 'orders/' + id, f);
  if (fresh) {
    (Array.isArray(o.lines) ? o.lines : []).forEach(function (l) {      // take the stock (never below 0)
      try {
        const d = firestore_('get', 'products/' + l.productId);
        if (d) firestore_('patch', 'products/' + l.productId, { stock: fsEnc_(Math.max(0, Number(fsFields_(d.fields || {}).stock) - l.qty)), updatedAt: { timestampValue: now } });
      } catch (err) { console.error(err); }
    });
    if (o.fulfilment === 'shipping') createShipment_(id, o);
    mailPaid_(o);
  }
  return { ok: true };
}

/* ── emails about an order ── */

function mail_(to, subject, text) {
  if (!to || dayCount_() >= SETTINGS.SENDS_PER_DAY) return false;
  try {
    MailApp.sendEmail({ to: to, name: SETTINGS.STORE_NAME, subject: subject, body: text + '\n\n' + SETTINGS.STORE_NAME + ' · ' + SETTINGS.SITE_URL });
    bumpDay_(); return true;
  } catch (err) { console.error(err); return false; }
}

function mailPaid_(o) {
  const ship = o.fulfilment === 'shipping', how = ship ? 'SHIPPING' : 'PICK-UP', c = o.customer || {}, a = o.address, sh = o.shipping || {};
  const items = (o.lines || []).map(function (l) { return '  ' + l.qty + ' x ' + l.name; }).join('\n');
  mail_(SETTINGS.OWNER_EMAIL, 'New paid order ' + o.ref + ' (' + how + ', £' + Number(o.total).toFixed(2) + ')',
    'Someone just paid for an order.\n\n' + items + '\n\nTotal paid: £' + Number(o.total).toFixed(2) + '\n' + how + (ship ? ' with ' + (sh.courier || '') + ' ' + (sh.service || '') : '') + '\nName: ' + (c.name || '') + '\nPhone: ' + (c.phone || '-') +
    (a ? '\nShip to: ' + [a.line1, a.line2, a.city, a.state, a.postcode, a.country].filter(Boolean).join(', ') : '') + (o.note ? '\nNote: ' + o.note : '') +
    (ship ? '\n\nThe shipment is created in Easyship. Open app.easyship.com, pay for the label and print it, then press Shipped on the order in the shop.' : '\n\nOpen the shop, tap Manage, and press the big button on the order.'));
  mail_(c.email, 'We got your order ' + o.ref,
    'Thank you! Your payment of £' + Number(o.total).toFixed(2) + ' went through and your order ' + o.ref + ' is confirmed.\n\n' + items +
    '\n\nWe will email you when it is ' + (ship ? 'shipped, with a tracking link.' : 'ready to collect.'));
}

const STAGE_MAIL = {
  shipped: ['has shipped', 'Your order is on its way with the courier.'],
  ready: ['is ready to collect', 'Your order is ready. Come and pick it up from the shop whenever you like.'],
};

/** Owner only. The order's CURRENT step decides the email, so this can't be used to send anything else. */
function stage_(b) {
  if (!ownerOf_(String(b.idToken || ''))) return { ok: false, error: 'not_owner' };
  const id = orderId_(b.orderId), o = id ? order_(id) : null;
  if (!o || !STAGE_MAIL[o.status]) return { ok: false, error: 'bad_request' };
  const m = STAGE_MAIL[o.status], to = o.customer && o.customer.email, t = o.shipment && o.shipment.trackingUrl;
  if (!to) return { ok: true, sent: 0 };
  return { ok: true, sent: mail_(to, 'Your order ' + o.ref + ' ' + m[0], m[1] + (o.status === 'shipped' && t ? '\n\nTrack your parcel: ' + t : '') + '\n\nOrder ' + o.ref) ? 1 : 0 };
}

/* Firestore over REST, signed in as the service account (so the security rules don't apply to this script) */

function accessToken_() {
  const cache = CacheService.getScriptCache(), hit = cache.get('fs_token');
  if (hit) return hit;
  const p = PropertiesService.getScriptProperties();
  const clientEmail = p.getProperty('FB_CLIENT_EMAIL');
  // forgiving about how the key was pasted (with or without the BEGIN/END lines, real or typed-out line breaks)
  const body = (p.getProperty('FB_PRIVATE_KEY') || '').replace(/\\n/g, '').replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  const privateKey = '-----BEGIN PRIVATE KEY-----\n' + (body.match(/.{1,64}/g) || []).join('\n') + '\n-----END PRIVATE KEY-----\n';
  const now = Math.floor(Date.now() / 1000);
  const input = b64u_(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' + b64u_(JSON.stringify({
    iss: clientEmail, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3300 }));
  const jwt = input + '.' + Utilities.base64EncodeWebSafe(Utilities.computeRsaSha256Signature(input, privateKey)).replace(/=+$/, '');
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', { method: 'post', muteHttpExceptions: true,
    payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt } });
  const j = JSON.parse(res.getContentText());
  if (!j.access_token) throw new Error('Google token: ' + (j.error_description || j.error || res.getResponseCode()));
  cache.put('fs_token', j.access_token, 3000);
  return j.access_token;
}

function firestore_(method, path, fields) {
  let url = 'https://firestore.googleapis.com/v1/projects/' + SETTINGS.PROJECT_ID + '/databases/(default)/documents/' + path;
  const opts = { method: method, headers: { Authorization: 'Bearer ' + accessToken_() }, muteHttpExceptions: true };
  if (fields) {
    url += '?currentDocument.exists=true&' + Object.keys(fields).map(function (k) { return 'updateMask.fieldPaths=' + k; }).join('&');
    opts.contentType = 'application/json'; opts.payload = JSON.stringify({ fields: fields });
  }
  const res = UrlFetchApp.fetch(url, opts);
  if (res.getResponseCode() === 404) return null;
  if (res.getResponseCode() >= 300) throw new Error('Firestore ' + res.getResponseCode());
  return JSON.parse(res.getContentText());
}

function fsValue_(v) {
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.timestampValue !== undefined) return v.timestampValue;
  if (v.mapValue) return fsFields_(v.mapValue.fields || {});
  if (v.arrayValue) return (v.arrayValue.values || []).map(fsValue_);
  return null;
}
function fsEnc_(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Math.floor(v) === v ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(fsEnc_) } };
  const f = {}; Object.keys(v).forEach(function (k) { f[k] = fsEnc_(v[k]); });
  return { mapValue: { fields: f } };
}
function fsFields_(f) { const o = {}; Object.keys(f).forEach(function (k) { o[k] = fsValue_(f[k]); }); return o; }
function order_(id) { const d = firestore_('get', 'orders/' + id); return d ? fsFields_(d.fields || {}) : null; }

/* ── helpers ──────────────────────────────────────────── */

function b64u_(s) { return Utilities.base64EncodeWebSafe(s, Utilities.Charset.UTF_8).replace(/=+$/, ''); }
function getJson_(cache, k) { const v = cache.get(k); return v ? JSON.parse(v) : null; }
function out_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

function dayKey_() { return 'day_' + Utilities.formatDate(new Date(), 'UTC', 'yyyyMMdd'); }
function dayCount_() { return Number(PropertiesService.getScriptProperties().getProperty(dayKey_()) || 0); }
function bumpDay_() {
  const p = PropertiesService.getScriptProperties(), k = dayKey_();
  p.setProperty(k, String(dayCount_() + 1));
  p.getKeys().forEach(function (x) { if (x.indexOf('day_') === 0 && x !== k) p.deleteProperty(x); });
}

/**
 * Run this once from the editor (Run > checkSetup). It asks Google for permission to send email and checks the
 * Firebase key, then the Easyship token. Look for "Setup OK" in the log.
 */
function checkSetup() {
  Logger.log('Emails you can still send today: ' + MailApp.getRemainingDailyQuota());
  Logger.log('Firestore access: ' + (firestore_('get', 'settings/site') ? 'OK' : 'site settings not found yet'));
  Logger.log('Stripe key: ' + (stripeKey_() ? 'set' : 'MISSING (card payments off)'));
  Logger.log('Easyship token: ' + (easyKey_() ? 'set' : 'MISSING (shipping off)'));
  Logger.log('Setup OK');
}
