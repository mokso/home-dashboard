function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function csv(name) {
  return (process.env[name] ?? '').split(/[\s,]+/).filter(Boolean);
}

function num(name, defaultValue) {
  const v = process.env[name];
  if (v == null || v === '') return defaultValue;
  const n = Number(v);
  return Number.isFinite(n) ? n : defaultValue;
}

function parseSensors() {
  const out = [];
  for (let i = 1; i <= 20; i++) {
    const entity = process.env[`SENSOR_${i}_ENTITY`];
    if (!entity) continue;
    out.push({
      entity,
      label: process.env[`SENSOR_${i}_LABEL`] ?? entity,
      unit: process.env[`SENSOR_${i}_UNIT`] ?? '',
      decimals: num(`SENSOR_${i}_DECIMALS`, 0),
      multiplier: num(`SENSOR_${i}_MULTIPLIER`, 1),
      showAbove: num(`SENSOR_${i}_SHOW_ABOVE`, null),
      text: process.env[`SENSOR_${i}_TEXT`] === 'true',
    });
  }
  return out;
}

export const config = {
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || '0.0.0.0',
  password: process.env.DASHBOARD_PASSWORD || null,
  title: process.env.DASHBOARD_TITLE || 'Family Dashboard',
  immich: {
    baseUrl: required('IMMICH_BASE_URL').replace(/\/+$/, ''),
    apiKey: required('IMMICH_API_KEY'),
    personIds: csv('IMMICH_PERSON_IDS'),
    photoIntervalSeconds: Number(process.env.IMMICH_PHOTO_INTERVAL_SECONDS) || 300,
  },
  weather: {
    latitude: Number(required('WEATHER_LATITUDE')),
    longitude: Number(required('WEATHER_LONGITUDE')),
    timezone: process.env.WEATHER_TIMEZONE || 'UTC',
    hourlyCount: num('WEATHER_HOURLY_COUNT', 5),
  },
  homeAssistant: {
    baseUrl: required('HA_BASE_URL').replace(/\/+$/, ''),
    token: required('HA_TOKEN'),
  },
  calendar: {
    entities: csv('CALENDAR_ENTITIES'),
    daysAhead: Number(process.env.CALENDAR_DAYS_AHEAD) || 5,
  },
  electricity: {
    greenBelow: num('ELEC_GREEN_BELOW', 10),
    redAbove: num('ELEC_RED_ABOVE', 20),
  },
  sensors: parseSensors(),
  cameras: csv('CAMERA_ENTITIES'),
};
