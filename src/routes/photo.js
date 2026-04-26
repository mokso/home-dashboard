import { getNextPhotoMeta, getThumbnail } from '../sources/immich.js';
import { recordSuccess, recordError } from '../lib/health.js';

export async function photoRoutes(fastify) {
  fastify.get('/api/photo/next', async (req, reply) => {
    try {
      const meta = await getNextPhotoMeta();
      recordSuccess('photo');
      reply.header('Cache-Control', 'no-store');
      return meta;
    } catch (err) {
      recordError('photo', err);
      fastify.log.error({ err }, 'photo metadata fetch failed');
      reply.code(503);
      return { error: 'photo unavailable' };
    }
  });

  fastify.get('/api/photo/asset/:id', async (req, reply) => {
    const { id } = req.params;
    try {
      const { contentType, body } = await getThumbnail(id);
      recordSuccess('photo');
      reply.header('Cache-Control', 'public, max-age=3600');
      reply.type(contentType);
      return reply.send(body);
    } catch (err) {
      recordError('photo', err);
      fastify.log.error({ err, id }, 'thumbnail fetch failed');
      reply.code(503);
      return { error: 'thumbnail unavailable' };
    }
  });
}
