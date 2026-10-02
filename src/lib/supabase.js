// Minimal Supabase REST client. Keys stay server-side.
// db(env) uses the service key (bypasses RLS: writes and private tables).
// db(env, 'public') uses SUPABASE_ANON_KEY when it is set, so public reads go through RLS.
import { TIMEOUTS } from '../config.js';

export class DbError extends Error {
  constructor(op, status, body) {
    let code = '';
    try { code = JSON.parse(body).code || ''; } catch (_) {}
    super(`${op}: ${status} ${code}`.trim());
    this.status = status;
    this.code = code;
  }
  get isUniqueViolation() { return this.code === '23505'; }
}

export function db(env, role = 'service') {
  const key = role === 'public' && env.SUPABASE_ANON_KEY ? env.SUPABASE_ANON_KEY : env.SUPABASE_SERVICE_KEY;
  const base = `${env.SUPABASE_URL}/rest/v1`;
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const call = async (op, url, init = {}) => {
    let r;
    try { r = await fetch(url, { ...init, headers: { ...headers, ...init.headers }, signal: AbortSignal.timeout(TIMEOUTS.db) }); }
    catch (e) { throw new DbError(op, 0, JSON.stringify({ code: e && e.name === 'TimeoutError' ? 'timeout' : 'network' })); }
    if (!r.ok) throw new DbError(op, r.status, await r.text());
    return r;
  };
  return {
    async select(table, query) {
      return (await call(`select ${table}`, `${base}/${table}?${query}`)).json();
    },
    // Inserts one row (object) or many (array) in a single request. Returns the inserted row(s).
    async insert(table, rows) {
      const out = await (await call(`insert ${table}`, `${base}/${table}`, { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(rows) })).json();
      return Array.isArray(rows) ? out : out[0];
    },
    async remove(table, query) {
      await call(`delete ${table}`, `${base}/${table}?${query}`, { method: 'DELETE' });
    }
  };
}
