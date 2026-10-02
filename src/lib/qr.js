// QR codes as SVG, generated in the Worker (no third-party service).
// The generator is the same qrcode.js the vendored app uses; scripts/build.mjs copies it to
// src/lib/qrcode.gen.js as an ES module.
import qrcode from './qrcode.gen.js';

export function qrSvg(text) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 8, margin: 2, scalable: true });
}
