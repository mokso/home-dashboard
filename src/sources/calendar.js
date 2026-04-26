import { config } from '../config.js';
import { ttlCache } from '../lib/cache.js';

const { baseUrl, token } = config.homeAssistant;
const { entities, daysAhead } = config.calendar;
const TTL_MS = 5 * 60 * 1000;

async function fetchOne(entity, startIso, endIso) {
  const url =
    `${baseUrl}/api/calendars/${encodeURIComponent(entity)}` +
    `?start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`HA calendar ${entity} failed: ${res.status} ${res.statusText}`);
  }
  const events = await res.json();
  return events.map((e) => {
    const allDay = !!(e.start?.date && !e.start?.dateTime);
    return {
      summary: e.summary ?? '',
      start: e.start?.dateTime ?? e.start?.date ?? null,
      end: e.end?.dateTime ?? e.end?.date ?? null,
      allDay,
      location: e.location || null,
      calendar: entity,
    };
  });
}

async function fetchEvents() {
  const now = new Date();
  const end = new Date(now);
  end.setUTCDate(end.getUTCDate() + daysAhead);
  const startIso = now.toISOString();
  const endIso = end.toISOString();

  const results = await Promise.allSettled(
    entities.map((e) => fetchOne(e, startIso, endIso)),
  );

  const events = [];
  const errors = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled') events.push(...r.value);
    else errors.push(`${entities[i]}: ${r.reason?.message ?? r.reason}`);
  }

  // If every calendar failed, propagate so the cache serves last-known-good.
  if (errors.length === entities.length && entities.length > 0) {
    throw new Error(errors.join('; '));
  }

  // Sort chronologically.
  events.sort((a, b) => String(a.start).localeCompare(String(b.start)));
  return events;
}

export const getCalendar = ttlCache(fetchEvents, TTL_MS);
