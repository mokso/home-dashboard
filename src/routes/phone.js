import { config } from '../config.js';

// The phone itself runs in the browser (Enreach web phone); the server only serves the speed dials.
export async function phoneRoutes(fastify) {
  if (!config.phoneContacts.length) return;
  fastify.get('/api/phone/contacts', async () => config.phoneContacts);
}
