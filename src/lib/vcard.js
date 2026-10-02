// RFC 2426 text escaping. CR and LF both become "\n" so a field can never start a new property.
const esc = (v = '') => String(v ?? '').replace(/\\/g, '\\\\').replace(/\r\n?|\n/g, '\\n').replace(/([,;])/g, '\\$1');

// Folds a content line at 75 octets (continuation lines start with one space), never splitting a UTF-8 character.
const utf8 = new TextEncoder();
export function fold(line) {
  const out = [];
  let cur = '', bytes = 0, limit = 75;
  for (const ch of line) {
    const n = utf8.encode(ch).length;
    if (bytes + n > limit) { out.push(cur); cur = ' '; bytes = 1; limit = 75; }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.join('\r\n');
}

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
  return lines.map(fold).join('\r\n');
}
