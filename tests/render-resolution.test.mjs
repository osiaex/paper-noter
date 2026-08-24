import test from "node:test";
import assert from "node:assert/strict";
import { calculateCanvasResolution, effectiveDisplayScale, MAX_CANVAS_PIXELS } from "../src/render-resolution.js";

test("matches the current browser pixel density for ordinary pages", () => {
  assert.deepEqual(calculateCanvasResolution(800, 1000, 2), {
    outputScale: 2,
    pixelWidth: 1600,
    pixelHeight: 2000,
  });
});

test("increases raster resolution when browser zoom raises device scale", () => {
  const normal = calculateCanvasResolution(800, 1000, 1);
  const zoomed = calculateCanvasResolution(800, 1000, 3);
  assert.ok(zoomed.pixelWidth > normal.pixelWidth);
  assert.ok(zoomed.pixelHeight > normal.pixelHeight);
});

test("caps very large page canvases to the pixel budget", () => {
  const result = calculateCanvasResolution(1600, 2200, 4);
  assert.ok(result.pixelWidth * result.pixelHeight <= MAX_CANVAS_PIXELS);
  assert.ok(result.outputScale < 4);
});

test("includes pinch zoom in the effective display scale", () => {
  assert.equal(effectiveDisplayScale(2, 1.5), 3);
  assert.equal(effectiveDisplayScale(2, 0.8), 2);
});

test("keeps high browser zoom sharp beyond the old twelve megapixel limit", () => {
  const result = calculateCanvasResolution(803, 1136, 5);
  assert.equal(result.outputScale, 5);
  assert.ok(result.pixelWidth * result.pixelHeight > 12_000_000);
});
