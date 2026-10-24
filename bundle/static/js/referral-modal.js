/**
 * referral-modal.js — Friendly referral offer sheet.
 *
 * window.showReferralOfferModal({ total, tiers })
 *
 * Pops after the credits sheet's "Maybe later" — a calm pitch: refer a friend
 * and earn credits the moment they sign up, tiered (50 → 30 → 20, then none).
 * Primary CTA routes to /invite where the student copies their link.
 */
(function () {
  'use strict';

  var DEFAULT_TIERS = [
    { label: 'First friend', credits: 50 },
    { label: 'Second friend', credits: 30 },
    { label: 'Third friend', credits: 20 },
  ];

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function _ensureDom() {
    var existing = document.getElementById('rqm');
    if (existing) return existing;

    var modal = document.createElement('div');
    modal.id = 'rqm';
    modal.className = 'rqm';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'rqmTitle');
    modal.innerHTML =
      '<div class="rqm-bg"></div>' +
      '<div class="rqm-sheet" role="document">' +
        '<div class="rqm-handle"></div>' +
        '<button class="rqm-close" type="button" aria-label="Dismiss">' +
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
        '</button>' +
        '<div class="rqm-icon" aria-hidden="true">' +
          '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12v10H4V12"/><path d="M2 7h20v5H2z"/><path d="M12 22V7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>' +
        '</div>' +
        '<h3 class="rqm-title" id="rqmTitle">Refer a friend \u2014 earn free credits</h3>' +
        '<p class="rqm-text">Share your link and the credits land in your balance the moment your friend signs up.</p>' +
        '<ul class="rqm-tiers" id="rqmTiers"></ul>' +
        '<p class="rqm-sub"><span class="rqm-total" id="rqmTotal"></span> in total \u2014 then referrals wrap up for good.</p>' +
        '<button class="rqm-cta" type="button">Get my referral link</button>' +
        '<button class="rqm-later" type="button">Not right now</button>' +
      '</div>';

    modal.addEventListener('click', function (e) {
      if (e.target === modal || e.target.classList.contains('rqm-bg')) {
        _close();
      }
    });

    var cta = modal.querySelector('.rqm-cta');
    if (cta) {
      cta.addEventListener('click', function () {
        _close();
        window.location.href = '/invite';
      });
    }

    var later = modal.querySelector('.rqm-later');
    if (later) {
      later.addEventListener('click', _close);
    }

    var close = modal.querySelector('.rqm-close');
    if (close) {
      close.addEventListener('click', _close);
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal.classList.contains('rqm--open')) {
        _close();
      }
    });

    document.body.appendChild(modal);
    return modal;
  }

  function _close() {
    var modal = document.getElementById('rqm');
    if (modal) modal.classList.remove('rqm--open');
    document.body.style.overflow = '';
  }

  function _renderTiers(tiers) {
    var list = document.getElementById('rqmTiers');
    if (!list) return 0;
    list.innerHTML = (tiers || []).map(function (t) {
      return '<li class="rqm-tier">' +
        '<span class="rqm-tier-label">' + _esc(t.label || '') + '</span>' +
        '<span class="rqm-tier-num">+' + (parseInt(t.credits, 10) || 0) + '</span>' +
        '</li>';
    }).join('');
    return (tiers || []).reduce(function (sum, t) {
      return sum + (parseInt(t.credits, 10) || 0);
    }, 0);
  }

  window.showReferralOfferModal = function (opts) {
    opts = opts || {};
    var tiers = opts.tiers || DEFAULT_TIERS;
    var modal = _ensureDom();
    var renderedTotal = _renderTiers(tiers);
    var total = opts.total != null ? parseInt(opts.total, 10) : renderedTotal;

    var totalEl = document.getElementById('rqmTotal');
    if (totalEl) totalEl.textContent = '+' + total + ' credits';

    modal.classList.add('rqm--open');
    document.body.style.overflow = 'hidden';

    var sheet = modal.querySelector('.rqm-sheet');
    if (sheet && sheet.focus) {
      sheet.setAttribute('tabindex', '-1');
      sheet.focus({ preventScroll: true });
    }
  };

  // ── Test hook ──────────────────────────────────────────────────────────────
  // ?referral_modal=1 pops the referral offer on load.
  function _initTestHook() {
    var params = new URLSearchParams(window.location.search);
    if (!params.has('referral_modal')) return;
    if (typeof window.showReferralOfferModal === 'function') {
      window.showReferralOfferModal();
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _initTestHook);
  } else {
    _initTestHook();
  }
})();