import test from "node:test";
import assert from "node:assert/strict";
import { normalisePostcode, normaliseUkPhone, showUkPhone, lookupPostcode, nearestPostcode, townMatches } from "../uk.js";

test("postcode normalising", () => {
  assert.equal(normalisePostcode("le54gu"), "LE5 4GU");
  assert.equal(normalisePostcode("  LE5   4GU "), "LE5 4GU");
  assert.equal(normalisePostcode("SW1A 1AA"), "SW1A 1AA");
  assert.equal(normalisePostcode("M1 1AE"), "M1 1AE");
  assert.equal(normalisePostcode("EC1A1BB"), "EC1A 1BB");
  assert.equal(normalisePostcode("GIR 0AA"), "GIR 0AA");
  for (const bad of ["", "12345", "ABCDE", "LE5", "LE5 4G", "QQ1 1AA", "LE5 4GUU", "90210", null, undefined])
    assert.equal(normalisePostcode(bad), "", String(bad));
});

test("UK phones", () => {
  assert.equal(normaliseUkPhone("07123 456789"), "+447123456789");
  assert.equal(normaliseUkPhone("+44 7123 456789"), "+447123456789");
  assert.equal(normaliseUkPhone("0044 7123456789"), "+447123456789");
  assert.equal(normaliseUkPhone("0116 496 0123"), "+441164960123");
  assert.equal(normaliseUkPhone("(0116) 4960123"), "+441164960123");
  for (const bad of ["", "123", "0712345", "+1 202 555 0100", "abc", "0071234567890", "+44 07123 456789"])
    assert.equal(normaliseUkPhone(bad), "", bad);
  assert.equal(showUkPhone("+447123456789"), "07123 456789");
});

const fakeFetch = (status, body) => async () => ({ status, ok: status >= 200 && status < 300, json: async () => body });

test("lookup: real, unknown, bad format, network", async () => {
  const ok = await lookupPostcode("le5 4gu", fakeFetch(200, { result: { postcode: "LE5 4GU", country: "England", region: "East Midlands", admin_district: "Leicester", latitude: 52.6, longitude: -1.1 } }));
  assert.equal(ok.ok, true);
  assert.equal(ok.postcode, "LE5 4GU");
  assert.equal(ok.country, "England");
  assert.deepEqual(await lookupPostcode("LE5 4GU", fakeFetch(404, { error: "Postcode not found" })), { ok: false, reason: "unknown" });
  assert.deepEqual(await lookupPostcode("nope", fakeFetch(200, {})), { ok: false, reason: "format" });
  assert.deepEqual(await lookupPostcode("LE5 4GU", async () => { throw new Error("offline"); }), { ok: false, reason: "network" });
  assert.deepEqual(await lookupPostcode("LE5 4GU", fakeFetch(500, {})), { ok: false, reason: "network" });
});

test("lookup only calls the API for well-formed postcodes", async () => {
  let calls = 0;
  await lookupPostcode("garbage", async () => { calls++; return fakeFetch(200, {})(); });
  assert.equal(calls, 0);
});

test("reverse geocode + soft town check", async () => {
  const hit = await nearestPostcode(52.6, -1.1, fakeFetch(200, { result: [{ postcode: "LE1 1AA", country: "England", admin_district: "Leicester" }] }));
  assert.equal(hit.ok, true);
  assert.equal((await nearestPostcode(0, 0, fakeFetch(200, { result: null }))).reason, "unknown");
  assert.equal(townMatches("Leicester", hit), true);
  assert.equal(townMatches("leicester city", hit), true);
  assert.equal(townMatches("Manchester", hit), false);
  assert.equal(townMatches("", hit), true);
});
