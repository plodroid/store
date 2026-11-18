import test from "node:test";
import assert from "node:assert/strict";
import { validateAddress, validatePhone, tidyPostcode, formatAddress, splitLine1, countryOf } from "../address.js";

const UK = { country: "GB", postcode: "sw1a1aa", number: "10", street: "Downing Street", line2: "", city: "London", state: "" };

test("a complete UK address passes and is tidied", () => {
  const r = validateAddress(UK);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { country: "GB", line1: "10 Downing Street", line2: "", city: "London", state: "", postcode: "SW1A 1AA" });
});
test("every box is required, with a message naming what is wrong", () => {
  const r = validateAddress({ country: "GB", postcode: "", number: "", street: "", city: "" });
  assert.deepEqual(Object.keys(r.errors).sort(), ["city", "number", "postcode", "street"]);
  assert.equal(validateAddress({ ...UK, postcode: "12345" }).ok, false);        // a US-looking ZIP is not a UK postcode
  assert.equal(validateAddress({ ...UK, street: "1" }).errors.street.length > 0, true);
});
test("postcode shape is per country; US needs a state", () => {
  assert.equal(tidyPostcode("FR", "75001"), "75001"); assert.equal(tidyPostcode("FR", "7500"), "");
  assert.equal(tidyPostcode("NL", "1012ab"), "1012 AB"); assert.equal(tidyPostcode("CA", "m5v2t6"), "M5V 2T6");
  assert.equal(tidyPostcode("AE", ""), "-");                                     // countries without postcodes
  assert.equal(validateAddress({ country: "US", postcode: "10001", number: "5", street: "Main St", city: "New York" }).errors.state.length > 0, true);
  assert.equal(validateAddress({ country: "US", postcode: "10001", number: "5", street: "Main St", city: "New York", state: "ny" }).ok, true);
});
test("only countries the shop ships to are accepted; number goes after the street where that is the custom", () => {
  assert.equal(validateAddress({ ...UK, country: "FR", postcode: "75001" }, { allowed: ["GB"] }).errors.country.length > 0, true);
  const de = validateAddress({ country: "DE", postcode: "10115", number: "5", street: "Invalidenstraße", city: "Berlin" });
  assert.equal(de.value.line1, "Invalidenstraße 5");
  assert.deepEqual(splitLine1("Invalidenstraße 5", "DE"), { number: "5", street: "Invalidenstraße" });
  assert.deepEqual(splitLine1("10 Downing Street", "GB"), { number: "10", street: "Downing Street" });
  assert.deepEqual(formatAddress({ ...UK, line1: "10 Downing Street", postcode: "SW1A 1AA" }), ["10 Downing Street", "London", "SW1A 1AA", "United Kingdom"]);
  assert.ok(countryOf("gb"));
});
test("phone numbers must really exist: fake ones are refused, real ones become +E.164", async () => {
  for (const bad of ["199929292931", "123", "07700900123", "00000000000", "abc", "+44 1234", "0123456789012345"]) assert.equal((await validatePhone(bad, "GB")).ok, false, bad);
  assert.equal((await validatePhone("07911 123456", "GB")).e164, "+447911123456");
  assert.equal((await validatePhone("+44 7911 123456", "FR")).e164, "+447911123456");   // +code wins over the default country
  assert.equal((await validatePhone("0044 7911 123456", "GB")).e164, "+447911123456");
  assert.equal((await validatePhone("06 12 34 56 78", "FR")).e164, "+33612345678");
  assert.equal((await validatePhone("0550 12 34 56", "DZ")).e164, "+213550123456");
  assert.equal((await validatePhone("", "GB")).ok, false);
});
