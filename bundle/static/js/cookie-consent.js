/* ── GDPR Cookie Consent ── */
(function () {
  'use strict';

  var KEY = 'motown_cookie_consent';

  function getConsent() {
    try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; }
  }

  function save(consent) {
    consent.ts = Date.now();
    consent.version = 1;
    try { localStorage.setItem(KEY, JSON.stringify(consent)); } catch (e) {}
    apply(consent);
  }

  function apply(c) {
    if (!c) return;
    document.dispatchEvent(new CustomEvent('cookieconsent', { detail: c }));
    if (!c.functional) {
      document.cookie = 'motown-nav-expanded=; path=/; max-age=0; SameSite=Lax';
      document.cookie = 'motown_visited=; path=/; max-age=0; SameSite=Lax';
    } else if (!document.cookie.split(';').some(function (x) { return x.trim().startsWith('motown_visited='); })) {
      document.cookie = 'motown_visited=1; path=/; max-age=' + (60 * 60 * 24 * 30) + '; SameSite=Lax; Secure';
    }
  }

  function hide() {
    var b = document.getElementById('cc-banner');
    if (b) { b.classList.remove('cc-visible'); setTimeout(function () { b.remove(); }, 400); }
    showManage();
  }

  function showManage() {
    if (document.querySelector('.cc-manage-link')) return;
    var w = document.createElement('div');
    w.className = 'cc-manage-link';
    w.innerHTML = '<a href="#" aria-label="Cookie settings">&#9881; Cookies</a>';
    document.body.appendChild(w);
    w.querySelector('a').addEventListener('click', function (e) {
      e.preventDefault(); w.remove(); render('manage');
    });
  }

  function render(mode) {
    var old = document.getElementById('cc-banner');
    if (old) old.remove();

    var prev = getConsent() || {};

    var b = document.createElement('div');
    b.id = 'cc-banner';
    b.setAttribute('role', 'dialog');
    b.setAttribute('aria-label', 'Cookie preferences');

    var isManage = mode === 'manage';

    b.innerHTML =
      '<div class="cc-text">We use cookies to keep you logged in and remember preferences. ' +
      '<a href="/privacy">Learn more</a></div>' +
      '<div class="cc-row">' +
        '<button class="cc-btn cc-btn-accept" data-cc="accept">Accept</button>' +
        '<button class="cc-btn cc-btn-decline" data-cc="decline">Decline</button>' +
        '<button class="cc-details-toggle" data-cc="toggle">&#9662; Details</button>' +
      '</div>' +
      '<div class="cc-details">' +
        '<div class="cc-cat">' +
          '<span class="cc-cat-label">Necessary</span>' +
          '<label class="cc-toggle"><input type="checkbox" data-cc="necessary" checked disabled><span class="cc-toggle-track"></span></label>' +
        '</div>' +
        '<div class="cc-cat">' +
          '<span class="cc-cat-label">Functional</span>' +
          '<label class="cc-toggle"><input type="checkbox" data-cc="functional"' + (prev.functional ? ' checked' : '') + '><span class="cc-toggle-track"></span></label>' +
        '</div>' +
        '<div class="cc-cat">' +
          '<span class="cc-cat-label">Third-party</span>' +
          '<label class="cc-toggle"><input type="checkbox" data-cc="third_party"' + (prev.third_party ? ' checked' : '') + '><span class="cc-toggle-track"></span></label>' +
        '</div>' +
      '</div>';

    document.body.appendChild(b);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { b.classList.add('cc-visible'); });
    });

    /* Toggle details */
    b.querySelector('[data-cc="toggle"]').addEventListener('click', function () {
      b.querySelector('.cc-details').classList.toggle('cc-open');
      this.innerHTML = b.querySelector('.cc-details').classList.contains('cc-open') ? '&#9652; Less' : '&#9662; Details';
    });

    /* Accept / Decline */
    b.addEventListener('click', function (e) {
      var action = e.target.getAttribute('data-cc');
      if (action === 'accept') {
        save({ necessary: true, functional: true, third_party: true });
        hide();
      } else if (action === 'decline') {
        save({ necessary: true, functional: false, third_party: false });
        hide();
      }
    });

    /* If manage mode, open details by default */
    if (isManage) {
      var det = b.querySelector('.cc-details');
      det.classList.add('cc-open');
      b.querySelector('.cc-details-toggle').innerHTML = '&#9652; Less';
    }
  }

  /* ── Only show on landing pages ── */
  function isLandingPage() {
    var path = window.location.pathname;
    return path === '/' || path === '/index' || path === '/join' || path.startsWith('/pricing') ||
           path.startsWith('/about') || path.startsWith('/blog') || path.startsWith('/careers') ||
           path.startsWith('/privacy') || path.startsWith('/terms');
  }

  function init() {
    if (!isLandingPage()) return;
    var c = getConsent();
    if (!c) { render('full'); }
    else { apply(c); showManage(); }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.MotownCookieConsent = {
    open: function () {
      var link = document.querySelector('.cc-manage-link');
      if (link) link.remove();
      render('manage');
    },
    getConsent: getConsent
  };
})();
