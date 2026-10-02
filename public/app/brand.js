/* Linkcardly brand: the ONE place for the logo, wordmark and brand colours.
   Pages load it with <x-import component-from-global-scope="nbr-logo" from="./brand.js" ...>. */
(function () {
  var BRAND = {
    name: ['link', 'card', 'ly'],      // wordmark: "card" in accent
    colors: { ink: '#201e1d', accent: '#c67139', gold: '#B7893E', cream: '#F7F3EC', mint: '#EEF6F4', sand: '#F3E9D8' }
  };
  window.NBR_BRAND = BRAND;
  try {
    if (!document.getElementById('lc-brand-font')) {
      var l = document.createElement('link'); l.id = 'lc-brand-font'; l.rel = 'stylesheet';
      l.href = 'https://fonts.googleapis.com/css2?family=Caprasimo&display=swap'; document.head.appendChild(l);
    }
  } catch (e) {}
  if (window.customElements && !customElements.get('nbr-logo')) {
    customElements.define('nbr-logo', class extends HTMLElement {
      static get observedAttributes() { return ['height', 'font', 'mark-only']; }
      connectedCallback() { this.render(); }
      attributeChangedCallback() { this.render(); }
      render() {
        var h = parseFloat(this.getAttribute('height')) || 36, f = parseFloat(this.getAttribute('font')) || Math.round(h * 0.7);
        this.style.display = 'inline-flex'; this.style.alignItems = 'center'; this.style.color = BRAND.colors.ink;
        this.setAttribute('role', 'img'); this.setAttribute('aria-label', 'Linkcardly');
        this.innerHTML = '<span aria-hidden="true" style="font-family:Caprasimo,Georgia,serif;font-weight:400;font-size:' + f + 'px;letter-spacing:-0.01em;line-height:1;white-space:nowrap;color:' + BRAND.colors.ink + ';">' +
          (this.hasAttribute('mark-only') ? 'l<span style="color:' + BRAND.colors.accent + ';">c</span>' : BRAND.name[0] + '<span style="color:' + BRAND.colors.accent + ';">' + BRAND.name[1] + '</span>' + BRAND.name[2]) + '</span>';
      }
    });
  }
})();
