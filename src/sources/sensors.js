import { config } from '../config.js';
import { ttlCache } from '../lib/cache.js';

const { baseUrl, token } = config.homeAssistant;
const sensors = config.sensors;
const TTL_MS = 10 * 1000;

async function fetchOne(entity) {
  const res = await fetch(
    `${baseUrl}/api/states/${encodeURIComponent(entity)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    throw new Error(`HA sensor ${entity} failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function fetchSensors() {
  if (!sensors.length) return [];

  const results = await Promise.allSettled(sensors.map((s) => fetchOne(s.entity)));

  const out = [];
  const errors = [];
  results.forEach((r, i) => {
    const cfg = sensors[i];
    if (r.status === 'rejected') {
      errors.push(`${cfg.entity}: ${r.reason?.message ?? r.reason}`);
      return;
    }
    const raw = parseFloat(r.value?.state);
    if (!Number.isFinite(raw)) return; // unavailable / unknown
    if (cfg.showAbove != null && raw <= cfg.showAbove) return;
    const value = typeof cfg.transform === 'function' ? cfg.transform(raw) : raw;
    out.push({
      entity: cfg.entity,
      label: cfg.label ?? r.value?.attributes?.friendly_name ?? cfg.entity,
      unit: cfg.unit ?? r.value?.attributes?.unit_of_measurement ?? '',
      value,
    });
  });

  // Only propagate failure if EVERY sensor failed (so cache serves last-good).
  if (errors.length === sensors.length) {
    throw new Error(errors.join('; '));
  }
  return out;
}

export const getSensors = ttlCache(fetchSensors, TTL_MS);
