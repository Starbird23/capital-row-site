// POST /api/submit: save first, answer "saved", then deliver to HubSpot (see server/core.js).
import { KINDS, cleanFields, ensureTable, deliver, processDue, sendToHubSpot, alert, formFor, json, originOk, loadConfig } from '../../server/core.js';

export async function onRequestPost({ request, env, waitUntil }) {
  if (!originOk(request, env)) return json({ saved: false, error: 'origin' }, 403);
  const raw = await request.text();
  if (raw.length > 65536) return json({ saved: false, error: 'too large' }, 413);
  let b; try { b = JSON.parse(raw); } catch (e) { return json({ saved: false, error: 'json' }, 400); }
  if (!b || typeof b.key !== 'string' || !/^[a-z0-9]{8,64}$/.test(b.key) || !KINDS.includes(b.kind)) return json({ saved: false, error: 'shape' }, 400);
  // spam: a filled hidden field, or a form sent within 1.5 seconds of the page opening. Answer as if saved; store and send nothing.
  if ((typeof b.hp === 'string' && b.hp.trim()) || (typeof b.t === 'number' && b.t >= 0 && b.t < 1500)) return json({ saved: true, id: b.key, ignored: true });
  const cfg = await loadConfig(env, request);
  const items = [{ id: b.key, kind: b.kind, fields: b.fields }];
  for (const [i, a] of (Array.isArray(b.also) ? b.also.slice(0, 2) : []).entries()) if (a && KINDS.includes(a.kind)) items.push({ id: b.key + '-' + (i + 1), kind: a.kind, fields: a.fields, parent: b.key });
  for (const it of items) {
    const r = cleanFields(it.kind, it.fields, cfg);
    if (r.fatal.length) { if (it.parent) { it.skip = true; continue; } return json({ saved: false, error: 'invalid', fields: r.fatal }, 400); }
    it.fields = r.fields; it.checkDropped = r.dropped;
  }
  for (let i = items.length - 1; i >= 0; i--) if (items[i].skip) items.splice(i, 1);
  const context = Object.assign({}, typeof b.context === 'object' && b.context ? b.context : {});
  const ip = request.headers.get('CF-Connecting-IP'); if (ip) context.ipAddress = ip;
  for (const k of Object.keys(context)) if (!['hutk', 'pageUri', 'pageName', 'ipAddress'].includes(k)) delete context[k];
  const consent = b.consent && typeof b.consent === 'object' ? b.consent : null;

  if (!env.DB) {
    // no store bound: deliver now, and say "saved" only if HubSpot accepted
    for (const it of items) {
      const res = await sendToHubSpot(env, formFor(it.kind, env), { fields: it.fields, context, consent: it.parent ? null : consent });
      if (!res.ok && !it.parent) { waitUntil(alert(env, 'Website form not delivered to HubSpot: ' + it.kind, ['No database is bound, so the submission was not stored.', 'Error: ' + res.error])); return json({ saved: false, error: 'delivery' }, 502); }
    }
    return json({ saved: true, id: b.key, mode: 'direct' });
  }
  try {
    await ensureTable(env.DB);
    const t = Date.now();
    const res = await env.DB.batch(items.map((it) => env.DB.prepare('INSERT OR IGNORE INTO submissions (id, kind, form_guid, created_at, payload, status, attempts, next_at, parent) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)')
      .bind(it.id, it.kind, formFor(it.kind, env), t, JSON.stringify({ fields: it.fields, context, consent: it.parent ? null : consent, failed_checks: it.checkDropped || [] }), 'pending', t, it.parent || null)));
    const duplicate = !(res[0].meta && res[0].meta.changes === 1);
    waitUntil((async () => { for (const it of items) await deliver(env, it.id); await processDue(env, 3); })());
    return json({ saved: true, id: b.key, duplicate });
  } catch (e) {
    waitUntil(alert(env, 'Website form could not be saved', ['The database refused a ' + b.kind + ' submission.', 'Error: ' + String(e && e.message || e).slice(0, 300)]));
    return json({ saved: false, error: 'store' }, 503);
  }
}
export function onRequest() { return json({ error: 'method' }, 405); }
