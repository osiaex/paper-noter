import test from "node:test";
import assert from "node:assert/strict";
import { computePdfIdentity, identitySamplePages, normalizeIdentityText } from "../src/pdf-identity.js";

test("samples a bounded set across a PDF without scanning every page", () => {
  assert.deepEqual(identitySamplePages(20), [1, 2, 10, 19, 20]);
  assert.deepEqual(identitySamplePages(2), [1, 2]);
  assert.deepEqual(identitySamplePages(1), [1]);
});

test("normalizes equivalent extracted text for semantic matching", () => {
  assert.equal(normalizeIdentityText("  RLHF\n from   Human Feedback  "), "rlhf from human feedback");
  assert.equal(normalizeIdentityText("ＡＢＣ"), "abc");
});

test("does not fingerprint image-only or text-poor PDFs", async () => {
  const identity = await computePdfIdentity(mockPdf([[]]));
  assert.deepEqual(identity, { contentFingerprint: "", layoutFingerprint: "", sampledCharacters: 0 });
});

test("layout changes keep semantic identity but prevent coordinate reuse", async () => {
  const text = "RLHF aligns language models with human preferences. ".repeat(8);
  const first = await computePdfIdentity(mockPdf([[item(text, 10, 20)]]));
  const second = await computePdfIdentity(mockPdf([[item(text, 300, 600)]]));
  assert.equal(first.contentFingerprint, second.contentFingerprint);
  assert.notEqual(first.layoutFingerprint, second.layoutFingerprint);
});

test("a sampled-page extraction failure does not reject the PDF identity task", async () => {
  const pdf = mockPdf([[item("short", 1, 1)], [item("also short", 1, 1)]]);
  const original = pdf.getPage;
  pdf.getPage = async (page) => page === 1 ? Promise.reject(new Error("broken text layer")) : original(page);
  const identity = await computePdfIdentity(pdf);
  assert.equal(identity.layoutFingerprint, "");
});

function item(str, x, y) {
  return { str, transform: [1, 0, 0, 1, x, y], width: str.length, height: 12 };
}

function mockPdf(pages) {
  return {
    numPages: pages.length,
    async getPage(pageNumber) {
      return {
        async getTextContent() { return { items: pages[pageNumber - 1] }; },
        getViewport() { return { width: 612, height: 792 }; },
      };
    },
  };
}
