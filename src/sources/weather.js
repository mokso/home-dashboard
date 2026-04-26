import { config } from '../config.js';
import { ttlCache } from '../lib/cache.js';

const { latitude, longitude, timezone } = config.weather;
const TTL_MS = 15 * 60 * 1000;

const url =
  `https://api.open-meteo.com/v1/forecast?latitude=${latitude}` +
  `&longitude=${longitude}` +
  `&current=temperature_2m,weather_code` +
  `&hourly=temperature_2m,weather_code` +
  `&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_sum` +
  `&forecast_days=3` +
  `&timezone=${encodeURIComponent(timezone)}`;

async function fetchWeather() {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Open-Meteo failed: ${res.status} ${res.statusText}`);
  }
  const d = await res.json();
  const dates = d.daily?.time ?? [];
  const daily = dates.map((date, i) => ({
    date,
    min: d.daily?.temperature_2m_min?.[i] ?? null,
    max: d.daily?.temperature_2m_max?.[i] ?? null,
    code: d.daily?.weather_code?.[i] ?? null,
    precip: d.daily?.precipitation_sum?.[i] ?? null,
  }));
  // Open-Meteo returns hourly times TZ-aligned to the configured timezone
  // (e.g. "2026-04-26T12:00", no offset suffix). The "current" block carries
  // the same TZ-local time, so we anchor "next 5 hours" off that.
  const cutoff = d.current?.time ?? '';
  const hourlyTimes = d.hourly?.time ?? [];
  const startIdx = hourlyTimes.findIndex((t) => t > cutoff);
  const hourly = startIdx >= 0
    ? hourlyTimes.slice(startIdx, startIdx + 5).map((time, k) => ({
        time,
        temp: d.hourly?.temperature_2m?.[startIdx + k] ?? null,
        code: d.hourly?.weather_code?.[startIdx + k] ?? null,
      }))
    : [];

  return {
    now: {
      temp: d.current?.temperature_2m ?? null,
      code: d.current?.weather_code ?? null,
    },
    hourly,
    daily,
  };
}

export const getWeather = ttlCache(fetchWeather, TTL_MS);
