import test from "node:test";
import assert from "node:assert/strict";
import { buildQuickLink, normalizeQuickLinkSettings, QUICK_LINK_PROVIDERS, validateQuickLinkSettings } from "../src/quick-links.js";

test("builds a provider search URL with the current bubble term", () => {
  const link = buildQuickLink("graph neural network", { quickLinkProvider: "scholar" });
  assert.equal(link.label, "Google Scholar");
  assert.match(link.url, /q=graph%20neural%20network/);
});

test("supports a custom label and query template", () => {
  const settings = validateQuickLinkSettings(normalizeQuickLinkSettings({
    quickLinkProvider: "custom",
    quickLinkCustomLabel: "My Search",
    quickLinkCustomTemplate: "https://example.com/find?q={query}",
  }));
  assert.deepEqual(buildQuickLink("A&B", settings), { label: "My Search", url: "https://example.com/find?q=A%26B" });
});

test("rejects a custom template without a query placeholder", () => {
  assert.throws(() => validateQuickLinkSettings({ quickLinkProvider: "custom", quickLinkCustomTemplate: "https://example.com" }), /\{query\}/);
});

test("all built-in providers use secure query templates", () => {
  for (const [provider, value] of Object.entries(QUICK_LINK_PROVIDERS)) {
    assert.match(value.template, /^https:\/\//, provider);
    assert.match(value.template, /\{query\}/, provider);
  }
});
