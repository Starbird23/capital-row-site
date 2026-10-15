// Compares two built sites page by page as documents (entities decoded, whitespace collapsed), not as bytes.
// Usage: node verify.js <dirA> <dirB>
const fs = require('fs'), path = require('path'), parse5 = require('parse5');
const [A, B] = process.argv.slice(2);
function canon(n, out) {
  if (n.nodeName === '#text') { const t = n.value.replace(/\s+/g, ' '); if (t.trim()) out.push('T:' + t.trim()); return; }
  if (n.nodeName === '#comment') return;
  if (n.tagName) {
    const attrs = (n.attrs || []).map((a) => a.name + '=' + a.value.replace(/\s+/g, ' ').trim()).sort().join(' ');
    out.push('<' + n.tagName + (attrs ? ' ' + attrs : '') + '>');
    if (n.tagName === 'script' || n.tagName === 'style') { out.push('RAW:' + (n.childNodes || []).map((c) => c.value || '').join('').replace(/\s+/g, ' ').trim()); out.push('</' + n.tagName + '>'); return; }
  }
  for (const c of n.childNodes || []) canon(c, out);
  if (n.tagName) out.push('</' + n.tagName + '>');
}
function pages(d) { const r = []; (function w(x) { for (const e of fs.readdirSync(x, { withFileTypes: true })) { const p = path.join(x, e.name); if (e.isDirectory()) w(p); else if (e.name === 'index.html') r.push(path.relative(d, p)); } })(d); return r.sort(); }
const pa = pages(A), pb = pages(B);
let bad = 0;
if (pa.join() !== pb.join()) { console.log('page lists differ', pa.filter((x) => !pb.includes(x)), pb.filter((x) => !pa.includes(x))); bad++; }
for (const p of pa) {
  if (!pb.includes(p)) continue;
  const a = [], b = [];
  canon(parse5.parse(fs.readFileSync(path.join(A, p), 'utf8')), a); canon(parse5.parse(fs.readFileSync(path.join(B, p), 'utf8')), b);
  if (a.length !== b.length || a.some((x, i) => x !== b[i])) {
    bad++; const i = a.findIndex((x, j) => x !== b[j]);
    console.log('DIFF', p, 'at', i, '\n  A:', (a[i] || '').slice(0, 160), '\n  B:', (b[i] || '').slice(0, 160));
  }
}
console.log(bad ? 'pages differing: ' + bad : 'identical as documents: ' + pa.length + ' pages');
process.exit(bad ? 1 : 0);
