/* UpiPay: pay an order by UPI straight to Linkcardly's UPI ID (India), shown after "Place order".
 *
 *   UpiPay
 *   ├── pay      amount, UPI ID with Copy, "Open UPI app" (phones) and the QR code (any UPI app can scan it)
 *   ├── confirm  "Enter your UPI reference (UTR)": 12 digits and "I've paid", or the "reference received" note
 *   └── switch   "Pay by card, netbanking or wallet instead" (Razorpay, with its fee), when that's on
 * The order stays unpaid until an admin matches the UTR with the credit (Mark paid on /admin).
 *
 * Presentational. Exposed as window.LcUpiPay and used through
 *   <x-import component-from-global-scope="LcUpiPay" from="/app/components/upi-pay.js" …>
 * Plain React.createElement (React comes from the page runtime), so no build step or Babel.
 *
 * Props
 *   amountLabel     e.g. "₹1,179"
 *   vpa, payee      UPI ID and the name shown in UPI apps
 *   uri             upi://pay?… link (button and QR code)
 *   qrSvg           the QR code for uri, as an SVG string
 *   isPhone         show "Open UPI app" first (a upi:// link does nothing on a computer)
 *   onCopyVpa, copyLabel
 *   utr, onUtr      the reference field (digits only, kept by the page)
 *   onSubmit, busy, error
 *   claimed         the reference already sent (e.g. "••••5678"), or '' to show the form
 *   cardLabel, onCard   the switch to Razorpay, or '' to hide it
 */
(function () {
  var CSS_ID = 'lc-upi-pay-css';
  var CSS_HREF = (function () {
    try { return new URL('upi-pay.css', document.currentScript.src).href; } catch (e) { return '/app/components/upi-pay.css'; }
  })();
  function ensureCss() {
    if (document.getElementById(CSS_ID)) return;
    var l = document.createElement('link'); l.id = CSS_ID; l.rel = 'stylesheet'; l.href = CSS_HREF;
    document.head.appendChild(l);
  }
  var h = function () { return React.createElement.apply(React, arguments); };
  var P = { copy: 'M9 9h11v11H9zM5 15V4h11', open: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6', tick: 'M20 6 9 17l-5-5', card: 'M2 6h20v12H2zM2 10h20M6 15h4' };
  function icon(name, size, sw) {
    return h('svg', { width: size || 18, height: size || 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: sw || 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' }, h('path', { d: P[name] }));
  }

  function UpiPay(p) {
    ensureCss();
    var qr = h('span', { className: 'lcu__qr', role: 'img', 'aria-label': 'UPI QR code to pay ' + p.amountLabel, dangerouslySetInnerHTML: { __html: p.qrSvg || '' } });
    var submit = function (e) { e.preventDefault(); if (!p.busy && p.onSubmit) p.onSubmit(); };
    return h('div', { className: 'lcu' },
      h('section', { className: 'lcu__panel', 'aria-label': 'Pay by UPI' },
        h('div', { className: 'lcu__amount' },
          h('span', { className: 'lcu__kicker' }, 'AMOUNT TO PAY'),
          h('b', { className: 'lcu__sum' }, p.amountLabel),
          h('span', { className: 'lcu__free' }, 'No extra charge on UPI')),
        h('div', { className: 'lcu__to' },
          h('span', { className: 'lcu__col' }, h('span', { className: 'lcu__sub' }, 'To ' + (p.payee || 'Linkcardly')), h('b', { className: 'lcu__vpa' }, p.vpa)),
          h('button', { type: 'button', className: 'lcu__pill', onClick: p.onCopyVpa }, icon('copy', 15, 2.2), p.copyLabel || 'Copy')),
        p.isPhone ? h('a', { className: 'lcu__main', href: p.uri }, 'Open UPI app', icon('open', 18, 2.2)) : null,
        h('div', { className: 'lcu__scan' + (p.isPhone ? ' lcu__scan--small' : '') },
          qr,
          h('span', { className: 'lcu__scan-txt' }, p.isPhone ? 'Or scan from another phone.' : 'Scan with Google Pay, PhonePe, Paytm, BHIM or your bank’s UPI app.'))),
      p.claimed
        ? h('section', { className: 'lcu__panel lcu__panel--ok', role: 'status' },
            h('span', { className: 'lcu__ok-ic' }, icon('tick', 20, 3)),
            h('span', { className: 'lcu__col' }, h('b', { className: 'lcu__h2' }, 'Reference ' + p.claimed + ' received'),
              h('span', { className: 'lcu__sub' }, 'We’ll email you as soon as your payment is confirmed. You can close this page.')))
        : h('form', { className: 'lcu__panel lcu__panel--sand', onSubmit: submit, noValidate: true },
            h('label', { className: 'lcu__h2', htmlFor: 'lcu-utr' }, 'After paying, enter the UPI reference'),
            h('span', { className: 'lcu__sub', id: 'lcu-utr-hint' }, 'The 12-digit number in your UPI app’s payment details, called UPI Ref No., UTR or Transaction ID.'),
            h('input', { id: 'lcu-utr', className: 'lcu__input', value: p.utr || '', onChange: p.onUtr, inputMode: 'numeric', autoComplete: 'off', maxLength: 14, placeholder: '12-digit reference',
              'aria-describedby': 'lcu-utr-hint' + (p.error ? ' lcu-utr-err' : ''), 'aria-invalid': p.error ? 'true' : 'false' }),
            p.error ? h('span', { className: 'lcu__err', id: 'lcu-utr-err', role: 'alert' }, p.error) : null,
            h('button', { type: 'submit', className: 'lcu__dark', disabled: !!p.busy }, p.busy ? 'Sending…' : 'I’ve paid')),
      p.cardLabel && !p.claimed ? h('button', { type: 'button', className: 'lcu__switch', onClick: p.onCard }, icon('card', 16, 2), p.cardLabel) : null);
  }
  window.LcUpiPay = UpiPay;
})();
