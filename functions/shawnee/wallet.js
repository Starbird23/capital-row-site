// GET /shawnee/wallet: Shawnee's Apple Wallet pass (.pkpass), signed on the server with the Pass Type ID certificate held in
// Cloudflare secrets. Without those settings it answers 503; the card page hides the button in that case (/api/card/config).
import { buildPass } from '../../server/card.js';
export async function onRequestGet({ request, env }) {
  try {
    const zip = await buildPass(env, request, 'shawnee');
    return new Response(zip, { headers: { 'Content-Type': 'application/vnd.apple.pkpass', 'Content-Disposition': 'attachment; filename="Shawnee-Mercier.pkpass"', 'Cache-Control': 'no-store' } });
  } catch (e) {
    const code = e && e.code === 'not_configured' ? 'not_configured' : 'signing_failed';
    return new Response(JSON.stringify({ error: code }), { status: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }
}
