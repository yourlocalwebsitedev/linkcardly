# Live database (Supabase)

The database schema for linkcardly.com. It started in the NexBizRise project (`hyaqvmrtqafqhbhcdecd`); Linkcardly now has its own projects, `linkcardly-prod` (`iqqxitntkcmrcvuqxxex`) and `linkcardly-staging` (`ctzoyorugnybzvkoyvwj`), built from these files.

**New project:** run `0-base.sql`, then `ALL-IN-ONE.sql`, then `linkcardly.sql` (SQL Editor → New query → Run each). The three together are what `test/support/live-db.mjs` runs before every database and browser test.

| File | What | Run |
|---|---|---|
| `verify.sql` | 16 PASS/FAIL checks of a built project (row-level security, secrets, test mode, admin, visitor permissions, functions, partner tables, empty start). First line: `'on'` for staging, `'off'` for production. | After setting up a project, and any time. |
| `0-base.sql` | The `cards` and `admins` tables that ALL-IN-ONE.sql builds on (columns, checks, indexes, admin-only access rules, `updated_at` trigger), as they were in the NexBizRise project. | First, on a new project. Safe to run again. |
| `ALL-IN-ONE.sql` | Cards, orders, coupons, payments, edit links, leads, admin log (copied from NexBizRise `supabase/ALL-IN-ONE.sql`, commit d92bfea; the public card views are now read-only). Linkcardly changes: photos only from its own R2 addresses (`media_url_ok`). | On a new database, and again (followed by `linkcardly.sql`) whenever it changes. Safe to run again. |
| `linkcardly.sql` | Security fixes from the production audit (read-only card views, no direct table writes, no anonymous access to the cards table or the admins list, rate limits that can't be spoofed, payment only unpaid → paid, refunded cards go offline, field rules and a real email on new orders), test mode (off), card link names (availability check, stale unpaid names released, "link taken" instead of random digits) and the partner programme (schema `partner`). UPI payments: the customer's UPI reference (`orders.upi_utr`, `claim_upi_payment`). | Once, after `ALL-IN-ONE.sql`. Safe to run again. |

All three are tested together in `test/live-db.test.js` (in-process Postgres with Supabase stand-ins for `auth`, `storage` and the API roles).

The native API (`src/routes/native.js`) calls these functions with the publishable key and the Worker secret; there is no other schema.

## Test mode (payments off)
**Never switch test mode on in the production project.** While it is on, anyone can place an order that goes live without paying. Use a separate Supabase project (a copy of the schema) for test mode. Test-mode orders never earn partner commission.

Payments and the Cloudflare Turnstile check are switched off while we test the product end to end.
- Database: run `insert into public.app_flags (key) values ('test_mode') on conflict (key) do nothing;` (after `linkcardly.sql`). Every new order is then marked paid with `pay_provider = 'test'` and the card goes live.
- Order page: `PAYMENTS_ON = false` in `public/app/order.html` (no Turnstile, order goes straight to the database, "no payment" placeholder on the Payment step).
- Order e-mails that the old NexBizRise worker sends after `/api/order` don't go out in test mode, because orders skip that worker.

Before launch:
1. `delete from public.app_flags where key = 'test_mode';`
2. Set `PAYMENTS_ON = true` and deploy.
3. Check the Stripe and Razorpay webhooks, `NBR_WORKER_SECRET` and `TURNSTILE_SECRET` on the worker that serves `/api/*`, then place one real order.
4. Remove test orders (run together):
   ```sql
   delete from partner.commissions where order_no in (select order_no from public.orders where pay_provider = 'test');
   delete from public.cards where id in (select card_id from public.orders where pay_provider = 'test');
   delete from public.orders where pay_provider = 'test';
   ```

## Partner programme: operating it
All calls are Supabase RPCs; admins must be signed in (`public.admins`).
1. A partner signs in (email link) and calls `partner_apply` → status `applied`.
2. Admin: `admin_partners()` to review, `admin_partner_set(id, 'approved')` → their code becomes an active ₹100 coupon (any customer, any number of orders).
3. Orders that use the code and get paid create a `pending` commission; after 15 days it is `approved`. Refunds reverse it (or claw it back from the next payout if it was already paid). Every paid order with the code earns ₹200, the partner's own orders and repeat customers included (the coupon has no per-email limit).
4. Monthly: `admin_payouts_prepare('2026-11')` → `admin_payout_sheet()` lists who to pay where (held rows need a PAN first) → pay by UPI/bank → `admin_payout_mark_paid(id, 'UPI', '<reference>')`.
5. Partners see everything in `partner_me()`; they add UPI/bank/PAN with `partner_set_payout_details`.

Settings (commission, discount, hold days, minimum payout, PAN threshold, TDS rate, terms version) are one row in `partner.settings`.

## Changes to run on an existing database
- **2026-10-17, one-time prices:** run `linkcardly.sql` again (staging first). Adds `plan_price()` / `shipping_fee()` (Digital ₹799 / $29, NFC Basic ₹1,499 / $59, NFC Custom ₹2,499 / $89, ₹99 shipping in India), `orders.product`, `shipping`, `ship`; refuses new Motion orders and NFC outside India; sets every card's renewal to 2099-12-31 (lifetime). Supersedes the prices in `2026-10-prices.sql` (don't run that file again after this).
- `2026-10-partner-rules.sql`: ₹200 commission, payable after 15 days, own and repeat orders earn (partner codes have no per-customer limit). Already part of `linkcardly.sql`; run this file on databases set up before 2026-10 (staging first, then production).
- `2026-10-prices.sql`: Motion Card in India ₹1,299 (was ₹1,799), and PAN asked for only above ₹10,000 a year (was ₹10,000). Already part of `ALL-IN-ONE.sql` and `linkcardly.sql`.
- `2026-10-partner-admin.sql`: an admin adds a partner in one step (`admin_partner_create`): approved code, a free Digital card that never expires, its edit link, and a private partner-page link (`/partner#<key>`, PIN = last 4 digits of their phone, 5 wrong PINs lock it for 15 minutes). `admin_partner_new_link` replaces a lost link. The partner page reads `partner_me_token` / `partner_set_payout_token` through the Worker only.
- `2026-10-partner-card.sql`: `public_card_extras` also shows `partner_code`, so a partner card's "Get a card like this" link goes to `/r/<code>`.
- `2026-10-admin-sql-editor.sql`: the admin partner functions (`admin_partner_create`, `admin_partners`, payouts) also run from the Supabase SQL Editor (a postgres login with no API request on it). Website callers, which always carry JWT claims, still need a signed-in admin.
- `2026-10-partner-create-fix.sql`: `admin_partner_create` checks the photo address itself instead of calling `media_url_ok()`.
- `2026-10-media-url-ok.sql`: adds `media_url_ok()` (missing on the live database; orders and card edits with a photo need it) and lists any other function from these files that a database is missing.
- `2026-10-missing-functions.sql`: `mark_order_refunded`, `mark_order_paid_manual` and `claim_upi_payment` (with the `orders.upi_utr` columns), which the live databases were missing.
- `2026-10-partner-customers.sql`: partners see each sale (date, plan, amount, status) with the customer's first name only.
- `2026-10-admin-partner-view.sql`: `admin_partner_view(id)` returns what that partner sees on their page (admin Partners tab → click a partner).
