import test from "node:test";
import assert from "node:assert/strict";
import { callApi } from "../src/api-request.js";

const payload = { endpoint: "https://example.test/v1", apiKey: "key", model: "model", messages: [] };

test("aborts at the configured limit and cannot accept a late response", async () => {
  let fireTimeout;
  let lateResolve;
  const request = callApi({ ...payload, timeoutMs: 30_000 }, {
    setTimer(callback, delay) { assert.equal(delay, 30_000); fireTimeout = callback; return 1; },
    clearTimer() {},
    fetchImpl: (_url, options) => new Promise((resolve, reject) => {
      lateResolve = resolve;
      options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }),
  });
  fireTimeout();
  await assert.rejects(request, /超过 30 秒/);
  lateResolve({ ok: true, text: async () => '{"late":true}' });
  await Promise.resolve();
});

test("unlimited mode creates no timer and accepts the eventual result", async () => {
  let timerCreated = false;
  const result = await callApi({ ...payload, timeoutMs: 0 }, {
    setTimer() { timerCreated = true; },
    clearTimer() {},
    fetchImpl: async () => ({ ok: true, text: async () => '{"ok":true}' }),
  });
  assert.equal(timerCreated, false);
  assert.deepEqual(result, { ok: true });
});

test("keeps the timeout active while reading the response body", async () => {
  let fireTimeout;
  const request = callApi({ ...payload, timeoutMs: 60_000 }, {
    setTimer(callback) { fireTimeout = callback; return 1; },
    clearTimer() {},
    fetchImpl: async (_url, options) => ({
      ok: true,
      text: () => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
    }),
  });
  await Promise.resolve();
  fireTimeout();
  await assert.rejects(request, /超过 60 秒/);
});
