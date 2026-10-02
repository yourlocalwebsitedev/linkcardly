# Linkcardly end-to-end QA (1 Oct 2026)

Tested: Home, Designs, Teams, Contact, Order flow (Plan, Your card, Preview, Payment) and the Card page, in the demo and in the `linkcardly/` repo copies.

## Fixed in this pass
| # | Where | Defect | Fix |
|---|---|---|---|
| 1 | Order: page title, OG, Twitter | "NexBizRise" in browser tab and share previews | Now says "Linkcardly" |
| 2 | Order and Card favicon | NexBizRise elephant icon | Linkcardly favicon |
| 3 | Order: Payment step | Terms, Refund and Privacy links went to nexbizrise.com | Now `/terms`, `/refunds`, `/privacy` |
| 4 | Order: Razorpay checkout | Merchant name shown as "NexBizRise" | "Linkcardly" |
| 5 | Order: support and help messages | hello@nexbizrise.com and "Hi NexBizRise…" WhatsApp text | hello@linkcardly.com and "Hi Linkcardly…" |
| 6 | Order: card links, QR and done screen | Pointed to card.nexbizrise.com | linkcardly.com |
| 7 | Card page footer (5 designs) | "Powered by NexBizRise" | "Powered by Linkcardly", linking to /order |
| 8 | Card page | "Digital card by NexBizRise", "Send these to NexBizRise" | Linkcardly |
| 9 | Demo sample card | Company "NexBizRise", nexbizrise.com site, agency bio and tagline "Digital · Automate · Grow" | Linkcardly, linkcardly.com, "Your business card, in a link.", "Connect · Share · Grow" |
| 10 | Order: new order numbers | Started with "NBR-" | Start with "LC-" when the order is created in the browser |
| 11 | Card page on linkcardly.com | Live cards would load from the NexBizRise worker, which is NexBizRise-branded | Worker now serves the Linkcardly copy for `/<slug>`, `/c/<id>` and edit links `/e/<token>`. Data still comes from the same backend |
| 12 | Card page | Data and lead calls only worked on nexbizrise.com | Also allowed on linkcardly.com |
| 13 | Order: Your card step | "Upload photo" wrapped onto two lines | Stays on one line |

## Still open: needs the NexBizRise backend (worker and Supabase), not this site
| # | Defect | What's needed |
|---|---|---|
| A | Order numbers made by the server, and public card IDs, start with `NBR-` and `nbr_` (shown on the done screen and in `/c/nbr_xxxxxx` links) | Change the prefix in the worker and SQL, or accept the existing IDs |
| B | Order confirmation and admin emails are sent as NexBizRise | Change the sender name and address, and the templates, in the worker |
| C | Stripe and Razorpay statement name and checkout branding say NexBizRise | Update in the Stripe and Razorpay dashboards |
| D | Per-card share previews (OG title and photo per slug) were added by the NexBizRise worker | Port the OG rewrite into the Linkcardly worker |
| E | The NexBizRise backend must accept requests from linkcardly.com (CORS, Turnstile hostnames, Supabase allowed URLs, upload host) | Add linkcardly.com in each |

## Still open: content and brand decisions (not changed, per "no improvements")
| # | Defect |
|---|---|
| F | The order flow keeps NexBizRise's teal accent (selected plan, ticks, totals). Linkcardly uses terracotta |
| G | Sample portrait (`portrait.jpg`) is the NexBizRise founder photo |
| H | Share image `/assets/og-image.png` is the NexBizRise image. A Linkcardly one is needed |
| I | `/assets/nexbizrise-*.png` files are still in the repo (no longer used by the logo) |
| J | Privacy, Terms and Refunds pages say "Policy text goes here" |
| K | Teams page: "Talk to us" goes to Contact. There is no team ordering in the NexBizRise flow |

## Not defects
- The scroll bar inside the phone frames only appears in the desktop preview, not on real phones.
- In these screenshots the logo looked doubled ("linkcardlylinkcardly"). Your own screenshot showed it once, so I treated it as a quirk of my screenshot tool, not a real bug.
