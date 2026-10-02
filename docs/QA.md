# Linkcardly end-to-end QA (1 Oct 2026)

Tested: Home, Designs, Teams, Contact, Order flow (Plan, Your card, Preview, Payment) and the Card page, in the demo and in the `linkcardly/` repo copies.

## Fixed in this pass
| # | Where | Defect | Fix |
|---|---|---|---|
| 1 | Order: page title, OG, Twitter | "the previous brand" in browser tab and share previews | Now says "Linkcardly" |
| 2 | Order and Card favicon | the previous brand elephant icon | Linkcardly favicon |
| 3 | Order: Payment step | Terms, Refund and Privacy links went to the old domain | Now `/terms`, `/refunds`, `/privacy` |
| 4 | Order: Razorpay checkout | Merchant name shown as "the previous brand" | "Linkcardly" |
| 5 | Order: support and help messages | the old support email and "Hi …" (old brand) WhatsApp text | hello@linkcardly.com and "Hi Linkcardly…" |
| 6 | Order: card links, QR and done screen | Pointed to the old card domain | linkcardly.com |
| 7 | Card page footer (5 designs) | "Powered by the previous brand" | "Powered by Linkcardly", linking to /order |
| 8 | Card page | "Digital card by the previous brand", "Send these to the previous brand" | Linkcardly |
| 9 | Demo sample card | Old company name, the old domain site, agency bio and tagline "Digital · Automate · Grow" | Linkcardly, linkcardly.com, "Your business card, in a link.", "Connect · Share · Grow" |
| 10 | Order: new order numbers | Started with "NBR-" | Start with "LC-" when the order is created in the browser |
| 11 | Card page on linkcardly.com | Live cards would load from the legacy backend worker, which is the previous brand-branded | Worker now serves the Linkcardly copy for `/<slug>`, `/c/<id>` and edit links `/e/<token>`. Data still comes from the same backend |
| 12 | Card page | Data and lead calls only worked on the old domain | Also allowed on linkcardly.com |
| 13 | Order: Your card step | "Upload photo" wrapped onto two lines | Stays on one line |

## Still open: needs the legacy backend (worker and Supabase), not this site
| # | Defect | What's needed |
|---|---|---|
| A | Order numbers made by the server, and public card IDs, start with `NBR-` and `nbr_` (shown on the done screen and in `/c/nbr_xxxxxx` links) | Change the prefix in the worker and SQL, or accept the existing IDs |
| B | Order confirmation and admin emails are sent as the previous brand | Change the sender name and address, and the templates, in the worker |
| C | Stripe and Razorpay statement name and checkout branding say the previous brand | Update in the Stripe and Razorpay dashboards |
| D | Per-card share previews (OG title and photo per slug) were added by the legacy backend worker | Port the OG rewrite into the Linkcardly worker |
| E | The legacy backend must accept requests from linkcardly.com (CORS, Turnstile hostnames, Supabase allowed URLs, upload host) | Add linkcardly.com in each |

## Redesign (Oct 2026): fixed
| # | Was | Now |
|---|---|---|
| F | Order flow used a teal accent and Plus Jakarta Sans | `public/app/skin.css` maps it to the site brand (cream, terracotta, olive, Caprasimo and Figtree) |
| G | Sample portrait was a real person's photo from the previous brand | `portrait.jpg` is now a neutral illustration (`portrait.svg`). Replace with a licensed photo when ready |
| H | Share image showed the previous brand | New `og-image.png` with the Linkcardly wordmark and a card |
| I | Old brand image files in the repo | Deleted `assets/img/legacy/` and the unused teal theme. New `apple-touch-icon.png` |
| K | Teams "Talk to us" went to Contact | Teams page has its own quote form (posts to `/api/contact` with company and team size) |
| L | Contact page showed "Thanks, . Message received." on load | `[hidden]{display:none!important}` in `site.css` |
| M | Designs page and home showed placeholder skeleton cards with names not sold in checkout | Real renders of Original, Luxury Estate and Listing Showcase (`site/cards.js`), each with a live demo link |
| N | Desktop order bar floated over the plan cards; label said "Step 1 of 4" over 3 tabs | Bar sits in the flow; desktop label counts 3 steps |
| O | Original card: monogram overlapped the name; Listing Showcase had two primary buttons | Smaller monogram ring; Save contact is the one primary, booking is secondary |

## Still open
| # | Defect |
|---|---|
| J | Privacy, Terms and Refunds pages say "Policy text goes here" |
| P | Testimonials have no names or photos. Add real customer names and photos with permission |

## Not defects
- The scroll bar inside the phone frames only appears in the desktop preview, not on real phones.
- In these screenshots the logo looked doubled ("linkcardlylinkcardly"). Your own screenshot showed it once, so I treated it as a quirk of my screenshot tool, not a real bug.
