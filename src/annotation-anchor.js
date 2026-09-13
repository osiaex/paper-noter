export function findExactTermRange(text, label, preferredStart = 0) {
  const source = String(text || "");
  const needle = String(label || "").trim();
  if (!source || !needle) return null;
  const haystack = source.toLocaleLowerCase();
  const normalizedNeedle = needle.toLocaleLowerCase();
  const matches = [];
  let from = 0;
  while (from <= haystack.length - normalizedNeedle.length) {
    const index = haystack.indexOf(normalizedNeedle, from);
    if (index < 0) break;
    matches.push(index);
    from = index + Math.max(1, normalizedNeedle.length);
  }
  if (!matches.length) return null;
  const preferred = Number.isFinite(Number(preferredStart)) ? Number(preferredStart) : 0;
  const start = matches.sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred))[0];
  return { start, end: start + needle.length };
}

export function isAnnotationAnchorConsistent(annotation) {
  if (annotation?.kind !== "term") return true;
  const label = String(annotation.content?.label || "").trim().toLocaleLowerCase();
  const quote = String(annotation.anchor?.quote || "").trim().toLocaleLowerCase();
  return Boolean(label && quote && quote.includes(label));
}

// Re-resolve saved quotes against the current text layer. Coordinates from an
// older font/layout implementation are hints, not the source of truth.
export function findSavedQuoteRanges(items, anchor) {
  const quote = String(anchor?.quote || "").replace(/\s+/g, " ").trim();
  if (!quote) return null;
  let text = "";
  const positions = [];
  items.forEach((item, itemIndex) => {
    if (text && !text.endsWith(" ")) { text += " "; positions.push(null); }
    for (let offset = 0; offset < item.text.length; offset += 1) {
      const char = /\s/.test(item.text[offset]) ? " " : item.text[offset];
      if (char === " " && text.endsWith(" ")) continue;
      text += char;
      positions.push({ itemIndex, offset });
    }
  });
  const hint = anchor.bboxes?.[0] || anchor.bbox;
  const candidates = [];
  let from = 0;
  while (from < text.length) {
    const start = text.indexOf(quote, from);
    if (start < 0) break;
    from = start + 1;
    const ranges = [];
    for (let i = start; i < start + quote.length; i += 1) {
      const point = positions[i];
      if (!point) continue;
      const last = ranges.at(-1);
      if (last?.itemIndex === point.itemIndex) last.end = point.offset + 1;
      else ranges.push({ itemIndex: point.itemIndex, start: point.offset, end: point.offset + 1 });
    }
    if (!ranges.length) continue;
    const first = items[ranges[0].itemIndex];
    const x = first.box[0] + (first.box[2] - first.box[0]) * ranges[0].start / Math.max(1, first.text.length);
    // Do not move a saved mark to a remote occurrence merely because its
    // text happens to match. Old width errors should still start nearby.
    if (hint && (Math.abs(first.box[1] - hint[1]) > .03 || Math.abs(x - hint[0]) > .15)) continue;
    const distance = hint ? Math.abs(first.box[1] - hint[1]) * 4 + Math.abs(x - hint[0]) : 0;
    candidates.push({ ranges, distance });
  }
  candidates.sort((a, b) => a.distance - b.distance);
  if (!candidates.length || (candidates.length > 1 && (!hint || Math.abs(candidates[0].distance - candidates[1].distance) < 1e-6))) return null;
  return candidates[0].ranges;
}
