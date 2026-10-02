# Architecture

Linkcardly is one Cloudflare Worker serving static files from `public/`. There is no frontend framework and no bundler. Marketing pages are plain HTML assembled at build time. The order and card app is a vendored copy of the NexBizRise app.

## Folders
```
linkcardly/
├── site/                  Marketing page SOURCES (edit here)
│   ├── site.config.js     Site URL, header nav, footer links
│   ├── layout.js          Shared shell: <head>, header, footer, sticky bar, scripts
│   ├── pages.js           Page registry: path, title, description, flags
│   └── pages/*.html       Page bodies (inside <main>)
├── scripts/build.mjs      site/ → public/*.html, sitemap.xml, assets/js/icons.js, assets/js/rules.js, src/lib/qrcode.gen.js
├── src/                   Worker (server)
│   ├── index.js           Routing, security headers, request logging, error handling, rate limit
│   ├── config.js          Route tables, app paths, file extensions, timeouts, version
│   ├── http.js            json(), serveAsset(), notFound(), errorPage(), secure() + CSP
│   ├── routes/            proxy.js (to NexBizRise), api.js (native), cards.js (native), health.js
│   ├── views/card-page.js Server-rendered card (native)
│   └── lib/               Pure helpers: handles, icons, themes, vcard, sanitize, qr, supabase, turnstile
├── public/                Served as-is
│   ├── app/               Vendored NexBizRise order and card app (see app/README.md)
│   ├── assets/css/        site.css (marketing), card.css (native card)
│   ├── assets/js/         site.js (marketing behaviour), card.js (native card), catalogue.js (design data), icons.js (generated)
│   ├── assets/img/brand/  favicon companions, OG image
│   ├── assets/img/samples/ sample portrait used by the app
│   └── favicon.svg, robots.txt
├── supabase/migrations/   Native schema (for MODE = "native"): 0001 init, 0002 hardening
├── test/                  node:test suites (+ e2e/smoke.mjs for a browser check)
└── docs/                  ARCHITECTURE.md, QA.md, SDLC_VALIDATION.md
```

## Modes
- **proxy** (current): `/api/*` and unknown paths go to the NexBizRise worker. Card pages (`/<slug>`, `/c/<id>`) and edit links (`/e/<token>`) are served from `public/app/` and fetch their data through `/api/*`.
- **native** (later): `routes/api.js` and `routes/cards.js` with the Supabase schema in `supabase/`. Not yet at parity: the vendored app also calls `/api/card`, `/api/hit`, `/api/upload`, `/api/edit` and `/api/pay/*`, and native has no `/e/<token>`, `/c/<id>`, admin, e-mails or payments. Keep proxy mode until those exist.

## Rules
- Single sources of truth: the icon set is `src/lib/icons.js` and reserved handles are `src/lib/handles.js` (browser copies are generated); nav, footer links and the Turnstile site key are `site/site.config.js`; the QR generator is `public/app/qrcode.js` (the Worker copy is generated).
- Pages this repo renders get a Content-Security-Policy (`src/http.js`). The vendored app and proxied responses don't, because they rely on inline scripts and third-party SDKs.
- Every request and failure is logged as one JSON line. Never log edit tokens or personal data.
- Styling for marketing pages lives in `assets/css/site.css`, built from tokens (`--bg`, `--accent`, ramps) and small utilities (`.stack`, `.row`, `.grid` with `--g` and `--min`).
- Don't refactor `public/app/`. It mirrors NexBizRise so updates can be copied over.
- New marketing page: add an entry to `site/pages.js` and a body in `site/pages/`, add the path to `STATIC_PAGES` in `src/config.js`, and add the name to `RESERVED` in `src/lib/handles.js`.

## Known debt
- `assets/js/catalogue.js` duplicates colourway data from `src/lib/themes.js` (same keys and colours today, checked by a test). Generate one from the other when native mode ships.
- `site/pages/*.html` use inline styles in places. Move repeated patterns into `site.css` classes as pages grow.
