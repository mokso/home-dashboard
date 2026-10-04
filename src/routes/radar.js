import { config } from '../config.js';

export async function radarRoutes(fastify) {
  if (!config.radar.enabled) return;
  const { grid, getFrames, getFrame, getTile } = await import('../sources/radar.js');

  fastify.get('/api/radar', async (req, reply) => {
    try {
      return { ...grid, frames: await getFrames() };
    } catch (err) {
      fastify.log.error({ err }, 'radar frames failed');
      reply.code(503);
      return { error: 'radar unavailable' };
    }
  });

  fastify.get('/api/radar/frame/:time', async (req, reply) => {
    try {
      const frame = await getFrame(req.params.time);
      if (!frame) {
        reply.code(404);
        return { error: 'frame not found' };
      }
      reply.type(frame.type);
      reply.header('Cache-Control', 'private, max-age=86400, immutable');
      return reply.send(frame.buf);
    } catch (err) {
      fastify.log.warn({ err }, 'radar frame failed');
      reply.code(503);
      return { error: 'frame unavailable' };
    }
  });

  fastify.get('/api/radar/tile/:x/:y', async (req, reply) => {
    try {
      const tile = await getTile(Number(req.params.x), Number(req.params.y));
      if (!tile) {
        reply.code(404);
        return { error: 'tile not found' };
      }
      reply.type(tile.type);
      reply.header('Cache-Control', 'private, max-age=604800');
      return reply.send(tile.buf);
    } catch (err) {
      fastify.log.warn({ err }, 'radar tile failed');
      reply.code(503);
      return { error: 'tile unavailable' };
    }
  });
}
