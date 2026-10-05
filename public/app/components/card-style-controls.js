/* CardStyleControls: floating style picker and next button for a phone card preview.
 *
 *   CardStyleControls  one layer fixed to the bottom of the screen
 *   ├── StyleSelector   handle, collection tabs (or a header) and a row of styles (shown when open)
 *   │   ├── GroupTabs   one tab per collection when the options span several groups
 *   │   └── StyleOption one style: thumbnail and label; the selected one sits on a glass chip
 *   ├── StyleTrigger    [thumbnail  Name / COLLECTION  ˄]  opens and closes the selector
 *   └── NextButton      round next/save button
 *   CardColourRail      (separate global) vertical strip of colours at the top right of the card, shown
 *                       while the selected style belongs to a family of colour variants
 * Liquid glass: the trigger, the next button and the open sheet are frosted glass. Their tone follows the
 * selected style's background (thumb.bg): clear glass + white ink on dark cards, milky glass + navy ink on
 * light ones. A fade in the card's own colour sits under the controls so card text never collides with them.
 * Closed: only the trigger and the next button float over the card, with no bar.
 * Open: a glass sheet rises behind the selector and the controls (8px in from the edges) and the card dims
 * lightly; tapping outside, the handle, the chevron, Esc or a swipe down closes it. The controls never move.
 *
 * Screen-agnostic: it only knows about the props below, so it works for any card style list or
 * collection. Exposed as window.LcCardStyleControls (sub-components on .parts) and used through
 *   <x-import component-from-global-scope="LcCardStyleControls" from="/app/components/card-style-controls.js" …>
 * Plain React.createElement (React comes from the page runtime), so no build step or Babel.
 *
 * Props
 *   options    [{ id, name, group?, thumb: { bg, image?, blocks?: [{ l, t, w, h, r, bg, sh }], dot?, size? } }]
 *              thumb.image (a URL, e.g. an SVG data: URI) fills the thumbnail and wins over blocks and dot.
 *              thumb.blocks are absolutely positioned shapes drawn at thumb.size px (default 56).
 *              Options with different `group` values get a divider between groups. The sheet's header
 *              shows the selected option's group ("<group> styles") and its position in that group.
 *              thumb.bg (a hex colour) is also the card colour used for the glass tone and the fade.
 *              With several groups the sheet shows one tab per group and the row shows only that group.
 *              design (optional) names the design the option belongs to; the button shows it before the
 *              collection ("Pine" over "Summit · Personal").
 *              family: { id, name } marks colour variants of one design (e.g. Personal's colours): they
 *              collapse into one tile named family.name, and LcCardColourRail lists the colours.
 *              swatch: { bg, dot } is how a colour looks in that strip (default: thumb.bg and thumb.dot).
 *   value      id of the selected option
 *   open       whether the selector is expanded
 *   onToggle   () => void, opens or closes the selector
 *   onSelect   (id) => void
 *   onNext     () => void
 *   nextLabel  accessible name of the next button, e.g. "Continue to payment"
 *   nextIcon   'arrow' (default) or 'check'
 *   busy       disables the next button
 *   maxWidth   CSS max-width of the controls, to line them up with the card (default 100%)
 *   tone       'dark' | 'light' to override the tone read from the selected style's thumb.bg
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
  var ICON_SIZE = { arrow: 20, check: 20 };

  // 'light' when a hex colour is light enough that white text on clear glass would not read.
  function toneOf(hex) {
    var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return 'dark';
    var x = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1], n = parseInt(x, 16);
    var lin = function (c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    var L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
    return L > 0.4 ? 'light' : 'dark';
  }

  function h() { return window.React.createElement.apply(null, arguments); }
  function Icon(d, size) {
    return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' }, h('path', { d: d }));
  }

  // Draws a thumbnail descriptor at `size` px; blocks drawn for another size are scaled to fit.
  function Thumb(props) {
    var t = props.thumb || {}, native = t.size || THUMB, k = props.size / native;
    var inner = t.image
      ? h('img', { className: 'lcs-thumb__img', src: t.image, alt: '' })
      : t.dot
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
      type: 'button', ref: props.buttonRef, className: 'lcs-trigger lcs-glass' + (props.open ? ' is-open' : ''),
      'aria-expanded': props.open ? 'true' : 'false', 'aria-controls': props.controls,
      'aria-label': (props.open ? 'Hide styles. ' : 'Change style. ') + 'Current style: ' + (opt.name || '') + (props.sub ? ', ' + props.sub : ''),
      onClick: props.onToggle
    }, h(Thumb, { thumb: opt.thumb, size: 36, className: 'lcs-trigger__thumb' }),
      /* Linkcardly: say what the button does ("Change style" / "Done"), with the current style under it */
      h('span', { className: 'lcs-trigger__text' },
        h('span', { className: 'lcs-trigger__label' }, props.open ? 'Done' : 'Change style'),
        h('span', { className: 'lcs-trigger__sub' }, [opt.name, props.sub].filter(Boolean).join(' · ') || 'Style')),
      h('span', { className: 'lcs-trigger__chevron' }, Icon(ICONS.chevron, 16)));
  }

  function NextButton(props) {
    return h('button', {
      type: 'button', className: 'lcs-next lcs-glass', 'aria-label': props.label || 'Next', title: props.label || 'Next',
      disabled: !!props.busy, 'aria-busy': props.busy ? 'true' : undefined, onClick: props.onNext
    }, Icon(ICONS[props.icon] || ICONS.arrow, ICON_SIZE[props.icon] || 20));
  }

  function StyleOption(props) {
    var o = props.option;
    return h('button', {
      type: 'button', role: 'radio', 'aria-checked': props.selected ? 'true' : 'false', 'aria-label': props.label,
      tabIndex: props.selected ? 0 : -1, 'data-id': o.id,
      className: 'lcs-option' + (props.selected ? ' is-selected' : ''),
      onClick: function () { props.onSelect(o.id); }
    }, h('span', { className: 'lcs-option__art' }, h(Thumb, { thumb: o.thumb, size: THUMB, className: 'lcs-option__thumb' }),
        props.count > 1 ? h('span', { className: 'lcs-option__count', 'aria-hidden': 'true' }, props.count) : null),
      h('span', { className: 'lcs-option__label' }, props.name || o.name));
  }

  function groupsOf(options) {
    var seen = [];
    options.forEach(function (o) { var g = o.group || ''; if (seen.indexOf(g) < 0) seen.push(g); });
    return seen;
  }

  function GroupTabs(props) {
    function move(e) {
      var step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      var i = props.groups.indexOf(props.tab), n = props.groups[Math.min(props.groups.length - 1, Math.max(0, i + step))];
      props.onTab(n);
      var b = e.currentTarget.querySelector('[data-group="' + String(n).replace(/"/g, '\\"') + '"]'); if (b) b.focus();
    }
    return h('div', { className: 'lcs-tabs', role: 'tablist', 'aria-label': 'Style collection', onKeyDown: move,
      style: { gridTemplateColumns: 'repeat(' + props.groups.length + ',minmax(0,1fr))' } },
      props.groups.map(function (g) {
        var on = g === props.tab;
        return h('button', { key: g, type: 'button', role: 'tab', 'aria-selected': on ? 'true' : 'false', 'aria-controls': props.rowId,
          tabIndex: on ? 0 : -1, 'data-group': g, className: 'lcs-tab' + (on ? ' is-selected' : ''), onClick: function () { props.onTab(g); } },
          g, g === props.currentGroup && !on ? h('span', { className: 'lcs-tab__dot', 'aria-label': ' (current style)' }) : null);
      }));
  }

  function StyleSelector(props) {
    var React = window.React, rowRef = React.useRef(null), touch = React.useRef(null), last = React.useRef({});
    var options = props.options || [], groups = groupsOf(options), grouped = groups.length > 1;
    var cur = options.find(function (o) { return o.id === props.value; }) || options[0] || {};
    var curGroup = cur.group || '';
    var tabState = React.useState(curGroup), tab = tabState[0], setTab = tabState[1];
    // Each time the sheet opens it shows the collection of the current style.
    React.useEffect(function () { if (props.open) setTab(curGroup); }, [props.open]);
    if (groups.indexOf(tab) < 0) tab = curGroup;
    if (cur.family) last.current[cur.family.id] = cur.id;
    // The row: this tab's styles, with each family of colour variants as one tile.
    var items = [], seenFam = {};
    options.forEach(function (o) {
      if (grouped && (o.group || '') !== tab) return;
      if (!o.family) { items.push({ option: o, selected: o.id === cur.id }); return; }
      if (seenFam[o.family.id]) return;
      var members = options.filter(function (x) { return x.family && x.family.id === o.family.id; });
      var rep = members.indexOf(cur) >= 0 ? cur : (members.find(function (x) { return x.id === last.current[o.family.id]; }) || members[0]);
      seenFam[o.family.id] = members.length;
      items.push({ option: rep, name: o.family.name, selected: members.indexOf(cur) >= 0, count: members.length });
    });
    var famCount = 0; items.forEach(function (it) { if (it.count > 1) famCount = it.count; });
    var hint = famCount && items.length <= 2;
    // Keep the selected style in view when the selector opens or the selection changes.
    React.useEffect(function () {
      var row = rowRef.current; if (!props.open || !row) return;
      var el = row.querySelector('.is-selected'); if (!el) { row.scrollLeft = 0; return; }
      row.scrollLeft = Math.max(0, el.offsetLeft - (row.clientWidth - el.offsetWidth) / 2);
    }, [props.open, props.value, tab]);
    function move(e) {
      var step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : e.key === 'Home' ? -Infinity : e.key === 'End' ? Infinity : 0;
      if (!step || !items.length) return;
      e.preventDefault();
      var i = items.findIndex(function (it) { return it.selected; });
      var n = step === -Infinity ? 0 : step === Infinity ? items.length - 1 : Math.min(items.length - 1, Math.max(0, i + step));
      var id = items[n].option.id;
      props.onSelect(id);
      var b = rowRef.current && rowRef.current.querySelector('[data-id="' + String(id).replace(/"/g, '\\"') + '"]');
      if (b) b.focus();
    }
    // Swipe down on the panel closes it (the handle hints at this); horizontal swipes scroll the row.
    function onTouchStart(e) { var t = e.touches && e.touches[0]; touch.current = t ? { x: t.clientX, y: t.clientY } : null; }
    function onTouchEnd(e) {
      var s = touch.current, t = e.changedTouches && e.changedTouches[0]; touch.current = null;
      if (s && t && t.clientY - s.y > 32 && Math.abs(t.clientY - s.y) > Math.abs(t.clientX - s.x)) props.onClose();
    }
    var rowId = props.id + '-row';
    var children = items.map(function (it) {
      var o = it.option, name = it.name || o.name;
      var label = name + (it.count > 1 ? ', ' + it.count + ' colours' : '') + (grouped && o.group ? ', ' + o.group : '');
      return h(StyleOption, { key: it.name ? 'fam-' + o.family.id : o.id, option: o, name: name, count: it.count, selected: it.selected, onSelect: props.onSelect, label: label });
    });
    if (hint) children.push(h('span', { key: 'hint', className: 'lcs-selector__hint' },
      h('b', null, famCount + ' colours'), h('span', null, 'Pick one from the strip at the top right of your card.')));
    return h('div', { id: props.id, className: 'lcs-selector' + (grouped ? ' has-tabs' : ''), 'aria-hidden': props.open ? undefined : 'true', onTouchStart: onTouchStart, onTouchEnd: onTouchEnd },
      h('span', { className: 'lcs-selector__handle', 'aria-hidden': 'true' }),
      grouped
        ? h(GroupTabs, { groups: groups, tab: tab, currentGroup: curGroup, onTab: setTab, rowId: rowId })
        : h('div', { className: 'lcs-selector__head', 'aria-hidden': 'true' },
          h('span', { className: 'lcs-selector__title' }, cur.group ? cur.group + ' styles' : 'Styles'),
          h('span', { className: 'lcs-selector__count' }, (items.findIndex(function (it) { return it.selected; }) + 1) + ' of ' + items.length)),
      h('div', { id: rowId, ref: rowRef, className: 'lcs-selector__row', role: 'radiogroup', 'aria-label': (grouped ? tab + ' ' : '') + 'card style', onKeyDown: move }, children));
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
    var card = current && current.thumb && current.thumb.bg;
    var tone = props.tone === 'light' || props.tone === 'dark' ? props.tone : toneOf(card);
    var style = { maxWidth: props.maxWidth || '100%' };
    if (/^#[0-9a-f]{3,8}$/i.test(String(card || ''))) style['--lcs-card'] = card;
    return h('div', { className: 'lcs lcs--' + tone + (props.open ? ' is-open' : ''), style: style, onKeyDown: onKeyDown },
      h('span', { className: 'lcs__fade', 'aria-hidden': 'true' }),
      h('span', { className: 'lcs__dim', 'aria-hidden': 'true', onClick: close }),
      h('span', { className: 'lcs__panel', 'aria-hidden': 'true' }),
      h(StyleSelector, { id: idRef.current, options: options, value: current && current.id, open: !!props.open, onSelect: function (id) { if (props.onSelect) props.onSelect(id); }, onClose: close }),
      h('div', { className: 'lcs__bar' },
        h(StyleTrigger, { option: current, sub: current ? [current.design, groupsOf(options).length > 1 ? current.group : ''].filter(Boolean).join(' · ') : '', open: !!props.open, controls: idRef.current, onToggle: toggle, buttonRef: triggerRef }),
        h(NextButton, { label: props.nextLabel, icon: props.nextIcon, busy: props.busy, onNext: props.onNext })));
  }

  CardStyleControls.parts = { StyleTrigger: StyleTrigger, NextButton: NextButton, StyleSelector: StyleSelector, GroupTabs: GroupTabs, StyleOption: StyleOption, Thumb: Thumb };
  CardStyleControls.toneOf = toneOf;
  window.LcCardStyleControls = CardStyleControls;

  /* CardColourRail: the colours of the selected style's family, as a vertical glass strip fixed to the top
   * right of the card, with the selected colour's name beside it. Renders nothing when the selected style
   * has no family (or only one colour). Used through
   *   <x-import component-from-global-scope="LcCardColourRail" from="/app/components/card-style-controls.js" …>
   * Props: options, value, onSelect (as CardStyleControls), tone (optional override), offset (optional CSS
   * top, to clear something the card shows at the top right, e.g. a scene card's QR code). */
  function CardColourRail(props) {
    ensureCss();
    var options = props.options || [];
    var current = options.find(function (o) { return o.id === props.value; });
    var fam = current && current.family && current.family.id;
    var colours = fam ? options.filter(function (o) { return o.family && o.family.id === fam; }) : [];
    if (colours.length < 2) return null;
    var tone = props.tone === 'light' || props.tone === 'dark' ? props.tone : toneOf(current.thumb && current.thumb.bg);
    var i = colours.indexOf(current);
    function move(e) {
      var step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      var n = colours[Math.min(colours.length - 1, Math.max(0, i + step))];
      if (props.onSelect) props.onSelect(n.id);
      var b = e.currentTarget.querySelector('[data-id="' + String(n.id).replace(/"/g, '\\"') + '"]'); if (b) b.focus();
    }
    return h('div', { className: 'lcr lcs--' + tone, style: props.offset ? { top: props.offset } : undefined },
      h('div', { className: 'lcr__strip lcs-glass', role: 'radiogroup', 'aria-label': (current.family.name || 'Card') + ' colour', onKeyDown: move },
        colours.map(function (o) {
          var on = o === current, t = o.swatch || { bg: (o.thumb || {}).bg, dot: (o.thumb || {}).dot };
          return h('button', { key: o.id, type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false', 'aria-label': o.name, title: o.name,
            tabIndex: on ? 0 : -1, 'data-id': o.id, className: 'lcr__swatch' + (on ? ' is-selected' : ''), style: { background: t.bg },
            onClick: function () { if (props.onSelect) props.onSelect(o.id); } },
            h('span', { className: 'lcr__dot', style: { background: t.dot || '#fff' } }));
        })));
      /* Linkcardly: no floating colour-name label beside the strip; each swatch keeps its name as title/aria-label */
  }
  window.LcCardColourRail = CardColourRail;
})();
