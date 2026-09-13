export const API_TIMEOUT_OPTIONS = [30_000, 60_000, 90_000, 240_000, 0];
export const DEFAULT_API_TIMEOUT_MS = 90_000;

export function normalizeApiTimeoutMs(value) {
  const timeout = Number(value);
  return API_TIMEOUT_OPTIONS.includes(timeout) ? timeout : DEFAULT_API_TIMEOUT_MS;
}

export function apiTimeoutIndex(value) {
  return API_TIMEOUT_OPTIONS.indexOf(normalizeApiTimeoutMs(value));
}

export function apiTimeoutFromIndex(value) {
  const index = Math.min(API_TIMEOUT_OPTIONS.length - 1, Math.max(0, Math.round(Number(value) || 0)));
  return API_TIMEOUT_OPTIONS[index];
}
