// Native Linkcardly API (MODE = "native"). In proxy mode /api/* goes to routes/proxy.js instead.
import { validateHandle, suggestions } from '../lib/handles.js';
import { db } from '../lib/supabase.js';
import { verifyTurnstile } from '../lib/turnstile.js';
import { json } from '../http.js';

export async function api(parts, req, env, url) {
  const [route] = parts;
  const ip = req.headers.get('CF-Connecting-IP');

  if (route === 'handle' && req.method === 'GET') {
    const v = validateHandle(url.searchParams.get('h'));
    if (!v.ok) return json({ available: false, reason: v.reason });
    const rows = await db(env).select('cards', `handle=eq.${v.handle}&select=id`);
    return rows.length ? json({ available: false, reason: 'Taken', suggestions: suggestions(v.handle) }) : json({ available: true, handle: v.handle });
  }

  if (route === 'order' && req.method === 'POST') {
    const b = await req.json().catch(() => ({}));
    if (!(await verifyTurnstile(env, b.turnstile, ip))) return json({ error: 'Please complete the check.' }, 400);
    const v = validateHandle(b.handle);
    if (!v.ok) return json({ error: v.reason }, 400);
    if (!b.full_name?.trim() || !/.+@.+\..+/.test(b.email || '')) return json({ error: 'Add your full name and a valid email.' }, 400);
    const taken = await db(env).select('cards', `handle=eq.${v.handle}&select=id`);
    if (taken.length) return json({ error: 'That link is taken.', suggestions: suggestions(v.handle) }, 409);
    const card = await db(env).insert('cards', {
      handle: v.handle, status: 'pending', plan: b.plan === 'motion' ? 'motion' : 'basic', theme: String(b.theme || 'folio').slice(0, 40),
      full_name: b.full_name.trim().slice(0, 80), title: (b.title || '').slice(0, 80), company: (b.company || '').slice(0, 80),
      profession: (b.profession || '').slice(0, 40), phone: (b.phone || '').slice(0, 30), email: b.email.slice(0, 120), website: (b.website || '').slice(0, 200)
    });
    const types = ['call', 'whatsapp', 'email', 'website', 'instagram', 'linkedin'];
    const vals = { call: b.phone, whatsapp: b.whatsapp || b.phone, email: b.email, website: b.website, instagram: b.instagram, linkedin: b.linkedin };
    let i = 0;
    for (const t of types) if (vals[t]) await db(env).insert('links', { card_id: card.id, type: t, url: String(vals[t]).slice(0, 300), sort_order: i++ });
    return json({ ok: true, handle: v.handle });
  }

  if (route === 'contact' && req.method === 'POST') {
    const b = await req.json().catch(() => ({}));
    if (!(await verifyTurnstile(env, b.turnstile, ip))) return json({ error: 'Please complete the check.' }, 400);
    if (!b.name?.trim() || !/.+@.+\..+/.test(b.email || '') || !b.message?.trim()) return json({ error: 'Add your name, email and a message.' }, 400);
    await db(env).insert('contact_messages', { name: b.name.slice(0, 80), email: b.email.slice(0, 120), phone: (b.phone || '').slice(0, 30), message: b.message.slice(0, 4000) });
    return json({ ok: true });
  }

  if (route === 'lead' && req.method === 'POST') {
    const f = await req.formData();
    if (!(await verifyTurnstile(env, f.get('cf-turnstile-response'), ip))) return new Response('Please complete the check.', { status: 400 });
    const handle = validateHandle(f.get('handle')).handle;
    const rows = await db(env).select('cards', `handle=eq.${handle}&status=eq.live&select=id`);
    if (!rows[0]) return new Response('Not found', { status: 404 });
    await db(env).insert('leads', { card_id: rows[0].id, name: String(f.get('name') || '').slice(0, 80), phone: String(f.get('phone') || '').slice(0, 30), message: String(f.get('message') || '').slice(0, 2000) });
    return Response.redirect(`${env.SITE_URL}/${handle}?sent=1`, 303);
  }

  if (route === 'qr' && req.method === 'GET') {
    // TODO: port the QR generator from the existing card product (no external dependency).
    const u = url.searchParams.get('u') || env.SITE_URL;
    return Response.redirect(`https://api.qrserver.com/v1/create-qr-code/?size=480x480&margin=12&data=${encodeURIComponent(u)}`, 302);
  }

  return json({ error: 'Not found' }, 404);
}
