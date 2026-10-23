// AI steps for the Buyer Map. The AI finds and reads pages; fixed code decides what is kept.
// 1. lookup(): reads a company's website and picks its industry from a fixed list. Anything outside the list, or not
//    confident, is refused, and the page asks the owner instead. The owner confirms every answer with one click.
// 2. research(): for companies outside healthcare, asks for acquisitions in the industry, each with the page it came from.
//    verifyDeal() then opens every page and keeps a deal only if the buyer, the company sold and the year all appear on it.
//    A price is kept only if its figure appears on the page. The result goes to HubSpot for Capital Row to review; it is
//    never shown to the owner by the site.

export const HC = { bh: 'Behavioral health', aba: 'ABA and autism services', hhh: 'Home health and hospice', rcm: 'Revenue cycle and billing',
  therapy: 'Physical, occupational and speech therapy', senior: 'Senior living and long-term care', practice: 'Physician, dental and specialty practices',
  other_hc: 'Other healthcare provider software' };
export const NONHC = { freight: 'Freight and logistics', field: 'Field service', construction: 'Construction', other: 'Other vertical software' };
export const CATS = Object.assign({}, HC, NONHC);

export const apiKey = (env) => { const v = String(env.ANTHROPIC_API_KEY || env.CR_ANTHROPIC_KEY || ''); const m = v.match(/sk-ant-[A-Za-z0-9_-]+/); return m ? m[0] : v.trim(); };   // takes the key out of whatever was pasted around it (spaces, line breaks, a whole sample command)
const API = (env) => (env.ANTHROPIC_BASE || 'https://api.anthropic.com') + '/v1/messages';

export async function claude(env, body, timeoutMs) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs || 60000);
  try {
    const r = await fetch(API(env), { method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey(env), 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body) });
    const text = await r.text();
    if (!r.ok) throw new Error('anthropic ' + r.status + ': ' + text.slice(0, 200));
    return JSON.parse(text);
  } finally { clearTimeout(t); }
}
// A turn that uses web search can pause (stop_reason "pause_turn") before the model has written its answer.
// converse() hands the paused turn back so the model can finish, up to a few times.
export async function converse(env, body, timeoutMs, maxRounds) {
  let messages = body.messages.slice(); let msg;
  for (let i = 0; i < (maxRounds || 4); i++) {
    msg = await claude(env, Object.assign({}, body, { messages }), timeoutMs);
    if (!msg || msg.stop_reason !== 'pause_turn') break;
    messages = messages.concat([{ role: 'assistant', content: msg.content }]);
  }
  return msg;
}
export function textOf(msg) { return ((msg && msg.content) || []).filter((b) => b.type === 'text').map((b) => b.text).join(''); }
export function jsonFrom(t) { const i = t.indexOf('{'), j = t.lastIndexOf('}'); if (i < 0 || j < i) return null; try { return JSON.parse(t.slice(i, j + 1)); } catch (e) { return null; } }
const clip = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);

// ---------------------------------------------------------------- daily limits (only when the database is bound)
export async function underLimit(env, kind, max) {
  if (!env.DB) return true;
  const day = new Date().toISOString().slice(0, 10);
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS ai_usage (day TEXT NOT NULL, kind TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, kind))').run();
  const row = await env.DB.prepare('SELECT n FROM ai_usage WHERE day=? AND kind=?').bind(day, kind).first();
  if (row && row.n >= max) return false;
  await env.DB.prepare('INSERT INTO ai_usage (day, kind, n) VALUES (?, ?, 1) ON CONFLICT(day, kind) DO UPDATE SET n = n + 1').bind(day, kind).run();
  return true;
}

// ---------------------------------------------------------------- 1. what does the company do
export async function lookup(env, company, website) {
  const list = Object.entries(CATS).map(([k, v]) => `${k} = ${v}`).join('\n');
  const msg = await converse(env, {
    model: env.AI_LOOKUP_MODEL || 'claude-haiku-5-5', max_tokens: 700,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
    system: 'You identify what a company sells, for a business directory. Search for the company and read its own website first. ' +
      'Then answer with JSON only, no other text: {"category": "<one key from the list>", "what": "<one plain sentence under 20 words: what the company sells and to whom, ' +
      'from what you read>", "confidence": "high" or "low", "source": "<the URL you read it on>"}. Categories:\n' + list + '\n' +
      'Healthcare categories are only for software or services sold to healthcare providers. A company that moves freight, runs trucks or brokers loads, ' +
      'or sells software to those businesses, is freight. If you cannot find the company, or more than one category could fit, set confidence to low. Never guess.',
    messages: [{ role: 'user', content: `Company: ${clip(company, 120)}\nWebsite: ${clip(website, 200) || 'not given'}` }],
  }, 45000);
  const j = jsonFrom(textOf(msg));
  if (!j || !(j.category in CATS)) return { ok: false, reason: 'no answer' };
  const source = /^https?:\/\//.test(String(j.source || '')) ? clip(j.source, 300) : '';
  const confident = j.confidence === 'high' && !!source;
  return { ok: true, category: j.category, label: CATS[j.category], healthcare: j.category in HC, what: /\d/.test(String(j.what || '')) ? '' : clip(j.what, 160),
    confident, source };
}

// ---------------------------------------------------------------- 2. acquisitions in the industry, every one checked against its page
export function pageText(html) {
  return String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;|&#8217;/g, "'").replace(/\s+/g, ' ').toLowerCase();
}
const STOP = new Set(['inc', 'inc.', 'llc', 'ltd', 'corp', 'corp.', 'corporation', 'company', 'co', 'co.', 'group', 'holdings', 'the', 'and', '&', 'of', 'technologies', 'software', 'partners', 'capital', 'llc.']);
export function nameFound(name, text) {
  const n = String(name || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9&.' -]/g, ' ').replace(/\s+/g, ' ').trim();
  if (n.length < 2) return false;
  if (text.includes(n)) return true;
  const words = n.split(' ').filter((w) => w.length > 1 && !STOP.has(w));
  return words.length > 0 && words.every((w) => new RegExp('(^|[^a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)').test(text));
}
export function verifyDeal(d, text) {
  const why = [];
  if (!nameFound(d.buyer, text)) why.push('buyer not on page');
  if (!nameFound(d.target, text)) why.push('company sold not on page');
  const y = (String(d.date || '').match(/(19|20)\d\d/) || [])[0];
  if (!y || !text.includes(y)) why.push('year not on page');
  let price = 'Not disclosed';
  const p = clip(d.price, 120);
  if (p && !/not disclosed/i.test(p)) {
    const figs = p.match(/\d[\d,.]*/g) || [];
    if (figs.length && figs.every((f) => text.includes(f.replace(/[.,]$/, '')))) price = p;
  }
  return { ok: why.length === 0, why, price };
}
async function fetchPage(url, fetchImpl) {
  try {
    const u = new URL(url); if (!/^https?:$/.test(u.protocol)) return null;
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 12000);
    const r = await (fetchImpl || fetch)(u.href, { signal: ctl.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CapitalRowResearch/1.0)', Accept: 'text/html,*/*' } });
    clearTimeout(t);
    if (!r.ok) return null;
    return pageText((await r.text()).slice(0, 600000));
  } catch (e) { return null; }
}
// Revenue bands the Buyer Map asks for, in dollars: [low, high]. Used to aim the search and to drop deals far outside the owner's size.
export const BANDS = { 'Less than $1M': [0, 1e6], '$1M to $3M': [1e6, 3e6], '$3M to $10M': [3e6, 1e7], '$10M to $30M': [1e7, 3e7], 'More than $30M': [3e7, Infinity] };
export const BUYER_TYPES = ['private equity', 'strategic', 'search fund', 'startup', 'other'];
// A disclosed price in dollars, or null. "$12 million", "$1.2B", "$450,000".
export function dollars(p) {
  const m = String(p || '').replace(/,/g, '').match(/\$\s*(\d+(?:\.\d+)?)\s*(thousand|million|billion|k|m|mm|b|bn)?\b/i);
  if (!m) return null; const n = parseFloat(m[1]); const u = (m[2] || '').toLowerCase();
  return n * (u === 'thousand' || u === 'k' ? 1e3 : u === 'million' || u === 'm' || u === 'mm' ? 1e6 : u === 'billion' || u === 'b' || u === 'bn' ? 1e9 : 1);
}
// A price below a fifth of the owner's low revenue, or above 15 times the high revenue, is a different size of deal.
export function sizeFits(price, band) {
  const b = BANDS[band]; const v = dollars(price); if (!b || v == null) return true;
  return v >= b[0] * 0.2 && v <= b[1] * 15;
}
export async function research(env, { label, what, company, revenue }, fetchImpl) {
  const since = String(new Date().getUTCFullYear() - 3);
  const msg = await converse(env, {
    model: env.AI_RESEARCH_MODEL || 'claude-haiku-5-5', max_tokens: 6000,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: Number(env.AI_RESEARCH_SEARCHES || 6) }],
    system: 'You find completed acquisitions of companies in one industry, from press releases and trade press. Only report a deal you read on a page ' +
      'during this task, and give that page. Never report from memory. Answer with JSON only: {"deals": [{"buyer": "", "target": "", "date": "Mon YYYY", ' +
      '"what": "<what the company sold, under 15 words>", "price": "<the price exactly as the page states it, or Not disclosed>", ' +
      '"buyer_type": "private equity" or "strategic" or "search fund" or "startup" or "other", "url": "<the page you read it on>"}]}. ' +
      'Up to 10 deals, newest first, North American companies only. Prefer companies sold that were close in size to the one described.',
    messages: [{ role: 'user', content: `Find acquisitions of companies like this one, so the owner sees who buys companies like theirs. The company: ${clip(company, 120)}${what ? '. What it sells and to whom: ' + clip(what, 160) : ''}. The market it serves, as the owner chose it: ${clip(label, 80)}. ${BANDS[revenue] ? 'Its annual revenue: ' + revenue + '. ' : ''}Look first for companies that sell the same thing to the same market; if there are few, widen to the same thing sold to nearby markets. Acquisitions since January ${since}.` }],
  }, 120000);
  const j = jsonFrom(textOf(msg));
  const note = !j ? 'The AI search did not return a list (' + ((msg && msg.stop_reason) || 'no answer') + '). Build this map by hand or run it again.' : '';
  const raw = j && Array.isArray(j.deals) ? j.deals.slice(0, 10) : [];
  const kept = [], dropped = []; const cache = {};
  for (const d of raw) {
    const url = clip(d && d.url, 400);
    if (!url) { dropped.push({ d, why: ['no page given'] }); continue; }
    if (!(url in cache)) cache[url] = await fetchPage(url, fetchImpl);
    const text = cache[url];
    if (!text) { dropped.push({ d, why: ['page would not open'] }); continue; }
    const v = verifyDeal(d, text);
    if (v.ok && !sizeFits(v.price, revenue)) { dropped.push({ d, why: ['price far from the owner\'s size (' + v.price + ')'] }); continue; }
    const bt = String(d.buyer_type || '').toLowerCase(); const buyerType = BUYER_TYPES.includes(bt) ? bt : '';
    if (v.ok) kept.push({ buyer: clip(d.buyer, 120), target: clip(d.target, 120), date: clip(d.date, 20), what: clip(d.what, 140), price: v.price, buyerType, url });
    else dropped.push({ d, why: v.why });
  }
  return { kept, dropped, asked: raw.length, note, revenue: BANDS[revenue] ? revenue : '' };
}

export function researchReport({ company, website, label, what }, r) {
  const lines = [`Research map for review: ${company}${website ? ' (' + website + ')' : ''}`, `Industry: ${label}`, r.revenue ? `Revenue: ${r.revenue}` : '', what ? `What they do: ${what}` : '', '',
    r.note || '', r.asked === 0 && !r.note ? 'The AI search found no acquisitions it could cite for this industry. Build this map by hand.' : '',
    `Kept ${r.kept.length} of ${r.asked} deals the AI reported. Each was checked: the buyer, the company sold and the year appear on the page given. Prices are kept only where the figure appears on the page.`, ''];
  r.kept.forEach((d, i) => lines.push(`${i + 1}. ${d.date}: ${d.buyer}${d.buyerType ? ' (' + d.buyerType + ')' : ''} acquired ${d.target}. ${d.what} Price: ${d.price}. Source: ${d.url}`));
  if (r.dropped.length) { lines.push('', 'Removed by the check:'); r.dropped.forEach((x) => lines.push(`- ${clip(x.d && x.d.buyer, 80)} / ${clip(x.d && x.d.target, 80)}: ${x.why.join(', ')}`)); }
  lines.push('', 'Nothing has been sent to the owner. Review before sending.');
  return lines.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
}

// The owner-facing list for the Buyer Map email: only deals that passed the page check, newest first, each with its source.
export const READY_AT = 3;
export function ownerMap(r, max) {
  const lines = r.kept.map((d, i) => `${i + 1}. ${d.date}: ${d.buyer}${d.buyerType ? ' (' + d.buyerType + ')' : ''} acquired ${d.target}. ${d.what}${/[.!?]$/.test(d.what) ? '' : '.'} Price: ${d.price}. Source: ${d.url}`); let out = '';
  for (const l of lines) { if ((out + l).length + 1 > (max || 3900)) break; out += (out ? '\n' : '') + l; }
  return out;
}
