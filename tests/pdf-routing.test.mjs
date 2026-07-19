import test from "node:test";
import assert from "node:assert/strict";
import { isPdfUrl, pdfFileName } from "../src/pdf-routing.js";

test("detects common web and local PDF URLs", () => {
  assert.equal(isPdfUrl("https://example.com/paper.pdf"), true);
  assert.equal(isPdfUrl("https://example.com/PAPER.PDF?download=1"), true);
  assert.equal(isPdfUrl("file:///C:/papers/test.pdf"), true);
  assert.equal(isPdfUrl("https://example.com/download?file=paper.pdf"), true);
  assert.equal(isPdfUrl("https://example.com/article"), false);
});

test("derives names from content disposition or URL", () => {
  assert.equal(pdfFileName("https://example.com/download", "attachment; filename=paper.pdf"), "paper.pdf");
  assert.equal(pdfFileName("https://example.com/files/My%20Paper.pdf"), "My Paper.pdf");
  assert.equal(pdfFileName("https://example.com/arxiv/1234"), "1234.pdf");
});
