import test from "node:test";
import assert from "node:assert/strict";
import { findExactTermRange, isAnnotationAnchorConsistent, findSavedQuoteRanges } from "../src/annotation-anchor.js";

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

test("relocates a saved multiline quote without reusing overlong boxes", () => {
  const items = [
    { text: "tion overhead each multi-agent variant actually incurs rather", box: [.1, .2, .49, .22] },
    { text: "than treating interagent communication as free compute. The", box: [.1, .23, .49, .25] },
  ];
  assert.deepEqual(findSavedQuoteRanges(items, { quote: items.map(i => i.text).join(" "), bboxes: [[.1, .2, .6, .22]] }), [
    { itemIndex: 0, start: 0, end: items[0].text.length },
    { itemIndex: 1, start: 0, end: items[1].text.length },
  ]);
});

test("uses the old location to distinguish repeated quotes across columns", () => {
  const items = [{ text: "same term", box: [.1, .2, .3, .22] }, { text: "same term", box: [.6, .2, .8, .22] }];
  assert.deepEqual(findSavedQuoteRanges(items, { quote: "same term", bboxes: [[.6, .2, .9, .22]] }), [{ itemIndex: 1, start: 0, end: 9 }]);
  assert.equal(findSavedQuoteRanges(items, { quote: "same term" }), null);
});

test("maps whitespace-normalized matches back to original character offsets", () => {
  assert.deepEqual(findSavedQuoteRanges([{ text: "A  precise\tterm ends", box: [0, 0, 1, 1] }], { quote: "precise term" }), [{ itemIndex: 0, start: 3, end: 15 }]);
});

test("keeps unmatched and discontinuous saved quotes on their original geometry", () => {
  const items = [{ text: "alpha omitted beta", box: [0, 0, 1, 1] }];
  assert.equal(findSavedQuoteRanges(items, { quote: "alpha beta" }), null);
  assert.equal(findSavedQuoteRanges(items, { quote: "absent" }), null);
  assert.equal(findSavedQuoteRanges(items, {}), null);
  assert.equal(findSavedQuoteRanges(items, { quote: "alpha", bboxes: [[.7, .7, .9, .8]] }), null);
});
