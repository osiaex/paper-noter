import { isPdfUrl } from "./pdf-routing.js";
import { callApi } from "./api-request.js";

const redirectingTabs = new Set();

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("viewer.html") });
});

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0 || !isPdfUrl(details.url)) return;
  openInReader(details.tabId, details.url);
});

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0 || details.type !== "main_frame") return;
    const contentType = details.responseHeaders?.find((header) => header.name.toLocaleLowerCase() === "content-type")?.value || "";
    if (/application\/pdf/i.test(contentType)) openInReader(details.tabId, details.url);
  },
  { urls: ["http://*/*", "https://*/*"], types: ["main_frame"] },
  ["responseHeaders"],
);

async function openInReader(tabId, sourceUrl) {
  if (redirectingTabs.has(tabId) || sourceUrl.startsWith(chrome.runtime.getURL(""))) return;
  redirectingTabs.add(tabId);
  const cacheToken = sourceUrl.startsWith("file:") ? await cacheLocalPdfBeforeRedirect(sourceUrl) : "";
  const query = new URLSearchParams({ source: sourceUrl });
  if (cacheToken) query.set("cache", cacheToken);
  const readerUrl = chrome.runtime.getURL(`viewer.html?${query}`);
  chrome.tabs.update(tabId, { url: readerUrl }).catch(() => {}).finally(() => {
    setTimeout(() => redirectingTabs.delete(tabId), 1500);
  });
}

async function cacheLocalPdfBeforeRedirect(sourceUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    if (!await chrome.extension.isAllowedFileSchemeAccess()) return "";
    const response = await fetch(sourceUrl, { cache: "no-store", signal: controller.signal });
    const buffer = await response.arrayBuffer();
    if (!buffer.byteLength) return "";
    const token = crypto.randomUUID();
    const cache = await caches.open("paper-noter-local-pdf-v1");
    const cacheUrl = chrome.runtime.getURL(`source-cache/${token}`);
    await cache.put(cacheUrl, new Response(buffer, { headers: { "content-type": response.headers.get("content-type") || "application/pdf" } }));
    const keys = await cache.keys();
    for (const stale of keys.slice(0, Math.max(0, keys.length - 4))) await cache.delete(stale);
    return token;
  } catch {
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "api-request") return false;

  callApi(message.payload)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
