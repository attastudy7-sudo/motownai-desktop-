// Motown AI desktop: added to every page by the local server.
//   - shows a slim strip while offline ("your saved packs still work") and when back online
//   - shows a small "Saving packs for offline" chip while packs are being saved
//   - opens links to other sites in the student's normal browser
//   - removes the website's service worker (the app saves pages itself)
(function () {
  if (window.__motownDesktop) return;
  window.__motownDesktop = true;

  try {
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      navigator.serviceWorker.getRegistrations().then(function (rs) { rs.forEach(function (r) { r.unregister(); }); });
    }
  } catch (_) {}

  // ---------- links to other sites ----------
  function outside(url) {
    fetch('/__desktop/open?url=' + encodeURIComponent(url)).catch(function () {});
  }
  function isOutside(href) {
    try {
      var u = new URL(href, location.href);
      if (u.protocol === 'mailto:') return true;
      return (u.protocol === 'http:' || u.protocol === 'https:') && u.origin !== location.origin;
    } catch (_) { return false; }
  }
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href');
    if (!href || href.charAt(0) === '#' || href.indexOf('javascript:') === 0) return;
    if (isOutside(a.href)) {
      e.preventDefault();
      outside(a.href);
    } else if (a.target === '_blank' && !a.hasAttribute('download')) {
      e.preventDefault();
      location.assign(a.href);
    }
  }, true);
  var nativeOpen = window.open;
  window.open = function (url) {
    if (url && isOutside(url)) { outside(new URL(url, location.href).href); return null; }
    if (url) { location.assign(url); return null; }
    return nativeOpen.apply(window, arguments);
  };

  // ---------- status ----------
  var strip, chip, wasOffline = false, backTimer = null;

  function el(cls, html) {
    var d = document.createElement('div');
    d.className = cls;
    d.setAttribute('role', 'status');
    d.setAttribute('aria-live', 'polite');
    d.innerHTML = html;
    document.body.appendChild(d);
    return d;
  }

  function render(s) {
    if (!document.body) return;
    if (!strip) strip = el('mdk-strip', '');
    if (!chip) chip = el('mdk-saving', '<span class="mdk-text"></span><span class="mdk-bar"><span class="mdk-fill"></span></span>');

    if (!s.online) {
      wasOffline = true;
      clearTimeout(backTimer);
      var waiting = s.pending > 0 ? '<span class="mdk-muted">· ' + s.pending + ' waiting to sync</span>' : '';
      strip.innerHTML = '<span class="mdk-dot"></span><span>Offline · your saved packs still work</span>' + waiting;
      strip.classList.remove('mdk-back');
      strip.classList.add('mdk-show');
      document.documentElement.classList.add('mdk-offline');
    } else if (wasOffline) {
      wasOffline = false;
      strip.innerHTML = '<span class="mdk-dot"></span><span>Back online</span>' +
        (s.pending > 0 ? '<span class="mdk-muted">· syncing your progress</span>' : '');
      strip.classList.add('mdk-back', 'mdk-show');
      backTimer = setTimeout(function () {
        strip.classList.remove('mdk-show');
        document.documentElement.classList.remove('mdk-offline');
      }, 2500);
    }

    if (s.online && s.saving && s.saving_total > 0) {
      chip.querySelector('.mdk-text').textContent = 'Saving packs for offline · ' + s.saving_done + ' of ' + s.saving_total;
      chip.querySelector('.mdk-fill').style.width = Math.round(100 * s.saving_done / s.saving_total) + '%';
      chip.classList.add('mdk-show');
    } else {
      chip.classList.remove('mdk-show');
    }
  }

  var timer = null;
  function poll() {
    clearTimeout(timer);
    fetch('/__desktop/status', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(render)
      .catch(function () {})
      .then(function () { timer = setTimeout(poll, document.hidden ? 15000 : 4000); });
  }
  window.addEventListener('online', poll);
  window.addEventListener('offline', poll);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', poll);
  else poll();
})();
