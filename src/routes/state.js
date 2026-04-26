import { getWeather } from '../sources/weather.js';
import { getCalendar } from '../sources/calendar.js';
import { getSensors } from '../sources/sensors.js';
import { getElectricity } from '../sources/electricity.js';
import { recordSuccess, recordError } from '../lib/health.js';

const sources = [
  ['weather', getWeather],
  ['calendar', getCalendar],
  ['sensors', getSensors],
  ['electricity', getElectricity],
];

export async function stateRoutes(fastify) {
  fastify.get('/api/state', async (req, reply) => {
    const results = await Promise.allSettled(sources.map(([, fn]) => fn()));

    const out = { ts: new Date().toISOString(), errors: {} };
    sources.forEach(([key], i) => {
      const r = results[i];
      if (r.status === 'fulfilled') {
        out[key] = r.value;
        recordSuccess(key);
      } else {
        out[key] = null;
        out.errors[key] = String(r.reason?.message ?? r.reason);
        recordError(key, r.reason);
        fastify.log.error({ err: r.reason, source: key }, 'source fetch failed');
      }
    });

    reply.header('Cache-Control', 'no-store');
    return out;
  });
}
