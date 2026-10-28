const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const { logger } = require("firebase-functions");

// Android notification channels (created by the owner app) and the owner's on/off switches.
const CHANNEL = { order: "orders", reminder: "orders", feedback: "feedback", stock: "stock" };
const PREF = { order: "orders", reminder: "orders", feedback: "feedback", stock: "stock" };
const DEAD_TOKEN = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

/**
 * Records an in-app notification and pushes it to every signed-in owner phone.
 * `key` is the document id, so a retried trigger can never notify twice.
 */
async function notifyOwner({ key, type, title, body, refId }) {
  const db = getFirestore();
  const ref = db.collection("notifications").doc(key);
  try {
    await ref.create({ type, title, body, refId: refId || null, read: false, pushed: 0, createdAt: FieldValue.serverTimestamp() });
  } catch (e) {
    if (e.code === 6) return { skipped: "duplicate" }; // ALREADY_EXISTS
    throw e;
  }

  const prefs = await db.doc("settings/owner").get();
  const notify = (prefs.exists && prefs.get("notify")) || {};
  if (notify[PREF[type]] === false) return { skipped: "muted" };

  const devices = await db.collection("ownerDevices").get();
  const tokens = devices.docs.map(d => d.id);
  if (!tokens.length) return { sent: 0 };

  const res = await getMessaging().sendEachForMulticast({
    tokens,
    notification: { title, body },
    data: { type: type === "reminder" ? "order" : type, id: String(refId || "") },
    android: { priority: "high", notification: { channelId: CHANNEL[type], tag: key } },
  });

  const dead = [];
  res.responses.forEach((r, i) => {
    if (r.success) return;
    const code = r.error && r.error.code;
    if (DEAD_TOKEN.has(code)) dead.push(tokens[i]);
    else logger.warn("Push failed", { code });
  });
  await Promise.all(dead.map(t => db.collection("ownerDevices").doc(t).delete()));
  await ref.update({ pushed: res.successCount });
  return { sent: res.successCount };
}

module.exports = { notifyOwner };
