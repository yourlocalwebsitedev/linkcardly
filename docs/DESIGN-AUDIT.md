# Design audit (2026-10-18)

Every card design the order flow offers (75 styles, 7 categories) rendered in the card page at phone width with an India sample person per category. Contact sheets: `_audit/sheet0-7.jpg` (delete before committing). Score = first screen at 390 px: hierarchy, contrast, photo, fit to the trade, distinctness.

## Scores
| # | Style | Score | Notes |
|---|---|---|---|
| 0-5 | Personal: Forest, Rosé, Lagoon, Plum, Espresso, Blush (one design, 6 colours) | 8 | Strong. Colourways of one design, fine. |
| 6-8 | Personal: Summit Pine / Glacier / Ember | 9 | Distinct, scenic. |
| 9-12 | Personal: Tide Midnight / Copper / Sunrise / Lagoon | 8 | Good. Sunrise: QR on light peach is fine. |
| 13, 15 | Professional: Harbor, Sage (header band) | 7 | Same layout, colour only. Band crops the photo top. |
| 14, 16 | Professional: Noir, Navy (poster) | 7 | Same layout; repeats the business poster. |
| 17-20 | Luxury: Onyx, Marble, Pearl, Midnight Gold | 8 | Marble and Pearl look identical. |
| 21, 25, 28, 29 | RE poster: Skyline, Sage, Brick, Charcoal | 6 | 4 colours shown as 4 designs. Light photo backgrounds wash out the white name (25, 29). |
| 22, 30, 31 | RE Yard Sign: Red, Navy, Green | 6 | Photo crops the head at the forehead; sign hangers cut into the photo. |
| 23, 26, 32 | RE Listing: Crisp, Stone, Meadow | 7 | Clean but generic; same as every other category's list. |
| 24, 27, 33 | RE Home: Hearth, Coastal, Garden | 7 | Same as every other category's home. |
| 34, 38 | Health poster: Clinic, Ocean | 7 | Poster again; badge good. |
| 35 | Health Appointment | 8 | Distinct, fits the trade. |
| 36, 39 | Health list: Pure, Mint | 6 | Near-identical, colour only. |
| 37, 40 | Health home: Calm, Sky | 6 | Near-identical. |
| 41, 45 | Beauty poster: Mocha, Rosewood | 7 | Two posters, colour only. |
| 42 | Beauty Price Menu | 8 | Distinct arch photo. |
| 43, 46 | Beauty list: Petal, Lilac | 6 | Colour only. |
| 44, 47 | Beauty home: Silk, Blush | 6 | Colour only. |
| 48, 52 | Legal poster: Chambers, Oxblood | 7 | Colour only. |
| 49 | Legal Letterhead | 9 | Best business design. |
| 50, 53 | Legal list: Counsel, Slate | 6 | "Desai & Co" breaks with "Co" alone on line 2. |
| 51, 54 | Legal home: Heritage, Ledger | 6 | Colour only. |
| 55, 59, 60, 62 | Home Services poster: Hi-Vis, Safety, Pipeline, Fire | 6 | 4 colours as 4 designs. |
| 56, 63, 64 | Job Ticket: Yellow, Orange, Blue | 8 | Distinct, fits the trade. |
| 57, 61, 65 | Toolbox list: Yellow, Green, Blue | 6 | Generic. |
| 58, 66, 67 | Home: Red, Ember, Harbour | 6 | Generic. |
| 68 | Corporate Business Card | 6 | Big empty gap between title and phone; photo tiny. |
| 69, 73 | Corporate list: Memo, Ink | 6 | Colour only. |
| 70, 74 | Corporate home: Summit, Harbor | 6 | Colour only. |
| 71, 72 | Corporate poster: Midnight, Charcoal | 7 | Colour only. |

## Main problem
Poster, list and home are the same three layouts in every business category, and inside a category each colour is listed as a separate design. Real Estate shows 13 "designs" that are 4 layouts. Fix: group colours into one design per layout in every category (families), and give each category's shared layouts a trade-specific detail so no two categories look alike.

## Changes made (2026-10-18)
- Colours of one layout are now one design in Health, Beauty, Legal and Corporate too (estate-styles.js `families`), as Real Estate and Home Services already were. Phones swipe between layouts; colours stay on the strip.
- Poster: darker ramp under the name (light photo backgrounds no longer wash out the white name); photo height capped at 62vh so name and actions fit the first screen. 21, 25, 28, 29, 55, 59, 60, 62: 6 → 8.
- Yard Sign: taller photo, sign overlaps less, face no longer cut. 22, 30, 31: 6 → 8.
- List: title and company balance across lines; a short company stays on one line with its dot. 50, 53: 6 → 7.
- Trade chips (qualifications, services, 24×7) no longer break inside a chip.
- Luxury Pearl: warm champagne, arch frame, Cormorant, so it no longer matches Marble. 18, 19: 7 → 8.
- Corporate Business Card: larger ringed photo and name. 68: 6 → 7.

## Still below 8 (next)
List and Home layouts (and Professional) are still the same structure in every category; they need one trade-specific element each (see the TODO list, D7–D14).

## Three colours per design (2026-10-18)
| Collection | Design | Colours |
|---|---|---|
| Personal | Classic | All six kept by request: Forest, Rosé, Lagoon, Plum, Espresso, Blush |
| Personal | Summit | Pine, Glacier, Ember |
| Personal | Tide | Midnight, Copper, Lagoon (Sunrise retired) |
| Professional | Profile (band) | Harbor, Sage, Clay (new) |
| Professional | Studio (hero) | Noir, Navy, Forest (new) |
| Luxury | Arch | Onyx, Pearl, Midnight Gold |
| Luxury | Gallery (square) | Marble, Linen (new), Slate (new) |
| Real Estate | Poster / Yard Sign / Listing / Home | 3 each (Charcoal poster retired) |
| Home Services | Poster / Job Ticket / Toolbox / Home | 3 each (Fire Red poster retired) |
| Health, Beauty, Legal, Corporate | each layout | 3 each (5 new colours per category) |
