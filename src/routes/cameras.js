import { config } from '../config.js';
import { ttlCache } from '../lib/cache.js';

const { baseUrl, token } = config.homeAssistant;

function entityToLabel(entity) {
  return entity
    .replace(/^camera\./, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function cameraRoutes(fastify) {
  const cameras = config.cameras;
  if (!cameras.length) return;

  fastify.get('/api/cameras', async () =>
    cameras.map((entity, index) => ({ index, entity, label: entityToLabel(entity) })),
  );

  fastify.get('/api/cameras/:index/snapshot', async (req, reply) => {
    const i = Number(req.params.index);
    if (!Number.isFinite(i) || i < 0 || i >= cameras.length) {
      reply.code(404);
      return { error: 'camera not found' };
    }
    const entity = cameras[i];
    try {
      const res = await fetch(
        `${baseUrl}/api/camera_proxy/${encodeURIComponent(entity)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) {
        reply.code(502);
        return { error: `HA returned ${res.status}` };
      }
      const buf = Buffer.from(await res.arrayBuffer());
      reply.type(res.headers.get('content-type') || 'image/jpeg');
      reply.header('Cache-Control', 'no-store');
      return reply.send(buf);
    } catch (err) {
      fastify.log.error({ err }, `camera snapshot failed: ${entity}`);
      reply.code(503);
      return { error: 'camera unavailable' };
    }
  });

  const { entity: doorbell, camera: doorbellCamera } = config.doorbell;
  if (!doorbell) return;

  // Every open page polls this every 2 s; the short cache keeps HA at one request per second.
  const doorbellState = ttlCache(async () => {
    const res = await fetch(
      `${baseUrl}/api/states/${encodeURIComponent(doorbell)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new Error(`HA doorbell ${doorbell} failed: ${res.status}`);
    const s = await res.json();
    return { state: s.state, lastChanged: s.last_changed, camera: cameras.indexOf(doorbellCamera) };
  }, 1000);

  fastify.get('/api/doorbell', async (req, reply) => {
    try {
      return await doorbellState();
    } catch (err) {
      fastify.log.error({ err }, 'doorbell state failed');
      reply.code(503);
      return { error: 'doorbell unavailable' };
    }
  });
}
