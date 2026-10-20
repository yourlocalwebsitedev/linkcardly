/* ShipAddress: the delivery address on the Payment step of an NFC order (NFC Basic, NFC Custom; India only).
 *
 *   ShipAddress
 *   ├── title     "Delivery address" + one line (shipping is added to the total above)
 *   ├── fields    name · phone (optional, if different) · house and street · area · city · state · PIN code
 *   └── errors    one message under each field the page marks
 *
 * Presentational: the page owns the values and the checks (shipErrors in order.html; place_order_core checks
 * the same on the server) and passes them in. Exposed as window.LcShipAddress and used through
 *   <x-import component-from-global-scope="LcShipAddress" from="/app/components/ship-address.js" …>
 * Plain React.createElement (React comes from the page runtime), so no build step or Babel.
 *
 * Props
 *   value     { name, phone, line1, line2, city, state, pin }
 *   errors    { <field>: 'message' } for fields to mark
 *   onChange  (field, value) => void
 * Inputs have ids o-ship-<field>, so the page can focus the first one with an error.
 */
(function () {
  var CSS_ID = 'lc-ship-address-css';
  var CSS_HREF = (function () {
    try { return new URL('ship-address.css', document.currentScript.src).href; } catch (e) { return '/app/components/ship-address.css'; }
  })();
  function ensureCss() {
    if (document.getElementById(CSS_ID)) return;
    var l = document.createElement('link'); l.id = CSS_ID; l.rel = 'stylesheet'; l.href = CSS_HREF;
    document.head.appendChild(l);
  }
  var h = function () { return React.createElement.apply(React, arguments); };
  var STATES = ['Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal'];
  // [field, label, autocomplete, full width, extra input props]
  var FIELDS = [
    ['name', 'Full name', 'shipping name', false, { maxLength: 120 }],
    ['phone', 'Delivery phone (if different)', 'shipping tel', false, { type: 'tel', inputMode: 'tel', maxLength: 20, placeholder: '98765 43210' }],
    ['line1', 'House, building, street', 'shipping address-line1', true, { maxLength: 200 }],
    ['line2', 'Area, landmark (optional)', 'shipping address-line2', true, { maxLength: 200 }],
    ['city', 'City', 'shipping address-level2', false, { maxLength: 80 }],
    ['state', 'State', 'shipping address-level1', false, null],
    ['pin', 'PIN code', 'shipping postal-code', false, { inputMode: 'numeric', maxLength: 6, placeholder: '560001' }]
  ];

  function ShipAddress(props) {
    ensureCss();
    var v = props.value || {}, err = props.errors || {};
    var change = function (k) { return function (e) { if (props.onChange) props.onChange(k, k === 'pin' ? e.target.value.replace(/\D/g, '').slice(0, 6) : e.target.value); }; };
    return h('fieldset', { className: 'lcs-ship' },
      h('legend', { className: 'lcs-ship__title' }, h('span', { className: 'lcs-ship__icon', 'aria-hidden': 'true' }, h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' }, h('path', { d: 'M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z' }), h('circle', { cx: 12, cy: 9.5, r: 2.5 }))), 'Delivery address'),
      h('p', { className: 'lcs-ship__sub' }, 'We ship your NFC card within India. Shipping is in the total above.'),
      h('div', { className: 'lcs-ship__grid' }, FIELDS.map(function (f) {
        var k = f[0], id = 'o-ship-' + k, bad = !!err[k], msgId = id + '-msg';
        var common = { id: id, className: 'lcs-ship__input' + (bad ? ' is-bad' : ''), value: v[k] || '', autoComplete: f[2], onChange: change(k), 'aria-invalid': bad ? 'true' : 'false', 'aria-describedby': bad ? msgId : undefined };
        var control = k === 'state'
          ? h('select', common, h('option', { value: '' }, 'Choose state'), STATES.map(function (s) { return h('option', { key: s, value: s }, s); }))
          : h('input', Object.assign({ type: 'text' }, common, f[4] || {}));
        return h('label', { key: k, className: 'lcs-ship__field' + (f[3] ? ' lcs-ship__field--full' : ''), htmlFor: id },
          h('span', { className: 'lcs-ship__label' }, f[1]), control,
          bad ? h('span', { id: msgId, className: 'lcs-ship__err', role: 'alert' }, err[k]) : null);
      })));
  }
  window.LcShipAddress = ShipAddress;
})();
