// A small stand-in for Supabase's PostgREST API over the PGlite live database (test/support/live-db.mjs), so the
// end-to-end suite runs the browser against the real SQL (place_order, RLS, grants, triggers) instead of mocks.
// Each request runs in its own transaction as the `anon` role, with `request.headers` set the way PostgREST sets it,
// and errors come back in PostgREST's shape and status codes. Only the parts the app and the tests use are here:
//   POST   /rest/v1/rpc/<fn>              named arguments as a JSON object
//   GET    /rest/v1/<table>?select=…&col=eq.value&limit=n
//   POST   /rest/v1/<table>               insert (object or array)
//   PATCH  /rest/v1/<table>?col=eq.value  update
//   DELETE /rest/v1/<table>?col=eq.value  delete
// Anything else answers 404. It trusts nothing from the caller: the role is always anon.

const IDENT = /^[a-z_][a-z0-9_]*$/;
const q = id => { if (!IDENT.test(id)) throw Object.assign(new Error('bad identifier'), { code: 'PGRST100', status: 400 }); return '"' + id + '"'; };

function statusFor(code) {
  if (code === 'P0001') return 400;
  if (code === '42501') return 401;                // PostgREST answers 401 to anon for "permission denied"
  if (code === '42883' || code === '42P01') return 404;
  if (code === '23505') return 409;
  if (/^(22|23)/.test(code || '')) return 400;
  return 500;
}

// Filters: col=eq.value | neq. | is.null — enough for the app and the attack tests.
function where(params, start) {
  const parts = [], vals = [];
  for (const [k, v] of params) {
    if (['select', 'limit', 'order', 'offset'].includes(k)) continue;
    const m = String(v).match(/^(eq|neq|is)\.(.*)$/s);
    if (!m) throw Object.assign(new Error('unsupported filter ' + k), { code: 'PGRST100', status: 400 });
    if (m[1] === 'is') { if (m[2] !== 'null') throw Object.assign(new Error('unsupported filter'), { code: 'PGRST100', status: 400 }); parts.push(q(k) + ' is null'); continue; }
    vals.push(m[2]); parts.push(`${q(k)}::text ${m[1] === 'eq' ? '=' : '<>'} $${start + vals.length}`);
  }
  return { sql: parts.length ? ' where ' + parts.join(' and ') : '', vals };
}

export function createPostgrest(db, { log } = {}) {
  let chain = Promise.resolve();
  const serial = fn => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };

  async function run(headers, fn) {
    return db.transaction(async tx => {
      await tx.exec('set local role anon');
      await tx.query(`select set_config('request.headers', $1, true), set_config('request.jwt.claim.role', 'anon', true)`, [JSON.stringify(headers)]);
      return fn(tx);
    });
  }

  async function handle({ method, url, headers = {}, body }) {
    const u = new URL(url), path = u.pathname.replace(/^\/rest\/v1\/?/, '');
    const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
    if (!h.apikey) return { status: 401, body: { message: 'No API key found in request', hint: 'No `apikey` request header or url param was found.' } };
    let json = null;
    if (body) { try { json = JSON.parse(body); } catch (e) { return { status: 400, body: { code: 'PGRST102', message: 'Empty or invalid json' } }; } }
    try {
      const out = await serial(async () => {
        const rpc = path.match(/^rpc\/([a-z_][a-z0-9_]*)$/);
        if (rpc) {
          if (method !== 'POST' && method !== 'GET') return { status: 405, body: { message: 'method not allowed' } };
          const fn = rpc[1], args = json || {};
          const meta = (await db.query(`select p.proargnames, p.pronargs, p.proretset, t.typname
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_type t on t.oid = p.prorettype
            where n.nspname = 'public' and p.proname = $1`, [fn])).rows;
          const names = Object.keys(args);
          const match = meta.find(m => { const an = (m.proargnames || []).slice(0, m.pronargs); return names.every(n => an.includes(n)); });
          if (!match) return { status: 404, body: { code: 'PGRST202', message: `Could not find the function public.${fn}(${names.join(', ')}) in the schema cache` } };
          const call = `public.${q(fn)}(${names.map((n, i) => `${q(n)} => $${i + 1}`).join(', ')})`;
          const vals = names.map(n => (args[n] !== null && typeof args[n] === 'object') ? JSON.stringify(args[n]) : args[n]);
          return run(h, async tx => {
            if (match.proretset) return { status: 200, body: (await tx.query(`select * from ${call}`, vals)).rows };
            const r = (await tx.query(`select ${call} as r`, vals)).rows[0].r;
            return match.typname === 'void' ? { status: 204, body: null } : { status: 200, body: r };
          });
        }
        const tm = path.match(/^([a-z_][a-z0-9_]*)$/);
        if (!tm) return { status: 404, body: { message: 'not found' } };
        const table = 'public.' + q(tm[1]), params = [...u.searchParams];
        if (method === 'GET') {
          const sel = (u.searchParams.get('select') || '*').split(',').map(s => s.trim()).filter(Boolean).map(s => s === '*' ? '*' : q(s)).join(', ');
          const w = where(params, 0), lim = Math.min(Number(u.searchParams.get('limit')) || 1000, 1000);
          return run(h, async tx => ({ status: 200, body: (await tx.query(`select ${sel} from ${table}${w.sql} limit ${lim}`, w.vals)).rows }));
        }
        const ret = /return=representation/.test(h.prefer || '');
        if (method === 'POST') {
          const rows = Array.isArray(json) ? json : [json || {}];
          return run(h, async tx => {
            const out = [];
            for (const row of rows) {
              const cols = Object.keys(row); const vals = cols.map(c => (row[c] !== null && typeof row[c] === 'object') ? JSON.stringify(row[c]) : row[c]);
              const r = await tx.query(`insert into ${table} (${cols.map(q).join(', ')}) values (${cols.map((_, i) => '$' + (i + 1)).join(', ')})${ret ? ' returning *' : ''}`, vals);
              out.push(...r.rows);
            }
            return { status: 201, body: ret ? out : null };
          });
        }
        if (method === 'PATCH' || method === 'DELETE') {
          return run(h, async tx => {
            if (method === 'DELETE') { const w = where(params, 0); const r = await tx.query(`delete from ${table}${w.sql}${ret ? ' returning *' : ''}`, w.vals); return { status: ret ? 200 : 204, body: ret ? r.rows : null, affected: r.affectedRows }; }
            const cols = Object.keys(json || {}); const vals = cols.map(c => (json[c] !== null && typeof json[c] === 'object') ? JSON.stringify(json[c]) : json[c]);
            const w = where(params, cols.length);
            const r = await tx.query(`update ${table} set ${cols.map((c, i) => `${q(c)} = $${i + 1}`).join(', ')}${w.sql}${ret ? ' returning *' : ''}`, [...vals, ...w.vals]);
            return { status: ret ? 200 : 204, body: ret ? r.rows : null, affected: r.affectedRows };
          });
        }
        return { status: 405, body: { message: 'method not allowed' } };
      });
      log && log(method, path, out.status);
      return out;
    } catch (e) {
      const code = e.code || '', status = e.status || statusFor(code);
      log && log(method, path, status, e.message);
      return { status, body: { code, details: e.detail || null, hint: e.hint || null, message: e.message } };
    }
  }

  // Playwright: serve every request to the Supabase project from this database. `ip` is the client address
  // PostgREST would see (rate limits are per address), so separate customers can use separate addresses.
  async function attach(page, supabaseUrl, ip = '203.0.113.10') {
    await page.route(supabaseUrl.replace(/\/$/, '') + '/rest/v1/**', async route => {
      const r = route.request();
      const res = await handle({ method: r.method(), url: r.url(), headers: { ...r.headers(), 'x-forwarded-for': ip }, body: r.postData() });
      await route.fulfill({ status: res.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: res.body == null ? '' : JSON.stringify(res.body) });
    });
  }

  return { handle, attach };
}
