/**
 * Plodroid Store — Cloud Functions (2nd gen, Node 22, London region).
 *
 *   placeOrder        callable  website checkout (server-checked prices + stock)
 *   submitFeedback    callable  website feedback form
 *   onOrderCreated    trigger   push "New order" to the owner
 *   onFeedbackCreated trigger   push "New feedback"
 *   onProductUpdated  trigger   push low / out-of-stock alerts
 *   onOrderUpdated    trigger   return stock when an order is cancelled
 *   remindStaleOrders schedule  nudge about unconfirmed orders
 */
const { initializeApp } = require("firebase-admin/app");
const { setGlobalOptions } = require("firebase-functions/v2");
const { onCall } = require("firebase-functions/v2/https");

initializeApp();
setGlobalOptions({ region: "europe-west2", maxInstances: 5 });

// Set ENFORCE_APP_CHECK=true in functions/.env once App Check is set up for the website.
const callOpts = { enforceAppCheck: process.env.ENFORCE_APP_CHECK === "true" };

const { placeOrder } = require("./src/orders");
const { submitFeedback } = require("./src/feedback");
const triggers = require("./src/triggers");

exports.placeOrder = onCall(callOpts, placeOrder);
exports.submitFeedback = onCall(callOpts, submitFeedback);
Object.assign(exports, triggers);
