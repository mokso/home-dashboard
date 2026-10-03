import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { ttlCache } from '../lib/cache.js';
import { recordSuccess, recordError } from '../lib/health.js';

const { baseUrl, token } = config.homeAssistant;
const { player: defaultPlayer, speakers, libraryLimit, assistant } = config.music;
const headers = { Authorization: `Bearer ${token}` };

const PLAYER_TTL_MS = 2 * 1000;
const LIBRARY_TTL_MS = 10 * 60 * 1000;
const SPEAKERS_TTL_MS = 10 * 60 * 1000;
const LIBRARY_TYPES = ['playlist', 'album', 'artist'];
const RECENT_LIMIT = 24;
// One of the sizes Music Assistant's image proxy accepts (0, 80, 160, 256, 512, 1024).
const THUMB_SIZE = 256;

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

function callServiceWithResponse(domain, service, data) {
  return haJson(`/api/services/${domain}/${service}?return_response`, {
    method: 'POST',
    body: JSON.stringify(data),
  }).then((r) => r.service_response);
}

// Speakers ----------------------------------------------------------------

// The speaker the dashboard controls. In memory only: a restart goes back to
// MUSIC_PLAYER.
let activePlayer = defaultPlayer;

export function getActivePlayer() {
  return activePlayer;
}

export function setActivePlayer(entity) {
  activePlayer = entity;
}

async function fetchSpeakerNames() {
  return Promise.all(
    speakers.map(async (s) => {
      if (s.label) return s.label;
      try {
        const body = await haJson(`/api/states/${encodeURIComponent(s.entity)}`);
        return body.attributes?.friendly_name ?? s.entity;
      } catch {
        return s.entity;
      }
    }),
  );
}

export const getSpeakerNames = ttlCache(fetchSpeakerNames, SPEAKERS_TTL_MS);

// Player -----------------------------------------------------------------

const artPaths = new Map(); // entity -> entity_picture (contains an HA token)

async function fetchNextItem(entity) {
  try {
    const res = await callServiceWithResponse('music_assistant', 'get_queue', { entity_id: entity });
    const item = res?.[entity]?.next_item;
    if (!item) return null;
    const media = item.media_item;
    return {
      title: media?.name ?? item.name ?? null,
      artist: media?.artists?.map((a) => a.name).join(', ') || null,
    };
  } catch {
    return null;
  }
}

export async function fetchPlayer(entity = activePlayer) {
  try {
    const body = await haJson(`/api/states/${encodeURIComponent(entity)}`);
    const a = body.attributes ?? {};
    const artPath = a.entity_picture ?? null;
    artPaths.set(entity, artPath);
    const active = body.state === 'playing' || body.state === 'paused';
    const next = active ? await fetchNextItem(entity) : null;
    recordSuccess('music');
    return {
      entity,
      state: body.state,
      title: a.media_title ?? null,
      artist: a.media_artist ?? null,
      album: a.media_album_name ?? null,
      volume: a.volume_level ?? null,
      shuffle: a.shuffle ?? null,
      repeat: a.repeat ?? null,
      duration: a.media_duration ?? null,
      position: a.media_position ?? null,
      positionAt: a.media_position_updated_at ? Date.parse(a.media_position_updated_at) : null,
      next,
      // Changes whenever the artwork does, so the frontend knows to reload it.
      // Hashed because entity_picture carries an HA access token.
      artKey: artPath ? createHash('sha1').update(artPath).digest('hex').slice(0, 12) : null,
    };
  } catch (err) {
    recordError('music', err);
    throw err;
  }
}

const playerCaches = new Map();

export function getPlayer() {
  const entity = activePlayer;
  if (!playerCaches.has(entity)) playerCaches.set(entity, ttlCache(() => fetchPlayer(entity), PLAYER_TTL_MS));
  return playerCaches.get(entity)();
}

// entity_picture is either an HA-relative proxy path or an absolute URL.
export async function fetchArt() {
  const artPath = artPaths.get(activePlayer);
  if (!artPath) return null;
  const url = artPath.startsWith('http') ? artPath : `${baseUrl}${artPath}`;
  const res = await fetch(url, { headers: artPath.startsWith('http') ? {} : headers });
  if (!res.ok) return null;
  return { type: res.headers.get('content-type') || 'image/jpeg', buf: Buffer.from(await res.arrayBuffer()) };
}

// Library ----------------------------------------------------------------

let configEntryId = null;

async function getConfigEntryId() {
  if (configEntryId) return configEntryId;
  const entries = await haJson('/api/config/config_entries/entry?domain=music_assistant');
  configEntryId = entries.find((e) => e.state === 'loaded')?.entry_id ?? entries[0]?.entry_id;
  if (!configEntryId) throw new Error('Music Assistant integration not found in HA');
  return configEntryId;
}

// Music Assistant's image proxy serves full size with size=0; ask for a
// thumbnail instead so the grid stays light.
function thumbUrl(image) {
  if (typeof image !== 'string' || !image.startsWith('http')) return null;
  return image.includes('/imageproxy/') ? image.replace(/([?&]size=)0\b/, `$1${THUMB_SIZE}`) : image;
}

// Music Assistant uses "[unknown]" for missing artists; show nothing instead.
function artistNames(item) {
  return item.artists?.map((a) => a.name).filter((n) => n && n !== '[unknown]').join(', ') || null;
}

function toItem(item, group, image = item.image) {
  return {
    group,
    name: item.name,
    subtitle: artistNames(item),
    uri: item.uri,
    mediaType: item.media_type,
    favorite: !!item.favorite,
    image: thumbUrl(image),
  };
}

// Recently played comes straight from the Music Assistant API: HA's
// get_library can sort by last played but can't tell never-played items
// apart. Read-only; playback still goes through HA.
async function maCommand(command, args) {
  const res = await fetch(`${assistant.url}/api`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${assistant.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, args, message_id: command }),
  });
  if (!res.ok) throw new Error(`Music Assistant ${command} failed: ${res.status} ${res.statusText}`);
  const body = await res.json();
  return body?.result ?? body;
}

// MA images are { path, provider, remotely_accessible }; local ones go
// through MA's image proxy.
function maImageUrl(item) {
  const img = item.image ?? item.metadata?.images?.[0];
  if (!img?.path) return null;
  if (img.remotely_accessible && img.path.startsWith('http')) return img.path;
  const q = new URLSearchParams({ path: img.path, provider: img.provider, size: String(THUMB_SIZE) });
  return `${assistant.url}/imageproxy?${q}`;
}

// The recently played list holds bare references without artists, so tracks
// and albums are looked up in full (cheap, and cached with the library).
async function withArtists(item) {
  if (item.media_type !== 'track' && item.media_type !== 'album') return item;
  try {
    const full = await maCommand('music/item_by_uri', { uri: item.uri });
    return { ...item, artists: full?.artists };
  } catch {
    return item;
  }
}

async function fetchRecent() {
  if (!assistant.url || !assistant.token) return [];
  const items = await maCommand('music/recently_played_items', { limit: RECENT_LIMIT });
  const full = await Promise.all((Array.isArray(items) ? items : []).filter((i) => i?.uri).map(withArtists));
  return full.map((i) => toItem(i, 'recent', maImageUrl(i)));
}

async function fetchLibrary() {
  const entryId = await getConfigEntryId();
  const query = (params) =>
    callServiceWithResponse('music_assistant', 'get_library', { config_entry_id: entryId, ...params })
      .then((r) => r?.items ?? []);
  const [recent, library] = await Promise.all([
    // A broken MA token shouldn't take the whole library down with it.
    fetchRecent().catch((err) => {
      recordError('music', err);
      return [];
    }),
    Promise.all(LIBRARY_TYPES.map((media_type) => query({ media_type, order_by: 'sort_name', limit: libraryLimit }))),
  ]);
  return [
    ...recent,
    ...library.flatMap((items, i) =>
      // Favourites first, otherwise keep Music Assistant's name order.
      [...items].sort((a, b) => Number(!!b.favorite) - Number(!!a.favorite)).map((item) => toItem(item, LIBRARY_TYPES[i])),
    ),
  ];
}

export const getLibrary = ttlCache(fetchLibrary, LIBRARY_TTL_MS);
