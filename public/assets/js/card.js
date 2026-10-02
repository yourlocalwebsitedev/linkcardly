document.addEventListener('click', async e => {
  const share = e.target.closest('[data-share]');
  if (share) {
    const url = share.dataset.share, title = document.title;
    if (navigator.share) { try { await navigator.share({ title, url }); } catch (_) {} }
    else { await navigator.clipboard.writeText(url); share.setAttribute('aria-label', 'Link copied'); }
  }
  if (e.target.closest('[data-qr]')) document.getElementById('qr').showModal();
  if (e.target.closest('[data-close]')) document.getElementById('qr').close();
});
