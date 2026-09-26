import { config } from '../config.js';
import { getPlayer, fetchPlayer, fetchArt, getPresets, callService } from '../sources/music.js';

const { player } = config.music;

const COMMANDS = {
  play_pause: () => ['media_play_pause', {}],
  next: () => ['media_next_track', {}],
  previous: () => ['media_previous_track', {}],
  volume: (value) =>
    typeof value === 'number' && value >= 0 && value <= 1
      ? ['volume_set', { volume_level: value }]
      : null,
};

export async function musicRoutes(fastify) {
  if (!player) return;

  fastify.get('/api/music', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    try {
      return await getPlayer();
    } catch (err) {
      return { state: 'unavailable' };
    }
  });

  fastify.get('/api/music/art', async (req, reply) => {
    try {
      const art = await fetchArt();
      if (!art) {
        reply.code(404);
        return { error: 'no artwork' };
      }
      reply.type(art.type);
      reply.header('Cache-Control', 'max-age=3600');
      return reply.send(art.buf);
    } catch (err) {
      reply.code(503);
      return { error: 'artwork unavailable' };
    }
  });

  fastify.post('/api/music/command', async (req, reply) => {
    const call = COMMANDS[req.body?.action]?.(req.body?.value);
    if (!call) {
      reply.code(400);
      return { error: 'invalid command' };
    }
    const [service, data] = call;
    try {
      await callService('media_player', service, { entity_id: player, ...data });
      return await fetchPlayer();
    } catch (err) {
      fastify.log.error({ err }, `music command failed: ${service}`);
      reply.code(503);
      return { error: 'player unavailable' };
    }
  });

  fastify.get('/api/music/presets', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    try {
      const presets = await getPresets();
      return presets.map((p, index) => ({ index, uri: p.uri, name: p.name, mediaType: p.mediaType, hasImage: !!p.image }));
    } catch (err) {
      fastify.log.error({ err }, 'music presets fetch failed');
      return [];
    }
  });

  fastify.get('/api/music/presets/:index/image', async (req, reply) => {
    try {
      const preset = (await getPresets())[Number(req.params.index)];
      if (!preset?.image) {
        reply.code(404);
        return { error: 'no image' };
      }
      const res = await fetch(preset.image);
      if (!res.ok) {
        reply.code(502);
        return { error: `image host returned ${res.status}` };
      }
      reply.type(res.headers.get('content-type') || 'image/jpeg');
      reply.header('Cache-Control', 'max-age=86400');
      return reply.send(Buffer.from(await res.arrayBuffer()));
    } catch (err) {
      reply.code(503);
      return { error: 'image unavailable' };
    }
  });

  // Plays by URI, but only URIs that are currently in the favourites list.
  fastify.post('/api/music/play', async (req, reply) => {
    try {
      const preset = (await getPresets()).find((p) => p.uri === req.body?.uri);
      if (!preset) {
        reply.code(404);
        return { error: 'preset not found' };
      }
      await callService('music_assistant', 'play_media', {
        entity_id: player,
        media_id: preset.uri,
        media_type: preset.mediaType,
        enqueue: 'replace',
      });
      return await fetchPlayer();
    } catch (err) {
      fastify.log.error({ err }, 'music preset play failed');
      reply.code(503);
      return { error: 'player unavailable' };
    }
  });
}
