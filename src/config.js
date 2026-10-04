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

// MUSIC_SPEAKERS=media_player.a=Keittiö,media_player.b — label optional.
// MUSIC_PLAYER is always included (first) so the default stays selectable.
function parseSpeakers() {
  const player = process.env.MUSIC_PLAYER;
  if (!player) return [];
  const list = (process.env.MUSIC_SPEAKERS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [entity, ...label] = s.split('=');
      return { entity: entity.trim(), label: label.join('=').trim() || null };
    });
  if (!list.some((s) => s.entity === player)) list.unshift({ entity: player, label: null });
  return list;
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

function parseControls() {
  const out = [];
  for (let i = 1; i <= 20; i++) {
    const entity = process.env[`CONTROL_${i}_ENTITY`];
    if (!entity) continue;
    out.push({
      entity,
      label: process.env[`CONTROL_${i}_LABEL`] ?? entity,
      statusEntity: process.env[`CONTROL_${i}_STATUS_ENTITY`] || null,
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
  radar: {
    // On by default (uses WEATHER_LATITUDE/LONGITUDE); FMI data covers Finland only.
    enabled: process.env.RADAR_ENABLED !== 'false',
    zoom: Math.min(12, Math.max(5, Math.round(num('RADAR_ZOOM', 9)))),
    frameCount: Math.min(36, Math.max(1, Math.round(num('RADAR_FRAMES', 12)))),
    basemapUrl: process.env.RADAR_BASEMAP_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    // CSS filter for the base map; the default turns light OSM tiles dark.
    basemapFilter: process.env.RADAR_BASEMAP_FILTER ?? 'invert(1) hue-rotate(180deg) grayscale(0.7) brightness(0.75) contrast(1.1)',
  },
  sensors: parseSensors(),
  cameras: csv('CAMERA_ENTITIES'),
  controls: parseControls(),
  music: {
    player: process.env.MUSIC_PLAYER || null,
    speakers: parseSpeakers(),
    libraryLimit: num('MUSIC_LIBRARY_LIMIT', 500),
    // Optional direct Music Assistant API access, for "recently played".
    assistant: {
      url: (process.env.MUSIC_ASSISTANT_URL || '').replace(/\/+$/, '') || null,
      token: process.env.MUSIC_ASSISTANT_TOKEN || null,
    },
  },
  voice: {
    stt: process.env.VOICE_STT || null,
    tts: process.env.VOICE_TTS || null,
    agent: process.env.VOICE_AGENT || 'conversation.home_assistant',
    // Try HA's built-in agent first and fall back to VOICE_AGENT only when it
    // doesn't understand (like HA's "prefer handling commands locally").
    preferLocal: process.env.VOICE_PREFER_LOCAL !== 'false',
    language: process.env.VOICE_LANGUAGE || 'fi-FI',
  },
};
