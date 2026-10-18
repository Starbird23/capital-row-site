// GET /api/status with header X-Retry-Key: counts by status, stuck and failed submissions, and which HubSpot properties were missing.
import { ensureTable, stats, json, keyOk } from '../../server/core.js';
export async function onRequestGet({ request, env }) {
  if (!keyOk(request, env)) return json({ error: 'key' }, 401);
  if (!env.DB) return json({ error: 'no database bound' }, 503);
  await ensureTable(env.DB);
  const recent = await env.DB.prepare('SELECT id, kind, status, attempts, last_error, dropped, created_at, delivered_at FROM submissions ORDER BY created_at DESC LIMIT 25').all();
  return json(Object.assign(await stats(env), { recent: recent.results || [] }));
}
