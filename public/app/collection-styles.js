/* Professional and Luxury card styles: the one list shared by the order flow (order.html), the card page
 * (card.html) and admin (admin.html). Loaded as a plain script; read as window.LC_COLLECTION_STYLES.
 *
 *   pro   Professional. mode 'band' (photo in a header band) or 'hero' (full photo). Each mode is one design
 *         with three colours (the picker groups them; see familyOf in order.html).
 *   lux   Luxury. frame 'arch' or 'square'; each frame is one design with three colours.
 * Ids are stored on saved cards: never rename or remove one. Retired colours stay here (so old cards
 * render) and are listed in `retired`, which hides them from new orders.
 */
(function () {
  window.LC_COLLECTION_STYLES = {
    pro: [
      { id: 'pro-corporate', name: 'Harbor', layout: 'professional', mode: 'band', bg: '#eef2f7', ink: '#14243b', card: '#ffffff', accent: '#2f5d9a', on: '#ffffff', font: "Figtree,system-ui,sans-serif", rad: '12px', align: 'center', boxed: true },
      { id: 'pro-studio', name: 'Noir', layout: 'professional', mode: 'hero', bg: '#0b0b0c', ink: '#f5f3ee', card: '#161618', accent: '#e6d3a3', on: '#15120a', font: "'Bricolage Grotesque',system-ui,sans-serif", rad: '14px', align: 'left', boxed: true },
      { id: 'pro-sage', name: 'Sage', layout: 'professional', mode: 'band', bg: '#eef3ef', ink: '#16301f', card: '#ffffff', accent: '#2f6b4a', on: '#ffffff', font: "Figtree,system-ui,sans-serif", rad: '12px', align: 'center', boxed: true },
      { id: 'pro-navy', name: 'Navy', layout: 'professional', mode: 'hero', bg: '#0b1426', ink: '#f2f4f8', card: '#141f36', accent: '#c9d6ee', on: '#0b1426', font: "'Bricolage Grotesque',system-ui,sans-serif", rad: '14px', align: 'left', boxed: true },  { id: 'pro-clay', name: 'Clay', layout: 'professional', mode: 'band', bg: '#f6efe9', ink: '#3a2418', card: '#ffffff', accent: '#9a4a2a', on: '#ffffff', font: "Figtree,system-ui,sans-serif", rad: '12px', align: 'center', boxed: true },
      { id: 'pro-forest', name: 'Forest', layout: 'professional', mode: 'hero', bg: '#0c1a14', ink: '#f1f4ef', card: '#14251d', accent: '#cfe3c4', on: '#0c1a14', font: "'Bricolage Grotesque',system-ui,sans-serif", rad: '14px', align: 'left', boxed: true },
    ],
    lux: [
      { id: 'lux-onyx', name: 'Onyx', layout: 'luxuryEstate', bg: '#0c0b0a', ink: '#f3ead8', accent: '#d4af37', frame: 'arch', font: "'Cormorant Garamond',Georgia,serif" },
      { id: 'lux-marble', name: 'Marble', layout: 'luxuryEstate', bg: '#f7f6f3', ink: '#22201d', accent: '#9c8a6e', frame: 'square', font: "Newsreader,Georgia,serif" },
      { id: 'lux-pearl', name: 'Pearl', layout: 'luxuryEstate', bg: '#f3e9dc', ink: '#2a211a', accent: '#7d5f33', frame: 'arch', font: "'Cormorant Garamond',Georgia,serif" }, // warm champagne + arch, so it reads apart from Marble (cool white, square)
      { id: 'lux-midnight', name: 'Midnight Gold', layout: 'luxuryEstate', bg: '#0d1424', ink: '#f1ebdd', accent: '#d4b26a', frame: 'arch', font: "Newsreader,Georgia,serif" },
      { id: 'lux-linen', name: 'Linen', layout: 'luxuryEstate', bg: '#eef0ea', ink: '#1f261f', accent: '#55654b', frame: 'square', font: "Newsreader,Georgia,serif" },
      { id: 'lux-slate', name: 'Slate', layout: 'luxuryEstate', bg: '#1b1f24', ink: '#eef0f2', accent: '#b8c2cc', frame: 'square', font: "Newsreader,Georgia,serif" },
    ],
    retired: []
  };
})();
