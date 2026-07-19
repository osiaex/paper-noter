export function isPdfUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:", "file:"].includes(url.protocol)) return false;
    if (/\.pdf$/i.test(url.pathname)) return true;
    return [...url.searchParams.values()].some((item) => /\.pdf(?:$|[?#])/i.test(item));
  } catch {
    return false;
  }
}

export function pdfFileName(source, contentDisposition = "") {
  const encodedHeaderName = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plainHeaderName = contentDisposition.match(/filename="?([^";]+)"?/i)?.[1];
  const headerName = encodedHeaderName || plainHeaderName;
  if (headerName) {
    try { return ensurePdfExtension(decodeURIComponent(headerName.trim())); } catch { return ensurePdfExtension(headerName.trim()); }
  }
  try {
    const pathName = new URL(source).pathname.split("/").filter(Boolean).pop();
    if (pathName) return ensurePdfExtension(decodeURIComponent(pathName));
  } catch { /* use fallback */ }
  return "document.pdf";
}

function ensurePdfExtension(name) {
  return /\.pdf$/i.test(name) ? name : `${name}.pdf`;
}
