/* LcAdminPartners: the Partners tab on /admin (partner programme, supabase/live/linkcardly.sql).
 *
 *   LcAdminPartners
 *   ├── overview   active partners, scans, sales, unpaid
 *   ├── add        name, phone, email, code, card link, UPI → admin_partner_create; then the welcome message
 *   │              (Copy, WhatsApp, QR). The private partner link is shown only then.
 *   ├── partners   admin_partners(): scans, sales, unpaid, status; Pause/Resume (admin_partner_set), New link;
 *   │              click a partner → their page as they see it (admin_partner_view)
 *   └── payouts    "Prepare payouts" (admin_payouts_prepare for this month) → admin_payout_sheet(): who to pay by UPI;
 *                  UPI reference + Mark paid (admin_payout_mark_paid). Run at the end of each month.
 *
 * Exposed as window.LcAdminPartners, mounted with <x-import component-from-global-scope="LcAdminPartners" …>.
 * Plain React.createElement (React comes from the page runtime). Styles in admin-partners.css use the admin page's
 * theme variables, so it follows light and dark.
 *
 * Props
 *   sb      the admin page's signed-in Supabase client (every call is checked as admin by the database)
 *   toast   (message) => void
 */
(function () {
  var CSS_ID = 'lc-admin-partners-css';
  var CSS_HREF = (function () { try { return new URL('admin-partners.css', document.currentScript.src).href; } catch (e) { return '/app/components/admin-partners.css'; } })();
  function ensureCss() { if (document.getElementById(CSS_ID)) return; var l = document.createElement('link'); l.id = CSS_ID; l.rel = 'stylesheet'; l.href = CSS_HREF; document.head.appendChild(l); }
  var h = function () { return React.createElement.apply(React, arguments); };
  var inr = function (n) { return '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN'); };
  var month = function () { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
  var monthName = function (k) { return new Date(k + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }); };
  var EMPTY = { full_name: '', phone: '', email: '', code: '', handle: '', upi_id: '' };
  var ERR = { 'code taken': 'That code is taken. Try another.', 'link taken': 'That card link is taken. Try another.', 'email already a partner': 'This email is already a partner.',
    'invalid phone': 'Enter a 10-digit Indian mobile number.', 'invalid email': 'Enter a valid email.', 'invalid link': 'Card link: 3–30 letters, numbers or -.', 'name required': 'Enter their name.', 'not allowed': 'Sign in as an admin.' };
  var why = function (e) { var m = (e && e.message) || ''; return ERR[m] || m || 'Something went wrong. Please try again.'; };

  function welcome(r, f) {
    var first = String(f.full_name).trim().split(' ')[0];
    return 'Hi ' + first + ', welcome to Linkcardly partners!\n\n'
      + 'Your link (share it or print the QR): ' + r.qr_link.replace('https://', '') + '\n'
      + 'Your followers get ₹100 off. You earn ₹200 for every paid card, paid at the end of each month by UPI.\n\n'
      + 'Your free card: ' + r.card_link.replace('https://', '') + '\n'
      + 'Edit your card: ' + r.edit_link + '\n'
      + 'Your partner page: ' + r.partner_link + '\n'
      + 'PIN: the last 4 digits of your phone (' + r.pin + ')\n\nKeep these links private.';
  }
  function downloadQr(link, code) {
    try { var q = window.qrcode(0, 'M'); q.addData(link); q.make(); var img = new Image();
      img.onload = function () { var c = document.createElement('canvas'); c.width = c.height = 1024; var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 1024, 1024); x.imageSmoothingEnabled = false; x.drawImage(img, 0, 0, 1024, 1024);
        var a = document.createElement('a'); a.download = 'linkcardly-' + String(code).toLowerCase() + '-qr.png'; a.href = c.toDataURL('image/png'); a.click(); };
      img.src = q.createDataURL(8, 4); } catch (e) {}
  }

  class LcAdminPartners extends React.Component {
    constructor(p) { super(p); this.state = { list: null, sheet: [], f: Object.assign({}, EMPTY), busy: false, msg: '', made: null, madeMsg: '', utr: {}, link: null }; ensureCss(); }
    componentDidMount() { this.load(); }
    toast(m) { if (this.props.toast) this.props.toast(m); }
    async rpc(fn, args) { var r = await this.props.sb.rpc(fn, args || {}); if (r.error) throw r.error; return r.data; }
    async load() {
      try { var list = await this.rpc('admin_partners'), sheet = await this.rpc('admin_payout_sheet'); this.setState({ list: list || [], sheet: sheet || [] }); }
      catch (e) { this.setState({ list: [], msg: why(e) }); }
    }
    async add(e) {
      e.preventDefault(); var f = this.state.f; if (this.state.busy) return;
      this.setState({ busy: true, msg: '' });
      try { var r = await this.rpc('admin_partner_create', { p: f }); this.setState({ busy: false, made: Object.assign({}, r, { phone: f.phone }), madeMsg: welcome(r, f), f: Object.assign({}, EMPTY) }); this.load(); }
      catch (err) { this.setState({ busy: false, msg: why(err) }); }
    }
    async toggle(p) {
      try { await this.rpc('admin_partner_set', { p_id: p.id, p_status: p.status === 'approved' ? 'paused' : 'approved' }); this.toast(p.status === 'approved' ? 'Paused. Their code stops working.' : 'Active again.'); this.load(); }
      catch (e) { this.toast(why(e)); }
    }
    async newLink(p) {
      if (!window.confirm('Make a new private partner link for ' + p.name + '? Their old link stops working.')) return;
      try { var r = await this.rpc('admin_partner_new_link', { p_id: p.id }); this.setState({ link: { name: p.name, phone: p.phone, url: r.partner_link } }); }
      catch (e) { this.toast(why(e)); }
    }
    async prepare() {
      try { var r = await this.rpc('admin_payouts_prepare', { p_period: month() }); this.toast(r.length ? r.length + ' payout' + (r.length > 1 ? 's' : '') + ' ready.' : 'Nobody is due ₹500 or more yet.'); this.load(); }
      catch (e) { this.toast(why(e)); }
    }
    async paid(o) {
      var ref = String(this.state.utr[o.payout_id] || '').trim(); if (!ref) { this.toast('Enter the UPI reference first.'); return; }
      try { await this.rpc('admin_payout_mark_paid', { p_id: o.payout_id, p_method: 'UPI', p_reference: ref }); this.toast('Marked paid: ' + o.name + ' · ' + inr(o.net)); this.load(); }
      catch (e) { this.toast(why(e)); }
    }
    async view(p) {
      this.setState({ open: { id: p.id, name: p.name, data: null } });
      try { var d = await this.rpc('admin_partner_view', { p_id: p.id }); this.setState({ open: { id: p.id, name: p.name, data: d } }); }
      catch (e) { this.setState({ open: null }); this.toast(why(e)); }
    }
    detail() {
      var self = this, o = this.state.open, d = o.data;
      var close = h('button', { type: 'button', className: 'lap-btn lap-btn--ghost', onClick: function () { self.setState({ open: null }); } }, 'Back to all partners');
      if (!d) return h('section', { className: 'lap-box' }, h('h2', null, o.name), h('p', { className: 'lap-note' }, 'Loading…'), h('div', { className: 'lap-row' }, close));
      var p = d.partner, t = d.totals || {}, STATUS = { pending: 'Waiting', approved: 'Ready to pay', paid: 'Paid', reversed: 'Refunded', rejected: 'Not counted' };
      var stat = function (l, v) { return h('div', { className: 'lap-stat' }, h('span', null, l), h('b', null, v)); };
      var qr = ''; try { var q = window.qrcode(0, 'M'); q.addData(p.link); q.make(); qr = q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); } catch (e) {}
      var sales = (d.commissions || []).filter(function (c) { return c.kind === 'sale' || c.amount < 0; });
      var date = function (s) { return new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); };
      return h('section', { className: 'lap-box lap-view' },
        h('div', { className: 'lap-row lap-between' }, h('h2', null, p.name + "'s partner page"), close),
        h('p', { className: 'lap-note' }, 'What ' + String(p.name).split(' ')[0] + ' sees after their PIN. ' + inr(p.commission) + ' per sale · code ' + p.code + ' · ' + (d.payout_details.upi || 'no UPI ID yet')),
        h('div', { className: 'lap-stats lap-stats5' }, stat('Scans (30 days)', t.clicks_30d || 0), stat('Sales', t.orders || 0), stat('Waiting (15 days)', inr(t.pending)), stat('Ready to pay', inr(t.ready)), stat('Paid to them', inr(t.paid))),
        h('div', { className: 'lap-share' }, h('div', { className: 'lap-qr', dangerouslySetInnerHTML: { __html: qr } }),
          h('div', { className: 'lap' }, h('code', { className: 'lap-code' }, p.link),
            d.card ? h('p', { className: 'lap-note' }, 'Free card: ', h('a', { href: d.card.link, target: '_blank', rel: 'noopener' }, d.card.link.replace('https://', ''))) : null,
            h('div', { className: 'lap-row' }, h('button', { type: 'button', className: 'lap-btn lap-btn--ghost', onClick: function () { self.copy(p.link); } }, 'Copy link'), h('button', { type: 'button', className: 'lap-btn lap-btn--ghost', onClick: function () { downloadQr(p.link, p.code); } }, 'Download QR')))),
        !sales.length ? h('p', { className: 'lap-note' }, 'No sales yet.') :
        h('div', { className: 'lap-scroll' }, h('table', { className: 'lap-table' },
          h('thead', null, h('tr', null, ['Customer', 'Date', 'Plan', 'Earns', 'Status'].map(function (x, i) { return h('th', { key: i, scope: 'col' }, x); }))),
          h('tbody', null, sales.map(function (c, i) { return h('tr', { key: i }, h('th', { scope: 'row' }, c.customer || 'Customer'), h('td', null, date(c.paid_at)), h('td', null, (({ motion: 'Motion', nfc: 'NFC Basic', nfc_custom: 'NFC Custom' })[c.plan] || 'Digital')), h('td', null, inr(c.amount)), h('td', null, STATUS[c.status] || c.status)); })))),
        (d.payouts || []).length ? h('div', { className: 'lap-scroll' }, h('table', { className: 'lap-table' },
          h('thead', null, h('tr', null, ['Month', 'Paid', 'Status'].map(function (x, i) { return h('th', { key: i, scope: 'col' }, x); }))),
          h('tbody', null, d.payouts.map(function (o2, i) { return h('tr', { key: i }, h('th', { scope: 'row' }, monthName(o2.period)), h('td', null, inr(o2.net)), h('td', null, o2.status === 'paid' ? 'Paid ' + date(o2.paid_at) + (o2.reference ? ' · ' + o2.reference : '') : o2.status === 'held' ? 'On hold: ' + o2.hold_reason : 'Due')); })))) : null);
    }
    copy(t) { try { navigator.clipboard.writeText(t); this.toast('Copied'); } catch (e) {} }
    field(k, label, attrs) {
      var self = this; return h('label', { className: 'lap-field' }, label,
        h('input', Object.assign({ className: 'lap-input', value: this.state.f[k], onChange: function (e) { var v = e.target.value; self.setState(function (s) { var f = Object.assign({}, s.f); f[k] = k === 'code' ? v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20) : k === 'handle' ? v.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30) : v; return { f: f }; }); } }, attrs || {})));
    }
    render() {
      var self = this, S = this.state, list = S.list || [];
      var active = list.filter(function (p) { return p.status === 'approved'; }).length;
      var sum = function (k) { return list.reduce(function (a, p) { return a + (Number(p[k]) || 0); }, 0); };
      var stat = function (l, v) { return h('div', { className: 'lap-stat' }, h('span', null, l), h('b', null, v)); };
      var wa = function (phone, text) { return 'https://wa.me/91' + String(phone || '').replace(/\D/g, '').slice(-10) + '?text=' + encodeURIComponent(text); };
      return h('div', { className: 'lap' },
        h('div', { className: 'lap-head' }, h('h1', null, 'Partners'), h('p', null, '₹200 per paid card, ₹100 off for their followers, paid at the end of each month.')),
        h('div', { className: 'lap-stats' }, stat('Active partners', active), stat('Scans', sum('clicks')), stat('Sales', sum('orders')), stat('Unpaid', inr(sum('unpaid')))),

        h('section', { className: 'lap-box' }, h('h2', null, 'Add a partner'),
          S.made ? h('div', { className: 'lap-done' },
              h('p', null, h('b', null, 'Added. '), 'Send them this message. The private partner link is shown only now.'),
              h('textarea', { className: 'lap-input lap-msg', rows: 11, readOnly: true, value: S.madeMsg }),
              h('div', { className: 'lap-row' },
                h('button', { type: 'button', className: 'lap-btn', onClick: function () { self.copy(S.madeMsg); } }, 'Copy message'),
                h('a', { className: 'lap-btn lap-btn--ghost', href: wa(S.made.phone, S.madeMsg), target: '_blank', rel: 'noopener' }, 'Send on WhatsApp'),
                h('button', { type: 'button', className: 'lap-btn lap-btn--ghost', onClick: function () { downloadQr(S.made.qr_link, S.made.code); } }, 'Download QR'),
                h('button', { type: 'button', className: 'lap-btn lap-btn--ghost', onClick: function () { self.setState({ made: null, madeMsg: '' }); } }, 'Add another')))
            : h('form', { className: 'lap-form', onSubmit: function (e) { self.add(e); }, noValidate: true },
              this.field('full_name', 'Full name', { autoComplete: 'off' }), this.field('phone', 'Phone', { inputMode: 'tel', placeholder: '98490 12345' }),
              this.field('email', 'Email', { type: 'email' }), this.field('code', 'Code', { placeholder: 'RIYA' }),
              this.field('handle', 'Card link', { placeholder: 'riyasen' }), this.field('upi_id', 'UPI ID (optional)', { placeholder: 'name@okaxis', autoCapitalize: 'none' }),
              h('div', { className: 'lap-row lap-full' }, h('button', { type: 'submit', className: 'lap-btn', disabled: S.busy }, S.busy ? 'Adding…' : 'Add partner'), S.msg ? h('span', { className: 'lap-err', role: 'alert' }, S.msg) : null),
              h('p', { className: 'lap-note lap-full' }, 'Creates their code, a free Digital card at linkcardly.com/<card link> and their private partner page. PIN = last 4 digits of their phone.'))),

        S.link ? h('section', { className: 'lap-box' }, h('h2', null, 'New link for ' + S.link.name),
          h('p', { className: 'lap-note' }, 'Their old link no longer works. Send this one; the PIN stays the last 4 digits of their phone.'),
          h('div', { className: 'lap-row' }, h('code', { className: 'lap-code' }, S.link.url),
            h('button', { type: 'button', className: 'lap-btn', onClick: function () { self.copy(S.link.url); } }, 'Copy'),
            h('a', { className: 'lap-btn lap-btn--ghost', href: wa(S.link.phone, 'Your new Linkcardly partner page: ' + S.link.url), target: '_blank', rel: 'noopener' }, 'WhatsApp'),
            h('button', { type: 'button', className: 'lap-btn lap-btn--ghost', onClick: function () { self.setState({ link: null }); } }, 'Done'))) : null,

        S.open ? this.detail() : null,

        h('section', { className: 'lap-box', hidden: !!S.open }, h('h2', null, 'All partners'), h('p', { className: 'lap-note' }, 'Click a name to see their partner page as they see it.'),
          S.list === null ? h('p', { className: 'lap-note' }, 'Loading…') : !list.length ? h('p', { className: 'lap-note' }, 'No partners yet. Add your first one above.') :
          h('div', { className: 'lap-scroll', tabIndex: 0, role: 'region', 'aria-label': 'All partners' }, h('table', { className: 'lap-table' },
            h('thead', null, h('tr', null, ['Partner', 'Scans', 'Sales', 'Unpaid', 'Status', ''].map(function (t, i) { return h('th', { key: i, scope: 'col' }, t); }))),
            h('tbody', null, list.map(function (p) {
              return h('tr', { key: p.id },
                h('th', { scope: 'row' }, h('button', { type: 'button', className: 'lap-link', onClick: function () { self.view(p); } }, p.name), h('small', null, p.code + (p.has_upi ? '' : ' · no UPI ID'))),
                h('td', null, p.clicks), h('td', null, p.orders), h('td', null, inr(p.unpaid)),
                h('td', null, h('span', { className: 'lap-pill lap-pill--' + p.status }, p.status === 'approved' ? 'Active' : p.status === 'paused' ? 'Paused' : p.status)),
                h('td', { className: 'lap-acts' },
                  h('button', { type: 'button', className: 'lap-mini', onClick: function () { self.toggle(p); } }, p.status === 'approved' ? 'Pause' : 'Resume'),
                  h('button', { type: 'button', className: 'lap-mini', onClick: function () { self.newLink(p); } }, 'New link')));
            }))))),

        h('section', { className: 'lap-box' }, h('h2', null, 'Payouts · ' + monthName(month())),
          h('p', { className: 'lap-note' }, 'At month end: press Prepare payouts, pay each partner by UPI, then enter the UPI reference and press Mark paid. Sales count once their 15 days have passed; under ₹500 rolls over.'),
          h('div', { className: 'lap-row' }, h('button', { type: 'button', className: 'lap-btn', onClick: function () { self.prepare(); } }, 'Prepare payouts')),
          !S.sheet.length ? h('p', { className: 'lap-note' }, 'Nothing to pay right now.') :
          h('div', { className: 'lap-scroll' }, h('table', { className: 'lap-table' },
            h('thead', null, h('tr', null, ['Partner', 'Pay to', 'Amount', ''].map(function (t, i) { return h('th', { key: i, scope: 'col' }, t); }))),
            h('tbody', null, S.sheet.map(function (o) {
              return h('tr', { key: o.payout_id },
                h('th', { scope: 'row' }, o.name, h('small', null, o.period)),
                h('td', null, o.upi_id || h('span', { className: 'lap-err' }, 'No UPI ID')),
                h('td', null, inr(o.net), o.tds > 0 ? h('small', null, 'TDS ' + inr(o.tds)) : null),
                h('td', { className: 'lap-acts' }, o.status === 'held' ? h('span', { className: 'lap-err' }, o.hold_reason) : [
                  h('input', { key: 'u', className: 'lap-input lap-utr', placeholder: 'UPI reference', 'aria-label': 'UPI reference for ' + o.name, value: S.utr[o.payout_id] || '', onChange: function (e) { var v = e.target.value; self.setState(function (s) { var u = Object.assign({}, s.utr); u[o.payout_id] = v; return { utr: u }; }); } }),
                  h('button', { key: 'b', type: 'button', className: 'lap-btn', onClick: function () { self.paid(o); } }, 'Mark paid')]));
            }))))));
    }
  }
  window.LcAdminPartners = LcAdminPartners;
})();
