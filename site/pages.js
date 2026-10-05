// One entry per marketing page. Body markup lives in site/pages/<name>.html.
// active: which nav item is highlighted · cta: footer claim block · sticky: mobile claim bar · theme: body class + its stylesheet (gold → assets/css/gold.css)
export const pages = [
  { name: 'home', out: 'index.html', path: '/', title: "Linkcardly · Your business card, in a link", description: "Your business card, in a link. Phone, WhatsApp, socials, booking and Save contact on one card. Share it by QR or link.", active: 'how', cta: false, sticky: true, sitemap: true, theme: 'gold' },
  { name: 'designs', out: 'designs/index.html', path: '/designs', title: "Designs · Linkcardly", description: "Digital business card designs for every trade, each in several colourways.", active: 'designs', cta: true, sticky: true, sitemap: true },
  { name: 'teams', out: 'teams/index.html', path: '/teams', title: "Teams · Linkcardly", description: "On-brand digital business cards for your whole team, run from one admin panel.", active: 'teams', cta: true, sticky: true, sitemap: true },
  { name: 'contact', out: 'contact/index.html', path: '/contact', title: "Contact · Linkcardly", description: "Questions about Linkcardly? We reply within one business day.", active: 'contact', cta: false, sticky: false, sitemap: true },
  { name: 'privacy', out: 'privacy/index.html', path: '/privacy', title: "Privacy Policy · Linkcardly", description: "Linkcardly privacy policy.", active: '', cta: true, sticky: true, sitemap: true },
  { name: 'terms', out: 'terms/index.html', path: '/terms', title: "Terms of Service · Linkcardly", description: "Linkcardly terms of service.", active: '', cta: true, sticky: true, sitemap: true },
  { name: 'refunds', out: 'refunds/index.html', path: '/refunds', title: "Refund Policy · Linkcardly", description: "Linkcardly refund policy.", active: '', cta: true, sticky: true, sitemap: true },
  { name: 'not-found', out: '404.html', path: '/404', title: "Page not found · Linkcardly", description: "Page not found.", active: '', cta: true, sticky: true, sitemap: false }
];
