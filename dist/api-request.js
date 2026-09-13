import { normalizeApiTimeoutMs } from "./api-timeout.js";

export async function callApi(
  { endpoint, apiKey, model, messages, temperature = 0.2, timeoutMs },
  { fetchImpl = fetch, setTimer = setTimeout, clearTimer = clearTimeout } = {},
) {
  const requestTimeoutMs = normalizeApiTimeoutMs(timeoutMs);
  const controller = new AbortController();
  const timeout = requestTimeoutMs > 0 ? setTimer(() => controller.abort(), requestTimeoutMs) : null;
  let response;
  let raw;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages, temperature }),
      signal: controller.signal,
    });
    // The selected limit covers both waiting for headers and downloading the
    // complete body. Aborted requests cannot later enter the save pipeline.
    raw = await response.text();
  } catch (error) {
    if (error.name === "AbortError") throw new Error(`API 请求超过 ${requestTimeoutMs / 1000} 秒，请检查接口速度或网络连接。`);
    throw new Error(`无法连接 API：${error.message}。请检查接口地址、域名权限和网络。`);
  } finally {
    if (timeout) clearTimer(timeout);
  }

  let body = null;
  try { body = raw ? JSON.parse(raw) : null; } catch { /* handled below */ }
  if (!response.ok) {
    const detail = body?.error?.message || body?.message || raw.slice(0, 500) || response.statusText || "服务器未返回错误说明";
    throw new Error(`API ${response.status}: ${detail}（请求地址：${endpoint}）`);
  }
  if (!body) throw new Error(`API 返回的不是 JSON：${raw.slice(0, 300) || "空响应"}`);
  return body;
}
