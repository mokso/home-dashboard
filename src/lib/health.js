// Per-source success/failure tracking for /api/health.
// Routes call recordSuccess / recordError after each upstream fetch attempt.

export const health = {};

export function recordSuccess(key) {
  if (!health[key]) health[key] = {};
  health[key].lastSuccess = new Date().toISOString();
}

export function recordError(key, err) {
  if (!health[key]) health[key] = {};
  health[key].lastError = new Date().toISOString();
  health[key].lastErrorMessage = String(err?.message ?? err);
}
