const SETTINGS_KEY = "paperMemoryApiSettings";
const STORE_VERSION = 2;

function apiError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

export function normalizeApiProfileStore(value) {
  const source = value && typeof value === "object" ? value : {};
  const rawProfiles = Array.isArray(source.profiles) && source.profiles.length
    ? source.profiles
    : [{
      id: "api-1",
      name: source.name || "API 1",
      endpoint: source.endpoint || "https://api.openai.com/v1/chat/completions",
      model: source.model || "",
      apiKey: source.apiKey || "",
    }];
  const usedIds = new Set();
  const profiles = rawProfiles.map((profile, index) => {
    let id = String(profile?.id || `api-${index + 1}`).trim() || `api-${index + 1}`;
    while (usedIds.has(id)) id = `${id}-${index + 1}`;
    usedIds.add(id);
    const rawEndpoint = String(profile?.endpoint || "").trim();
    let endpoint = rawEndpoint;
    if (rawEndpoint) {
      try { endpoint = normalizeEndpoint(rawEndpoint); } catch { /* Validation happens when saving. */ }
    }
    return {
      id,
      name: String(profile?.name || `API ${index + 1}`).trim() || `API ${index + 1}`,
      endpoint,
      model: String(profile?.model || "").trim(),
      apiKey: String(profile?.apiKey || "").trim(),
    };
  });
  const activeProfileId = profiles.some((profile) => profile.id === source.activeProfileId)
    ? source.activeProfileId
    : profiles[0].id;
  return { version: STORE_VERSION, activeProfileId, profiles };
}

export function activeApiProfile(store) {
  const normalized = normalizeApiProfileStore(store);
  return normalized.profiles.find((profile) => profile.id === normalized.activeProfileId) || normalized.profiles[0];
}

export async function loadApiProfileStore() {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  const stored = result[SETTINGS_KEY];
  const normalized = normalizeApiProfileStore(stored);
  if (JSON.stringify(stored || null) !== JSON.stringify(normalized)) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: normalized });
  }
  return normalized;
}

export async function loadApiSettings() {
  return activeApiProfile(await loadApiProfileStore());
}

export function normalizeApiConnection(profile) {
  if (!profile?.endpoint || !String(profile?.model || "").trim() || !String(profile?.apiKey || "").trim()) {
    throw apiError("API_PROFILE_INCOMPLETE", "请完整填写地址、模型和 API Key。");
  }
  let endpoint;
  try {
    endpoint = normalizeEndpoint(profile.endpoint);
  } catch {
    throw apiError("API_ENDPOINT_INVALID", "API 地址无效。");
  }
  const normalized = {
    ...profile,
    endpoint,
    model: String(profile?.model || "").trim(),
    apiKey: String(profile?.apiKey || "").trim(),
  };
  const endpointUrl = new URL(normalized.endpoint);
  if (!/^https?:$/.test(endpointUrl.protocol)) throw apiError("API_ENDPOINT_PROTOCOL", "API 地址必须以 http:// 或 https:// 开头。");
  return normalized;
}

export async function authorizeApiProfile(profile) {
  const normalized = normalizeApiConnection(profile);
  const endpoint = new URL(normalized.endpoint);
  const granted = await chrome.permissions.request({ origins: [`${endpoint.protocol}//${endpoint.host}/*`] });
  if (!granted) throw apiError("API_PERMISSION_REQUIRED", "需要允许访问 API 域名才能发送请求。");
  return normalized;
}

export async function saveApiProfileStore(value) {
  const store = normalizeApiProfileStore(value);
  if (!store.profiles.length) throw apiError("API_PROFILE_REQUIRED", "至少需要保留一个 API 配置。");
  const names = new Set();
  const origins = new Set();
  for (const profile of store.profiles) {
    const normalizedName = profile.name.trim();
    if (!normalizedName) throw apiError("API_PROFILE_NAME_REQUIRED", "API 配置名称不能为空。");
    const nameKey = normalizedName.toLocaleLowerCase();
    if (names.has(nameKey)) throw apiError("API_PROFILE_NAME_DUPLICATE", `API 配置名称不能重复：${normalizedName}`, { profileName: normalizedName });
    names.add(nameKey);
    let connection;
    try {
      connection = normalizeApiConnection(profile);
    } catch (error) {
      error.profileName = normalizedName;
      throw error;
    }
    Object.assign(profile, connection);
    const endpoint = new URL(connection.endpoint);
    origins.add(`${endpoint.protocol}//${endpoint.host}/*`);
  }
  const granted = await chrome.permissions.request({ origins: [...origins] });
  if (!granted) throw apiError("API_PERMISSION_REQUIRED", "需要允许访问 API 域名才能发送请求。");
  await chrome.storage.local.set({ [SETTINGS_KEY]: store });
  return store;
}

export async function saveApiSettings(settings) {
  const store = await loadApiProfileStore();
  const index = Math.max(0, store.profiles.findIndex((profile) => profile.id === store.activeProfileId));
  store.profiles[index] = { ...store.profiles[index], ...settings };
  return activeApiProfile(await saveApiProfileStore(store));
}

export function normalizeEndpoint(value) {
  const endpoint = new URL(String(value || "").trim());
  const path = endpoint.pathname.replace(/\/+$/, "");
  if (!path || path === "/") endpoint.pathname = "/v1/chat/completions";
  else if (/\/(?:v1|openai)$/i.test(path)) endpoint.pathname = `${path}/chat/completions`;
  else endpoint.pathname = path;
  endpoint.search = "";
  endpoint.hash = "";
  return endpoint.toString();
}

export async function requestVision(messages, settingsOverride = null) {
  const settings = settingsOverride ? normalizeApiConnection(settingsOverride) : await loadApiSettings();
  if (!settings.endpoint || !settings.model || !settings.apiKey) {
    throw apiError("API_SETTINGS_REQUIRED", "请先在右上角设置 API 地址、模型和 API Key。");
  }
  const response = await chrome.runtime.sendMessage({
    type: "api-request",
    payload: { ...settings, messages },
  });
  if (!response?.ok) throw new Error(response?.error || "API 请求失败");
  return response.data;
}

export function extractAssistantText(response) {
  const content = response?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((item) => item?.text || item?.content || "").join("\n");
  if (typeof response?.output_text === "string") return response.output_text;
  if (typeof response?.choices?.[0]?.text === "string") return response.choices[0].text;
  const refusal = response?.choices?.[0]?.message?.refusal;
  if (refusal) throw new Error(`模型拒绝了请求：${refusal}`);
  throw new Error(`API 返回中没有 choices[0].message.content。返回字段：${Object.keys(response || {}).join(", ") || "空"}`);
}

export function parseJsonResponse(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const firstObject = cleaned.indexOf("{");
  const lastObject = cleaned.lastIndexOf("}");
  if (firstObject < 0 || lastObject < firstObject) throw new Error("模型没有返回 JSON 对象。");
  const candidate = cleaned.slice(firstObject, lastObject + 1);
  try {
    return JSON.parse(candidate);
  } catch (strictError) {
    const repaired = repairJsonStringEscapes(candidate);
    if (repaired === candidate) throw strictError;
    return JSON.parse(repaired);
  }
}

function repairJsonStringEscapes(source) {
  let repaired = "";
  let inString = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      inString = !inString;
      repaired += character;
      continue;
    }
    if (!inString) {
      repaired += character;
      continue;
    }
    if (character === "\n") { repaired += "\\n"; continue; }
    if (character === "\r") { repaired += "\\r"; continue; }
    if (character === "\t") { repaired += "\\t"; continue; }
    if (character !== "\\") {
      repaired += character;
      continue;
    }
    const escape = source[index + 1];
    if ('"\\/bfnrt'.includes(escape)) {
      repaired += `\\${escape}`;
      index += 1;
      continue;
    }
    if (escape === "u" && /^[0-9a-fA-F]{4}$/.test(source.slice(index + 2, index + 6))) {
      repaired += source.slice(index, index + 6);
      index += 5;
      continue;
    }
    repaired += "\\\\";
  }
  return repaired;
}
