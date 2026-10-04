# Linkcardly infrastructure

What Linkcardly runs on, how each piece was set up, and how to check it. Written while moving off the NexBizRise
setup (October 2026). **No secret values are in this file or anywhere in the repo**: secrets live in the password
manager vault "Linkcardly" and, where the code needs them, as encrypted secrets on the Cloudflare Worker.

## At a glance

| Service | What it does for Linkcardly | Name / address | Login |
|---|---|---|---|
| Cloudflare Worker | Serves linkcardly.com: pages, card pages, `/api/*`, daily job | Worker `linkcardly` (production, proxy mode), `linkcardly-staging` (native mode; see "Staging") | Cloudflare account "Linkcardly" (`56bb7259aae8956fc8e82826ee95e7cb`) |
| Cloudflare DNS | `linkcardly.com`, `www`, `img`, `img-staging`, email records | Zone `linkcardly.com` | same |
| Cloudflare Email Routing | Receives `hello@linkcardly.com`, forwards to the owner's Gmail | Rule `hello@` → Gmail | same |
| Cloudflare R2 | Card photos and videos; database backups | `linkcardly-photos` → `img.linkcardly.com`; `linkcardly-photos-staging` → `img-staging.linkcardly.com`; `linkcardly-backups` (private, see "Backups") | same |
| Cloudflare Turnstile | Bot check on the order and lead forms | Widgets `Linkcardly` (linkcardly.com and subdomains), `Linkcardly staging` | same |
| Cloudflare Analytics Engine | Card visit and tap counts | Datasets `linkcardly_stats`, `linkcardly_stats_staging` (created on first write) | same |
| Supabase | Database: cards, orders, coupons, leads, partners, admin login | `linkcardly-prod`, `linkcardly-staging` (Mumbai) | `hello@linkcardly.com`, org "Linkcardly" |
| Resend | Sends order and edit-link emails from `hello@linkcardly.com` | Domain `linkcardly.com` (verified 2026-10-03, us-east-1) | `hello@linkcardly.com` |
| Razorpay | India payments | In progress | — |
| GitHub | Code; every merge to `main` deploys production (Workers Builds); CI deploys staging; nightly backup | `yourlocalwebsitedev/linkcardly` | — |

Mode today: production **proxy**, staging **native**. linkcardly.com serves its own pages but still forwards `/api/*`
(ordering, uploads, edits, payments) to the old NexBizRise worker. The native API (the same routes, in this Worker,
on Linkcardly's own services) is built and tested; it runs on staging first, then production at cutover. The daily
job already runs in production (it keeps the new database active). See "Still to do".

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
| `SUPABASE_SERVICE_KEY` | Supabase linkcardly-prod → Project Settings → API Keys → secret key | **Not used by the code any more** (2026-10-03: the health check now uses the publishable key). Safe to delete from the Worker; keep the key itself in the vault |
| `WORKER_SECRET` | `select value from public.app_secrets where key = 'worker'` in linkcardly-prod | Proves a request came from the Worker (rate limits, marking orders paid) |
| `CRON_KEY` | `select value from public.app_secrets where key = 'cron'` in linkcardly-prod | Renewal reminder job |
| `TURNSTILE_SECRET` | Turnstile → `Linkcardly` widget → secret key | Server-side bot check |
| `CF_ANALYTICS_TOKEN` | Account API token `linkcardly-analytics-read` (Account Analytics: Read only) | Reading visit counts for the admin page |
| `RESEND_API_KEY` | Resend → API Keys → `linkcardly-prod` (Sending access, linkcardly.com only) | Sending emails |

  Later: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` (and `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET` if US payments are added). Each payment provider stays off until its keys are set.
- Variables added with the native API (in `wrangler.toml`): `ADMIN_EMAIL` (`hello@linkcardly.com`), `MAIL_FROM`,
  `STATS_DATASET`.
- Daily job: `[triggers] crons = ["30 3 * * *"]` (09:00 India), visible under Settings → Trigger events. Sends
  renewal reminders and keeps the Supabase Free project active (its query counts as activity). Needs `CRON_KEY`;
  if it's missing the log says `{"t":"cron", "skipped": ...}`. Check: Workers & Pages → linkcardly → Logs, filter
  `cron`, the morning after a deploy.
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
8. Checked with `supabase/live/verify.sql` (16 lines then, all PASS; 17 since the native API; first line `'on'` for staging, `'off'` for prod), and
   that the four secrets differ between projects without showing them:
   `select key, left(md5(value), 8) as fingerprint from public.app_secrets order by key;`
   (2026-10-03: prod `efaf23ab`/`3a56a25f`, staging `50123d01`/`70a0cefc`.)

Photos are not stored in Supabase Storage; they go to R2.

## Resend

Domain `linkcardly.com`, region North Virginia (us-east-1), verified 2026-10-03 with Cloudflare auto-configure:
DKIM `TXT resend._domainkey`, sending `CNAME send` and `CNAME rsend` (DNS only), DMARC `TXT _dmarc`
(`v=DMARC1; p=none; rua=mailto:hello@linkcardly.com`; move to `p=quarantine` after two clean weeks). API keys
`linkcardly-prod` and `linkcardly-staging`, both Sending access for linkcardly.com only.

## Native API

What moves from the old NexBizRise worker into this Worker at cutover (`src/routes/native.js`; full table in
`docs/ARCHITECTURE.md`): card data (edge-cached 5 minutes, purged on edit), visit counts, photo upload to R2, order
(Turnstile, database prices it, emails), edit link saves, the card contact form (emails the owner), the website
contact form, Razorpay/Stripe checkout and webhooks (paid, full refund, failed), admin stats, and the daily job.
The browser reads this environment's settings from `/app/config.js` (Supabase URL, publishable key, Turnstile site
key), so no page has them hard-coded and the pages' security policy allows only that one database.

Database changes that came with it (`supabase/live/`, run on both projects, see "Database updates"):
`media_url_ok` (only `img.linkcardly.com` / `img-staging.linkcardly.com` photos are stored), `mark_order_refunded`,
and a contact form without a required phone number.

### Database updates (run once on each project)
The native API needs the latest `ALL-IN-ONE.sql` and `linkcardly.sql`. Both are safe to run again.
1. Supabase → **linkcardly-staging** → SQL Editor → New query.
2. Paste all of `supabase/live/ALL-IN-ONE.sql` → Run. Expected: "Success. No rows returned".
3. New query → paste all of `supabase/live/linkcardly.sql` → Run. Same result.
4. New query → paste `supabase/live/verify.sql` → Run. Expected: every line PASS, including the new line 17
   (`2/true`). Line 05 expects `on`; on production change `'on'` to `'off'` in the first line before running.
5. Repeat 1–4 on **linkcardly-prod**.

## Staging

Worker `linkcardly-staging` at `https://linkcardly-staging.yourlocalwebsitedev.workers.dev`, native mode, with the
staging database, `linkcardly-photos-staging`, the `Linkcardly staging` Turnstile widget and its own secrets.
It is deployed by GitHub Actions (CI), so no command line is needed.

**1. Let GitHub deploy to Cloudflare (once).**
1. Cloudflare → Manage account → Account API Tokens → **Create Token** → template **Edit Cloudflare Workers** → Use
   template.
2. Account Resources: Include → Linkcardly. Zone Resources: Include → All zones from an account → Linkcardly.
   Client IP filtering: leave empty. TTL: leave empty. → Continue to summary → **Create Token** → copy it (shown once;
   also into the vault as "GitHub deploy token").
3. GitHub → `yourlocalwebsitedev/linkcardly` → Settings → Secrets and variables → Actions → **Secrets** tab →
   New repository secret:
   - Name `CLOUDFLARE_API_TOKEN`, value: the token.
   - Name `CLOUDFLARE_ACCOUNT_ID`, value `56bb7259aae8956fc8e82826ee95e7cb`.
4. Same page → **Variables** tab → New repository variable: Name `STAGING_URL`, value
   `https://linkcardly-staging.yourlocalwebsitedev.workers.dev`.

**2. Deploy.** GitHub → Actions → **CI** → Run workflow → Branch: the branch to test (e.g. `claude/native-api`, or
`main`) → tick **staging** → Run workflow. Expected: `test` and `staging` jobs green (about 3 minutes). The first run
creates the Worker; the "Smoke check" step fails until step 3 is done (that's expected the first time). After that,
every merge to `main` deploys staging too.

**3. Staging secrets (once).** Cloudflare → Workers & Pages → **linkcardly-staging** → Settings → Variables and
Secrets → **+ Add** → Type **Secret** for each (values from the staging services, never production's):

| Secret | Value |
|---|---|
| `WORKER_SECRET` | linkcardly-staging SQL Editor: `select value from public.app_secrets where key = 'worker';` |
| `CRON_KEY` | same, `where key = 'cron'` |
| `TURNSTILE_SECRET` | Turnstile → `Linkcardly staging` → Settings → secret key |
| `RESEND_API_KEY` | Resend → API Keys → `linkcardly-staging` (if you didn't save it: create a new one, Sending access, linkcardly.com) |
| `CF_ANALYTICS_TOKEN` | the same `linkcardly-analytics-read` token as production (read-only, account-wide) |

Then Deploy (or re-run the CI workflow) so the Worker picks them up.

**4. Check.** In a browser:
- `https://linkcardly-staging.yourlocalwebsitedev.workers.dev/health?deep=1` → `"ok":true`, `"mode":"native"`, and
  `supabase`, `worker_secret`, `turnstile_secret` all `"ok":true`.
- `.../app/config.js` → `"native":true`, `"supabaseUrl":"https://ctzoyorugnybzvkoyvwj.supabase.co"`,
  `"turnstileSiteKey":"0x4AAAAAAFNHwEXiZ92pCaRo"`.
- Supabase linkcardly-staging → Authentication → URL Configuration → Site URL: the staging address (for the admin
  login on staging).

**5. Test by hand on staging** (a phone and a laptop):
1. `/create`: order a card with a photo and your own email. Expected: the done screen with link, QR and edit link
   (staging's database is in test mode, so it's marked paid); an email "Your Linkcardly card is live" from
   `Linkcardly staging <hello@linkcardly.com>`; a "Test order (no payment)" email to hello@.
2. Open the card link: photo shows from `img-staging.linkcardly.com`. SQL Editor:
   `select slug, photo_url, active from cards order by created_at desc limit 1;` → your slug, a
   `https://img-staging.linkcardly.com/p/....` address, `true`.
3. Open the edit link from the email, change the job title, save. Reload the card within a minute: the new title shows
   (the cache is purged on save).
4. On the card, use its contact form (if the design has one): the card's email gets "New lead from your card".
5. `/contact`: the security check appears; send a message. hello@ gets "Website enquiry".
6. Workers & Pages → linkcardly-staging → Logs: no `"t":"error"` or `"t":"db"` lines.
7. Optional, from a computer with Node and Playwright:
   `STAGING=1 BASE=https://linkcardly-staging.yourlocalwebsitedev.workers.dev node test/e2e/production.mjs`.

## Backups

Supabase Free has no backups, so `.github/workflows/backup.yml` dumps the production database every night at 02:30
India (roles, schema, data) and stores it as `prod/<date>.tar.gz` in the private R2 bucket `linkcardly-backups`.
A lifecycle rule deletes files after 14 days. A failed run shows red in Actions and GitHub emails you.

**Set up (once).**
1. Cloudflare → R2 → **Create bucket** → name `linkcardly-backups`, Location Automatic, Standard → Create. Leave
   Public Development URL off and don't connect a domain.
2. The bucket → Settings → **Object lifecycle rules** → Add rule → name `delete after 14 days`, applies to all
   objects (no prefix), action **Delete objects** after **14** days → Save.
3. R2 overview → **API** (top right) → Manage API tokens → **Create Account API token** → name
   `linkcardly-backups-write`, Permissions **Object Read & Write**, Specify bucket(s) → `linkcardly-backups` only,
   TTL Forever → Create. Copy the **Access Key ID** and **Secret Access Key** (shown once; into the vault).
4. Supabase → linkcardly-prod → **Connect** (top bar) → Connection String → Type URI, Method **Session pooler**
   (GitHub can't reach the direct IPv6 address) → copy it. Replace `[YOUR-PASSWORD]` with the database password. If
   you don't have it: Project Settings → Database → **Reset database password** (nothing in the Worker uses it).
5. GitHub → Settings → Secrets and variables → Actions → Secrets → New repository secret, three times:
   `SUPABASE_PROD_DB_URL` (the full URI with the password), `R2_BACKUP_ACCESS_KEY_ID`, `R2_BACKUP_SECRET_ACCESS_KEY`.
6. After the workflow is on `main`: Actions → **Database backup** → Run workflow → main. Expected: green in about two
   minutes, and the summary says `Uploaded prod/<today>.tar.gz (...)`. R2 → linkcardly-backups → `prod/` shows it.

Until the three secrets exist the nightly run fails on purpose ("Missing repository secret"): a backup that silently
does nothing is worse.

**Restore** (into a new, empty Supabase project, never over production):
1. R2 → linkcardly-backups → `prod/` → the date you want → Download. Unpack it: `tar -xzf <date>.tar.gz` gives
   `roles.sql`, `schema.sql`, `data.sql`.
2. New Supabase project → Connect → Session pooler URI (with its password).
3. With `psql` installed:
   ```bash
   psql --single-transaction --variable ON_ERROR_STOP=1 --file roles.sql --file schema.sql \
     --command 'SET session_replication_role = replica' --file data.sql --dbname "<new project URI>"
   ```
4. Run `supabase/live/verify.sql` there; then point `SUPABASE_URL` / `SUPABASE_ANON_KEY` in `wrangler.toml` and the
   secrets at the new project.

## GitHub and deploys

Changes go in through pull requests; merging to `main` makes Workers Builds deploy production within about two
minutes (Workers & Pages → linkcardly → Deployments), and CI deploys staging once its secrets exist ("Staging"). Pull requests get preview builds (`[previews]` in
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

1. **Database updates** on staging and production (section above).
2. **Staging** (section above), then the hand tests on it.
3. **Backups** set up and one manual run green (section above).
4. **Razorpay** (owner's PAN, Aadhaar and Indian bank account; KYC), test keys and webhook on staging, then live keys.
   Then turn `PAYMENTS_ON` on in `public/app/order.html` and run the payment tests (deferred until then).
5. **Before go-live**: privacy and terms pages updated (business name, Supabase, Resend, Razorpay), HSTS on.
6. **Cutover**: production `MODE = "native"` in `wrangler.toml` (merge → deploy), then on linkcardly.com: order,
   edit, contact form, emails, `/health?deep=1`. Rollback = `MODE = "proxy"` again. After 30 quiet days, retire
   NexBizRise (section above).
7. Optional: delete `SUPABASE_SERVICE_KEY` from the production Worker (unused).

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
| 2026-10-03 | Native API built (all `/api/*` routes, emails, payments, daily job); `/app/config.js`; staging set to native; nightly backup workflow; database updates `media_url_ok`, `mark_order_refunded`, contact form phone optional |
