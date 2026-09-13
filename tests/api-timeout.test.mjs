import test from "node:test";
import assert from "node:assert/strict";
import { API_TIMEOUT_OPTIONS, apiTimeoutFromIndex, apiTimeoutIndex, normalizeApiTimeoutMs } from "../src/api-timeout.js";

test("supports the five requested API timeout stops", () => {
  assert.deepEqual(API_TIMEOUT_OPTIONS, [30_000, 60_000, 90_000, 240_000, 0]);
  API_TIMEOUT_OPTIONS.forEach((timeout, index) => {
    assert.equal(apiTimeoutIndex(timeout), index);
    assert.equal(apiTimeoutFromIndex(index), timeout);
  });
});

test("migrates missing and invalid timeout settings to 90 seconds", () => {
  assert.equal(normalizeApiTimeoutMs(undefined), 90_000);
  assert.equal(normalizeApiTimeoutMs("bad"), 90_000);
  assert.equal(normalizeApiTimeoutMs(0), 0);
});

test("clamps slider indices to a valid timeout stop", () => {
  assert.equal(apiTimeoutFromIndex(-5), 30_000);
  assert.equal(apiTimeoutFromIndex(99), 0);
  assert.equal(apiTimeoutFromIndex(1.6), 90_000);
});
