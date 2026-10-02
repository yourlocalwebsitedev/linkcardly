// Native Linkcardly API (MODE = "native"). In proxy mode /api/* goes to routes/proxy.js instead.
// Errors from db() are thrown as DbError and turned into JSON 5xx by src/index.js.
import { validateHandle, suggestions } from '../lib/handles.js';
import { db } from '../lib/supabase.js';
import { verifyTurnstile } from '../lib/turnstile.js';
import { qrSvg } from '../lib/qr.js';
import { json } from '../http.js';
import { liveFilter } from './cards.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const str = (v, max) => String(v ?? '').trim().slice(0, max);

// JSON or form body → plain object. Unreadable bodies → {}.
async function readBody(req) {
  const type = req.headers.get('Content-Type') || '';
  try {
    if (/application\/json/i.test(type)) return (await req.json()) || {};
    if (/multipart\/form-data|application\/x-www-form-urlencoded/i.test(type)) return Object.fromEntries(await req.formData());
    return JSON.parse(await req.text() || '{}') || {};
  } catch (_) { return {}; }
}

// A handle is taken if a card uses it now, or used it before (old links redirect from it).
async function handleTaken(env, handle) {
  const [cards, hist] = await Promise.all([
    db(env).select('cards', `handle=eq.${handle}&select=id`),
    db(env).select('handle_history', `old_handle=eq.${handle}&select=card_id`)
  ]);
  return cards.length > 0 || hist.length > 0;
}

export async function api(parts, req, env, url) {
  const [route] = parts;
  const ip = req.headers.get('CF-Connecting-IP');

  if (route === 'handle' && req.method === 'GET') {
    const v = validateHandle(url.searchParams.get('h'));
    if (!v.ok) return json({ available: false, reason: v.reason });
    return (await handleTaken(env, v.handle)) ? json({ available: false, reason: 'Taken', suggestions: suggestions(v.handle) }) : json({ available: true, handle: v.handle });
  }

  if (route === 'order' && req.method === 'POST') {
    const b = await readBody(req);
    if (!(await verifyTurnstile(env, b.turnstile, ip))) return json({ error: 'Please complete the check.' }, 400);
    const v = validateHandle(b.handle);
    if (!v.ok) return json({ error: v.reason }, 400);
    if (!str(b.full_name, 80) || !EMAIL_RE.test(str(b.email, 120))) return json({ error: 'Add your full name and a valid email.' }, 400);
    if (await handleTaken(env, v.handle)) return json({ error: 'That link is taken.', suggestions: suggestions(v.handle) }, 409);
    let card;
    try {
      card = await db(env).insert('cards', {
        handle: v.handle, status: 'pending', plan: b.plan === 'motion' ? 'motion' : 'basic', theme: str(b.theme || 'folio', 40),
        full_name: str(b.full_name, 80), title: str(b.title, 80), company: str(b.company, 80),
        profession: str(b.profession, 40), phone: str(b.phone, 30), email: str(b.email, 120), website: str(b.website, 200)
      });
    } catch (e) {
      // Lost a race for the handle between the check and the insert.
      if (e.isUniqueViolation) return json({ error: 'That link is taken.', suggestions: suggestions(v.handle) }, 409);
      throw e;
    }
    const vals = { call: b.phone, whatsapp: b.whatsapp || b.phone, email: b.email, website: b.website, instagram: b.instagram, linkedin: b.linkedin };
    const links = Object.entries(vals).filter(([, u]) => str(u, 300)).map(([type, u], i) => ({ card_id: card.id, type, url: str(u, 300), sort_order: i }));
    if (links.length) {
      // One request for all links; if it fails, remove the card so the order can simply be retried.
      try { await db(env).insert('links', links); }
      catch (e) { await db(env).remove('cards', `id=eq.${card.id}`).catch(() => {}); throw e; }
    }
    return json({ ok: true, handle: v.handle });
  }

  if (route === 'contact' && req.method === 'POST') {
    const b = await readBody(req);
    if (!(await verifyTurnstile(env, b.turnstile, ip))) return json({ error: 'Please complete the check.' }, 400);
    if (!str(b.name, 80) || !EMAIL_RE.test(str(b.email, 120)) || !str(b.message, 4000)) return json({ error: 'Add your name, email and a message.' }, 400);
    await db(env).insert('contact_messages', { name: str(b.name, 80), email: str(b.email, 120), phone: str(b.phone, 30), message: str(b.message, 4000) });
    return json({ ok: true });
  }

  if (route === 'lead' && req.method === 'POST') {
    const isForm = /form/i.test(req.headers.get('Content-Type') || '');
    const b = await readBody(req);
    const fail = (msg, status) => isForm ? new Response(msg, { status }) : json({ error: msg }, status);
    if (!(await verifyTurnstile(env, b['cf-turnstile-response'] || b.turnstile || b.ts, ip))) return fail('Please complete the check.', 400);
    const v = validateHandle(b.handle || b.slug);
    if (!v.ok) return fail('Not found', 404);
    if (!str(b.name, 80) && !str(b.phone, 30) && !str(b.email, 120)) return fail('Add your name and a way to reach you.', 400);
    const rows = await db(env).select('cards', `handle=eq.${v.handle}&${liveFilter()}&lead_form=is.true&select=id`);
    if (!rows[0]) return fail('Not found', 404);
    await db(env).insert('leads', { card_id: rows[0].id, name: str(b.name, 80), phone: str(b.phone, 30), email: str(b.email, 120), message: str(b.message, 2000) });
    return isForm ? Response.redirect(`${env.SITE_URL}/${v.handle}?sent=1`, 303) : json({ ok: true });
  }

  if (route === 'qr' && req.method === 'GET') {
    // Only this site's URLs: the endpoint is not a general-purpose QR service.
    const u = url.searchParams.get('u') || env.SITE_URL;
    if (u.length > 200 || (u !== env.SITE_URL && !u.startsWith(env.SITE_URL + '/'))) return json({ error: 'Unsupported URL' }, 400);
    return new Response(qrSvg(u), { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' } });
  }

  return json({ error: 'Not found' }, 404);
}
