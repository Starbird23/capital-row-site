// Builds the site: layouts (code) + text (from Sanity, or from local JSON) -> pages.
// Usage: node render.js <layoutsDir> <contentDir|sanity> <assetsDir> <outDir>
// With "sanity" the text is read from the project's public dataset (SANITY_PROJECT, SANITY_DATASET, optional SANITY_TOKEN).
const fs = require('fs'), path = require('path');
const [LAYOUTS, CONTENT, ASSETS, OUT] = process.argv.slice(2);
const ALLOWED = new Set(['em', 'i', 'b', 'strong', 'a', 'br']);
function escText(s) { return s.replace(/&(?!(?:amp|lt|gt|quot|#\d+|#x[0-9a-f]+|nbsp|rsquo|lsquo|rdquo|ldquo|middot|ndash|mdash|hellip);)/gi, '&amp;').replace(/>/g, '&gt;'); }
function escAttr(s) { return escText(s).replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
// the editor's text: plain text with <em> <i> <b> <strong> <a> <br>. A bare <a> takes its address from the layout, in order.
function inline(text, meta) {
  const q = { a: [], br: [] }; for (const t of (meta && meta.tags) || []) { const tn = t.match(/^<([a-z]+)/)[1]; if (q[tn]) q[tn].push(t); }
  const next = (tn) => q[tn].length ? q[tn].shift() : null;
  const open = [];
  let out = '';
  const re = /<(\/?)([a-z]+)((?:\s+[a-z-]+(?:="[^"]*")?)*)\s*\/?>/gi; let m, pos = 0;
  while ((m = re.exec(text))) {
    out += escText(text.slice(pos, m.index).replace(/</g, '&lt;')); pos = re.lastIndex;
    const close = m[1] === '/', tag = m[2].toLowerCase(), attrs = m[3] || '';
    if (!ALLOWED.has(tag)) { out += escText(m[0].replace(/</g, '&lt;')); continue; }
    if (tag === 'br') { out += (attrs.trim() ? '<br' + attrs + '>' : (next('br') || '<br>')); continue; }
    if (close) { const i = open.lastIndexOf(tag); if (i >= 0) { open.splice(i, 1); out += '</' + tag + '>'; } continue; }
    if (tag === 'a') { if (attrs.trim()) out += '<a' + attrs + '>'; else out += (next('a') || '<a>'); open.push('a'); continue; }
    out += '<' + tag + '>'; open.push(tag);
  }
  out += escText(text.slice(pos).replace(/</g, '&lt;'));
  while (open.length) out += '</' + open.pop() + '>';
  return out;
}
function dupList(html) {
  const m = html.match(/<ul class="racql">[\s\S]*?<\/ul>/); if (!m) return '';
  return m[0].replace('<ul class="racql">', '<ul class="racql racqdup" aria-hidden="true">').replace(/<a href="([^"]*)" target="_blank" rel="noopener noreferrer">/g, '<a href="$1" target="_blank" rel="noopener noreferrer" tabindex="-1">');
}
// the Sanity document "forms" (sector taxonomy, lists of choices, labels and messages) -> the config every page carries
function formsFromSanity(d) {
  return { v: 1,
    tax: (d.industries || []).map((i) => ({ id: i.id, label: i.title || '', sectors: (i.sectors || []).map((s) => ({ id: s.id, label: s.title || '' })) })),
    lists: Object.fromEntries((d.lists || []).map((l) => [l.id, (l.options || []).map((o) => [o.value || '', o.title || ''])])),
    text: Object.fromEntries((d.texts || []).map((t) => [t.key, t.title || ''])) };
}
async function loadContent() {
  if (CONTENT !== 'sanity') {
    const pages = {}; for (const f of fs.readdirSync(CONTENT)) { if (f === 'shared.json' || f === 'forms.json' || !f.endsWith('.json')) continue; pages[f.replace(/\.json$/, '')] = JSON.parse(fs.readFileSync(path.join(CONTENT, f), 'utf8')); }
    const ff = path.join(CONTENT, 'forms.json');
    return { pages, shared: JSON.parse(fs.readFileSync(path.join(CONTENT, 'shared.json'), 'utf8')), forms: fs.existsSync(ff) ? JSON.parse(fs.readFileSync(ff, 'utf8')) : null };
  }
  const pid = process.env.SANITY_PROJECT, ds = process.env.SANITY_DATASET || 'site', tok = process.env.SANITY_TOKEN;
  const q = encodeURIComponent('{"pages": *[_type == "sitePage"]{file, path, seoTitle, seoDescription, ogTitle, ogDescription, sections[]{id, name, items[]{key, "kind": subtitle, "text": title}}}, "shared": *[_id == "shared"][0]{blocks[]{id, name, items[]{key, "kind": subtitle, "text": title}}}, "forms": *[_id == "forms"][0]{industries[]{id, title, sectors[]{id, title}}, lists[]{id, options[]{value, title}}, texts[]{key, title}}}');
  const host = `https://${pid}.api.sanity.io`;   // not the CDN: a build must see the text as published a moment ago
  const r = await fetch(`${host}/v2026-02-01/data/query/${ds}?query=${q}&perspective=published`, { headers: tok ? { Authorization: 'Bearer ' + tok } : {} });
  if (!r.ok) throw new Error('Sanity query failed: ' + r.status + ' ' + (await r.text()).slice(0, 200));
  const { result } = await r.json();
  const pages = {}; for (const p of result.pages) pages[p.file] = p;
  const shared = {}; for (const b of (result.shared && result.shared.blocks) || []) shared[b.id] = b;
  return { pages, shared, forms: result.forms ? formsFromSanity(result.forms) : null };
}
// Structured data (schema.org JSON-LD), written from what each built page already shows: its address, title,
// description, headline and the questions in its FAQ. Nothing is added that the page does not say.
// Pages marked noindex and pages without a canonical address get none.
const SITE = 'https://thecapitalrow.com/', ORG = SITE + '#org', WEBSITE = SITE + '#website', PERSON = SITE + 'shawnee/#person';
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', middot: '·', ndash: '–', mdash: '—', hellip: '…', apos: "'" };
function plain(s) {
  return s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENT[e.toLowerCase()] ?? m))
    .replace(/\s+/g, ' ').replace(/\s+([.,;:?!])/g, '$1').trim();
}
const SECTION = { sellers: 'Sellers', buyers: 'Buyers', insights: 'Insights' };   // folders that have a page of their own
function jsonLd(html) {
  if (/<meta name="robots" content="[^"]*noindex/i.test(html)) return html;
  const canon = (html.match(/<link rel="canonical" href="([^"]+)"/) || [])[1]; if (!canon || !canon.startsWith(SITE)) return html;
  const title = plain((html.match(/<title>([\s\S]*?)<\/title>/) || [, ''])[1]).replace(/\s*\|\s*Capital Row$/, '');
  const desc = plain((html.match(/<meta name="description" content="([^"]*)"/) || [, ''])[1]);
  const image = (html.match(/<meta property="og:image" content="([^"]+)"/) || [])[1];
  const h1 = plain((html.slice(html.indexOf('<body')).match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [, ''])[1]);
  const segs = canon.slice(SITE.length).split('/').filter(Boolean);
  const isHome = !segs.length, hasOrg = html.includes('"@id":"' + ORG + '"'), hasPerson = html.includes('"@id":"' + PERSON + '"');
  const faq = [];
  for (const blk of html.matchAll(/<div class="faq">([\s\S]*?)<\/div>/g))
    for (const d of blk[1].matchAll(/<details[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g)) {
      const q = plain(d[1]), a = plain(d[2]); if (q && a) faq.push({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } });
    }
  const graph = [];
  if (isHome) {
    graph.push({ '@type': 'Organization', '@id': ORG, name: 'Capital Row', url: SITE, logo: SITE + 'favicon.svg', email: 'team@thecapitalrow.com', telephone: '+1-949-682-1223',
      sameAs: ['https://www.linkedin.com/company/thecapitalrow'], founder: { '@type': 'Person', '@id': PERSON, name: 'Shawnee Mercier', url: SITE + 'shawnee/' } });
    graph.push({ '@type': 'WebSite', '@id': WEBSITE, url: SITE, name: 'Capital Row', publisher: { '@id': ORG }, inLanguage: 'en' });
  } else if (!hasOrg) graph.push({ '@type': 'Organization', '@id': ORG, name: 'Capital Row', url: SITE });
  const type = faq.length ? 'FAQPage' : segs.length === 1 && segs[0] === 'about' ? 'AboutPage' : segs.length === 1 && segs[0] === 'insights' ? 'CollectionPage' : segs.length === 1 && segs[0] === 'shawnee' ? 'ProfilePage' : 'WebPage';
  const page = { '@type': type, '@id': canon + '#webpage', url: canon, name: title, isPartOf: { '@id': WEBSITE }, publisher: { '@id': ORG }, inLanguage: 'en' };
  if (desc) page.description = desc;
  if (type === 'ProfilePage' && hasPerson) page.mainEntity = { '@id': PERSON };
  if (faq.length) page.mainEntity = faq;
  if (!isHome) {
    const items = [{ '@type': 'ListItem', position: 1, name: 'Home', item: SITE }];
    if (segs.length > 1 && SECTION[segs[0]]) items.push({ '@type': 'ListItem', position: 2, name: SECTION[segs[0]], item: SITE + segs[0] + '/' });
    items.push({ '@type': 'ListItem', position: items.length + 1, name: title, item: canon });
    page.breadcrumb = { '@id': canon + '#breadcrumb' };
    graph.push(page, { '@type': 'BreadcrumbList', '@id': canon + '#breadcrumb', itemListElement: items });
  } else graph.push(page);
  if (segs.length === 2 && (segs[0] === 'insights' || segs[0] === 'guides') && h1) {
    const art = { '@type': 'Article', '@id': canon + '#article', headline: h1, mainEntityOfPage: { '@id': canon + '#webpage' }, author: { '@id': ORG }, publisher: { '@id': ORG }, inLanguage: 'en' };
    if (desc) art.description = desc; if (image) art.image = image;
    graph.push(art);
  }
  const tag = '<script type="application/ld+json">' + JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c') + '</script>\n';
  return html.replace('</head>', tag + '</head>');
}
(async () => {
  const { pages, shared, forms } = await loadContent();
  const formsJson = forms ? JSON.stringify(forms).replace(/</g, '\\u003c') : null;
  const sharedVals = {}; for (const b of Object.values(shared)) for (const it of b.items || []) sharedVals[it.key] = it.text;
  let n = 0, missing = [];
  for (const f of fs.readdirSync(LAYOUTS)) {
    if (!f.endsWith('.html')) continue;
    const stem = f.replace(/\.html$/, ''); const meta = JSON.parse(fs.readFileSync(path.join(LAYOUTS, stem + '.json'), 'utf8'));
    const page = pages[stem]; if (!page) { missing.push(stem); continue; }
    const vals = Object.assign({}, sharedVals); for (const s of page.sections || []) for (const it of s.items || []) vals[it.key] = it.text;
    let html = fs.readFileSync(path.join(LAYOUTS, f), 'utf8');
    html = html.replace(/\{\{([A-Za-z0-9_.:-]+)\}\}/g, (m, k) => {
      if (k === 'seoTitle') return escText(page.seoTitle || '').replace(/</g, '&lt;');
      if (k === 'seoDescription') return escAttr(page.seoDescription || '');
      if (k === 'ogTitle') return escAttr(page.ogTitle || page.seoTitle || '');
      if (k === 'ogDescription') return escAttr(page.ogDescription || page.seoDescription || '');
      if (k === 'dup:racql') return m;
      if (k === 'forms:json') { if (!formsJson) { missing.push(stem + ':forms'); return '{}'; } return formsJson; }
      if (!(k in vals)) { missing.push(stem + ':' + k); return ''; }
      return inline(vals[k], meta.slots[k]);
    });
    if (html.includes('{{dup:racql}}')) html = html.replace('{{dup:racql}}', dupList(html));
    if (forms) {   // every message and list the page code asks for must exist, or the build stops and the live site stays as it is
      for (const mm of html.matchAll(/CRM\('([^']+)'/g)) if (!(mm[1] in forms.text)) missing.push(stem + ':text:' + mm[1]);
      for (const mm of html.matchAll(/data-(?:ck)?list="([^"@]+)"/g)) if (!(mm[1] in forms.lists)) missing.push(stem + ':list:' + mm[1]);
    }
    const rel = stem === 'home' ? 'index.html' : stem.replace(/__/g, '/') + '/index.html';
    html = jsonLd(html);
    const o = path.join(OUT, rel); fs.mkdirSync(path.dirname(o), { recursive: true }); fs.writeFileSync(o, html); n++;
  }
  if (ASSETS && ASSETS !== '-') {
    (function copy(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) copy(p); else if (!e.name.endsWith('.html') || e.name === '404.html' || path.relative(ASSETS, p).includes(path.sep)) {  // standalone pages live in their own folder (e.g. dealbreaker-scan/index.html)
 const o = path.join(OUT, path.relative(ASSETS, p)); fs.mkdirSync(path.dirname(o), { recursive: true });
 if (e.name.endsWith('.html')) fs.writeFileSync(o, jsonLd(fs.readFileSync(p, 'utf8'))); else fs.copyFileSync(p, o); } } })(ASSETS);
  }
  if (forms) fs.writeFileSync(path.join(OUT, 'forms-config.json'), JSON.stringify(forms));   // read by the form server (functions/) to check choices
  missing = [...new Set(missing)];
  console.log(JSON.stringify({ pages: n, missing }));
  if (missing.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
