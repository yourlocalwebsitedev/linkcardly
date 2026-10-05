# Black & Gold — order flow style

The order flow (`/create`, `public/app/order.html`) uses `public/app/skin-gold.css`. Visual only: no behaviour lives in the skin.

## Colour
| Role | Hex |
| --- | --- |
| Background | `#070604` |
| Secondary background (unselected cards, inputs) | `#0F0C08` |
| Surface (selected card) | `#13100B` |
| Elevated | `#18140D` |
| Border | `#302819` |
| Gold (selected, CTA, key labels) | `#ECC48F` |
| Gold highlight (CTA top) | `#F2C985` |
| Gold text | `#E6BA7A` |
| Text | `#F7F7F7` |
| Secondary text | `#B8B3AA` |
| Muted text | `#817B70` |

Gold is for state and action only: selected plan, primary button, active step, small labels. Never `#FFD700`.

## Type
- Display / headings (h1, h2) and wordmark: DM Serif Display 400.
- Everything functional (labels, plan names, prices, body): Figtree.
- Plan step on phones: heading 30px, plan name 16px/600, price 28px/800, "/ year" 13px/500 muted.

## Components
- **Primary button:** `linear-gradient(180deg,#F2C985,#ECC48F)`, text `#0A0805`, pill.
- **Plan card selected:** `#13100B`, 1px `#ECC48F`, `0 0 18px rgba(236,196,143,.16)`, faint light from top-left.
- **Plan card unselected:** `#0F0C08`, 1px `#302819`, no glow, slightly dimmed.
- **Step bar:** active = champagne tint + gold text; inactive = muted text.
- **Inputs / Your link:** `#0F0C08`, 1px `#302819`, gold focus ring 3px at 16%.
- **Preview badge:** frosted glass pill, "LIVE PREVIEW" with a champagne dot.

## Radius
Cards 18px, small cards 16px, inputs 12–16px, buttons and step bar pill. Labels are not pills.

## Motion
150–250ms ease-out on selection (border, tick pop, thumbnail tilt 3°). Off under `prefers-reduced-motion`.

## Rollback
Point `order.html` back at `/app/skin.css`.
