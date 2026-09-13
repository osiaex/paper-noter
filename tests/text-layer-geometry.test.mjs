import test from "node:test";
import assert from "node:assert/strict";
import { calibrateTextLayerWidths } from "../src/text-layer-geometry.js";

const viewport = { width: 800, transform: [2, 0, 0, -2, 0, 1000] };
const item = { str: "A line in the left column", width: 150, transform: [10, 0, 0, 10, 50, 400] };
function textSpan(width, initialScale = 1) {
  const properties = new Map([["--scale-x", String(initialScale)]]);
  return {
    isConnected: true,
    style: {
      getPropertyValue: (key) => properties.get(key) || "",
      setProperty: (key, value) => properties.set(key, value),
    },
    getBoundingClientRect: () => ({ width: width * Number(properties.get("--scale-x")) / initialScale }),
  };
}

test("corrects fallback-font width drift before full and partial text ranges are measured", () => {
  const span = textSpan(360, 1.2);
  calibrateTextLayerWidths([item], [span], viewport, { width: 800 });
  assert.equal(span.getBoundingClientRect().width, 300);
  assert.equal(Number(span.style.getPropertyValue("--scale-x")), 1);
  // Repeated calibration must not accumulate a scale correction.
  calibrateTextLayerWidths([item], [span], viewport, { width: 800 });
  assert.equal(span.getBoundingClientRect().width, 300);
});

test("accounts for the displayed page scale", () => {
  const span = textSpan(540);
  calibrateTextLayerWidths([item], [span], viewport, { width: 1200 });
  assert.equal(span.getBoundingClientRect().width, 450);
});

test("preserves indexing across empty text items", () => {
  const span = textSpan(360);
  calibrateTextLayerWidths([{ ...item, str: "" }, item], [null, span], viewport, { width: 800 });
  assert.equal(span.getBoundingClientRect().width, 300);
});

test("leaves rotated, skewed, vertical, and unmeasurable text alone", () => {
  for (const transform of [[0, 10, -10, 0, 50, 400], [10, 0, 2, 10, 50, 400]]) {
    const span = textSpan(360);
    calibrateTextLayerWidths([{ ...item, transform }], [span], viewport, { width: 800 });
    assert.equal(span.getBoundingClientRect().width, 360);
  }
  const vertical = textSpan(360);
  vertical.style.setProperty("--rotate", "90deg");
  const zero = textSpan(0);
  calibrateTextLayerWidths([item, item], [vertical, zero], viewport, { width: 800 });
  assert.equal(vertical.getBoundingClientRect().width, 360);
  assert.equal(zero.style.getPropertyValue("--scale-x"), "1");
});
