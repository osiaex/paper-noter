chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("viewer.html") });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "api-request") return false;

  callApi(message.payload)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function callApi({ endpoint, apiKey, model, messages, temperature = 0.2 }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages, temperature }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === "AbortError") throw new Error("API 请求超过 90 秒，请检查接口速度或网络连接。 ");
    throw new Error(`无法连接 API：${error.message}。请检查接口地址、域名权限和网络。`);
  } finally {
    clearTimeout(timeout);
  }

  const raw = await response.text();
  let body = null;
  try { body = raw ? JSON.parse(raw) : null; } catch { /* handled below */ }
  if (!response.ok) {
    const detail = body?.error?.message || body?.message || raw.slice(0, 500) || response.statusText || "服务器未返回错误说明";
    throw new Error(`API ${response.status}: ${detail}（请求地址：${endpoint}）`);
  }
  if (!body) throw new Error(`API 返回的不是 JSON：${raw.slice(0, 300) || "空响应"}`);
  return body;
}
