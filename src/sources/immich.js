import { config } from '../config.js';

const { baseUrl, apiKey, personIds } = config.immich;
const POOL_TTL_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 1000;

let assetIds = [];
let assetIdsAt = 0;
let cursor = 0;
let refreshing = null;
let lastMeta = null;
let lastBytes = null; // { id, contentType, body }

let logger = console;
export function setLogger(l) {
  logger = l;
}

async function searchAssetsPage(personId, page) {
  const res = await fetch(`${baseUrl}/api/search/metadata`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personIds: [personId],
      type: 'IMAGE',
      size: PAGE_SIZE,
      page,
      isArchived: false,
      isVisible: true,
      withExif: false,
    }),
  });
  if (!res.ok) {
    throw new Error(`Immich search failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function fetchAllAssetIds() {
  // Immich's metadata search ANDs personIds (intersection), so we union
  // results per-person and dedupe.
  const ids = new Set();
  const perPerson = {};
  for (const personId of personIds) {
    let page = 1;
    let count = 0;
    for (;;) {
      const data = await searchAssetsPage(personId, page);
      const items = data?.assets?.items ?? [];
      for (const it of items) ids.add(it.id);
      count += items.length;
      const nextPage = data?.assets?.nextPage;
      if (!nextPage) break;
      page = Number(nextPage);
    }
    perPerson[personId] = count;
  }
  return { ids: [...ids], perPerson };
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

async function refreshPool() {
  const start = Date.now();
  const { ids, perPerson } = await fetchAllAssetIds();
  shuffleInPlace(ids);
  assetIds = ids;
  assetIdsAt = Date.now();
  cursor = 0;
  logger.info(
    { count: ids.length, perPerson, ms: Date.now() - start },
    'immich pool refreshed',
  );
}

async function ensurePool() {
  const stale = Date.now() - assetIdsAt > POOL_TTL_MS;
  if (assetIds.length === 0) {
    if (!refreshing) {
      refreshing = refreshPool().finally(() => {
        refreshing = null;
      });
    }
    await refreshing;
  } else if (stale && !refreshing) {
    refreshing = refreshPool()
      .catch((err) => logger.error({ err }, 'immich pool refresh failed'))
      .finally(() => {
        refreshing = null;
      });
  }
  return assetIds;
}

function pickNext() {
  if (cursor >= assetIds.length) {
    shuffleInPlace(assetIds);
    cursor = 0;
  }
  return assetIds[cursor++];
}

async function fetchThumbnail(id) {
  const res = await fetch(`${baseUrl}/api/assets/${id}/thumbnail?size=preview`, {
    headers: { 'x-api-key': apiKey },
  });
  if (!res.ok) {
    throw new Error(`Immich thumbnail failed: ${res.status} ${res.statusText}`);
  }
  const body = Buffer.from(await res.arrayBuffer());
  return {
    contentType: res.headers.get('content-type') || 'image/jpeg',
    body,
  };
}

async function fetchAssetMeta(id) {
  const res = await fetch(`${baseUrl}/api/assets/${id}`, {
    headers: { 'x-api-key': apiKey },
  });
  if (!res.ok) {
    throw new Error(`Immich asset fetch failed: ${res.status} ${res.statusText}`);
  }
  const a = await res.json();
  const exif = a.exifInfo ?? {};
  const place = [exif.city, exif.country].filter(Boolean).join(', ') || null;
  return {
    id: a.id,
    takenAt: a.localDateTime ?? a.fileCreatedAt ?? null,
    place,
  };
}

export async function warmup() {
  return ensurePool();
}

export async function getNextPhotoMeta() {
  try {
    await ensurePool();
    const id = pickNext();
    if (!id) throw new Error('Empty asset pool');
    const meta = await fetchAssetMeta(id);
    lastMeta = meta;
    return meta;
  } catch (err) {
    if (lastMeta) {
      logger.warn({ err: err.message }, 'serving cached metadata after immich error');
      return lastMeta;
    }
    throw err;
  }
}

export async function getThumbnail(id) {
  try {
    const result = await fetchThumbnail(id);
    lastBytes = { id, ...result };
    return lastBytes;
  } catch (err) {
    if (lastBytes) {
      logger.warn({ err: err.message }, 'serving cached thumbnail after immich error');
      return lastBytes;
    }
    throw err;
  }
}
