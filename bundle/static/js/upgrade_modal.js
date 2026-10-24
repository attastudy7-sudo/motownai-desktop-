(function () {
  'use strict';

  /* ── Entry buttons (progressive enhancement, delegated) ──
     Registered before the modal existence check so `.js-open-upgrade`
     clicks open the modal whenever it's on the page; otherwise the
     anchor falls through to the pricing page. */
  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('.js-open-upgrade') : null;
    if (!el) return;
    if (!document.getElementById('upm')) return;
    e.preventDefault();
    openUpgradeModal();
  });

  var upm = document.getElementById('upm');
  if (!upm) return;

  var plans = safeJsonParse(upm.dataset.plans);
  var annualPlans = safeJsonParse(upm.dataset.annualPlans);
  var bundles = safeJsonParse(upm.dataset.bundles);
  var upgradeUrl = upm.dataset.upgradeUrl;
  var creditsUrl = upm.dataset.creditsUrl;
  var csrf = upm.dataset.csrf;
  var currency = upm.dataset.currency || 'GHS';
  var selPlan = null;
  var selBundle = null;
  var selMethod = 'card';
  var selBillingPeriod = 'monthly';
  var prevFocus = null;

  function _payProvider() {
    return (currency === 'NGN' || currency === 'USD') ? 'Paddle' : 'Paystack';
  }

  function _planPrice(plan) {
    var info = plans[plan];
    if (!info) return { symbol: 'GH\u20B5', amount: '' };
    var source = selBillingPeriod === 'annual' ? (annualPlans[plan] || info) : info;
    var p = source[currency] || source['GHS'] || {};
    return { symbol: p.symbol || 'GH\u20B5', amount: p.amount || info.price_ghs || '' };
  }

  function _priceHtml(p) {
    return p.symbol + p.amount;
  }

  function _bundlePrice(bundle) {
    var info = bundles[bundle];
    if (!info) return { symbol: 'GH\u20B5', amount: '' };
    var p = info[currency] || info['GHS'] || {};
    return { symbol: p.symbol || 'GH\u20B5', amount: p.amount || info.price_ghs || '' };
  }

  function safeJsonParse(s) {
    try { return JSON.parse(s); } catch (e) { return {}; }
  }

  function openUpgradeModal() {
    prevFocus = document.activeElement;
    resetPicker();
    upm.classList.add('open');
    document.body.style.overflow = 'hidden';
    var firstTab = upm.querySelector('.upm-tab');
    if (firstTab) firstTab.focus();
  }

  function closeUpgradeModal() {
    upm.classList.remove('open');
    document.body.style.overflow = '';
    selPlan = null;
    selBundle = null;
    selBillingPeriod = 'monthly';
    _updateBillingToggle();
    if (prevFocus) prevFocus.focus();
  }

  window.openUpgradeModal = openUpgradeModal;

  function resetPicker() {
    document.getElementById('upmPicker').hidden = false;
    document.getElementById('upmConfirm').hidden = true;
    document.getElementById('upmPayRow').style.display = '';
    document.getElementById('upmError').hidden = true;
    var btn = document.getElementById('upmPayBtn');
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-lock"></i> Pay with ' + _payProvider();
    selBillingPeriod = 'monthly';
    _updateBillingToggle();
    _refreshPlanPrices();
    switchTab('credits');
  }

  /* ── Billing period toggle ── */
  function _updateBillingToggle() {
    upm.querySelectorAll('.upm-billing-btn').forEach(function (btn) {
      var isActive = btn.dataset.period === selBillingPeriod;
      btn.classList.toggle('upm-billing-btn--active', isActive);
      btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
    });
  }

  function _refreshPlanPrices() {
    var ps = _planPrice('starter');
    var pp = _planPrice('premium');
    var perLabel = selBillingPeriod === 'annual' ? '/yr' : '/mo';
    var starterEl = document.getElementById('upmPriceStarter');
    if (starterEl) starterEl.innerHTML = _priceHtml(ps) + '<span class="upm-card__per">' + perLabel + '</span>';
    var premiumEl = document.getElementById('upmPricePremium');
    if (premiumEl) premiumEl.innerHTML = _priceHtml(pp) + '<span class="upm-card__per">' + perLabel + '</span>';
  }

  function _isTrialEligible() {
    return selBillingPeriod === 'monthly' && selMethod === 'card' && (currency === 'NGN' || currency === 'USD');
  }

  function _refreshConfirmCopy(info) {
    var p = _planPrice(selPlan);
    var periodLabel = selBillingPeriod === 'annual' ? 'Annual' : 'Monthly';
    var perLabel = selBillingPeriod === 'annual' ? '/yr' : '/mo';
    var eligible = _isTrialEligible();
    document.getElementById('upmCName').textContent = info.name + ' \u2014 ' + periodLabel + (eligible ? ' (Free Trial)' : '');
    document.getElementById('upmCPrice').innerHTML = eligible
      ? 'Free for 7 days, then ' + p.symbol + p.amount + '/mo'
      : _priceHtml(p) + perLabel;
    _updatePayHints();
    var btn2 = document.getElementById('upmPayBtn');
    if (btn2) btn2.innerHTML = '<i class="ti ti-lock"></i> ' + (eligible ? 'Start free trial' : 'Pay with ' + _payProvider());
  }

  upm.addEventListener('click', function (e) {
    var btn = e.target.closest('.upm-billing-btn');
    if (!btn) return;
    selBillingPeriod = btn.dataset.period || 'monthly';
    _updateBillingToggle();
    _refreshPlanPrices();
    if (selPlan && plans[selPlan]) _refreshConfirmCopy(plans[selPlan]);
  });

  function _updatePayHints() {
    var cardHint = document.getElementById('upmCardHint');
    var momoHint = upm.querySelector('.upm-pay-opt[data-method="momo"] .upm-pay-opt__hint');
    var eligible = _isTrialEligible();
    if (eligible) {
      if (cardHint) cardHint.textContent = 'Card collected — charged after 7 days';
      if (momoHint) momoHint.textContent = 'No trial — one-time \u00b7 30 days';
    } else if (selBillingPeriod === 'annual') {
      if (cardHint) cardHint.textContent = 'Auto-renews annually';
      if (momoHint) momoHint.textContent = 'One-time \u00b7 365 days';
    } else {
      if (cardHint) cardHint.textContent = 'Auto-renews monthly';
      if (momoHint) momoHint.textContent = 'One-time \u00b7 30 days';
    }
  }

  /* ── Tabs ── */
  var tabs = upm.querySelectorAll('.upm-tab');
  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      switchTab(this.dataset.tab);
    });
  });

  function switchTab(tab) {
    tabs.forEach(function (t) {
      t.classList.remove('upm-tab--active');
      t.setAttribute('aria-selected', 'false');
    });
    var activeTab = upm.querySelector('.upm-tab[data-tab="' + tab + '"]');
    if (activeTab) {
      activeTab.classList.add('upm-tab--active');
      activeTab.setAttribute('aria-selected', 'true');
    }
    document.getElementById('upmTabPlans').classList.toggle('upm-tab-body--active', tab === 'plans');
    document.getElementById('upmTabCredits').classList.toggle('upm-tab-body--active', tab === 'credits');
  }

  /* ── Card selection ── */
  upm.addEventListener('click', function (e) {
    var card = e.target.closest('.upm-card');
    if (!card) return;
    if (card.dataset.plan) {
      selectPlan(card.dataset.plan);
    } else if (card.dataset.bundle) {
      selectBundle(card.dataset.bundle);
    }
  });

  function selectPlan(plan) {
    selPlan = plan;
    selBundle = null;
    var info = plans[plan];
    if (!info) return;
    selMethod = 'card';
    var opts = upm.querySelectorAll('.upm-pay-opt');
    opts.forEach(function (o) { o.classList.remove('upm-pay-opt--active'); });
    var cardOpt = upm.querySelector('.upm-pay-opt[data-method="card"]');
    if (cardOpt) cardOpt.classList.add('upm-pay-opt--active');
    document.getElementById('upmError').hidden = true;
    _refreshConfirmCopy(info);
    var btn = document.getElementById('upmPayBtn');
    btn.disabled = false;
    document.getElementById('upmPicker').hidden = true;
    document.getElementById('upmConfirm').hidden = false;
    var backBtn = upm.querySelector('.upm-back');
    if (backBtn) backBtn.focus();
  }

  function selectBundle(bundle) {
    selBundle = bundle;
    selPlan = null;
    var info = bundles[bundle];
    if (!info) return;
    var p = _bundlePrice(bundle);
    document.getElementById('upmCName').textContent = info.label + ' \u2014 One-time';
    document.getElementById('upmCPrice').textContent = p.symbol + p.amount;
    document.getElementById('upmPayRow').style.display = 'none';
    document.getElementById('upmError').hidden = true;
    var btn = document.getElementById('upmPayBtn');
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-lock"></i> Pay with ' + _payProvider();
    document.getElementById('upmPicker').hidden = true;
    document.getElementById('upmConfirm').hidden = false;
    var backBtn = upm.querySelector('.upm-back');
    if (backBtn) backBtn.focus();
  }

  /* ── Payment method selection ── */
  upm.addEventListener('click', function (e) {
    var opt = e.target.closest('.upm-pay-opt');
    if (!opt) return;
    var method = opt.dataset.method;
    if (!method) return;
    selMethod = method;
    upm.querySelectorAll('.upm-pay-opt').forEach(function (o) { o.classList.remove('upm-pay-opt--active'); });
    opt.classList.add('upm-pay-opt--active');
    if (selPlan && plans[selPlan]) _refreshConfirmCopy(plans[selPlan]);
  });

  /* ── Back ── */
  var backBtn = upm.querySelector('.upm-back');
  if (backBtn) {
    backBtn.addEventListener('click', function () {
      document.getElementById('upmConfirm').hidden = true;
      document.getElementById('upmPicker').hidden = false;
      selPlan = null;
      selBundle = null;
      var firstTab = upm.querySelector('.upm-tab--active') || upm.querySelector('.upm-tab');
      if (firstTab) firstTab.focus();
    });
  }

  /* ── Cancel ── */
  var cancelBtn = upm.querySelector('.upm-cancel');
  if (cancelBtn) cancelBtn.addEventListener('click', closeUpgradeModal);

  /* ── Overlay click ── */
  var bg = upm.querySelector('.upm-bg');
  if (bg) bg.addEventListener('click', closeUpgradeModal);

  /* ── Escape key ── */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && upm.classList.contains('open')) {
      closeUpgradeModal();
    }
  });

  /* ── Pay ── */
  var payBtn = document.getElementById('upmPayBtn');
  if (payBtn) {
    payBtn.addEventListener('click', function () {
      var btn = this;
      var err = document.getElementById('upmError');
      err.hidden = true;

      if (selPlan) {
        btn.disabled = true;
        btn.innerHTML = '<span class="upm-spin"></span> Opening ' + _payProvider() + ' checkout...';
        var fd = new FormData();
        fd.append('plan', selPlan);
        fd.append('billing_period', selBillingPeriod);
        fd.append('payment_method', selMethod);
        fd.append('currency', currency);
        fd.append('trial', _isTrialEligible() ? '1' : '0');
        fd.append('origin', location.pathname);
        fd.append('csrf_token', csrf);
        fetch(upgradeUrl, { method: 'POST', body: fd })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (d.success) {
              if (d.transaction_id && typeof Paddle !== 'undefined' && Paddle.Initialized) {
                try { sessionStorage.setItem('motown_paddle_return', d.return_url || (window.location.origin + location.pathname)); } catch (e) {}
                Paddle.Checkout.open({
                  transactionId: d.transaction_id,
                  settings: { successUrl: d.return_url || (window.location.origin + location.pathname) }
                });
                btn.disabled = false;
                btn.innerHTML = '<i class="ti ti-lock"></i> Pay with ' + _payProvider();
              } else if (d.authorization_url) {
                window.location.href = d.authorization_url;
              } else {
                err.textContent = 'Payment could not be initiated.';
                err.hidden = false;
                btn.disabled = false;
                btn.innerHTML = '<i class="ti ti-lock"></i> Pay with ' + _payProvider();
              }
            } else {
              err.textContent = d.message || 'Payment failed.';
              err.hidden = false;
              btn.disabled = false;
              btn.innerHTML = '<i class="ti ti-lock"></i> Pay with ' + _payProvider();
            }
          })
          .catch(function () {
            err.textContent = 'Network error. Please try again.';
            err.hidden = false;
            btn.disabled = false;
            btn.innerHTML = '<i class="ti ti-lock"></i> Pay with ' + _payProvider();
          });
      } else if (selBundle) {
        var info = bundles[selBundle];
        if (!info) return;
        var p = _bundlePrice(selBundle);
        btn.disabled = true;
        btn.innerHTML = '<span class="upm-spin"></span> Opening ' + _payProvider() + ' checkout...';
        var fd = new FormData();
        fd.append('bundle', selBundle);
        fd.append('amount', p.amount);
        fd.append('currency', currency);
        fd.append('origin', location.pathname);
        fd.append('csrf_token', csrf);
        fetch(creditsUrl, { method: 'POST', body: fd })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (d.success) {
              if (d.transaction_id && typeof Paddle !== 'undefined' && Paddle.Initialized) {
                try { sessionStorage.setItem('motown_paddle_return', d.return_url || (window.location.origin + location.pathname)); } catch (e) {}
                Paddle.Checkout.open({
                  transactionId: d.transaction_id,
                  settings: { successUrl: d.return_url || (window.location.origin + location.pathname) }
                });
                btn.disabled = false;
                btn.innerHTML = '<i class="ti ti-lock"></i> Pay with ' + _payProvider();
              } else if (d.authorization_url) {
                window.location.href = d.authorization_url;
              } else {
                err.textContent = 'Payment could not be initiated.';
                err.hidden = false;
                btn.disabled = false;
                btn.innerHTML = '<i class="ti ti-lock"></i> Pay with ' + _payProvider();
              }
            } else {
              err.textContent = d.message || 'Payment failed.';
              err.hidden = false;
              btn.disabled = false;
              btn.innerHTML = '<i class="ti ti-lock"></i> Pay with ' + _payProvider();
            }
          })
          .catch(function () {
            err.textContent = 'Network error. Please try again.';
            err.hidden = false;
            btn.disabled = false;
            btn.innerHTML = '<i class="ti ti-lock"></i> Pay with ' + _payProvider();
          });
      }
    });
  }

  /* ── Initialise displayed prices ── */
  (function _initPrices() {
    function _set(id, text) {
      var el = document.getElementById(id);
      if (el) el.textContent = text;
    }
    var ps = _planPrice('starter');
    var pp = _planPrice('premium');
    // starter: replace inner text but keep the /mo span
    var starterEl = document.getElementById('upmPriceStarter');
    if (starterEl) starterEl.innerHTML = _priceHtml(ps) + '<span class="upm-card__per">/mo</span>';
    var premiumEl = document.getElementById('upmPricePremium');
    if (premiumEl) premiumEl.innerHTML = _priceHtml(pp) + '<span class="upm-card__per">/mo</span>';

    var b50 = _bundlePrice('50');
    var b120 = _bundlePrice('120');
    _set('upmPriceBundle50',  b50.symbol  + b50.amount);
    _set('upmPriceBundle120', b120.symbol + b120.amount);

    var rate50  = b50.amount  / 50;
    var rate120 = b120.amount / 120;
    function _fmtRate(r) {
      var s = r.toFixed(3).replace(/\.?0+$/, '');
      return s;
    }
    _set('upmRateBundle50',  b50.symbol  + _fmtRate(rate50)  + ' / credit');
    _set('upmRateBundle120', b120.symbol + _fmtRate(rate120) + ' / credit');
  })();

  /* ── Hide the plan the user is already on ──
     Subscribers (Starter) can now reach this modal to buy credits, so the
     Plans tab must not offer a plan they already pay for. */
  (function _hideCurrentPlan() {
    var current = (upm.dataset.currentPlan || '').trim();
    if (!current) return;
    var card = upm.querySelector('.upm-card[data-plan="' + current + '"]');
    if (card) card.remove();
    // If nothing is left to upgrade to, drop the Plans tab entirely.
    var plansTab = upm.querySelector('.upm-tab[data-tab="plans"]');
    var plansBody = document.getElementById('upmTabPlans');
    var anyPlan = upm.querySelector('.upm-card[data-plan]');
    if (!anyPlan && plansTab && plansBody) {
      plansTab.remove();
      plansBody.remove();
    }
  })();

  /* ── Handle ?upgrade= query param ── */
  var up = new URLSearchParams(location.search).get('upgrade');
  if (up) {
    if (up === 'starter' || up === 'premium') {
      openUpgradeModal();
      if ((upm.dataset.currentPlan || '').trim() === up) {
        // Already on this plan — land on credits instead of re-purchasing it.
        switchTab('credits');
      } else {
        selectPlan(up);
      }
    } else if (up === 'credits') {
      openUpgradeModal();
      switchTab('credits');
    }
    history.replaceState(null, '', location.pathname);
  }
})();
