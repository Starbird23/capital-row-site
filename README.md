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

## Tools
- `tools/extract.js <builtSite> <out>` — splits a built site into layouts and text (how this repository was made).
- `tools/build.js` — the build.
- `tools/verify.js <a> <b>` — compares two built sites as documents.
- `content/` — the text as it was imported on October 16, 2026 (Rev 12.7); `npm run build:local` builds from it without Sanity.
