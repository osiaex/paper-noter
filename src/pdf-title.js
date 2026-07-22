export function resolvePdfTitle(metadata, fileName = "") {
  const candidates = [
    metadata?.info?.Title,
    readMetadataTitle(metadata?.metadata),
    fileName,
  ];
  for (const candidate of candidates) {
    const title = cleanTitle(candidate);
    if (title && !["untitled", "unknown"].includes(title.toLocaleLowerCase())) return title;
  }
  return "Paper Noter";
}

function readMetadataTitle(metadata) {
  try {
    return metadata?.get?.("dc:title") || "";
  } catch {
    return "";
  }
}

function cleanTitle(value) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
}
