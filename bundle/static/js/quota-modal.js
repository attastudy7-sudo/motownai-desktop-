/**
 * quota-modal.js — Daily quota exhausted prompt.
 *
 * window.showQuotaModal({ resource, used, limit, resetsInSeconds })
 *
 * Pops a calm bottom-sheet explaining the daily limit was hit, shows a live
 * countdown to midnight (when the quota resets), and a single Upgrade CTA
 * that opens the existing upgrade modal.
 */
(function () {
  'use strict';

  var _timer = null;
  var _endsAt = 0;

  function _fmt(seconds) {
    seconds = Math.max(0, Math.floor(seconds));
    var h = Math.floor(seconds / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    if (h >= 1) return h + 'h ' + m + 'm';
    if (m >= 1) return m + 'm';
    return Math.max(1, seconds) + 's';
  }

  function _tick(el) {
    if (!el) return;
    el.textContent = _fmt((_endsAt - Date.now()) / 1000);
  }

  function _ensureDom() {
    var existing = document.getElementById('qqm');
    if (existing) return existing;

    var modal = document.createElement('div');
    modal.id = 'qqm';
    modal.className = 'qqm';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'qqmTitle');
    modal.innerHTML =
      '<div class="qqm-bg"></div>' +
      '<div class="qqm-sheet" role="document">' +
        '<div class="qqm-handle"></div>' +
        '<button class="qqm-close" type="button" aria-label="Dismiss">' +
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
        '</button>' +
        '<div class="qqm-icon" aria-hidden="true">' +
          '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>' +
        '</div>' +
        '<h3 class="qqm-title" id="qqmTitle">Daily limit reached</h3>' +
        '<p class="qqm-text">You\u2019ve used up all of your <strong class="qqm-resource"></strong> for today.</p>' +
        '<p class="qqm-sub">Resets in <span class="qqm-countdown"></span></p>' +
        '<button class="qqm-upgrade" type="button">Upgrade for unlimited</button>' +
        '<button class="qqm-later" type="button">Maybe later</button>' +
      '</div>';

    modal.addEventListener('click', function (e) {
      if (e.target === modal || e.target.classList.contains('qqm-bg')) {
        _close();
      }
    });

    var upgrade = modal.querySelector('.qqm-upgrade');
    if (upgrade) {
      upgrade.addEventListener('click', function () {
        _close();
        if (typeof window.openUpgradeModal === 'function') {
          window.openUpgradeModal();
        } else {
          window.location.href = '/pricing';
        }
      });
    }

    var later = modal.querySelector('.qqm-later');
    if (later) {
      later.addEventListener('click', _close);
    }

    var close = modal.querySelector('.qqm-close');
    if (close) {
      close.addEventListener('click', _close);
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal.classList.contains('qqm--open')) {
        _close();
      }
    });

    document.body.appendChild(modal);
    return modal;
  }

  function _close() {
    var modal = document.getElementById('qqm');
    if (modal) modal.classList.remove('qqm--open');
    if (_timer) { clearInterval(_timer); _timer = null; }
    document.body.style.overflow = '';
  }

  window.showQuotaModal = function (opts) {
    opts = opts || {};
    var modal = _ensureDom();
    var resource = opts.resource || 'AI generation';
    var used = parseInt(opts.used, 10);
    var limit = parseInt(opts.limit, 10);
    var tier = opts.tier || '';

    // Paying users already on the top tier never see an upsell — just the
    // countdown. (Admins never reach this modal: the server exempts them.)
    var upgradeBtn = modal.querySelector('.qqm-upgrade');
    if (upgradeBtn) {
      upgradeBtn.style.display = (tier === 'premium') ? 'none' : '';
    }

    var resEl = modal.querySelector('.qqm-resource');
    if (resEl) {
      resEl.textContent = resource;
    }

    var textEl = modal.querySelector('.qqm-text');
    if (textEl) {
      textEl.innerHTML = 'You\u2019ve used up all of your <strong class="qqm-resource">' + resource + '</strong> for today.';
      if (!isNaN(used) && !isNaN(limit) && limit > 0) {
        textEl.innerHTML += '<br><span class="qqm-count">' + used + ' of ' + limit + ' used</span>';
      }
    }

    var countdownEl = modal.querySelector('.qqm-countdown');
    var seconds = parseInt(opts.resetsInSeconds, 10);
    if (!isNaN(seconds) && seconds >= 0) {
      _endsAt = Date.now() + seconds * 1000;
      _tick(countdownEl);
      if (_timer) clearInterval(_timer);
      _timer = setInterval(function () { _tick(countdownEl); }, 1000);
    } else {
      if (countdownEl) countdownEl.textContent = 'midnight';
    }

    modal.classList.add('qqm--open');
    document.body.style.overflow = 'hidden';

    var sheet = modal.querySelector('.qqm-sheet');
    if (sheet && sheet.focus) {
      sheet.setAttribute('tabindex', '-1');
      sheet.focus({ preventScroll: true });
    }
  };

  // ── Test hook ──────────────────────────────────────────────────────────────
  // ?quota_modal=1 pops the modal on load. Optional overrides:
  //   ?quota_modal=1&resource=quiz%20questions&used=10&limit=15&resets=7200
  function _initTestHook() {
    var params = new URLSearchParams(window.location.search);
    if (!params.has('quota_modal')) return;
    var resets = parseInt(params.get('resets'), 10);
    if (isNaN(resets)) resets = 5 * 3600 + 23 * 60;
    if (typeof window.showQuotaModal === 'function') {
      window.showQuotaModal({
        resource: params.get('resource') || 'flashcards',
        used: parseInt(params.get('used'), 10),
        limit: parseInt(params.get('limit'), 10),
        resetsInSeconds: resets,
      });
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _initTestHook);
  } else {
    _initTestHook();
  }
})();
