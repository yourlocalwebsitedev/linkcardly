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
├── scripts/build.mjs      site/ → public/*.html, sitemap.xml, assets/js/{icons,rules,catalogue}.js
├── src/                   Worker (server)
│   ├── index.js           Routing, security headers, request logging, error handling, rate limit
│   ├── config.js          Route tables, app paths, file extensions, timeouts, version
│   ├── http.js            json(), serveAsset(), notFound(), errorPage(), secure() + CSP (scoped to this environment's database)
│   ├── routes/            native.js (the API in native mode + daily job), proxy.js (to NexBizRise), app-config.js (/app/config.js),
│   │                      og.js (share previews), health.js
│   └── lib/               live.js (database calls), mail.js (Resend), payments.js (Razorpay, Stripe), turnstile, handles, icons, themes
├── public/                Served as-is
│   ├── app/               Vendored NexBizRise order and card app (see app/README.md)
│   │   ├── estate-styles.js  Estate card styles shared by order.html and card.html (window.LC_ESTATE)
│   │   ├── scene-styles.js   Personal scene styles (Summit, Tide) and their art, shared the same way (window.LC_SCENES)
│   │   └── components/    Linkcardly UI components for the app: card-style-controls, link-claim ("Your link"), order-done (done screen)
│   ├── assets/css/        tokens.css (brand tokens, loaded first everywhere), site.css (marketing)
│   ├── assets/js/         site.js (marketing behaviour); generated: catalogue.js, icons.js, rules.js
│   ├── assets/img/brand/  favicon companions, OG image
│   ├── assets/img/samples/ sample portrait used by the app
│   └── favicon.svg, robots.txt
├── supabase/live/         The database: 0-base.sql + ALL-IN-ONE.sql (from NexBizRise) + linkcardly.sql (Linkcardly changes); see its README
├── test/                  node:test suites (native.test.js: the native API); e2e/ (smoke, order-flow, production suite);
│                          support/ (live database in PGlite + PostgREST stand-in)
├── .github/workflows/     ci.yml: audit, tests, dry-run; deploys main to staging; manual production deploy.
│                          backup.yml: nightly production database backup to R2
└── docs/                  ARCHITECTURE.md, INFRASTRUCTURE.md (accounts, services, secrets, setup log), TODO.md (what's left),
                           QA.md, SDLC_VALIDATION.md
```

## Modes
`MODE` in `wrangler.toml`. Production and staging are **native**; **proxy** is kept only as an emergency rollback until NexBizRise is retired. Rollback is setting `MODE = "proxy"` again.
- **proxy** (emergency rollback only): only `/api/*` goes to the NexBizRise worker, without cookies or `Authorization`, and `Set-Cookie` is dropped on the way back. Other unknown paths (including `/admin`) are a local 404. `/app/config.js` gives the browser the NexBizRise database and Turnstile key, so the app keeps working against the old worker.
- **native**: `/api/*` is `src/routes/native.js`, against Linkcardly's own Supabase project (`supabase/live/*.sql`), R2 bucket, Turnstile widget, Resend and payment accounts. `/app/config.js` gives the browser this environment's database and Turnstile key (`wrangler.toml`).
- **Both modes:** marketing pages, the order app (`/create`), card pages (`/<name>`, `/c/<id>`) and edit links (`/e/<token>`) are served from `public/`; the app loads React and Babel from `public/app/vendor/`. Link-preview bots get the card's name, role and photo in the meta tags (`routes/og.js`). The daily job (`scheduled()` in native.js, 09:00 India) sends renewal reminders and keeps the Supabase Free project active.

### Native API (`src/routes/native.js`)
| Route | What it does |
|---|---|
| `GET /api/card/<name or nbr_id>` | Card data from the public views; cached 5 minutes at the edge, purged on every edit |
| `POST /api/hit` | Visit and tap counts → Analytics Engine (`STATS`) |
| `POST /api/upload` | Photo or video → R2 (`PHOTOS`); type decided by the file's bytes; 5 MB; returns its `IMG_BASE` address |
| `POST /api/order` | Turnstile → `place_order` (database prices it) → starts payment → emails. The edit link comes back only for orders already paid (test mode, free coupon); otherwise it is emailed after payment |
| `POST /api/edit` | `update_card_by_token`, then purges the card cache |
| `POST /api/lead` | Card contact form → `submit_lead`, emails the card owner (owner details never go back to the visitor) |
| `POST /api/contact` | linkcardly.com contact and teams forms → `submit_site_lead`, emails Linkcardly |
| `POST /api/pay/start`, `/api/pay/verify`, `GET /api/pay/status` | Razorpay (INR) and Stripe (USD) checkout; each off until its keys are set |
| `POST /api/razorpay/webhook`, `/api/stripe/webhook` | Signed events: paid → `mark_order_paid`; full refund → `mark_order_refunded`; failed and expired are logged |
| `GET /api/stats`, `POST /api/purge` | Admin only (Supabase admin login checked with `is_admin`) |
| `POST /api/admin/paid` | Admin only: a payment received outside the website (UPI, bank). `mark_order_paid_manual` → card live, "card is live" email with a fresh edit link, which also goes back to the admin |
| `GET /img/p/<file>` | Local development only (`SERVE_IMG = "1"`): photos from the local R2 |

Forms (`upload`, `order`, `edit`, `lead`, `contact`, `pay`) are refused from other origins. Every database call carries the Worker secret (`x-nbr-secret`, checked by `from_worker()`) and the visitor's address (`x-nbr-ip`), so the database's bot gate and rate limits apply per visitor; without the secret it refuses direct orders. Only errors the SQL raises on purpose (`link taken`, `invalid email`) reach the browser.

## Rules
- Single sources of truth (full table in `CLAUDE.md`): brand tokens `public/assets/css/tokens.css`; pages and their routes `site/pages.js` (`STATIC_PAGES` and reserved handles are derived from it); colourways `src/lib/themes.js` (the browser catalogue is generated with copy from `site/catalogue.js`); icons `src/lib/icons.js`; handle rules `src/lib/handles.js`; nav and footer `site/site.config.js`; the browser's environment settings (database, publishable key, Turnstile site key) `wrangler.toml` vars, served as `/app/config.js` to every page; QR generator `public/app/qrcode.js`. Generated copies are git-ignored and rebuilt by every `npm test`, `wrangler dev` and `wrangler deploy`.
- Pages this repo renders get an enforced Content-Security-Policy (`src/http.js`). The vendored app gets a report-only one (`APP_CSP`), because it relies on inline scripts, in-browser Babel and payment SDKs. Both allow only this environment's database origin (the one in `/app/config.js`).
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
- Card link names: the browser asks `slug_available` (supabase/live/linkcardly.sql), which sees every card including unpaid orders, and the order sends `strict_slug` so the database answers "link taken" instead of adding digits. Names held by unpaid orders older than 24 hours are released. Until linkcardly.sql is run, the browser falls back to the live-cards view and the database still adds digits.
- From the production E2E run (2026-10), open:
  - Refreshing the order page (or a phone closing the tab) loses what the customer typed; keep a draft in `sessionStorage`.
  - Save contact shows the iPhone guide ("Two taps on iPhone") on every device (`iosGuide` "Always" in card.html); Android only needs one tap.
  - Order numbers still start with `NBR-` (set in the database's `place_order_core`). The native API accepts `NBR-` and `LC-`; changing the prefix is a SQL change on both projects.
  - Choosing a file that isn't an image gives no message on the Your card step.
  - Payment and webhook scenarios aren't tested (payments are off). Add them to `test/e2e/production.mjs` when they're on.
- `order.html` keeps its old done markup for the unpaid and verifying states; the rest of the done screen is `components/order-done.js`. Move those two states into the component when they are next changed.
- Production audit (2026-10), still open:
  - Proxy mode (rollback only): the proxy passes the browser's `Origin` (linkcardly.com) to the NexBizRise worker, whose `ORIGIN_OK` only allows nexbizrise origins, so photo uploads, edit saves and payments may answer 403 there. Native mode fixes this (the routes are in this Worker); cutover is the fix.
  - Region is chosen by the buyer: a US buyer can pick India and pay the INR price. Turn off international cards in Razorpay, or check the region server-side when payments go live.
  - Coupons are counted when an order is placed, not when it's paid; unpaid orders can use them up.
  - No retention or deletion: unpaid orders, inactive cards and `admin_log` snapshots are kept forever.
  - Partner payout details (UPI, bank account, PAN) are plain text; encrypt before scaling the programme.
  - The app CSP is still report-only with `unsafe-eval` (in-browser Babel).
- Admin page (`public/app/admin.html`, vendored from NexBizRise): keeps NexBizRise's own look (cyan accents, Plus Jakarta Sans), and on a phone its header is crowded and the page is 26 px wider than the screen. Its edits go straight to the tables as the signed-in admin (row-level security allows admins), so they skip the field rules that `update_card_by_token` applies; only admins can do this.
- `src/lib/handles.js` (`HANDLE_RE`) allows dots in a card name; the database and the order page don't. Align it when handles are next touched.
- Changing the photo from an edit link isn't automated in the E2E suite yet (the upload itself is, in a native run).
