/* OrderDone: the screen after a successful order (or saved edit).
 *
 *   OrderDone
 *   ├── celebration  confetti, the customer's card with a tick stamp (or just the tick), title and text
 *   ├── link         QR code, the card link, a reassurance line, and Open card / Copy link / Download QR
 *   ├── edit         "Edit your card yourself": the private edit link, Copy and "Edit my card now"
 *   ├── change       "Prefer we make the change? Request a change"
 *   ├── order        order number with Copy
 *   └── footer       one secondary action (Order another card / Keep editing) and Back to home
 * Sections without data are left out (no edit token → no edit section, no order number → no order row).
 *
 * Presentational. Exposed as window.LcOrderDone and used through
 *   <x-import component-from-global-scope="LcOrderDone" from="/app/components/order-done.js" …>
 * Plain React.createElement (React comes from the page runtime), so no build step or Babel.
 *
 * Props
 *   title, text      heading and line under it
 *   card             { img, name, title } for the small card picture, or null to show only the tick
 *   linkLabel        the card link as shown, e.g. "linkcardly.com/ryancollins"
 *   linkNote         reassurance line under the link
 *   qrSvg            the QR code as an SVG string
 *   openHref         where "Open card" goes
 *   onCopyLink, copyLabel, onDownloadQr
 *   editLabel        shortened private edit link, or '' to hide the edit section
 *   editHref         the full edit link
 *   onCopyEdit, copyEditLabel
 *   editNote         shown instead of the edit section when there's no edit link here (e.g. it was emailed after payment)
 *   changeHref       "Request a change" link, or '' to hide it
 *   orderNo, onCopyOrder, copyOrderLabel
 *   secondaryLabel, onSecondary, secondaryIcon ('plus' | '')   the footer button
 *   homeHref         "Back to home"
 */
(function () {
  var CSS_ID = 'lc-order-done-css';
  var CSS_HREF = (function () {
    try { return new URL('order-done.css', document.currentScript.src).href; } catch (e) { return '/app/components/order-done.css'; }
  })();
  function ensureCss() {
    if (document.getElementById(CSS_ID)) return;
    var l = document.createElement('link'); l.id = CSS_ID; l.rel = 'stylesheet'; l.href = CSS_HREF;
    document.head.appendChild(l);
  }
  var h = function () { return React.createElement.apply(React, arguments); };
  var P = {
    tick: 'M20 6 9 17l-5-5', open: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6', copy: 'M9 9h11v11H9zM5 15V4h11',
    down: 'M12 4v11M7 10l5 5 5-5M4 20h16', pen: 'M4 20h4L19 9l-4-4L4 16z', lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
    loop: 'M18.2 8.5a3.5 3.5 0 1 1 0 7c-2.5 0-4-3.5-6.2-3.5S8.3 15.5 5.8 15.5a3.5 3.5 0 1 1 0-7c2.5 0 4 3.5 6.2 3.5s3.7-3.5 6.2-3.5z',
    arrow: 'M5 12h14M13 6l6 6-6 6', plus: 'M12 5v14M5 12h14', warn: 'M12 9v4M12 17h.01M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'
  };
  function icon(name, size, sw) {
    return h('svg', { width: size || 18, height: size || 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: sw || 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' }, h('path', { d: P[name] }));
  }
  // Confetti: [left %, top px, kind, colour index, rotation]
  var BITS = [[5, 70, 0, 0, -30], [13, 40, 1, 1, 20], [23, 118, 0, 2, 45], [8, 170, 2, 3, 0], [31, 22, 0, 4, -50], [69, 36, 1, 0, 35],
    [80, 92, 0, 1, -20], [90, 58, 2, 2, 0], [87, 176, 0, 3, 60], [76, 150, 1, 4, -40], [93, 236, 0, 0, 25], [3, 250, 1, 2, -15], [56, 14, 2, 1, 0]];

  function OrderDone(p) {
    ensureCss();
    var stamp = h('span', { className: 'lcd__tick' }, icon('tick', p.card ? 24 : 30, 3.2));
    return h('div', { className: 'lcd' },
      h('div', { className: 'lcd__party', 'aria-hidden': 'true' },
        h('span', { className: 'lcd__glow' }),
        h('svg', { className: 'lcd__arc', viewBox: '0 0 390 300', preserveAspectRatio: 'none' }, h('path', { d: 'M-20 230 C 90 150, 250 300, 410 190 L 410 260 C 260 360, 100 230, -20 300 Z' })),
        BITS.map(function (b, i) { return h('span', { key: i, className: 'lcd__bit lcd__bit--' + (b[2] === 2 ? 'dot' : 'strip') + ' lcd__c' + b[3], style: { left: b[0] + '%', top: b[1] + 'px', transform: 'rotate(' + b[4] + 'deg)', animationDelay: (i % 5) * 0.4 + 's' } }); })),
      h('section', { className: 'lcd__hero' },
        p.card ? h('span', { className: 'lcd__card', 'aria-hidden': 'true' },
          h('span', { className: 'lcd__mini' },
            h('span', { className: 'lcd__mini-ph', style: p.card.img ? { backgroundImage: 'url("' + p.card.img + '")' } : undefined }),
            h('span', { className: 'lcd__mini-name' }, p.card.name), h('span', { className: 'lcd__mini-title' }, p.card.title),
            h('span', { className: 'lcd__mini-btns' }, h('span', null), h('span', null), h('span', null)),
            h('span', { className: 'lcd__mini-save' })),
          stamp) : h('span', { className: 'lcd__solo', 'aria-hidden': 'true' }, stamp),
        h('h1', { className: 'lcd__title', tabIndex: -1, ref: p.titleRef }, p.title),
        p.text ? h('p', { className: 'lcd__text' }, p.text) : null),
      h('div', { className: 'lcd__stack' },
        h('section', { className: 'lcd__panel', 'aria-label': 'Your card link' },
          h('div', { className: 'lcd__link' },
            h('span', { className: 'lcd__qr', role: 'img', 'aria-label': 'QR code for ' + p.linkLabel, dangerouslySetInnerHTML: { __html: p.qrSvg || '' } }),
            h('span', { className: 'lcd__link-txt' },
              h('span', { className: 'lcd__kicker' }, 'YOUR CARD LINK'),
              h('b', { className: 'lcd__url' }, p.linkLabel),
              p.linkNote ? h('span', { className: 'lcd__note' }, h('span', { className: 'lcd__note-ic' }, icon('loop', 14, 2.4)), p.linkNote) : null)),
          h('div', { className: 'lcd__acts' },
            h('a', { className: 'lcd__act', href: p.openHref, target: '_blank', rel: 'noopener' }, icon('open'), 'Open card'),
            h('button', { type: 'button', className: 'lcd__act lcd__act--main', onClick: p.onCopyLink }, icon('copy', 18, 2.2), p.copyLabel || 'Copy link'),
            h('button', { type: 'button', className: 'lcd__act', onClick: p.onDownloadQr }, icon('down'), 'Download QR'))),
        p.editLabel ? h('section', { className: 'lcd__panel lcd__panel--sand', 'aria-label': 'Edit your card' },
          h('div', { className: 'lcd__row' },
            h('span', { className: 'lcd__ic' }, icon('pen')),
            h('span', { className: 'lcd__col' }, h('b', { className: 'lcd__h2' }, 'Edit your card yourself'),
              h('span', { className: 'lcd__sub' }, 'Change your photo, details or style any time with your private edit link. Free, no need to ask us.'))),
          h('div', { className: 'lcd__edit' },
            h('span', { className: 'lcd__lock' }, icon('lock', 16)),
            h('span', { className: 'lcd__edit-url' }, p.editLabel),
            h('button', { type: 'button', className: 'lcd__pill', onClick: p.onCopyEdit }, p.copyEditLabel || 'Copy')),
          h('a', { className: 'lcd__dark', href: p.editHref }, 'Edit my card now', icon('arrow', 16, 2.4)),
          h('span', { className: 'lcd__warn' }, icon('warn', 14, 2.2), 'Keep it private. Anyone with this link can edit your card.')) : null,
        !p.editLabel && p.editNote ? h('section', { className: 'lcd__panel lcd__panel--sand lcd__row', 'aria-label': 'Edit your card' },
          h('span', { className: 'lcd__ic' }, icon('pen')),
          h('span', { className: 'lcd__col' }, h('b', { className: 'lcd__h2' }, 'Edit your card yourself'), h('span', { className: 'lcd__sub' }, p.editNote))) : null,
        p.changeHref ? h('a', { className: 'lcd__change', href: p.changeHref, target: '_blank', rel: 'noopener' },
          h('span', null, p.editLabel ? 'Prefer we make the change?' : 'Need a change? We’ll update your card.'), h('b', null, 'Request a change →')) : null,
        p.orderNo ? h('section', { className: 'lcd__panel lcd__order', 'aria-label': 'Order number' },
          h('span', { className: 'lcd__col' }, h('span', { className: 'lcd__sub' }, 'Order number'), h('b', { className: 'lcd__no' }, p.orderNo),
            h('span', { className: 'lcd__fine' }, 'Keep this for support or future changes.')),
          h('button', { type: 'button', className: 'lcd__pill', onClick: p.onCopyOrder }, p.copyOrderLabel || 'Copy')) : null,
        h('div', { className: 'lcd__foot' },
          p.secondaryLabel ? h('button', { type: 'button', className: 'lcd__glass', onClick: p.onSecondary }, p.secondaryIcon ? icon(p.secondaryIcon, 16, 2.4) : null, p.secondaryLabel) : h('span'),
          h('a', { className: 'lcd__home', href: p.homeHref }, 'Back to home', icon('arrow', 16, 2.4)))));
  }
  window.LcOrderDone = OrderDone;
})();
