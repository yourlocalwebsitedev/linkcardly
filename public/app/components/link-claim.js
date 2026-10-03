/* LinkClaim: the "Your link" field on the Your card step. The customer picks the name in their card link
 * (linkcardly.com/<name>), which is also the link inside their QR code.
 *
 *   LinkClaim
 *   ├── note      "You picked this on our home page" (when the name came from /create?h=)
 *   ├── field     prefix + input + status icon (tick, spinner or cross)
 *   ├── status    available / checking / taken (+ free alternatives to tap) / not allowed
 *   └── hint      the naming rules
 *
 * Presentational: the page owns the value and the availability check and passes the result in.
 * Exposed as window.LcLinkClaim and used through
 *   <x-import component-from-global-scope="LcLinkClaim" from="/app/components/link-claim.js" …>
 * Plain React.createElement (React comes from the page runtime), so no build step or Babel.
 *
 * Props
 *   value     the name, e.g. "ryancollins"
 *   prefix    text before the name (default "linkcardly.com/")
 *   status    'ok' | 'checking' | 'taken' | 'invalid' | 'idle'
 *   message   text for 'invalid' (e.g. "Use at least 3 letters or numbers.")
 *   alts      free alternatives shown when taken, e.g. ["ryan-collins", "ryancollins-card"]
 *   fromHome  true when the name was picked on the home page
 *   error     validation message from the page (shown under the field, e.g. on Continue)
 *   inputId   id of the input, so the page can focus it (default "o-handle")
 *   onChange  (value) => void, already lower-cased and stripped to a–z, 0–9 and dashes
 *   onPick    (value) => void, a tapped alternative
 */
(function () {
  var CSS_ID = 'lc-link-claim-css';
  var CSS_HREF = (function () {
    try { return new URL('link-claim.css', document.currentScript.src).href; } catch (e) { return '/app/components/link-claim.css'; }
  })();
  function ensureCss() {
    if (document.getElementById(CSS_ID)) return;
    var l = document.createElement('link'); l.id = CSS_ID; l.rel = 'stylesheet'; l.href = CSS_HREF;
    document.head.appendChild(l);
  }
  var h = function () { return React.createElement.apply(React, arguments); };
  function icon(d, size, sw) {
    return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: sw, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' }, h('path', { d: d }));
  }
  var clean = function (v) { return String(v || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-{2,}/g, '-').slice(0, 30); };

  function LinkClaim(props) {
    ensureCss();
    var status = props.status || 'idle', value = props.value || '', prefix = props.prefix || 'linkcardly.com/';
    var id = props.inputId || 'o-handle', statusId = id + '-status';
    var full = prefix + value;
    var bad = status === 'taken' || status === 'invalid' || !!props.error;
    var mark = status === 'ok' ? h('span', { className: 'lcl__mark lcl__mark--ok', 'aria-hidden': 'true' }, icon('M20 6 9 17l-5-5', 14, 3))
      : status === 'checking' ? h('span', { className: 'lcl__spin', 'aria-hidden': 'true' })
      : bad ? h('span', { className: 'lcl__mark lcl__mark--bad', 'aria-hidden': 'true' }, icon('M18 6 6 18M6 6l12 12', 13, 3)) : null;
    var line = null;
    if (status === 'ok') line = h('p', { className: 'lcl__line' }, h('b', { className: 'lcl__ok' }, full + ' is available.'), ' It’s yours once you pay, and it’s the link inside your QR code.');
    else if (status === 'checking') line = h('p', { className: 'lcl__line lcl__line--muted' }, 'Checking ' + full + '…');
    else if (status === 'taken') line = h('p', { className: 'lcl__line' }, h('b', { className: 'lcl__bad' }, full + ' is taken.'), (props.alts || []).length ? ' These are free, tap one:' : ' Try another name.');
    else if (status === 'invalid') line = h('p', { className: 'lcl__line' }, h('b', { className: 'lcl__bad' }, props.message || 'Try another name.'));
    return h('div', { className: 'lcl' },
      props.fromHome ? h('span', { className: 'lcl__note' }, h('span', { className: 'lcl__note-dot', 'aria-hidden': 'true' }, icon('M20 6 9 17l-5-5', 11, 3)), 'You picked this on our home page') : null,
      h('label', { className: 'lcl__label', htmlFor: id }, 'Your link *'),
      h('div', { className: 'lcl__field' + (status === 'ok' ? ' is-ok' : bad ? ' is-bad' : '') },
        h('span', { className: 'lcl__prefix', 'aria-hidden': 'true' }, prefix),
        h('input', { id: id, className: 'lcl__input', value: value, autoComplete: 'off', autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false, maxLength: 30, inputMode: 'url',
          'aria-label': 'Your link: ' + prefix, 'aria-invalid': bad ? 'true' : 'false', 'aria-describedby': statusId,
          onChange: function (e) { if (props.onChange) props.onChange(clean(e.target.value)); } }),
        mark),
      h('div', { id: statusId, className: 'lcl__status', role: 'status', 'aria-live': 'polite' },
        line,
        status === 'taken' && (props.alts || []).length ? h('div', { className: 'lcl__alts' }, props.alts.map(function (a) {
          return h('button', { key: a, type: 'button', className: 'lcl__alt', onClick: function () { if (props.onPick) props.onPick(a); } }, a);
        })) : null,
        props.error && status !== 'taken' && status !== 'invalid' ? h('p', { className: 'lcl__line', role: 'alert' }, h('b', { className: 'lcl__bad' }, props.error)) : null),
      h('p', { className: 'lcl__hint' }, 'Letters, numbers and dashes. 3 to 30 characters.'));
  }
  window.LcLinkClaim = LinkClaim;
})();
