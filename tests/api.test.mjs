import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEndpoint } from "../src/api.js";

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
