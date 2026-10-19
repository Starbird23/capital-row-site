# Capital Row website

The site is built from two things:

- **layouts/** — one HTML file per page with the code (styles, scripts, structure) and a `{{key}}` wherever a piece of text goes; the `.json` beside it says what each key is and which link addresses belong to it. Change these only when the design or the code changes.
- **Sanity** — every word on the site, edited at https://capital-row-site.sanity.studio/ (project `2a68e4yk`, dataset `site`). One document per page, plus "Every page" for the top bar, menu, footer and pop-ups.

`npm run build` reads the published text from Sanity and writes the finished pages to `dist/`, with `assets/` (photos, video, team pictures) copied beside them. Nothing is sent to Sanity by the build; the dataset is public and the build needs no token.

## Cloudflare Pages
- Build command: `npm run build`
- Build output directory: `dist`
- Environment variables: `SANITY_PROJECT=2a68e4yk`, `SANITY_DATASET=site`, `NODE_VERSION=20`
- A deploy hook on this project, pasted into a Sanity webhook (dataset `site`, on publish), rebuilds the site when text is published.

## Text rules inside a field
Plain text. Allowed inside: `<em>…</em>`, `<b>…</b>`, `<a>…</a>` for a link already on the page (its address stays in the layout), `<br>` for a line break, and `<a href="https://…">…</a>` for a new link. Anything else is shown as typed.

## Forms: choices, sectors and messages (Sanity document "forms")
Every form reads one config, carried in each page as `<script type="application/json" id="crforms">` and filled by the build from the Sanity document **Forms: choices, sectors and messages**:
- **Sectors, by industry**: the 10 industries and 63 sectors every sector picker shows. The name is editable; the stable id (sent to HubSpot as `cr_sector`, `cr_industry`, `cr_sector_firm`, `cr_sector_followed`) is not.
- **Dropdown and checkbox choices**: every list on every form, in order. Each choice has the text shown and a stable value sent to HubSpot. Change the text freely; leave the value once it is in use.
- **Labels, help text, confirmations and error messages**: the labels that change with the side of the table, the help text inside boxes, and every confirmation and error. `{email}`, `{sectors}` and `{n}` are filled in by the site.
The build stops (and the live site stays as it is) if a page asks for a list or a message the document no longer has. `content/forms.json` is the same config for `npm run build:local`. The build also writes `dist/forms-config.json`, which the form server uses to check choices.

## Form server (`functions/`, `server/core.js`)
Every form posts to `/api/submit` (a Cloudflare Pages Function, deployed with the site). The submission is checked, saved in D1 under a key the page sends (the same answers twice on the same day are one submission), and only then does the page show "received". Delivery to HubSpot follows, retried until HubSpot accepts it (1, 5, 15, 60 minutes, then 3, 6, 12 and 24 hours; nine attempts). A property HubSpot refuses (not on the form yet, or a value it does not have yet) is dropped and the rest delivered; the answers are also in the message. A value that does not check out against the forms config is dropped from that property, never the whole submission; only a missing or unusable email address is refused. If the page cannot reach `/api/submit` (or it does not answer "saved"), the page sends the standard fields and the message straight to HubSpot's main form, so a submission is never lost to the server. The HubSpot field list (names, records and values) is in `Capital-Row-HubSpot-field-list-Rev-13.7-2026-10-18`. After the last attempt, or on a refusal a retry cannot fix, an alert goes to team@thecapitalrow.com. Delivered answers are cleared from D1 after 30 days.
- `GET /api/health`: what is switched on. `POST /api/retry` and `GET /api/status` need the header `X-Retry-Key`.
- `.github/workflows/form-delivery.yml` calls `/api/retry` every ten minutes and fails (GitHub emails the account) when a submission is failed or stuck.
- Cloudflare Pages settings (Production): D1 binding `DB`; variables `RETRY_KEY` (secret), `RESEND_API_KEY` (secret) and `ALERT_FROM` for alert email, optional `ALERT_WEBHOOK`, optional `HS_FORM_BUYBOX`, `HS_FORM_ASSESS`, `HS_FORM_DEAL`, `HS_FORM_CC`, `HS_FORM_FOLLOW`, `HS_FORM_VALUATION` once those HubSpot forms exist (until then they use the main form, with `cr_form` naming the kind).
- Without the D1 binding the server sends straight to HubSpot and answers "saved" only when HubSpot accepted.
- Tests: `tools/server_test.py` runs the real pages and functions locally (`wrangler pages dev dist --d1 DB ...`) against `tools/mock_hubspot.py`.

## Digital cards (`/shawnee`)
A card is an ordinary page built "flat" (served at `/shawnee`, no trailing slash; `"flat": true` in its layout `.json`). Its words are in Sanity like every page; `functions/shawnee/vcard.js` and `functions/shawnee/wallet.js` read the published page (elements marked `data-card`) to build the .vcf and the Apple Wallet pass (`server/card.js`). The exchange form posts to `/api/submit` as kind `Contact exchange`, which goes only to its own HubSpot form (`HS_FORM_EXCHANGE`) and is held and retried until that exists. Setup, credentials, tagged links, NFC and tests: `tools/card/SETUP.md`.

## Tools
- `tools/extract.js <builtSite> <out>` — splits a built site into layouts and text (how this repository was made).
- `tools/build.js` — the build.
- `tools/import.js <content> <project> <dataset> [forms-doc.json]` — publishes the page text, Every page, and the forms document.
- `tools/verify.js <a> <b>` — compares two built sites as documents.
- `content/` — the text as imported on October 18, 2026 (Rev 13.7), with `content/forms.json`; `assets/404.html` is the not-found page Cloudflare Pages serves, copied as is; `npm run build:local` builds from it without Sanity.
