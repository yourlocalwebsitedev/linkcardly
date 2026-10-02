# Order and card app

The order flow (`/create`) and the card page. Plain HTML plus `support.js`, no build step.

| File | What | Linkcardly changes |
|---|---|---|
| order.html | Order flow | Uses the handle claimed on the home page (`/create?h=`, via `claimedSlug()` and `/assets/js/rules.js`) instead of first name + phone, when it's allowed. Brand strings and links, upload host check, asset paths under /app and /assets/img, served at /create (standalone + fresh start on that path), loads skin.css. Per-profession fields and validation (name, phone, email, links, social usernames, licence, address, length limits); Preview step validates; no sample data in the real form. Desktop form bar sits in the page flow; the desktop step label counts 3 steps (Preview is the side panel). Phone Preview step: the card is full-bleed (no page padding, corners or shadow) and renders `components/card-style-controls.js` (no footer bar; `scs` in the view model supplies its props); the shared style bar is desktop-only; the back button is a quieter 44 px |
| skin.css | Brand skin | Maps the app's own colour variables and type to the brand tokens in `/assets/css/tokens.css` (no hex values of its own), which order.html loads just before it. Hides the old breadcrumb |
| card.html | Card page | Brand strings and links, host check, asset paths. 56 designs across 7 categories. Original: smaller monogram ring so it never overlaps the name; "Flip" label. Listing Showcase: Save contact is the primary button, booking is secondary, branded header when there is no photo |
| brand.js | Wordmark | Caprasimo, "card" in terracotta #c67139 (`<nbr-logo>` API) |
| support.js, qrcode.js | Runtime | none |
| components/ | Linkcardly components for the app | `card-style-controls.js` + `.css`: CardStyleControls (StyleTrigger, NextButton, StyleSelector, StyleOption), the phone style picker and next button, drawn as liquid glass whose tone (clear or milky) follows the selected card's background, with a fade under the controls and a floating sheet when open. With several collections the sheet shows one tab per collection and the button names the collection. Options sharing a `family` (Personal's colours) collapse into one tile; `LcCardColourRail` in the same file shows those colours as a strip at the top right of the card. Props-only API (see the file header), so it works with any style list or collection. Loaded with `<x-import component-from-global-scope="LcCardStyleControls" …>` |
| vendor/ | React 18.3.1, React DOM 18.3.1, Babel standalone 7.29.0 | Self-hosted, byte-identical to the SRI-pinned unpkg files (test-checked). `vendor/resources.js` maps the unpkg URLs to them through `window.__resources`, which support.js already reads. order.html and card.html load it before support.js |

Keep changes small and list them here. After any change, run `docs/QA.md` again.
