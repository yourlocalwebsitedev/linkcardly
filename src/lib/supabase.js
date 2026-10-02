// Minimal Supabase REST client. Service key stays server-side.
export function db(env) {
  const base = `${env.SUPABASE_URL}/rest/v1`;
  const headers = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json'
  };
  return {
    async select(table, query) {
      const r = await fetch(`${base}/${table}?${query}`, { headers });
      if (!r.ok) throw new Error(`select ${table}: ${r.status}`);
      return r.json();
    },
    async insert(table, row) {
      const r = await fetch(`${base}/${table}`, { method: 'POST', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify(row) });
      if (!r.ok) throw new Error(`insert ${table}: ${r.status} ${await r.text()}`);
      return (await r.json())[0];
    }
  };
}
