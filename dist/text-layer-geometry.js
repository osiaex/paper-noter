// PDF.js measures fallback fonts on a canvas. Browser text layout can use
// different metrics (including minimum font sizes), so verify the final DOM
// width against the PDF's text advance before using DOM ranges as anchors.
export function calibrateTextLayerWidths(items, textDivs, viewport, pageRect) {
  if (!(viewport.width > 0 && pageRect.width > 0)) return;
  const [a, b, c, d] = viewport.transform;
  const pageScale = Math.hypot(a, b);
  const corrections = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const span = textDivs[index];
    if (!item.str?.trim() || !span?.isConnected || !(item.width > 0)) continue;
    const [ta, tb, tc, td] = item.transform;
    // An axis-aligned bounding box cannot measure advances for rotated,
    // skewed, or vertical text. Leave those to PDF.js's native layout.
    const xx = a * ta + c * tb;
    const xy = b * ta + d * tb;
    const yx = a * tc + c * td;
    const yy = b * tc + d * td;
    if (!xx || !yy || Math.abs(xy) > Math.abs(xx) * 1e-6 || Math.abs(yx) > Math.abs(yy) * 1e-6) continue;
    if (span.style.getPropertyValue("--rotate") && parseFloat(span.style.getPropertyValue("--rotate")) % 180 !== 0) continue;
    const expectedWidth = item.width * pageScale * pageRect.width / viewport.width;
    const actualWidth = span.getBoundingClientRect().width;
    const scaleX = Number(span.style.getPropertyValue("--scale-x") || 1);
    if (!(actualWidth > 0 && Number.isFinite(expectedWidth) && scaleX > 0)) continue;
    if (Math.abs(actualWidth - expectedWidth) <= 0.25) continue;
    corrections.push([span, scaleX * expectedWidth / actualWidth]);
  }
  // Read all bounds before writing styles to avoid a layout per text item.
  for (const [span, scaleX] of corrections) span.style.setProperty("--scale-x", String(scaleX));
}
