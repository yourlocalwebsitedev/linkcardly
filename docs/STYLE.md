# Linkcardly style

Source of truth: **Linkcardly Home v13** (desktop and mobile). Every page and the order flow follow it.

## Files
- `public/assets/css/tokens.css`: the only place colours, fonts, shadows and easing are defined.
- `public/assets/css/site.css`: marketing components, mobile first. Breakpoints 600 / 1000 / 1300 px, as in v13.
- `public/app/skin-v13.css`: maps the vendored order app onto the same tokens (no hex values).

## Tokens
| Token | Value | Use |
|---|---|---|
| `--lc-paper` | #FAF5ED | page sheet |
| `--lc-sand` | #EEDFD4 | header, footer, ground, 1px edges, icon discs |
| `--lc-white` | #FDFDFC | bands, surfaces, text on accent |
| `--lc-ink` | #11100F | text, menu button, selected chips |
| `--lc-muted` | #837867 | lead and secondary text |
| `--lc-accent` | #B04E22 | buttons, kicker, highlights, focus ring |
| `--lc-accent-hover` | #963F19 | button hover |

Type: DM Serif Display 400 for the logo and headings (letter-spacing −.03em), Inter 400–700 for everything else.

## Components (site.css)
Header (`.top`, `.nav`, `.menu`), `.btn`, `.text-link`, `.sheet` (rounded paper panel on sand), `.kicker`, `.h1`, `.h2`, `.lead`, `.claim` (link field), `.proof`, `.band` (white section), `.features` / `.feature`, `.split` + `.photo`, `.surface`, `.plans`, `.form` / `.field` / `.input` / `.chip`, `.picker` (designs), `.prose` (legal), `.foot`.

## Motion
Hero items rise 24px and fade in (0.8–0.9s, cubic-bezier(.16,1,.3,1), staggered 80ms). The hero photo fades from 1.03 scale. Feature items below the fold fade up 20px as they enter. Buttons lift 1px with a shadow on hover and press to .98. Everything is off under prefers-reduced-motion.
