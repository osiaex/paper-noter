(function installAndroidPlatform(global) {
  const bridge = global.PaperNoterAndroid;
  if (!bridge) return;

  const STORAGE_PREFIX = "paper-noter:";
  const pendingRequests = new Map();

  function readStore() {
    try { return JSON.parse(bridge.readSettings() || "{}") || {}; }
    catch { return {}; }
  }

  function writeStore(store) { bridge.writeSettings(JSON.stringify(store)); }

  function selectKeys(store, keys) {
    if (keys == null) return { ...store };
    if (typeof keys === "string") return { [keys]: store[keys] };
    if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, store[key]]));
    if (typeof keys === "object") return Object.fromEntries(Object.entries(keys).map(([key, fallback]) => [key, store[key] ?? fallback]));
    return {};
  }

  global.__paperNoterAndroidApiResult = function apiResult(id, ok, payload) {
    const request = pendingRequests.get(id);
    if (!request) return;
    pendingRequests.delete(id);
    if (!ok) {
      request.resolve({ ok: false, error: String(payload || "API 请求失败") });
      return;
    }
    try { request.resolve({ ok: true, data: JSON.parse(payload) }); }
    catch (error) { request.resolve({ ok: false, error: `API 返回解析失败：${error.message}` }); }
  };

  global.chrome = {
    runtime: {
      getURL(path) { return new URL(String(path || ""), global.location.href).href; },
      sendMessage(message) {
        if (message?.type !== "api-request") return Promise.resolve({ ok: false, error: "Android 暂不支持该消息" });
        return new Promise((resolve) => {
          const id = bridge.requestApi(JSON.stringify(message.payload || {}));
          pendingRequests.set(id, { resolve });
        });
      },
    },
    storage: {
      local: {
        async get(keys) {
          const stored = readStore();
          const values = {};
          for (const [key, value] of Object.entries(stored)) {
            if (key.startsWith(STORAGE_PREFIX)) values[key.slice(STORAGE_PREFIX.length)] = value;
          }
          return selectKeys(values, keys);
        },
        async set(values) {
          const stored = readStore();
          for (const [key, value] of Object.entries(values || {})) stored[`${STORAGE_PREFIX}${key}`] = value;
          writeStore(stored);
        },
      },
    },
    permissions: { async request() { return true; } },
    extension: { async isAllowedFileSchemeAccess() { return true; } },
  };

  global.PaperNoterPlatform = {
    async saveTextFile(fileName, contents) {
      bridge.saveTextFile(String(fileName || "paper-noter.jsonl"), String(contents || ""));
    },
  };
})(globalThis);
