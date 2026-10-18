// GET /api/health: what is switched on, without secrets or personal data.
import { HS_PORTAL, KINDS, formFor, json } from '../../server/core.js';
export async function onRequestGet({ env }) {
  return json({ ok: true, store: !!env.DB, retry_key: !!env.RETRY_KEY, alerts: { email: !!env.RESEND_API_KEY, webhook: !!env.ALERT_WEBHOOK, to: env.ALERT_TO || 'team@thecapitalrow.com' },
    hubspot: { portal: env.HS_PORTAL || HS_PORTAL, forms: Object.fromEntries(KINDS.map((k) => [k, formFor(k, env)])) } });
}
