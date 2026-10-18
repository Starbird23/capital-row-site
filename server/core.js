// Capital Row form delivery: every website form posts here (Cloudflare Pages Functions, /api/submit).
// 1. The submission is checked (shape, required answers, allowed choices from the forms config built from Sanity).
// 2. It is saved in D1 (binding DB) under the key the page sends; the same key twice is the same submission, never two.
// 3. Only then does the page hear "saved", and only then does it show "received".
// 4. Delivery to HubSpot runs after the answer, and again from /api/retry until HubSpot accepts it; a property HubSpot
//    does not have yet is dropped and the rest is sent (the answers are in the message as well). After the last attempt,
//    or on a refusal that a retry cannot fix, an alert goes out (email through Resend, and/or a webhook).
// Without a DB binding the server sends to HubSpot straight away and answers "saved" only when HubSpot has accepted it.

export const HS_PORTAL = '247329185';
export const HS_FORMS = { 'Conversation': '8e02c346-11f0-4b2d-a17c-a596397264ee', 'Owner session seat': '2252081f-64ac-4259-925b-0bd99f4fb517' };
const ENV_FORM = { 'Conversation': 'HS_FORM_MAIN', 'Buy box': 'HS_FORM_BUYBOX', 'Pre-Market Assessment request': 'HS_FORM_ASSESS', 'Bad or broken deal report': 'HS_FORM_DEAL',
  'Capital Connections': 'HS_FORM_CC', 'Owner session seat': 'HS_FORM_SEAT', 'Follow a sector': 'HS_FORM_FOLLOW', 'Valuation calculator': 'HS_FORM_VALUATION' };
export const KINDS = Object.keys(ENV_FORM);
const BACKOFF_MIN = [1, 5, 15, 60, 180, 360, 720, 1440];          // minutes before attempt 2, 3, ...
export const MAX_ATTEMPTS = BACKOFF_MIN.length + 1;
const isGuid = (x) => /^[0-9a-fA-F-]{30,40}$/.test(x || '');
export function formFor(kind, env) { const e = env[ENV_FORM[kind]]; return isGuid(e) ? e : (HS_FORMS[kind] || HS_FORMS['Conversation']); }

// ---------------------------------------------------------------- validation
const STD = ['email', 'firstname', 'lastname', 'phone', 'mobilephone', 'company', 'name', 'jobtitle', 'website', 'message'];
const NUM = ['cr_rev_min', 'cr_rev_max', 'cr_arr_min', 'cr_arr_max', 'cr_ebitda_min', 'cr_ebitda_max', 'cr_ev_min', 'cr_ev_max', 'cr_equity_min', 'cr_equity_max', 'cr_loan_min', 'cr_loan_max', 'cr_revenue_ltm', 'cr_adjusted_earnings_ltm'];
const BOOL = ['cr_criteria_on_file', 'cr_owner_session', 'cr_sms_consent', 'cr_sector_updates'];
const TEXTP = ['cr_form', 'cr_details', 'cr_heard_via_detail', 'cr_geography_detail', 'cr_platform_name', 'cr_exclusions', 'cr_range_flags', 'cr_revenue_band'];
// property -> the lists (ids in the forms config) whose stable values it may carry; multi = several, joined by ";"
const ONE = { cr_side: ['seat'], cr_kind: ['kind.Seller', 'kind.Buyer', 'kind.Advisor', 'kind.Lender', 'strole', 'vckind', 'bb_kind', 'pqkind', 'bdkind', 'cctype'],
  cr_heard_via: ['how', 'vchow'], cr_reason: ['sl_reason', 'ad_purpose', 'ln_purpose'], cr_client_type: ['ad_client'], cr_cash_flow_appetite: ['ln_cash'], cr_capital_model: ['bb_capital'],
  cr_profitability: ['bb_profit'], cr_recurring_pref: ['bb_recur'], cr_regulated_appetite: ['bb_reg'], cr_owner_after_close: ['bb_owner'], cr_timing: ['bb_timing'], cr_funding_status: ['bb_funding'],
  cr_main_reason: ['bdwhy1'], cr_stage: ['ccstage'] };
const MULTI = { cr_geography: ['bb_geo', 'ln_geo', 'ccgeo'], cr_customer_markets: ['bb_cust'], cr_ownership: ['bb_own'], cr_acquisition_context: ['bb_context'], cr_business_model: ['bb_model'], cr_revenue_model: ['bb_revmodel'] };
const SECTORS = ['cr_sector', 'cr_sector_firm', 'cr_sector_followed'], INDUSTRIES = ['cr_industry', 'cr_industry_firm'];
const REQUIRED = { 'Conversation': ['firstname'], 'Buy box': ['firstname', 'cr_kind', 'cr_sector', 'cr_profitability', 'cr_timing', 'cr_funding_status'], 'Pre-Market Assessment request': ['firstname'],
  'Bad or broken deal report': ['cr_main_reason'], 'Capital Connections': ['firstname'], 'Owner session seat': ['firstname'], 'Follow a sector': ['cr_sector_followed'], 'Valuation calculator': ['firstname'] };
export const ALLOWED = new Set([...STD, ...NUM, ...BOOL, ...TEXTP, ...Object.keys(ONE), ...Object.keys(MULTI), ...SECTORS, ...INDUSTRIES]);
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function checkFields(kind, fields, cfg) {
  const errs = [];
  if (!Array.isArray(fields) || !fields.length || fields.length > 120) return ['fields'];
  const by = {};
  for (const f of fields) {
    if (!f || typeof f.name !== 'string' || typeof f.value !== 'string' || !ALLOWED.has(f.name) || !['0-1', '0-2'].includes(f.objectTypeId || '0-1')) { errs.push('field:' + (f && f.name)); continue; }
    if (f.value.length > (f.name === 'message' ? 20000 : 4000)) errs.push('long:' + f.name);
    if (f.objectTypeId !== '0-2') by[f.name] = f.value;
  }
  if (!EMAIL.test(by.email || '')) errs.push('email');
  for (const r of REQUIRED[kind] || []) if (!String(by[r] || '').trim()) errs.push('required:' + r);
  for (const n of NUM) if (by[n] != null && !/^-?\d{1,15}$/.test(by[n])) errs.push('number:' + n);
  for (const n of BOOL) if (by[n] != null && !['true', 'false'].includes(by[n])) errs.push('bool:' + n);
  if (cfg && cfg.lists) {
    const vals = (ids) => new Set(ids.flatMap((id) => (cfg.lists[id] || []).map((o) => o[0])).filter(Boolean));
    for (const [n, ids] of Object.entries(ONE)) if (by[n] != null && !vals(ids).has(by[n])) errs.push('choice:' + n);
    for (const [n, ids] of Object.entries(MULTI)) if (by[n] != null) { const ok = vals(ids); if (by[n].split(';').map((x) => x.trim()).some((x) => !ok.has(x))) errs.push('choice:' + n); }
    const sids = new Set(['other']), iids = new Set();
    for (const i of cfg.tax || []) { iids.add(i.id); for (const s of i.sectors || []) sids.add(s.id); }
    for (const n of SECTORS) if (by[n] != null && by[n].split(';').some((x) => !sids.has(x))) errs.push('sector:' + n);
    for (const n of INDUSTRIES) if (by[n] != null && by[n].split(';').some((x) => !iids.has(x))) errs.push('industry:' + n);
  }
  return errs;
}

// ---------------------------------------------------------------- storage
export async function ensureTable(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS submissions (id TEXT PRIMARY KEY, kind TEXT NOT NULL, form_guid TEXT NOT NULL, created_at INTEGER NOT NULL, payload TEXT NOT NULL,
      status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL, lease_until INTEGER NOT NULL DEFAULT 0, last_error TEXT, dropped TEXT,
      delivered_at INTEGER, alerted_at INTEGER, parent TEXT)`),
    db.prepare('CREATE INDEX IF NOT EXISTS submissions_due ON submissions (status, next_at)'),
  ]);
}

// ---------------------------------------------------------------- HubSpot
// sends one submission; drops properties HubSpot does not have on the form (the answers are also in "message")
export async function sendToHubSpot(env, guid, payload) {
  const base = env.HS_BASE || 'https://api.hsforms.com';
  const url = `${base}/submissions/v3/integration/submit/${env.HS_PORTAL || HS_PORTAL}/${guid}`;
  let fields = payload.fields.slice(); const dropped = [];
  for (let round = 0; round < 6; round++) {
    const body = { fields, context: payload.context || {} };
    if (payload.consent) body.legalConsentOptions = payload.consent;
    let r, j = null, text = '';
    try { r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); text = await r.text(); try { j = JSON.parse(text); } catch (e) {} }
    catch (e) { return { ok: false, transient: true, error: 'network: ' + String(e && e.message || e).slice(0, 200), dropped }; }
    if (r.ok) return { ok: true, status: r.status, dropped };
    const errs = (j && j.errors) || [];
    const missing = errs.filter((e) => e.errorType === 'FIELD_NOT_IN_FORM_DEFINITION');
    if (r.status === 400 && missing.length && missing.length === errs.length) {
      const names = fields.map((f) => f.name);
      let bad = [];
      for (const e of missing) { const hit = names.filter((n) => new RegExp('(^|[^A-Za-z0-9_])' + n + '([^A-Za-z0-9_]|$)').test(e.message || '')); bad.push(...(hit.length ? hit : ['?'])); }
      if (bad.includes('?')) bad = names.filter((n) => n.startsWith('cr_'));
      bad = [...new Set(bad)].filter((n) => n !== 'email' && n !== 'message');
      if (!bad.length) return { ok: false, transient: false, error: 'hubspot 400: ' + text.slice(0, 300), dropped };
      dropped.push(...bad); fields = fields.filter((f) => !bad.includes(f.name)); continue;
    }
    const transient = r.status === 429 || r.status >= 500;
    return { ok: false, transient, error: `hubspot ${r.status}: ` + text.slice(0, 300), dropped };
  }
  return { ok: false, transient: false, error: 'too many dropped properties', dropped };
}

// ---------------------------------------------------------------- alerts
export async function alert(env, subject, lines) {
  const text = lines.join('\n'); const sent = [];
  if (env.RESEND_API_KEY) {
    try {
      const r = await fetch((env.RESEND_BASE || 'https://api.resend.com') + '/emails', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.RESEND_API_KEY },
        body: JSON.stringify({ from: env.ALERT_FROM || 'Capital Row website <alerts@thecapitalrow.com>', to: [env.ALERT_TO || 'team@thecapitalrow.com'], subject, text }) });
      if (r.ok) sent.push('email');
    } catch (e) {}
  }
  if (env.ALERT_WEBHOOK) {
    try { const r = await fetch(env.ALERT_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: subject + '\n' + text }) }); if (r.ok) sent.push('webhook'); } catch (e) {}
  }
  return sent;
}

// ---------------------------------------------------------------- delivery from the store
const now = () => Date.now();
const scale = (env) => { const s = Number(env.BACKOFF_SCALE); return isFinite(s) && s >= 0 ? s : 1; };

export async function deliver(env, id) {
  const db = env.DB, t = now();
  const claim = await db.prepare("UPDATE submissions SET status='sending', lease_until=? WHERE id=? AND status IN ('pending','retry') AND next_at<=?").bind(t + 120000, id, t).run();
  if (!claim.meta || claim.meta.changes !== 1) return null;
  const row = await db.prepare('SELECT * FROM submissions WHERE id=?').bind(id).first();
  const payload = JSON.parse(row.payload);
  const res = await sendToHubSpot(env, row.form_guid, payload);
  const attempts = row.attempts + 1, dropped = res.dropped && res.dropped.length ? JSON.stringify([...new Set(res.dropped)]) : null;
  if (res.ok) {
    await db.prepare("UPDATE submissions SET status='delivered', attempts=?, delivered_at=?, dropped=?, last_error=NULL, lease_until=0 WHERE id=?").bind(attempts, now(), dropped, id).run();
    return 'delivered';
  }
  if (res.transient && attempts < MAX_ATTEMPTS) {
    const wait = BACKOFF_MIN[attempts - 1] * 60000 * scale(env);
    await db.prepare("UPDATE submissions SET status='retry', attempts=?, next_at=?, last_error=?, dropped=?, lease_until=0 WHERE id=?").bind(attempts, now() + wait, res.error, dropped, id).run();
    return 'retry';
  }
  await db.prepare("UPDATE submissions SET status='failed', attempts=?, last_error=?, dropped=?, lease_until=0 WHERE id=?").bind(attempts, res.error, dropped, id).run();
  await alertFailed(env, id);
  return 'failed';
}

export async function alertFailed(env, id) {
  const row = await env.DB.prepare('SELECT id, kind, created_at, attempts, last_error, payload, alerted_at FROM submissions WHERE id=?').bind(id).first();
  if (!row || row.alerted_at) return;
  let email = ''; try { email = (JSON.parse(row.payload).fields.find((f) => f.name === 'email') || {}).value || ''; } catch (e) {}
  const sent = await alert(env, `Website form not delivered to HubSpot: ${row.kind}`, [
    `A ${row.kind} submission from ${email || 'an unknown address'} was saved on ${new Date(row.created_at).toISOString()} but HubSpot did not accept it after ${row.attempts} attempt(s).`,
    `Last error: ${row.last_error || 'none recorded'}`, `Submission id: ${row.id}`,
    'The answers are kept in the website database. Retry from /api/retry once the cause is fixed, or enter them in HubSpot by hand.']);
  if (sent.length) await env.DB.prepare('UPDATE submissions SET alerted_at=? WHERE id=?').bind(now(), id).run();
}

export async function processDue(env, limit) {
  const db = env.DB, t = now();
  await db.prepare("UPDATE submissions SET status='retry', lease_until=0 WHERE status='sending' AND lease_until<?").bind(t).run();
  const due = await db.prepare("SELECT id FROM submissions WHERE status IN ('pending','retry') AND next_at<=? ORDER BY next_at LIMIT ?").bind(t, limit).all();
  const out = { delivered: 0, retry: 0, failed: 0 };
  for (const r of due.results || []) { const s = await deliver(env, r.id); if (s) out[s]++; }
  // failed rows whose alert did not go out are tried again; delivered answers are cleared from the store after 30 days
  const unalerted = await db.prepare("SELECT id FROM submissions WHERE status='failed' AND alerted_at IS NULL LIMIT 20").all();
  for (const r of unalerted.results || []) await alertFailed(env, r.id);
  await db.prepare("UPDATE submissions SET payload='{\"fields\":[]}' WHERE status='delivered' AND delivered_at<? AND payload<>'{\"fields\":[]}'").bind(t - 30 * 86400000).run();
  return out;
}

export async function stats(env) {
  const db = env.DB, t = now();
  const by = await db.prepare('SELECT status, COUNT(*) AS n FROM submissions GROUP BY status').all();
  const counts = Object.fromEntries((by.results || []).map((r) => [r.status, r.n]));
  const stale = await db.prepare("SELECT COUNT(*) AS n FROM submissions WHERE status IN ('pending','retry','sending') AND created_at<?").bind(t - 30 * 60000).first();
  const recentFailed = await db.prepare("SELECT COUNT(*) AS n FROM submissions WHERE status='failed' AND created_at>?").bind(t - 86400000).first();
  const dropped = await db.prepare("SELECT dropped FROM submissions WHERE dropped IS NOT NULL AND created_at>? LIMIT 500").bind(t - 7 * 86400000).all();
  const missing = {}; for (const r of dropped.results || []) for (const n of JSON.parse(r.dropped)) missing[n] = (missing[n] || 0) + 1;
  return { counts, stale: stale.n, failed_recent: recentFailed.n, hubspot_properties_missing_last_7_days: missing };
}

export function json(obj, status = 200) { return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }); }

export function originOk(request, env) {
  const o = request.headers.get('Origin'); if (!o) return true;
  let host; try { host = new URL(o).hostname; } catch (e) { return false; }
  const extra = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return ['thecapitalrow.com', 'www.thecapitalrow.com', 'localhost', '127.0.0.1'].includes(host) || host.endsWith('.capital-row.pages.dev') || host === 'capital-row.pages.dev' || extra.includes(host);
}

export function keyOk(request, env) {
  const k = request.headers.get('X-Retry-Key') || ''; const want = env.RETRY_KEY || '';
  if (!want || k.length !== want.length) return false;
  let d = 0; for (let i = 0; i < k.length; i++) d |= k.charCodeAt(i) ^ want.charCodeAt(i); return d === 0;
}

let CFG = null, CFG_AT = 0;
export async function loadConfig(env, request) {
  if (CFG && now() - CFG_AT < 300000) return CFG;
  try { const r = env.ASSETS ? await env.ASSETS.fetch(new URL('/forms-config.json', request.url)) : await fetch(new URL('/forms-config.json', request.url)); if (r.ok) { CFG = await r.json(); CFG_AT = now(); } }
  catch (e) {}
  return CFG;
}
