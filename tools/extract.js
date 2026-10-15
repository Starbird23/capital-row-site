// Splits a built site into layouts (code, kept in the repository) and text (kept in Sanity).
// Usage: node extract.js <distDir> <outDir>
//   <outDir>/layouts/<page>.html   the page with {{key}} where editable text was
//   <outDir>/layouts/<page>.json   what each key is: where it sits, what kind of text, the inline tags it carried
//   <outDir>/content/<page>.json   the editable text, as it reads on the site today
//   <outDir>/content/shared.json   the text that is the same on every page (top bar, menu, footer, pop-ups)
const fs = require('fs'), path = require('path'), parse5 = require('parse5');
const [DIST, OUT] = process.argv.slice(2);
const SKIP = new Set(['script', 'style', 'select', 'option', 'noscript', 'svg', 'canvas', 'video', 'template', 'head', 'title']);
const SIMPLE_INLINE = new Set(['a', 'em', 'strong', 'b', 'i', 'br']);
const SHARED_NAMES = { osbar: 'Top bar', mast: 'Menu', footer: 'Footer', ck: 'Cookie notice', sn: 'Follow a sector box', snt: 'Follow a sector tab', rt: 'Valuation calculator button', valuation: 'Valuation calculator', talk: 'Contact form' };
const SHARED = ['osbar', 'mast', 'footer', 'ck', 'sn', 'snt', 'rt', 'valuation', 'talk'];
const KIND = [[/^h1$/, 'Page headline'], [/^h2$/, 'Section headline'], [/^h3$/, 'Heading'], [/^h4$/, 'Heading'],
  [/^(button)$/, 'Button'], [/^label$/, 'Form label'], [/^legend$/, 'Form label'], [/^li$/, 'List item'], [/^td|th$/, 'Table cell'], [/^dt|dd$/, 'List item']];
function attr(n, k) { const a = (n.attrs || []).find((x) => x.name === k); return a ? a.value : null; }
function cls(n) { return (attr(n, 'class') || '').split(/\s+/).filter(Boolean); }
function kindOf(n) {
  const c = cls(n);
  if (n.tagName === 'a' && (c.includes('bigcta') || c.includes('btn') || c.includes('cta') || c.includes('osgo') || c.includes('vcbtn'))) return 'Button';
  if (n.tagName === 'a') return 'Link';
  if (c.includes('lab') || c.includes('dr-n') || c.includes('kick') || c.includes('vclab')) return 'Small label';
  if (c.includes('src') || c.includes('fine') || c.includes('ctamicro') || c.includes('racqn') || c.includes('vcfine') || c.includes('vcsrc')) return 'Note';
  for (const [re, k] of KIND) if (re.test(n.tagName)) return k;
  if (n.tagName === 'p') return 'Paragraph';
  return 'Text';
}
const esc = (s) => s.replace(/</g, '&lt;');
function walkText(n) { return n.nodeName === '#text' ? n.value : (n.childNodes || []).map(walkText).join(''); }
function hasLetters(s) { const t = s.trim(); return /[A-Za-z0-9]/.test(t) && !/^[\d.]$/.test(t) && t.length > 1; }
function simpleInline(n) {
  if (n.nodeName === '#text') return true;
  if (n.nodeName === '#comment') return false;
  if (!SIMPLE_INLINE.has(n.tagName)) return false;
  if (n.tagName !== 'a' && n.tagName !== 'br' && (n.attrs || []).length) return false;
  return (n.childNodes || []).every(simpleInline);
}
function isSlot(n) {
  if (!n.tagName || SKIP.has(n.tagName)) return false;
  const kids = n.childNodes || [];
  const direct = kids.filter((k) => k.nodeName === '#text' && /\S/.test(k.value));
  const inlineKids = kids.filter((k) => k.tagName && SIMPLE_INLINE.has(k.tagName) && k.tagName !== 'br' && /\S/.test(walkText(k)));
  if (!direct.length && inlineKids.length !== 1) return false;
  if (!kids.every(simpleInline)) return false;
  if (!hasLetters(walkText(n))) return false;
  return true;
}
// inline markup -> the editor's form: a small HTML subset, <em> <i> <b> <strong> <a> <br>. A link's address stays in the layout
// (the full start tag is kept beside the key); <a href="..."> written by the editor makes a new link.
function toMd(n, tags) {
  let out = '';
  for (const k of n.childNodes || []) {
    if (k.nodeName === '#text') { out += esc(k.value.replace(/\s*\n\s*/g, ' ')); continue; }
    if (k.nodeName === '#comment') continue;
    const open = parse5.serializeOuter(k).match(/^<[^>]*>/)[0];
    if (k.tagName === 'br') { if ((k.attrs || []).length) tags.push(open); out += '<br>'; continue; }
    if (k.tagName === 'a') tags.push(open);
    out += '<' + k.tagName + '>' + toMd(k, tags) + '</' + k.tagName + '>';
  }
  return out;
}
const SECTION_TAGS = new Set(['section', 'header', 'footer', 'aside']);
function sectionOf(n) {
  const chain = []; let p = n.parentNode;
  while (p && p.tagName !== 'body') { chain.unshift(p); p = p.parentNode; }   // outermost first
  const tagged = chain.filter((x) => SECTION_TAGS.has(x.tagName) || cls(x).includes('figpage') || cls(x).includes('q-hero') || cls(x).includes('band'));
  const inner = tagged.filter((x) => cls(x).includes('band') || cls(x).includes('figpage'));
  if (inner.length) return inner[inner.length - 1];
  if (tagged.length) return tagged[0];
  for (const x of chain) { if (x.tagName === 'main') continue; if (attr(x, 'id') || cls(x).length) return x; }
  return chain[0] || n;
}
function sectionName(sec) {
  let h = null, lab = null;
  (function f(n) { if (h) return; for (const k of n.childNodes || []) { if (k.tagName === 'h1' || k.tagName === 'h2') { h = walkText(k); return; } if (!lab && k.tagName && (cls(k).includes('lab') || cls(k).includes('racqh'))) lab = walkText(k); f(k); } })(sec);
  const id = attr(sec, 'id'), c = cls(sec);
  const t = (h || lab || id || c[0] || sec.tagName).replace(/\s+/g, ' ').trim();
  return t.length > 70 ? t.slice(0, 67) + '...' : t;
}
function sharedKey(sec) { const id = attr(sec, 'id'), c = cls(sec); if (sec.tagName === 'footer') return 'footer'; for (const s of SHARED) if (id === s || c.includes(s)) return s; return null; }

function extractPage(file, rel) {
  const html = fs.readFileSync(file, 'utf8');
  const doc = parse5.parse(html, { sourceCodeLocationInfo: true });
  const cuts = [], slots = [], content = {};
  let n = 0; const secIndex = new Map();
  // the head: title and description (og:title and og:description repeat them)
  const head = doc.childNodes.find((x) => x.tagName === 'html').childNodes.find((x) => x.tagName === 'head');
  const title = head.childNodes.find((x) => x.tagName === 'title');
  const metas = head.childNodes.filter((x) => x.tagName === 'meta');
  const desc = metas.find((m) => attr(m, 'name') === 'description'), ogt = metas.find((m) => attr(m, 'property') === 'og:title'), ogd = metas.find((m) => attr(m, 'property') === 'og:description');
  const tt = walkText(title); content.seoTitle = tt; content.seoDescription = attr(desc, 'content');
  cuts.push([title.childNodes[0].sourceCodeLocation.startOffset, title.childNodes[0].sourceCodeLocation.endOffset, '{{seoTitle}}']);
  function attrCut(m, name, key) { const loc = m.sourceCodeLocation.attrs[name]; const raw = html.slice(loc.startOffset, loc.endOffset); const i = raw.indexOf('"'); cuts.push([loc.startOffset + i + 1, loc.endOffset - 1, '{{' + key + '}}']); }
  attrCut(desc, 'content', 'seoDescription');
  if (ogt && attr(ogt, 'content') === tt) attrCut(ogt, 'content', 'seoTitle'); else if (ogt) { content.ogTitle = attr(ogt, 'content'); attrCut(ogt, 'content', 'ogTitle'); }
  if (ogd && attr(ogd, 'content') === content.seoDescription) attrCut(ogd, 'content', 'seoDescription'); else if (ogd) { content.ogDescription = attr(ogd, 'content'); attrCut(ogd, 'content', 'ogDescription'); }
  const body = doc.childNodes.find((x) => x.tagName === 'html').childNodes.find((x) => x.tagName === 'body');
  const lost = [];
  function visit(node) {
    if (!node.tagName) return;
    if (SKIP.has(node.tagName)) return;
    const c = cls(node);
    if (c.includes('dkdata')) return;   // the hidden copy of the sector list stays in the layout
    if (c.includes('racqdup')) { const loc = node.sourceCodeLocation; cuts.push([loc.startOffset, loc.endOffset, '{{dup:racql}}']); return; }
    if (isSlot(node)) {
      const loc = node.sourceCodeLocation; if (!loc.endTag) return;
      const inner = html.slice(loc.startTag.endOffset, loc.endTag.startOffset);
      const lead = inner.match(/^\s*/)[0].length, trail = inner.match(/\s*$/)[0].length;
      const tags = []; const md = toMd(node, tags).trim();
      const sec = sectionOf(node); const sk = sharedKey(sec);
      const secId = attr(sec, 'id') || cls(sec)[0] || sec.tagName;
      if (!secIndex.has(sec)) secIndex.set(sec, { id: secId, name: sectionName(sec), shared: sk, items: [] });
      const key = 's' + (++n);
      const kind = kindOf(node);
      const slot = { key, section: secId, kind, tag: node.tagName, cls: c.join(' '), tags };
      slots.push(slot); secIndex.get(sec).items.push({ key, kind, text: md });
      cuts.push([loc.startTag.endOffset + lead, loc.endTag.startOffset - trail, '{{' + key + '}}']);
      return;
    }
    // a mixed element: each run of text and simple inline tags is one slot; the other children are visited on their own
    const kids = node.childNodes || []; let run = [];
    const flush = () => {
      while (run.length && run[0].nodeName === '#text' && !/\S/.test(run[0].value)) run.shift();
      while (run.length && run[run.length - 1].nodeName === '#text' && !/\S/.test(run[run.length - 1].value)) run.pop();
      if (!run.length) return;
      const elems = run.filter((k) => k.tagName);
      if (elems.length > 1 && !run.some((k) => k.nodeName === '#text' && /[A-Za-z0-9]/.test(k.value))) { const r = run; run = []; for (const k of r) if (k.tagName) visit(k); return; }
      const text = run.map(walkText).join('');
      if (hasLetters(text)) {
        const first = run[0], last = run[run.length - 1];
        let s0 = first.sourceCodeLocation.startOffset, e0 = last.sourceCodeLocation.endOffset, holder = node, inside = { childNodes: run };
        if (run.length === 1 && first.tagName && first.sourceCodeLocation.endTag) { s0 = first.sourceCodeLocation.startTag.endOffset; e0 = first.sourceCodeLocation.endTag.startOffset; holder = first; inside = first; }
        const raw = html.slice(s0, e0); const lead = raw.match(/^\s*/)[0].length, trail = raw.match(/\s*$/)[0].length;
        if (e0 - trail > s0 + lead) {
          const tags = []; const md = toMd(inside, tags).trim();
          const sec = sectionOf(node); const sk = sharedKey(sec); const secId = attr(sec, 'id') || cls(sec)[0] || sec.tagName;
          if (!secIndex.has(sec)) secIndex.set(sec, { id: secId, name: sectionName(sec), shared: sk, items: [] });
          const key = 's' + (++n); const kind = kindOf(holder);
          slots.push({ key, section: secId, kind, tag: holder.tagName, cls: cls(holder).join(' '), tags }); secIndex.get(sec).items.push({ key, kind, text: md });
          cuts.push([s0 + lead, e0 - trail, '{{' + key + '}}']);
        }
      } else if (/[A-Za-z]/.test(text)) lost.push({ tag: node.tagName, cls: c.join(' '), text: text.trim().slice(0, 80) });
      run = [];
    };
    for (const k of kids) {
      if (k.nodeName === '#comment') { flush(); continue; }
      if (simpleInline(k)) { run.push(k); continue; }
      flush(); visit(k);
    }
    flush();
  }
  visit(body);
  cuts.sort((a, b) => a[0] - b[0]);
  let out = '', pos = 0;
  for (const [s, e, m] of cuts) { if (s < pos) throw new Error('overlap in ' + rel); out += html.slice(pos, s) + m; pos = e; }
  out += html.slice(pos);
  const sections = [...secIndex.values()];
  return { html: out, slots, content, sections, lost };
}

const pages = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name === 'index.html') pages.push(p); } })(DIST);
pages.sort();
const all = {};
for (const f of pages) { const rel = path.relative(DIST, f).replace(/\\/g, '/'); all[rel] = extractPage(f, rel); }
// shared text: a block is shared when every page that carries it carries the same text in the same order
const shared = {}, sharedSig = {};
for (const s of SHARED) {
  const sigs = Object.entries(all).map(([rel, p]) => [rel, p.sections.filter((x) => x.shared === s).map((x) => x.items.map((i) => i.kind + '|' + i.text).join('\u0001')).join('\u0002')]).filter(([, sig]) => sig);
  if (!sigs.length) continue;
  const same = sigs.every(([, sig]) => sig === sigs[0][1]);
  sharedSig[s] = { pages: sigs.length, same, differ: same ? [] : sigs.filter(([, sig]) => sig !== sigs[0][1]).map(([r]) => r) };
}
fs.mkdirSync(path.join(OUT, 'layouts'), { recursive: true }); fs.mkdirSync(path.join(OUT, 'content'), { recursive: true });
const report = { pages: {}, shared: sharedSig };
for (const [rel, p] of Object.entries(all)) {
  const stem = rel.replace(/\/?index\.html$/, '') || 'home';
  let html = p.html; const pageContent = { path: '/' + (stem === 'home' ? '' : stem + '/'), seoTitle: p.content.seoTitle, seoDescription: p.content.seoDescription, sections: [] };
  if (p.content.ogTitle) pageContent.ogTitle = p.content.ogTitle; if (p.content.ogDescription) pageContent.ogDescription = p.content.ogDescription;
  const keymap = {};
  for (const sec of p.sections) {
    const isShared = sec.shared && sharedSig[sec.shared] && sharedSig[sec.shared].same;
    if (isShared) {
      if (!shared[sec.shared]) shared[sec.shared] = { name: SHARED_NAMES[sec.shared] || sec.name, items: [] };
      sec.items.forEach((it, i) => { const k = 'sh.' + sec.shared + '.' + (i + 1); if (!shared[sec.shared].items[i]) shared[sec.shared].items[i] = { key: k, kind: it.kind, text: it.text }; keymap[it.key] = k; });
    } else {
      const items = sec.items.map((it, i) => { const k = sec.id.replace(/[^a-z0-9]/gi, '') + '.' + (i + 1); keymap[it.key] = k; return { key: k, kind: it.kind, text: it.text }; });
      pageContent.sections.push({ id: sec.id, name: sec.name, items });
    }
  }
  html = html.replace(/\{\{(s\d+)\}\}/g, (m, k) => '{{' + keymap[k] + '}}');
  const slotMeta = {}; for (const s of p.slots) slotMeta[keymap[s.key]] = { kind: s.kind, tag: s.tag, cls: s.cls, tags: s.tags, section: s.section };
  const file = stem.replace(/\//g, '__');
  fs.writeFileSync(path.join(OUT, 'layouts', file + '.html'), html);
  fs.writeFileSync(path.join(OUT, 'layouts', file + '.json'), JSON.stringify({ page: pageContent.path, slots: slotMeta }, null, 1));
  fs.writeFileSync(path.join(OUT, 'content', file + '.json'), JSON.stringify(pageContent, null, 1));
  report.pages[rel] = { slots: p.slots.length, sections: pageContent.sections.length, lost: p.lost };
}
fs.writeFileSync(path.join(OUT, 'content', 'shared.json'), JSON.stringify(shared, null, 1));
fs.writeFileSync(path.join(OUT, 'extract-report.json'), JSON.stringify(report, null, 1));
console.log(JSON.stringify({ pages: pages.length, slots: Object.values(all).reduce((a, p) => a + p.slots.length, 0), shared: Object.fromEntries(Object.entries(sharedSig).map(([k, v]) => [k, v.same ? 'same on ' + v.pages : 'differs: ' + v.differ.join(',')])), lost: Object.values(all).reduce((a, p) => a + p.lost.length, 0) }));
