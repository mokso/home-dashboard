import { config } from '../config.js';
import { ttlCache } from '../lib/cache.js';

const TTL_MS = 30 * 1000;
const { url, apiKey } = config.uptimeKuma;

// Kuma's Prometheus endpoint: monitor_status{monitor_name="X",...} 0=down 1=up 2=pending 3=maintenance.
export function parseDown(text) {
  const down = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^monitor_status\{(.*)\}\s+(\d+)/);
    if (!m || m[2] !== '0') continue;
    const name = m[1].match(/monitor_name="((?:[^"\\]|\\.)*)"/);
    if (name) down.push(name[1].replace(/\\(.)/g, '$1'));
  }
  return down;
}

async function fetchDown() {
  const res = await fetch(`${url}/metrics`, {
    headers: { Authorization: 'Basic ' + Buffer.from(':' + apiKey).toString('base64') },
  });
  if (!res.ok) throw new Error(`uptime kuma failed: ${res.status} ${res.statusText}`);
  return { down: parseDown(await res.text()) };
}

export const getUptime = ttlCache(fetchDown, TTL_MS);
