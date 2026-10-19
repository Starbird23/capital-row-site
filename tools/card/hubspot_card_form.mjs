// Creates (or updates, by name) the HubSpot form the card's exchange posts to, then prints its id for the Cloudflare variable
// HS_FORM_EXCHANGE. Needs a HubSpot private app token with the "forms" scope in HS_TOKEN. Run once:
//   HS_TOKEN=... node tools/card/hubspot_card_form.mjs            (add --dry to print the form definition without sending it)
// After it runs, one setting the API does not expose must be switched off by hand: Marketing, Forms, "Capital Row card
// exchange", Settings, "Set new contacts as marketing contacts". See tools/card/SETUP.md.
const NAME = 'Capital Row card exchange';
const NOTIFY = (process.env.HS_NOTIFY_USER_IDS || '98756507').split(',').map((s) => s.trim()).filter(Boolean);   // Shawnee's HubSpot user id
const BASE = process.env.HS_API_BASE || 'https://api.hubapi.com';
const opt = (pairs) => pairs.map(([value, label], i) => ({ value, label, displayOrder: i }));
const f = (o) => Object.assign({ objectTypeId: '0-1', required: false, hidden: false, dependentFields: [] }, o);
const definition = {
  formType: 'hubspot', name: NAME, archived: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  fieldGroups: [
    { groupType: 'default_group', richTextType: 'text', fields: [f({ name: 'firstname', label: 'First name', fieldType: 'single_line_text', required: true }), f({ name: 'lastname', label: 'Last name', fieldType: 'single_line_text' })] },
    { groupType: 'default_group', richTextType: 'text', fields: [f({ name: 'email', label: 'Work email', fieldType: 'email', required: true, validation: { blockedEmailDomains: [], useDefaultBlockList: false } })] },
    { groupType: 'default_group', richTextType: 'text', fields: [f({ name: 'company', label: 'Company', fieldType: 'single_line_text', required: true })] },
    { groupType: 'default_group', richTextType: 'text', fields: [f({ name: 'cr_contact_type', label: 'Relationship', fieldType: 'dropdown', defaultValues: [],
      // the existing Contact type property; add ['intermediary', 'Intermediary'] here once that option exists in HubSpot
      options: opt([['buyer', 'Buyer'], ['seller', 'Seller'], ['lender', 'Lender'], ['referral_partner', 'Referral partner']]) })] },
    { groupType: 'default_group', richTextType: 'text', fields: [f({ name: 'message', label: 'Message', fieldType: 'multi_line_text' })] },
    { groupType: 'default_group', richTextType: 'text', fields: [f({ name: 'cr_marketing_consent', label: 'Send me Capital Row updates by email.', fieldType: 'single_checkbox' })] },
    { groupType: 'default_group', richTextType: 'text', fields: [
      f({ name: 'cr_card_owner', label: 'Card owner', fieldType: 'single_line_text', hidden: true }),
      f({ name: 'cr_card_channel', label: 'Card channel', fieldType: 'dropdown', hidden: true, defaultValues: [],
        options: opt([['wallet', 'Apple Wallet'], ['nfc', 'NFC card'], ['qr-print', 'Printed QR'], ['qr-screen', 'On-screen QR'], ['share', 'Shared link'], ['vcard', 'Saved contact'], ['direct', 'Direct'], ['other', 'Other']]) }),
      f({ name: 'cr_card_event', label: 'Card event', fieldType: 'single_line_text', hidden: true })] },
  ],
  configuration: { language: 'en', createNewContactForNewEmail: true, editable: true, allowLinkToResetKnownValues: false, lifecycleStages: [], postSubmitAction: { type: 'thank_you', value: 'Thank you.' },
    prePopulateKnownValues: false, cloneable: true, notifyContactOwner: false, recaptchaEnabled: false, archivable: true, notifyRecipients: NOTIFY },
  displayOptions: { renderRawHtml: false, theme: 'default_style', submitButtonText: 'Send my details', style: { fontFamily: 'arial, helvetica, sans-serif', backgroundWidth: '100%',
    labelTextColor: '#141E1F', labelTextSize: '14px', helpTextColor: '#5C6B6B', helpTextSize: '12px', legalConsentTextColor: '#5C6B6B', legalConsentTextSize: '12px',
    submitColor: '#14706E', submitAlignment: 'left', submitFontColor: '#ffffff', submitSize: '14px' } },
  legalConsentOptions: { type: 'none' },
};
if (process.argv.includes('--dry')) { console.log(JSON.stringify(definition, null, 1)); process.exit(0); }
const TOKEN = process.env.HS_TOKEN; if (!TOKEN) { console.error('Set HS_TOKEN to a HubSpot private app token with the "forms" scope.'); process.exit(1); }
const h = { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' };
async function call(method, path, body) {
  const r = await fetch(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined }); const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${t.slice(0, 800)}`); return t ? JSON.parse(t) : {};
}
let existing = null, after;
do { const page = await call('GET', '/marketing/v3/forms?limit=100' + (after ? '&after=' + after : '')); existing = (page.results || []).find((x) => x.name === NAME) || existing; after = page.paging && page.paging.next && page.paging.next.after; } while (!existing && after);
const out = existing ? await call('PATCH', '/marketing/v3/forms/' + existing.id, { fieldGroups: definition.fieldGroups, configuration: definition.configuration, displayOptions: definition.displayOptions, legalConsentOptions: definition.legalConsentOptions })
  : await call('POST', '/marketing/v3/forms', definition);
console.log((existing ? 'Updated' : 'Created') + ' form "' + NAME + '"');
console.log('HS_FORM_EXCHANGE=' + out.id);
console.log('Next: switch off "Set new contacts as marketing contacts" on this form in HubSpot (the API cannot set it).');
