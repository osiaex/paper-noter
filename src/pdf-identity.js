const MIN_IDENTITY_CHARACTERS = 200;
const MAX_PAGE_CHARACTERS = 8000;

export function identitySamplePages(pageCount) {
  const count = Math.max(1, Math.floor(Number(pageCount) || 1));
  return [...new Set([1, 2, Math.ceil(count / 2), count - 1, count].map((page) => Math.min(count, Math.max(1, page))))].sort((a, b) => a - b);
}

export function normalizeIdentityText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export async function computePdfIdentity(pdf) {
  const contentSamples = [];
  const layoutSamples = [];
  let sampledCharacters = 0;

  for (const pageNumber of identitySamplePages(pdf.numPages)) {
    try {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1 });
      const pageText = [];
      const pageLayout = [];
      let pageCharacters = 0;
      for (const item of content.items) {
        const text = normalizeIdentityText(item.str || "");
        if (!text || pageCharacters >= MAX_PAGE_CHARACTERS) continue;
        const remaining = MAX_PAGE_CHARACTERS - pageCharacters;
        const clipped = text.slice(0, remaining);
        pageCharacters += clipped.length;
        pageText.push(clipped);
        pageLayout.push([
          clipped,
          ...[...(item.transform || []).slice(0, 6), item.width, item.height].map(stableNumber),
        ]);
      }
      sampledCharacters += pageCharacters;
      contentSamples.push([pageNumber, pageText.join(" ")]);
      layoutSamples.push([
        pageNumber,
        stableNumber(viewport.width),
        stableNumber(viewport.height),
        pageLayout,
      ]);
    } catch {
      // Identity is optional. A damaged or image-only sample page must not block PDF opening.
    }
  }

  if (sampledCharacters < MIN_IDENTITY_CHARACTERS) {
    return { contentFingerprint: "", layoutFingerprint: "", sampledCharacters };
  }
  const prefix = `pages:${pdf.numPages}\n`;
  return {
    contentFingerprint: await digestText(`${prefix}${JSON.stringify(contentSamples)}`),
    layoutFingerprint: await digestText(`${prefix}${JSON.stringify(layoutSamples)}`),
    sampledCharacters,
  };
}

function stableNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric * 1000) / 1000 : 0;
}

async function digestText(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
