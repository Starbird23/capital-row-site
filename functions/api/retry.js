// POST /api/retry with header X-Retry-Key: delivers what is due, re-sends alerts, and reports. Called every ten minutes by the
// GitHub Action .github/workflows/form-delivery.yml, which fails (and GitHub emails you) when anything is failed or stuck.
import { ensureTable, processDue, stats, json, keyOk } from '../../server/core.js';
export async function onRequestPost({ request, env }) {
  if (!keyOk(request, env)) return json({ error: 'key' }, 401);
  if (!env.DB) return json({ error: 'no database bound' }, 503);
  await ensureTable(env.DB);
  const done = await processDue(env, 25);
  return json(Object.assign({ processed: done }, await stats(env)));
}
export function onRequest() { return json({ error: 'method' }, 405); }
