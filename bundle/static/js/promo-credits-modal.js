/**
 * promo-credits-modal.js — Community promo code credited sheet.
 *
 * window.showPromoCreditsModal({ credits })
 *
 * A calm, encouraging bottom sheet shown once after a community promo code is
 * redeemed (right after onboarding, or after redeeming from Settings). Mirrors
 * the credits/referral bottom-sheet language (.cqm / .rqm).
 */
(function () {
  'use strict';

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function _ensureDom() {
    var existing = document.getElementById('pcm');
    if (existing) return existing;

    var modal = document.createElement('div');
    modal.id = 'pcm';
    modal.className = 'pcm';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'pcmTitle');
    modal.innerHTML =
      '<div class="pcm-bg"></div>' +
      '<div class="pcm-sheet" role="document">' +
        '<div class="pcm-handle"></div>' +
        '<button class="pcm-close" type="button" aria-label="Dismiss">' +
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
        '</button>' +
        '<div class="pcm-icon" aria-hidden="true">' +
          '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4"/><path d="M12 18v4"/><path d="M4.93 4.93l2.83 2.83"/><path d="M16.24 16.24l2.83 2.83"/><path d="M2 12h4"/><path d="M18 12h4"/><path d="M4.93 19.07l2.83-2.83"/><path d="M16.24 7.76l2.83-2.83"/></svg>' +
        '</div>' +
        '<h3 class="pcm-title" id="pcmTitle">You got bonus credits</h3>' +
        '<p class="pcm-text" id="pcmText">Your community code added credits to your balance.</p>' +
        '<button class="pcm-cta" type="button">Start studying</button>' +
      '</div>';

    modal.addEventListener('click', function (e) {
      if (e.target === modal || e.target.classList.contains('pcm-bg')) {
        _close();
      }
    });

    var cta = modal.querySelector('.pcm-cta');
    if (cta) {
      cta.addEventListener('click', _close);
    }

    var close = modal.querySelector('.pcm-close');
    if (close) {
      close.addEventListener('click', _close);
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal.classList.contains('pcm--open')) {
        _close();
      }
    });

    document.body.appendChild(modal);
    return modal;
  }

  function _close() {
    var modal = document.getElementById('pcm');
    if (modal) modal.classList.remove('pcm--open');
    document.body.style.overflow = '';
  }

  window.showPromoCreditsModal = function (opts) {
    opts = opts || {};
    var modal = _ensureDom();

    var credits = parseFloat(opts.credits) || 0;
    var textEl = document.getElementById('pcmText');
    if (textEl) {
      if (credits > 0) {
        textEl.textContent = 'Your community code added +' + (credits % 1 ? credits : Math.round(credits)) + ' credits to your balance.';
      } else {
        textEl.textContent = 'Your community code added credits to your balance.';
      }
    }

    modal.classList.add('pcm--open');
    document.body.style.overflow = 'hidden';

    var sheet = modal.querySelector('.pcm-sheet');
    if (sheet && sheet.focus) {
      sheet.setAttribute('tabindex', '-1');
      sheet.focus({ preventScroll: true });
    }
  };

  // ── Test hook ──────────────────────────────────────────────────────────────
  // ?promo_modal=1 pops the promo sheet on load.
  function _initTestHook() {
    var params = new URLSearchParams(window.location.search);
    if (!params.has('promo_modal')) return;
    if (typeof window.showPromoCreditsModal === 'function') {
      window.showPromoCreditsModal({ credits: 50 });
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _initTestHook);
  } else {
    _initTestHook();
  }
})();