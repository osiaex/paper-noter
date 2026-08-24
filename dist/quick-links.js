export const QUICK_LINK_PROVIDERS = {
  wiki: { label: "Wiki", template: "https://zh.wikipedia.org/w/index.php?title=Special:Search&search={query}&fulltext=1" },
  scholar: { label: "Google Scholar", template: "https://scholar.google.com/scholar?q={query}" },
  cnki: { label: "知网", template: "https://kns.cnki.net/kns8s/defaultresult/index?kw={query}" },
  bilibili: { label: "Bilibili", template: "https://search.bilibili.com/all?keyword={query}" },
  youtube: { label: "YouTube", template: "https://www.youtube.com/results?search_query={query}" },
  reddit: { label: "Reddit", template: "https://www.reddit.com/search/?q={query}" },
  chatgpt: { label: "ChatGPT", template: "https://chatgpt.com/?q={query}" },
  gemini: { label: "Gemini", template: "https://gemini.google.com/app?q={query}" },
  qwen: { label: "QWEN", template: "https://chat.qwen.ai/?input={query}" },
  kimi: { label: "Kimi", template: "https://www.kimi.com/?q={query}" },
  deepseek: { label: "DeepSeek", template: "https://chat.deepseek.com/?q={query}" },
  glm: { label: "GLM", template: "https://chatglm.cn/?q={query}" },
};

export function normalizeQuickLinkSettings(value = {}) {
  const provider = value.quickLinkProvider === "custom" || QUICK_LINK_PROVIDERS[value.quickLinkProvider] ? value.quickLinkProvider : "wiki";
  return {
    quickLinkProvider: provider,
    quickLinkCustomLabel: String(value.quickLinkCustomLabel || "自定义").trim() || "自定义",
    quickLinkCustomTemplate: String(value.quickLinkCustomTemplate || "").trim(),
  };
}

export function validateQuickLinkSettings(settings) {
  if (settings.quickLinkProvider !== "custom") return settings;
  const template = String(settings.quickLinkCustomTemplate || "").trim();
  if (!template.includes("{query}")) throw new Error("自定义快速链接必须包含 {query} 占位符。");
  let url;
  try { url = new URL(template.replaceAll("{query}", "test")); }
  catch { throw new Error("自定义快速链接不是有效 URL。"); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("自定义快速链接仅支持 http 或 https。");
  return settings;
}

export function buildQuickLink(term, settings = {}) {
  const normalized = normalizeQuickLinkSettings(settings);
  const selected = normalized.quickLinkProvider === "custom"
    ? { label: normalized.quickLinkCustomLabel, template: normalized.quickLinkCustomTemplate }
    : QUICK_LINK_PROVIDERS[normalized.quickLinkProvider];
  const fallback = QUICK_LINK_PROVIDERS.wiki;
  const template = selected.template || fallback.template;
  return {
    label: selected.label || fallback.label,
    url: template.replaceAll("{query}", encodeURIComponent(String(term || "").trim())),
  };
}
