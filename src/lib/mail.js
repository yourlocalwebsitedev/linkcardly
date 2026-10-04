// Emails through Resend (RESEND_API_KEY), from MAIL_FROM ("Linkcardly <hello@linkcardly.com>"), replies to ADMIN_EMAIL.
// Off (returns false) until the key is set, so nothing breaks in development or before email is configured.
export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const EMAIL_OK = /^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i;

// One plain, brand-coloured layout for every email. `rows` are HTML snippets (escape user text with esc()),
// `cta` is [label, url] for one button.
export function mailHtml(title, rows, cta) {
  const p = rows.filter(Boolean).map(r => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#201E1D;">${r}</p>`).join('');
  const btn = cta ? `<p style="margin:22px 0 4px;"><a href="${esc(cta[1])}" style="display:inline-block;padding:13px 22px;border-radius:999px;background:#C8552D;color:#FFFFFF;font-weight:700;font-size:15px;text-decoration:none;">${esc(cta[0])}</a></p>` : '';
  return '<!doctype html><html><body style="margin:0;background:#F5EAD8;">'
    + '<div style="max-width:560px;margin:0 auto;padding:32px 24px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;">'
    + '<p style="margin:0 0 24px;font-size:20px;font-weight:700;color:#201E1D;font-family:Georgia,serif;">link<span style="color:#C8552D;">card</span>ly</p>'
    + `<div style="background:#FFFFFF;border-radius:16px;padding:28px 24px;"><h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#201E1D;">${esc(title)}</h1>${p}${btn}</div>`
    + '<p style="margin:18px 0 0;font-size:12px;line-height:1.5;color:#6B6460;">Linkcardly · linkcardly.com · Reply to this email if you need help.</p>'
    + '</div></body></html>';
}

export async function sendMail(env, to, subject, html) {
  if (!env.RESEND_API_KEY || !EMAIL_OK.test(to || '')) return false;
  const from = env.MAIL_FROM || 'Linkcardly <hello@linkcardly.com>';
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, html, reply_to: env.ADMIN_EMAIL || undefined })
    });
    if (!r.ok) console.error(JSON.stringify({ t: 'mail', status: r.status, subject: subject.slice(0, 60) }));
    return r.ok;
  } catch (e) {
    console.error(JSON.stringify({ t: 'mail', error: String(e && e.message || e) }));
    return false;
  }
}
