# Linkcardly to-do

The one list of what's left before and after launch. Tick items (`[x]`) as they're done and add the date.
**Who:** *You* = needs the owner (accounts, money, legal decisions). *Code* = a change in this repo (ask Claude).
How-to details are in the linked docs; code-level debt is in `docs/ARCHITECTURE.md` under "Known debt".

## 1. Go live on Linkcardly's own setup

- [ ] **You:** Push the branches `claude/native-api` and `claude/admin` and open the pull requests (don't merge yet).
- [ ] **You:** Update both databases: run `supabase/live/ALL-IN-ONE.sql`, then `linkcardly.sql`, then `verify.sql`;
      every line should say PASS, with line 17 `3/true`. Do staging and production.
      ([INFRASTRUCTURE.md](INFRASTRUCTURE.md), "Database updates")
- [ ] **You:** Merge. Then check `linkcardly.com/health?deep=1` (`"mode":"native"`, all ok), place an order,
      edit it, send the contact form, check the emails, sign in at `linkcardly.com/admin` and try **Mark paid**.
- [ ] **You:** Staging: GitHub deploy token, CI "staging" run, staging Worker secrets, hand tests.
      ([INFRASTRUCTURE.md](INFRASTRUCTURE.md), "Staging")
- [ ] **You:** Backups: bucket `linkcardly-backups`, 14-day rule, R2 token, three GitHub secrets, one manual run green.
      ([INFRASTRUCTURE.md](INFRASTRUCTURE.md), "Backups")
- [ ] **You:** Optional: delete the unused `SUPABASE_SERVICE_KEY` secret from the production Worker.

## 2. Before taking real customers (legal and money)

- [ ] **Code:** Privacy policy matches what the site does. Today it says photos are in Supabase (they're in
      Cloudflare R2), doesn't name Resend for email, and promises that messages are "deleted automatically after
      24 months", which nothing does yet (see the automatic-deletion item below).
- [ ] **Code:** Add a "Cookies and browser storage" section to the privacy policy. Nothing to consent to today: no
      cookies of our own, no tracking. Only necessary browser storage (the order page, the admin login), Cloudflare's
      security check and Razorpay/Stripe on their own checkout. A cookie banner is only needed if analytics, pixels
      or ads are ever added.
- [ ] **You:** Legal pages signed off (privacy, terms, refunds) with the legal business name and address. Razorpay's
      website check usually also asks for a contact page with an address and sometimes a delivery policy for
      digital products.
- [ ] **You:** GST: the order page adds 18% GST. Charge it only if registered for GST; then every payment needs a
      tax invoice with the GSTIN. Decide with an accountant, then **Code:** invoices or receipts by email to match.
- [ ] **You:** Razorpay account (owner's PAN, Aadhaar, Indian bank account, KYC); test keys and webhook on staging,
      then live keys. Online payment turns on by itself once the keys are set.
- [ ] **Code:** Payment tests in the E2E suite once Razorpay test keys exist (all listed as "Not tested" now).
- [ ] **You:** Turn off international cards in Razorpay (a US buyer could otherwise pick India and pay the INR
      price), or **Code:** check the region on the server.

## 3. Safety and trust

- [ ] **Code:** "Report this card" link on every card + a simple takedown step in the admin page (cards are public
      and written by customers: impersonation, scams).
- [ ] **Code:** Automatic deletion in the daily job: messages after 24 months, unpaid orders and unused cards after
      a set time, as the privacy policy says.
- [ ] **You:** Decide how data requests are handled (copy, correction, deletion: who does what, within how many days)
      and what to do if data leaks. **Code:** admin buttons for "export" and "delete everything for this customer".
- [ ] **Code:** Self-host the two brand fonts (stops sending every visitor's IP address to Google; also faster).
- [ ] **Code:** Encrypt partner payout details (UPI, bank account, PAN) before the partner programme grows.

## 4. Running it

- [ ] **You:** Uptime monitor on `https://linkcardly.com/health?deep=1` that emails you when it fails (for example
      a free UptimeRobot check, or Cloudflare Health Checks).
- [ ] **Code:** Alert email when the Worker logs errors, payments fail or the daily job is skipped.
- [ ] **You:** Two-factor login on GitHub, Cloudflare (on), Supabase, Resend, Razorpay and the Gmail that receives
      hello@.
- [ ] **You:** Restore one backup into a scratch Supabase project once, to prove backups work.
      ([INFRASTRUCTURE.md](INFRASTRUCTURE.md), "Backups")
- [ ] **You:** After two clean weeks of email: DMARC to `p=quarantine`. ([INFRASTRUCTURE.md](INFRASTRUCTURE.md), "Resend")
- [ ] **You:** Google Search Console: add linkcardly.com, submit the sitemap.
- [ ] **You:** HSTS on in Cloudflare after the switch-over has been stable for a while.

## 5. Later

- [ ] **You:** After 30 quiet days on Linkcardly's own setup: retire NexBizRise (revoke its keys, back up and pause its
      database, delete its Pages project and bucket; keep the `card.nexbizrise.com` redirect while printed cards
      exist). **Code:** then remove proxy mode and `LEGACY_ORIGIN`. ([INFRASTRUCTURE.md](INFRASTRUCTURE.md),
      "The old NexBizRise setup")
- [ ] **You:** Handle the exposed `NBR_WORKER_SECRET` (or delete the NexBizRise project entirely).
- [ ] **Code:** Admin page in Linkcardly's look and comfortable on a phone (it keeps NexBizRise's style for now).
- [ ] **Code:** Order numbers start `LC-` instead of `NBR-`.
- [ ] **Code:** Global card-cache clearing after edits (needs a Cloudflare cache-purge token); today an edit can take
      up to 5 minutes to show in other regions.
- [ ] **You:** Supabase Pro (daily managed backups, no pausing) if the free plan becomes a worry.
