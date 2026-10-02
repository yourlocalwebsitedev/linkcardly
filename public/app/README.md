# Order and card app

The order flow (`/create`) and the card page. Plain HTML plus `support.js`, no build step.

| File | What | Linkcardly changes |
|---|---|---|
| order.html | Order flow | Brand strings and links, upload host check, asset paths under /app and /assets/img, served at /create (standalone + fresh start on that path), loads skin.css. Per-profession fields and validation (name, phone, email, links, social usernames, licence, address, length limits); Preview step validates; no sample data in the real form. Desktop form bar sits in the page flow; the desktop step label counts 3 steps (Preview is the side panel) |
| skin.css | Brand skin | Maps the app's colour tokens and type to the site brand (cream, terracotta, olive, Caprasimo, Figtree). Hides the old breadcrumb |
| card.html | Card page | Brand strings and links, host check, asset paths. 56 designs across 7 categories. Original: smaller monogram ring so it never overlaps the name; "Flip" label. Listing Showcase: Save contact is the primary button, booking is secondary, branded header when there is no photo |
| brand.js | Wordmark | Caprasimo, "card" in terracotta #c67139 (`<nbr-logo>` API) |
| support.js, qrcode.js | Runtime | none |

Keep changes small and list them here. After any change, run `docs/QA.md` again.
