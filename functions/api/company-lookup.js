// POST /api/company-lookup: what does this company do? Answers from a fixed list of industries, or says it does not know.
// Without ANTHROPIC_API_KEY, over the daily limit, or on any error, it answers {ok:false} and the page asks the owner instead.
import { json, originOk } from '../../server/core.js';
import { lookup, underLimit, apiKey } from '../../server/ai.js';
export async function onRequestPost({ request, env }) {
  if (!request.headers.get('Origin') || !originOk(request, env)) return json({ ok: false, reason: 'origin' }, 403);
  let b; try { b = JSON.parse((await request.text()).slice(0, 4000)); } catch (e) { return json({ ok: false, reason: 'json' }, 400); }
  if (!b || typeof b.company !== 'string' || !b.company.trim()) return json({ ok: false, reason: 'shape' }, 400);
  if ((typeof b.hp === 'string' && b.hp.trim()) || (typeof b.t === 'number' && b.t >= 0 && b.t < 1500)) return json({ ok: false, reason: 'ignored' });
  if (!apiKey(env)) return json({ ok: false, reason: 'off' });
  try {
    if (!(await underLimit(env, 'lookup', Number(env.AI_LOOKUPS_PER_DAY || 50)))) return json({ ok: false, reason: 'limit' });
    return json(await lookup(env, b.company, typeof b.website === 'string' ? b.website : ''));
  } catch (e) { return json({ ok: false, reason: 'error' }); }
}
export function onRequest() { return json({ error: 'method' }, 405); }
