// Criteria sheets: every buy box sent is saved in D1 (table "criteria") under a random code and shown at
// /criteria/<code>/ (functions/criteria/[[path]].js). The same email address sending the buy box again updates the same
// sheet; the last five versions are kept in "history" so an unwanted change can be put back. The sheet carries the firm
// and its criteria only: no name, email, phone or the free-text "additional criteria" box. It is out of search unless
// the buyer ticked "Show my criteria publicly". Set hidden=1 on a row to take a sheet down.

const ALPHA = '23456789abcdefghjkmnpqrstuvwxyz';           // 31 characters, no 0/o, 1/l/i
export const CODE_RE = /^[23456789abcdefghjkmnpqrstuvwxyz]{12}$/;
export const SITE = 'https://thecapitalrow.com';

export function newCode(n = 12) {
  let out = '';
  while (out.length < n) {
    const a = new Uint8Array(n * 2); crypto.getRandomValues(a);
    for (const x of a) if (x < 248 && out.length < n) out += ALPHA[x % 31];   // 248 = 31 * 8: no bias
  }
  return out;
}

export async function emailHash(email) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('capital-row-criteria|' + String(email).trim().toLowerCase()));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function ensureCriteria(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS criteria (code TEXT PRIMARY KEY, email_hash TEXT NOT NULL UNIQUE, data TEXT NOT NULL,
    public INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, history TEXT)`).run();
}

// what the page may store: text keys with their length limits, the ranges, and the public box
const TEXT = { firm: 160, website: 200, kind: 120, approach: 300, platform: 160, ownership: 200, role: 80, sectors: 4000, company_types: 300, geography: 300,
  geography_detail: 300, customers: 300, profitability: 120, revenue_model: 300, recurring: 120, growth: 80, capital: 80, regulated: 80, founder: 120,
  timing: 80, funding: 80, exclusions: 1200 };
const RANGES = ['rev', 'arr', 'ebitda', 'ev', 'eq'];
export function cleanSheet(s) {
  if (!s || typeof s !== 'object') return null;
  const out = {};
  for (const [k, n] of Object.entries(TEXT)) { const v = typeof s[k] === 'string' ? s[k].replace(/\s+/g, ' ').trim().slice(0, n) : ''; if (v) out[k] = v; }
  for (const r of RANGES) for (const side of ['min', 'max']) {
    const k = r + '_' + side, v = typeof s[k] === 'string' ? s[k].trim() : '';
    if (/^-?\d{1,15}$/.test(v) || v === 'No minimum' || v === 'No maximum') out[k] = v;
  }
  out.public = s.public === true;
  return out;
}

// saves the sheet for this email address; returns { code, path, url, created } or null
export async function upsertCriteria(env, email, sheet) {
  const data = cleanSheet(sheet); if (!data || !env.DB) return null;
  const db = env.DB, h = await emailHash(email), t = Date.now(), pub = data.public ? 1 : 0, body = JSON.stringify(data);
  await ensureCriteria(db);
  const done = (code, created) => ({ code, path: `/criteria/${code}/`, url: `${env.SITE_URL || SITE}/criteria/${code}/`, created });
  const old = await db.prepare('SELECT code, data, public, updated_at, history FROM criteria WHERE email_hash=?').bind(h).first();
  if (old) {
    if (old.data !== body || old.public !== pub) {
      let hist = []; try { hist = JSON.parse(old.history || '[]'); } catch (e) {}
      hist.unshift({ at: old.updated_at, public: old.public, data: old.data });
      await db.prepare('UPDATE criteria SET data=?, public=?, updated_at=?, history=? WHERE code=?').bind(body, pub, t, JSON.stringify(hist.slice(0, 5)), old.code).run();
    }
    return done(old.code, false);
  }
  for (let i = 0; i < 4; i++) {
    const code = newCode();
    try {
      await db.prepare('INSERT INTO criteria (code, email_hash, data, public, hidden, created_at, updated_at, history) VALUES (?, ?, ?, ?, 0, ?, ?, NULL)').bind(code, h, body, pub, t, t).run();
      return done(code, true);
    } catch (e) {
      const again = await db.prepare('SELECT code FROM criteria WHERE email_hash=?').bind(h).first();   // sent twice at once
      if (again) return done(again.code, false);
    }
  }
  return null;
}

// ---------------------------------------------------------------- the page
const DEF = { 'sheet.label': 'Acquisition criteria', 'sheet.title': 'acquisition criteria', 'sheet.sectors': 'Sectors', 'sheet.company_types': 'Company types',
  'sheet.regulated': 'Regulated sectors', 'sheet.size': 'Size', 'sheet.revenue': 'Annual revenue', 'sheet.arr': 'ARR', 'sheet.ebitda': 'Adjusted EBITDA',
  'sheet.check': 'Check size', 'sheet.equity': 'Equity per deal', 'sheet.ev': 'Enterprise value', 'sheet.structure': 'Structure', 'sheet.ownership': 'Ownership',
  'sheet.approach': 'Approach', 'sheet.platform': 'Platform', 'sheet.role': 'Lead or co-invest', 'sheet.founder': 'Founder after close', 'sheet.operating': 'Operating profile',
  'sheet.profitability': 'Profitability', 'sheet.recurring': 'Recurring revenue', 'sheet.revenue_model': 'Revenue model', 'sheet.growth': 'Revenue growth',
  'sheet.capital': 'Outside capital raised', 'sheet.geo_timing': 'Geography and timing', 'sheet.headquarters': 'Headquarters', 'sheet.customers': 'Customer markets',
  'sheet.timeline': 'Timeline', 'sheet.funding': 'Funding', 'sheet.exclusions': 'Exclusions', 'sheet.to': 'to', 'sheet.or_more': 'or more', 'sheet.up_to': 'Up to',
  'sheet.any': 'Any', 'sheet.updated': 'Updated', 'sheet.prepared': 'Prepared with Capital Row', 'sheet.save_pdf': 'Save as PDF', 'sheet.copy': 'Copy link',
  'sheet.copied': 'Link copied', 'sheet.update': 'Update these criteria', 'sheet.private': 'Private page. Only people with this link can see it.',
  'sheet.public': 'Public page. Search engines can list it.', 'sheet.firm_fallback': 'Buyer' };

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function money(v) {
  const n = Number(v), a = Math.abs(n), sign = n < 0 ? '-' : '';
  const f = (x) => (Math.round(x * 10) / 10).toString().replace(/\.0$/, '');
  if (a >= 1e9) return sign + '$' + f(a / 1e9) + 'B';
  if (a >= 1e6) return sign + '$' + f(a / 1e6) + 'M';
  if (a >= 1e3) return sign + '$' + f(a / 1e3) + 'K';
  return sign + '$' + a;
}
function range(d, r, T) {
  const lo = d[r + '_min'] || '', hi = d[r + '_max'] || '';
  const isn = (x) => /^-?\d+$/.test(x);
  if (isn(lo) && isn(hi)) return money(lo) + ' ' + T('sheet.to') + ' ' + money(hi);
  if (isn(lo)) return money(lo) + ' ' + T('sheet.or_more');
  if (isn(hi)) return T('sheet.up_to') + ' ' + money(hi);
  if (lo === 'No minimum' && hi === 'No maximum') return T('sheet.any');
  return '';
}
const list = (s) => String(s || '').split(/\s*;\s*/).filter(Boolean);
const joinList = (s) => list(s).join(' · ');
function usDate(ms) { return new Date(ms).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' }); }
function site(u) {
  const s = String(u || '').trim(); if (!s) return null;
  try { const x = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s); if (!/^https?:$/.test(x.protocol) || !x.hostname.includes('.')) return null; return { href: x.href, text: x.hostname.replace(/^www\./, '') }; }
  catch (e) { return null; }
}

// rows of [section label, [[sub label or '', value], ...]]; empty answers are left out
export function sheetRows(d, T) {
  const sec = [
    ['sheet.sectors', [['', joinList(d.sectors)], ['sheet.company_types', joinList(d.company_types)], ['sheet.regulated', d.regulated]]],
    ['sheet.size', [['sheet.revenue', range(d, 'rev', T)], ['sheet.arr', range(d, 'arr', T)], ['sheet.ebitda', range(d, 'ebitda', T)]]],
    ['sheet.check', [['sheet.equity', range(d, 'eq', T)], ['sheet.ev', range(d, 'ev', T)]]],
    ['sheet.structure', [['sheet.ownership', joinList(d.ownership)], ['sheet.approach', joinList(d.approach)], ['sheet.platform', d.platform], ['sheet.role', d.role], ['sheet.founder', d.founder]]],
    ['sheet.operating', [['sheet.profitability', d.profitability], ['sheet.recurring', d.recurring], ['sheet.growth', d.growth], ['sheet.revenue_model', joinList(d.revenue_model)], ['sheet.capital', d.capital]]],
    ['sheet.geo_timing', [['sheet.headquarters', [joinList(d.geography), d.geography_detail].filter(Boolean).join(': ')], ['sheet.customers', joinList(d.customers)], ['sheet.timeline', d.timing], ['sheet.funding', d.funding]]],
    ['sheet.exclusions', [['', d.exclusions]]],
  ];
  return sec.map(([k, items]) => [T(k), items.filter((x) => x[1]).map(([s, v]) => [s ? T(s) : '', v])]).filter((r) => r[1].length);
}

export function renderSheet(d, o) {
  const text = (o && o.text) || {};
  const T = (k) => (typeof text[k] === 'string' && text[k] ? text[k] : DEF[k] || '');
  const firm = d.firm || T('sheet.firm_fallback'), web = site(d.website), pub = !!o.public, url = o.url;
  const rows = sheetRows(d, T);
  const desc = [T('sheet.label') + ' for ' + firm, list(d.sectors).slice(0, 4).join(', '), range(d, 'rev', T) && T('sheet.revenue') + ' ' + range(d, 'rev', T)].filter(Boolean).join('. ') + '.';
  const body = rows.map(([lab, items]) => `<section class="row"><h2>${esc(lab)}</h2><div class="val">${items.map(([s, v]) => (s ? `<p class="kv"><span class="sub">${esc(s)}</span><span>${esc(v)}</span></p>` : `<p>${esc(v)}</p>`)).join('')}</div></section>`).join('\n');
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(firm)} ${esc(T('sheet.title'))} | Capital Row</title>
<meta name="description" content="${esc(desc)}">
${pub ? `<link rel="canonical" href="${esc(url)}">` : '<meta name="robots" content="noindex, nofollow">'}
<meta property="og:type" content="website">
<meta property="og:site_name" content="Capital Row">
<meta property="og:title" content="${esc(firm)}: ${esc(T('sheet.label'))}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${SITE}/capital-row-social-card.jpg">
<meta name="theme-color" content="#0C3234">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/fonts/cormorant-garamond-latin-500-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/outfit-latin-300-normal.woff2" as="font" type="font/woff2" crossorigin>
<style>
@font-face{font-family:'Cormorant Garamond';font-weight:500;font-display:swap;src:url(/fonts/cormorant-garamond-latin-500-normal.woff2) format('woff2')}
@font-face{font-family:'Cormorant Garamond';font-weight:600;font-display:swap;src:url(/fonts/cormorant-garamond-latin-600-normal.woff2) format('woff2')}
@font-face{font-family:'Outfit';font-weight:300;font-display:swap;src:url(/fonts/outfit-latin-300-normal.woff2) format('woff2')}
@font-face{font-family:'Outfit';font-weight:400;font-display:swap;src:url(/fonts/outfit-latin-400-normal.woff2) format('woff2')}
@font-face{font-family:'IBM Plex Mono';font-weight:400;font-display:swap;src:url(/fonts/ibm-plex-mono-latin-400-normal.woff2) format('woff2')}
:root{--ink:#141E1F;--ink2:#2A3A3B;--ink3:#5C6B6B;--paper:#FBF9F5;--paper2:#F4F0E9;--card:#FFFFFF;--teal:#14706E;--deep:#0C3234;--line:#E2DCD1;--bronze:#A67C3D;
--ser:'Cormorant Garamond',Georgia,serif;--sans:'Outfit',system-ui,sans-serif;--mono:'IBM Plex Mono',ui-monospace,monospace}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper2);color:var(--ink);font-family:var(--sans);font-weight:300;line-height:1.5}
.bar{max-width:880px;margin:0 auto;padding:18px 16px 0;display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between}
.bar .note{font-size:13px;color:var(--ink3)}
.bar .acts{display:flex;flex-wrap:wrap;gap:8px}
.btn{font:400 14px var(--sans);border:1px solid var(--deep);background:var(--deep);color:#fff;padding:9px 16px;border-radius:2px;cursor:pointer;text-decoration:none;display:inline-block}
.btn.ghost{background:transparent;color:var(--deep)}
.btn:focus-visible{outline:2px solid var(--teal);outline-offset:2px}
.sheet{max-width:880px;margin:14px auto 40px;background:var(--card);border:1px solid var(--line);padding:56px 64px 40px}
.lab{font:400 11.5px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--teal);margin:0 0 14px}
h1{font:500 50px/1.04 var(--ser);margin:0;letter-spacing:-.005em}
.who{margin:14px 0 0;font-size:17px;color:var(--ink2)}
.who a{color:var(--teal);text-decoration:none;border-bottom:1px solid rgba(20,112,110,.35)}
.rows{margin-top:38px;border-top:1px solid var(--ink)}
.row{display:grid;grid-template-columns:200px 1fr;gap:28px;padding:18px 0;border-bottom:1px solid var(--line);break-inside:avoid}
.row h2{font:400 11.5px/1.9 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--ink3);margin:0;padding-top:4px}
.val p{margin:0 0 6px;font:500 23px/1.3 var(--ser);color:var(--ink)}
.val p:last-child{margin-bottom:0}
.val .kv{display:grid;grid-template-columns:170px 1fr;gap:12px;align-items:baseline}
.val .sub{font:400 14px var(--sans);color:var(--ink3)}
.foot{display:flex;flex-wrap:wrap;justify-content:space-between;gap:10px;margin-top:30px;font-size:13px;color:var(--ink3)}
.foot b{font:600 17px var(--ser);color:var(--ink);letter-spacing:.01em}
.foot b span{color:var(--teal)}
.foot a{color:inherit;text-decoration:none}
.mark{display:inline-flex;align-items:flex-end;gap:2px;height:12px;margin-right:8px;vertical-align:-1px}
.mark i{display:block;width:3px;height:12px;background:var(--ink);transform-origin:bottom}
.mark i:nth-child(1){transform:scaleY(.4)}.mark i:nth-child(2){transform:scaleY(.67)}.mark i:nth-child(3){background:var(--teal)}.mark i:nth-child(4){transform:scaleY(.6)}.mark i:nth-child(5){transform:scaleY(.34)}
@media (max-width:700px){.sheet{padding:30px 20px 26px;margin:12px 0 28px;border-left:0;border-right:0}h1{font-size:36px}.row{grid-template-columns:1fr;gap:6px;padding:14px 0}.val p{font-size:20px}.val .kv{grid-template-columns:1fr;gap:0}.val .sub{font-size:13px}.bar{padding:14px 16px 0}}
@media print{@page{size:letter;margin:.55in .6in}body{background:#fff}.bar{display:none}.sheet{border:0;margin:0;padding:0;max-width:none}h1{font-size:38px}.rows{margin-top:24px}.row{grid-template-columns:150px 1fr;gap:18px;padding:10px 0}.val p{font-size:16.5px;margin-bottom:3px}.val .kv{grid-template-columns:135px 1fr;gap:10px}.val .sub{font-size:11px}.row h2{font-size:9.5px}.who{font-size:13.5px}.foot{margin-top:18px;font-size:11px}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>
</head><body>
<div class="bar"><span class="note">${esc(pub ? T('sheet.public') : T('sheet.private'))}</span><span class="acts"><button class="btn" type="button" id="pdf">${esc(T('sheet.save_pdf'))}</button><button class="btn ghost" type="button" id="copy" data-done="${esc(T('sheet.copied'))}">${esc(T('sheet.copy'))}</button><a class="btn ghost" href="/buy-box/">${esc(T('sheet.update'))}</a></span></div>
<main class="sheet">
<p class="lab">${esc(T('sheet.label'))}</p>
<h1>${esc(firm)}</h1>
${(d.kind || web) ? `<p class="who">${[esc(d.kind || ''), web ? `<a href="${esc(web.href)}" rel="nofollow noopener" target="_blank">${esc(web.text)}</a>` : ''].filter(Boolean).join(' · ')}</p>` : ''}
<div class="rows">
${body}
</div>
<div class="foot"><b><span class="mark" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>${esc(T('sheet.prepared'))}</b><span><a href="${SITE}/">thecapitalrow.com</a> · ${esc(T('sheet.updated'))} ${esc(usDate(o.updated))}</span></div>
</main>
<script>
document.getElementById('pdf').onclick=function(){window.print()};
document.getElementById('copy').onclick=function(){var b=this,u=location.href.split('?')[0].split('#')[0],t=b.textContent;function done(){b.textContent=b.getAttribute('data-done');setTimeout(function(){b.textContent=t},1800)}if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(u).then(done,function(){prompt('',u)});else prompt('',u)};
if(/[?&]print=1/.test(location.search))window.addEventListener('load',function(){setTimeout(function(){window.print()},300)});
</script>
</body></html>`;
}
