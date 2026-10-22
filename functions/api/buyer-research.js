// POST /api/buyer-research: for a company outside healthcare, the AI looks up acquisitions in its industry; every deal is checked
// against its page (server/ai.js); the result goes to HubSpot on the owner's contact, for Capital Row to review. The owner sees nothing from it.
import { json, originOk, cleanFields, sendToHubSpot, formFor, alert, loadConfig } from '../../server/core.js';
import { research, researchReport, underLimit, NONHC } from '../../server/ai.js';
export async function onRequestPost({ request, env }) {
  if (!request.headers.get('Origin') || !originOk(request, env)) return json({ ok: false, reason: 'origin' }, 403);
  let b; try { b = JSON.parse((await request.text()).slice(0, 8000)); } catch (e) { return json({ ok: false, reason: 'json' }, 400); }
  const email = String(b && b.email || '').trim(); const cat = String(b && b.category || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !(cat in NONHC) || !String(b.company || '').trim()) return json({ ok: false, reason: 'shape' }, 400);
  if (typeof b.hp === 'string' && b.hp.trim()) return json({ ok: false, reason: 'ignored' });
  const who = { company: String(b.company).slice(0, 120), website: String(b.website || '').slice(0, 200), label: String(b.label || NONHC[cat]).slice(0, 80), what: String(b.what || '').slice(0, 200) };
  let report;
  if (!env.ANTHROPIC_API_KEY) report = `Research map requested: ${who.company} (${who.label}). The AI research step is off (no ANTHROPIC_API_KEY), so nothing was researched. Build this map by hand.`;
  else {
    try {
      if (!(await underLimit(env, 'research', Number(env.AI_RESEARCH_PER_DAY || 15)))) report = `Research map requested: ${who.company} (${who.label}). Today's research limit was reached, so nothing was researched yet. Run it tomorrow or by hand.`;
      else report = researchReport(who, await research(env, who));
    } catch (e) { report = `Research map requested: ${who.company} (${who.label}). The research step failed (${String(e && e.message || e).slice(0, 120)}). Build this map by hand.`; }
  }
  const cfg = await loadConfig(env, request);
  const r = cleanFields('Pre-Market Assessment request', [{ name: 'email', value: email }, { name: 'message', value: report.slice(0, 19000) }, { name: 'cr_form', value: 'Buyer Map research' }], cfg);
  const sent = await sendToHubSpot(env, formFor('Pre-Market Assessment request', env), { fields: r.fields, context: { pageUri: 'https://thecapitalrow.com/buyer-map/', pageName: 'Buyer Map research' } });
  await alert(env, 'Buyer Map research ready for review: ' + who.company, report.split('\n'));
  return json({ ok: true, delivered: !!sent.ok });
}
export function onRequest() { return json({ error: 'method' }, 405); }
