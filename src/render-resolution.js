export const MAX_CANVAS_OUTPUT_SCALE = 8;
export const MAX_CANVAS_PIXELS = 36_000_000;

export function effectiveDisplayScale(devicePixelRatio = 1, visualViewportScale = 1) {
  const pixelRatio = Math.max(1, Number(devicePixelRatio) || 1);
  const pinchScale = Math.max(1, Number(visualViewportScale) || 1);
  return pixelRatio * pinchScale;
}

export function calculateCanvasResolution(cssWidth, cssHeight, deviceScale = 1, {
  maxScale = MAX_CANVAS_OUTPUT_SCALE,
  maxPixels = MAX_CANVAS_PIXELS,
} = {}) {
  const width = Math.max(1, Number(cssWidth) || 1);
  const height = Math.max(1, Number(cssHeight) || 1);
  const requestedScale = Math.max(1, Number(deviceScale) || 1);
  const pixelLimitedScale = Math.sqrt(maxPixels / (width * height));
  const outputScale = Math.max(1, Math.min(requestedScale, maxScale, pixelLimitedScale));
  return {
    outputScale,
    pixelWidth: Math.max(1, Math.floor(width * outputScale)),
    pixelHeight: Math.max(1, Math.floor(height * outputScale)),
  };
}
