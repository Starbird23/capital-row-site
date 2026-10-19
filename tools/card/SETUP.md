# Shawnee's digital card: setup and operations

The card lives at **https://thecapitalrow.com/shawnee**. It is a normal page of this site: the layout is `layouts/shawnee.html`, every word is in the Sanity document "Shawnee Mercier, Capital Row (/shawnee)", and the address, email, LinkedIn and booking links are in the layout.

| Piece | Where | Works without new credentials? |
|---|---|---|
| Card page, photo, contact links, share, on-screen QR | `layouts/shawnee.html`, `assets/shawnee-card/` | Yes |
| Save contact (.vcf) | `functions/shawnee/vcard.js`, built from the published page | Yes |
| Booking | Calendly link in the layout, tagged with the channel | Yes |
| Exchange form | posts to `/api/submit` (kind "Contact exchange"), stored in D1, delivered to HubSpot | Needs `HS_FORM_EXCHANGE` (step 2). Until then submissions are stored and retried, never sent to the main form |
| Internal notification | HubSpot form notification to Shawnee | Set by the form script (step 2) |
| Follow-up task | created by the server after HubSpot accepts the submission | Needs `HS_PRIVATE_APP_TOKEN` (step 3) |
| Apple Wallet pass | `functions/shawnee/wallet.js`, signed on the server | Needs the Apple certificate (step 5). The button stays hidden until then |
| Spam protection | hidden field, time check, 30 per hour per connection | Yes. Cloudflare Turnstile is optional (step 6) |

## 0. What replaced the first version

The first version (commit d10d032) served `/shawnee/`, sent its exchange as "Contact exchange" with a fall-back to the main website form (which creates marketing contacts), and expected a pre-signed `.pkpass` file. This version keeps the kind name "Contact exchange" but sends it only to its own form, serves `/shawnee` without the slash, and signs the pass on the server. Old addresses keep working: `/shawnee/` and `/Shawnee` redirect with their query string, `?src=` / `?at=` tags map to the new channels (qr to qr-print, screen to qr-screen, link to share, email to other) and events, and `/shawnee/shawnee-mercier.vcf` / `.pkpass` redirect to `/shawnee/vcard` / `/shawnee/wallet`.

Open: the first version showed a phone number, +1 949-682-1223, and its title was "Founder & Principal". This version shows no phone and the title "Founder & Managing Director"; the About page says "CEO and Principal". To add a phone, put `<a href="tel:+1..." data-card="tel" data-card-href>` in the links list of `layouts/shawnee.html`; the vCard and pass pick it up.

## 1. Tagged links

Each way in has its own link, so HubSpot records where an exchange came from (`cr_card_channel`). Add `&utm_content=<event-name>` to any of them for an event run (for example `&utm_content=vss-miami-2026`); it lands in `cr_card_event`.

| Channel | Link |
|---|---|
| Apple Wallet pass (inside the pass QR and its back) | https://thecapitalrow.com/shawnee?utm_source=wallet&utm_medium=business-card&utm_campaign=shawnee-card |
| Physical NFC card | https://thecapitalrow.com/shawnee?utm_source=nfc&utm_medium=business-card&utm_campaign=shawnee-card |
| Printed QR | https://thecapitalrow.com/shawnee?utm_source=qr-print&utm_medium=business-card&utm_campaign=shawnee-card |
| On-screen QR (the card's own "Show QR") | https://thecapitalrow.com/shawnee?utm_source=qr-screen&utm_medium=business-card&utm_campaign=shawnee-card |
| Share button | https://thecapitalrow.com/shawnee?utm_source=share&utm_medium=business-card&utm_campaign=shawnee-card |
| Inside the saved contact | https://thecapitalrow.com/shawnee?utm_source=vcard&utm_medium=business-card&utm_campaign=shawnee-card |

A visit with no tag is recorded as `direct`. `python3 tools/card/make_assets.py shawnee shawnee-mercier` rebuilds the QR files and pass images.

## 2. HubSpot form (one time, about ten minutes)

1. The contact properties exist (created October 18, 2026): `cr_card_owner`, `cr_card_channel`, `cr_card_event`, `cr_marketing_consent`. Relationship uses the existing **Contact type** (`cr_contact_type`). Add an **Intermediary** option (value `intermediary`) to Contact type so "Advisor or intermediary" lands; until then HubSpot refuses that one value, the server drops it and delivers the rest, and the answer stays in the message.
2. In HubSpot, Settings, Integrations, Private Apps, create an app with the scopes **forms**, **crm.objects.contacts.read** and **crm.objects.contacts.write**. Copy its token.
3. On your own computer, in this repository: `HS_TOKEN=<token> node tools/card/hubspot_card_form.mjs`. It creates the form "Capital Row card exchange" (or updates it if it exists), sets the submission notification to Shawnee, and prints `HS_FORM_EXCHANGE=<id>`.
4. In HubSpot, Marketing, Forms, open "Capital Row card exchange", Settings, and switch off **Set new contacts as marketing contacts**. The API cannot set this; it is what keeps card contacts non-marketing.
5. In Cloudflare Pages, capital-row, Settings, Variables and secrets (Production), add `HS_FORM_EXCHANGE` with the printed id. Redeploy.

Opting in to updates: the checkbox records `cr_marketing_consent = true` and nothing else. To make those contacts marketing contacts, add a contact workflow: enrolled when the form "Capital Row card exchange" is submitted **and** `cr_marketing_consent` is true; action **Set marketing contact status: marketing**. Each marketing contact counts toward the HubSpot marketing contact tier.

## 3. Follow-up task

Add the same private app token in Cloudflare as an **encrypted secret** named `HS_PRIVATE_APP_TOKEN`. After HubSpot accepts a card submission, the server finds the contact by email and creates a task "Follow up: card exchange with <name>, <company>", due the next business morning, owned by HubSpot owner `98756507` (Shawnee; change with the variable `HS_TASK_OWNER`), associated with the contact. If HubSpot has not created the contact yet, it retries with the same schedule as the form deliveries. Without the token no task rows are created and the form notification is the only alert.

Do not also build a HubSpot workflow that creates a task for the same form, or every exchange gets two tasks.

## 4. Physical NFC card

Write **one NDEF URI record** with the NFC link above, then lock the tag. Any NFC writer works (the NFC Tools app: Write, Add a record, URL/URI, paste the link, Write, then Other, Lock tag). The record is 96 bytes (99 with its TLV), so an NTAG213 (144 bytes) or larger is enough. `tools/card/out/shawnee-nfc.ndef` is the exact record for a card vendor who asks for a file.

A tap opens the card page in the phone's browser; the person then taps Save contact. An Apple Wallet pass does not do phone-to-phone NFC sharing: a standard Wallet pass shows a QR code, and NFC passes are a separate Apple program for payment and access terminals. Phone-to-phone sharing on iPhone is NameDrop, which shares the Contacts card, not a pass.

## 5. Apple Wallet pass

What Apple requires, in order:

1. **Apple Developer Program membership.** Enrol as an organization (Capital Row LLC) so the pass shows the company; organization enrolment needs a D-U-N-S number and a legal-entity check. There is an annual fee; see developer.apple.com/programs.
2. **Team ID.** developer.apple.com, Account, Membership details. Goes in `APPLE_TEAM_ID`.
3. **Pass Type ID.** Certificates, Identifiers and Profiles, Identifiers, +, Pass Type IDs, for example `pass.com.thecapitalrow.card`. Goes in `PASS_TYPE_ID`.
4. **Pass Type ID certificate.** Make a key and request on a trusted computer (never in the repository):
   `openssl req -new -newkey rsa:2048 -nodes -keyout pass.key -out pass.csr -subj "/CN=Capital Row Pass/O=Capital Row LLC/C=US"`
   Upload `pass.csr` on the Pass Type ID's page (Create Certificate), download `pass.cer`, then
   `openssl x509 -inform DER -in pass.cer -out pass.pem`.
   If you used Keychain instead and have a `.p12`: `openssl pkcs12 -in pass.p12 -clcerts -nokeys -out pass.pem` and `openssl pkcs12 -in pass.p12 -nocerts -nodes -out pass.key`.
5. **Apple WWDR intermediate certificate (G4)** from apple.com/certificateauthority: `openssl x509 -inform DER -in AppleWWDRCAG4.cer -out wwdr.pem`.
6. **Cloudflare Pages, capital-row, Settings, Variables and secrets (Production):**
   - `PASS_TYPE_ID`, `APPLE_TEAM_ID`, `APPLE_WWDR_PEM` (text, the whole wwdr.pem)
   - `PASS_CERT_PEM` and `PASS_KEY_PEM` as **encrypted secrets** (the whole pass.pem and pass.key); `PASS_KEY_PASSPHRASE` too if the key has one.
   Then delete the key file from the computer or keep it only in a password manager. The key never goes into GitHub, Sanity or the page.
7. **The badge.** Apple asks that the button use its own "Add to Apple Wallet" badge artwork. Download it from Apple's Wallet marketing resources and replace the text button `#wallet` in `layouts/shawnee.html` with the badge image (same link, `/shawnee/wallet`).
8. **Test on a real iPhone:** open the card in Safari, tap Add to Apple Wallet, check the preview, tap Add. Then scan the pass QR with another phone: it should open the Wallet link above.

How it works: `/api/card/config` reports `wallet: true` only when all five settings are present; the page shows the button only then, and only on Apple devices. `/shawnee/wallet` reads the published card page, builds `pass.json` with the images in `assets/shawnee-card/pass/`, hashes them into `manifest.json`, signs the manifest (PKCS #7, detached, SHA-256, with the WWDR certificate included) and returns the `.pkpass`. If signing fails it answers 503 and no file. The pass is static: when the card changes, people re-add it. The certificate has an expiry date shown on its page in the developer account; renew before it and replace the two secrets.

## 6. Optional: Cloudflare Turnstile

Cloudflare dashboard, Turnstile, Add widget for thecapitalrow.com (Managed). Add `TURNSTILE_SITE_KEY` (text) and `TURNSTILE_SECRET` (encrypted). The card then shows the check above Send and the server refuses a submission without a valid token. The hidden field, the three-second check and the hourly limit (`CARD_HOURLY_LIMIT`, default 30 per connection; conference Wi-Fi puts a whole room behind one address, so keep it generous) are always on; the limit needs the D1 binding, which Production has.

## Settings, all in one place (Cloudflare Pages, Production)

| Name | Kind | Needed for |
|---|---|---|
| `HS_FORM_EXCHANGE` | text | exchange delivery |
| `HS_PRIVATE_APP_TOKEN` | encrypted | follow-up task |
| `HS_TASK_OWNER` | text, optional | task owner (default 98756507) |
| `PASS_TYPE_ID`, `APPLE_TEAM_ID`, `APPLE_WWDR_PEM` | text | Wallet |
| `PASS_CERT_PEM`, `PASS_KEY_PEM`, `PASS_KEY_PASSPHRASE` | encrypted | Wallet |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET` | text / encrypted | optional challenge |
| `CARD_HOURLY_LIMIT` | text, optional | rate limit |

## HubSpot contact properties

| Property | Type | Values |
|---|---|---|
| `cr_contact_type` (existing Contact type) | dropdown | the card sends buyer, seller (Business owner), intermediary (Advisor or intermediary; option still to add), lender, referral_partner; Other sends nothing |
| `cr_card_owner` | single-line text | the card's owner, e.g. shawnee-mercier |
| `cr_card_channel` | dropdown | wallet, nfc, qr-print, qr-screen, share, vcard, direct, other |
| `cr_card_event` | single-line text | the event tag from utm_content |
| `cr_marketing_consent` | single checkbox | true when the person ticked updates (the site's other forms send it too) |

Card owner, channel and event record the latest exchange. Contact type is one choice per contact, so a card exchange overwrites whatever it held before; every submission is also kept on the contact's form-submission history.

## Tests

`tools/card/card_test.py` runs the real page and Functions under `wrangler pages dev dist --d1 DB` against `tools/mock_hubspot.py`, with local-only settings in `.dev.vars` (not committed; the test sets `CARD_HOURLY_LIMIT=8`) and throwaway test certificates. It covers rendering at phone width, accessibility (axe), validation, delivery, attribution, opt-in, the follow-up task, spam screens, the rate limit, a HubSpot outage and retry, the direct fallback, the error message, and the Wallet button rule.
