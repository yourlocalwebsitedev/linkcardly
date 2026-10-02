// Native card pages: /<handle> and /<handle>/contact.vcf (MODE = "native").
import { validateHandle } from '../lib/handles.js';
import { db } from '../lib/supabase.js';
import { buildVCard } from '../lib/vcard.js';
import { renderCard } from '../views/card-page.js';
import { notFound } from '../http.js';

async function loadCard(env, handle) {
  const hist = await db(env).select('handle_history', `old_handle=eq.${encodeURIComponent(handle)}&select=card_id,cards(handle)`).catch(() => []);
  if (hist[0]?.cards?.handle) return { redirect_to: hist[0].cards.handle };
  const rows = await db(env).select('cards', `handle=eq.${encodeURIComponent(handle)}&status=eq.live&select=*,links(*)`);
  return rows[0] || null;
}

export async function serveCard(req, env, parts) {
  const v = validateHandle(parts[0]);
  if (!v.ok) return notFound(env, req);
  const card = await loadCard(env, v.handle);
  if (!card) return notFound(env, req);
  if (card.redirect_to) return Response.redirect(`${env.SITE_URL}/${card.redirect_to}`, 301);
  if (parts[1] === 'contact.vcf') {
    const vcf = buildVCard({ ...card, public_url: `${env.SITE_URL}/${card.handle}` });
    return new Response(vcf, { headers: { 'Content-Type': 'text/vcard; charset=utf-8', 'Content-Disposition': `attachment; filename="${card.handle}.vcf"` } });
  }
  return new Response(renderCard(card, card.links || [], env), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' } });
}
