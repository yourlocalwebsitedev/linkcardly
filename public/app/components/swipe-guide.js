/* SwipeGuide: one-time guide over the phone card preview that shows people they can swipe between designs.
 *
 *   SwipeGuide   full-screen dim over the card and its controls (role="dialog")
 *   ├── title    "Try another design" and a line about how many designs there are
 *   ├── centre   dashed line splitting the screen into the two swipe halves
 *   ├── halves   "Swipe right / for the previous design" and "Swipe left / for the next design", each with an
 *   │            arrow and a hand that moves in the swipe direction
 *   └── Got it   closes the guide
 *
 * A swipe on the guide itself also closes it and changes design (onSwipe), so trying the gesture works straight away.
 * Esc closes it. Exposed as window.LcSwipeGuide and used through
 *   <x-import component-from-global-scope="LcSwipeGuide" from="/app/components/swipe-guide.js" …>
 * Plain React.createElement (React comes from the page runtime), so no build step or Babel.
 *
 * Props
 *   title    heading (default "Try another design")
 *   text     line under the heading, e.g. "7 designs, each in its own colours"
 *   onDone   () => void, Got it or Esc
 *   onSwipe  (dir) => void, 1 = next (swipe left), -1 = previous (swipe right)
 */
(function () {
  var CSS_ID = 'lc-swipe-guide-css';
  var CSS_HREF = (function () {
    try { return new URL('swipe-guide.css', document.currentScript.src).href; } catch (e) { return '/app/components/swipe-guide.css'; }
  })();
  function ensureCss() {
    if (document.getElementById(CSS_ID)) return;
    var l = document.createElement('link'); l.id = CSS_ID; l.rel = 'stylesheet'; l.href = CSS_HREF;
    document.head.appendChild(l);
  }
  function h() { return window.React.createElement.apply(null, arguments); }
  var HAND = ['M8 13v-8.5a1.5 1.5 0 0 1 3 0v7.5', 'M11 11.5v-2a1.5 1.5 0 1 1 3 0v2.5', 'M14 10.5a1.5 1.5 0 0 1 3 0v1.5',
    'M17 11.5a1.5 1.5 0 0 1 3 0v4.5a6 6 0 0 1 -6 6h-2h.208a6 6 0 0 1 -5.012 -2.7l-.196 -.3c-.312 -.479 -1.407 -2.388 -3.286 -5.728a1.5 1.5 0 0 1 .536 -2.022a1.867 1.867 0 0 1 2.28 .28l1.47 1.47'];
  function svg(paths, size, cls) {
    return h('svg', { className: cls, width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
      paths.map(function (d, i) { return h('path', { key: i, d: d }); }));
  }
  function Half(props) {
    var right = props.side === 'right';
    return h('div', { className: 'lcg-half lcg-half--' + props.side },
      h('b', null, props.title), h('span', null, props.sub),
      h('span', { className: 'lcg-arrow' }, h('i', null), svg([right ? 'm15 5-7 7 7 7' : 'm9 5 7 7-7 7'], 18)),
      svg(HAND, 46, 'lcg-hand'));
  }
  var uid = 0;
  function SwipeGuide(props) {
    var React = window.React;
    ensureCss();
    var btn = React.useRef(null), touch = React.useRef(null), idRef = React.useRef(null);
    if (!idRef.current) idRef.current = 'lcg-title-' + (++uid);
    React.useEffect(function () { if (btn.current) try { btn.current.focus({ preventScroll: true }); } catch (e) {} }, []);
    function done() { if (props.onDone) props.onDone(); }
    function onKeyDown(e) { if (e.key === 'Escape') { e.stopPropagation(); done(); } }
    function start(x, y) { touch.current = { x: x, y: y }; }
    function end(x, y) {
      var s = touch.current; touch.current = null; if (!s) return;
      var dx = x - s.x, dy = y - s.y;
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) { done(); if (props.onSwipe) props.onSwipe(dx < 0 ? 1 : -1); }
    }
    return h('div', { className: 'lcg', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': idRef.current, onKeyDown: onKeyDown,
      onTouchStart: function (e) { var t = e.touches[0]; if (t && e.touches.length === 1) start(t.clientX, t.clientY); },
      onTouchEnd: function (e) { var t = e.changedTouches[0]; if (t) end(t.clientX, t.clientY); },
      onMouseDown: function (e) { if (e.button === 0) start(e.clientX, e.clientY); },
      onMouseUp: function (e) { end(e.clientX, e.clientY); } },
      h('div', { className: 'lcg-head' }, h('h2', { id: idRef.current }, props.title || 'Try another design'), props.text ? h('p', null, props.text) : null),
      h('span', { className: 'lcg-line', 'aria-hidden': 'true' }),
      h('div', { className: 'lcg-halves' },
        h(Half, { side: 'right', title: 'Swipe right', sub: 'for the previous design' }),
        h(Half, { side: 'left', title: 'Swipe left', sub: 'for the next design' })),
      h('button', { type: 'button', ref: btn, className: 'lcg-done', onClick: done }, 'Got it'));
  }
  window.LcSwipeGuide = SwipeGuide;
})();
