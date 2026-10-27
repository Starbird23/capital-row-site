// Contract test: every website form, run through the page's own field code (hsFields) and then the server's check, must send
// only HubSpot's own field names, on the right record, with values HubSpot lists (server/hubspot-schema.js). Any answer HubSpot
// would silently discard fails the test. Run: node tools/hubspot_contract.mjs [built page, default layouts/home.html]
import fs from 'node:fs';
import vm from 'node:vm';
import { cleanFields, propOf } from '../server/core.js';
import { SECTOR_MAP } from '../server/sector-map.js';

const page = fs.readFileSync(process.argv[2] || new URL('../layouts/home.html', import.meta.url), 'utf8');
const a = page.indexOf('function hsFields(kind, d) {'), b = page.indexOf('function hsBody(', a);
const ctx = { CRM: () => '', crSecIds: () => 'hc_dental_practice_software;built_roofing_and_restoration_software;other', console };   // the follow picker offers Other
vm.createContext(ctx); vm.runInContext(page.slice(a, b), ctx);
const card = fs.readFileSync(new URL('../assets/shawnee/card.js', import.meta.url), 'utf8');

const person = { name: 'Test Person', email: 'test@example.com', company: 'Example Co', phone: '+19495550100', message: 'Test', sms_consent: 'yes', sms_consent_time: '2026-10-27T22:00:00Z', sms_consent_wording: 'Text me' };
const secs = { sector_ids: 'hc_dental_practice_software;hc_billing_coding_and_claims', industry_ids: 'hc', sector: 'Dental; Billing', industry: 'Healthcare' };
const C = [
  ['Conversation', 'seller', { ...person, ...secs, side: 'Seller', kind: 'Vertical software, SaaS', lead: 'Software', revenue_band: '$5M-$10M', recurring_revenue: '$3M–$5M', website: 'https://www.example.com/x', heard_via: 'A referral', heard_via_detail: 'Jane Doe', updates: 'yes', sl_reason: 'Weighing an offer or an approach', owner_session: 'yes' }],
  ['Conversation', 'seller, prefer not to say', { ...person, ...secs, side: 'Seller', kind: 'Hybrid models', lead: 'Services', revenue_band: 'Prefer not to say', recurring_revenue: 'Not applicable', updates: 'no', sl_reason: 'Something else', owner_session: 'no' }],
  ['Conversation', 'buyer', { ...person, side: 'Buyer', kind: 'PE platform', website: 'acmecapital.com', bq_context: 'Both', bq_rev: '5000000-10000000', bq_ev: '250000000-', bq_geo: 'National, all 50 states;Canada', bq_recur: 'Some recurring', bq_timing: 'Within 6 months', sector_ids: 'hc_dental_practice_software;fleet_dispatch_tms_and_freight_audit;other', industry_ids: 'hc;fleet', criteria_on_file: 'yes', updates: 'yes', heard_via: 'LinkedIn' }],
  ['Conversation', 'advisor', { ...person, ...secs, side: 'Advisor', kind: 'CPA or accountant', ad_purpose: 'Refer a client', ad_client: 'Buyer', owner_session: 'yes', heard_via: 'A conference or event', heard_via_detail: 'ACG' }],
  ['Conversation', 'lender', { ...person, ...secs, side: 'Lender', kind: 'SBA 7(a) lender', ln_purpose: 'Refer a borrower', ln_geo: 'United States', ln_min: '1000000', ln_max: 'No maximum', ln_cash: 'Break-even acceptable' }],
  ['Buy box', 'buyer', { ...person, kind: 'Strategic', title: 'Vice President', website: 'https://acme.com', acquisition_context: 'A new platform; An add-on to an existing platform', platform_name: 'Acme Health', ownership: 'Majority', firm_sector_ids: 'hc_dental_practice_software', sector_ids: 'built_field_service_management_software', firm_industry_ids: 'hc', industry_ids: 'built', business_model: 'Vertical software; Software + services', geography: 'Southeast;Midwest', avoid_geography: 'Europe', geography_detail: 'Florida', customer_markets: 'United States;Canada', profitability: 'Profitable required', revenue_model: 'Subscription;Mixed', recurring_pref: 'Mostly recurring required', growth: '10_plus', capital: 'under_5m', role: 'lead_only', regulated: 'Case by case', owner_after_close: 'Either', timing: 'Acquiring now', funding: 'Committed capital', exclusions: 'No staffing', rev_min: '5000000', rev_max: 'No maximum', arr_min: '2000000', arr_max: '20000000', ebitda_min: '1000000', ebitda_max: '8000000', ev_min: '10000000', ev_max: '100000000', eq_min: '5000000', eq_max: '40000000', updates: 'yes' }],
  ['Follow a sector', '', { ...person, sector: 'Dental' }],
  ['Pre-Market Assessment request', '', { ...person, sector_ids: 'hc_dental_practice_software', industry_ids: 'hc', about: 'Sell-Side QoE', kind: 'Hybrid models', lead: 'Software', revenue_band: 'Under $1M', arr_band: 'Not applicable', timing: 'Within 6 months', owner_session: 'no' }],
  ['Owner session seat', '', { ...person, ...secs, role: 'CPA or accountant' }],
  ['Bad or broken deal report', '', { ...person, ...secs, main_reason: 'Financing', contact_ok: 'yes', anonymous_use_ok: 'no' }],
  ['Valuation calculator', 'owner', { ...person, ...secs, role: 'Owner or founder', kind: 'Services', revenue_raw: 7500000, earnings_raw: 1200000, heard_via: 'LinkedIn' }],
  ['Valuation calculator', 'owner, blank earnings', { ...person, ...secs, role: 'Owner or founder', kind: 'Vertical software, SaaS', revenue_raw: 950000, earnings_raw: NaN }],
  ['Valuation calculator', 'advisor', { ...person, ...secs, role: 'Advisor to the owner', kind: 'Services', revenue_raw: 7500000, earnings_raw: -20000 }],
  ['Capital Connections', '', { ...person, ...secs, business_type: 'Another company type', revenue_band: '$20M-$50M', arr_band: 'Over $20M', headquarters: 'United States', stage: 'Refinancing' }],
];
let fails = 0; const seen = new Set();
const bad = (m) => { fails++; console.log('  FAIL ' + m); };
for (const [kind, label, d] of C) {
  const fields = JSON.parse(JSON.stringify(ctx.hsFields(kind, d)));
  const r = cleanFields(kind, fields, null);
  console.log(`${kind}${label ? ' (' + label + ')' : ''}: ${r.fields.length} fields to HubSpot`);
  for (const f of fields) if (!propOf(f.objectTypeId || '0-1', f.name)) bad(`page sends ${f.name} (${f.objectTypeId}), not a HubSpot property on that record`);
  if (r.fatal.length) bad('refused: ' + r.fatal.join(', '));
  if (r.dropped.length) bad('HubSpot would discard: ' + r.dropped.join(', '));
  for (const f of r.fields) seen.add((f.objectTypeId === '0-2' ? 'company ' : 'contact ') + f.name);
  const v = (n, o = '0-1') => (r.fields.find((f) => f.name === n && f.objectTypeId === o) || {}).value;
  if (v('brand') !== 'Capital Row') bad('brand missing');
  if (kind === 'Conversation' && label === 'seller') {
    if (v('offering_type', '0-2') !== 'Software') bad('offering_type ' + v('offering_type', '0-2'));
    if (v('revenue_band', '0-2') !== '$5M-$10M' || v('arr_band', '0-2') !== '$3M–$5M') bad('bands');
    if (v('company_type', '0-2') !== 'Seller or target' || v('custom_industry', '0-2') !== 'Healthcare' || v('industry_segment', '0-2') !== 'Healthcare IT (HCIT)') bad('seller classification');
    if (v('industry__subsector', '0-2')) bad('subsector set although the two sectors disagree');
    if (v('website_industries') !== 'Healthcare' || v('reason_for_contact') !== 'Weighing an offer or an approach' || v('heard_via') !== 'A referral') bad('contact answers');
  }
  if (kind === 'Conversation' && label === 'buyer') {
    if (v('company_type', '0-2') !== 'Buyer' || v('target_sectors', '0-2') !== 'hc_dental_practice_software;fleet_dispatch_tms_and_freight_audit') bad('buyer sectors');
    if (v('target_verticals', '0-2') !== 'Healthcare IT (HCIT);Logistics & transportation technology' || v('target_industries', '0-2') !== 'Healthcare;Transportation & Logistics') bad('buyer taxonomy');
    if (v('min_target_ev', '0-2') !== '250000000' || v('max_target_ev', '0-2')) bad('open-ended range');
  }
  if (label === 'advisor' && v('cr_contact_type') !== 'intermediary') bad('advisor contact type ' + v('cr_contact_type'));
  if (kind === 'Valuation calculator' && label === 'owner' && (v('revenue_band', '0-2') !== '$5M-$10M' || v('adjusted_earnings_band', '0-2') !== '$1M–$3M')) bad('calculator bands');
  if (kind === 'Valuation calculator' && label === 'owner, blank earnings' && (v('revenue_band', '0-2') !== 'Under $1M' || v('adjusted_earnings_band', '0-2'))) bad('blank earnings');
  if (kind === 'Valuation calculator' && label === 'advisor' && (v('revenue_band', '0-2') || v('company_type', '0-2'))) bad('advisor set company facts');
  if (kind === 'Buy box' && (v('target_verticals', '0-2') !== 'Healthcare IT (HCIT);Construction technology' || v('acquisition_strategy', '0-2') !== 'Both' || v('buyer_ownership_appetite', '0-2') !== 'Majority')) bad('buy box values');
  if (kind === 'Pre-Market Assessment request' && (v('industry__subsector', '0-2') !== 'Dental practice software' || v('revenue_band', '0-2') !== 'Under $1M' || v('arr_band', '0-2'))) bad('assessment values');
  if (kind === 'Follow a sector' && v('sectors_followed') !== 'hc_dental_practice_software;built_roofing_and_restoration_software') bad('followed');
  if (kind === 'Owner session seat' && v('cr_contact_type') !== 'intermediary') bad('seat contact type');
}
// the card page and the Buyer Map research step send fixed names; each must be a HubSpot property
for (const n of ['firstname', 'lastname', 'email', 'company', 'cr_contact_type', 'cr_card_owner', 'cr_card_channel', 'cr_card_event', 'cr_marketing_consent', 'brand', 'message'])
  if (!card.includes(`'${n}'`) || !propOf('0-1', n)) bad('card field ' + n);
for (const v of card.match(/<option value="([a-z]+)">/g) || []) if (!propOf('0-1', 'cr_contact_type').o.includes(v)) bad('card choice ' + v);
for (const n of ['cr_buyer_map_research', 'cr_buyer_map_ready', 'cr_criteria_url', 'cr_criteria_confirm_url', 'cr_form']) if (!propOf('0-1', n)) bad('server field ' + n);
for (const s of Object.values(SECTOR_MAP)) for (const [k, p] of [['sub', 'industry__subsector'], ['seg', 'industry_segment'], ['ind', 'custom_industry'], ['seg', 'target_verticals'], ['ind', 'target_industries']])
  if (!propOf('0-2', p).o.includes(s[k])) bad(`sector map value "${s[k]}" is not a ${p} option`);
fs.writeFileSync(new URL('../server/hubspot-fields-sent.txt', import.meta.url), [...seen].sort().join('\n') + '\n');
console.log(fails ? `${fails} failure(s)` : 'All forms send only HubSpot names and values.');
process.exit(fails ? 1 : 0);
