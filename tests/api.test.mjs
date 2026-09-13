import test from "node:test";
import assert from "node:assert/strict";
import { activeApiProfile, normalizeApiConnection, normalizeApiProfileStore, normalizeEndpoint, parseJsonResponse } from "../src/api.js";

test("removes a trailing slash from a complete chat completions endpoint", () => {
  assert.equal(
    normalizeEndpoint("https://example.com/v1/chat/completions/"),
    "https://example.com/v1/chat/completions",
  );
});

test("expands common OpenAI-compatible base URLs", () => {
  assert.equal(normalizeEndpoint("https://example.com"), "https://example.com/v1/chat/completions");
  assert.equal(normalizeEndpoint("https://example.com/v1/"), "https://example.com/v1/chat/completions");
  assert.equal(normalizeEndpoint("https://openrouter.example/api/v1"), "https://openrouter.example/api/v1/chat/completions");
  assert.equal(normalizeEndpoint("https://gemini.example/v1beta/openai/"), "https://gemini.example/v1beta/openai/chat/completions");
});

test("preserves a provider-specific complete path", () => {
  assert.equal(normalizeEndpoint("https://example.com/custom/generate"), "https://example.com/custom/generate");
});

test("migrates legacy single-API settings into a profile store", () => {
  const store = normalizeApiProfileStore({
    endpoint: "https://example.com/v1",
    model: "vision-model",
    apiKey: "secret",
  });
  assert.equal(store.version, 2);
  assert.equal(store.profiles.length, 1);
  assert.equal(store.activeProfileId, "api-1");
  assert.deepEqual(activeApiProfile(store), {
    id: "api-1",
    name: "API 1",
    endpoint: "https://example.com/v1/chat/completions",
    model: "vision-model",
    apiKey: "secret",
    timeoutMs: 90_000,
  });
});

test("preserves multiple profiles and selects the active one", () => {
  const store = normalizeApiProfileStore({
    version: 2,
    activeProfileId: "second",
    profiles: [
      { id: "first", name: "Fast", endpoint: "https://a.example/v1", model: "a", apiKey: "a-key" },
      { id: "second", name: "Accurate", endpoint: "https://b.example/v1", model: "b", apiKey: "b-key", timeoutMs: 240_000 },
    ],
  });
  assert.equal(store.profiles.length, 2);
  assert.equal(activeApiProfile(store).name, "Accurate");
  assert.equal(activeApiProfile(store).timeoutMs, 240_000);
});

test("always retains at least one API profile", () => {
  const store = normalizeApiProfileStore({ version: 2, profiles: [] });
  assert.equal(store.profiles.length, 1);
  assert.equal(store.activeProfileId, store.profiles[0].id);
});

test("normalizes a draft API connection without persisting it", () => {
  assert.deepEqual(normalizeApiConnection({
    id: "draft",
    name: "Draft",
    endpoint: "https://example.com/v1/",
    model: " model ",
    apiKey: " secret ",
  }), {
    id: "draft",
    name: "Draft",
    endpoint: "https://example.com/v1/chat/completions",
    model: "model",
    apiKey: "secret",
    timeoutMs: 90_000,
  });
});

test("exposes stable error codes for localized API validation", () => {
  assert.throws(
    () => normalizeApiConnection({ endpoint: "https://example.com/v1", model: "", apiKey: "secret" }),
    (error) => error.code === "API_PROFILE_INCOMPLETE",
  );
  assert.throws(
    () => normalizeApiConnection({ endpoint: "ftp://example.com/v1", model: "model", apiKey: "secret" }),
    (error) => error.code === "API_ENDPOINT_PROTOCOL",
  );
});

test("repairs model JSON containing LaTeX-style invalid escapes", () => {
  const parsed = parseJsonResponse(String.raw`\`\`\`json
{"explanation":"Compare \\alpha with \\(x\\) and \\usepackage."}
\`\`\``);
  assert.equal(parsed.explanation, String.raw`Compare \alpha with \(x\) and \usepackage.`);
});

test("preserves valid JSON escapes and unicode escapes", () => {
  const parsed = parseJsonResponse(String.raw`{"text":"line one\nline two \u03b1 \\ path"}`);
  assert.equal(parsed.text, "line one\nline two α \\ path");
});

test("repairs literal newlines inside a model JSON string", () => {
  const parsed = parseJsonResponse('{"text":"line one\nline two"}');
  assert.equal(parsed.text, "line one\nline two");
});
