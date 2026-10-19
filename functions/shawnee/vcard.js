// GET /shawnee/vcard: Shawnee's contact card as a .vcf, built from the published /shawnee page (server/card.js).
import { buildVCard } from '../../server/card.js';
export async function onRequestGet({ request, env }) {
  try {
    const v = await buildVCard(env, request, 'shawnee');
    return new Response(v.text, { headers: { 'Content-Type': 'text/vcard; charset=utf-8', 'Content-Disposition': `attachment; filename="${v.name}"`, 'Cache-Control': 'public, max-age=300' } });
  } catch (e) {
    return new Response('The contact card could not be built. Please email smercier@thecapitalrow.com.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
}
