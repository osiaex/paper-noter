const SETTINGS_KEY = "paperMemoryApiSettings";

export async function loadApiSettings() {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  const settings = result[SETTINGS_KEY] || {
    endpoint: "https://api.openai.com/v1/chat/completions",
    model: "",
    apiKey: "",
  };
  if (settings.endpoint) {
    try {
      const endpoint = normalizeEndpoint(settings.endpoint);
      if (endpoint !== settings.endpoint) {
        settings.endpoint = endpoint;
        await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
      }
    } catch { /* The settings dialog will surface invalid URLs. */ }
  }
  return settings;
}

export async function saveApiSettings(settings) {
  const normalizedEndpoint = normalizeEndpoint(settings.endpoint);
  const endpoint = new URL(normalizedEndpoint);
  if (!/^https?:$/.test(endpoint.protocol)) throw new Error("API 地址必须以 http:// 或 https:// 开头。 ");
  const originPattern = `${endpoint.protocol}//${endpoint.host}/*`;
  const granted = await chrome.permissions.request({ origins: [originPattern] });
  if (!granted) throw new Error("需要允许访问该 API 域名才能发送请求。 ");
  const normalizedSettings = { ...settings, endpoint: normalizedEndpoint };
  await chrome.storage.local.set({ [SETTINGS_KEY]: normalizedSettings });
  return normalizedSettings;
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

export async function requestVision(messages) {
  const settings = await loadApiSettings();
  if (!settings.endpoint || !settings.model || !settings.apiKey) {
    throw new Error("请先在右上角设置 API 地址、模型和 API Key。 ");
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
  if (Array.isArray(content)) {
    return content.map((item) => item?.text || item?.content || "").join("\n");
  }
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
  if (firstObject < 0 || lastObject < firstObject) {
    throw new Error("模型没有返回 JSON 对象。 ");
  }
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
