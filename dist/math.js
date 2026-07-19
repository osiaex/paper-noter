export function tokenizeMath(value) {
  const text = String(value || "");
  const tokens = [];
  let cursor = 0;
  let plainStart = 0;
  while (cursor < text.length) {
    const opening = mathOpeningAt(text, cursor);
    if (!opening) {
      cursor += text[cursor] === "\\" ? 2 : 1;
      continue;
    }
    const closingIndex = findUnescaped(text, opening.close, cursor + opening.open.length);
    if (closingIndex < 0) {
      cursor += opening.open.length;
      continue;
    }
    const expression = text.slice(cursor + opening.open.length, closingIndex);
    if (!expression.trim() || (!opening.displayMode && expression.includes("\n"))) {
      cursor += opening.open.length;
      continue;
    }
    if (plainStart < cursor) tokens.push({ type: "text", value: text.slice(plainStart, cursor), start: plainStart, end: cursor });
    const end = closingIndex + opening.close.length;
    tokens.push({ type: "math", value: text.slice(cursor, end), expression, displayMode: opening.displayMode, start: cursor, end });
    cursor = end;
    plainStart = end;
  }
  if (plainStart < text.length) tokens.push({ type: "text", value: text.slice(plainStart), start: plainStart, end: text.length });
  return tokens.length ? tokens : [{ type: "text", value: text, start: 0, end: text.length }];
}

function mathOpeningAt(text, index) {
  if (isEscaped(text, index)) return null;
  if (text.startsWith("$$", index)) return { open: "$$", close: "$$", displayMode: true };
  if (text.startsWith("\\[", index)) return { open: "\\[", close: "\\]", displayMode: true };
  if (text.startsWith("\\(", index)) return { open: "\\(", close: "\\)", displayMode: false };
  if (text[index] === "$") return { open: "$", close: "$", displayMode: false };
  return null;
}

function findUnescaped(text, needle, from) {
  let index = text.indexOf(needle, from);
  while (index >= 0) {
    if (!isEscaped(text, index)) return index;
    index = text.indexOf(needle, index + needle.length);
  }
  return -1;
}

function isEscaped(text, index) {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) slashes += 1;
  return slashes % 2 === 1;
}
