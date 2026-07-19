import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEndpoint, parseJsonResponse } from "../src/api.js";

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
