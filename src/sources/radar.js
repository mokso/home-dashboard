import { config } from '../config.js';
import { ttlCache } from '../lib/cache.js';
import { recordSuccess, recordError } from '../lib/health.js';

// FMI open data radar composite (Finland, 5 min steps), drawn on Web Mercator
// base tiles. The map is a fixed grid of tiles centred on the home location;
// radar frames are requested for exactly the grid's extent so they line up.

const WMS_URL = 'https://openwms.fmi.fi/geoserver/Radar/wms';
const LAYER = 'suomi_dbz_eureffin';
const CAPS_URL = `https://openwms.fmi.fi/geoserver/Radar/${LAYER}/wms?service=WMS&version=1.3.0&request=GetCapabilities`;
const STEP_MS = 5 * 60 * 1000;
const TILE = 256;
const COLS = 9;
const ROWS = 7;
const ORIGIN = 20037508.342789244;
const USER_AGENT = 'home-dashboard (self-hosted wall display)';

const { zoom, frameCount, basemapUrl, basemapFilter } = config.radar;
const { latitude, longitude } = config.weather;

// Home position in world pixels at the configured zoom.
const worldPx = TILE * 2 ** zoom;
const latRad = (latitude * Math.PI) / 180;
const homeWorldX = ((longitude + 180) / 360) * worldPx;
const homeWorldY = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * worldPx;

const x0 = Math.floor(homeWorldX / TILE) - Math.floor(COLS / 2);
const y0 = Math.floor(homeWorldY / TILE) - Math.floor(ROWS / 2);

const metersPerPx = (2 * ORIGIN) / worldPx;
const bbox = [
  x0 * TILE * metersPerPx - ORIGIN,
  ORIGIN - (y0 + ROWS) * TILE * metersPerPx,
  (x0 + COLS) * TILE * metersPerPx - ORIGIN,
  ORIGIN - y0 * TILE * metersPerPx,
].map((n) => n.toFixed(2)).join(',');

export const grid = {
  zoom,
  tileSize: TILE,
  cols: COLS,
  rows: ROWS,
  x0,
  y0,
  width: COLS * TILE,
  height: ROWS * TILE,
  home: { x: homeWorldX - x0 * TILE, y: homeWorldY - y0 * TILE },
  basemapFilter,
};

// Latest frame time from the layer's time dimension, which looks like
// "start/end/PT5M" (or a comma-separated list).
function latestTime(xml) {
  const m = xml.match(/<Dimension[^>]*name="time"[^>]*>([^<]+)</);
  if (!m) throw new Error('radar: no time dimension in capabilities');
  const last = m[1].trim().split(',').pop();
  const end = last.includes('/') ? last.split('/')[1] : last;
  const t = Date.parse(end);
  if (!Number.isFinite(t)) throw new Error(`radar: bad time "${end}"`);
  return t;
}

export const getFrames = ttlCache(async () => {
  try {
    const res = await fetch(CAPS_URL, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`FMI capabilities ${res.status}`);
    const latest = latestTime(await res.text());
    const frames = [];
    for (let i = frameCount - 1; i >= 0; i--) {
      frames.push(new Date(latest - i * STEP_MS).toISOString().replace('.000Z', 'Z'));
    }
    pruneFrames(frames);
    recordSuccess('radar');
    return frames;
  } catch (err) {
    recordError('radar', err);
    throw err;
  }
}, 2 * 60 * 1000);

// time -> Promise<{ type, buf }>; only the frames currently listed are kept.
const frameCache = new Map();

function pruneFrames(keep) {
  for (const t of frameCache.keys()) if (!keep.includes(t)) frameCache.delete(t);
}

// Radar is ~500 m resolution, so half-size frames lose nothing visible.
export async function getFrame(time) {
  const frames = await getFrames();
  if (!frames.includes(time)) return null;
  if (!frameCache.has(time)) {
    const params = new URLSearchParams({
      service: 'WMS',
      version: '1.3.0',
      request: 'GetMap',
      layers: `Radar:${LAYER}`,
      styles: '',
      format: 'image/png',
      transparent: 'true',
      crs: 'EPSG:3857',
      bbox,
      width: String(grid.width / 2),
      height: String(grid.height / 2),
      time,
    });
    const p = fetch(`${WMS_URL}?${params}`, { headers: { 'User-Agent': USER_AGENT } })
      .then(async (res) => {
        const type = res.headers.get('content-type') || '';
        // WMS reports errors as XML with a 200 status.
        if (!res.ok || !type.startsWith('image/')) throw new Error(`FMI frame ${time}: ${res.status} ${type}`);
        return { type, buf: Buffer.from(await res.arrayBuffer()) };
      });
    frameCache.set(time, p);
    p.catch(() => frameCache.delete(time));
  }
  return frameCache.get(time);
}

// "x/y" -> Promise<{ type, buf }>; the grid is fixed, so this stays small.
const tileCache = new Map();

export function getTile(x, y) {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
  if (x < x0 || x >= x0 + COLS || y < y0 || y >= y0 + ROWS) return null;
  const key = `${x}/${y}`;
  if (!tileCache.has(key)) {
    const url = basemapUrl.replace('{z}', zoom).replace('{x}', x).replace('{y}', y);
    const p = fetch(url, { headers: { 'User-Agent': USER_AGENT } })
      .then(async (res) => {
        if (!res.ok) throw new Error(`basemap tile ${key}: ${res.status}`);
        return { type: res.headers.get('content-type') || 'image/png', buf: Buffer.from(await res.arrayBuffer()) };
      });
    tileCache.set(key, p);
    p.catch(() => tileCache.delete(key));
  }
  return tileCache.get(key);
}
