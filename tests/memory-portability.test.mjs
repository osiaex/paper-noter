import test from "node:test";
import assert from "node:assert/strict";
import { parseMemoryJsonl, serializeMemoryBundle } from "../src/memory.js";

test("portable memory includes the PDF hash and round-trips events", () => {
  const events = [{ event: "annotation_upsert", id: "term_1", content: { label: "RLHF" } }];
  const text = serializeMemoryBundle("abc123", { fileName: "paper.pdf", pageCount: 12 }, events);
  const parsed = parseMemoryJsonl(text);
  assert.equal(parsed.manifest.document_id, "abc123");
  assert.equal(parsed.manifest.meta.file_name, "paper.pdf");
  assert.deepEqual(parsed.events, events);
});

test("legacy memory without a manifest remains parseable", () => {
  const parsed = parseMemoryJsonl('{"event":"annotation_upsert","id":"term_1"}\n');
  assert.equal(parsed.manifest, null);
  assert.equal(parsed.events.length, 1);
});

test("a portable memory with only a manifest is a valid empty memory", () => {
  const parsed = parseMemoryJsonl(serializeMemoryBundle("abc123", { fileName: "paper.pdf" }, []));
  assert.equal(parsed.manifest.document_id, "abc123");
  assert.deepEqual(parsed.events, []);
});

test("invalid or unsupported records fail before import", () => {
  assert.throws(() => parseMemoryJsonl("not json\n"), /line 1/);
  assert.throws(() => parseMemoryJsonl('{"event":"unknown"}\n'), /Unsupported/);
});

test("portable memory accepts persistent bubble deletion events", () => {
  const events = [
    { event: "bubble_delete", binding_key: '["root","child"]' },
    { event: "bubble_question_delete", binding_key: '["root"]' },
    { event: "bubble_annotation_delete", id: "bubble_term_1" },
  ];
  const parsed = parseMemoryJsonl(serializeMemoryBundle("abc123", {}, events));
  assert.deepEqual(parsed.events, events);
});
