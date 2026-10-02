# Vendored order and card app

These files are copied from NexBizRise `deploy/website/` (repo yourlocalwebsitedev/NexBizRise). Product, plans, pricing, copy and payment are kept identical on purpose.

| File | Source | Linkcardly changes |
|---|---|---|
| order.html | deploy/website/order.html | Brand strings and links, upload host check, Linkcardly header styling, asset paths under /app and /assets/img, served at /create (standalone + fresh start on that path), loads skin.css |
| skin.css | new | Hides the NexBizRise breadcrumb. Colours, type and shapes stay as in NexBizRise |
| card.html | deploy/website/card.html | Brand strings and links, host check, asset paths |
| brand.js | deploy/website/brand.js | Linkcardly wordmark: Caprasimo, "card" in terracotta #c67139, matching the home page (same `<nbr-logo>` API) |
| support.js, qrcode.js | deploy/website/ | none |

Do not refactor these files. To update, copy the new NexBizRise versions over these, re-apply the changes listed above, then run `docs/QA.md` again.
