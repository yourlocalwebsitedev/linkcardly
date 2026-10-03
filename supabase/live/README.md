# Live database (Supabase)

The database linkcardly.com runs on today. It was set up by NexBizRise; its schema now lives here.

| File | What | Run |
|---|---|---|
| `ALL-IN-ONE.sql` | Cards, orders, coupons, payments, edit links, leads, admin log (copied from NexBizRise `supabase/ALL-IN-ONE.sql`, commit d92bfea). Already applied to the live database. | Only when setting up a new database. |
| `partners.sql` | Card link names (availability check, stale unpaid names released, "link taken" instead of random digits) and the partner programme (schema `partner`). | Once, after `ALL-IN-ONE.sql`. Safe to run again. |

Both are tested together in `test/live-db.test.js` (in-process Postgres with Supabase stand-ins for `auth`, `storage` and the API roles).

`supabase/migrations/` is the separate schema for native mode (later), not this database.

## Partner programme: operating it
All calls are Supabase RPCs; admins must be signed in (`public.admins`).
1. A partner signs in (email link) and calls `partner_apply` → status `applied`.
2. Admin: `admin_partners()` to review, `admin_partner_set(id, 'approved')` → their code becomes an active ₹100 coupon.
3. Orders that use the code and get paid create a `pending` commission; after 14 days it is `approved`. Refunds reverse it (or claw it back from the next payout if it was already paid). Orders by the partner themselves (same email or phone) are `rejected`.
4. Monthly: `admin_payouts_prepare('2026-11')` → `admin_payout_sheet()` lists who to pay where (held rows need a PAN first) → pay by UPI/bank → `admin_payout_mark_paid(id, 'UPI', '<reference>')`.
5. Partners see everything in `partner_me()`; they add UPI/bank/PAN with `partner_set_payout_details`.

Settings (commission, discount, hold days, minimum payout, PAN threshold, TDS rate, terms version) are one row in `partner.settings`.
