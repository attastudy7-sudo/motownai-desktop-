// Study Room Tier Gating — card selection, quota enforcement, generation progress
// Tier card selection via event delegation (works with template-cloned DOM)
function selectTierCard(card) {
  if (!card || card.classList.contains('gen-tier-card--locked') || card.getAttribute('data-locked') === '1') return;
  var grid = card.closest('.gen-tier-grid');
  if (!grid) return;
  var siblings = grid.querySelectorAll('.gen-tier-card');
  for (var i = 0; i < siblings.length; i++) {
    siblings[i].classList.remove('gen-tier-card--selected');
    siblings[i].setAttribute('aria-checked', 'false');
  }
  card.classList.add('gen-tier-card--selected');
  card.setAttribute('aria-checked', 'true');
}

document.addEventListener('click', function (e) {
  var card = e.target.closest('.gen-tier-card');
  if (!card) return;
  if (card.classList.contains('gen-tier-card--locked') || card.getAttribute('data-locked') === '1') {
    e.stopPropagation();
    e.preventDefault();
    if (typeof window.openUpgradeModal === 'function') {
      window.openUpgradeModal();
    } else {
      window.location.href = '/pricing';
    }
    return;
  }
  selectTierCard(card);
});

document.addEventListener('keydown', function (e) {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  var card = e.target.closest('.gen-tier-card');
  if (!card || card.classList.contains('gen-tier-card--locked') || card.getAttribute('data-locked') === '1') return;
  e.preventDefault();
  selectTierCard(card);
});

// ── Quota gating ──────────────────────────────────────────────────────────
function initQuotaGating() {
  var tier = window.USER_TIER || 'free';
  var limits = window.USER_LIMITS || {};
  var daily = window.USER_DAILY || {};
  var hasCredits = (window.USER_CREDITS || 0) > 0;

  // ── Flashcard tier cards ──
  if (document.querySelector('.gen-tier-grid')) {
    var fcMax = limits.flashcards_per_day || 5;
    var fcUsed = daily.flashcards || 0;
    var fcRemaining = Math.max(0, fcMax - fcUsed);
    document.querySelectorAll('#fcTierGrid .gen-tier-card').forEach(function(card) {
      var count = parseInt(card.getAttribute('data-count') || '0', 10);
      var locked = !hasCredits && (count > fcMax || count > fcRemaining);
      _applyCardLock(card, locked, fcRemaining, tier);
    });

    // ── Quiz tier cards ──
    var qzMax = limits.quiz_per_day || 5;
    var qzUsed = daily.quiz || 0;
    var qzRemaining = Math.max(0, qzMax - qzUsed);
    document.querySelectorAll('#qzTierGrid .gen-tier-card').forEach(function(card) {
      var count = parseInt(card.getAttribute('data-count') || '0', 10);
      _applyCardLock(card, !hasCredits && (count > qzMax || count > qzRemaining), qzRemaining, tier);
    });

    // ── Fill-in tier cards ──
    var fiMax = limits.fillin_per_day || 5;
    var fiUsed = daily.fillin || 0;
    var fiRemaining = Math.max(0, fiMax - fiUsed);
    document.querySelectorAll('#fiTierGrid .gen-tier-card').forEach(function(card) {
      var count = parseInt(card.getAttribute('data-count') || '0', 10);
      _applyCardLock(card, !hasCredits && (count > fiMax || count > fiRemaining), fiRemaining, tier);
    });
  }
}

function _applyCardLock(card, locked, remaining, tier) {
  if (locked) {
    card.classList.add('gen-tier-card--locked');
    card.setAttribute('aria-disabled', 'true');
    card.setAttribute('tabindex', '-1');
    // Add upgrade badge if not already present
    if (!card.querySelector('.gen-tier-lock')) {
      var badge = document.createElement('div');
      badge.className = 'gen-tier-lock';
      badge.innerHTML = '<i class="ti ti-lock" aria-hidden="true"></i>';
      badge.title = tier === 'free' ? 'Upgrade to unlock' : 'Limit reached';
      card.appendChild(badge);
    }
    // Deselect if currently selected
    card.classList.remove('gen-tier-card--selected');
    card.setAttribute('aria-checked', 'false');
  } else {
    card.classList.remove('gen-tier-card--locked');
    card.removeAttribute('aria-disabled');
    card.removeAttribute('data-locked');
    card.setAttribute('tabindex', '0');
    var badge = card.querySelector('.gen-tier-lock');
    if (badge) badge.remove();
  }
}

function _disableGenBtn(id, msg) {
  var btn = document.getElementById(id);
  if (!btn) return;
  btn.disabled = true;
  btn.title = msg;
}

function _showUpgradePrompt(currentTier) {
  var msg = currentTier === 'free'
    ? 'You\'ve reached your free daily limit. Upgrade to generate more.'
    : 'You\'ve reached your plan\'s daily limit.';
  var existing = document.querySelector('.quota-upgrade-banner');
  if (existing) return;
  var banner = document.createElement('div');
  banner.className = 'quota-upgrade-banner';
  banner.innerHTML =
    '<span>' + msg + '</span>' +
    '<a href="/pricing" class="quota-upgrade-link">View plans <i class="ti ti-arrow-right" aria-hidden="true"></i></a>' +
    '<button class="quota-upgrade-close" onclick="this.closest(\'.quota-upgrade-banner\').remove()" aria-label="Dismiss">&times;</button>';
  document.querySelector('.room-viewports, #paneMain, body').prepend(banner);
  setTimeout(function() { if (banner.parentNode) banner.remove(); }, 8000);
}

// Init on DOMContentLoaded
document.addEventListener('DOMContentLoaded', function () {
  initQuotaGating();
});

// ── Generation progress phases ──────────────────────────────────────────────
(function () {
  var PHASES = {
    fcLoading: ['Preparing context…', 'Generating flashcards…', 'Verifying quality…', 'Almost done…'],
    qzLoading: ['Preparing context…', 'Writing questions…',     'Verifying quality…', 'Almost done…'],
    fiLoading: ['Preparing context…', 'Generating fill-ins…',   'Verifying quality…', 'Almost done…'],
  };
  var DELAYS = [0, 5000, 13000, 22000];

  function start(id) {
    var el = document.getElementById(id);
    var txt = el && el.querySelector('.gen-phase-text');
    if (!txt) return;
    var phases = PHASES[id] || ['Generating…'];
    el._gpt = phases.map(function (label, i) {
      return setTimeout(function () { txt.textContent = label; }, DELAYS[i] || i * 7000);
    });
  }

  function stop(id) {
    var el = document.getElementById(id);
    if (el && el._gpt) { el._gpt.forEach(clearTimeout); el._gpt = null; }
  }

  Object.keys(PHASES).forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    new MutationObserver(function () {
      (el.style.display && el.style.display !== 'none') ? start(id) : stop(id);
    }).observe(el, { attributes: true, attributeFilter: ['style'] });
  });

  // Same rotating-text idea, but for the small inline "More" button status
  // spans (fcMoreStatus/qzMoreStatus/fiMoreStatus), which otherwise sit blank
  // or static for the whole wait. Callers start it right before firing the
  // "more" fetch and call the returned stop() once the response lands.
  window.srStartMorePhases = function (el, phases, delays) {
    if (!el) return function () {};
    delays = delays || [0, 4000, 9000];
    var timers = phases.map(function (label, i) {
      return setTimeout(function () { el.textContent = label; }, delays[i] != null ? delays[i] : i * 6000);
    });
    return function stop() { timers.forEach(clearTimeout); };
  };
})();

// ── Generation percentage counter ─────────────────────────────────────────
// Starts at 0%, slowly ticks up toward 99%, call the returned function with
// true to snap to 100% when generation actually completes.
function _startGenPct(elId) {
  var el = document.getElementById(elId);
  if (!el) return function () {};
  var startTime = Date.now();
  var raf;
  function tick() {
    var elapsed = (Date.now() - startTime) / 1000;
    var pct = Math.min(99, 100 * (1 - Math.exp(-elapsed / 8)));
    el.textContent = Math.floor(pct) + '%';
    raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);
  return function (snap) {
    cancelAnimationFrame(raf);
    if (snap && el) el.textContent = '100%';
  };
}
