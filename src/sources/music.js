import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { ttlCache } from '../lib/cache.js';
import { recordSuccess, recordError } from '../lib/health.js';

const { baseUrl, token } = config.homeAssistant;
const { player, presetLimit } = config.music;
const headers = { Authorization: `Bearer ${token}` };

const PLAYER_TTL_MS = 2 * 1000;
const PRESETS_TTL_MS = 10 * 60 * 1000;
const PRESET_TYPES = ['playlist', 'radio', 'album', 'artist'];

async function haJson(path, opts = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...opts,
    headers: { ...headers, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (!res.ok) throw new Error(`HA ${path} failed: ${res.status} ${res.statusText}`);
  return res.json();
}

export function callService(domain, service, data) {
  return haJson(`/api/services/${domain}/${service}`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// Player -----------------------------------------------------------------

let artPath = null;

export async function fetchPlayer() {
  try {
    const body = await haJson(`/api/states/${encodeURIComponent(player)}`);
    const a = body.attributes ?? {};
    artPath = a.entity_picture ?? null;
    recordSuccess('music');
    return {
      state: body.state,
      title: a.media_title ?? null,
      artist: a.media_artist ?? null,
      album: a.media_album_name ?? null,
      volume: a.volume_level ?? null,
      // Changes whenever the artwork does, so the frontend knows to reload it.
      // Hashed because entity_picture carries an HA access token.
      artKey: artPath ? createHash('sha1').update(artPath).digest('hex').slice(0, 12) : null,
    };
  } catch (err) {
    recordError('music', err);
    throw err;
  }
}

export const getPlayer = ttlCache(fetchPlayer, PLAYER_TTL_MS);

// entity_picture is either an HA-relative proxy path or an absolute URL.
export async function fetchArt() {
  if (!artPath) return null;
  const url = artPath.startsWith('http') ? artPath : `${baseUrl}${artPath}`;
  const res = await fetch(url, { headers: artPath.startsWith('http') ? {} : headers });
  if (!res.ok) return null;
  return { type: res.headers.get('content-type') || 'image/jpeg', buf: Buffer.from(await res.arrayBuffer()) };
}

// Presets (Music Assistant favourites) -----------------------------------

let configEntryId = null;

async function getConfigEntryId() {
  if (configEntryId) return configEntryId;
  const entries = await haJson('/api/config/config_entries/entry?domain=music_assistant');
  configEntryId = entries.find((e) => e.state === 'loaded')?.entry_id ?? entries[0]?.entry_id;
  if (!configEntryId) throw new Error('Music Assistant integration not found in HA');
  return configEntryId;
}

async function fetchPresets() {
  const entryId = await getConfigEntryId();
  const results = await Promise.all(
    PRESET_TYPES.map((media_type) =>
      haJson('/api/services/music_assistant/get_library?return_response', {
        method: 'POST',
        body: JSON.stringify({ config_entry_id: entryId, media_type, favorite: true, limit: presetLimit }),
      }),
    ),
  );
  return results
    .flatMap((r) => r.service_response?.items ?? [])
    .slice(0, presetLimit)
    .map((item) => ({
      name: item.name,
      uri: item.uri,
      mediaType: item.media_type,
      image: typeof item.image === 'string' && item.image.startsWith('http') ? item.image : null,
    }));
}

export const getPresets = ttlCache(fetchPresets, PRESETS_TTL_MS);
