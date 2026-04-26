import { config } from '../config.js';
import { ttlCache } from '../lib/cache.js';

const TTL_MS = 30 * 60 * 1000;
const URL = 'https://api.spot-hinta.fi/TodayAndDayForward';
const { greenBelow, redAbove } = config.electricity;

function tier(price) {
  if (price < greenBelow) return 'cheap';
  if (price > redAbove) return 'high';
  return 'mid';
}

async function fetchPrices() {
  const res = await fetch(URL);
  if (!res.ok) {
    throw new Error(`spot-hinta failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();

  // Spot-hinta returns 15-min slots; aggregate to hourly averages.
  const byHour = new Map();
  for (const e of data) {
    const dt = e.DateTime;
    if (!dt) continue;
    const hourKey = dt.slice(0, 13); // "YYYY-MM-DDTHH"
    if (!byHour.has(hourKey)) {
      // Build a clean hour-aligned timestamp by replacing minutes/seconds.
      const t = dt.slice(0, 14) + '00:00' + dt.slice(19);
      byHour.set(hourKey, { t, sum: 0, count: 0 });
    }
    const slot = byHour.get(hourKey);
    slot.sum += e.PriceWithTax;
    slot.count += 1;
  }

  const hourlyAll = [...byHour.values()]
    .sort((a, b) => a.t.localeCompare(b.t))
    .map(({ t, sum, count }) => {
      const price = (sum / count) * 100; // EUR/kWh → c/kWh
      return { t, price, tier: tier(price) };
    });

  // Slice 24 hours starting from the hour that contains "now".
  const now = new Date();
  const startIdx = hourlyAll.findIndex((h) => {
    const hStart = new Date(h.t);
    const hEnd = new Date(hStart.getTime() + 60 * 60 * 1000);
    return hStart <= now && now < hEnd;
  });
  const start = startIdx >= 0 ? startIdx : 0;
  const hours = hourlyAll.slice(start, start + 24);

  return {
    now: hours[0]?.price ?? null,
    currency: 'c/kWh',
    hours,
  };
}

export const getElectricity = ttlCache(fetchPrices, TTL_MS);
