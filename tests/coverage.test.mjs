import test from "node:test";
import assert from "node:assert/strict";
import { intervalLength, mergeIntervals, subtractCoverage, subtractIntervals, synchronizedAnimationDelay } from "../src/coverage.js";

test("merges overlapping and nearly touching viewport intervals", () => {
  assert.deepEqual(mergeIntervals([[.2, .4], [.39, .6], [.602, .8]]), [[.2, .8]]);
});

test("returns only unseen parts of a viewport", () => {
  assert.deepEqual(subtractCoverage([.2, .8], [[0, .3], [.5, .65]]), [[.3, .5], [.65, .8]]);
});

test("ignores tiny boundary slivers", () => {
  assert.deepEqual(subtractCoverage([.2, .8], [[.19, .795]]), []);
  assert.ok(Math.abs(intervalLength([[.1, .2], [.15, .3]]) - .2) < 1e-9);
});

test("moves only a completed reservation out of sent coverage", () => {
  assert.deepEqual(subtractIntervals([[.1, .8]], [[.3, .5]]), [[.1, .3], [.5, .8]]);
});

test("aligns newly inserted coverage animations to a shared cycle", () => {
  assert.equal(synchronizedAnimationDelay(0, 2500), 0);
  assert.equal(synchronizedAnimationDelay(750, 2500), -750);
  assert.equal(synchronizedAnimationDelay(3250, 2500), -750);
});
