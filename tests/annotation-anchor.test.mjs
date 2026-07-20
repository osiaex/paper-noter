import test from "node:test";
import assert from "node:assert/strict";
import { findExactTermRange, isAnnotationAnchorConsistent } from "../src/annotation-anchor.js";

test("corrects an API offset to the exact term in the source span", () => {
  const text = "is an application of RLHF applied to preferences";
  assert.deepEqual(findExactTermRange(text, "RLHF", 3), { start: 21, end: 25 });
});

test("chooses the occurrence nearest the API hint", () => {
  assert.deepEqual(findExactTermRange("RLHF and RLHF", "RLHF", 10), { start: 9, end: 13 });
});

test("rejects a term label that is absent from the source", () => {
  assert.equal(findExactTermRange("an application", "RLHF", 3), null);
});

test("detects stale term memories whose quote and label disagree", () => {
  assert.equal(isAnnotationAnchorConsistent({ kind: "term", anchor: { quote: "an" }, content: { label: "RLHF" } }), false);
  assert.equal(isAnnotationAnchorConsistent({ kind: "term", anchor: { quote: "RLHF" }, content: { label: "RLHF" } }), true);
  assert.equal(isAnnotationAnchorConsistent({ kind: "keypoint", anchor: { quote: "anything" }, content: { label: "Summary" } }), true);
});
