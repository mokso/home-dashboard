import { config } from '../config.js';

const { baseUrl, token } = config.homeAssistant;
const headers = { Authorization: `Bearer ${token}` };

// Climate modes offered on the dashboard (others like dry/fan_only are skipped).
const CLIMATE_MODES = ['off', 'heat', 'cool', 'auto'];

async function fetchEntity(entity) {
  const res = await fetch(`${baseUrl}/api/states/${encodeURIComponent(entity)}`, { headers });
  if (!res.ok) throw new Error(`HA state ${entity} failed: ${res.status}`);
  return res.json();
}

async function callService(domain, service, data) {
  const res = await fetch(`${baseUrl}/api/services/${domain}/${service}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`HA ${domain}.${service} returned ${res.status}`);
}

function domainOf(entity) {
  return entity.split('.')[0];
}

function toDto(ctrl, index, body) {
  const dto = {
    index,
    entity: ctrl.entity,
    label: ctrl.label,
    type: domainOf(ctrl.entity) === 'climate' ? 'climate' : 'toggle',
    state: body?.state ?? 'unavailable',
  };
  if (dto.type === 'climate' && body) {
    const a = body.attributes ?? {};
    dto.current = a.current_temperature ?? null;
    dto.target = a.temperature ?? null;
    dto.min = a.min_temp ?? 7;
    dto.max = a.max_temp ?? 35;
    dto.step = a.target_temp_step ?? 0.5;
    dto.modes = CLIMATE_MODES.filter((m) => a.hvac_modes?.includes(m));
  }
  return dto;
}

// Validates the request body against the entity's current attributes and
// returns [service, data], or null if the body is not valid for this entity.
function buildServiceCall(ctrl, dto, body) {
  const domain = domainOf(ctrl.entity);
  const entity_id = ctrl.entity;
  if (dto.type === 'toggle') {
    if (typeof body?.on !== 'boolean') return null;
    return [domain, body.on ? 'turn_on' : 'turn_off', { entity_id }];
  }
  if (typeof body?.temperature === 'number') {
    const t = body.temperature;
    if (!Number.isFinite(t) || t < dto.min || t > dto.max) return null;
    return [domain, 'set_temperature', { entity_id, temperature: t }];
  }
  if (typeof body?.hvac_mode === 'string') {
    if (!dto.modes.includes(body.hvac_mode)) return null;
    return [domain, 'set_hvac_mode', { entity_id, hvac_mode: body.hvac_mode }];
  }
  return null;
}

export async function controlRoutes(fastify) {
  const controls = config.controls;
  if (!controls.length) return;

  fastify.get('/api/controls', async (req, reply) => {
    const results = await Promise.allSettled(controls.map((c) => fetchEntity(c.entity)));
    reply.header('Cache-Control', 'no-store');
    return controls.map((c, i) =>
      toDto(c, i, results[i].status === 'fulfilled' ? results[i].value : null),
    );
  });

  // Only entities listed in config can be controlled — the HA token itself
  // could control anything in the house.
  fastify.post('/api/controls/:index', async (req, reply) => {
    const i = Number(req.params.index);
    if (!Number.isInteger(i) || i < 0 || i >= controls.length) {
      reply.code(404);
      return { error: 'control not found' };
    }
    const ctrl = controls[i];
    try {
      const dto = toDto(ctrl, i, await fetchEntity(ctrl.entity));
      const call = buildServiceCall(ctrl, dto, req.body);
      if (!call) {
        reply.code(400);
        return { error: 'invalid request for this control' };
      }
      await callService(...call);
      return toDto(ctrl, i, await fetchEntity(ctrl.entity));
    } catch (err) {
      fastify.log.error({ err }, `control failed: ${ctrl.entity}`);
      reply.code(503);
      return { error: 'control unavailable' };
    }
  });
}
