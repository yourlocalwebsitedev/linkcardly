# Linkcardly infrastructure

What Linkcardly runs on, how each piece was set up, and how to check it. Written while moving off the NexBizRise
setup (October 2026). **No secret values are in this file or anywhere in the repo**: secrets live in the password
manager vault "Linkcardly" and, where the code needs them, as encrypted secrets on the Cloudflare Worker.

## At a glance

| Service | What it does for Linkcardly | Name / address | Login |
|---|---|---|---|
| Cloudflare Worker | Serves linkcardly.com: pages, card pages, `/api/*` | Worker `linkcardly` (production), `linkcardly-staging` (to be created) | Cloudflare account "Linkcardly" (`56bb7259aae8956fc8e82826ee95e7cb`) |
| Cloudflare DNS | `linkcardly.com`, `www`, `img`, `img-staging`, email records | Zone `linkcardly.com` | same |
| Cloudflare Email Routing | Receives `hello@linkcardly.com`, forwards to the owner's Gmail | Rule `hello@` → Gmail | same |
| Cloudflare R2 | Card photos and videos | `linkcardly-photos` → `img.linkcardly.com`; `linkcardly-photos-staging` → `img-staging.linkcardly.com` | same |
| Cloudflare Turnstile | Bot check on the order and lead forms | Widgets `Linkcardly` (linkcardly.com and subdomains), `Linkcardly staging` | same |
| Cloudflare Analytics Engine | Card visit and tap counts | Datasets `linkcardly_stats`, `linkcardly_stats_staging` (created on first write) | same |
| Supabase | Database: cards, orders, coupons, leads, partners, admin login | `linkcardly-prod`, `linkcardly-staging` (Mumbai) | `hello@linkcardly.com`, org "Linkcardly" |
| Resend | Sends order and edit-link emails from `hello@linkcardly.com` | Domain `linkcardly.com` (verified 2026-10-03, us-east-1) | `hello@linkcardly.com` |
| Razorpay | India payments | In progress | — |
| GitHub | Code; every merge to `main` deploys production (Workers Builds) | `yourlocalwebsitedev/linkcardly` | — |

Mode today: **proxy**. linkcardly.com serves its own pages but still forwards `/api/*` (ordering, uploads, edits,
payments) to the old NexBizRise worker. Everything below is Linkcardly's own and is used once `MODE = "native"`
(cutover). See "Still to do".

## Cloudflare

**Account.** Renamed to Linkcardly; two-factor login on. Account ID `56bb7259aae8956fc8e82826ee95e7cb` (not secret;
`CF_ACCOUNT_ID` in `wrangler.toml`).

**Worker `linkcardly`.** Built and deployed by Workers Builds from `main`.
- Custom domains: `linkcardly.com` and `www.linkcardly.com` (Settings → Domains & Routes). `www` redirects to the
  bare domain in code (`src/index.js`).
- Variables come from `wrangler.toml` and are replaced on every deploy, so change them in code, not the dashboard.
- Secrets are set in the dashboard (Settings → Runtime variables and secrets → Add → Type **Secret**) and survive
  deploys. Production has:

| Secret | Value comes from | Used for |
|---|---|---|
| `SUPABASE_SERVICE_KEY` | Supabase linkcardly-prod → Project Settings → API Keys → secret key | Server-side database access |
| `WORKER_SECRET` | `select value from public.app_secrets where key = 'worker'` in linkcardly-prod | Proves a request came from the Worker (rate limits, marking orders paid) |
| `CRON_KEY` | `select value from public.app_secrets where key = 'cron'` in linkcardly-prod | Renewal reminder job |
| `TURNSTILE_SECRET` | Turnstile → `Linkcardly` widget → secret key | Server-side bot check |
| `CF_ANALYTICS_TOKEN` | Account API token `linkcardly-analytics-read` (Account Analytics: Read only) | Reading visit counts for the admin page |
| `RESEND_API_KEY` | Resend → API Keys → `linkcardly-prod` (Sending access, linkcardly.com only) | Sending emails |

  Later: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`.
- Bindings (from `wrangler.toml`): `PHOTOS` (R2 `linkcardly-photos`), `STATS` (Analytics Engine `linkcardly_stats`),
  `RATE_LIMITER` (30 requests/min per IP and route).

**SSL/TLS** (zone linkcardly.com → SSL/TLS → Edge Certificates): Always Use HTTPS on, Minimum TLS 1.2, Automatic
HTTPS Rewrites on. HSTS stays off until after cutover (hard to undo).

**Email Routing** (Email Service → Email Routing): enabled with Cloudflare's MX, SPF and DKIM records on the root
domain; destination = the owner's Gmail (verified); rule `hello@linkcardly.com` → that Gmail. Receive-only: sending
goes through Resend.

**R2.** Both buckets: location Automatic, Standard storage, Public Development URL (r2.dev) **disabled**, served only
through the custom domain. CORS policy (Settings → CORS Policy), production:

```json
[{ "AllowedOrigins": ["https://linkcardly.com", "https://www.linkcardly.com"],
   "AllowedMethods": ["GET", "HEAD"], "AllowedHeaders": ["*"], "MaxAgeSeconds": 86400 }]
```

Staging allows `https://linkcardly-staging.yourlocalwebsitedev.workers.dev`, `http://127.0.0.1:8787` and
`http://localhost:8787`. Cloudflare caches photos at its edge, so a deleted file can still show for a while; every
upload gets a new file name, so customers never see a stale photo. Check deletions with `?check=1` in a private window.

**Turnstile.** `Linkcardly`: site key `0x4AAAAAAFNHrxM63OpIlzd5`, hostname `linkcardly.com` (subdomains included),
Managed, no pre-clearance. `Linkcardly staging`: site key `0x4AAAAAAFNHwEXiZ92pCaRo`, hostname
`linkcardly-staging.yourlocalwebsitedev.workers.dev`. Site keys are public (`TURNSTILE_SITE_KEY`); secrets are in the vault.

**API tokens.**
- Account token `linkcardly-analytics-read`: Account Analytics Read, no expiry. Stored as `CF_ANALYTICS_TOKEN`.
- `linkcardly build token`: made by Workers Builds for deploys. Leave it.
- Account tokens start `cfat_`, personal ones `cfut_`; account tokens are under Manage account → Account API Tokens.

## Supabase

| | Production | Staging |
|---|---|---|
| Project | `linkcardly-prod` | `linkcardly-staging` |
| URL | `https://iqqxitntkcmrcvuqxxex.supabase.co` | `https://ctzoyorugnybzvkoyvwj.supabase.co` |
| Publishable key (public) | `sb_publishable_BB6t10anvceY7vy5VXkN6w_7-LGJXUC` | `sb_publishable_EYwRSCPgTjV7FX6WOrmzDg_PRbMTNSY` |
| Region | South Asia (Mumbai) | South Asia (Mumbai) |
| Plan | Free. Free pauses a project after 1 week with no activity and has no backups, so production gets a daily database job (keeps it active) and a nightly backup (GitHub Action, 14 days kept). Pro ($25/month, daily managed backups) is optional later. | Free |
| Test mode | **off** (never on in production) | on |

How both were built (2026-10-03), each step in the SQL Editor of that project:

1. Created with "Connect to GitHub" off and "Enable automatic RLS" off.
2. Ran `linkcardly-setup.sql`: `supabase/live/0-base.sql` + `ALL-IN-ONE.sql` + `linkcardly.sql` in one file (rebuild
   it with `cat supabase/live/0-base.sql supabase/live/ALL-IN-ONE.sql supabase/live/linkcardly.sql`).
3. Generated the two database secrets in the database itself (64 random hex characters each):
   ```sql
   insert into public.app_secrets values
     ('worker', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
     ('cron',   replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
   on conflict (key) do nothing;
   ```
4. Staging only: `insert into public.app_flags (key) values ('test_mode') on conflict do nothing;`
5. Admin login: Authentication → Users → Add user (Auto Confirm), then
   `insert into public.admins (user_id) select id from auth.users where email = '<email>' on conflict do nothing;`
6. Authentication → Sign In / Providers → "Allow new users to sign up" **off**.
7. Production: Authentication → URL Configuration → Site URL `https://linkcardly.com`.
8. Checked with `supabase/live/verify.sql` (16 lines, all PASS; first line `'on'` for staging, `'off'` for prod), and
   that the four secrets differ between projects without showing them:
   `select key, left(md5(value), 8) as fingerprint from public.app_secrets order by key;`
   (2026-10-03: prod `efaf23ab`/`3a56a25f`, staging `50123d01`/`70a0cefc`.)

Photos are not stored in Supabase Storage; they go to R2.

## Resend

Domain `linkcardly.com`, region North Virginia (us-east-1), verified 2026-10-03 with Cloudflare auto-configure:
DKIM `TXT resend._domainkey`, sending `CNAME send` and `CNAME rsend` (DNS only), DMARC `TXT _dmarc`
(`v=DMARC1; p=none; rua=mailto:hello@linkcardly.com`; move to `p=quarantine` after two clean weeks). API keys
`linkcardly-prod` and `linkcardly-staging`, both Sending access for linkcardly.com only.

## GitHub and deploys

Changes go in through pull requests; merging to `main` makes Workers Builds deploy production within about two
minutes (Workers & Pages → linkcardly → Deployments). Pull requests get preview builds (`[previews]` in
`wrangler.toml`, staging database settings). Protect `main` (Settings → Rules → Rulesets: require a pull request,
block force pushes).

## The old NexBizRise setup

Still running and still doing linkcardly.com's ordering until cutover: Cloudflare Pages project `nexbizrise`
(`card.nexbizrise.com`), Supabase project "Digital Card" (`hyaqvmrtqafqhbhcdecd`), R2 `img.nexbizrise.com`.

- Its `CF_API_TOKEN` (account token `nbr-analytics-read`) was rolled on 2026-10-03 after being exposed, and stored as
  a Secret. Its `NBR_WORKER_SECRET` was also exposed. Decision (2026-10-03): handle later; the project may be deleted
  entirely and replaced with a new domain.
- All its data is test data; nothing moves to the new databases.
- After cutover plus 30 quiet days: revoke its keys, back up and pause the old database, delete the Pages project and
  bucket. Keep the `nexbizrise.com` domain and the `card.nexbizrise.com` redirect while printed cards may exist.

## Still to do

1. **Razorpay** (owner's PAN, Aadhaar and Indian bank account; KYC), test keys and webhook on staging, then live keys.
2. **Move the API into this Worker** (`MODE = "native"`): order, edit, upload, card read, visit counts, lead form,
   payments and webhooks, emails, renewal reminders, admin page.
3. **Staging Worker**: `npx wrangler deploy --env staging`, then its secrets (staging values of the six above).
4. **Run the production E2E suite on staging**: `STAGING=1 BASE=https://linkcardly-staging.yourlocalwebsitedev.workers.dev node test/e2e/production.mjs`.
5. **Before go-live**: daily database job and nightly backup running, privacy and terms pages updated (business name, Supabase, Resend), HSTS on.
6. **Cutover**: `MODE = "native"`, remove `LEGACY_ORIGIN`; rollback = set `MODE = "proxy"` again.

The step-by-step plan is the doc "Linkcardly: move off NexBizRise".

## Change log

| Date | Change |
|---|---|
| 2026-10-03 | linkcardly.com and www connected to the Worker; hello@ forwarding; SSL settings |
| 2026-10-03 | Supabase linkcardly-prod and linkcardly-staging built from `supabase/live/`, checked 16/16 |
| 2026-10-03 | R2 buckets with img and img-staging domains; Turnstile widgets; analytics token |
| 2026-10-03 | Production Worker secrets (6) and `wrangler.toml` settings (PR #7) |
| 2026-10-03 | Resend domain verified; API keys made |
| 2026-10-03 | Old NexBizRise analytics token rolled after exposure |
