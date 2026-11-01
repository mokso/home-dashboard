import { config } from '../config.js';
import { textToSpeechAudio } from './voice.js';

// Compare the last 9 digits so +35840… and 040… match.
const tail = (s) => String(s || '').replace(/\D/g, '').slice(-9);

// The phone itself runs in the browser (Enreach web phone); the server only serves the speed dials
// and decides auto-answer, so the number list and the HA token stay server-side.
export async function phoneRoutes(fastify) {
  if (config.phoneContacts.length) {
    fastify.get('/api/phone/contacts', async () => config.phoneContacts);
  }

  const { entity, numbers, message } = config.phoneAutoAnswer;
  if (!entity || !numbers.length) return;
  const known = new Set(numbers.map(tail));

  // Asked once per incoming call, so no cache; any failure means "don't answer".
  fastify.get('/api/phone/autoanswer', async (req) => {
    const number = tail(req.query.number);
    if (number.length < 9 || !known.has(number)) return { answer: false };
    try {
      const { baseUrl, token } = config.homeAssistant;
      const res = await fetch(`${baseUrl}/api/states/${encodeURIComponent(entity)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HA ${entity} failed: ${res.status}`);
      return { answer: (await res.json()).state === 'on' };
    } catch (err) {
      fastify.log.error({ err }, 'phone auto-answer check failed');
      return { answer: false };
    }
  });

  // Spoken into the call after auto-answer. Without VOICE_TTS this 404s and the browser plays a beep.
  let greeting = null; // the message never changes, so the audio is kept once fetched
  fastify.get('/api/phone/autoanswer/greeting', async (req, reply) => {
    if (!config.voice.tts) { reply.code(404); return { error: 'no TTS configured' }; }
    try {
      greeting = greeting || (await textToSpeechAudio(message));
      reply.type(greeting.type);
      return reply.send(greeting.buf);
    } catch (err) {
      fastify.log.error({ err }, 'auto-answer greeting failed');
      reply.code(503);
      return { error: 'greeting unavailable' };
    }
  });
}
