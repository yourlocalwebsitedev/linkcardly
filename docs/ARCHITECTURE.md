# Architecture

Linkcardly is one Cloudflare Worker serving static files from `public/`. There is no frontend framework and no bundler. Marketing pages are plain HTML assembled at build time. The order and card app is a vendored copy of the NexBizRise app.

## Folders
```
linkcardly/
├── site/                  Marketing page SOURCES (edit here)
│   ├── site.config.js     Site URL, header nav, footer links
│   ├── layout.js          Shared shell: <head>, header, footer, sticky bar, scripts
│   ├── pages.js           Page registry: path, title, description, flags
│   └── pages/*.html       Page bodies (inside <main>)
├── scripts/build.mjs      site/ → public/*.html, sitemap.xml, assets/js/icons.js
├── src/                   Worker (server)
│   ├── index.js           Routing only
│   ├── config.js          Route tables, app file paths, version
│   ├── http.js            json(), serveAsset(), notFound()
│   ├── routes/            proxy.js (to NexBizRise), api.js (native), cards.js (native)
│   ├── views/card-page.js Server-rendered card (native)
│   └── lib/               Pure helpers: handles, icons, themes, vcard, supabase, turnstile
├── public/                Served as-is
│   ├── app/               Vendored NexBizRise order and card app (see app/README.md)
│   ├── assets/css/        site.css (marketing), card.css (native card)
│   ├── assets/js/         site.js (marketing behaviour), card.js (native card), catalogue.js (design data), icons.js (generated)
│   ├── assets/img/brand/  favicon companions, OG image
│   ├── assets/img/samples/ sample portrait used by the app
│   ├── assets/img/legacy/ old NexBizRise images (unused, to be deleted)
│   └── favicon.svg, robots.txt
├── supabase/migrations/   Native schema (for MODE = "native")
└── docs/                  ARCHITECTURE.md, QA.md
```

## Modes
- **proxy** (current): `/api/*` and unknown paths go to the NexBizRise worker. Card pages (`/<slug>`, `/c/<id>`) and edit links (`/e/<token>`) are served from `public/app/` and fetch their data through `/api/*`.
- **native** (later): `routes/api.js` and `routes/cards.js` with the Supabase schema in `supabase/`.

## Rules
- Single sources of truth: the icon set is `src/lib/icons.js` (the browser copy is generated), and nav and footer links are `site/site.config.js`.
- Styling for marketing pages lives in `assets/css/site.css`, built from tokens (`--bg`, `--accent`, ramps) and small utilities (`.stack`, `.row`, `.grid` with `--g` and `--min`).
- Don't refactor `public/app/`. It mirrors NexBizRise so updates can be copied over.
- New marketing page: add an entry to `site/pages.js` and a body in `site/pages/`, add the path to `STATIC_PAGES` in `src/config.js`, and add the name to `RESERVED` in `src/lib/handles.js`.

## Known debt
- `assets/js/catalogue.js` duplicates some colourway data from `src/lib/themes.js`. Merge them when native mode ships.
- `site/pages/*.html` use inline styles in places. Move repeated patterns into `site.css` classes as pages grow.
