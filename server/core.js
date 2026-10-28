// Capital Row form delivery: every website form posts here (Cloudflare Pages Functions, /api/submit).
// 1. The submission is checked against HubSpot's own field names and values (server/hubspot-schema.js). An answer HubSpot
//    would discard is not sent; it stays in the message and its name is recorded as dropped (see /api/status).
// 2. It is saved in D1 (binding DB) under the key the page sends; the same key twice is the same submission, never two.
// 3. Only then does the page hear "saved", and only then does it show "received".
// 4. Delivery to HubSpot runs after the answer, and again from /api/retry until HubSpot accepts it. After the last attempt,
//    or on a refusal that a retry cannot fix, an alert goes out (email through Resend, and/or a webhook).
// Without a DB binding the server sends to HubSpot straight away and answers "saved" only when HubSpot has accepted it.

import { HS_SCHEMA } from './hubspot-schema.js';
import { SECTOR_MAP } from './sector-map.js';

export const HS_PORTAL = '247329185';
export const HS_FORMS = { 'Conversation': '8e02c346-11f0-4b2d-a17c-a596397264ee', 'Owner session seat': '2252081f-64ac-4259-925b-0bd99f4fb517', 'Contact exchange': '065ddb74-fd13-4f6a-9442-baf9b73406fc' };
const ENV_FORM = { 'Conversation': 'HS_FORM_MAIN', 'Buy box': 'HS_FORM_BUYBOX', 'Pre-Market Assessment request': 'HS_FORM_ASSESS', 'Bad or broken deal report': 'HS_FORM_DEAL',
  'Capital Connections': 'HS_FORM_CC', 'Owner session seat': 'HS_FORM_SEAT', 'Follow a sector': 'HS_FORM_FOLLOW', 'Valuation calculator': 'HS_FORM_VALUATION',
  'Contact exchange': 'HS_FORM_EXCHANGE' };
export const KINDS = Object.keys(ENV_FORM);
const BACKOFF_MIN = [1, 5, 15, 60, 180, 360, 720, 1440];          // minutes before attempt 2, 3, ...
export const MAX_ATTEMPTS = BACKOFF_MIN.length + 1;
const isGuid = (x) => /^[0-9a-fA-F-]{30,40}$/.test(x || '');
export function formFor(kind, env) { const e = env[ENV_FORM[kind]]; return isGuid(e) ? e : (HS_FORMS[kind] || HS_FORMS['Conversation']); }

// ---------------------------------------------------------------- validation
// HubSpot is the one definition of every field (server/hubspot-schema.js). HubSpot accepts a submission even when an answer
// does not fit, and then silently discards that answer, so the check happens here: a property HubSpot does not have, or a value
// it does not list, is not sent. The answer is still in "message", and the name goes into "dropped" (shown by /api/status), so a
// gap is visible instead of silent. Only a submission without a usable email address, or without a message, is refused.

// The industry the software serves: the website's ids, HubSpot's values (Target end markets, Industries chosen on the website).
export const END_MARKETS = { hc: 'Healthcare', fin: 'Financial services', built: 'Construction, real estate and field services', gov: 'Government',
  fleet: 'Transportation and logistics', mfg: 'Manufacturing', hosp: 'Hospitality', retail: 'Retail and automotive', prof: 'Legal and professional services',
  tech: 'Technology services', fbw: 'Fitness, beauty and wellness', npo: 'Nonprofit and associations' };
// Values sent by pages built before October 27, 2026 (a visitor may still have one open), in HubSpot's terms. A value with no
// HubSpot equivalent (for example the old "$10M to $25M" revenue band) maps to nothing and stays in the message.
const LEGACY = {
  cr_contact_type: { inter: 'intermediary' },
  offering_type: { 'Pure software / SaaS': 'Software', 'Software-led hybrid': 'Hybrid', 'Services-led hybrid': 'Hybrid', 'Pure services': 'Services' },
  revenue_band: { '$5M to $10M': '$5M-$10M' },
  arr_band: { 'Under $1M': 'Under $1M', '$1M to $3M': '$1M–$3M', '$3M to $5M': '$3M–$5M', '$5M to $10M': '$5M–$10M' },
};
// Answers the website no longer sends as properties (they are in the message). Pages built before October 27 may still send
// them; they are set aside without being counted as a gap.
const MESSAGE_ONLY = new Set(['cr_details', 'cr_client_type', 'cr_lending_geography', 'cr_cash_flow_appetite', 'cr_loan_min', 'cr_loan_max', 'cr_range_flags',
  'cr_main_reason', 'cr_revenue_ltm', 'cr_adjusted_earnings_ltm', 'cr_headquarters_region', 'cr_stage', 'cr_target_geography_detail', 'cr_target_range_flags',
  'cr_owner_session']);
// Contact properties first created with a cr_ prefix on October 27 and recreated without it the same day (Shawnee: "we started
// without it"). A page built before the change may still send an old name.
const RENAMED = { cr_heard_via: 'heard_via', cr_heard_via_detail: 'heard_via_detail', cr_reason: 'reason_for_contact', cr_kind: 'advisor_or_lender_type', cr_sector: 'website_sectors', cr_industry: 'website_industries', cr_sector_followed: 'sectors_followed', cr_criteria_retention_consent: 'criteria_on_file_consent', cr_recontact_consent: 'deal_report_contact_consent', cr_research_use_consent: 'deal_report_research_consent' };
// "Other" in a sector picker is not a sector a buyer targets or a reader follows: left out of these two without counting as a gap
const QUIET_OTHER = new Set(['target_sectors', 'sectors_followed']);
const SELLER_KINDS = new Set(['Conversation', 'Pre-Market Assessment request', 'Valuation calculator', 'Capital Connections']);
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const LIMIT = (n) => (n === 'message' ? 20000 : n === 'cr_buyer_map_research' ? 4000 : 1000);
export const propOf = (o, n) => (HS_SCHEMA[o] || {})[n];

// checks one value against HubSpot's definition; returns the value to send, or '' when nothing fits
function fit(o, n, v) {
  const p = propOf(o, n); if (!p) return '';
  v = String(v).trim(); if (!v) return '';
  const L = LEGACY[n]; if (L && L[v] !== undefined) v = L[v];
  if (p.t === 'text') return v.length <= LIMIT(n) ? v : '';
  if (p.t === 'number') return /^-?\d{1,15}(\.\d+)?$/.test(v) ? v : '';
  if (p.t === 'bool') return v === 'true' || v === 'false' ? v : '';
  if (p.multi) { const ok = [...new Set(v.split(';').map((x) => x.trim()).filter((x) => p.o.includes(x)))]; return ok.join(';'); }
  return p.o.includes(v) ? v : '';
}
const one = (vals) => { const u = [...new Set(vals.filter(Boolean))]; return u.length === 1 ? u[0] : ''; };
const uniq = (vals) => [...new Set(vals.filter(Boolean))].join(';');

// returns { fatal: [...], fields: [the fields HubSpot will keep], dropped: [names] }
export function cleanFields(kind, fields, cfg) {
  if (!Array.isArray(fields) || !fields.length || fields.length > 160) return { fatal: ['fields'], fields: [], dropped: [] };
  const got = {}, dropped = [];
  for (const f of fields) {
    if (!f || typeof f.name !== 'string' || typeof f.value !== 'string') { dropped.push('?'); continue; }
    const o = f.objectTypeId || '0-1', n = (o === '0-1' && RENAMED[f.name]) || f.name;
    if (MESSAGE_ONLY.has(n)) continue;
    let v = f.value;
    if (n === 'website_industries' || n === 'target_end_markets') v = v.split(';').map((x) => END_MARKETS[x.trim()] || x.trim()).join(';');
    if (!propOf(o, n)) { dropped.push(n); continue; }
    const w = fit(o, n, v);
    if (!w) { if (v.trim() && !(QUIET_OTHER.has(n) && v.split(';').every((x) => x.trim() === 'other'))) dropped.push(n); continue; }
    if (propOf(o, n).multi) {   // some of several values did not fit
      const sent = v.split(';').map((x) => x.trim()).filter((x) => x && !(QUIET_OTHER.has(n) && x === 'other'));
      if (w.split(';').length < sent.length) dropped.push(n + ' (part)');
    }
    if (!got[o + n]) got[o + n] = { objectTypeId: o, name: n, value: w };
  }
  const val = (o, n) => (got[o + n] || {}).value || '';
  const set = (o, n, v) => { const w = v ? fit(o, n, v) : ''; if (w && !got[o + n]) got[o + n] = { objectTypeId: o, name: n, value: w }; };
  const type = val('0-1', 'cr_contact_type');
  // the company's place in the firm taxonomy, from the website sectors (approved table, server/sector-map.js)
  const secs = val('0-1', 'website_sectors').split(';').filter((x) => SECTOR_MAP[x]);
  const isSeller = SELLER_KINDS.has(kind) && (type === 'seller' || (kind === 'Capital Connections' && !type));
  if (isSeller) {
    set('0-2', 'company_type', 'Seller or target');
    set('0-2', 'end_markets_served', val('0-1', 'website_industries'));   // the website's 12, the same list as a buyer's Target end markets
    if (secs.length) {   // only when every sector the owner chose agrees; otherwise left for a person (the sectors are on the contact)
      const subs = secs.map((x) => SECTOR_MAP[x].sub);   // blank for a sector the site does not guess, and then for the company
      set('0-2', 'industry__subsector', subs.every(Boolean) ? one(subs) : '');
      set('0-2', 'industry_segment', one(secs.map((x) => SECTOR_MAP[x].seg)));
      set('0-2', 'custom_industry', one(secs.map((x) => SECTOR_MAP[x].ind)));
    }
  }
  if (type === 'buyer' && (kind === 'Conversation' || kind === 'Buy box')) {
    set('0-2', 'company_type', 'Buyer');
    const ts = val('0-2', 'target_sectors').split(';').filter((x) => SECTOR_MAP[x]);
    set('0-2', 'target_verticals', uniq(ts.map((x) => SECTOR_MAP[x].seg)));
    set('0-2', 'target_industries', uniq(ts.map((x) => SECTOR_MAP[x].ind)));
  }
  set('0-1', 'brand', 'Capital Row');   // every thecapitalrow.com contact is tagged Capital Row
  const out = Object.values(got);
  const fatal = EMAIL.test(val('0-1', 'email')) ? [] : ['email'];
  if (!val('0-1', 'message')) fatal.push('message');
  return { fatal, fields: out, dropped: [...new Set(dropped)] };
}
// kept for the tests and older callers: the list of problems, as before
export function checkFields(kind, fields, cfg) { const r = cleanFields(kind, fields, cfg); return [...r.fatal, ...r.dropped.map((n) => 'dropped:' + n)]; }

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
  for (let round = 0; round < 8; round++) {
    const body = { fields, context: payload.context || {} };
    if (payload.consent) body.legalConsentOptions = payload.consent;
    let r, j = null, text = '';
    try { r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); text = await r.text(); try { j = JSON.parse(text); } catch (e) {} }
    catch (e) { return { ok: false, transient: true, error: 'network: ' + String(e && e.message || e).slice(0, 200), dropped }; }
    if (r.ok) return { ok: true, status: r.status, dropped };
    const errs = (j && j.errors) || [];
    if (r.status === 400 && errs.length) {
      const names = fields.map((f) => f.name);
      const named = (e) => names.filter((n) => new RegExp('(^|[^A-Za-z0-9_])' + n + '([^A-Za-z0-9_]|$)').test(e.message || ''));
      let bad = [], unnamed = false;
      for (const e of errs) { const hit = named(e).filter((n) => n !== 'email' && n !== 'message'); if (hit.length) bad.push(...hit); else unnamed = true; }
      // a field HubSpot does not have on the form, without a recognisable name: drop the site's own properties
      if (unnamed && errs.every((e) => e.errorType === 'FIELD_NOT_IN_FORM_DEFINITION')) { bad.push(...names.filter((n) => n.startsWith('cr_') || n.startsWith('target_') || ['offering_type', 'revenue_band', 'arr_band', 'buyer_type', 'domain'].includes(n))); unnamed = false; }
      bad = [...new Set(bad)];
      if (unnamed || !bad.length) return { ok: false, transient: false, error: 'hubspot 400: ' + text.slice(0, 300), dropped };
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
  const all = [...(payload.failed_checks || []), ...(res.dropped || [])];   // answers the check set aside, and any HubSpot refused
  const attempts = row.attempts + 1, dropped = all.length ? JSON.stringify([...new Set(all)]) : null;
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
