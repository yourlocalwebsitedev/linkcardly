// Allow-list HTML sanitiser for small admin-provided blocks (e.g. compliance_html).
// Keeps a few formatting tags with no attributes, and <a> with an https/mailto/tel href only.
// Everything else (scripts, event handlers, styles, iframes, unknown tags) is dropped; text is escaped.
const ALLOWED = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'small', 'span']);
const escText = s => s.replace(/&(?!(?:#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,31});)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// Returns the URL if it uses an allowed scheme, else ''.
export function safeUrl(u, schemes = ['https:']) {
  const v = String(u ?? '').trim();
  if (!v) return '';
  try { return schemes.includes(new URL(v).protocol) ? v : ''; } catch (_) { return ''; }
}

export function sanitizeHtml(html) {
  // Drop script/style blocks with their contents first.
  const src = String(html ?? '').replace(/<(script|style|template|iframe|object|noscript)\b[\s\S]*?<\/\1\s*>/gi, '');
  return src.replace(/<(\/?)([a-z][a-z0-9]*)\b([^>]*)>|<!--[\s\S]*?-->|[^<]+|</gi, (m, close, tag, attrs) => {
    if (m.startsWith('<!--')) return '';
    if (!tag) return escText(m);
    const t = tag.toLowerCase();
    if (t === 'a') {
      if (close) return '</a>';
      const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(attrs || '');
      const url = href ? safeUrl(href[1] ?? href[2] ?? href[3], ['https:', 'mailto:', 'tel:']) : '';
      return url ? `<a href="${escAttr(url)}" target="_blank" rel="noopener nofollow">` : '<a>';
    }
    if (!ALLOWED.has(t)) return '';
    return close ? (t === 'br' ? '' : `</${t}>`) : `<${t}>`;
  });
}
