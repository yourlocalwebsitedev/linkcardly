// Native card pages: /<handle> and /<handle>/contact.vcf (MODE = "native").
import { validateHandle } from '../lib/handles.js';
import { db } from '../lib/supabase.js';
import { buildVCard } from '../lib/vcard.js';
import { renderCard } from '../views/card-page.js';
import { notFound } from '../http.js';

// Columns a public card page may read. Never edit_token; see supabase/migrations/0002.
export const PUBLIC_CARD_COLUMNS = [
  'id', 'handle', 'status', 'plan', 'theme', 'full_name', 'title', 'company', 'profession', 'bio',
  'phone', 'email', 'website', 'address', 'avatar_url', 'cover_url', 'cover_focus', 'video_url',
  'service_area', 'city', 'hours', 'services', 'qualifications', 'practice_areas', 'emergency',
  'licence', 'brokerage', 'compliance_html', 'booking_url', 'booking_label', 'lead_form', 'seasonal',
  'powered_by', 'paid_until'
].join(',');

const today = () => new Date().toISOString().slice(0, 10);
// Live, and either no end date or not yet expired.
export const liveFilter = () => `status=eq.live&or=(paid_until.is.null,paid_until.gte.${today()})`;

async function loadCard(env, handle) {
  const h = encodeURIComponent(handle);
  // The live card wins, so a reclaimed handle is never shadowed by an old rename.
  const rows = await db(env, 'public').select('cards', `handle=eq.${h}&${liveFilter()}&select=${PUBLIC_CARD_COLUMNS},links(*)`);
  if (rows[0]) return rows[0];
  const hist = await db(env).select('handle_history', `old_handle=eq.${h}&select=card_id,cards(handle)`);
  if (hist[0]?.cards?.handle) return { redirect_to: hist[0].cards.handle };
  return null;
}

export async function serveCard(req, env, parts) {
  const v = validateHandle(parts[0]);
  if (!v.ok || parts.length > 2 || (parts[1] && parts[1] !== 'contact.vcf')) return notFound(env, req);
  const card = await loadCard(env, v.handle);
  if (!card) return notFound(env, req);
  if (card.redirect_to) return Response.redirect(`${env.SITE_URL}/${card.redirect_to}${parts[1] ? '/' + parts[1] : ''}`, 301);
  if (parts[1] === 'contact.vcf') {
    const vcf = buildVCard({ ...card, public_url: `${env.SITE_URL}/${card.handle}` });
    return new Response(vcf, { headers: { 'Content-Type': 'text/vcard; charset=utf-8', 'Content-Disposition': `attachment; filename="${card.handle}.vcf"`, 'Cache-Control': 'public, max-age=60' } });
  }
  return new Response(renderCard(card, card.links || [], env), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' } });
}
