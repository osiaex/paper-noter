import test from "node:test";
import assert from "node:assert/strict";
import { resolvePdfTitle } from "../src/pdf-title.js";

test("uses the PDF metadata title when available", () => {
  assert.equal(resolvePdfTitle({ info: { Title: "A Better Paper" } }, "paper.pdf"), "A Better Paper");
});

test("falls back to the file name for missing or generic metadata", () => {
  assert.equal(resolvePdfTitle({ info: { Title: "Untitled" } }, "actual-paper.pdf"), "actual-paper.pdf");
  assert.equal(resolvePdfTitle({}, "actual-paper.pdf"), "actual-paper.pdf");
});

test("accepts Dublin Core metadata and cleans unsafe title characters", () => {
  const metadata = { metadata: { get: (key) => key === "dc:title" ? "  Paper\nTitle\u0000  " : "" } };
  assert.equal(resolvePdfTitle(metadata, "fallback.pdf"), "Paper Title");
});

test("uses the app name when neither metadata nor a file name is usable", () => {
  assert.equal(resolvePdfTitle(null, ""), "Paper Noter");
});
