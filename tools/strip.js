// Publishing copy: removes code comments (CSS, JS, HTML) from each page. Code is otherwise unchanged:
// no renaming and no compression, so behavior is identical. Usage: node strip.js <srcDir> <outDir>
const fs = require('fs'), path = require('path'), { minify } = require('terser');
const [src, out] = process.argv.slice(2);
function walk(d) { return fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]); }
(async () => {
  let n = 0, before = 0, after = 0;
  for (const f of walk(src)) {
    const rel = path.relative(src, f), o = path.join(out, rel);
    fs.mkdirSync(path.dirname(o), { recursive: true });
    if (!f.endsWith('.html')) { fs.copyFileSync(f, o); continue; }
    let h = fs.readFileSync(f, 'utf8'); before += h.length;
    const parts = []; let i = 0;
    const re = /<(script|style)(\b[^>]*)>([\s\S]*?)<\/\1>/g; let m;
    while ((m = re.exec(h))) {
      parts.push({ t: 'html', s: h.slice(i, m.index) });
      parts.push({ t: m[1], open: `<${m[1]}${m[2]}>`, s: m[3], close: `</${m[1]}>` });
      i = re.lastIndex;
    }
    parts.push({ t: 'html', s: h.slice(i) });
    let res = '';
    for (const p of parts) {
      if (p.t === 'html') res += p.s.replace(/<!--[\s\S]*?-->/g, '');
      else if (p.t === 'style') res += p.open + p.s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\n{2,}/g, '\n') + p.close;
      else {
        const r = await minify(p.s, { compress: false, mangle: false, format: { comments: false, beautify: true, indent_level: 1 } });
        if (r.code === undefined) throw new Error('terser failed in ' + rel);
        res += p.open + '\n' + r.code + '\n' + p.close;
      }
    }
    fs.writeFileSync(o, res); after += res.length; n++;
  }
  console.log(JSON.stringify({ pages: n, kb_before: Math.round(before / 1024), kb_after: Math.round(after / 1024) }));
})().catch(e => { console.error(e); process.exit(1); });
