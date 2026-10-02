# Linkcardly

Digital business cards at `linkcardly.com/<handle>`. A new repo, built on the same stack as NexBizRise: **Cloudflare Workers + static assets, Supabase and Turnstile**. Plain JS, no framework, no build step.

## Structure
See `docs/ARCHITECTURE.md`. In short, edit marketing pages in `site/`, the server in `src/`, and static files in `public/`. `public/app/` is the vendored NexBizRise order and card app.

## Setup
```bash
npm i
npx wrangler login
# set SUPABASE_URL, TURNSTILE_SITE_KEY in wrangler.toml, then:
npx wrangler secret put SUPABASE_SERVICE_KEY
npx wrangler secret put TURNSTILE_SECRET
# run supabase/migrations/0001_init.sql in the Supabase SQL editor
npm run build      # site/ → public/
npm run dev        # build + http://localhost:8787
npm run deploy
```
Then replace `YOUR_TURNSTILE_SITE_KEY` in `public/create/index.html` and `public/contact/index.html`.

## Modes
- **proxy (now):** `MODE = "proxy"`. Linkcardly serves its own marketing pages only. Every `/api/*` call and every card page is forwarded to the existing NexBizRise worker (`LEGACY_ORIGIN`), so existing credentials, Supabase, Turnstile, payments, admin and edit links work unchanged.
- **native (later):** `MODE = "native"` switches to the Linkcardly API and database in `src/` and `supabase/`.

## Ordering and pricing
`/create`, `/order` and `/pricing` serve `public/order.html`, which is the NexBizRise order flow copied unchanged from `deploy/website/order.html`. Its preview uses `public/card.html`, with `brand.js`, `qrcode.js`, `support.js`, `portrait.jpg` and `assets/` alongside.
- Only one change: the upload host check also allows `linkcardly.com`.
- Its `/api/*` calls (upload, order, pay/start, pay/verify, pay/status, edit) are forwarded in proxy mode to the existing NexBizRise worker, so the same Supabase, Stripe, Razorpay and admin are used.
- Copy these files again whenever the NexBizRise order flow changes.

## Routes
| Path | What |
|---|---|
| `/`, `/designs`, `/pricing`, `/teams`, `/create`, `/contact`, `/privacy`, `/terms`, `/refunds` | Static marketing pages |
| `/<handle>` | Live card (status `live` only) |
| `/<handle>/contact.vcf` | Save contact |
| `GET /api/handle?h=` | Availability check (with suggestions) |
| `POST /api/order` | Creates a `pending` card + links (Turnstile) |
| `POST /api/contact` | Contact form (Turnstile) |
| `POST /api/lead` | Lead form on a card (Turnstile) |
| `GET /api/qr?u=` | QR image (temporary; see TODO) |
| `/health` | `ok v1` |
| `card.nexbizrise.com/*` | 301 → `linkcardly.com/*` |

## Handle rules
Lowercase letters, numbers, `.` and `-`. 3–30 characters. Must start and end with a letter or number, with no repeated `.` or `-`. Reserved words are listed in `src/lib/handles.js`. The database enforces the same pattern.

## Port from NexBizRise (next)
These exist in the old product. Copy their logic in rather than rebuilding it:
- [ ] Design families and all colourways → `src/lib/themes.js` (with per-family layouts in `card.js`)
- [ ] Moving portrait / Cover photo framing
- [ ] Seasonal themes (auto / off)
- [ ] Category details and compliance blocks (TREC)
- [ ] QR generator (replace the temporary `/api/qr` redirect)
- [ ] Admin: approve, pause or activate cards, mark payments, view leads
- [ ] Self-edit page via `cards.edit_token`
- [ ] Order emails (customer + admin)
- [ ] Data migration: export old cards → insert into `cards` and `links` with the same slugs

## Manual setup
- Cloudflare: add linkcardly.com and attach it to the Worker. Also attach `card.nexbizrise.com` to the same Worker for redirects.
- Turnstile: allowed hostname linkcardly.com.
- Supabase: allowed URL linkcardly.com.
- Email: hello@linkcardly.com with SPF/DKIM.
- Google Search Console: add linkcardly.com and submit a change of address.

## Notes
- Pricing shows `$—` placeholders. Legal pages need real text.
- Every animation is turned off under `prefers-reduced-motion`.
- The design reference is `design_handoff_linkcardly_website/`.
