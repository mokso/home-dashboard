import { getSensorHistory } from '../sources/sensors.js';

export async function sensorRoutes(fastify) {
  fastify.get('/api/sensors/history', async (req, reply) => {
    try {
      const hours = Math.min(48, Math.max(1, Number(req.query.hours) || 12));
      const data = await getSensorHistory(hours);
      reply.header('Cache-Control', 'no-store');
      return data;
    } catch (err) {
      fastify.log.error({ err }, 'sensor history fetch failed');
      reply.code(503);
      return { error: 'history unavailable' };
    }
  });
}
