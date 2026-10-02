/* CardStyleControls: floating style picker and next button for a phone card preview.
 *
 *   CardStyleControls
 *   ├── StyleTrigger    [thumbnail  Name  ˄]  opens and closes the selector
 *   ├── NextButton      round next/save button
 *   ├── StyleSelector   panel that rises over the card, with a peek handle
 *   └── StyleOption     one style: thumbnail and label
 *
 * Screen-agnostic: it only knows about the props below, so it works for any card style list or
 * collection. Exposed as window.LcCardStyleControls (sub-components on .parts) and used through
 *   <x-import component-from-global-scope="LcCardStyleControls" from="/app/components/card-style-controls.js" …>
 * Plain React.createElement (React comes from the page runtime), so no build step or Babel.
 *
 * Props
 *   options    [{ id, name, group?, thumb: { bg, blocks?: [{ l, t, w, h, r, bg, sh }], dot?, size? } }]
 *              thumb.blocks are absolutely positioned shapes drawn at thumb.size px (default 56).
 *              Options with different `group` values get a divider between groups.
 *   value      id of the selected option
 *   open       whether the selector is expanded
 *   onToggle   () => void, opens or closes the selector
 *   onSelect   (id) => void
 *   onNext     () => void
 *   nextLabel  accessible name of the next button, e.g. "Continue to payment"
 *   nextIcon   'arrow' (default) or 'check'
 *   busy       disables the next button
 *   maxWidth   CSS max-width of the controls, to line them up with the card (default 100%)
 */
(function () {
  var CSS_ID = 'lc-card-style-controls-css';
  var CSS_HREF = (function () {
    try { return new URL('card-style-controls.css', document.currentScript.src).href; } catch (e) { return '/app/components/card-style-controls.css'; }
  })();
  function ensureCss() {
    if (document.getElementById(CSS_ID)) return;
    var l = document.createElement('link'); l.id = CSS_ID; l.rel = 'stylesheet'; l.href = CSS_HREF;
    document.head.appendChild(l);
  }

  var THUMB = 56;
  var ICONS = { arrow: 'M5 12h14M13 6l6 6-6 6', check: 'M20 6 9 17l-5-5', chevron: 'm6 15 6-6 6 6' };

  function h() { return window.React.createElement.apply(null, arguments); }
  function Icon(d, size) {
    return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' }, h('path', { d: d }));
  }

  // Draws a thumbnail descriptor at `size` px; blocks drawn for another size are scaled to fit.
  function Thumb(props) {
    var t = props.thumb || {}, native = t.size || THUMB, k = props.size / native;
    var inner = t.dot
      ? h('span', { className: 'lcs-thumb__dot', style: { background: t.dot } })
      : h('span', { className: 'lcs-thumb__art', style: { width: native, height: native, transform: k === 1 ? undefined : 'scale(' + k + ')' } },
        (t.blocks || []).map(function (b, i) {
          return h('span', { key: i, style: { left: b.l, top: b.t, width: b.w, height: b.h, borderRadius: b.r, background: b.bg, boxShadow: b.sh && b.sh !== 'none' ? b.sh : undefined } });
        }));
    return h('span', { className: 'lcs-thumb ' + (props.className || ''), 'aria-hidden': 'true', style: { width: props.size, height: props.size, background: t.bg } }, inner);
  }

  function StyleTrigger(props) {
    var opt = props.option || {};
    return h('button', {
      type: 'button', ref: props.buttonRef, className: 'lcs-trigger' + (props.open ? ' is-open' : ''),
      'aria-expanded': props.open ? 'true' : 'false', 'aria-controls': props.controls,
      'aria-label': (props.open ? 'Hide styles. ' : 'Change style. ') + 'Current style: ' + (opt.name || ''),
      onClick: props.onToggle
    }, h(Thumb, { thumb: opt.thumb, size: 36, className: 'lcs-trigger__thumb' }),
      h('span', { className: 'lcs-trigger__label' }, opt.name || 'Style'),
      h('span', { className: 'lcs-trigger__chevron' }, Icon(ICONS.chevron, 16)));
  }

  function NextButton(props) {
    return h('button', {
      type: 'button', className: 'lcs-next', 'aria-label': props.label || 'Next', title: props.label || 'Next',
      disabled: !!props.busy, 'aria-busy': props.busy ? 'true' : undefined, onClick: props.onNext
    }, Icon(ICONS[props.icon] || ICONS.arrow, 22));
  }

  function StyleOption(props) {
    var o = props.option;
    return h('button', {
      type: 'button', role: 'radio', 'aria-checked': props.selected ? 'true' : 'false', 'aria-label': props.label,
      tabIndex: props.selected ? 0 : -1, 'data-id': o.id,
      className: 'lcs-option' + (props.selected ? ' is-selected' : ''),
      onClick: function () { props.onSelect(o.id); }
    }, h(Thumb, { thumb: o.thumb, size: THUMB, className: 'lcs-option__thumb' }),
      h('span', { className: 'lcs-option__label' }, o.name));
  }

  function StyleSelector(props) {
    var React = window.React, rowRef = React.useRef(null), touch = React.useRef(null);
    var options = props.options || [], grouped = new Set(options.map(function (o) { return o.group || ''; })).size > 1;
    // Keep the selected style in view when the selector opens or the selection changes.
    React.useEffect(function () {
      var row = rowRef.current; if (!props.open || !row) return;
      var el = row.querySelector('.is-selected'); if (!el) return;
      row.scrollLeft = Math.max(0, el.offsetLeft - (row.clientWidth - el.offsetWidth) / 2);
    }, [props.open, props.value]);
    function move(e) {
      var step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : e.key === 'Home' ? -Infinity : e.key === 'End' ? Infinity : 0;
      if (!step || !options.length) return;
      e.preventDefault();
      var i = options.findIndex(function (o) { return o.id === props.value; });
      var n = step === -Infinity ? 0 : step === Infinity ? options.length - 1 : Math.min(options.length - 1, Math.max(0, i + step));
      props.onSelect(options[n].id);
      var b = rowRef.current && rowRef.current.querySelector('[data-id="' + String(options[n].id).replace(/"/g, '\\"') + '"]');
      if (b) b.focus();
    }
    // Swipe down on the panel closes it (the handle hints at this); horizontal swipes scroll the row.
    function onTouchStart(e) { var t = e.touches && e.touches[0]; touch.current = t ? { x: t.clientX, y: t.clientY } : null; }
    function onTouchEnd(e) {
      var s = touch.current, t = e.changedTouches && e.changedTouches[0]; touch.current = null;
      if (s && t && t.clientY - s.y > 32 && Math.abs(t.clientY - s.y) > Math.abs(t.clientX - s.x)) props.onClose();
    }
    var children = [], prev = null;
    options.forEach(function (o, i) {
      if (grouped && i && (o.group || '') !== prev) children.push(h('span', { key: 'sep-' + i, className: 'lcs-selector__sep', 'aria-hidden': 'true' }));
      prev = o.group || '';
      children.push(h(StyleOption, { key: o.id, option: o, selected: o.id === props.value, onSelect: props.onSelect, label: grouped && o.group ? o.name + ', ' + o.group : o.name }));
    });
    return h('div', { id: props.id, className: 'lcs-selector' + (props.open ? ' is-open' : ''), onTouchStart: onTouchStart, onTouchEnd: onTouchEnd },
      h('span', { className: 'lcs-selector__handle', 'aria-hidden': 'true' }),
      h('div', { ref: rowRef, className: 'lcs-selector__row', role: 'radiogroup', 'aria-label': 'Card style', onKeyDown: move }, children));
  }

  var uid = 0;
  function CardStyleControls(props) {
    var React = window.React;
    ensureCss();
    var idRef = React.useRef(null); if (!idRef.current) idRef.current = 'lcs-selector-' + (++uid);
    var triggerRef = React.useRef(null);
    var options = props.options || [];
    var current = options.find(function (o) { return o.id === props.value; }) || options[0];
    function toggle() { if (props.onToggle) props.onToggle(); }
    function close() { if (props.open) toggle(); }
    function onKeyDown(e) {
      if (e.key !== 'Escape' || !props.open) return;
      e.stopPropagation(); close();
      if (triggerRef.current) triggerRef.current.focus();
    }
    return h('div', { className: 'lcs', style: { maxWidth: props.maxWidth || '100%' }, onKeyDown: onKeyDown },
      h(StyleSelector, { id: idRef.current, options: options, value: current && current.id, open: !!props.open, onSelect: function (id) { if (props.onSelect) props.onSelect(id); }, onClose: close }),
      h('div', { className: 'lcs__bar' },
        h(StyleTrigger, { option: current, open: !!props.open, controls: idRef.current, onToggle: toggle, buttonRef: triggerRef }),
        h(NextButton, { label: props.nextLabel, icon: props.nextIcon, busy: props.busy, onNext: props.onNext })));
  }

  CardStyleControls.parts = { StyleTrigger: StyleTrigger, NextButton: NextButton, StyleSelector: StyleSelector, StyleOption: StyleOption, Thumb: Thumb };
  window.LcCardStyleControls = CardStyleControls;
})();
