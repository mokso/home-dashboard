export function ttlCache(fn, ttlMs) {
  let value = null;
  let expiresAt = 0;
  let inflight = null;
  return async () => {
    const fresh = value !== null && Date.now() < expiresAt;
    if (fresh) return value;
    if (!inflight) {
      inflight = fn()
        .then((v) => {
          value = v;
          expiresAt = Date.now() + ttlMs;
          return v;
        })
        .catch((e) => {
          if (value !== null) return value;
          throw e;
        })
        .finally(() => {
          inflight = null;
        });
    }
    return inflight;
  };
}
