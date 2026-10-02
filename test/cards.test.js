import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { renderCard } from '../src/views/card-page.js';
import { env, request, stubFetch, json } from './helpers.js';

let f;
afterEach(() => f && f.restore());

const card = (over = {}) => ({ id: 'c1', handle: 'alex', status: 'live', plan: 'basic', theme: 'harbour', full_name: 'Alex Morgan', title: 'Realtor', company: 'Skyline', phone: '+1 555', email: 'a@b.co', links: [
  { type: 'call', url: '+1 (555) 0100', sort_order: 1 }, { type: 'email', url: 'a@b.co', sort_order: 0 }, { type: 'website', url: 'example.com', sort_order: 2, is_visible: false }
], ...over });

const db = c => url => url.includes('/handle_history') ? json([]) : url.includes('/cards?') ? json(c ? [c] : []) : undefined;

test('native card page renders a live card with CSP', async () => {
  f = stubFetch(db(card()));
  const r = await worker.fetch(request('/alex'), env());
  assert.equal(r.status, 200);
  assert.match(r.headers.get('Content-Type'), /text\/html/);
  assert.ok(r.headers.get('content-security-policy'));
  const html = await r.text();
  assert.match(html, /<h1>Alex Morgan<\/h1>/);
  assert.match(html, /href="tel:\+15550100"/);
  assert.ok(html.indexOf('mailto:a@b.co') < html.indexOf('tel:'), 'links sorted by sort_order');
  assert.ok(!html.includes('example.com'), 'hidden links are not rendered');
  assert.match(html, /<link rel="canonical" href="https:\/\/linkcardly.com\/alex">/);
});

test('native card page: query asks only for public columns of live, unexpired cards', async () => {
  f = stubFetch(db(card()));
  await worker.fetch(request('/alex'), env());
  const q = decodeURIComponent(f.calls.find(c => c.url.includes('/cards?')).url);
  assert.match(q, /status=eq\.live/);
  assert.match(q, /or=\(paid_until\.is\.null,paid_until\.gte\.\d{4}-\d{2}-\d{2}\)/);
  assert.ok(!q.includes('edit_token') && !q.includes('select=*'));
});

test('native card page: public reads use the anon key when configured', async () => {
  f = stubFetch(db(card()));
  await worker.fetch(request('/alex'), env({ SUPABASE_ANON_KEY: 'anon-key' }));
  assert.equal(f.calls.find(c => c.url.includes('/cards?')).headers.authorization, 'Bearer anon-key');
});

test('native card page: missing card is a 404 page', async () => {
  f = stubFetch(db(null));
  assert.equal((await worker.fetch(request('/ghost'), env())).status, 404);
});

test('native card page: renamed handle redirects 301 to the new handle', async () => {
  f = stubFetch(url => url.includes('/handle_history') ? json([{ card_id: 'c1', cards: { handle: 'alex-new' } }]) : url.includes('/cards?') ? json([]) : undefined);
  const r = await worker.fetch(request('/alex'), env());
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('Location'), 'https://linkcardly.com/alex-new');
});

test('native card page: a reclaimed handle shows the live card, not the old redirect', async () => {
  f = stubFetch(url => url.includes('/handle_history') ? json([{ card_id: 'old', cards: { handle: 'elsewhere' } }]) : url.includes('/cards?') ? json([card()]) : undefined);
  assert.equal((await worker.fetch(request('/alex'), env())).status, 200);
});

test('native vCard download', async () => {
  f = stubFetch(db(card()));
  const r = await worker.fetch(request('/alex/contact.vcf'), env());
  assert.equal(r.status, 200);
  assert.match(r.headers.get('Content-Type'), /text\/vcard/);
  assert.match(r.headers.get('Content-Disposition'), /filename="alex.vcf"/);
  assert.match(await r.text(), /FN:Alex Morgan/);
});

test('native card page: unknown sub-path is a 404, not the card', async () => {
  f = stubFetch(db(card()));
  assert.equal((await worker.fetch(request('/alex/anything'), env())).status, 404);
  assert.equal((await worker.fetch(request('/alex/contact.vcf/x'), env())).status, 404);
});

test('native card page: Supabase outage returns a 503 page, not an exception', async () => {
  f = stubFetch(() => json({}, 500));
  const r = await worker.fetch(request('/alex'), env());
  assert.equal(r.status, 503);
  assert.match(await r.text(), /Something went wrong/);
});

test('card view: user text is HTML-escaped', () => {
  const html = renderCard(card({ full_name: '<script>alert(1)</script>', bio: '"><img src=x onerror=alert(1)>' }), [], env());
  assert.ok(!html.includes('<script>alert(1)'));
  assert.ok(!html.includes('<img src=x'));
});

test('card view: javascript: links in social/website are neutralised', () => {
  const html = renderCard(card(), [{ type: 'website', url: 'javascript:alert(1)', sort_order: 0 }, { type: 'link', url: 'JAVASCRIPT:alert(1)', sort_order: 1 }], env());
  assert.ok(!/href="javascript:/i.test(html));
});

test('card view: booking, avatar, cover and video URLs must be http(s)', () => {
  const html = renderCard(card({ booking_url: 'javascript:alert(document.cookie)', avatar_url: 'javascript:x', cover_url: 'data:text/html,x', video_url: 'javascript:y', plan: 'motion', cover_focus: '1px;background:url(x)' }), [], env());
  assert.ok(!/javascript:|data:text/i.test(html));
  assert.ok(!html.includes('background:url'));
  assert.ok(renderCard(card({ booking_url: 'https://cal.com/alex' }), [], env()).includes('href="https://cal.com/alex"'));
});

test('card view: compliance_html is sanitised to an allow-list', () => {
  const html = renderCard(card({ compliance_html: '<p onclick="x()">Licence <strong>123</strong> <a href="https://www.trec.texas.gov/x" style="x">TREC</a> <a href="javascript:alert(1)">bad</a></p><img src=x onerror=alert(1)><script>alert(2)</script>' }), [], env());
  const block = html.slice(html.indexOf('<footer class="compliance">'), html.indexOf('</footer>'));
  assert.match(block, /<p>Licence <strong>123<\/strong> <a href="https:\/\/www.trec.texas.gov\/x" target="_blank" rel="noopener nofollow">TREC<\/a>/);
  assert.ok(!/onerror|onclick|<script|alert\(2\)|javascript:|style=/.test(block));
});

test('card view: at most 10 icons, lead form only when enabled', () => {
  const links = Array.from({ length: 14 }, (_, i) => ({ type: 'link', url: `https://x.test/${i}`, sort_order: i }));
  const html = renderCard(card(), links, env());
  assert.equal((html.match(/class="ic"/g) || []).length, 10);
  assert.ok(!html.includes('action="/api/lead"'));
  assert.ok(renderCard(card({ lead_form: true }), [], env()).includes('action="/api/lead"'));
});

test('card view: "Powered by" can be switched off', () => {
  assert.ok(renderCard(card(), [], env()).includes('Powered by Linkcardly'));
  assert.ok(!renderCard(card({ powered_by: false }), [], env()).includes('Powered by Linkcardly'));
});

test('card view: video portrait only on the motion plan', () => {
  assert.ok(!renderCard(card({ video_url: 'https://v.test/a.mp4' }), [], env()).includes('<video'));
  assert.ok(renderCard(card({ video_url: 'https://v.test/a.mp4', plan: 'motion' }), [], env()).includes('<video'));
});
