/** Tiny in-memory Firestore stand-in: enough for placeOrder's transaction logic. */
class Snap {
  constructor(ref, data) { this.ref = ref; this.id = ref.id; this.exists = data !== undefined; this._d = data; }
  data() { return this._d && structuredClone(this._d); }
  get(k) { return this._d && this._d[k]; }
}
class Ref {
  constructor(db, path) { this.db = db; this.path = path; this.id = path.split("/").pop(); }
  async get() { return new Snap(this, this.db.docs.get(this.path)); }
}
const TS = { __serverTimestamp: true };
function resolve(db, path, patch) {
  const cur = db.docs.get(path) || {};
  const out = { ...cur };
  for (const [k, v] of Object.entries(patch)) {
    if (v === TS) out[k] = new Date();
    else if (v && v.__increment !== undefined) out[k] = (cur[k] || 0) + v.__increment;
    else out[k] = v;
  }
  return out;
}
class FakeDB {
  constructor() { this.docs = new Map(); this.lock = Promise.resolve(); this.txCount = 0; }
  doc(path) { return new Ref(this, path); }
  collection(c) {
    return {
      doc: id => new Ref(this, `${c}/${id}`),
      where: (f, _op, v) => ({ limit: () => ({ get: async () => {
        const docs = [...this.docs].filter(([p, d]) => p.startsWith(c + "/") && d[f] === v).map(([p, d]) => new Snap(new Ref(this, p), d));
        return { empty: !docs.length, docs };
      } }) }),
    };
  }
  set(path, data) { this.docs.set(path, structuredClone(data)); }
  // Transactions run one at a time — same outcome as Firestore's optimistic retry.
  runTransaction(fn) {
    const run = this.lock.then(async () => {
      this.txCount++;
      const writes = [];
      const tx = {
        get: async r => new Snap(r, this.docs.get(r.path)),
        getAll: async (...rs) => rs.map(r => new Snap(r, this.docs.get(r.path))),
        create: (r, d) => writes.push(() => {
          if (this.docs.has(r.path)) throw Object.assign(new Error("exists"), { code: 6 });
          this.docs.set(r.path, resolve(this, r.path, d));
        }),
        update: (r, d) => writes.push(() => {
          if (!this.docs.has(r.path)) throw new Error("not found: " + r.path);
          this.docs.set(r.path, resolve(this, r.path, d));
        }),
        set: (r, d) => writes.push(() => this.docs.set(r.path, resolve(this, r.path, d))),
      };
      const out = await fn(tx);
      writes.forEach(w => w());
      return out;
    });
    this.lock = run.catch(() => {});
    return run;
  }
}
module.exports = { FakeDB, FieldValue: { serverTimestamp: () => TS, increment: n => ({ __increment: n }) } };
