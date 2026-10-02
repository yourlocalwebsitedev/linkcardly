const esc = (v = '') => String(v).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');

export function buildVCard(card, photoBase64) {
  const [first = '', ...rest] = (card.full_name || '').trim().split(/\s+/);
  const last = rest.join(' ');
  const lines = [
    'BEGIN:VCARD', 'VERSION:3.0',
    `N:${esc(last)};${esc(first)};;;`,
    `FN:${esc(card.full_name)}`,
    card.company && `ORG:${esc(card.company)}`,
    card.title && `TITLE:${esc(card.title)}`,
    card.phone && `TEL;TYPE=CELL:${esc(card.phone)}`,
    card.email && `EMAIL;TYPE=INTERNET:${esc(card.email)}`,
    card.website && `URL:${esc(card.website)}`,
    card.address && `ADR;TYPE=WORK:;;${esc(card.address)};;;;`,
    `URL;TYPE=Linkcardly:${esc(card.public_url)}`,
    photoBase64 && `PHOTO;ENCODING=b;TYPE=JPEG:${photoBase64}`,
    'END:VCARD'
  ].filter(Boolean);
  return lines.join('\r\n');
}
