// GET /criteria/<code>/: a buyer's criteria sheet (server/criteria.js). Unknown, hidden or malformed codes get the
// site's not-found page. Out of search unless the buyer chose to show it publicly; the page prints to a one-page PDF.
import { CODE_RE, ensureCriteria, renderSheet } from '../../server/criteria.js';
import { loadConfig } from '../../server/core.js';

async function notFound(request, env) {
  let html = '<!doctype html><title>Not found</title><p>Not found.</p>';
  try { const r = await env.ASSETS.fetch(new URL('/404.html', request.url)); if (r.ok) html = await r.text(); } catch (e) {}
  return new Response(html, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex', 'Cache-Control': 'no-store' } });
}

export async function onRequestGet({ request, env, params }) {
  const seg = [].concat(params.path || []).filter(Boolean);
  const u = new URL(request.url);
  if (!seg.length) return Response.redirect(new URL('/buy-box/', u).href, 302);
  const code = String(seg[0]).toLowerCase();
  if (seg.length > 1 || !CODE_RE.test(code) || !env.DB) return notFound(request, env);
  if (!u.pathname.endsWith('/') || seg[0] !== code) return Response.redirect(new URL(`/criteria/${code}/` + u.search, u).href, 301);
  let row = null;
  try { await ensureCriteria(env.DB); row = await env.DB.prepare('SELECT data, public, hidden, updated_at FROM criteria WHERE code=?').bind(code).first(); } catch (e) {}
  if (!row || row.hidden) return notFound(request, env);
  const cfg = await loadConfig(env, request);
  let d = {}; try { d = JSON.parse(row.data); } catch (e) {}
  const pub = row.public === 1;
  const html = renderSheet(d, { public: pub, updated: row.updated_at, text: (cfg && cfg.text) || {}, url: `${env.SITE_URL || 'https://thecapitalrow.com'}/criteria/${code}/` });
  const h = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN',
    'Strict-Transport-Security': 'max-age=31536000', 'Referrer-Policy': pub ? 'strict-origin-when-cross-origin' : 'no-referrer' };
  if (!pub) h['X-Robots-Tag'] = 'noindex, nofollow';
  return new Response(html, { status: 200, headers: h });
}
export const onRequestHead = onRequestGet;
export function onRequest() { return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET' } }); }
