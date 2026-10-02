export const SITE_URL = 'https://linkcardly.com';

// Public Turnstile site key. In proxy mode the NexBizRise worker verifies the token, so this must be
// the widget that worker holds the secret for (same key as public/app/order.html). linkcardly.com
// must be in that widget's allowed hostnames.
export const TURNSTILE_SITE_KEY = '0x4AAAAAAFIAJl64rp47Hazn';

// [label, href, key]
export const NAV = [
  ['How it works', '/#how', 'how'],
  ['Designs', '/designs', 'designs'],
  ['Pricing', '/#pricing', 'pricing'],
  ['Teams', '/teams', 'teams'],
  ['Contact', '/contact', 'contact']
];

export const FOOTER_LINKS = [
  ['Designs', '/designs'], ['Pricing', '/#pricing'], ['Create', '/create'], ['Teams', '/teams'], ['Contact', '/contact'],
  ['Privacy', '/privacy'], ['Terms', '/terms'], ['Refunds', '/refunds']
];
