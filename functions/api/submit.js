// POST /api/submit: save first, answer "saved", then deliver to HubSpot (see server/core.js).
import { KINDS, TASK_KIND, cleanFields, ensureTable, deliver, processDue, sendTo, alert, formFor, json, originOk, loadConfig } from '../../server/core.js';
import { turnstileOk, ipHash, createFollowUpTask } from '../../server/card.js';
const CARD = 'Contact exchange';   // the digital card's exchange form
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function onRequestPost({ request, env, waitUntil }) {
  if (!originOk(request, env)) return json({ saved: false, error: 'origin' }, 403);
  const raw = await request.text();
  if (raw.length > 65536) return json({ saved: false, error: 'too large' }, 413);
  let b; try { b = JSON.parse(raw); } catch (e) { return json({ saved: false, error: 'json' }, 400); }
  if (!b || typeof b.key !== 'string' || !/^[a-z0-9]{8,64}$/.test(b.key) || !KINDS.includes(b.kind)) return json({ saved: false, error: 'shape' }, 400);
  // spam (every form): a filled hidden field, or a form sent within 1.5 seconds of the page opening. Answer as if saved; store and send nothing.
  if ((typeof b.hp === 'string' && b.hp.trim()) || (typeof b.t === 'number' && b.t >= 0 && b.t < 1500)) return json({ saved: true, id: b.key, ignored: true });
  const ip = request.headers.get('CF-Connecting-IP');
  if (b.kind === CARD) {
    // spam checks for the public card form: a filled hidden field or a form sent in under three seconds is a bot. It is
    // answered like a real submission so the bot learns nothing, and nothing is stored or sent.
    if ((typeof b.trap === 'string' && b.trap.trim()) || (typeof b.elapsed === 'number' && b.elapsed < 3000)) return json({ saved: true, id: b.key, screened: true });
    if (!(await turnstileOk(env, b.turnstile, ip))) return json({ saved: false, error: 'verification' }, 400);
    if (env.DB) {
      try {
        await env.DB.prepare('CREATE TABLE IF NOT EXISTS card_hits (ip TEXT NOT NULL, at INTEGER NOT NULL)').run();
        const h = await ipHash(ip), hourAgo = Date.now() - 3600000;
        const c = await env.DB.prepare('SELECT COUNT(*) AS n FROM card_hits WHERE ip=? AND at>?').bind(h, hourAgo).first();
        if (c && c.n >= Number(env.CARD_HOURLY_LIMIT || 30)) return json({ saved: false, error: 'rate' }, 429);
        await env.DB.batch([env.DB.prepare('INSERT INTO card_hits (ip, at) VALUES (?, ?)').bind(h, Date.now()), env.DB.prepare('DELETE FROM card_hits WHERE at<?').bind(Date.now() - 86400000)]);
      } catch (e) {}
    }
  }
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
  if (ip) context.ipAddress = ip;
  for (const k of Object.keys(context)) if (!['hutk', 'pageUri', 'pageName', 'ipAddress'].includes(k)) delete context[k];
  const consent = b.consent && typeof b.consent === 'object' ? b.consent : null;
  // after a card exchange: a follow-up task for the card owner, when a HubSpot private app token is set
  const val = (n) => ((items[0].fields || []).find((f) => f.name === n) || {}).value || '';
  const task = b.kind === CARD && env.HS_PRIVATE_APP_TOKEN ? { email: val('email'), name: [val('firstname'), val('lastname')].filter(Boolean).join(' '), company: val('company'), body: val('message') } : null;

  if (!env.DB) {
    // no store bound: deliver now, and say "saved" only if HubSpot accepted
    for (const it of items) {
      const res = await sendTo(env, it.kind, formFor(it.kind, env), { fields: it.fields, context, consent: it.parent ? null : consent });
      if (!res.ok && !it.parent) { waitUntil(alert(env, 'Website form not delivered to HubSpot: ' + it.kind, ['No database is bound, so the submission was not stored.', 'Error: ' + res.error])); return json({ saved: false, error: 'delivery' }, 502); }
    }
    if (task) waitUntil((async () => {
      for (const wait of [4000, 8000, 12000]) { await sleep(wait); const r = await createFollowUpTask(env, task); if (r.ok || !r.transient) { if (!r.ok) await alert(env, 'Card follow-up task not created', ['Contact: ' + task.email, 'Error: ' + r.error]); return; } }
      await alert(env, 'Card follow-up task not created', ['Contact: ' + task.email, 'HubSpot had not created the contact after 24 seconds. Create the task by hand.']);
    })());
    return json({ saved: true, id: b.key, mode: 'direct' });
  }
  try {
    await ensureTable(env.DB);
    const t = Date.now();
    if (task) items.push({ id: b.key + '-task', kind: TASK_KIND, task: true, parent: b.key });
    const res = await env.DB.batch(items.map((it) => env.DB.prepare('INSERT OR IGNORE INTO submissions (id, kind, form_guid, created_at, payload, status, attempts, next_at, parent) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)')
      .bind(it.id, it.kind, it.task ? 'task' : formFor(it.kind, env), t, JSON.stringify(it.task ? { fields: [], task } : { fields: it.fields, context, consent: it.parent ? null : consent, failed_checks: it.checkDropped || [] }), 'pending', it.task ? t + 5000 : t, it.parent || null)));
    const duplicate = !(res[0].meta && res[0].meta.changes === 1);
    waitUntil((async () => { for (const it of items) { if (it.task) await sleep(6000); await deliver(env, it.id); } await processDue(env, 3); })());
    return json({ saved: true, id: b.key, duplicate });
  } catch (e) {
    waitUntil(alert(env, 'Website form could not be saved', ['The database refused a ' + b.kind + ' submission.', 'Error: ' + String(e && e.message || e).slice(0, 300)]));
    return json({ saved: false, error: 'store' }, 503);
  }
}
export function onRequest() { return json({ error: 'method' }, 405); }
