/* In-page fake of Firebase (App + Auth + Firestore) for end-to-end tests.
   State lives in localStorage so reloads and a second tab behave like the real thing.
   It also replays the important parts of firestore.rules in JS, so a client/rules mismatch fails a test. */
(() => {
  if (window.__FAKE) return;
  const DB = "fake.db", AUTH = "fake.auth", SESSION = "fake.session";
  const rd = (s, k, d) => { try { return JSON.parse(s.getItem(k)) ?? d; } catch { return d; } };
  const wr = (s, k, v) => s.setItem(k, JSON.stringify(v));
  class Timestamp { constructor(ms) { this.ms = ms; } toMillis() { return this.ms; } toDate() { return new Date(this.ms); } }
  const SV = { __sv: true };
  const F = { Timestamp, mails: [], offset: 0, nextGoogle: { email: "gina@gmail.com", name: "Gina Test" }, popupClosed: false,
    failBefore: null, failAfter: null, log: [] };
  const now = () => Date.now() + F.offset;
  F.advance = ms => { F.offset += ms; };
  const err = (code, msg = code) => Object.assign(new Error(msg), { code });

  /* ── storage ─────────────────────────────────────── */
  const db = () => rd(localStorage, DB, {});
  const putDb = d => wr(localStorage, DB, d);
  const dec = v => v && typeof v === "object" && !Array.isArray(v)
    ? ("__ts" in v ? new Timestamp(v.__ts) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, dec(x)])))
    : Array.isArray(v) ? v.map(dec) : v;
  const enc = (v, t) => v === SV ? { __ts: t } : v instanceof Timestamp ? { __ts: v.ms }
    : Array.isArray(v) ? v.map(x => enc(x, t))
    : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, enc(x, t)])) : v;
  F.seed = (obj, accounts) => { putDb(obj); if (accounts) wr(localStorage, AUTH, accounts); };
  F.dump = () => db();
  F.inject = (col, id, data) => { const d = db(); (d[col] = d[col] || {})[id] = data; putDb(d); notify(); };

  /* ── auth ────────────────────────────────────────── */
  const accounts = () => rd(localStorage, AUTH, {});
  const putAccounts = a => wr(localStorage, AUTH, a);
  let persist = "local";
  const sessionStore = () => (persist === "local" ? localStorage : sessionStorage);
  const authListeners = new Set();
  class User {
    constructor(email) { this.email = email; }
    get _a() { return accounts()[this.email] || {}; }
    get uid() { return this._a.uid; } get emailVerified() { return !!this._a.verified; }
    get displayName() { return this._a.displayName || null; }
    async reload() {} async getIdToken() { return "tok"; }
  }
  const auth = { currentUser: null };
  const sessionEmail = () => rd(localStorage, SESSION, null) || rd(sessionStorage, SESSION, null);
  const refreshUser = () => { const e = sessionEmail(); auth.currentUser = e && accounts()[e] ? new User(e) : null; };
  const emitAuth = () => { refreshUser(); for (const l of [...authListeners]) l(auth.currentUser); };
  const signInAs = email => { localStorage.removeItem(SESSION); sessionStorage.removeItem(SESSION); wr(sessionStore(), SESSION, email); emitAuth(); return auth.currentUser; };
  F.verifyEmail = email => { const a = accounts(); a[email].verified = true; putAccounts(a); };
  F.signedInUid = () => auth.currentUser && auth.currentUser.uid;
  F.auth = {
    getAuth: () => auth,
    onAuthStateChanged: (a, cb) => { authListeners.add(cb); refreshUser(); setTimeout(() => cb(auth.currentUser), 0); return () => authListeners.delete(cb); },
    setPersistence: async (a, mode) => { persist = mode; },
    browserLocalPersistence: "local", browserSessionPersistence: "session",
    createUserWithEmailAndPassword: async (a, email, pw) => {
      email = email.toLowerCase();
      if (accounts()[email]) throw err("auth/email-already-in-use");
      if (pw.length < 6) throw err("auth/weak-password");
      const acc = accounts(); acc[email] = { uid: "u_" + Math.random().toString(36).slice(2, 10), password: pw, verified: false }; putAccounts(acc);
      return { user: signInAs(email) };
    },
    signInWithEmailAndPassword: async (a, email, pw) => {
      email = email.toLowerCase(); const acc = accounts()[email];
      if (!acc || acc.password !== pw) throw err("auth/invalid-credential");
      return { user: signInAs(email) };
    },
    signInWithPopup: async () => {
      if (F.popupClosed) throw err("auth/popup-closed-by-user");
      const g = F.nextGoogle, acc = accounts();
      acc[g.email] = acc[g.email] || { uid: g.uid || "g_" + g.email.split("@")[0], verified: true, displayName: g.name };
      putAccounts(acc);
      return { user: signInAs(g.email) };
    },
    GoogleAuthProvider: class { setCustomParameters() {} },
    sendEmailVerification: async u => { F.mails.push({ type: "verify", to: u.email }); },
    sendPasswordResetEmail: async (a, email) => { F.mails.push({ type: "reset", to: email }); },
    updateProfile: async (u, p) => { const acc = accounts(); Object.assign(acc[u.email], p); putAccounts(acc); },
    signOut: async () => { localStorage.removeItem(SESSION); sessionStorage.removeItem(SESSION); emitAuth(); },
  };

  /* ── firestore: refs, queries ────────────────────── */
  const rid = () => "id" + Math.random().toString(36).slice(2, 12);
  const col = (_, name) => ({ type: "col", name });
  const docRef = (a, ...seg) => {
    if (a && a.type === "col" && !seg.length) return { type: "doc", col: a.name, id: rid() };
    if (a && a.type === "col") return { type: "doc", col: a.name, id: seg[0] };
    return { type: "doc", col: seg[0], id: seg[1] };
  };
  const query = (c, ...cs) => ({ type: "query", col: c.name, where: cs.filter(x => x.k === "where"), order: cs.find(x => x.k === "order"), limit: cs.find(x => x.k === "limit")?.n });
  const where = (f, op, v) => ({ k: "where", f, op, v });
  const orderBy = (f, dir = "asc") => ({ k: "order", f, dir });
  const limit = n => ({ k: "limit", n });
  const key = v => JSON.stringify(v);
  const who = () => { const u = auth.currentUser; return u ? { uid: u.uid, verified: u.emailVerified, owner: !!(db().owners || {})[u.uid] } : { uid: null, verified: false, owner: false }; };

  const mkDoc = (c, id, d) => ({ id, ref: { type: "doc", col: c, id }, data: () => dec(d), exists: () => true, metadata: { fromCache: false, hasPendingWrites: false } });
  const mkMissing = (c, id) => ({ id, ref: { type: "doc", col: c, id }, data: () => undefined, exists: () => false, metadata: { fromCache: false, hasPendingWrites: false } });

  function readAllowed(c, id, d) {
    const w = who();
    if (c === "owners") return w.uid === id;
    if (c === "users") return w.uid === id;
    if (c === "orders") return w.owner || (w.uid && d && d.uid === w.uid);
    if (c === "feedback" || c === "productPrivate") return w.owner;
    return true;
  }
  function runQuery(q) {
    const w = who();
    if (["orders", "feedback"].includes(q.col) && !w.owner) throw err("permission-denied", "query on " + q.col);
    if (q.col === "products" && !w.owner && !(q.where.some(x => x.f === "visible" && x.v === true) && q.where.some(x => x.f === "archived" && x.v === false))) throw err("permission-denied", "unfiltered products query");
    if (q.col === "categories" && !w.owner && !q.where.some(x => x.f === "visible" && x.v === true)) throw err("permission-denied", "unfiltered categories query");
    let rows = Object.entries(db()[q.col] || {}).map(([id, d]) => ({ id, d }));
    for (const c of q.where) rows = rows.filter(r => c.op === "==" ? key(r.d[c.f]) === key(c.v) : true);
    if (q.order) rows.sort((a, b) => {
      const av = a.d[q.order.f]?.__ts ?? a.d[q.order.f], bv = b.d[q.order.f]?.__ts ?? b.d[q.order.f];
      return (av > bv ? 1 : av < bv ? -1 : 0) * (q.order.dir === "desc" ? -1 : 1);
    });
    if (q.limit) rows = rows.slice(0, q.limit);
    return rows;
  }

  /* ── rules replica (the parts that matter to the client) ── */
  const isStr = (v, max) => typeof v === "string" && v.length <= max;
  const optStr = (d, k, max) => !(k in d) || d[k] == null || isStr(d[k], max);
  const hasOnly = (d, keys) => Object.keys(d).every(k => keys.includes(k));
  const hasAll = (d, keys) => keys.every(k => k in d);
  const isNum = v => typeof v === "number" && Number.isFinite(v);
  const validAddress = a => a == null || (typeof a === "object" && hasOnly(a, ["line1", "line2", "city", "postcode", "lat", "lng", "verified"])
    && ["line1", "line2"].every(k => isStr(a[k] ?? "", 120)) && isStr(a.city ?? "", 60) && isStr(a.postcode ?? "", 12)
    && (a.lat == null || isNum(a.lat)) && (a.lng == null || isNum(a.lng)) && (a.verified == null || typeof a.verified === "boolean"));
  const throttle = (before, after, k, secs, t) => {
    if (before && k in before && !(k in after)) return false;
    if (!(k in after)) return true;
    if (before && k in before && key(before[k]) === key(after[k])) return true;
    return after[k] === SV && (!before || !(k in before) || before[k].__ts < t - secs * 1000);
  };
  const deny = (m) => { throw err("permission-denied", "rules: " + m); };

  function checkWrite(op, c, id, raw, before, afterDb, t) {
    const w = who();
    const isSV = v => v === SV;
    if (c === "owners") deny("owners are console-only");
    if (c === "users") {
      if (w.uid !== id) deny("users: not yours");
      if (op === "delete") deny("users: no delete");
      if (!hasOnly(raw, ["name", "phone", "address", "lastOrderAt", "lastFeedbackAt", "updatedAt"])) deny("users: keys " + Object.keys(raw));
      if (!optStr(raw, "name", 80) || !optStr(raw, "phone", 20) || ("address" in raw && !validAddress(raw.address))) deny("users: values");
      if (!isSV(raw.updatedAt)) deny("users: updatedAt");
      if (!throttle(before, raw, "lastOrderAt", 30, t) || !throttle(before, raw, "lastFeedbackAt", 60, t)) deny("users: throttled");
      return;
    }
    if (c === "orders") {
      if (op === "create") {
        const d = raw;
        if (!w.verified) deny("orders: not verified");
        if (!hasOnly(d, ["uid", "ref", "requestId", "status", "paymentStatus", "isTest", "fulfilment", "items", "customer", "address", "note", "estTotal", "createdAt", "updatedAt"])) deny("orders: keys " + Object.keys(d));
        if (!hasAll(d, ["uid", "ref", "requestId", "status", "paymentStatus", "isTest", "fulfilment", "items", "customer", "note", "createdAt", "updatedAt"])) deny("orders: missing keys");
        if (d.uid !== w.uid) deny("orders: uid");
        if (!/^[A-Za-z0-9-]{8,64}$/.test(d.requestId) || id !== "o_" + d.requestId) deny("orders: id");
        if (!/^PS-[A-Z0-9]{6}$/.test(d.ref)) deny("orders: ref");
        if (d.status !== "new" || d.paymentStatus !== "mock" || d.isTest !== true) deny("orders: status");
        if (!["collection", "delivery"].includes(d.fulfilment)) deny("orders: fulfilment");
        if (!Array.isArray(d.items) || d.items.length < 1 || d.items.length > 50) deny("orders: items");
        const cu = d.customer;
        if (!cu || !hasOnly(cu, ["name", "phone", "email"]) || !isStr(cu.name, 80) || cu.name.length < 2 || !isStr(cu.phone, 20) || !isStr(cu.email, 120)) deny("orders: customer");
        if (d.fulfilment === "delivery") {
          if (!d.address || !validAddress(d.address) || !(d.address.line1 || "").length || !(d.address.city || "").length || (d.address.postcode || "").length < 5 || cu.phone.length < 7) deny("orders: delivery address/phone");
        } else if (d.address != null) deny("orders: collection with address");
        if (!isStr(d.note, 500)) deny("orders: note");
        if ("estTotal" in d && !(isNum(d.estTotal) && d.estTotal >= 0)) deny("orders: estTotal");
        if (!isSV(d.createdAt) || !isSV(d.updatedAt)) deny("orders: timestamps");
        const u = afterDb.users && afterDb.users[w.uid];
        if (!u || !u.lastOrderAt || u.lastOrderAt.__ts !== t) deny("orders: rate-limit stamp missing");
        return;
      }
      if (!w.owner) deny("orders: owner only");
      if (op === "update") {
        const changed = Object.keys(raw).filter(k => key(enc(raw[k], t)) !== key(before[k]));
        if (!changed.every(k => ["status", "paymentStatus", "lines", "subtotal", "deliveryFee", "total", "updatedAt"].includes(k))) deny("orders: owner changed " + changed);
        if (before.status === "cancelled") deny("orders: cancelled is final");
        if (!["new", "confirmed", "preparing", "ready", "completed", "cancelled"].includes(raw.status)) deny("orders: status value");
        if (raw.paymentStatus !== before.paymentStatus && before.isTest !== false) deny("orders: test payment stays mock");
        if (!isSV(raw.updatedAt)) deny("orders: updatedAt");
        return;
      }
      if (op === "delete" && !(before.isTest === true && before.status === "cancelled")) deny("orders: delete");
      return;
    }
    if (c === "feedback") {
      if (op === "create") {
        const d = raw;
        if (!w.verified) deny("feedback: not verified");
        if (!hasOnly(d, ["uid", "kind", "message", "rating", "name", "orderRef", "read", "archived", "createdAt"]) || !hasAll(d, ["uid", "kind", "message", "read", "archived", "createdAt"])) deny("feedback: keys " + Object.keys(d));
        if (d.uid !== w.uid || !["feedback", "bug", "question"].includes(d.kind)) deny("feedback: uid/kind");
        if (!isStr(d.message, 1000) || d.message.length < 10) deny("feedback: message");
        if (d.rating != null && !(Number.isInteger(d.rating) && d.rating >= 1 && d.rating <= 5)) deny("feedback: rating");
        if (!optStr(d, "name", 60) || !optStr(d, "orderRef", 9)) deny("feedback: strings");
        if (d.read !== false || d.archived !== false || !isSV(d.createdAt)) deny("feedback: flags");
        const u = afterDb.users && afterDb.users[w.uid];
        if (!u || !u.lastFeedbackAt || u.lastFeedbackAt.__ts !== t) deny("feedback: rate-limit stamp missing");
        return;
      }
      if (!w.owner) deny("feedback: owner only");
      if (op === "update") {
        const changed = Object.keys(raw).filter(k => key(enc(raw[k], t)) !== key(before[k]));
        if (!changed.every(k => ["read", "archived"].includes(k))) deny("feedback: owner changed " + changed);
      }
      return;
    }
    // owner-managed collections
    if (!w.owner) deny(c + ": owner only");
    if (c === "products" && op !== "delete") {
      const d = raw;
      if (!hasOnly(d, ["name", "price", "stock", "categoryId", "image", "imagePath", "description", "unit", "visible", "archived", "featured", "sortOrder", "lowStockThreshold", "createdAt", "updatedAt"])) deny("products: keys " + Object.keys(d));
      if (!hasAll(d, ["name", "price", "stock", "visible", "archived", "updatedAt"])) deny("products: missing");
      if (!isStr(d.name, 120) || !d.name.length || !isNum(d.price) || d.price < 0 || !Number.isInteger(d.stock) || d.stock < 0 || typeof d.visible !== "boolean" || typeof d.archived !== "boolean") deny("products: values");
      if (!optStr(d, "image", 60000) || !optStr(d, "description", 2000) || !optStr(d, "unit", 30)) deny("products: strings");
      if (!isSV(d.updatedAt)) deny("products: updatedAt");
      if (op === "create" ? !isSV(d.createdAt) : key(enc(d.createdAt, t)) !== key(before.createdAt)) deny("products: createdAt");
    }
    if (c === "categories" && op !== "delete") {
      const d = raw;
      if (!hasOnly(d, ["name", "description", "image", "imagePath", "sortOrder", "visible", "createdAt", "updatedAt"]) || !hasAll(d, ["name", "visible", "sortOrder", "updatedAt"])) deny("categories: keys");
      if (!isStr(d.name, 60) || !d.name.length || typeof d.visible !== "boolean" || !Number.isInteger(d.sortOrder)) deny("categories: values");
    }
    if (c === "settings" && id === "site") {
      if (!hasOnly(raw, ["storeName", "heroTitle", "heroSubtitle", "announcement", "whatsapp", "collection", "delivery", "deliveryFee", "collectionNote", "deliveryNote", "currency", "updatedAt"])) deny("settings: keys " + Object.keys(raw));
      if ("deliveryFee" in raw && !(isNum(raw.deliveryFee) && raw.deliveryFee >= 0 && raw.deliveryFee <= 1000)) deny("settings: fee");
    }
  }

  /* ── commit pipeline (batch / transaction / single writes) ── */
  const listeners = new Set();
  const notify = () => { for (const l of [...listeners]) l(); };
  function commit(writes) {
    if (F.failBefore) { const e = F.failBefore; F.failBefore = null; throw err(e); }
    const t = now();
    const before = db(), after = JSON.parse(JSON.stringify(before));
    const planned = [];
    for (const w of writes) {
      const prev = (after[w.col] || {})[w.id];
      let raw;
      if (w.op === "delete") raw = null;
      else if (w.op === "set") raw = w.merge && prev ? { ...prev, ...w.data } : w.data;
      else { if (!prev) throw err("not-found", "update on missing doc " + w.col + "/" + w.id); raw = { ...prev, ...w.data }; }
      const op = w.op === "delete" ? "delete" : prev ? "update" : "create";
      planned.push({ w, raw, op, prev });
      after[w.col] = after[w.col] || {};
      if (op === "delete") delete after[w.col][w.id]; else after[w.col][w.id] = enc(raw, t);
    }
    for (const p of planned) checkWrite(p.op, p.w.col, p.w.id, p.raw, p.prev, after, t);   // all-or-nothing
    putDb(after);
    F.log.push(...planned.map(p => `${p.op} ${p.w.col}/${p.w.id}`));
    notify();
    if (F.failAfter) { const e = F.failAfter; F.failAfter = null; throw err(e); }
  }
  const dec2raw = d => d && typeof d === "object" && !Array.isArray(d) ? ("__ts" in d ? new Timestamp(d.__ts) : Object.fromEntries(Object.entries(d).map(([k, v]) => [k, dec2raw(v)]))) : Array.isArray(d) ? d.map(dec2raw) : d;

  const getDocSnap = ref => {
    const d = (db()[ref.col] || {})[ref.id];
    if (!readAllowed(ref.col, ref.id, d)) throw err("permission-denied", "read " + ref.col);
    return d ? mkDoc(ref.col, ref.id, d) : mkMissing(ref.col, ref.id);
  };

  F.fs = {
    getFirestore: () => ({}), collection: col, doc: docRef, query, where, orderBy, limit,
    serverTimestamp: () => SV, Timestamp,
    getDoc: async ref => getDocSnap(ref),
    setDoc: async (ref, data, opts) => commit([{ op: "set", col: ref.col, id: ref.id, data, merge: !!(opts && opts.merge) }]),
    updateDoc: async (ref, data) => commit([{ op: "update", col: ref.col, id: ref.id, data }]),
    deleteDoc: async ref => commit([{ op: "delete", col: ref.col, id: ref.id }]),
    writeBatch: () => { const w = []; return {
      set(ref, data, opts) { w.push({ op: "set", col: ref.col, id: ref.id, data, merge: !!(opts && opts.merge) }); return this; },
      update(ref, data) { w.push({ op: "update", col: ref.col, id: ref.id, data }); return this; },
      delete(ref) { w.push({ op: "delete", col: ref.col, id: ref.id }); return this; },
      commit: async () => commit(w) }; },
    runTransaction: async (_, fn) => {
      const w = [];
      const tx = {
        get: async ref => getDocSnap(ref),
        set(ref, data) { w.push({ op: "set", col: ref.col, id: ref.id, data }); return tx; },
        update(ref, data) { w.push({ op: "update", col: ref.col, id: ref.id, data }); return tx; },
        delete(ref) { w.push({ op: "delete", col: ref.col, id: ref.id }); return tx; },
      };
      const out = await fn(tx);
      commit(w);
      return out;
    },
    onSnapshot: (target, a, b, c) => {
      const next = typeof a === "function" ? a : b, onErr = typeof a === "function" ? b : c;
      let prev = null, dead = false;
      if (target.type === "col") target = query(target);
      const fire = () => {
        if (dead) return;
        try {
          if (target.type === "doc") {
            const snap = getDocSnap(target); const sig = key(snap.exists() ? (db()[target.col] || {})[target.id] : null);
            if (sig !== prev) { prev = sig; next(snap); }
            return;
          }
          const rows = runQuery(target);
          const map = Object.fromEntries(rows.map(r => [r.id, key(r.d)]));
          const sig = key(rows.map(r => [r.id, map[r.id]]));
          if (sig === prev) return;
          const old = prev ? Object.fromEntries(JSON.parse(prev)) : {};
          const changes = [];
          for (const r of rows) {
            if (!(r.id in old)) changes.push({ type: "added", doc: mkDoc(target.col, r.id, r.d) });
            else if (old[r.id] !== map[r.id]) changes.push({ type: "modified", doc: mkDoc(target.col, r.id, r.d) });
          }
          for (const id of Object.keys(old)) if (!(id in map)) changes.push({ type: "removed", doc: mkMissing(target.col, id) });
          prev = sig;
          const docs = rows.map(r => mkDoc(target.col, r.id, r.d));
          next({ docs, size: docs.length, empty: !docs.length, metadata: { fromCache: false, hasPendingWrites: false }, docChanges: () => changes });
        } catch (e) { if (onErr) onErr(e); else console.error(e); dead = true; }
      };
      listeners.add(fire);
      setTimeout(fire, 0);
      return () => { dead = true; listeners.delete(fire); };
    },
  };
  addEventListener("storage", e => { if (e.key === DB) notify(); if (e.key === AUTH || e.key === SESSION) emitAuth(); });
  F.app = { initializeApp: cfg => ({ cfg }) };
  window.__FAKE = F;
})();
