import { config } from '../config.js';
import {
  getPlayer,
  fetchPlayer,
  fetchArt,
  getLibrary,
  getSpeakerNames,
  getActivePlayer,
  setActivePlayer,
  callService,
} from '../sources/music.js';

const { player, speakers } = config.music;

const REPEAT_MODES = ['off', 'all', 'one'];
const MAX_SEEK_S = 24 * 60 * 60;

const COMMANDS = {
  play_pause: () => ['media_play_pause', {}],
  next: () => ['media_next_track', {}],
  previous: () => ['media_previous_track', {}],
  volume: (value) =>
    typeof value === 'number' && value >= 0 && value <= 1
      ? ['volume_set', { volume_level: value }]
      : null,
  shuffle: (value) => (typeof value === 'boolean' ? ['shuffle_set', { shuffle: value }] : null),
  repeat: (value) => (REPEAT_MODES.includes(value) ? ['repeat_set', { repeat: value }] : null),
  seek: (value) =>
    typeof value === 'number' && value >= 0 && value <= MAX_SEEK_S
      ? ['media_seek', { seek_position: Math.round(value) }]
      : null,
};

// Adds what the frontend needs on top of the cached player state: the
// speaker list and the playback position as of this response, computed on
// the server so the kiosk's clock doesn't matter.
async function playerDto(p) {
  const names = await getSpeakerNames();
  const active = getActivePlayer();
  let elapsed = p.position;
  if (p.state === 'playing' && p.position != null && p.positionAt) {
    elapsed = p.position + (Date.now() - p.positionAt) / 1000;
  }
  if (elapsed != null && p.duration) elapsed = Math.min(elapsed, p.duration);
  const { entity, position, positionAt, ...rest } = p;
  return {
    ...rest,
    elapsed,
    speakers: speakers.map((s, index) => ({ index, name: names[index], active: s.entity === active })),
  };
}

export async function musicRoutes(fastify) {
  if (!player) return;

  fastify.get('/api/music', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    try {
      return await playerDto(await getPlayer());
    } catch (err) {
      return { state: 'unavailable', speakers: [] };
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
      await callService('media_player', service, { entity_id: getActivePlayer(), ...data });
      return await playerDto(await fetchPlayer());
    } catch (err) {
      fastify.log.error({ err }, `music command failed: ${service}`);
      reply.code(503);
      return { error: 'player unavailable' };
    }
  });

  // Picks the speaker the dashboard controls. If something is playing, the
  // queue moves along with it.
  fastify.post('/api/music/speaker', async (req, reply) => {
    const target = speakers[req.body?.index];
    if (!Number.isInteger(req.body?.index) || !target) {
      reply.code(400);
      return { error: 'invalid speaker' };
    }
    const source = getActivePlayer();
    try {
      if (target.entity !== source) {
        const current = await fetchPlayer(source).catch(() => null);
        if (current?.state === 'playing' || current?.state === 'paused') {
          await callService('music_assistant', 'transfer_queue', {
            entity_id: target.entity,
            source_player: source,
            auto_play: current.state === 'playing',
          });
        }
        setActivePlayer(target.entity);
      }
      return await playerDto(await fetchPlayer());
    } catch (err) {
      fastify.log.error({ err }, 'music speaker change failed');
      reply.code(503);
      return { error: 'player unavailable' };
    }
  });

  fastify.get('/api/music/library', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    try {
      const items = await getLibrary();
      return items.map((p, index) => ({
        index,
        group: p.group,
        uri: p.uri,
        name: p.name,
        subtitle: p.subtitle,
        mediaType: p.mediaType,
        favorite: p.favorite,
        hasImage: !!p.image,
      }));
    } catch (err) {
      fastify.log.error({ err }, 'music library fetch failed');
      return [];
    }
  });

  fastify.get('/api/music/library/:index/image', async (req, reply) => {
    try {
      const item = (await getLibrary())[Number(req.params.index)];
      if (!item?.image) {
        reply.code(404);
        return { error: 'no image' };
      }
      const res = await fetch(item.image);
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

  // Plays by URI, but only URIs the library listing currently contains.
  fastify.post('/api/music/play', async (req, reply) => {
    try {
      const item = (await getLibrary()).find((p) => p.uri === req.body?.uri);
      if (!item) {
        reply.code(404);
        return { error: 'item not found' };
      }
      await callService('music_assistant', 'play_media', {
        entity_id: getActivePlayer(),
        media_id: item.uri,
        media_type: item.mediaType,
        enqueue: 'replace',
      });
      return await playerDto(await fetchPlayer());
    } catch (err) {
      fastify.log.error({ err }, 'music play failed');
      reply.code(503);
      return { error: 'player unavailable' };
    }
  });
}
