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
    const factor = 10 ** (cfg.decimals ?? 0);
    const value = Math.round(raw * (cfg.multiplier ?? 1) * factor) / factor;
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

// History --------------------------------------------------------------

const HISTORY_TTL_MS = 5 * 60 * 1000;
const HISTORY_BUCKETS = 60;

async function fetchHistoryRaw(hours) {
  const end = new Date();
  const start = new Date(end.getTime() - hours * 60 * 60 * 1000);
  const filter = sensors.map((s) => s.entity).join(',');
  const url =
    `${baseUrl}/api/history/period/${encodeURIComponent(start.toISOString())}` +
    `?filter_entity_id=${encodeURIComponent(filter)}` +
    `&end_time=${encodeURIComponent(end.toISOString())}` +
    `&minimal_response&no_attributes`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`HA history failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

function downsample(rawPoints, buckets) {
  // rawPoints: [{ t: ISO, value: Number }, ...] sorted ascending.
  if (rawPoints.length === 0) return [];
  const tStart = new Date(rawPoints[0].t).getTime();
  const tEnd = new Date(rawPoints[rawPoints.length - 1].t).getTime();
  const span = Math.max(1, tEnd - tStart);
  const step = span / buckets;
  const sums = new Array(buckets).fill(0);
  const counts = new Array(buckets).fill(0);
  for (const p of rawPoints) {
    const idx = Math.min(buckets - 1, Math.floor((new Date(p.t).getTime() - tStart) / step));
    sums[idx] += p.value;
    counts[idx] += 1;
  }
  const out = [];
  let lastVal = rawPoints[0].value;
  for (let i = 0; i < buckets; i++) {
    if (counts[i] > 0) lastVal = sums[i] / counts[i];
    out.push({ t: new Date(tStart + step * i).toISOString(), value: lastVal });
  }
  return out;
}

async function fetchHistory(hours) {
  const data = await fetchHistoryRaw(hours);
  const byEntity = new Map();
  for (const events of data) {
    if (!events?.length) continue;
    const eid = events[0].entity_id;
    if (eid) byEntity.set(eid, events);
  }
  return sensors.map((cfg) => {
    const events = byEntity.get(cfg.entity) ?? [];
    const raw = [];
    for (const e of events) {
      const v = parseFloat(e.state);
      if (!Number.isFinite(v)) continue;
      const factor = 10 ** (cfg.decimals ?? 0);
      const value = Math.round(v * (cfg.multiplier ?? 1) * factor) / factor;
      raw.push({ t: e.last_changed, value });
    }
    return {
      entity: cfg.entity,
      label: cfg.label,
      unit: cfg.unit,
      points: downsample(raw, HISTORY_BUCKETS),
    };
  });
}

let historyCache = null;
let historyAt = 0;

export async function getSensorHistory(hours = 12) {
  const now = Date.now();
  if (historyCache && now - historyAt < HISTORY_TTL_MS) return historyCache;
  historyCache = await fetchHistory(hours);
  historyAt = now;
  return historyCache;
}
