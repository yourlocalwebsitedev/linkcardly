# Linkcardly: SDLC validation report

| | |
|---|---|
| Date | 2 Oct 2026 |
| Revision | 2. Covers remediation. Revision 1 assessed commit `1c0aff8`; this revision assesses the working tree after the fixes listed in §2 |
| Scope | Repository `yourlocalwebsitedev/linkcardly`, in proxy mode (live) and native mode (planned) |
| Method | Full code review; automated unit, integration and database tests; the Worker run in `wrangler dev` (workerd, Wrangler 4.146); headless Chromium at 375 px and 1366 px; local load test; `npm audit`; `wrangler deploy --dry-run` |
| Out of reach | The NexBizRise worker and its Supabase project, which handle every `/api/*` call, payment, upload, admin action, e-mail and edit in proxy mode. Stripe, Razorpay, Cloudflare and Supabase dashboards. Safari, iOS and Firefox. Production traffic. Anything that depends on these is marked **Untested** |

## 1. Verdict

**Still not production-ready, but the live proxy deployment is now safe to ship to linkcardly.com once the manual setup in §6 is done.**

Of the 38 defects in revision 1, this pass fixed 28 in full and 6 in part; 4 remain open (DEF-02, 10, 28, 32). All of the following are fixed and verified in the real runtime:
- the defects that broke the live site: card links, edit links, the home page crash, the claim form and the contact form key;
- every defect in this repo's Worker code (error handling, XSS sinks, security headers, rate limiting, logging, QR, routing, vCard);
- the database schema problems found in review.

What still blocks a full production release:

| Blocker | Why it can't be fixed in this repo |
|---|---|
| **DEF-02 Payment** | Not implemented here. Proxy mode depends on the NexBizRise backend, which isn't in this repo and has not been validated. Native mode has no payment path |
| **DEF-10 Legal pages** | Privacy, Terms and Refunds are still placeholders. The text needs business and legal sign-off |
| **DEF-28 Native parity** | Switching `MODE = "native"` would break ordering, edit links and payments. A blocker for native mode only; keep proxy mode until it's done |

### Scorecard

| # | Area | Rev. 1 | Now | Remaining |
|---|---|---|---|---|
| 1 | Functional completeness | ❌ | ⚠️ | Payment, admin, self-edit, e-mails and migration live in NexBizRise or aren't built |
| 2 | Implementation quality | ⚠️ | ✅ | Minor duplication (catalogue and themes, now test-guarded) |
| 3 | Architecture | ⚠️ | ⚠️ | Native mode not at parity (DEF-28) |
| 4 | API / backend | ❌ | ⚠️ | Native API hardened. No auth model yet for admin or edit, which don't exist natively |
| 5 | Frontend / UI | ⚠️ | ✅ | Order app ignores the claimed handle (DEF-11b); cross-browser untested |
| 6 | Database | ⚠️ | ⚠️ | Schema hardened and tested. Backups, PITR and data migration still open |
| 7 | Security | ❌ | ⚠️ | No CSP on the vendored app; tokens stored in plaintext; NexBizRise backend not reviewed |
| 8 | Payment | ❌ | ❌ **Incomplete** | §8 |
| 9 | Testing | ⚠️ | ✅ | 93 tests (90 pass, 3 known gaps). Missing: payment E2E, cross-browser, real-backend contract tests |
| 10 | Performance | ✅ | ✅ | Real-device LCP for the vendored app untested |
| 11 | Reliability | ❌ | ✅ | unpkg runtime dependency (DEF-32) |
| 12 | DevOps / CI-CD | ⚠️ | ⚠️ | No staging environment, branch protection or CI-driven deploy |
| 13 | Infrastructure | ❌ | ⚠️ | Manual DNS, Turnstile and e-mail setup; disaster recovery |
| 14 | Observability | ❌ | ⚠️ | Logs and health checks done; alerts and admin audit trail open |
| 15 | Dependencies | ✅ | ✅ | — |
| 16 | Data protection | ❌ | ⚠️ | Privacy notice (DEF-10); schedule the retention job |
| 17 | Documentation | ⚠️ | ✅ | Incident runbook and data-migration plan |
| 19 | UAT | ❌ | ⚠️ | 6 of 22 pass, 10 partly pass, 4 fail, 2 untested (§9) |
| 20 | Production readiness | ❌ | ❌ | §10 |

---

## 2. What was fixed in this pass

Every fix has an automated regression test (the test that reproduced the defect as `todo` in revision 1 now passes), except where it says *browser*.

| ID | Was | Fix | Verified by |
|---|---|---|---|
| DEF-00 | Card links, `/c/` links, edit links and `/create` 307'd to `/app/*`; every card showed the demo card and edit tokens were lost | Asset paths without `.html`; `serveAsset` uses a fresh request so the binding follows its own redirects | routing test; curl (200 in place); browser (path kept for all three link types) |
| DEF-01 | Valid handles with a dot (`sandeep.k`, suggested `alex.co`) 404'd | Only real file extensions route as files; handles ending in a file extension are reserved | routing, lib |
| DEF-03 | Contact form had `YOUR_TURNSTILE_SITE_KEY` | Real key (the NexBizRise widget the order app already uses) set once in `site/site.config.js` and `wrangler.toml` and injected at build | site test |
| DEF-04 | No error handling; duplicate-handle race gave a 500; card and links inserts weren't atomic | Global error boundary (JSON 500/503 on `/api`, error page elsewhere, logged); `DbError` with timeouts; unique violation gives 409; all links inserted in one request, with the card removed if that fails | api ×3, cards |
| DEF-05 | Former handles offered as available; history lookup shadowed reclaimed handles | Availability checks `cards` and `handle_history`; card lookup tries the live card first | api, cards |
| DEF-06 | `/api/lead` threw on JSON | Accepts JSON or form; stores e-mail; requires `lead_form` on, a live and unexpired card, and some contact detail | api ×3 |
| DEF-07 | `booking_url` allowed `javascript:` | `safeUrl()` on booking, avatar, cover and video URLs; `cover_focus` validated | cards |
| DEF-08 | `compliance_html` rendered raw | Allow-list sanitiser (`src/lib/sanitize.js`) | cards, lib |
| DEF-09 | Proxy had no timeout or error handling | 60 s timeout; JSON 502 with `message` (the vendored app reads it); logged | routing |
| DEF-11a | Claim form dropped the typed handle | Passes `?h=` to `/create` | site; browser |
| DEF-12 | No security headers | HSTS, nosniff, Referrer-Policy, Permissions-Policy and X-Frame-Options on every response; CSP on pages this repo renders; `/e/*` gets `no-referrer` and `no-store` | routing ×2; browser (no CSP violations on any marketing page) |
| DEF-13 | Cutover instructions would break proxy mode | README cutover steps rewritten (give NexBizRise its own hostname first). Proxy itself is unchanged, see §4 | docs |
| DEF-14 | Home page `ReferenceError` broke the marquee and testimonials | Marquee state declared before use | site; browser (0 errors; carousel works) |
| DEF-15 | `/api/qr` sent any data to `api.qrserver.com` | SVG generated in the Worker from the vendored `qrcode.js` (built into `src/lib/qrcode.gen.js`); only `SITE_URL` URLs | api |
| DEF-16 | `/designs` 307'd to `/designs/`, against canonical and sitemap | `html_handling = "drop-trailing-slash"` | routing ×2, site |
| DEF-17 | Browser reserved list differed from the server's | Generated at build (`assets/js/rules.js`) from `src/lib/handles.js` | lib |
| DEF-19 | `estate` and `hivis` colourways missing on the server | Added to `themes.js` | lib |
| DEF-20 | `/alex/anything` rendered the card | 404 | cards |
| DEF-21 | `paid_until` never enforced | Worker filter, and the anon RLS policy in migration 0002 | cards, db |
| DEF-22 | Missing `?h=` validated as the handle "null" | `String(raw ?? '')` | lib, api |
| DEF-24, 25 | vCard CR injection; no line folding | CR and LF escaped; 75-octet folding that never splits a UTF-8 character | lib ×2 |
| DEF-26 (part) | No logging or health checks | `[observability]`; one JSON log line per request and error (edit tokens masked); `/health?deep=1` checks dependencies | routing ×3 |
| DEF-27 (part) | `edit_token uuid` couldn't hold legacy 40-hex tokens | Migration 0002: 40-hex text, unique, format check; existing rows converted | db |
| DEF-29 | Contact form crashed on a non-JSON error | try/catch, readable messages, button disabled while sending, Turnstile reset | browser |
| DEF-30 | No rate limiting | `RATE_LIMITER` binding: 30 requests per minute per IP and route on write routes and handle checks (not on card-view analytics) | routing |
| DEF-31 | Service-role key used for public reads | Public card reads use `SUPABASE_ANON_KEY` when set | cards |
| DEF-33 (part) | Anon could read `edit_token` and `email` via `select *`; no retention | Migration 0002: column grants, expiry-aware policy, `purge_old_messages()` (24 months) | db ×3 |
| DEF-34 | `app/README.md` and NexBizRise images were public | `public/.assetsignore`; legacy images deleted | site; curl (404) |
| DEF-35 | README inaccurate | README and ARCHITECTURE updated, with Testing and Operations sections (health, logs, rate limits, rollback) | — |
| DEF-36, 37 | `npm test` broken; no CI | Fixed; `.github/workflows/ci.yml` | — |
| DEF-38 | Skip link never visible; inputs had no focus ring | `.skip:focus`, `:focus-within` and `:focus-visible` styles | site |
| DEF-39 | Turnstile had no timeout and threw on non-JSON | 5 s timeout; fails closed | api |
| New | `wrangler dev` rebuild loop (found while testing this pass: the build rewrote `src/`, which dev watches) | Build writes only files whose content changed | manual: 1 build, then idle |

No file in `public/app/` (the vendored NexBizRise app) was changed.

## 3. Evidence

| Evidence | Result |
|---|---|
| `npm test` (builds, then 6 suites) | **93 tests: 90 pass, 0 fail, 3 todo.** The 3 `todo` tests reproduce DEF-02, DEF-10 and DEF-28 |
| `test/db.test.js` | Runs both migrations in an in-process Postgres (PGlite) with Supabase-style grants. Checks constraints, token conversion of existing rows, anon visibility (live and unexpired only), column grants, private-table RLS, retention and the `updated_at` trigger |
| Runtime (`wrangler dev`) | `/`, `/designs`, `/create`, `/alexmorgan`, `/c/nbr_ab12cd`, `/e/<token>` and `/sandeep.k` all 200 in place; `/designs/` 307 to `/designs`; `/app/README.md` 404; security headers present; edit tokens masked in logs |
| Browser (`test/e2e/smoke.mjs`) | 16 page loads: no JS errors and no horizontal overflow on any marketing page; card and edit links keep their path; claim keeps the handle; 0 animations under reduced motion; no CSP violations. `/create` only fails because this sandbox can't reach unpkg.com |
| Load (2,000 requests per route, 50 concurrent, local) | `/health` 619 req/s, p95 126 ms; `/` 444 req/s, p95 160 ms; `/designs` 494 req/s, p95 142 ms; CSS 392 req/s, p95 166 ms; **0 errors**. Same as before the fixes |
| `npm audit` | 0 vulnerabilities (dev dependencies: `wrangler`, `@electric-sql/pglite`) |
| `wrangler deploy --dry-run` | Bundles 83 KiB (22.5 KiB gzipped, including the QR generator); bindings: `RATE_LIMITER`, `ASSETS`, vars. Runs the build automatically |

---

## 4. Remaining defect register

Severity scale:
- **Blocker:** must be fixed before release.
- **High:** fix before release, or accept the risk in writing.
- **Medium:** fix soon after launch.
- **Low:** fix when convenient.

| ID | Sev. | Area | Open issue | Owner / next step |
|---|---|---|---|---|
| DEF-02 | **Blocker** | Payment | No payment lifecycle in this repo; proxy-mode payments (NexBizRise) unvalidated; client sends price and total | NexBizRise backend owner: produce the §8 evidence. Native: build orders, payments and webhooks |
| DEF-10 | **Blocker** | Legal / privacy | Privacy, Terms and Refunds say "Policy text goes here". The privacy notice must also cover card-view analytics (`/api/hit`, `/cdn-cgi/trace`) and lead data | Business and legal |
| DEF-28 | **Blocker (native only)** | Architecture | Native mode lacks `/api/card`, `/api/hit`, `/api/upload`, `/api/edit`, `/api/pay/*`, `/e/<token>`, `/c/<id>`, admin, e-mails and payments | Stay on proxy; build these behind the existing todo test |
| DEF-13 | High | Infra / security | Proxy forwards every unknown path (including NexBizRise admin) and all request headers, cookies included, to the legacy worker. Cutover must follow the new README steps | Decide whether `linkcardly.com/admin` should exist; if not, allow-list `/api/` only |
| DEF-27 | High | Data | No data-migration script or rehearsal; no backup, PITR or restore drill documented; edit tokens stored in plaintext | Write and rehearse the export→import of old cards; enable PITR; store `sha256(token)` |
| DEF-03b | High (manual) | Config | Turnstile key is in place, but `linkcardly.com` must be added to that widget's allowed hostnames. Proxy-mode `/api/contact` must exist on NexBizRise (not verifiable here) | Cloudflare dashboard; NexBizRise owner |
| DEF-26b | Medium | Observability | No alerts, dashboards or admin audit trail (admin is in NexBizRise) | Cloudflare Notifications on error rate; uptime monitor on `/health?deep=1`; audit table when admin is native |
| DEF-11b | Medium | Ordering | The order app ignores `?h=`: it builds the handle from first name and phone, so the claimed handle isn't honoured | Small documented change to `public/app/order.html`, or backend support for a requested handle |
| DEF-32 | Medium | Reliability | The vendored app loads React from unpkg.com at runtime (SRI-pinned). If unpkg is down, card and order pages are blank | Self-host the pinned files; needs a change in the generated `support.js` |
| DEF-33b | Medium | Data protection | `purge_old_messages()` exists but isn't scheduled; no data-subject export or deletion process | `pg_cron` schedule (in the migration comment); a documented DSAR process |
| DEF-40 | Medium | DevOps | No staging environment, branch protection or CI-driven deploy | `[env.staging]`; required CI check on `main`; deploy job with a scoped token |
| DEF-41 | Medium | Testing | No payment E2E, Safari/iOS or Firefox runs, contract tests for NexBizRise endpoints, or axe accessibility audit | QA |
| DEF-42 | Low | Security | No CSP on the vendored app and proxied pages (they need inline scripts, unpkg, Babel and the payment SDKs) | A report-only CSP first, then enforce |
| DEF-43 | Low | Routing | In proxy mode a dotted handle shows the demo card, because the vendored card app accepts only `a-z0-9-` slugs. No legacy slug contains a dot, and the order app can't create one | None needed until native mode |
| DEF-44 | Low | Frontend | Before React boots, `/create` shows raw `{{ … }}` templates and logs 6 invalid-SVG errors | Vendored app; cosmetic |
| DEF-45 | Low | Licensing | Confirm the licences of the vendored `qrcode.js` (believed to be Kazuhiko Arase's qrcode-generator, MIT) and the `support.js` runtime | Legal |

Also still open from `docs/QA.md`, all outside this repo:
- A: `NBR-` and `nbr_` IDs.
- B: NexBizRise e-mail sender.
- C: Stripe and Razorpay branding.
- D: per-card OG previews.
- E: CORS and host allow-lists on NexBizRise.
- F: teal accent in the order flow.
- G: sample portrait.
- K: no team ordering.

Items H, I and J are covered above or fixed.

## 5. Area notes (what remains, by area)

**Functional completeness.**
- Working in this repo: routing for all customer links, marketing site, claim, contact, native card, vCard, QR, lead capture and handle checks.
- Proxy-mode flows that need NexBizRise (order, upload, pay, edit, admin, e-mails) are routed correctly but untested end to end.

**API and backend.**
- Every native endpoint has validation, Turnstile (fail-closed), length caps, rate limits, timeouts and structured errors.
- Native `POST /api/order` still has no idempotency key; a retried submit gets "taken" (409). This should be addressed with DEF-02, when orders get their own table.

**Frontend.**
- Responsive at 375 px and 1366 px, reduced motion honoured, and visible focus on every control.
- Untested on Safari and iOS, which is where most NFC and QR taps happen. The card CSS uses `color-mix()`, which needs Safari 16.2 or later.

**Database.**
- Migration 0002 is verified in PGlite.
- Before production:
  - Run both migrations on a Supabase branch.
  - Enable PITR.
  - Schedule `purge_old_messages()`.
  - Rehearse the restore.

**Security.**
- Fixed: both XSS sinks closed, security headers in place, service key no longer needed for public reads, edit-link hygiene.
- Open: DEF-13 proxy surface, plaintext tokens, vendored-app CSP, and the unreviewed NexBizRise RLS and RPC grants (`place_order`, `update_card_by_token`, `get_card_for_edit`, `check_coupon`).

**Reliability.**
- All upstreams have timeouts: database 8 s, Turnstile 5 s, proxy 60 s, health 4 s.
- Failures degrade to clear errors and are logged.

**Observability.**
- Logs, a deep health check and masked secrets are in place.
- Still needed: alert rules and an uptime monitor.

**Documentation.**
- README now covers testing, operations (health, logs, errors, rate limits, rollback) and the safe cutover sequence.
- Still needed: an incident runbook and a data-migration plan.

## 6. Manual steps before go-live (proxy mode)

1. Cloudflare: attach `linkcardly.com` to the Worker. **Do not** attach `card.nexbizrise.com` yet (README "Cutover").
2. Turnstile widget `0x4AAAAAAFIAJl64rp47Hazn`: add `linkcardly.com` to its allowed hostnames.
3. NexBizRise worker and Supabase: allow `linkcardly.com` for CORS, the upload host and Supabase URLs (QA.md item E). Confirm `/api/contact` exists.
4. E-mail: `hello@linkcardly.com` with SPF, DKIM and DMARC.
5. Monitoring: uptime check on `https://linkcardly.com/health?deep=1`; Cloudflare notification on Worker error rate.
6. Publish legal pages (DEF-10).
7. Prove payments in test mode, then live with a small real order (DEF-02, §8).
8. Smoke-test on an iPhone and an Android phone: tap and scan a real card, save the contact, open an edit link.
9. Google Search Console: add the property; change of address only at native cutover.

## 7. Production readiness checklist

| Item | Ready? |
|---|---|
| Customer links (card, `/c/`, edit, create) work on linkcardly.com | ✅ (routing verified; data from NexBizRise untested) |
| Security headers, XSS sinks, rate limits, least-privilege reads | ✅ in this repo / ⚠️ vendored-app CSP, proxy surface |
| Automated tests in CI | ✅ added. ⚠️ not yet a required check |
| Error handling, timeouts, graceful errors | ✅ |
| Logs and health checks | ✅ / ⚠️ alerts not configured |
| Staging environment | ❌ |
| Rollback | ⚠️ Worker documented (`wrangler rollback`); database is forward-only, so back up first |
| Backups and tested restore | ❌ |
| Payment lifecycle proven | ❌ |
| Legal pages and privacy notice | ❌ |
| Support procedures (who answers hello@, SLA, refunds) | ❌ |
| Domain, e-mail authentication, Turnstile hostnames | ❌ manual (§6) |
| Real-device performance and cross-browser | Untested |

## 8. Payment (incomplete, blocker)

Unchanged from revision 1. Before release, provide documented test-mode evidence for every row:

| Stage | Must prove |
|---|---|
| Quote | Server recomputes price, GST (IN 18 %) and coupon from plan, region and code, and ignores the `price`, `tax` and `total` the browser sends |
| Create | One order per idempotency key (`idem`); order and card created atomically |
| Checkout | Stripe Checkout and Razorpay order created with the server amount and currency; customer-facing name is Linkcardly |
| Confirm | Signature-verified **webhooks** are the source of truth (`checkout.session.completed`, Razorpay `payment.captured`); `pay/verify` checks the Razorpay HMAC |
| Activate | Card goes live, `paid_until` is set, and e-mails are sent exactly once even if a webhook is retried |
| Failure paths | Abandoned checkout, decline, double submit, webhook before or after the redirect, duplicate webhook, network loss during `pay/status` polling |
| Money back | Refunds and disputes match the (unwritten) refund policy; renewal and expiry |
| Reconciliation | Daily provider-to-orders match; audit log of manual "mark paid" |
| Compliance | PCI SAQ-A (hosted checkout only), Indian tax invoices, statement descriptor |

## 9. UAT against the project scope

| # | Acceptance criterion | Rev. 1 | Now | Note |
|---|---|---|---|---|
| 1 | Card opens at `linkcardly.com/<handle>` | ❌ | ⚠️ | Routing fixed and verified; content render needs unpkg and NexBizRise |
| 2 | NFC or QR opens the card | ❌ | ⚠️ | Depends on 1; real-device test pending |
| 3 | Save contact gives a valid vCard | ⚠️ | ⚠️ | Native ✅ (RFC folding); proxy untested |
| 4 | Share, QR, quick actions, socials | ⚠️ | ⚠️ | Native ✅, QR now first-party; vendored untested |
| 5 | `/create`, `/order`, `/pricing` reach the order flow | ✅ | ✅ | `/create` now keeps its URL |
| 6 | Design, details, photo, live preview | — | Untested | Needs unpkg and NexBizRise |
| 7 | Pay by Stripe or Razorpay | ❌ | ❌ | DEF-02 |
| 8 | Handle availability, suggestions, reserved words | ⚠️ | ⚠️ | Native ✅; order app ignores the claimed handle (DEF-11b) |
| 9 | Lead form on cards | ⚠️ | ⚠️ | Native ✅ (form and JSON); proxy untested |
| 10 | Contact form | ❌ | ⚠️ | Key fixed; needs Turnstile hostname and NexBizRise `/api/contact` |
| 11 | Self-edit through private link | ❌ | ⚠️ | Link kept and hardened; edit flow untested |
| 12 | Admin | — | Untested | NexBizRise |
| 13 | Marketing pages | ✅ | ✅ | Home crash fixed |
| 14 | Real prices | ⚠️ | ⚠️ | Order app: ₹799/₹1,799 and $49/$79. Confirm they're final |
| 15 | Legal pages | ❌ | ❌ | DEF-10 |
| 16 | `card.nexbizrise.com` 301 to linkcardly.com | ❌ | ❌ | Deliberately off until native (README cutover) |
| 17 | Old cards migrated with the same handles | ❌ | ❌ | Schema ready (0002); script and rehearsal pending |
| 18 | Organic design system | ✅ | ✅ | |
| 19 | Animations off under reduced motion | ✅ | ✅ | |
| 20 | No NexBizRise branding | ⚠️ | ⚠️ | Marketing ✅; QA.md A–C and F–G open |
| 21 | Responsive at phone width | ✅ | ✅ | |
| 22 | `/health` | ✅ | ✅ | Plus `?deep=1` |

**Now:** 6 pass, 10 partly pass, 4 fail (7, 15, 16, 17) and 2 untested (6, 12).

## 10. Final acceptance statement

| Category | Items |
|---|---|
| **Complete and verified** | Worker routing for every customer link; marketing site; security headers; error handling, timeouts, rate limiting and logging; native API, card page, vCard and QR; schema and RLS (migration-tested); CI and test suite; docs |
| **Incomplete** | Payment (all modes); native-mode parity; admin; self-edit; e-mails; data migration; legal text; staging, backups and alerting |
| **Untested** (needs systems outside this repo) | The NexBizRise backend (order, upload, payment, edit, admin, e-mail, RLS and RPCs); the vendored app end to end; Safari, iOS and Firefox; production load |
| **Risky** | The proxy forwards everything to a backend whose security hasn't been reviewed (DEF-13); edit links are plaintext bearer tokens; the vendored app depends on unpkg at runtime |
| **Not production-ready** | Taking real orders or payments. **Acceptable now:** serving the marketing site and existing customer cards on linkcardly.com in proxy mode, once the §6 manual steps 1–3 and 5 are done |

### Recommended next steps
1. Do the §6 manual steps, then deploy proxy mode.
2. Payment evidence from the NexBizRise backend (§8) and legal pages (DEF-10). Together these unblock taking orders.
3. Staging, a required CI check, PITR, alerts (DEF-40, DEF-27, DEF-26b).
4. Native parity plan (DEF-28) and migration rehearsal before any cutover.
