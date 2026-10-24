/**
 * credits-modal.js — Credits exhausted prompt.
 *
 * window.showCreditsExhaustedModal({ resetsInSeconds, resource })
 *
 * Pops a calm bottom-sheet explaining the credit balance is spent — the fuel
 * for every Motown AI generation — with a single Recharge CTA that opens the
 * upgrade modal (which defaults to the Recharge Credits tab).
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
    var existing = document.getElementById('cqm');
    if (existing) return existing;

    var modal = document.createElement('div');
    modal.id = 'cqm';
    modal.className = 'cqm';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'cqmTitle');
    modal.innerHTML =
      '<div class="cqm-bg"></div>' +
      '<div class="cqm-sheet" role="document">' +
        '<div class="cqm-handle"></div>' +
        '<button class="cqm-close" type="button" aria-label="Dismiss">' +
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
        '</button>' +
        '<div class="cqm-icon" aria-hidden="true">' +
          '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 8.4c.45 1.5 1.7 2.3 1.9 2.3-.2 0-1.45.8-1.9 2.3-.45-1.5-1.7-2.3-1.9-2.3.2 0 1.45-.8 1.9-2.3z"/></svg>' +
        '</div>' +
        '<h3 class="cqm-title" id="cqmTitle">You\u2019re out of credits</h3>' +
        '<p class="cqm-text">Credits are the fuel for your Motown AI account \u2014 every generation spends them. Recharge to keep making <span class="cqm-resource"></span>.</p>' +
        '<p class="cqm-sub">Daily allowance resets in <span class="cqm-countdown"></span></p>' +
        '<button class="cqm-recharge" type="button">Recharge credits</button>' +
        '<button class="cqm-later" type="button">Maybe later</button>' +
      '</div>';

    modal.addEventListener('click', function (e) {
      if (e.target === modal || e.target.classList.contains('cqm-bg')) {
        _close();
      }
    });

    var recharge = modal.querySelector('.cqm-recharge');
    if (recharge) {
      recharge.addEventListener('click', function () {
        _close();
        if (typeof window.openUpgradeModal === 'function') {
          window.openUpgradeModal();
        } else {
          window.location.href = '/pricing';
        }
      });
    }

    var later = modal.querySelector('.cqm-later');
    if (later) {
      later.addEventListener('click', function () {
        _close();
        // The credits are still spent — convert a graceful exit into a quiet
        // referral offer instead of letting them walk away empty-handed.
        if (typeof window.showReferralOfferModal === 'function') {
          window.showReferralOfferModal();
        }
      });
    }

    var close = modal.querySelector('.cqm-close');
    if (close) {
      close.addEventListener('click', _close);
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal.classList.contains('cqm--open')) {
        _close();
      }
    });

    document.body.appendChild(modal);
    return modal;
  }

  function _close() {
    var modal = document.getElementById('cqm');
    if (modal) modal.classList.remove('cqm--open');
    if (_timer) { clearInterval(_timer); _timer = null; }
    document.body.style.overflow = '';
  }

  window.showCreditsExhaustedModal = function (opts) {
    opts = opts || {};
    var modal = _ensureDom();
    var resource = opts.resource || 'study materials';

    var resEl = modal.querySelector('.cqm-resource');
    if (resEl) resEl.textContent = resource;

    var countdownEl = modal.querySelector('.cqm-countdown');
    var seconds = parseInt(opts.resetsInSeconds, 10);
    if (!isNaN(seconds) && seconds >= 0) {
      _endsAt = Date.now() + seconds * 1000;
      _tick(countdownEl);
      if (_timer) clearInterval(_timer);
      _timer = setInterval(function () { _tick(countdownEl); }, 1000);
    } else {
      if (countdownEl) countdownEl.textContent = 'midnight';
    }

    modal.classList.add('cqm--open');
    document.body.style.overflow = 'hidden';

    var sheet = modal.querySelector('.cqm-sheet');
    if (sheet && sheet.focus) {
      sheet.setAttribute('tabindex', '-1');
      sheet.focus({ preventScroll: true });
    }
  };

  // ── Routing helper ────────────────────────────────────────────────────────
  // Call where a response carried quota_exceeded: if the backend also flagged
  // credits_exhausted, show the recharge prompt instead of the daily-limit one
  // and return true (caller should bail out of its quota branch).
  window.maybeShowCreditsExhausted = function (data, resource) {
    if (data && data.credits_exhausted && typeof window.showCreditsExhaustedModal === 'function') {
      window.showCreditsExhaustedModal({
        resource: resource || data.resource || '',
        resetsInSeconds: data.resets_in_seconds,
      });
      return true;
    }
    return false;
  };

  // ── Test hook ──────────────────────────────────────────────────────────────
  // ?credits_modal=1 pops the modal on load. Optional overrides:
  //   ?credits_modal=1&resource=flashcards&resets=7200
  function _initTestHook() {
    var params = new URLSearchParams(window.location.search);
    if (!params.has('credits_modal')) return;
    var resets = parseInt(params.get('resets'), 10);
    if (isNaN(resets)) resets = 5 * 3600 + 23 * 60;
    if (typeof window.showCreditsExhaustedModal === 'function') {
      window.showCreditsExhaustedModal({
        resource: params.get('resource') || '',
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