import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import { photoRoutes } from './routes/photo.js';
import { stateRoutes } from './routes/state.js';
import { sensorRoutes } from './routes/sensors.js';
import { warmup, setLogger } from './sources/immich.js';
import { health } from './lib/health.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
  },
});

setLogger(fastify.log);

await fastify.register(fastifyStatic, {
  root: publicDir,
  prefix: '/',
});

if (config.password) {
  fastify.addHook('onRequest', (req, reply, done) => {
    if (!req.url.startsWith('/api/')) return done();
    if (req.headers['x-dashboard-password'] === config.password) return done();
    reply.code(401).send({ error: 'unauthorized' });
  });
}

await fastify.register(photoRoutes);
await fastify.register(stateRoutes);
await fastify.register(sensorRoutes);

fastify.get('/api/health', async () => ({
  ok: true,
  uptime: Math.round(process.uptime()),
  sources: health,
}));

try {
  await fastify.listen({ port: config.port, host: config.host });
  warmup().catch((err) => fastify.log.error({ err }, 'immich warmup failed'));
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
