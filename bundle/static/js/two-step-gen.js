(function () {
  'use strict';

  window._buildTwoStepGen = function (config) {
    var root = document.createElement('div');
    root.style.cssText = 'display:flex;flex-direction:column;align-items:center;width:100%;gap:0;';

    var _disabled = false;

    function disableWidget() {
      if (_disabled) return;
      _disabled = true;
      root.querySelectorAll('button,[tabindex]').forEach(function(el) {
        el.style.pointerEvents = 'none';
        el.style.opacity = '0.45';
      });
    }

    function enableWidget() {
      if (!_disabled) return;
      _disabled = false;
      root.querySelectorAll('button,[tabindex]').forEach(function(el) {
        el.style.pointerEvents = '';
        el.style.opacity = '';
      });
    }

    // ── Step 1 HTML (icon + title + subtitle) ──
    var step1 = document.createElement('div');
    step1.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:8px;width:100%;margin-bottom:20px;';
    step1.innerHTML = config.step1Html || '';
    root.appendChild(step1);

    // ── Tier cards ──
    var cardsWrap = document.createElement('div');
    cardsWrap.className = 'gen-tier-grid';

    var _selectedValue = null;
    var genBtn; // declared here so selectCard can reference it

    config.tiers.forEach(function (tier, idx) {
      var card = document.createElement('div');
      card.className = 'gen-tier-card' + (tier.popular ? ' gen-tier-card--popular' : '');
      card.setAttribute('tabindex', '0');
      card.setAttribute('role', 'radio');
      card.setAttribute('aria-checked', 'false');
      card.setAttribute('data-count', tier.value);

      if (tier.popular) {
        var badge = document.createElement('div');
        badge.className = 'gen-tier-badge';
        badge.textContent = '\u2605 Popular';
        card.appendChild(badge);
      }

      var val = document.createElement('div');
      val.className = 'gen-tier-value';
      val.textContent = tier.label;
      card.appendChild(val);

      var sub = document.createElement('div');
      sub.className = 'gen-tier-label';
      sub.textContent = tier.sub;
      card.appendChild(sub);

      function selectCard() {
        if (_disabled) return;
        cardsWrap.querySelectorAll('.gen-tier-card').forEach(function(c) {
          c.classList.remove('gen-tier-card--selected');
          c.setAttribute('aria-checked', 'false');
        });
        card.classList.add('gen-tier-card--selected');
        card.setAttribute('aria-checked', 'true');
        _selectedValue = tier.value;
        if (genBtn) {
          genBtn.disabled = false;
          genBtn.classList.add('gen-confirm-btn--active');
        }
      }

      card.addEventListener('click', selectCard);
      card.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectCard(); }
      });

      cardsWrap.appendChild(card);

      // Auto-select popular, or first card if none popular
      if (tier.popular || (idx === 0 && !config.tiers.some(function(t) { return t.popular; }))) {
        // defer until genBtn exists
        cardsWrap._autoSelect = selectCard;
      }
    });

    root.appendChild(cardsWrap);

    // ── Generate button ──
    genBtn = document.createElement('button');
    genBtn.className = 'gen-confirm-btn';
    genBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M12 5v14M5 12h14"/></svg>' + (config.generateBtnLabel || 'Generate');
    root.appendChild(genBtn);

    // Auto-select now that genBtn exists
    if (cardsWrap._autoSelect) cardsWrap._autoSelect();

    genBtn.addEventListener('click', function () {
      if (!_selectedValue || _disabled) return;
      disableWidget();
      genBtn.textContent = 'Generating\u2026';
      config.onConfirm(_selectedValue);
    });

    // ── Status line ──
    var status = document.createElement('div');
    status.className = 'gen-confirm-status';
    root.appendChild(status);

    root.enableWidget = enableWidget;
    root.disableWidget = disableWidget;

    window.getSelectedTierValue = function(containerSelector, dataAttr) {
      var container = typeof containerSelector === 'string'
        ? document.querySelector(containerSelector) : containerSelector;
      if (!container) return null;
      var selected = container.querySelector('.gen-tier-card--selected');
      return selected ? selected.getAttribute(dataAttr || 'data-count') : null;
    };

    return root;
  };
})();
