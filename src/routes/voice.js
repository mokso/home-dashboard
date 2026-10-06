import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { recordSuccess, recordError } from '../lib/health.js';

const { baseUrl, token } = config.homeAssistant;
const { stt, tts, agent, preferLocal, language, glados } = config.voice;
const headers = { Authorization: `Bearer ${token}` };

const MAX_AUDIO_BYTES = 2 * 1024 * 1024; // ~60 s of 16 kHz 16-bit mono
const MAX_TEXT_LENGTH = 500;
const CONVERSATION_TTL_MS = 5 * 60 * 1000;
const LOCAL_AGENT = 'conversation.home_assistant';
// Built-in agent error codes that mean "not understood" rather than "failed".
const LOCAL_MISS_CODES = ['no_intent_match', 'no_valid_targets'];

// Follow-up questions ("and upstairs?") reuse the HA conversation for a while.
// Kept per agent, since conversation ids aren't shared between agents.
const conversations = new Map(); // agent id -> { id, at }
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

// Returns HA's conversation response object ({ response_type, data, speech }).
async function converse(text, agentId) {
  const now = Date.now();
  const conversation = conversations.get(agentId);
  const conversationId =
    conversation && now - conversation.at < CONVERSATION_TTL_MS ? conversation.id : null;
  const res = await fetch(`${baseUrl}/api/conversation/process`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      language: language.split('-')[0],
      agent_id: agentId,
      ...(conversationId ? { conversation_id: conversationId } : {}),
    }),
  });
  if (!res.ok) throw new Error(`HA conversation failed: ${res.status} ${res.statusText}`);
  const body = await res.json();
  conversations.set(agentId, { id: body.conversation_id ?? null, at: now });
  return body.response ?? {};
}

// Built-in agent first (fast, fixed sentence patterns); if it doesn't
// understand, ask the configured agent (e.g. an LLM) instead.
async function answer(text) {
  if (preferLocal && agent !== LOCAL_AGENT) {
    const local = await converse(text, LOCAL_AGENT);
    const missed = local.response_type === 'error' && LOCAL_MISS_CODES.includes(local.data?.code);
    if (!missed) return local.speech?.plain?.speech ?? '';
  }
  return (await converse(text, agent)).speech?.plain?.speech ?? '';
}

// Engines spell languages differently (cloud: "fi-FI", Piper: "fi_FI"), and
// HA answers 500 to a spelling the engine doesn't list. Try each, then fall
// back to the engine's default voice.
const ttsLanguages = [...new Set([language, language.replace('-', '_'), null])];

async function textToSpeechPath(message) {
  let res;
  for (const lang of ttsLanguages) {
    res = await fetch(`${baseUrl}/api/tts_get_url`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ engine_id: tts, message, ...(lang ? { language: lang } : {}) }),
    });
    if (res.ok) break;
  }
  if (!res.ok) throw new Error(`HA TTS failed: ${res.status} ${res.statusText}`);
  return (await res.json()).path;
}

export async function voiceRoutes(fastify) {
  if (!stt) return;

  fastify.addContentTypeParser('audio/wav', { parseAs: 'buffer', bodyLimit: MAX_AUDIO_BYTES }, (req, body, done) =>
    done(null, body),
  );

  fastify.get('/api/voice', async () => ({ enabled: true, glados }));

  // Two steps so the frontend can show what was heard while the agent is
  // still thinking. Step 1: 16 kHz mono WAV recording -> transcript.
  fastify.post('/api/voice/stt', async (req, reply) => {
    if (!Buffer.isBuffer(req.body) || req.body.length < 1000) {
      reply.code(400);
      return { error: 'expected audio/wav body' };
    }
    try {
      return { text: await speechToText(req.body) };
    } catch (err) {
      recordError('voice', err);
      fastify.log.error({ err }, 'voice STT failed');
      reply.code(503);
      return { error: 'speech-to-text unavailable' };
    }
  });

  // Step 2: transcript -> agent's answer (+ id of the spoken reply).
  fastify.post('/api/voice/ask', async (req, reply) => {
    const text = req.body?.text;
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT_LENGTH) {
      reply.code(400);
      return { error: 'expected { text }' };
    }
    try {
      const response = await answer(text.trim());
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
      return { response, ttsId };
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
