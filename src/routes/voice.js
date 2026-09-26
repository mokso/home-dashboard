import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { recordSuccess, recordError } from '../lib/health.js';

const { baseUrl, token } = config.homeAssistant;
const { stt, tts, agent, language } = config.voice;
const headers = { Authorization: `Bearer ${token}` };

const MAX_AUDIO_BYTES = 2 * 1024 * 1024; // ~60 s of 16 kHz 16-bit mono
const CONVERSATION_TTL_MS = 5 * 60 * 1000;

// Follow-up questions ("and upstairs?") reuse the HA conversation for a while.
let conversation = { id: null, at: 0 };
// Only the most recent reply's audio is kept; the frontend fetches it right away.
let lastTts = { id: null, path: null };

async function speechToText(wav) {
  const res = await fetch(`${baseUrl}/api/stt/${encodeURIComponent(stt)}`, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'audio/wav',
      'X-Speech-Content':
        `format=wav; codec=pcm; sample_rate=16000; bit_rate=16; channel=1; language=${language}`,
    },
    body: wav,
  });
  if (!res.ok) throw new Error(`HA STT failed: ${res.status} ${res.statusText}`);
  const body = await res.json();
  return body.result === 'success' ? (body.text ?? '').trim() : '';
}

async function converse(text) {
  const now = Date.now();
  const conversationId = now - conversation.at < CONVERSATION_TTL_MS ? conversation.id : null;
  const res = await fetch(`${baseUrl}/api/conversation/process`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      language: language.split('-')[0],
      agent_id: agent,
      ...(conversationId ? { conversation_id: conversationId } : {}),
    }),
  });
  if (!res.ok) throw new Error(`HA conversation failed: ${res.status} ${res.statusText}`);
  const body = await res.json();
  conversation = { id: body.conversation_id ?? null, at: now };
  return body.response?.speech?.plain?.speech ?? '';
}

async function textToSpeechPath(message) {
  const res = await fetch(`${baseUrl}/api/tts_get_url`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ engine_id: tts, message, language }),
  });
  if (!res.ok) throw new Error(`HA TTS failed: ${res.status} ${res.statusText}`);
  return (await res.json()).path;
}

export async function voiceRoutes(fastify) {
  if (!stt) return;

  fastify.addContentTypeParser('audio/wav', { parseAs: 'buffer', bodyLimit: MAX_AUDIO_BYTES }, (req, body, done) =>
    done(null, body),
  );

  fastify.get('/api/voice', async () => ({ enabled: true }));

  // Takes a 16 kHz mono WAV recording, returns what was heard and HA's answer.
  fastify.post('/api/voice', async (req, reply) => {
    if (!Buffer.isBuffer(req.body) || req.body.length < 1000) {
      reply.code(400);
      return { error: 'expected audio/wav body' };
    }
    try {
      const text = await speechToText(req.body);
      if (!text) return { text: '', response: '', ttsId: null };
      const response = await converse(text);
      let ttsId = null;
      if (response && tts) {
        try {
          lastTts = { id: randomUUID(), path: await textToSpeechPath(response) };
          ttsId = lastTts.id;
        } catch (err) {
          fastify.log.warn({ err }, 'voice TTS failed; returning text only');
        }
      }
      recordSuccess('voice');
      return { text, response, ttsId };
    } catch (err) {
      recordError('voice', err);
      fastify.log.error({ err }, 'voice request failed');
      reply.code(503);
      return { error: 'voice assistant unavailable' };
    }
  });

  fastify.get('/api/voice/tts/:id', async (req, reply) => {
    if (!lastTts.path || req.params.id !== lastTts.id) {
      reply.code(404);
      return { error: 'audio not found' };
    }
    try {
      const res = await fetch(`${baseUrl}${lastTts.path}`, { headers });
      if (!res.ok) {
        reply.code(502);
        return { error: `HA returned ${res.status}` };
      }
      reply.type(res.headers.get('content-type') || 'audio/mpeg');
      reply.header('Cache-Control', 'no-store');
      return reply.send(Buffer.from(await res.arrayBuffer()));
    } catch (err) {
      reply.code(503);
      return { error: 'audio unavailable' };
    }
  });
}
