// Digital business cards (thecapitalrow.com/<slug>): what the vCard, the Apple Wallet pass and the follow-up task are built from.
// Every word on a card page comes from Sanity like any other page. The vCard and the pass read the published page itself
// (elements marked data-card="...") so the three can never disagree. Signing keys live only in Cloudflare secrets.
import forge from 'node-forge';
import { zipSync, strToU8 } from 'fflate';

export const SITE = 'https://thecapitalrow.com';
// The card slugs this site serves. A new card is a new layout + Sanity page + one line here.
export const CARDS = { shawnee: { owner: 'shawnee-mercier', serial: 'cr-card-shawnee-mercier-v1' } };
// Where a visit came from, from the utm_source on the tagged link (see tools/card/urls.md).
export const CHANNELS = ['wallet', 'nfc', 'qr-print', 'qr-screen', 'share', 'vcard', 'direct', 'other'];
export function taggedUrl(slug, source, content) {
  const u = new URL(SITE + '/' + slug);
  u.searchParams.set('utm_source', source); u.searchParams.set('utm_medium', 'business-card'); u.searchParams.set('utm_campaign', slug + '-card');
  if (content) u.searchParams.set('utm_content', content);
  return u.toString();
}

// ---------------------------------------------------------------- reading the published card page
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '\u2019', lsquo: '\u2018', rdquo: '\u201d', ldquo: '\u201c', middot: '\u00b7', ndash: '\u2013', hellip: '\u2026' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENT[e.toLowerCase()] ?? m));
async function fetchAsset(env, request, path) {
  const u = new URL(path, request.url);
  const r = env.ASSETS ? await env.ASSETS.fetch(new Request(u.toString())) : await fetch(u.toString());
  return r;
}
export async function readCard(env, request, slug) {
  const r = await fetchAsset(env, request, '/' + slug);
  if (!r.ok) throw new Error('card page ' + r.status);
  const card = {}; let key = null;
  const take = (attr) => ({ element(el) { const k = el.getAttribute('data-card'); if (!k) return;
    if (attr === 'text') { key = k; card[k] = ''; el.onEndTag && el.onEndTag(() => { key = null; }); }
    else card[k] = el.getAttribute(attr) || ''; } });
  await new HTMLRewriter()
    .on('[data-card][data-card-href]', take('href'))
    .on('img[data-card]', take('src'))
    .on('[data-card]:not([data-card-href]):not(img)', Object.assign(take('text'), { text(t) { if (key) card[key] += t.text; } }))
    .transform(r).arrayBuffer();
  for (const k of Object.keys(card)) card[k] = decode(card[k]).replace(/\s+/g, ' ').trim();
  if (card.email) card.email = card.email.replace(/^mailto:/i, '');
  if (card.tel) card.tel = card.tel.replace(/^tel:/i, '');
  if (!card.fn || !card.email) throw new Error('card page is missing its name or email');
  return card;
}

// ---------------------------------------------------------------- vCard 3.0 (the version iOS, Android and Outlook all import)
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
function fold(line) { const out = []; let s = line; while (s.length > 75) { out.push(s.slice(0, 75)); s = ' ' + s.slice(75); } out.push(s); return out.join('\r\n'); }
function b64(buf) { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }
export async function buildVCard(env, request, slug) {
  const c = await readCard(env, request, slug);
  const parts = c.fn.split(' '); const given = parts.shift(); const family = parts.join(' ');
  const L = ['BEGIN:VCARD', 'VERSION:3.0', `N:${esc(family)};${esc(given)};;;`, `FN:${esc(c.fn)}`];
  if (c.org) L.push(`ORG:${esc(c.org)}`);
  if (c.title) L.push(`TITLE:${esc(c.title)}`);
  L.push(`EMAIL;TYPE=INTERNET,WORK,PREF:${c.email}`);
  if (c.tel) L.push(`TEL;TYPE=WORK,VOICE:${c.tel}`);
  if (c.website) L.push(`item1.URL:${c.website}`, 'item1.X-ABLabel:Website');
  if (c.linkedin) L.push(`item2.URL:${c.linkedin}`, 'item2.X-ABLabel:LinkedIn', `X-SOCIALPROFILE;TYPE=linkedin:${c.linkedin}`);
  L.push(`item3.URL:${taggedUrl(slug, 'vcard')}`, 'item3.X-ABLabel:Digital card');
  if (c.booking) L.push(`item4.URL:${c.booking}`, 'item4.X-ABLabel:Book a meeting');
  if (c.photo) { try { const p = await fetchAsset(env, request, c.photo); if (p.ok) L.push(`PHOTO;ENCODING=b;TYPE=JPEG:${b64(await p.arrayBuffer())}`); } catch (e) {} }
  L.push(`REV:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')}`, 'END:VCARD');
  return { text: L.map(fold).join('\r\n') + '\r\n', name: c.fn.replace(/[^A-Za-z0-9]+/g, '-') + '.vcf' };
}

// ---------------------------------------------------------------- Apple Wallet pass
// Needs, as Cloudflare Pages settings: PASS_TYPE_ID and APPLE_TEAM_ID (variables), PASS_CERT_PEM and PASS_KEY_PEM (secrets),
// optional PASS_KEY_PASSPHRASE (secret), and APPLE_WWDR_PEM (Apple's WWDR intermediate certificate, public). See tools/card/WALLET.md.
const pem = (s) => String(s || '').replace(/\\n/g, '\n').trim();
export function walletReady(env) {
  return !!(env.PASS_TYPE_ID && env.APPLE_TEAM_ID && env.PASS_CERT_PEM && env.PASS_KEY_PEM && env.APPLE_WWDR_PEM);
}
const PASS_IMAGES = ['icon.png', 'icon@2x.png', 'icon@3x.png', 'logo.png', 'logo@2x.png', 'logo@3x.png', 'thumbnail.png', 'thumbnail@2x.png', 'thumbnail@3x.png'];
export function passJson(c, slug, env) {
  const url = taggedUrl(slug, 'wallet');
  const back = [{ key: 'email', label: 'Email', value: c.email, attributedValue: `<a href="mailto:${c.email}">${c.email}</a>` }];
  if (c.tel) back.push({ key: 'tel', label: 'Phone', value: c.tel });
  if (c.linkedin) back.push({ key: 'linkedin', label: 'LinkedIn', value: c.linkedin, attributedValue: `<a href="${c.linkedin}">LinkedIn profile</a>` });
  if (c.booking) back.push({ key: 'booking', label: 'Book a meeting', value: c.booking, attributedValue: `<a href="${c.booking}">Choose a time</a>` });
  back.push({ key: 'card', label: 'Digital card', value: url, attributedValue: `<a href="${url}">Open the card</a>` });
  if (c.website) back.push({ key: 'web', label: 'Website', value: c.website });
  return {
    formatVersion: 1, passTypeIdentifier: env.PASS_TYPE_ID, teamIdentifier: env.APPLE_TEAM_ID, serialNumber: CARDS[slug].serial,
    organizationName: c.org || 'Capital Row', description: `${c.fn}, ${c.org || 'Capital Row'}`, logoText: c.org || 'Capital Row',
    backgroundColor: 'rgb(12, 50, 52)', foregroundColor: 'rgb(251, 249, 245)', labelColor: 'rgb(143, 212, 203)',
    generic: {
      primaryFields: [{ key: 'name', label: c.org || 'Capital Row', value: c.fn }],
      secondaryFields: [{ key: 'title', label: 'Title', value: c.title || '' }],
      auxiliaryFields: [{ key: 'email', label: 'Email', value: c.email }],
      backFields: back,
    },
    barcodes: [{ format: 'PKBarcodeFormatQR', message: url, messageEncoding: 'iso-8859-1', altText: 'Scan to open the card' }],
    barcode: { format: 'PKBarcodeFormatQR', message: url, messageEncoding: 'iso-8859-1', altText: 'Scan to open the card' },
  };
}
async function sha1hex(u8) { const h = await crypto.subtle.digest('SHA-1', u8); return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join(''); }
export function signManifest(manifest, env) {
  const cert = forge.pki.certificateFromPem(pem(env.PASS_CERT_PEM));
  const wwdr = forge.pki.certificateFromPem(pem(env.APPLE_WWDR_PEM));
  const keyPem = pem(env.PASS_KEY_PEM);
  const key = /ENCRYPTED/.test(keyPem) ? forge.pki.decryptRsaPrivateKey(keyPem, env.PASS_KEY_PASSPHRASE || '') : forge.pki.privateKeyFromPem(keyPem);
  if (!key) throw new Error('pass key could not be read (wrong passphrase?)');
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(manifest, 'raw');
  p7.addCertificate(cert); p7.addCertificate(wwdr);
  p7.addSigner({ key, certificate: cert, digestAlgorithm: forge.pki.oids.sha256, authenticatedAttributes: [
    { type: forge.pki.oids.contentType, value: forge.pki.oids.data }, { type: forge.pki.oids.messageDigest }, { type: forge.pki.oids.signingTime, value: new Date() }] });
  p7.sign({ detached: true });
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  const out = new Uint8Array(der.length); for (let i = 0; i < der.length; i++) out[i] = der.charCodeAt(i);
  return out;
}
export async function buildPass(env, request, slug) {
  if (!walletReady(env)) throw Object.assign(new Error('wallet not configured'), { code: 'not_configured' });
  const c = await readCard(env, request, slug);
  const files = { 'pass.json': strToU8(JSON.stringify(passJson(c, slug, env))) };
  for (const n of PASS_IMAGES) {
    const r = await fetchAsset(env, request, `/${slug}-card/pass/${n}`);
    if (!r.ok) { if (n.startsWith('icon')) throw new Error('pass image missing: ' + n); continue; }
    files[n] = new Uint8Array(await r.arrayBuffer());
  }
  const manifest = {}; for (const [n, u8] of Object.entries(files)) manifest[n] = await sha1hex(u8);
  const mBytes = strToU8(JSON.stringify(manifest));
  let raw = ''; for (const b of mBytes) raw += String.fromCharCode(b);
  files['manifest.json'] = mBytes;
  files['signature'] = signManifest(raw, env);
  return zipSync(files, { level: 6 });
}

// ---------------------------------------------------------------- the follow-up task in HubSpot (optional)
// Runs only when HS_PRIVATE_APP_TOKEN is set (a HubSpot private app with crm.objects.contacts.read and crm.objects.contacts.write).
// The task is created after HubSpot has accepted the card's form submission, against the contact that submission made or updated.
export function nextBusinessMorningUtc(from = new Date()) {
  const d = new Date(from.getTime() + 86400000);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(16, 0, 0, 0);   // 9:00 in California in summer, 8:00 in winter
  return d.toISOString();
}
export async function createFollowUpTask(env, p) {
  const base = env.HS_API_BASE || 'https://api.hubapi.com';
  const h = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.HS_PRIVATE_APP_TOKEN };
  const call = async (path, body) => {
    let r, t = ''; try { r = await fetch(base + path, { method: 'POST', headers: h, body: JSON.stringify(body) }); t = await r.text(); }
    catch (e) { return { ok: false, transient: true, error: 'network: ' + String(e && e.message || e).slice(0, 200) }; }
    let j = null; try { j = JSON.parse(t); } catch (e) {}
    if (r.ok) return { ok: true, json: j };
    return { ok: false, transient: r.status === 429 || r.status >= 500, error: `hubspot ${r.status}: ` + t.slice(0, 300) };
  };
  const s = await call('/crm/v3/objects/contacts/search', { filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: p.email }] }], properties: ['email'], limit: 1 });
  if (!s.ok) return s;
  const id = s.json && s.json.results && s.json.results[0] && s.json.results[0].id;
  if (!id) return { ok: false, transient: true, error: 'contact not in HubSpot yet' };
  const who = [p.name, p.company].filter(Boolean).join(', ');
  const t = await call('/crm/v3/objects/tasks', {
    properties: { hs_timestamp: nextBusinessMorningUtc(), hs_task_subject: `Follow up: card exchange with ${who || p.email}`.slice(0, 250),
      hs_task_body: p.body.slice(0, 60000), hs_task_status: 'NOT_STARTED', hs_task_priority: 'MEDIUM', hs_task_type: 'TODO',
      hubspot_owner_id: String(env.HS_TASK_OWNER || '98756507') },
    associations: [{ to: { id: String(id) }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 204 }] }] });
  return t.ok ? { ok: true, taskId: t.json && t.json.id } : t;
}

// ---------------------------------------------------------------- spam protection
export async function turnstileOk(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return true;
  if (!token || typeof token !== 'string') return false;
  try {
    const body = new FormData(); body.append('secret', env.TURNSTILE_SECRET); body.append('response', token); if (ip) body.append('remoteip', ip);
    const r = await fetch(env.TURNSTILE_VERIFY || 'https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
    const j = await r.json(); return !!(j && j.success);
  } catch (e) { return false; }
}
export async function ipHash(ip) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('cr-card|' + (ip || '')));
  return [...new Uint8Array(h)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}
