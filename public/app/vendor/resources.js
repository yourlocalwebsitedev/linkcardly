// Self-hosted copies of the runtime's CDN scripts (support.js reads window.__resources before
// falling back to unpkg). Byte-identical to the SRI-pinned unpkg files; test/lib.test.js checks the hashes.
window.__resources = Object.assign(window.__resources || {}, {
  'https://unpkg.com/react@18.3.1/umd/react.production.min.js': '/app/vendor/react-18.3.1.min.js',
  'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js': '/app/vendor/react-dom-18.3.1.min.js',
  'https://unpkg.com/@babel/standalone@7.29.0/babel.min.js': '/app/vendor/babel-standalone-7.29.0.min.js'
});
