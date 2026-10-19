// GET /api/card/config?card=<slug>: what a card page may offer, without secrets. The Wallet button is shown only when a signed
// pass can actually be built (all Apple settings present); the spam challenge only when its keys are set.
import { CARDS, walletReady } from '../../../server/card.js';
import { formFor, json } from '../../../server/core.js';
export async function onRequestGet({ request, env }) {
  const slug = new URL(request.url).searchParams.get('card') || '';
  if (!CARDS[slug]) return json({ error: 'card' }, 404);
  const form = formFor('Contact exchange', env);
  return json({ card: slug, wallet: walletReady(env), turnstile: env.TURNSTILE_SITE_KEY || null, form: form === 'unset' ? null : form, portal: env.HS_PORTAL || '247329185' });
}
export function onRequest() { return json({ error: 'method' }, 405); }
