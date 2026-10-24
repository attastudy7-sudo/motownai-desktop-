/**
 * whats-new-modal.js — "What's new" announcement modal.
 *
 * Data-driven slide deck: image top, kicker + title + description, pager dots,
 * prev/next, and a CTA row (primary action + "later" dismiss).
 *
 * Exposes:
 *   window.showWhatsNewModal()          — open the deck from anywhere
 *   window.dismissWhatsNewModal()       — close + mark seen
 *   window.whatsNewRevision             — bump to announce a new batch
 *
 * Auto-shows once per (revision, user). Gated on the authenticated userId
 * from <body data-user-id>; guests never see it.
 *
 * Test hooks:
 *   ?whats_new=1            force-open on load
 *   ?whats_new=1&slide=2    open on a specific slide (0-based)
 *   ?whats_new=reset        clear the seen flag for the current revision
 */
(function () {
  'use strict';

  var REVISION = Number(window.whatsNewRevision) || 20260927;

  var FEATURES = [
    {
      kicker: 'New',
      title: 'AI Tutor',
      desc: 'The old \u201cPodcast\u201d tab is now a real AI tutor that knows your entire pack. Ask anything, then switch modes out loud \u2014 \u201cquiz me,\u201d \u201cexplain this,\u201d \u201cback to chat.\u201d It quizzes you, explains step-by-step, and answers in speech.',
      image: '/static/images/whats-new/ai-tutor.png',
      fallbackIcon: 'ti-robot',
    },
    {
      kicker: 'New',
      title: 'Read-to-Me',
      desc: 'One tap narrates your pack in a voice you choose \u2014 warm and calm by default. The AI recognises your subject\u2019s terms and reads them correctly, speed is adjustable, and it remembers exactly where you left off.',
      image: '/static/images/whats-new/read-to-me.png',
      fallbackIcon: 'ti-volume',
    },
    {
      kicker: 'New',
      title: 'Study offline',
      desc: 'Download a pack and study the whole thing \u2014 guide, flashcards, quiz, fill-ins \u2014 with no internet. Progress syncs back automatically the next time you\u2019re online.',
      image: '/static/images/whats-new/offline.png',
      fallbackIcon: 'ti-download',
    },
    {
      kicker: 'New',
      title: 'Filter study by topic',
      desc: 'On the Quiz and Flashcards tabs, pick one section and practice just those questions. Skip what you already know \u2014 focus only on the material you actually need.',
      image: '/static/images/whats-new/topic-filter.png',
      fallbackIcon: 'ti-adjustments',
    },
  ];

  var _uid = null;
  var _seenKey = null;
  var _cur = 0;
  var _modal = null;

  function _userId() {
    var body = document.body;
    if (body && body.dataset && body.dataset.userId) return body.dataset.userId;
    return window.USER_ID || null;
  }

  function _seenKeyFor(uid) {
    return 'whatsnew_seen_' + REVISION + '_' + uid;
  }

  function _params() {
    return new URLSearchParams(window.location.search);
  }

  function _isForced() {
    return _params().has('whats_new');
  }

  function _shouldOffer() {
    if (_params().has('whats_new')) return true; // test hook wins
    if (!_uid) return false;                     // guests
    try {
      return localStorage.getItem(_seenKey) !== '1';
    } catch (e) {
      return true;
    }
  }

  function _persistSeen() {
    if (!_uid) return;
    try { localStorage.setItem(_seenKey, '1'); } catch (e) {}
  }

  function _clearSeen() {
    if (!_uid) return;
    try { localStorage.removeItem(_seenKey); } catch (e) {}
  }

  function _ensureDom() {
    var existing = document.getElementById('wnm');
    if (existing) return existing;

    var modal = document.createElement('div');
    modal.id = 'wnm';
    modal.className = 'wnm';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'wnmTitle');

    modal.innerHTML =
      '<div class="wnm-bg"></div>' +
      '<div class="wnm-dialog">' +
        '<button class="wnm-close" type="button" aria-label="Dismiss">' +
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
        '</button>' +
        '<div class="wnm-stage" aria-live="polite"></div>' +
        '<div class="wnm-dots" role="tablist" aria-label="Features"></div>' +
        '<div class="wnm-cta-row">' +
          '<button class="wnm-nav" type="button" data-wnm="prev" aria-label="Previous feature">\u2039</button>' +
          '<button class="wnm-cta" type="button">Next</button>' +
        '</div>' +
      '</div>';

    modal.addEventListener('click', function (e) {
      if (e.target === modal || e.target.classList.contains('wnm-bg')) _close();
    });

    modal.querySelector('.wnm-close').addEventListener('click', _close);
    modal.querySelector('[data-wnm="prev"]').addEventListener('click', function () {
      _setSlide(_cur - 1);
    });
    modal.querySelector('.wnm-cta').addEventListener('click', function () {
      if (_cur >= FEATURES.length - 1) { _close(); return; }
      _setSlide(_cur + 1);
    });

    document.addEventListener('keydown', function (e) {
      if (!modal.classList.contains('wnm--open')) return;
      if (e.key === 'Escape') _close();
      else if (e.key === 'ArrowRight') { e.preventDefault(); _setSlide(Math.min(_cur + 1, FEATURES.length - 1)); }
      else if (e.key === 'ArrowLeft')  { e.preventDefault(); _setSlide(_cur - 1); }
    });

    document.body.appendChild(modal);
    return modal;
  }

  function _buildSlides() {
    var stage = _modal.querySelector('.wnm-stage');
    stage.innerHTML = '';
    FEATURES.forEach(function (f, i) {
      var img = '<img src="' + f.image + '" alt="" loading="lazy" onerror="this.style.display=\'none\';this.parentNode.classList.add(\'wnm-img--placeholder\');this.parentNode.querySelector(\'.wnm-placeholder-icon\').style.display=\'flex\';">' +
                '<span class="wnm-placeholder-icon" style="display:none" aria-hidden="true"><i class="ti ' + f.fallbackIcon + '"></i></span>';

      var slide = document.createElement('div');
      slide.className = 'wnm-slide';
      slide.id = 'wnm-slide-' + i;
      slide.innerHTML =
        '<div class="wnm-img wnm-img--placeholder">' + img + '</div>' +
        '<div class="wnm-body">' +
          '<span class="wnm-kicker">' + f.kicker + '</span>' +
          '<h3 class="wnm-title" id="wnmTitle">' + f.title + '</h3>' +
          '<p class="wnm-desc">' + f.desc + '</p>' +
        '</div>';
      stage.appendChild(slide);
    });

    var dots = _modal.querySelector('.wnm-dots');
    dots.innerHTML = '';
    FEATURES.forEach(function (f, i) {
      var dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'wnm-dot';
      dot.setAttribute('role', 'tab');
      dot.setAttribute('aria-label', 'Feature ' + (i + 1));
      dot.addEventListener('click', function () { _setSlide(i); });
      dots.appendChild(dot);
    });
  }

  function _setSlide(idx) {
    var max = FEATURES.length - 1;
    _cur = Math.max(0, Math.min(idx, max));

    _modal.querySelectorAll('.wnm-slide').forEach(function (s, i) {
      s.classList.toggle('wnm-slide--active', i === _cur);
    });
    _modal.querySelectorAll('.wnm-dot').forEach(function (d, i) {
      d.classList.toggle('wnm-dot--active', i === _cur);
    });

    var prev = _modal.querySelector('[data-wnm="prev"]');
    var cta = _modal.querySelector('.wnm-cta');
    prev.disabled = _cur === 0;
    cta.textContent = _cur >= max ? 'Dive in' : 'Next';
  }

  function _open(slideIndex) {
    var gate = window.MotownPopup;
    if (gate && !gate.open('whatsnew')) return; // another popup has the slot
    if (!_modal) _modal = _ensureDom();
    _buildSlides();
    _setSlide(typeof slideIndex === 'number' ? slideIndex : 0);

    _modal.classList.add('wnm--open');
    document.body.style.overflow = 'hidden';

    var dialog = _modal.querySelector('.wnm-dialog');
    if (dialog && dialog.focus) {
      dialog.setAttribute('tabindex', '-1');
      dialog.focus({ preventScroll: true });
    }
  }

  function _close() {
    var gate = window.MotownPopup;
    if (gate) gate.close('whatsnew');
    if (!_modal) return;
    _modal.classList.remove('wnm--open');
    document.body.style.overflow = '';
    _persistSeen();
  }

  function _maybeShow() {
    if (!_shouldOffer()) return;
    var slide = parseInt(_params().get('slide'), 10);
    if (isNaN(slide)) slide = 0;
    _open(slide);
  }

  function _initTestHooks() {
    var p = _params();
    if (p.has('whats_new_reset') || p.get('whats_new') === 'reset') _clearSeen();
    if (p.has('whats_new')) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _maybeShow);
      } else {
        _maybeShow();
      }
    }
  }

  window.dismissWhatsNewModal = _close;
  window.showWhatsNewModal = function (opts) {
    opts = opts || {};
    _open(typeof opts.slide === 'number' ? opts.slide : 0);
  };

  // Auto-offer on app pages once per revision, unless a forced ?whats_new=1
  // is present (which the deferred test hook below already handles).
  function _bootstrap() {
    _uid = _userId();
    if (_uid) _seenKey = _seenKeyFor(_uid);
    // Wait for conversational onboarding to be dismissed before offering.
    // Onboarding completion navigates away, so this re-evaluates on the next
    // page load. Manual ?whats_new=1 test hooks still go through _initTestHooks.
    if (window.MOTOWN_ONBOARDING_PENDING) return;
    if (_params().has('whats_new')) return; // test hook drives it
    if (_shouldOffer()) setTimeout(_maybeShow, 600);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      _bootstrap();
      _initTestHooks();
    });
  } else {
    _bootstrap();
    _initTestHooks();
  }
})();