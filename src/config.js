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

export const config = {
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || '0.0.0.0',
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
  sensors: [
    { entity: 'sensor.palju_vesi',      label: 'Palju',         unit: '°C',  showAbove: num('SENSOR_PALJU_SHOW_ABOVE', 25), transform: Math.round },
    { entity: 'sensor.sauna_lampotila', label: 'Sauna',         unit: '°C',  showAbove: num('SENSOR_SAUNA_SHOW_ABOVE', 40), transform: Math.round },
    { entity: 'sensor.inverter_pv_power',         label: 'Tuotantoteho',  unit: 'kW',  transform: (v) => Math.round(v / 100) / 10 },
    { entity: 'sensor.inverter_today_production', label: 'Tuotanto tänään', unit: 'kWh', transform: (v) => Math.round(v * 10) / 10 },
  ],
};
