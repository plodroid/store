const { HttpsError } = require("firebase-functions/v2/https");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const logic = require("./shop-logic");
const { clientKey, checkRate } = require("./rate-limit");

/** Callable: submitFeedback. Stored privately; only the owner can read it. */
async function submitFeedback(request) {
  let fb;
  try {
    fb = logic.validateFeedbackInput(request.data);
  } catch (e) {
    if (e instanceof logic.InputError) throw new HttpsError("invalid-argument", e.message, { problems: e.problems });
    throw e;
  }

  const db = getFirestore();
  await checkRate(db, clientKey(request, "feedback"), 5, 10 * 60 * 1000);

  // Link to the order if the reference is real (owner convenience only).
  let orderId = null;
  if (fb.orderRef) {
    const match = await db.collection("orders").where("ref", "==", fb.orderRef).limit(1).get();
    if (!match.empty) orderId = match.docs[0].id;
  }

  const doc = await db.collection("feedback").add({
    ...fb,
    orderId,
    read: false,
    archived: false,
    createdAt: FieldValue.serverTimestamp(),
  });
  return { ok: true, id: doc.id };
}

module.exports = { submitFeedback };
