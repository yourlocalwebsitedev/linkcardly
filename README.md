# Linkcardly

Digital business cards at `linkcardly.com/<handle>`. A new repo, built on the same stack as NexBizRise: **Cloudflare Workers + static assets, Supabase and Turnstile**. Plain JS, no framework, no bundler. One small build script (`scripts/build.mjs`) assembles the marketing pages.

## Structure
See `docs/ARCHITECTURE.md`. In short, edit marketing pages in `site/`, the server in `src/`, and static files in `public/`. `public/app/` is the vendored NexBizRise order and card app.

## Infrastructure
Everything Linkcardly runs on (Cloudflare Worker, R2 photos, Turnstile, Supabase, Resend, email forwarding), how each
piece was set up, the secret names and where their values come from, and what's still to do: **`docs/INFRASTRUCTURE.md`**.

## Setup
```bash
npm ci
npx wrangler login     # the Linkcardly Cloudflare account
npm test               # build + unit, integration and database tests
npm run dev            # build + http://localhost:8787, native mode on the STAGING database (never production)
```
Production deploys come from merging to `main` (Workers Builds). Public settings for each environment are in
`wrangler.toml`; secrets are set on the Worker (`npx wrangler secret put <NAME> [--env staging]`), never in the repo.
`wrangler dev` and `wrangler deploy` also run the build themselves (`[build]` in `wrangler.toml`).

**New database:** run `supabase/live/0-base.sql`, `ALL-IN-ONE.sql`, `linkcardly.sql` in that order, then the steps
in `docs/INFRASTRUCTURE.md` (secrets, admin, signups off), and check it with `supabase/live/verify.sql`.

The browser gets its settings (database URL, publishable key, Turnstile site key) from `/app/config.js`, which the
Worker builds from `wrangler.toml`: Linkcardly's own in native mode, the NexBizRise ones in proxy mode. No page has
them hard-coded.

## Testing
- `npm test`: builds, then runs `test/*.test.js`: Worker routing, the native API (`native.test.js`, with Supabase, Turnstile, Resend, Razorpay and Stripe stubbed), the built site, shared helpers, and the real database SQL (`live-db.test.js`, `supabase/live/*.sql` in an in-process Postgres). Tests marked `todo` reproduce known open defects; see `docs/SDLC_VALIDATION.md`.
- `BASE=http://127.0.0.1:8787 node test/e2e/smoke.mjs`: browser smoke test against `npm run dev` (needs Playwright).
- `BASE=http://127.0.0.1:8787 node test/e2e/order-flow.mjs`: the order flow's screens at 390 × 844 with a mocked backend.
- `BASE=http://127.0.0.1:8787 node test/e2e/production.mjs`: production E2E suite. The browser runs against the real database SQL (`supabase/live/*.sql` in PGlite behind a PostgREST stand-in, `test/support/`), with test mode on. Covers the customer lifecycle, preview and live-card actions, the edit link, customers A and B (authorization), that only the server can mark an order paid, failures (double click, lost response, offline, 500, slow network, refresh, bad file) and security (headers, XSS, secrets, CORS, rate limits). Writes `test/e2e/report/report.md` (Passed / Failed / Blocked / Not tested, findings, screenshots). Payment and webhook scenarios are listed as Not tested until payments are integrated.
  - **Proxy mode** (the emergency rollback): start the server with `npx wrangler dev --port 8787 --ip 127.0.0.1 --var MODE:proxy`.
  - **Native mode**: start the server with the native API pointed at the suite's database (the suite serves it on port 54329), then run the same command. Wait a minute between runs (the Worker's per-minute rate limit sees every local browser as one address).
    ```bash
    npx wrangler dev --port 8787 --ip 127.0.0.1 --var MODE:native --var SUPABASE_URL:http://127.0.0.1:54329 \
      --var SUPABASE_ANON_KEY:local --var TURNSTILE_SITE_KEY: --var WORKER_SECRET:e2e-worker-secret-0123456789abcdef \
      --var SERVE_IMG:1 --var CRON_KEY:e2e-cron-key
    ```
  - **Staging**: `STAGING=1 BASE=https://linkcardly-staging.yourlocalwebsitedev.workers.dev node test/e2e/production.mjs` (the staging Supabase project must have test mode on).
- CI (`.github/workflows/ci.yml`) runs install, `npm audit`, `npm test` and a dry-run deploy on every PR and on `main`.

## Operations
- **Health:** `/health` → `ok v3` (liveness). `/health?deep=1` → JSON with a Supabase check (native) or a NexBizRise check (proxy); 503 if a dependency is down. Point the uptime monitor at the deep check.
- **Logs:** Workers Logs (`[observability]`). One JSON line per request (`t: "req"`: method, path, status, ms, mode, ray) and per failure (`t: "error"`, `t: "proxy"`, `t: "turnstile"`). Edit tokens are masked as `/e/:token`.
- **Errors:** any unhandled failure returns a JSON 500/503 on `/api/*` and a "Something went wrong" page elsewhere, and is logged.
- **Rate limits:** 30 requests per minute per IP and route on `/api/order, contact, lead, edit, upload, pay, csp-report` (binding `RATE_LIMITER`). The database adds its own per-visitor limits (e.g. 20 orders an hour).
- **Daily job:** 03:30 UTC (09:00 India), `[triggers]` in `wrangler.toml`: renewal reminder emails. Its database query also keeps the Supabase Free project from pausing. Run it by hand locally with `curl "http://127.0.0.1:8787/cdn-cgi/local/scheduled"`; logged as `t: "cron"`.
- **Emails:** Resend (`RESEND_API_KEY`), from `MAIL_FROM`, replies to `ADMIN_EMAIL`: order received, card live with the private edit link, payment received (design-for-me), new lead (to the card owner), renewal reminders; new orders, payments, refunds and website enquiries to `ADMIN_EMAIL`. Failures are logged as `t: "mail"`.
- **Backups:** `.github/workflows/backup.yml` dumps the production database every night (02:30 India) to the private R2 bucket `linkcardly-backups` (kept 14 days). Setup and restore: `docs/INFRASTRUCTURE.md`, "Backups".
- **CSP:** enforced on pages this repo renders; report-only on the vendored app (`APP_CSP` in `src/http.js`). Violations are logged as `t: "csp"`. Once they're quiet, tighten the policy and enforce it.
- **Staging:** Worker `linkcardly-staging` in native mode with its own database, bucket, widget and secrets (`[env.staging]` in `wrangler.toml`). CI deploys `main` to staging when the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets exist, or deploy it by hand with `npx wrangler deploy --env staging`. Setup steps: `docs/INFRASTRUCTURE.md`, "Staging".
- **PR previews:** Cloudflare Workers Builds runs `npx wrangler preview` for every pull request, using `[previews]` in `wrangler.toml` (proxy mode, own rate-limit namespace). Absolute links in a preview point at production.
- **Rollback:** `npx wrangler deployments list`, then `npx wrangler rollback <version-id>`. From native back to proxy: set `MODE = "proxy"`. Database changes are forward-only; run the backup workflow (Actions → Database backup → Run workflow) before changing the database.

## Modes
- **native** (production and staging): `MODE = "native"`. `/api/*` is this Worker (`src/routes/native.js`) with Linkcardly's own Supabase, R2, Turnstile, Resend and payment accounts. Routes: `docs/ARCHITECTURE.md`.
- **proxy** (emergency rollback only, until NexBizRise is retired): `MODE = "proxy"`. Linkcardly serves its pages and the order and card app; every `/api/*` call is forwarded to the NexBizRise worker (`LEGACY_ORIGIN`), so the NexBizRise database, Turnstile and payments are used. Nothing else is forwarded.

## Ordering and pricing
`/create` serves `public/app/order.html` (the vendored order flow); `/order` and `/pricing` redirect to it. Its preview uses `public/app/card.html`. Linkcardly's changes to the app are listed in `public/app/README.md`. Prices are in `order.html` (`PRICING`) for display; the database prices every order (`place_order`).

## Routes
| Path | What |
|---|---|
| `/`, `/designs`, `/teams`, `/contact`, `/privacy`, `/terms`, `/refunds` | Static marketing pages (`/designs/` redirects to `/designs`) |
| `/create` | Order app; `/order` and `/pricing` 301 here |
| `/<name>`, `/c/<nbr_id>` | Live card (card app; link previews get the card's name and photo) |
| `/e/<token>` | Private edit link (order app in edit mode; never cached, no referrer) |
| `/app/config.js` | This environment's browser settings (database, publishable key, Turnstile site key) |
| `/api/*` | Native API (`docs/ARCHITECTURE.md`) or, in proxy mode, the NexBizRise worker |
| `POST /api/csp-report` | CSP violation reports from the vendored app (logged only), both modes |
| `/health`, `/health?deep=1` | Liveness, readiness (see Operations) |
| `card.nexbizrise.com/*` | 301 → `linkcardly.com/*` (only once `LEGACY_HOSTS` is set at cutover) |

## Handle rules
Lowercase letters, numbers and single `-` between them (the database's rule; the order page enforces it). `src/lib/handles.js` decides which paths can be card links and also allows `.` (known debt). Reserved words are listed in `src/lib/handles.js`; the build generates the browser copy (`assets/js/rules.js`). The database enforces the same pattern.

## Manual setup
Done and recorded in `docs/INFRASTRUCTURE.md` (Cloudflare, Supabase, R2, Turnstile, Resend, email). Still to do:
- **Cutover (only when switching to native):** while `MODE = "proxy"`, `LEGACY_ORIGIN` points at `card.nexbizrise.com`, so that host must keep serving the NexBizRise worker. Before attaching `card.nexbizrise.com` to this Worker, give the NexBizRise worker its own hostname (e.g. its `*.workers.dev` URL), point `LEGACY_ORIGIN` there, then set `LEGACY_HOSTS = "card.nexbizrise.com"`.
- Google Search Console: add linkcardly.com and submit a change of address.

## Notes
- Prices live in the order app (`public/app/order.html`, `PRICING`). The legal pages (`site/pages/privacy.html`, `terms.html`, `refunds.html`) are drafts based on how the product works; they need business and legal sign-off.
- Every animation is turned off under `prefers-reduced-motion`.
- The design reference is `design_handoff_linkcardly_website/`.
