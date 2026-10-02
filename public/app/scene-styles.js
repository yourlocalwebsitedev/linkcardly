/* Scene card styles for Personal (Summit, Tide): the one list shared by the order flow (order.html) and
 * the card page (card.html). Loaded as a plain script; read as window.LC_SCENES.
 *
 *   styles     [{ id, name, layout: 'scene', scene, family, ...colours }] in picker order. Ids are stored
 *              on saved cards, so never rename or remove one.
 *   families   scene -> design name; every style of a scene is one colour of that design.
 *   svg(st, w) the landscape for a style as an SVG string (viewBox 390x560), used by the card page and,
 *              as a data: URI from thumb(st), by the style picker. A fade into st.bg at the bottom keeps
 *              the name and title readable over the art.
 * Text contrast of every style is checked in test/lib.test.js.
 */
(function () {
  var SHAPES = {"summit": ["M-20 191L28 173L76 213L123 230L171 205L219 179L267 183L314 218L362 228L410 208L410 560L-20 560Z", "M-20 205L19 250L58 285L97 269L136 214L175 218L215 262L254 285L293 256L332 218L371 228L410 273L410 560L-20 560Z", "M-20 309L34 342L88 332L141 283L195 268L249 320L302 344L356 321L410 290L410 560L-20 560Z", "M-20 404L23 406L66 372L109 360L152 382L195 406L238 398L281 355L324 340L367 384L410 409L410 560L-20 560Z", "M-20 469L41 448L103 425L164 433L226 463L287 467L349 453L410 432L410 560L-20 560Z"], "tide": ["M-20 140C-5 127 33 65 70 60C107 55 160 113 200 110C240 107 275 43 310 40C345 37 393 82 410 90L410 560L-20 560Z", "M-20 250C-7 238 27 178 60 180C93 182 140 262 180 260C220 258 262 175 300 170C338 165 392 220 410 230L410 560L-20 560Z", "M-20 340C0 330 60 275 100 280C140 285 183 367 220 370C257 373 288 303 320 300C352 297 395 342 410 350L410 560L-20 560Z", "M-20 420C3 412 77 365 120 370C163 375 205 445 240 450C275 455 302 403 330 400C358 397 397 425 410 430L410 560L-20 560Z", "M-20 500C2 495 68 467 110 470C152 473 193 516 230 520C267 524 300 497 330 495C360 493 397 508 410 510L410 560L-20 560Z"], "tideHl": ["M-20 140C-5 127 33 65 70 60C107 55 160 113 200 110C240 107 275 43 310 40C345 37 393 82 410 90", "M-20 250C-7 238 27 178 60 180C93 182 140 262 180 260C220 258 262 175 300 170C338 165 392 220 410 230", "M-20 340C0 330 60 275 100 280C140 285 183 367 220 370C257 373 288 303 320 300C352 297 395 342 410 350", "M-20 420C3 412 77 365 120 370C163 375 205 445 240 450C275 455 302 403 330 400C358 397 397 425 410 430", "M-20 500C2 495 68 467 110 470C152 473 193 516 230 520C267 524 300 497 330 495C360 493 397 508 410 510"], "trail": "M48 300C100 278 140 290 186 262S266 222 312 214"};
  var P = {"summit-pine": {"scene": "summit","name": "Pine","sky": ["#2B3F3F","#16251F"],"sun": "#E9DDB0","layers": ["#6F8C7E","#4E6E5E","#33503F","#22382C","#14231C"],"hl": "#E9DDB0","bg": "#0F1A15","ink": "#F3EFE2","accent": "#D8C48A","on": "#14231C","ring": "#D8C48A"},"summit-glacier": {"scene": "summit","name": "Glacier","sky": ["#CFDDE8","#F5F8FA"],"sun": "#FFFFFF","layers": ["#D6E1EA","#C3D2DE","#B1C3D2","#A2B7C8","#E6EDF2"],"hl": "#3E5A70","bg": "#F2F6F9","ink": "#17293A","accent": "#1F4562","on": "#FFFFFF","ring": "#1F4562"},"summit-ember": {"scene": "summit","name": "Ember","sky": ["#5A2A1C","#1A0E0B"],"sun": "#F6C177","layers": ["#B9643A","#8E4628","#66321F","#442217","#2A1510"],"hl": "#F6C177","bg": "#1C100C","ink": "#FBEFE4","accent": "#F2B36D","on": "#2A1510","ring": "#E08A4E"},"tide-midnight": {"scene": "tide","name": "Midnight","sky": ["#16324A","#0A1828"],"sun": "#E8F1EE","layers": ["#10263A","#163450","#1E4766","#2A5F82","#0E2236"],"hl": "#9FD3DE","bg": "#0A1A28","ink": "#EEF6F6","accent": "#EBD7B8","on": "#0A1C2B","ring": "#8FCFD6"},"tide-copper": {"scene": "tide","name": "Copper","sky": ["#21160F","#140D09"],"sun": "#F3D3A0","layers": ["#3A2418","#5E3720","#8A522F","#B4703F","#24160F"],"hl": "#F0C48E","bg": "#1A110C","ink": "#FBF1E4","accent": "#E5BE82","on": "#2A1A12","ring": "#C98A55"},"tide-sunrise": {"scene": "tide","name": "Sunrise","sky": ["#F2A07F","#F8D6B8"],"sun": "#FFF4E2","layers": ["#F4BE9C","#2E7D86","#24686F","#1C5459","#0F3438"],"hl": "#FCE3CF","bg": "#0F3236","ink": "#FDF3EA","accent": "#F6B48F","on": "#0F3236","ring": "#F6B48F"},"tide-lagoon": {"scene": "tide","name": "Lagoon","sky": ["#BDE8EC","#EAF7F5"],"sun": "#FFFFFF","layers": ["#C4ECEA","#A6E0DE","#8FD5D4","#C8EAE4","#F1EADB"],"hl": "#FFFFFF","bg": "#F7F1E6","ink": "#0C3B44","accent": "#0C5C66","on": "#FFFFFF","ring": "#2E9AA3"}};
  var FAMILIES = { summit: 'Summit', tide: 'Tide' };
  function svg(st, width) {
    var id = 'sc-' + st.id, L = st.layers, out = [];
    out.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 390 560" preserveAspectRatio="xMidYMin slice"' + (width ? ' width="' + width + '"' : '') + ' aria-hidden="true">');
    out.push('<defs><linearGradient id="' + id + '-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + st.sky[0] + '"/><stop offset="1" stop-color="' + st.sky[1] + '"/></linearGradient>');
    out.push('<linearGradient id="' + id + '-fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + st.bg + '" stop-opacity="0"/><stop offset="1" stop-color="' + st.bg + '" stop-opacity="0.92"/></linearGradient></defs>');
    out.push('<rect width="390" height="560" fill="url(#' + id + '-sky)"/>');
    if (st.scene === 'summit') {
      out.push('<circle cx="292" cy="150" r="96" fill="' + st.sun + '" opacity="0.1"/><circle cx="292" cy="150" r="54" fill="' + st.sun + '" opacity="0.92"/>');
      SHAPES.summit.forEach(function (d, i) { out.push('<path d="' + d + '" fill="' + L[i] + '"/>'); });
      out.push('<path d="' + SHAPES.trail + '" fill="none" stroke="' + st.hl + '" stroke-width="2" stroke-dasharray="2 7" stroke-linecap="round" opacity="0.6"/>');
    } else {
      out.push('<circle cx="318" cy="92" r="64" fill="' + st.sun + '" opacity="0.1"/><circle cx="318" cy="92" r="28" fill="' + st.sun + '" opacity="0.9"/>');
      SHAPES.tide.forEach(function (d, i) { out.push('<path d="' + d + '" fill="' + L[i] + '"/>'); if (i < 4) out.push('<path d="' + SHAPES.tideHl[i] + '" fill="none" stroke="' + st.hl + '" stroke-opacity="0.22" stroke-width="1.5"/>'); });
    }
    out.push('<rect y="300" width="390" height="260" fill="url(#' + id + '-fade)"/></svg>');
    return out.join('');
  }
  function thumb(st) { return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg(st)); }
  var styles = Object.keys(P).map(function (id) {
    var p = P[id];
    return { id: id, name: p.name, layout: 'scene', scene: p.scene, family: { id: 'scene-' + p.scene, name: FAMILIES[p.scene] },
      bg: p.bg, ink: p.ink, accent: p.accent, on: p.on, ring: p.ring, sky: p.sky, sun: p.sun, layers: p.layers, hl: p.hl };
  });
  window.LC_SCENES = { styles: styles, families: FAMILIES, svg: svg, thumb: thumb };
})();
