// Showcase cards for the marketing pages: static, accurate renders of the three card families
// (Original, Luxury Estate, Listing Showcase). Used in page bodies as {{card:<kind>}} or
// {{phone:<kind>:<size>}} and expanded by scripts/build.mjs. Styles live in assets/css/site.css (.lc-card).
const PHOTO = '/assets/img/samples/portrait.jpg';
const ALT = 'Sample card photo';

const i = {
  save: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg>',
  call: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>',
  wa: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>',
  mail: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>',
  cal: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg>',
  ig: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/></svg>',
  web: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/></svg>'
};

const original = `<div class="lc-card v-original" aria-hidden="true">
<img src="${PHOTO}" alt="" class="o-photo" loading="lazy"><div class="o-fade"></div>
<div class="o-head"><span class="o-cat">Real estate · Skyline Realty</span><b class="o-name">Alex Morgan</b><span class="o-role">REALTOR® · Buy, sell and invest</span></div>
<div class="o-body"><span class="o-save">${i.save}Save contact</span>
<div class="o-grid"><span>${i.call}Call</span><span>${i.wa}WhatsApp</span><span>${i.mail}Email</span><span>${i.pin}Office</span></div>
<span class="o-row gold">${i.cal}Schedule a showing<em>→</em></span><span class="o-row">${i.home}View my listings<em>↗</em></span></div>
<div class="o-foot"><span>linkcardly.com/alexmorgan</span><b>Share · Show QR</b></div></div>`;

const luxury = `<div class="lc-card v-luxury" aria-hidden="true">
<div class="x-top"><i></i><span>Skyline Realty</span><i></i></div>
<div class="x-arch"><img src="${PHOTO}" alt="" loading="lazy"></div>
<span class="x-kick">Luxury property advisor</span><b class="x-name">Alex Morgan</b><span class="x-tag">Buy · Sell · Invest</span>
<div class="x-body"><span class="x-save">Save contact</span><div class="x-three"><span>Call</span><span>Text</span><span>Email</span></div>
<span class="x-row">Schedule a private showing<em>→</em></span><span class="x-row">Current listings<em>→</em></span></div>
<div class="x-foot"><b>Share</b><span>TX License #0000000</span><b>Show QR</b></div></div>`;

const listing = `<div class="lc-card v-listing" aria-hidden="true">
<img src="${PHOTO}" alt="" class="l-photo" loading="lazy">
<div class="l-head"><span>Real estate · Buy · Sell · Rent</span><b>Alex Morgan</b><em>REALTOR® · Skyline Realty</em></div>
<div class="l-body"><span class="l-save">${i.save}Save contact</span><div class="l-three"><span>Call</span><span>Text</span><span>Email</span></div>
<span class="l-book">Schedule a showing<em>→</em></span>
<span class="l-list"><i>${i.home}</i><span><b>View my listings</b><small>See homes on my site</small></span><em>↗</em></span>
<div class="l-soc"><i>${i.ig}</i><i>${i.web}</i><i>${i.mail}</i></div></div></div>`;

export const CARDS = { original, luxury, listing };
export const CARD_NAMES = { original: 'Original', luxury: 'Luxury Estate', listing: 'Listing Showcase' };

// {{phone:kind:size}} wraps a card in a phone frame. size: lg | md | sm | xs (see .phone--* in site.css)
export const phone = (kind, size = 'md') => `<div class="phone phone--${size}" role="img" aria-label="${CARD_NAMES[kind]} card design, sample"><div class="scr">${CARDS[kind]}</div></div>`;

export const expand = html => html
  .replace(/\{\{phone:(\w+):(\w+)\}\}/g, (_, k, s) => phone(k, s))
  .replace(/\{\{card:(\w+)\}\}/g, (_, k) => CARDS[k]);
