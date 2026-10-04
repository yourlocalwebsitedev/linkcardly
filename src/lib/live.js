// The live database (supabase/live/*.sql) as the Worker sees it in native mode: SECURITY DEFINER functions
// and read-only views, called with the publishable key. Requests carry the Worker secret (x-nbr-secret), which
// the database checks (from_worker()) before it lets a call skip the bot gate, use the real client address for
// rate limits (x-nbr-ip) or mark an order paid. The header names are the database's; they stay as they are.
import { TIMEOUTS } from '../config.js';

export class RpcError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code || ''; }
}

const headers = (env, ip) => {
  const h = { apikey: env.SUPABASE_ANON_KEY || '', 'Content-Type': 'application/json' };
  if (env.WORKER_SECRET) h['x-nbr-secret'] = env.WORKER_SECRET;
  if (ip) h['x-nbr-ip'] = ip;
  return h;
};

// Calls public.<fn>(body). Returns the parsed result; throws RpcError on any database error.
// `message` is the database's own text only for errors the SQL raises on purpose (P0001, e.g. "link taken",
// "invalid email"); anything else becomes a generic message so table and function names never reach a browser.
export async function rpc(env, fn, body, { ip } = {}) {
  let r;
  try {
    r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: headers(env, ip), body: JSON.stringify(body || {}), signal: AbortSignal.timeout(TIMEOUTS.db) });
  } catch (e) {
    throw new RpcError(503, 'Something went wrong. Please try again.', 'network');
  }
  const text = await r.text();
  let j = null; try { j = text ? JSON.parse(text) : null; } catch (_) {}
  if (!r.ok) {
    const intended = j && j.code === 'P0001' && typeof j.message === 'string';
    if (!intended) console.error(JSON.stringify({ t: 'db', fn, status: r.status, code: j && j.code, error: String(j && j.message || text).slice(0, 300) }));
    throw new RpcError(r.status >= 500 ? 503 : 400, intended ? j.message : 'Something went wrong. Please try again.', j && j.code);
  }
  return j;
}

// Reads a public view (public_cards, public_card_extras) as an anonymous visitor would.
export async function view(env, name, query) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${name}?${query}`, { headers: { apikey: env.SUPABASE_ANON_KEY || '' }, signal: AbortSignal.timeout(TIMEOUTS.db) });
  if (!r.ok) throw new RpcError(503, 'Something went wrong. Please try again.', 'view');
  return r.json();
}
