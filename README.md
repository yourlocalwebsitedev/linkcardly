# Linkcardly

Digital business cards at `linkcardly.com/<handle>`. A new repo, built on the same stack as NexBizRise: **Cloudflare Workers + static assets, Supabase and Turnstile**. Plain JS, no framework, no bundler. One small build script (`scripts/build.mjs`) assembles the marketing pages.

## Structure
See `docs/ARCHITECTURE.md`. In short, edit marketing pages in `site/`, the server in `src/`, and static files in `public/`. `public/app/` is the vendored NexBizRise order and card app.

## Setup
```bash
npm ci
npx wrangler login
# native mode only: set SUPABASE_URL in wrangler.toml, then
npx wrangler secret put SUPABASE_SERVICE_KEY
npx wrangler secret put TURNSTILE_SECRET
npx wrangler secret put SUPABASE_ANON_KEY   # optional: public card reads go through RLS
# native mode only: run supabase/migrations/*.sql in order (0001, 0002, 0003)
npm test           # build + unit, integration and database tests
npm run dev        # build + http://localhost:8787
npm run deploy     # build + deploy
```
`wrangler dev` and `wrangler deploy` also run the build themselves (`[build]` in `wrangler.toml`).

The Turnstile site key lives in one place: `site/site.config.js` (marketing pages) and `TURNSTILE_SITE_KEY` in `wrangler.toml` (native lead form). In proxy mode it is the NexBizRise widget's key, the same one `public/app/order.html` uses.

## Testing
- `npm test`: builds, then runs `test/*.test.js` (Worker routing, native API, card view, built site, and the SQL migrations in an in-process Postgres). Tests marked `todo` reproduce known open defects; see `docs/SDLC_VALIDATION.md`.
- `BASE=http://127.0.0.1:8787 node test/e2e/smoke.mjs`: browser smoke test against `npm run dev` (needs Playwright).
- CI (`.github/workflows/ci.yml`) runs install, `npm audit`, `npm test` and a dry-run deploy on every PR and on `main`.

## Operations
- **Health:** `/health` → `ok v3` (liveness). `/health?deep=1` → JSON with a Supabase check (native) or a NexBizRise check (proxy); 503 if a dependency is down. Point the uptime monitor at the deep check.
- **Logs:** Workers Logs (`[observability]`). One JSON line per request (`t: "req"`: method, path, status, ms, mode, ray) and per failure (`t: "error"`, `t: "proxy"`, `t: "turnstile"`). Edit tokens are masked as `/e/:token`.
- **Errors:** any unhandled failure returns a JSON 500/503 on `/api/*` and a "Something went wrong" page elsewhere, and is logged.
- **Rate limits:** 30 requests per minute per IP and route on `/api/handle, order, contact, lead, edit, upload, pay, csp-report` (binding `RATE_LIMITER`).
- **CSP:** enforced on pages this repo renders; report-only on the vendored app (`APP_CSP` in `src/http.js`). Violations are logged as `t: "csp"`. Once they're quiet, tighten the policy and enforce it.
- **Staging:** `npx wrangler deploy --env staging` (see `[env.staging]` in `wrangler.toml`). CI deploys `main` to staging when the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets exist; production deploys are manual (Actions → CI → Run workflow → deploy).
- **Rollback:** `npx wrangler deployments list`, then `npx wrangler rollback <version-id>`. Database changes are forward-only; take a Supabase backup before running a migration.

## Modes
- **proxy (now):** `MODE = "proxy"`. Linkcardly serves its marketing pages and the vendored card and order app. Every `/api/*` call is forwarded to the existing NexBizRise worker (`LEGACY_ORIGIN`), so the existing Supabase, Turnstile, payments and edit links work unchanged. Nothing else is forwarded: the NexBizRise admin is used on its own host.
- **native (later):** `MODE = "native"` switches to the Linkcardly API and database in `src/` and `supabase/`.

## Ordering and pricing
`/create` serves `public/app/order.html` (the NexBizRise order flow); `/order` and `/pricing` redirect to it. Its preview uses `public/app/card.html`, with `brand.js`, `qrcode.js` and `support.js` alongside. See `public/app/README.md`.
- Linkcardly changes are listed in `public/app/README.md` (brand, hosts, the claimed handle `?h=`, self-hosted React and Babel).
- Its `/api/*` calls (upload, order, pay/start, pay/verify, pay/status, edit) are forwarded in proxy mode to the existing NexBizRise worker, so the same Supabase, Stripe, Razorpay and admin are used.
- Copy these files again whenever the NexBizRise order flow changes.

## Routes
| Path | What |
|---|---|
| `/`, `/designs`, `/teams`, `/contact`, `/privacy`, `/terms`, `/refunds` | Static marketing pages (`/designs/` redirects to `/designs`) |
| `/create` | Order app; `/order` and `/pricing` 301 here |
| `/<handle>` | Live card (status `live` only) |
| `/<handle>/contact.vcf` | Save contact |
| `GET /api/handle?h=` | Availability check (with suggestions) |
| `POST /api/order` | Creates a `pending` card + links (Turnstile) |
| `POST /api/contact` | Contact form (Turnstile) |
| `POST /api/lead` | Lead form on a card (Turnstile) |
| `GET /api/qr?u=` | QR code SVG for a linkcardly.com URL (generated in the Worker) |
| `POST /api/csp-report` | CSP violation reports from the vendored app (logged only) |
| `/health`, `/health?deep=1` | Liveness, readiness (see Operations) |
| `card.nexbizrise.com/*` | 301 → `linkcardly.com/*` (only once `LEGACY_HOSTS` is set at cutover) |

## Handle rules
Lowercase letters, numbers, `.` and `-`. 3–30 characters. Must start and end with a letter or number, with no repeated `.` or `-`, and may not end in a file extension such as `.png`. Reserved words are listed in `src/lib/handles.js`; the build generates the browser copy (`assets/js/rules.js`). The database enforces the same pattern.

## Port from NexBizRise (next)
These exist in the old product. Copy their logic in rather than rebuilding it:
- [ ] Design families and all colourways → `src/lib/themes.js` (with per-family layouts in `card.js`)
- [ ] Moving portrait / Cover photo framing
- [ ] Seasonal themes (auto / off)
- [ ] Category details and compliance blocks (TREC)
- [x] QR generator (`/api/qr` now renders SVG in the Worker)
- [ ] Admin: approve, pause or activate cards, mark payments, view leads
- [ ] Self-edit page via `cards.edit_token`
- [ ] Order emails (customer + admin)
- [ ] Data migration: export old cards → insert into `cards` and `links` with the same slugs

## Manual setup
- Cloudflare: add linkcardly.com and attach it to the Worker.
- **Cutover (only when switching to native):** while `MODE = "proxy"`, `LEGACY_ORIGIN` points at `card.nexbizrise.com`, so that host must keep serving the NexBizRise worker. Before attaching `card.nexbizrise.com` to this Worker, give the NexBizRise worker its own hostname (e.g. its `*.workers.dev` URL), point `LEGACY_ORIGIN` there, then set `LEGACY_HOSTS = "card.nexbizrise.com"`.
- Turnstile: allowed hostname linkcardly.com.
- Supabase: allowed URL linkcardly.com.
- Email: hello@linkcardly.com with SPF/DKIM.
- Google Search Console: add linkcardly.com and submit a change of address.

## Notes
- Prices live in the order app (`public/app/order.html`, `PRICING`). The legal pages (`site/pages/privacy.html`, `terms.html`, `refunds.html`) are drafts based on how the product works; they need business and legal sign-off.
- Every animation is turned off under `prefers-reduced-motion`.
- The design reference is `design_handoff_linkcardly_website/`.
