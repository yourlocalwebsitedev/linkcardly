# Linkcardly: SDLC validation report

| | |
|---|---|
| Date | 2 Oct 2026 |
| Scope | Repository `yourlocalwebsitedev/linkcardly` at commit `1c0aff8` ("Update from design project"), as deployed by `wrangler.toml` (`MODE = "proxy"`) and as planned for `MODE = "native"` |
| Method | Full code review of `src/`, `site/`, `scripts/`, `supabase/`, `public/assets/` and the vendored `public/app/` (read for integration, security and payment behaviour, not refactored); automated unit and integration tests; the Worker run locally in `wrangler dev` (workerd, Wrangler 4.146); headless Chromium checks at 375 px and 1366 px; a local load test; `npm audit`; `wrangler deploy --dry-run` |
| Out of reach | The NexBizRise worker and its Supabase project, which handle every `/api/*` call, payment, admin action, e-mail and edit in proxy mode, are not in this repo. Stripe, Razorpay, Cloudflare and Supabase dashboards. Real devices and browsers other than Chromium. Production traffic. Everything that depends on these is marked **Untested**. |

## 1. Verdict

**Not production-ready. Do not accept for release.**

Six release blockers are open. Two of them break the live product in its current proxy mode:

1. **DEF-00:** Every customer card link (`/<handle>`, `/c/<id>`), every edit link (`/e/<token>`) and `/create` answer with a 307 redirect to `/app/card` or `/app/order`. The card app reads the handle from the path, so after the redirect every card shows the built-in demo card, and every edit link loses its token. This was reproduced in workerd and in Chromium. A one-line fix was verified (§21) but not applied, because this pass validates and does not change the product.
2. **DEF-02:** Payment is not implemented in this codebase. Proxy mode relies on the NexBizRise backend, which was not reviewed. Native mode has no payment path, no orders table and no webhooks.
3. **DEF-03:** The contact form ships with the placeholder Turnstile key `YOUR_TURNSTILE_SITE_KEY`, so no visitor can submit it.
4. **DEF-10:** The Privacy, Terms and Refund pages contain only "Policy text goes here". You can't legally take payments or collect leads without them.
5. **DEF-13:** The documented cutover (attach `card.nexbizrise.com` to this Worker) conflicts with proxy mode, which forwards to that same host.
6. **DEF-28:** "Switch to native with one setting" is not true. The vendored order and card app calls eight `/api/*` endpoints, and native mode implements none of them.

The marketing site is in reasonable shape: pages build, are responsive with no horizontal scroll at 375 px, honour reduced motion and are fast. The Worker code is small, readable and well organised. The project's foundations are sound, but the product is not complete.

### Scorecard

| # | Area | Status | Summary |
|---|---|---|---|
| 1 | Functional completeness | ❌ Fail | Card and edit links broken (DEF-00); claim form loses the handle (DEF-11); payment, admin, self-edit, e-mails, QR and migration are not in this repo |
| 2 | Implementation quality | ⚠️ Partial | Clean, small modules. No error handling (DEF-04/09); rules duplicated in 3 places (DEF-17/19) |
| 3 | Architecture | ⚠️ Partial | The two-mode design is sensible, but native mode is far from feature parity (DEF-28); cutover plan has a loop hazard (DEF-13) |
| 4 | API / backend | ❌ Fail | Native API: no error handling, check-then-insert race, non-atomic writes, no rate limits, no auth model for admin or edit |
| 5 | Frontend / UI | ⚠️ Partial | Responsive and reduced-motion OK. Home page JS crash (DEF-14); skip link never visible (DEF-38) |
| 6 | Database | ⚠️ Partial | Schema and RLS are reasonable. No orders/payments tables; legacy edit tokens don't fit `uuid` (DEF-27); no backup or rollback plan |
| 7 | Security | ❌ Fail | No security headers; two XSS sinks in native card view; service-role key used for public reads; no rate limiting |
| 8 | Payment | ❌ **Incomplete (as instructed)** | Not implemented in this repo. Full lifecycle unvalidated |
| 9 | Testing | ⚠️ Started | Before: `npm test` pointed at a folder that didn't exist. Now: 73 tests, 48 pass and 25 known defects are tracked as `todo`. No E2E against a real backend |
| 10 | Performance | ✅ Pass (local) | 370–640 req/s at 50 concurrent requests with 0 errors on a single local workerd instance. Production load and the database are untested |
| 11 | Reliability | ❌ Fail | No timeouts, retries or idempotency; failures become Cloudflare 1101 error pages; card pages depend on unpkg.com at runtime |
| 12 | DevOps / CI-CD | ⚠️ Started | No CI existed; a workflow was added (build, test, audit, dry-run deploy). No staging, release gate or rollback runbook |
| 13 | Infrastructure | ❌ Fail | Placeholder vars in `wrangler.toml`; no staging environment; DNS, e-mail and Turnstile host setup not done |
| 14 | Observability | ❌ Fail | No logging, metrics, alerts or audit trail; `/health` doesn't check dependencies |
| 15 | Dependencies | ✅ Pass | One dev dependency (`wrangler`), 0 vulnerabilities. Lockfile now committed. Runtime CDN scripts carry SRI |
| 16 | Data protection | ❌ Fail | No privacy policy, no retention rules for leads and messages, analytics and IP lookup on card pages with no consent notice |
| 17 | Documentation | ⚠️ Partial | Architecture doc is good. README has wrong paths and versions; there's no API, operations, troubleshooting or rollback doc |
| 18 | Code review | Done | See §18 |
| 19 | UAT | ❌ Fail | 6 of 22 acceptance criteria pass, 6 partly pass, 8 fail, 2 untested; see §19 |
| 20 | Production readiness | ❌ Not ready | See §20 |

---

## 2. Evidence and how to reproduce it

| Evidence | Command | Result |
|---|---|---|
| Unit and integration tests | `npm test` (now builds first, then runs `test/*.test.js`) | 73 tests: **48 pass, 0 fail, 25 todo**. Each `todo` is a test that reproduces an open defect and is labelled with its DEF number. When a defect is fixed, remove its `todo` option so the test then guards against regression |
| Local runtime | `npm run dev`, then `curl` on every route | Route table in §4.2 |
| Browser | `BASE=http://127.0.0.1:8787 node test/e2e/smoke.mjs` (needs Playwright) | §5 |
| Load | 2,000 requests per route at 50 concurrent requests against `wrangler dev` | §10 |
| Dependencies | `npm audit` | 0 vulnerabilities |
| Deploy config | `npx wrangler deploy --dry-run` | Bundles (21.7 KiB, 7.7 KiB gzipped), 45 asset files, bindings listed; `SUPABASE_URL` and `TURNSTILE_SITE_KEY` are still placeholders |
| CI | `.github/workflows/ci.yml` (added) | Runs `npm ci`, `npm audit --audit-level=high`, `npm test` and a dry-run deploy on push to `main` and on every PR |

The test double for the Workers assets binding (`test/helpers.js`) reproduces Cloudflare's `auto-trailing-slash` 307s and the `redirect: "manual"` mode of incoming requests. A simpler double hid DEF-00 at first, and the real runtime exposed it.

---

## 3. Functional completeness

| Requirement (from project summary) | Proxy mode (live) | Native mode | Evidence |
|---|---|---|---|
| Live card page at `linkcardly.com/<handle>` | ❌ **Broken (DEF-00):** 307 to `/app/card`, handle lost, demo card shown | ✅ Renders (no dots in handle: DEF-01) | curl, Chromium, `cards.test.js` |
| `/c/<id>` card links | ❌ DEF-00 | ❌ No route | as above |
| Save contact (vCard) | Untested (vendored app) | ✅ `/<handle>/contact.vcf`. No line folding (DEF-25); no photo | `cards.test.js` |
| Share, QR, quick actions, socials | Untested (unpkg blocked in sandbox) | ✅ Rendered. QR goes through a third party (DEF-15) | `cards.test.js` |
| Ordering at `/create` (also `/order`, `/pricing`) | ⚠️ `/order` and `/pricing` 301 to `/create` ✅, but `/create` 307s to `/app/order` (DEF-00, cosmetic for this page) | ⚠️ `POST /api/order` creates a pending card. The order app needs `/api/upload`, `/api/order` (different payload), `/api/pay/*` (DEF-28) | curl, `api.test.js` |
| Design picker and live preview | Untested (React from unpkg blocked in sandbox) | n/a | |
| Photo upload | Untested (NexBizRise backend) | ❌ No `/api/upload` | |
| Payments (Stripe, Razorpay) | ❌ **Incomplete:** NexBizRise backend, not reviewed | ❌ Not implemented | §8 |
| Handle availability and suggestions | ⚠️ The marketing site reads the legacy Supabase `public_cards` view directly; its rules differ from the server's (DEF-17) | ✅ `GET /api/handle`. Ignores `handle_history` (DEF-05); a missing `?h=` validates as the handle "null" (DEF-22); suggests `.co` handles that can't be routed (DEF-01) | `api.test.js`, `lib.test.js` |
| Reserved words blocked | ✅ Server list covers every route | ⚠️ Browser list is a different, shorter list (DEF-17) | `lib.test.js` |
| Lead form on cards | Untested (NexBizRise) | ⚠️ Works with form posts. JSON posts (the vendored card app sends JSON) throw an exception (DEF-06) | `api.test.js` |
| Contact form | ❌ Placeholder Turnstile key (DEF-03); client crashes on non-JSON errors (DEF-29) | ✅ API validated | Chromium, `api.test.js` |
| Self-edit through a private link | ❌ DEF-00: token lost on redirect | ❌ Not implemented (`edit_token` column only) | curl |
| Admin (approve, pause, payments, leads) | Forwarded to NexBizRise (any unknown path is proxied); untested | ❌ Not implemented | `routing.test.js` |
| Marketing site (Home, Designs, Teams, Pricing/Create, Contact, legal) | ⚠️ Pages build and render. Home page JS crash (DEF-14); legal text missing (DEF-10); claim form loses handle (DEF-11) | same | Chromium, `site.test.js` |
| Migration: `card.nexbizrise.com/*` 301 to `linkcardly.com/*` | ❌ Inactive (`LEGACY_HOSTS = ""`), and it conflicts with proxy mode (DEF-13) | ✅ Logic works when configured | `routing.test.js` |
| Data migration of old cards | ❌ Not started; schema can't hold legacy edit tokens (DEF-27) | | |
| Order and confirmation e-mails | Untested (NexBizRise) | ❌ Not implemented | |
| Seasonal themes, design families, moving portrait, TREC blocks | Untested (vendored app) | ❌ Partial: 8 colourways, 2 of the catalogue's 10 missing (DEF-19) | `lib.test.js` |

## 4. Implementation quality and architecture

### 4.1 Assessment

**Strengths**
- The Worker is about 250 lines in small, single-purpose modules. Routing (`src/index.js`) is separate from handlers, views and pure helpers.
- The icon set has a single source (`src/lib/icons.js`), and the build generates the browser copy.
- There are no runtime npm dependencies, no framework and no bundler, so the supply-chain attack surface is small.
- The proxy and native split, with the vendored app kept unchanged, is a pragmatic way to rebrand without touching a working payment backend.
- User text in the native card view is HTML-escaped throughout. The one exception is DEF-08, which is deliberate raw HTML.

**Weaknesses**
- **No error handling anywhere in the Worker** (DEF-04, DEF-09, DEF-39). Any Supabase, Turnstile or upstream failure throws, and Cloudflare serves its generic 1101 error page.
- **Business rules are duplicated and already disagree:**
  - Handle rules: `src/lib/handles.js` allows 3–30 characters with dots and dashes; `site.js` allows dashes only, up to 40; the vendored app's card route allows dashes only.
  - Reserved words: `handles.js` vs `assets/js/config.js`.
  - Colourways: `themes.js` vs `catalogue.js`.
- **"Native = one setting" is not true** (DEF-28). Native mode lacks: `/api/card/:slug`, `/api/hit`, `/api/upload`, the `/api/order` payload shape the app sends, `/api/edit`, `/api/pay/start|verify|status`, `/e/<token>` and `/c/<id>` routes, admin, e-mails and payments.
- `isFile()` routing treats any first path segment that contains a dot as a static file, which collides with the handle rules (DEF-01).
- `serveAsset` passes the incoming request (with `redirect: "manual"`) into the assets binding and asks for `.html` paths that `auto-trailing-slash` redirects (DEF-00).

### 4.2 Route behaviour in the local runtime (proxy mode)

| Path | Expected | Observed |
|---|---|---|
| `/` | 200 | 200 |
| `/designs`, `/teams`, `/contact`, `/privacy`, `/terms`, `/refunds` | 200 | **307 to the same path with a trailing `/`** (DEF-16; canonical and sitemap use no slash) |
| `/create` | 200 order app | **307 to `/app/order`** (DEF-00) |
| `/order`, `/pricing` | 301 to `/create` | 301 ✅ |
| `/alexmorgan`, `/c/nbr_ab12cd` | 200 card app at the same URL | **307 to `/app/card`**, which shows the demo card (DEF-00) |
| `/e/<40 hex>` | 200 order app in edit mode | **307 to `/app/order`**, token lost (DEF-00) |
| `/sandeep.k` (valid handle) | card | 404 (DEF-01) |
| `/nope.css` | 404 page | 404 ✅ |
| `/app/README.md` | not public | 200 (DEF-34) |

## 5. Frontend and UI

| Check | Result |
|---|---|
| Responsive, no horizontal scroll at 375 px and 1366 px (all marketing pages and `/create`) | ✅ |
| One `<h1>`, title, description, canonical and `lang` on every page | ✅ (`site.test.js`) |
| Form fields have accessible names | ✅ |
| Reduced motion | ✅ 0 running animations under `prefers-reduced-motion: reduce`; CSS turns off all animations and transitions |
| JS errors | ❌ **Home page:** `ReferenceError: Cannot access 'x' before initialization` (DEF-14). `site.js:127` assigns `x` inside `fill()`, which runs before `let x` on `site.js:133`. Everything after that point on the home page never runs, including the design-strip marquee and the testimonial buttons |
| Claim form ("Claim it →") | ❌ Lands on `/app/order` with no handle (DEF-11: `site.js:27` computes `h` and never uses it) |
| Contact form error state | ❌ A non-JSON error response throws `Unexpected token 'H'…` and the user sees nothing (DEF-29) |
| Skip link | ❌ Fixed at `left:-999px`, never shown on focus (DEF-38, WCAG 2.4.1 and 2.4.7) |
| Focus styles | ⚠️ Global `:focus-visible` ring exists; `.claim input` and `.input` set `outline:none` and rely on a border colour only |
| Vendored order app | ⚠️ Before React boots, the DOM shows raw `{{ … }}` templates and 6 console errors for invalid SVG paths. In the sandbox React couldn't load from unpkg, leaving card pages blank (DEF-32). Not tested end to end |
| Cross-browser | **Untested:** Chromium only. Safari matters most here (NFC/QR traffic is mostly iOS); `color-mix()` in the card CSS needs Safari 16.2+ |

## 6. Database

`supabase/migrations/0001_init.sql` was reviewed but not applied to a live database.

**Good**
- The handle `CHECK` constraint matches `HANDLE_RE` (tested), and `handle` is unique.
- Foreign keys cascade.
- `updated_at` trigger, sensible indexes, RLS on every table, and anon users can read only live cards and visible links.

**Gaps**

| ID | Gap |
|---|---|
| DEF-27 | `edit_token uuid` can't hold legacy 40-hex tokens (`/e/[a-f0-9]{40}`), so migrated edit links would break. Use `text` with a uniqueness constraint, and store a **hash** of the token rather than the token |
| DEF-02 | No `orders`, `payments` or `webhook_events` tables, and no order number |
| — | No `handle_history(card_id)` index; no `updated_at` on `links` |
| — | `leads.email` exists but is never written; no retention column or job for `leads` and `contact_messages` |
| — | `card_status` has no `expired` or `cancelled` value; `paid_until` is never enforced (DEF-21) |
| — | Single forward-only migration: no down migration, no seed or test data, no migration tooling (`supabase db push` / CLI) |
| — | **Backups:** no documented backup plan, point-in-time recovery or restore test |
| — | The anon `select` policy on `cards` exposes every column, including `edit_token` and `email`, to anyone holding the anon key. The comment "never select edit_token" isn't enforced. Expose a `public_cards` **view** with safe columns instead |

## 7. Security

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| DEF-12 | High | No security headers on any response: no CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy` or `frame-ancestors` | `routing.test.js` |
| DEF-07 | High (native) | `booking_url` goes into `href` with no scheme check, so `javascript:` URLs give stored XSS on the card origin (where the lead form and any future session live) | `cards.test.js` |
| DEF-08 | High (native) | `compliance_html` is rendered raw. Safe only while admins are the sole writers; once self-edit ships it is stored XSS. Sanitise against an allow-list or store structured fields | `cards.test.js` |
| DEF-31 | Medium | The Worker uses the **service-role key** for every query, including public card reads and handle checks, which bypasses RLS. Use the anon key (or a narrow view) for reads | code |
| DEF-30 | Medium | No rate limiting on `/api/handle` (enumeration, database load) or on the Turnstile-gated writes. Add a Cloudflare rate-limiting rule or binding | code |
| DEF-15 | Medium | `/api/qr` redirects to `api.qrserver.com` with **any** `u=`, sending every card URL to a third party and turning the domain into a free QR service | `api.test.js` |
| DEF-13 | Blocker | Proxy forwards **all** request headers (cookies included) to `LEGACY_ORIGIN`, and proxies every unknown path, which exposes the NexBizRise admin surface under `linkcardly.com` | `routing.test.js` |
| DEF-24 | Low | vCard escaping doesn't handle `\r`, so a field can inject extra vCard properties | `lib.test.js` |
| DEF-34 | Low | `public/app/README.md` and unused NexBizRise images are publicly served. Add `.assetsignore` | dry-run lists 45 files |
| — | Info | The Supabase **publishable** key in `assets/js/config.js` and `public/app/*.html` is meant to be public. Safety depends entirely on the legacy project's RLS and RPC grants (`place_order`, `update_card_by_token`, `get_card_for_edit`, `check_coupon`), which were **not reviewed** |
| — | Info | The order flow sends `price`, `tax` and `total` from the browser. The server **must** recompute them from plan, region and coupon. Not verifiable here (§8) |
| ✅ | — | Turnstile fails closed: a missing token or secret means the request is rejected. Every native write is Turnstile-gated and length-capped. Server-controlled fields (`status`, `paid_until`, `edit_token`) can't be set by the client (tested). Handle input is normalised to `[a-z0-9.-]` before it reaches a PostgREST filter. `npm audit` is clean. CDN scripts carry SRI |

No authentication or authorisation exists in this repo: no admin login and no edit-token check. Both are pending features, so the security of those flows is **untested**.

## 8. Payment: incomplete (blocker)

As instructed, payment is treated as **not implemented**. What exists:
- **Proxy mode:** The vendored order app calls `/api/order`, `/api/pay/start`, `/api/pay/verify` and `/api/pay/status`, which are forwarded to NexBizRise. Stripe uses hosted Checkout with a return to `?paid=<sid>`, polling `pay/status` six times at 1.5 s intervals. Razorpay opens checkout on the page, then calls `pay/verify`. The client uses an idempotency key (`idem`) per order attempt. None of the server side is in this repo.
- **Native mode:** Nothing. `POST /api/order` creates a `pending` card and returns `{ok, handle}` with no amount, no checkout and no order record.

Before production, validate the full lifecycle with documented test-mode evidence:

| Stage | Must prove |
|---|---|
| Quote | Server recomputes price, GST (IN 18 %) and coupon from plan, region and code, and ignores client totals |
| Create | One order per idempotency key; order and card created atomically |
| Checkout | Stripe Checkout session and Razorpay order created with the server amount and currency; customer-facing name is Linkcardly (QA.md item C) |
| Confirm | **Webhooks** (`checkout.session.completed`, Razorpay `payment.captured`) with signature verification are the source of truth, not the browser return; Razorpay `verify` checks the HMAC signature |
| Activate | Card goes live, `paid_until` is set, and confirmation and admin e-mails are sent once (idempotent on webhook retries) |
| Failure paths | Abandoned checkout, declined card, double submit, webhook before or after redirect, duplicate webhook, network loss during polling |
| Money back | Refunds and partial refunds match the (unwritten) refund policy; disputes; renewal and expiry |
| Reconciliation | Daily match of provider payouts against orders; audit log of manual "mark paid" admin actions |
| Compliance | PCI SAQ-A scope (hosted fields only), tax invoices for India, statement descriptor |

## 9. Testing

**Before this pass:** no tests existed, and `npm test` failed (`Could not find 'test/'`).

**Added**

| Suite | Tests | Covers |
|---|---|---|
| `test/lib.test.js` | 16 | Handles (valid and invalid, reserved, DB constraint parity, suggestions), vCard, icons, themes |
| `test/routing.test.js` | 15 | Health, host redirects, order aliases, static pages, 404, proxy forwarding and `Location` rewrite, card and edit links, dotted handles, security headers |
| `test/api.test.js` | 20 | Every native endpoint: happy path, validation, Turnstile failure, malformed body, conflict, outage, mass-assignment protection, unknown routes and methods |
| `test/cards.test.js` | 14 | Native card page and vCard, history redirect, escaping and XSS sinks, link order and visibility, lead form, plan gating, expiry |
| `test/site.test.js` | 8 | Built HTML: metadata, sitemap, internal links, branding, labels, placeholders, claim form |
| `test/e2e/smoke.mjs` | — | Browser: JS errors, overflow at 2 viewports, path kept for card and edit links, claim keeps handle, reduced motion (run manually against `npm run dev`) |

**Results:** 73 total, 48 pass, 0 fail, 25 `todo` (known defects).

**Still missing:**
- Integration tests against a real Supabase (local `supabase start`), including running the migration and RLS policy tests.
- Contract tests for every proxied NexBizRise endpoint.
- Payment E2E in Stripe and Razorpay test mode.
- Visual regression of the card designs.
- Cross-browser runs (Safari/iOS, Firefox).
- An accessibility audit with axe.
- A regression pack for the vendored app after each re-copy (`docs/QA.md` is manual).

## 10. Performance

The local workerd instance on a shared container ran 2,000 requests per route at 50 concurrent requests:

| Route | Throughput | p50 | p95 | p99 | Errors |
|---|---|---|---|---|---|
| `/health` | 644 req/s | 72 ms | 122 ms | 189 ms | 0 |
| `/` | 373 req/s | 128 ms | 205 ms | 259 ms | 0 |
| `/designs/` | 442 req/s | 104 ms | 170 ms | 202 ms | 0 |
| `/assets/css/site.css` | 403 req/s | 114 ms | 178 ms | 318 ms | 0 |

These numbers show no hot spots or failures under concurrency. They are not a production figure: Cloudflare serves static assets from the edge and scales out.

**Page weight**
- Home HTML is 25.7 KB and loads in 0.4–0.6 s locally.
- The vendored app is heavy: `card.html` is 199 KB and `order.html` 171 KB of inline code, plus React and ReactDOM from unpkg, with Babel standalone (about 3 MB) lazy-loaded when needed.
- On a phone opened from an NFC tap this is the main LCP risk. Measure it with Lighthouse or WebPageTest on a mid-range Android over 4G.

**Untested**
- Native card render with real Supabase latency. There are 2 sequential queries per view (`handle_history`, then `cards`), with no edge caching beyond `max-age=60`.
- Database performance at volume.
- Order-flow throughput.

## 11. Reliability

| ID | Finding |
|---|---|
| DEF-04 | Native API and card routes have no `try/catch`. A Supabase 5xx or a duplicate-handle race (check-then-insert) gives an exception and a 1101 page, not a 409 or 503. The card insert and the link inserts are separate requests, so a failure halfway leaves a card with missing links. No idempotency key on native `POST /api/order` |
| DEF-09 | `proxy()` has no timeout and no error handling; an upstream failure is an exception |
| DEF-39 | Turnstile `siteverify` has no timeout, and a non-JSON reply throws |
| DEF-32 | Card pages can't render if unpkg.com is unreachable (observed in the sandbox: blank page). Self-host React with the existing SRI hashes |
| — | No retries for idempotent reads; no graceful degradation such as serving a cached card when the database is down |

## 12. DevOps and CI/CD

| Item | Status |
|---|---|
| Build | ✅ `npm run build` is deterministic, except the copyright year. Build output is git-ignored and produced by `deploy` |
| Tests in the pipeline | ✅ Added: `.github/workflows/ci.yml` |
| Lockfile | ✅ Added `package-lock.json`, needed for `npm ci` and reproducible Wrangler versions |
| Environments | ❌ Only one. Add `[env.staging]` in `wrangler.toml` with its own route, Supabase project and Turnstile key |
| Release control | ❌ Deploys run by hand from a laptop. Add a protected `main` branch, a required CI check, and deploy from CI with a scoped API token |
| Rollback | ❌ Not documented. `wrangler rollback` / `wrangler versions` exist; database rollback needs a down migration or a restore |
| Config | ❌ Placeholders in `wrangler.toml` (`SUPABASE_URL`, `TURNSTILE_SITE_KEY`) and hard-coded in `site/pages/contact.html`. Secrets via `wrangler secret` ✅ |

## 13. Infrastructure

**Open manual setup items:**
- Attach the domain.
- Add `linkcardly.com` to the allowed hosts for Turnstile, Supabase and the NexBizRise CORS and upload checks (QA.md item E).
- `hello@linkcardly.com` with SPF, DKIM and **DMARC**.
- Google Search Console change of address.

**Additional findings**
- **DEF-13 (cutover):**
  - README says to attach `card.nexbizrise.com` to this Worker, but proxy mode forwards to `https://card.nexbizrise.com`. Doing both would at best stop the proxy reaching NexBizRise, and at worst loop.
  - Before any redirect, the NexBizRise worker needs its own hostname (for example `api.nexbizrise.com` or its `workers.dev` URL) and `LEGACY_ORIGIN` should point there.
  - `LEGACY_HOSTS` must stay empty until native mode is live.
- `www.linkcardly.com` is hard-coded in `src/index.js` rather than configured.
- No `[observability]`, Logpush, or rate-limiting binding.
- Scaling: Workers scale automatically. The bottleneck is the Supabase plan's connection and request limits, which haven't been reviewed.
- **Disaster recovery:** none documented. Needed: Supabase PITR or backups and a tested restore; the Worker can be redeployed from git; uploaded media storage (in NexBizRise) is not covered.

## 14. Observability

Nothing is implemented. The Worker logs nothing. `/health` returns a static `ok v2` without checking Supabase or the upstream. There are no metrics, alerts or audit trail.

Minimum before launch:
1. Enable `[observability] enabled = true` (Workers Logs).
2. Log structured JSON per request: route, status, latency, upstream status and a request ID. Never log PII.
3. Make `/health?deep=1` check Supabase and `LEGACY_ORIGIN`, and add an uptime monitor on it.
4. Alert on Worker error rate, 5xx from the upstream, Turnstile failure spikes and payment webhook failures.
5. Add an audit table for admin actions (approve, pause, mark paid) and edit-link saves.

## 15. Dependency management

- Dev dependency: `wrangler ^4.0.0` (resolved 4.146.0), with 0 vulnerabilities. MIT and Apache-2.0 licences.
- Runtime third parties:
  - React 18.3.1 and ReactDOM from unpkg, with SRI.
  - Babel standalone 7.29.0, with SRI.
  - Google Fonts.
  - Cloudflare Turnstile.
  - `api.qrserver.com` (to be removed, DEF-15).
  - Razorpay checkout.js, Stripe Checkout (hosted).
  - Supabase.
- `public/app/qrcode.js` (54 KB) is already in the repo, so the third-party QR service is unnecessary. Use it server-side, or render the QR client-side as the order app already does.
- **Licences:** confirm the licence of the vendored `qrcode.js` and of the `support.js` runtime ("dc-runtime"), and of the Caprasimo and Figtree fonts (OFL ✅).

## 16. Data protection

- **PII collected:** names, phones, e-mails, photos, lead messages and contact messages. There is no privacy policy (DEF-10), no retention period and no deletion or export process (relevant under GDPR, India DPDP Act 2023 and CCPA, given both IN and US pricing).
- The vendored card app calls `/cdn-cgi/trace` (visitor IP and country) and `/api/hit` (view and click analytics) with no consent notice.
- Lead data goes to the card owner. Define in the policy who the controller and processor are.
- In transit: HTTPS everywhere, but no HSTS (DEF-12). At rest: Supabase default encryption.
- Access: the service-role key gives the Worker full access (DEF-31); the anon `cards` policy exposes the `email` and `edit_token` columns (§6).
- Edit tokens are bearer secrets in URLs. They end up in browser history, `Referer` headers and logs. Store only a hash, add `Referrer-Policy: no-referrer` on `/e/*`, and support rotation.

## 17. Documentation

| Document | Status |
|---|---|
| `docs/ARCHITECTURE.md` | ✅ Accurate and useful |
| `docs/QA.md` | ✅ Good manual QA log for the rebrand |
| `public/app/README.md` | ✅ Clear vendoring rules, but it is publicly served (DEF-34) |
| `README.md` | ⚠️ Inaccurate (DEF-35), see below |
| API reference, operations runbook, incident response, rollback, troubleshooting, environment matrix, data migration plan | ❌ Missing |

`README.md` inaccuracies (DEF-35):
- It says "no build step", but there is a build script.
- It references `public/create/index.html` and `public/order.html`; the real file is `public/app/order.html`.
- It says `/health` returns `ok v1`; it returns `ok v2`.
- It lists `/pricing` as a static page; it is a redirect.
- The project summary's deploy command `npm run deploy--` has a typo.

## 18. Independent code review: notable findings

File-level notes behind the defect register:

- `src/config.js:10`: `APP` paths end in `.html`, so the assets binding 307s and `serveAsset` passes the redirect on to the browser (**DEF-00**). Fix: `{ order: '/app/order', card: '/app/card' }`. Also consider not passing `req` as the `RequestInit` in `src/http.js:5`.
- `src/index.js:9,35`: `isFile` runs before card routing, so `/sandeep.k` is served as a file (**DEF-01**). Check `validateHandle` first, or only treat known extensions as files.
- `public/assets/js/site.js:27`: `const h = clean(...)` is never used (**DEF-11**). Should be `location.href = orderHref() + (h ? (orderHref().includes('?') ? '&' : '?') + 'h=' + encodeURIComponent(h) : '')`. The order app must also read `h`.
- `public/assets/js/site.js:127` vs `:133`: temporal dead zone for `x` (**DEF-14**). Move `let x = 0, paused = false, last = …` above the chip block.
- `public/assets/js/site.js:192–194`: no `try/catch`, unconditional `r.json()`, no Turnstile reset (**DEF-29**).
- `src/routes/api.js:24–34`: check-then-insert, then N sequential inserts; no transaction (**DEF-04**). Move into a Postgres function (`create_order(payload)`) called by RPC, catch `23505` and return 409.
- `src/routes/api.js:47`: `req.formData()` throws on JSON (**DEF-06**).
- `src/routes/api.js:56–60`: third-party QR (**DEF-15**).
- `src/lib/handles.js:10`: `String(null)` is `"null"` (**DEF-22**). Use `String(raw ?? '')`.
- `src/lib/handles.js:23`: suggests `<name>.co`, which can't be routed because of DEF-01.
- `src/routes/cards.js:9`: `handle_history` lookup runs on every view, before the card lookup. Reverse the order (live card first, then history) to cut one round trip and stop history overriding a reclaimed handle (**DEF-05**).
- `src/routes/cards.js:21`: `parts[2+]` is ignored, so `/alex/anything` renders the card (**DEF-20**).
- `src/views/card-page.js:71,87`: `booking_url` and `compliance_html` sinks (**DEF-07, DEF-08**).
- `src/views/card-page.js:84`: lead form uses `env.TURNSTILE_SITE_KEY`, which is a placeholder.
- `src/lib/vcard.js:1`: escape `\r`; fold lines at 75 octets; add `PHOTO` (the parameter exists but no caller passes it) (**DEF-24, DEF-25**).
- `src/routes/proxy.js`: forwards cookies and `Host`; no timeout; `Location` rewrite is a plain string replace. Fine for now; add an allow-list of proxied path prefixes (`/api/`, `/admin`) instead of "everything unknown" (**DEF-09, DEF-13**).

## 19. UAT against the project scope

| # | Acceptance criterion | Result | Evidence |
|---|---|---|---|
| 1 | Customer opens their card at `linkcardly.com/<handle>` | ❌ | DEF-00 (demo card shown) |
| 2 | NFC or QR opens the card | ❌ | Depends on 1 |
| 3 | Save contact gives a valid vCard | ⚠️ Native only | `cards.test.js` |
| 4 | Share, QR, quick actions, socials on the card | ⚠️ Native view rendered; vendored untested | |
| 5 | `/create`, `/order`, `/pricing` reach the order flow | ✅ (URL becomes `/app/order`) | curl |
| 6 | Pick design, enter details, upload photo, live preview | Untested | needs unpkg and backend |
| 7 | Pay by Stripe or Razorpay | ❌ Incomplete | §8 |
| 8 | Handle availability with suggestions; reserved words blocked | ⚠️ | DEF-01, 05, 17, 22 |
| 9 | Lead form on cards (Turnstile) | ⚠️ Native form posts only | DEF-06 |
| 10 | Contact form (Turnstile) | ❌ | DEF-03 |
| 11 | Self-edit through private link | ❌ | DEF-00 |
| 12 | Admin: approve, pause, activate, payments, leads | Untested (NexBizRise) | |
| 13 | Marketing pages Home, Designs, Teams, Contact | ✅ (home has DEF-14) | Chromium |
| 14 | Pricing shows real prices | ⚠️ Order app has prices (IN ₹799/₹1,799, US $49/$79); not confirmed as final | `order.html:446` |
| 15 | Privacy, Terms, Refunds have real text | ❌ | DEF-10 |
| 16 | `card.nexbizrise.com/*` 301 to `linkcardly.com/*` | ❌ Not enabled; conflicts with proxy | DEF-13 |
| 17 | Old cards migrated with the same handles | ❌ Not started | DEF-27 |
| 18 | Organic design system on marketing pages | ✅ | visual check |
| 19 | Animations off under reduced motion | ✅ | Chromium |
| 20 | No NexBizRise branding visible | ⚠️ Marketing ✅; QA.md items A, B, C, F, G and H still open | `site.test.js`, QA.md |
| 21 | Responsive at phone width | ✅ | 375 px, no overflow |
| 22 | `/health` | ✅ | `routing.test.js` |

**6 pass** (5, 13, 18, 19, 21, 22), **6 partly pass** (3, 4, 8, 9, 14, 20), **8 fail** (1, 2, 7, 10, 11, 15, 16, 17) and **2 are untested** (6, 12).

## 20. Production readiness checklist

| Item | Ready? |
|---|---|
| Release blockers closed (DEF-00, 02, 03, 10, 13, 28) | ❌ |
| Security headers, XSS sinks, rate limits, least-privilege keys | ❌ |
| Automated tests in CI, required on `main` | ⚠️ Added, not yet required |
| Staging environment and smoke test after each deploy | ❌ |
| Monitoring, alerting, logs | ❌ |
| Database backups and tested restore | ❌ |
| Rollback runbook (Worker and database) | ❌ |
| Payment lifecycle proven in test mode (with webhooks) | ❌ |
| Legal pages and privacy notice | ❌ |
| Support procedures (who answers hello@, SLA, refund handling) | ❌ |
| Domain, e-mail authentication, Turnstile, Supabase allowed hosts | ❌ |
| Performance on a mid-range phone over 4G | Untested |

## 21. Defect register

Severity scale:
- **Blocker:** must be fixed before release.
- **High:** fix before release, or accept the risk in writing.
- **Medium:** fix soon after launch.
- **Low:** fix when convenient.

**Test** names the automated test that reproduces the defect (`todo` until fixed).

| ID | Sev. | Area | Defect | Workaround / fix | Test |
|---|---|---|---|---|---|
| DEF-00 | **Blocker** | Routing | Card links, `/c/` links, edit links and `/create` 307 to `/app/card` or `/app/order`; cards show the demo card and edit tokens are lost. **Affects the current proxy deployment** | Verified fix: `APP = { order: '/app/order', card: '/app/card' }` in `src/config.js` gives 200 in place for all four paths | routing ×2, e2e |
| DEF-02 | **Blocker** | Payment | Payment not implemented in this repo; native mode has none; proxy-mode backend not validated | §8 plan | api |
| DEF-03 | **Blocker** | Config | Placeholder Turnstile site key on `/contact` (and `TURNSTILE_SITE_KEY`, `SUPABASE_URL` vars) | Set real keys; read the site key from one config value | site |
| DEF-10 | **Blocker** | Legal | Privacy, Terms and Refunds are placeholders | Legal text before taking payment or leads | site |
| DEF-13 | **Blocker** | Infra / security | Cutover plan conflicts with proxy (`LEGACY_ORIGIN` = host to be redirected); proxy forwards every unknown path and all headers | Give NexBizRise its own hostname; allow-list proxied prefixes; keep `LEGACY_HOSTS` empty until native | routing |
| DEF-28 | **Blocker** (for native) | Architecture | Native mode lacks 8 endpoints the vendored app needs, plus `/e/`, `/c/`, admin, e-mails and payments; flipping `MODE` breaks ordering and editing | Keep proxy until parity; write a parity checklist and contract tests | api |
| DEF-01 | High | Routing | Valid handles with a dot (`sandeep.k`, suggested `alex.co`) 404 | Route handles before `isFile`, or drop dots from the handle rule (simpler, and matches the legacy rule) | routing |
| DEF-04 | High | Reliability | No error handling; check-then-insert race; non-atomic card and links insert; no idempotency | `try/catch` with JSON 4xx/5xx; single RPC transaction; map `23505` to 409 | api ×2, cards |
| DEF-07 | High | Security | `booking_url` allows `javascript:` | Allow only `https:` | cards |
| DEF-08 | High | Security | `compliance_html` rendered raw | Structured fields or allow-list sanitiser | cards |
| DEF-11 | High | Frontend | Claim form drops the typed handle | Pass `?h=` and read it in the order app | site, e2e |
| DEF-12 | High | Security | No security headers | Add CSP (allow Turnstile, fonts, unpkg, Stripe/Razorpay), HSTS, nosniff, Referrer-Policy, frame-ancestors | routing |
| DEF-14 | High | Frontend | Home page `ReferenceError` (TDZ `x`) breaks marquee and quotes | Declare `x` before first use | e2e |
| DEF-26 | High | Observability | No logs, metrics, alerts, deep health check or audit trail | §14 | — |
| DEF-27 | High | Data / migration | Legacy 40-hex edit tokens don't fit `uuid`; no migration script; no backups or restore plan | `text` with a hashed token; scripted, rehearsed migration | — |
| DEF-05 | Medium | API | `handle_history` ignored on availability; history lookup runs before the live card | Check both; look up the live card first | api |
| DEF-06 | Medium | API | `/api/lead` throws on JSON bodies (the vendored card app sends JSON) | Accept both content types | api |
| DEF-09 | Medium | Reliability | Proxy has no timeout or error handling | `AbortSignal.timeout`, 502 JSON | routing |
| DEF-15 | Medium | Security / privacy | `/api/qr` leaks URLs to a third party and encodes any data | Generate the QR in the Worker or client with the bundled `qrcode.js`; allow only `SITE_URL` URLs | api |
| DEF-16 | Medium | SEO | `/designs` etc. 307 to the trailing-slash URL while canonical and sitemap use no slash | Set `html_handling = "drop-trailing-slash"`, or use trailing slashes in canonical and sitemap | routing |
| DEF-17 | Medium | Consistency | Handle rules and reserved lists differ between server, site and app | One shared list; generate the browser copy at build time like `icons.js` | lib |
| DEF-21 | Medium | Business rule | `paid_until` never enforced; expired cards stay live | Filter `paid_until >= today`, or a scheduled job sets `expired` | cards |
| DEF-29 | Medium | Frontend | Contact form crashes on non-JSON error, no feedback, no Turnstile reset | `try/catch`; generic message; `turnstile.reset()` | e2e (observed) |
| DEF-30 | Medium | Security | No rate limiting | Cloudflare rate-limit rules on `/api/*` | — |
| DEF-31 | Medium | Security | Service-role key used for public reads | Anon key or a narrow view for reads | — |
| DEF-32 | Medium | Reliability | Vendored app loads React from unpkg at runtime | Self-host the pinned files under `/app/vendor/` (keep SRI) | e2e (observed) |
| DEF-33 | Medium | Data protection | No retention or deletion policy; analytics and IP lookup with no notice; anon policy exposes `email` and `edit_token` columns | Policy, retention job, `public_cards` view | — |
| DEF-38 | Medium | Accessibility | Skip link never visible; inputs use `outline:none` | `:focus` style for the skip link; visible focus ring | — |
| DEF-19 | Low | Consistency | Catalogue colourways `estate` and `hivis` are missing from `themes.js` (falls back to Folio) | Merge into one source | lib |
| DEF-20 | Low | Routing | `/alex/anything` renders the card | 404 for unknown sub-paths | cards |
| DEF-22 | Low | API | Missing `?h=` validates as the handle "null" | `String(raw ?? '')` | lib |
| DEF-24 | Low | Security | vCard `\r` not escaped | Escape or strip CR | lib |
| DEF-25 | Low | Interop | vCard lines not folded; photo never embedded | Fold at 75 octets; pass the photo | lib |
| DEF-34 | Low | Security | `app/README.md` and legacy images are public | `.assetsignore`; delete legacy images | — |
| DEF-35 | Low | Docs | README paths, version and "no build step" are wrong | Update | — |
| DEF-36 | Low | Testing | `npm test` pointed at a missing folder | **Fixed in this pass** | — |
| DEF-37 | Low | DevOps | No CI | **Workflow added in this pass**; make it a required check | — |
| DEF-39 | Low | Reliability | Turnstile call has no timeout; throws on non-JSON | Timeout and fail closed | — |

Also open from `docs/QA.md`: items A–K (server-side `NBR-` and `nbr_` prefixes, NexBizRise e-mail sender, payment-provider branding, per-card OG previews, CORS and host allow-lists, teal accent in the order flow, sample portrait, legacy images, placeholder legal text, no team ordering).

## 22. Final acceptance statement

| Category | Items |
|---|---|
| **Complete and verified** | Marketing site build, page structure, SEO metadata and sitemap; responsive layout; reduced motion; host redirects (`www`, legacy-host logic); `/order` and `/pricing` aliases; health endpoint; native handle validation and DB constraint parity; native card rendering with escaping; native vCard; Turnstile gating and input capping on native forms; dependency hygiene |
| **Incomplete** | Payment (all modes); native mode parity (DEF-28); admin; self-edit; order e-mails; QR generator; design families, seasonal themes and compliance blocks in native; data migration; legal content; production configuration |
| **Untested** (needs systems outside this repo) | The NexBizRise backend: order, upload, payment, edit, admin, e-mail, its RLS and RPCs; the vendored order and card app end to end; Safari, iOS and Firefox; production performance; Supabase at volume |
| **Risky** | Proxy forwards everything to a legacy system whose security posture is unknown; edit links are bearer tokens in URLs; service-role key everywhere; no observability means failures in production go unseen |
| **Not production-ready** | The release as a whole. Blockers DEF-00, 02, 03, 10, 13 and 28 must be closed and the High items fixed or formally risk-accepted. Then re-run this report, with every `todo` test converted to a passing regression test and payment proven end to end in test mode |

### Recommended order of work
1. **Today, if proxy mode is already deployed:** DEF-00, a one-line, verified fix. Then DEF-14, DEF-11 and DEF-03.
2. **Before taking real orders:** DEF-10, DEF-12, payment lifecycle evidence from the NexBizRise backend (§8), DEF-13 hostname split, observability (DEF-26), staging and rollback.
3. **Before native mode:** DEF-28 parity plan, DEF-04/06/07/08/27/31, migration rehearsal, then turn on legacy redirects.
