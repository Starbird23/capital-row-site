// Imports the extracted text into Sanity: one sitePage document per page, one siteShared document. Published directly (createOrReplace).
// Usage: SANITY_TOKEN=... node import.js <contentDir> <projectId> <dataset> [formsDocument.json]
const fs = require('fs'), path = require('path');
const [CONTENT, PID, DS] = process.argv.slice(2); const TOK = process.env.SANITY_TOKEN;
const TITLES = { home: 'Home' };
function pageTitle(stem, c) { if (TITLES[stem]) return TITLES[stem]; const h = (c.sections || []).flatMap((s) => s.items).find((i) => i.kind === 'Page headline'); return (h ? h.text.replace(/<[^>]+>/g, '') : stem) + '  (' + c.path + ')'; }
function key(i) { return 'k' + (i + 1); }
function items(list) { return list.map((it, i) => ({ _type: 'textItem', _key: it.key.replace(/[^A-Za-z0-9]/g, '_'), key: it.key, subtitle: it.kind, title: it.text })); }
async function mutate(mutations) {
  const r = await fetch(`https://${PID}.api.sanity.io/v2026-02-01/data/mutate/${DS}?returnIds=true`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOK }, body: JSON.stringify({ mutations }) });
  const t = await r.text(); if (!r.ok) throw new Error(r.status + ' ' + t.slice(0, 300)); return JSON.parse(t);
}
(async () => {
  const files = fs.readdirSync(CONTENT).filter((f) => f.endsWith('.json') && f !== 'shared.json' && f !== 'forms.json').sort();
  let n = 0;
  for (const f of files) {
    const stem = f.replace(/\.json$/, ''); const c = JSON.parse(fs.readFileSync(path.join(CONTENT, f), 'utf8'));
    const doc = { _id: 'page-' + stem, _type: 'sitePage', title: pageTitle(stem, c), path: c.path, file: stem, seoTitle: c.seoTitle, seoDescription: c.seoDescription,
      sections: c.sections.map((s) => ({ _type: 'pageSection', _key: s.id.replace(/[^A-Za-z0-9]/g, '_'), id: s.id, name: s.name, items: items(s.items) })) };
    if (c.ogTitle) doc.ogTitle = c.ogTitle; if (c.ogDescription) doc.ogDescription = c.ogDescription;
    const r = await mutate([{ createOrReplace: doc }]); n++; console.log(stem, r.results.map((x) => x.id).join(','), JSON.stringify(doc).length, 'bytes');
  }
  const sh = JSON.parse(fs.readFileSync(path.join(CONTENT, 'shared.json'), 'utf8'));
  const doc = { _id: 'shared', _type: 'siteShared', title: 'Every page', blocks: Object.entries(sh).map(([id, b]) => ({ _type: 'pageSection', _key: id, id, name: b.name, items: items(b.items) })) };
  const r = await mutate([{ createOrReplace: doc }]); console.log('shared', r.results.map((x) => x.id).join(','));
  // the forms document (sector taxonomy, choices, labels and messages), when its file is given
  const FORMS = process.argv[5];
  if (FORMS) { const fd = JSON.parse(fs.readFileSync(FORMS, 'utf8')); const rf = await mutate([{ createOrReplace: fd }]); console.log('forms', rf.results.map((x) => x.id).join(',')); n++; }
  console.log('documents', n + 1);
})().catch((e) => { console.error(e.message); process.exit(1); });
