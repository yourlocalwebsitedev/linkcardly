# Architecture

Linkcardly is one Cloudflare Worker serving static files from `public/`. There is no frontend framework and no bundler. Marketing pages are plain HTML assembled at build time. The order and card app is a vendored copy of the NexBizRise app.

## Folders
```
linkcardly/
├── site/                  Marketing page SOURCES (edit here)
│   ├── site.config.js     Site URL, header nav, footer links
│   ├── layout.js          Shared shell: <head>, header, footer, sticky bar, scripts
│   ├── pages.js           Page registry: path, title, description, flags (also drives Worker routes and reserved handles)
│   ├── catalogue.js       Design-catalogue copy (categories, colourway names, sample people)
│   └── pages/*.html       Page bodies (inside <main>)
├── scripts/build.mjs      site/ → public/*.html, sitemap.xml, assets/js/{icons,rules,catalogue}.js, src/lib/qrcode.gen.js
├── src/                   Worker (server)
│   ├── index.js           Routing, security headers, request logging, error handling, rate limit
│   ├── config.js          Route tables, app paths, file extensions, timeouts, version
│   ├── http.js            json(), serveAsset(), notFound(), errorPage(), secure() + CSP
│   ├── routes/            proxy.js (to NexBizRise), og.js (share previews), api.js (native), cards.js (native), health.js
│   ├── views/card-page.js Server-rendered card (native)
│   └── lib/               Pure helpers: handles, icons, themes, vcard, sanitize, qr, supabase, turnstile
├── public/                Served as-is
│   ├── app/               Vendored NexBizRise order and card app (see app/README.md)
│   │   ├── estate-styles.js  Estate card styles shared by order.html and card.html (window.LC_ESTATE)
│   │   └── components/    Linkcardly UI components for the app (e.g. card-style-controls.js + .css)
│   ├── assets/css/        tokens.css (brand tokens, loaded first everywhere), site.css (marketing), card.css (native card)
│   ├── assets/js/         site.js (marketing behaviour), card.js (native card), config.js; generated: catalogue.js, icons.js, rules.js
│   ├── assets/img/brand/  favicon companions, OG image
│   ├── assets/img/samples/ sample portrait used by the app
│   └── favicon.svg, robots.txt
├── supabase/migrations/   Native schema (for MODE = "native"): 0001 init, 0002 hardening, 0003 retention schedule
├── test/                  node:test suites (+ e2e/smoke.mjs for a browser check)
├── .github/workflows/     ci.yml: audit, tests, dry-run; deploys main to staging; manual production deploy
└── docs/                  ARCHITECTURE.md, QA.md, SDLC_VALIDATION.md
```

## Modes
- **proxy** (current): only `/api/*` goes to the NexBizRise worker, without cookies or `Authorization`, and `Set-Cookie` is dropped on the way back. Other unknown paths (including `/admin`) are a local 404; the NexBizRise admin stays on its own host. Card pages (`/<slug>`, `/c/<id>`) and edit links (`/e/<token>`) are served from `public/app/` and fetch their data through `/api/*`. Link-preview bots get the card's name, role and photo in the meta tags (`routes/og.js`). The app loads React and Babel from `public/app/vendor/`, not unpkg.
- **native** (later): `routes/api.js` and `routes/cards.js` with the Supabase schema in `supabase/`. Not yet at parity: the vendored app also calls `/api/card`, `/api/hit`, `/api/upload`, `/api/edit` and `/api/pay/*`, and native has no `/e/<token>`, `/c/<id>`, admin, e-mails or payments. Keep proxy mode until those exist.

## Rules
- Single sources of truth (full table in `CLAUDE.md`): brand tokens `public/assets/css/tokens.css`; pages and their routes `site/pages.js` (`STATIC_PAGES` and reserved handles are derived from it); colourways `src/lib/themes.js` (the browser catalogue is generated with copy from `site/catalogue.js`); icons `src/lib/icons.js`; handle rules `src/lib/handles.js`; nav, footer and Turnstile key `site/site.config.js`; QR generator `public/app/qrcode.js`. Generated copies are git-ignored and rebuilt by every `npm test`, `wrangler dev` and `wrangler deploy`.
- Pages this repo renders get an enforced Content-Security-Policy (`src/http.js`). The vendored app gets a report-only one (`APP_CSP`), because it relies on inline scripts, in-browser Babel and payment SDKs.
- Every request and failure is logged as one JSON line. Never log edit tokens or personal data.
- Brand tokens live only in `assets/css/tokens.css` (`--lc-*` base colours, `--n`/`--a`/`--s` ramps, fonts, shadows). `site.css` maps them to its roles (`--bg`, `--accent`, …) and adds components and utilities (`.stack`, `.row`, `.grid` with `--g` and `--min`, `.page`/`.page-head` for text pages). `app/skin.css` maps the vendored app's own variables to the same tokens. Mobile first: base styles target 390 px, `min-width` queries widen.
- Don't refactor `public/app/`. It mirrors NexBizRise so updates can be copied over.
- New UI for the app goes in `public/app/components/<name>.js` (+ `.css`), not inline in `order.html` or `card.html`: a React component exposed on `window` (no hyphen in the name, plain `React.createElement`, no JSX) with a props-only API documented in the file header, styled with classes that use the brand tokens. The app renders it with `<x-import component-from-global-scope="Name" from="/app/components/<name>.js" prop-name="{{ path }}">`. Props are kebab-case attributes (the runtime turns `on-select` into `onSelect`); a whole `{{ path }}` passes the raw value, so arrays and callbacks work; avoid the names `position`, `left`, `right`, `top`, `bottom`, `inset`, `width`, `height`, `z-index`, `transform` and the `style-` prefix.
- New marketing page: add an entry to `site/pages.js` and a body in `site/pages/<name>.html`. The Worker route and the handle reservation follow from the registry.

## Known debt
- Button text on five estate styles outside Real Estate and Home Services is slightly under 4.5:1 (`hc-home-sky`, `bw-menu`, `bw-home`, `bw-home-blush`, `cc-list`, 4.2–4.49). The contrast test enforces 4.5:1 only for categories with colour families; fix these when those categories get families.
- `site/pages/home.html`, `designs.html` and `teams.html` still use one-off inline styles (layout tweaks such as `--g` gaps). Move a pattern into `site.css` when it repeats.
- The vendored app (`public/app/`) has its own markup and inline styles. `skin.css` aligns its colours and type with the tokens, but its components (buttons, inputs, cards) are not the `site.css` components. The real fix is native order, editor and card pages built on `site.css`, which is part of DEF-28 (native parity).
- `public/app/card.html` and `order.html` are 270 KB and 180 KB single files, and the app compiles JSX in the browser (Babel, 3 MB). Fine to keep while it's vendored; a native rebuild should precompile.
- The Motion Card plan preview on the Plan step points at `/portrait.gif`, which isn't in the repo (inherited from NexBizRise), so that preview is an empty tile. Needs a licensed moving-portrait sample in `public/assets/img/samples/`.
- Three Google Fonts requests (marketing layout, `skin.css` `@import`, the app's own link). Self-hosting the two brand fonts would remove a third-party dependency and the render-blocking `@import`.
