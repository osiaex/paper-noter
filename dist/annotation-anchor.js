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
