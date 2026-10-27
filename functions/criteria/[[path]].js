// /criteria/<code>/            a buyer's criteria sheet (server/criteria.js); always private, prints to a one-page PDF.
// /criteria/confirm/<token>/   the link HubSpot's buy box confirmation email carries when a change came from a new browser:
//                              GET shows the new criteria and a Confirm button (nothing changes), POST applies them.
// Unknown, hidden or malformed codes get the site's not-found page.
import { CODE_RE, TOKEN_RE, ensureCriteria, renderSheet, renderConfirm, findPending, applyPending } from '../../server/criteria.js';
import { loadConfig, originOk } from '../../server/core.js';

const HDR = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN',
  'Strict-Transport-Security': 'max-age=31536000', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' };
const site = (env) => env.SITE_URL || 'https://thecapitalrow.com';

async function notFound(request, env) {
  let html = '<!doctype html><title>Not found</title><p>Not found.</p>';
  try { const r = await env.ASSETS.fetch(new URL('/404.html', request.url)); if (r.ok) html = await r.text(); } catch (e) {}
  return new Response(html, { status: 404, headers: HDR });
}
const opts = async (env, request) => { const cfg = (await loadConfig(env, request)) || {}; return { text: cfg.text || {}, cfg }; };
function route(request, params) {
  const seg = [].concat(params.path || []).filter(Boolean), u = new URL(request.url);
  if (seg[0] === 'confirm') return { kind: 'confirm', token: String(seg[1] || ''), ok: seg.length === 2 && TOKEN_RE.test(seg[1]), slash: u.pathname.endsWith('/'), u };
  return { kind: 'sheet', code: String(seg[0] || '').toLowerCase(), raw: seg[0], ok: seg.length === 1 && CODE_RE.test(String(seg[0] || '').toLowerCase()), empty: !seg.length, slash: u.pathname.endsWith('/'), u };
}

export async function onRequestGet({ request, env, params }) {
  const r = route(request, params);
  if (r.kind === 'sheet' && r.empty) return Response.redirect(new URL('/buy-box/', r.u).href, 302);
  if (!r.ok || !env.DB) return notFound(request, env);
  if (r.kind === 'confirm') {
    if (!r.slash) return Response.redirect(new URL(`/criteria/confirm/${r.token}/`, r.u).href, 301);
    const p = await findPending(env, r.token).catch(() => null);
    // same-origin, not no-referrer: with no-referrer the browser sends "Origin: null" on the Confirm button and the POST is refused
    return new Response(renderConfirm({ data: p && p.data, ...(await opts(env, request)), url: `${site(env)}/criteria/` }), { status: p ? 200 : 410, headers: { ...HDR, 'Referrer-Policy': 'same-origin' } });
  }
  if (!r.slash || r.raw !== r.code) return Response.redirect(new URL(`/criteria/${r.code}/` + r.u.search, r.u).href, 301);
  let row = null;
  try { await ensureCriteria(env.DB); row = await env.DB.prepare('SELECT data, hidden, updated_at FROM criteria WHERE code=?').bind(r.code).first(); } catch (e) {}
  if (!row || row.hidden) return notFound(request, env);
  let d = {}; try { d = JSON.parse(row.data); } catch (e) {}
  const html = renderSheet(d, { updated: row.updated_at, confirmed: r.u.searchParams.get('confirmed') === '1', ...(await opts(env, request)), url: `${site(env)}/criteria/${r.code}/` });
  return new Response(html, { status: 200, headers: HDR });
}
export const onRequestHead = onRequestGet;

export async function onRequestPost({ request, env, params }) {
  const r = route(request, params);
  if (r.kind !== 'confirm' || !r.ok || !env.DB) return notFound(request, env);
  if (!originOk(request, env)) return new Response('Forbidden', { status: 403 });
  let key = ''; try { const f = await request.formData(); key = String(f.get('key') || ''); } catch (e) {}
  const done = await applyPending(env, r.token, key).catch(() => null);
  if (!done) return new Response(renderConfirm({ data: null, ...(await opts(env, request)), url: `${site(env)}/criteria/` }), { status: 410, headers: HDR });
  return new Response(null, { status: 303, headers: { Location: done.path + '?confirmed=1', 'Cache-Control': 'no-store' } });
}
export function onRequest() { return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, POST' } }); }
