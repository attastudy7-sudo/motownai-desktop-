// Study Room Onboarding Tours — spotlight-based guided tours

/* ── Study room onboarding tour ────────────────────────────────────── */

(function () {
  var OB_KEY = 'ob_tip_sr_' + window.USER_ID;
  // ?sr_tour=1 replays the tour even for users who've already seen it
  // (QA / demo). Without the param, the tour still auto-runs once via the key.
  var forceTour = /[?&]sr_tour=1(&|$)/.test(window.location.search);
  if (localStorage.getItem(OB_KEY) && !forceTour) return;

  // Shared popup gate reference for serialization with other surfaces
  var _srPopupGate = window.MotownPopup;

  // Strip sr_tour from the URL so it doesn't leak into pack state or
  // interfere with the study room's own URL-sensitive logic (e.g. open_notes,
  // topics filter) during page load.
  if (forceTour && history.replaceState) {
    try {
      var u = new URL(window.location.href);
      u.searchParams.delete('sr_tour');
      history.replaceState(null, '', u.toString());
    } catch (_) {}
  }

  var tip    = document.getElementById('srObTip');
  var titleEl = document.getElementById('srObTitle');
  var bodyEl  = document.getElementById('srObBody');
  var stepEl  = document.getElementById('srObStep');
  var nextBtn = document.getElementById('srObNext');
  var skipBtn = document.getElementById('srObSkip');
  if (!tip || !titleEl || !bodyEl || !nextBtn || !skipBtn) return;

  function firstVisible(sels) {
    for (var i = 0; i < sels.length; i++) {
      var el = document.querySelector(sels[i]);
      if (el) {
        var r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return el;
      }
    }
    return null;
  }

  /* The AI FAB is a launcher: its real surface is the pop-up menu holding the
     individual toggles (Chat with AI / Interactive AI). Activate the FAB when
     the tour reaches those steps so the spotlight can point at each toggle
     instead of the closed button. Restored to the pre-tour state on dismiss. */
  var _fabOpenedByTour = false;

  /* The FAB only exists on ≤1024px screens — on desktop the AI entry points
     live in the top bar / action bar. Return true only when the FAB button is
     actually on screen so we never spotlight its invisible (desktop) menu. */
  function fabOnScreen() {
    var fab = document.getElementById('srAiFab');
    if (!fab) return false;
    var r = fab.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function openFabForTour() {
    var menu = document.getElementById('srAiFabMenu');
    var fab  = document.getElementById('srAiFab');
    if (!menu || !fabOnScreen()) return;
    if (!menu.classList.contains('is-open')) {
      menu.classList.add('is-open');
      if (fab) fab.setAttribute('aria-expanded', 'true');
      _fabOpenedByTour = true;
    }
  }

  function restoreFab() {
    if (!_fabOpenedByTour) return;
    var menu = document.getElementById('srAiFabMenu');
    var fab  = document.getElementById('srAiFab');
    if (menu) menu.classList.remove('is-open');
    if (fab) fab.setAttribute('aria-expanded', 'false');
    _fabOpenedByTour = false;
  }

  var STEPS = [
    {
      getAnchor: function () {
        /* Mobile: the floating tab rail. Desktop: the left-rail tab buttons
           (Notes was merged into Study Guide; the AI tutor tab replaced the
           old Podcast tab). */
        return firstVisible([
          '#mobileRoomTabs',
          '.dsn-link[data-target="tab-guided"]',
          '.dsn-link[data-target="tab-video"]',
        ]);
      },
      title: 'Study modes',
      body: 'Switch between Slides, Study Guide, Flashcards, Quizzes, Fill-in, Video, and the AI tutor. Each tab is a different way to study the same material.',
    },
    {
      getAnchor: function () {
        openFabForTour();
        /* Mobile: spotlight the opened menu's chat toggle. Desktop: the whole
           AI chat pane (#vp-chat) instead of just the toggle button. */
        if (fabOnScreen()) {
          return firstVisible(['.fab-ai-menu__item[data-fab-action="chat"]', '.fab-ai']);
        }
        return firstVisible(['#vp-chat', '#paneAi', '#srAiToggleBtn']);
      },
      title: 'Your AI tutor',
      body: 'Tap "Chat with AI" to open a chat that has read your entire pack. Ask it to explain anything, quiz you, or summarise a section.',
    },
    {
      getAnchor: function () {
        openFabForTour();
        /* Mobile: the opened menu's "Interactive AI" toggle. Desktop: the
           "Narrate to me" button in the study-guide action bar. */
        if (fabOnScreen()) {
          return firstVisible([
            '#srAiFabReadto',
            '.fab-ai-menu__item[data-fab-action="readto"]',
            '.fab-ai',
          ]);
        }
        return firstVisible(['[data-readto-entry]', '#srAiFabReadto', '.fab-ai']);
      },
      title: 'Read to me',
      body: 'Use "Interactive AI" to have the pack read aloud, word by word, with the paragraph highlighted as it goes. Pick up right where you left off.',
    },
  ];

  var cur   = 0;
  var _hole = null;

  function positionSpotlight(anchor) {
    var r   = anchor.getBoundingClientRect();
    var br  = window.getComputedStyle(anchor).borderRadius || '12px';
    var pad = 8;

    if (tip.parentNode !== document.body) document.body.appendChild(tip);

    if (!_hole) {
      _hole = document.createElement('div');
      _hole.id = 'obSpotlightHole';
      document.body.appendChild(_hole);
    }
    _hole.style.top          = (r.top  - pad) + 'px';
    _hole.style.left         = (r.left - pad) + 'px';
    _hole.style.width        = (r.width  + pad * 2) + 'px';
    _hole.style.height       = (r.height + pad * 2) + 'px';
    _hole.style.borderRadius = br;

    var tipH    = tip.offsetHeight || 120;
    var below   = window.innerHeight - r.bottom - pad - 12;
    var above   = r.top - pad - 12;
    var goAbove = below < tipH && above >= tipH;

    tip.classList.toggle('sr-ob-tip--above',  goAbove);
    tip.classList.toggle('sr-ob-tip--below', !goAbove);
    tip.classList.add('sr-ob-tip--spotlight');

    var tipW    = tip.offsetWidth || 232;
    var maxLeft = window.innerWidth - tipW - 8;
    var tipLeft = Math.max(8, Math.min(r.left, maxLeft));
    var anchorCx = r.left + r.width / 2;
    var arrowLeft = Math.round(anchorCx - tipLeft - 7);
    arrowLeft = Math.max(12, Math.min(arrowLeft, tipW - 20));

    tip.style.setProperty('--sr-ob-arrow-left', arrowLeft + 'px');
    tip.style.left = tipLeft + 'px';
    tip.style.top  = goAbove
      ? (r.top  - pad - 12 - tipH) + 'px'
      : (r.bottom + pad + 12) + 'px';
  }

  function positionSpotlightLeft(anchor) {
    var r   = anchor.getBoundingClientRect();
    var br  = window.getComputedStyle(anchor).borderRadius || '12px';
    var pad = 8;

    if (tip.parentNode !== document.body) document.body.appendChild(tip);

    if (!_hole) {
      _hole = document.createElement('div');
      _hole.id = 'obSpotlightHole';
      document.body.appendChild(_hole);
    }
    _hole.style.top          = (r.top  - pad) + 'px';
    _hole.style.left         = (r.left - pad) + 'px';
    _hole.style.width        = (r.width  + pad * 2) + 'px';
    _hole.style.height       = (r.height + pad * 2) + 'px';
    _hole.style.borderRadius = br;

    var tipW    = tip.offsetWidth || 232;
    var tipH    = tip.offsetHeight || 120;
    var left    = r.left - pad - tipW - 12;  // Position to the left of anchor
    var top     = r.top + (r.height / 2) - (tipH / 2);  // Vertically centered

    // Adjust if tip would go off screen
    if (left < 8) {
      left = r.right + pad + 12;  // Fall back to right side
    }
    if (left + tipW > window.innerWidth - 8) {
      left = window.innerWidth - tipW - 8;  // Clamp to right edge
    }
    if (top < 8) {
      top = 8;  // Clamp to top edge
    }
    if (top + tipH > window.innerHeight - 8) {
      top = window.innerHeight - tipH - 8;  // Clamp to bottom edge
    }

    tip.classList.remove('sr-ob-tip--above', 'sr-ob-tip--below');
    tip.classList.add('sr-ob-tip--spotlight', 'sr-ob-tip--left');

    var tipLeft = Math.max(8, left);
    var tipTop  = Math.max(8, top);
    var anchorCy = r.top + r.height / 2;
    var arrowTop = Math.round(anchorCy - tipTop - tipH / 2);
    arrowTop = Math.max(12, Math.min(arrowTop, tipH - 20));

    tip.style.setProperty('--sr-ob-arrow-top', arrowTop + 'px');
    tip.style.left = tipLeft + 'px';
    tip.style.top  = tipTop + 'px';
  }

  function renderStep(idx) {
    var step   = STEPS[idx];
    var anchor = step.getAnchor();
    if (!anchor) return false;

    titleEl.textContent = step.title;
    bodyEl.textContent  = step.body;
    if (stepEl) stepEl.textContent = (idx + 1) + ' / ' + STEPS.length;
    nextBtn.textContent = idx === STEPS.length - 1 ? 'Done' : 'Next →';

    // Use left positioning for "Your AI tutor" step (index 1)
    if (idx === 1) {
      positionSpotlightLeft(anchor);
    } else {
      positionSpotlight(anchor);
    }

    /* The FAB menu fades/translates in over ~160ms — re-home the spotlight
       once it settles so the hole hugs the toggle instead of the mid-animation
       position. Non-menu anchors measure instantly, so this is a no-op for them. */
    if (anchor.closest && anchor.closest('#srAiFabMenu')) {
      setTimeout(function () {
        var settled = step.getAnchor();
        if (settled) {
          // For AI tutor step, we might need to re-apply left positioning
          if (idx === 1 && settled) {
            positionSpotlightLeft(settled);
          } else {
            positionSpotlight(settled);
          }
        }
      }, 200);
    }

    return true;
  }

  function next() {
    if (cur >= STEPS.length - 1) { dismiss(); return; }
    tip.classList.remove('sr-ob-tip--visible');
    if (_hole) _hole.classList.remove('ob-hl--on');
    setTimeout(function () {
      cur++;
      while (cur < STEPS.length && !renderStep(cur)) cur++;
      if (cur >= STEPS.length) { dismiss(); return; }
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (_hole) _hole.classList.add('ob-hl--on');
          tip.classList.add('sr-ob-tip--visible');
        });
      });
    }, 220);
  }

  function dismiss() {
    var gate = _srPopupGate;
    if (gate) gate.close('sr-onboarding-tour');
    tip.classList.remove('sr-ob-tip--visible', 'sr-ob-tip--spotlight');
    document.removeEventListener('click', outsideClick, true);
    if (_hole) {
      _hole.classList.remove('ob-hl--on');
      var h = _hole; _hole = null;
      setTimeout(function () { if (h.parentNode) h.parentNode.removeChild(h); }, 350);
    }
    restoreFab();
    localStorage.setItem(OB_KEY, '1');
  }

  function outsideClick(e) {
    if (tip.contains(e.target)) return;
    dismiss();
  }

  nextBtn.addEventListener('click', function (e) { e.stopPropagation(); next(); });
  skipBtn.addEventListener('click', function (e) { e.stopPropagation(); dismiss(); });

  // Wait for pack content to mount before starting the tour to avoid
  // interference with pack initialization and URL-sensitive code.
  function startTourWhenReady() {
    var attempt = 0;
    var maxAttempts = 30; // ~3 seconds total (30 * 100ms)
    
    function checkAndStart() {
      // Check if we can render the first step (anchor exists)
      if (renderStep(0)) {
        // Tour can start - proceed with normal flow
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            if (_hole) _hole.classList.add('ob-hl--on');
            tip.classList.add('sr-ob-tip--visible');
          });
        });
        setTimeout(function () {
          document.addEventListener('click', outsideClick, true);
        }, 350);
        return;
      }
      
      // If we've exhausted attempts, still call dismiss() to set the key
      // so we don't keep retrying forever when forceTour=true
      if (++attempt >= maxAttempts) {
        dismiss(); // Mark as seen to prevent infinite retry loop
        return;
      }
      
      // Otherwise, wait and try again
      setTimeout(checkAndStart, 100);
    }
    
checkAndStart();
  }
   
  if (_srPopupGate) _srPopupGate.whenClear('sr-onboarding-tour', startTourWhenReady, 60000);
  else startTourWhenReady();
})();

/* ── Assessment tab tour (flashcards / quiz / fill-in) ─────────────── */

(function () {
  var OB_KEY = 'ob_tip_assess_' + window.USER_ID;
  if (localStorage.getItem(OB_KEY)) return;

  var tip     = document.getElementById('srAssessTip');
  var titleEl = document.getElementById('srAssessTitle');
  var bodyEl  = document.getElementById('srAssessBody');
  var stepEl  = document.getElementById('srAssessStep');
  var nextBtn = document.getElementById('srAssessNext');
  var skipBtn = document.getElementById('srAssessSkip');
  if (!tip || !titleEl || !bodyEl || !nextBtn || !skipBtn) return;

  var cur   = 0;
  var _hole = null;
  var _started = false;

  function vis(el) {
    if (!el) return false;
    if (el.offsetParent === null && el.tagName !== 'BODY') return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function activeNavBar() {
    return document.querySelector('#fcNav') || document.querySelector('#qzNav') || document.querySelector('#fiNav');
  }

  function activeMoreBtn() {
    var ids = ['#fcMoreBtn', '#qzMoreBtn', '#fiMoreBtn'];
    for (var i = 0; i < ids.length; i++) {
      var el = document.querySelector(ids[i]);
      if (el && vis(el)) return el;
    }
    // Fall back to the nav bar center so the tip still appears near the + area
    var nav = activeNavBar();
    return nav ? nav.querySelector('.fc-nav-bar-center') : nav;
  }

  function activeBadgeBar() {
    var bars = document.querySelectorAll('.sr-badge-bar');
    for (var i = 0; i < bars.length; i++) {
      if (vis(bars[i])) return bars[i];
    }
    return null;
  }

  var STEPS = [
    {
      getAnchor: activeNavBar,
      title: 'Navigate',
      body: 'Use the arrows to step through questions one by one. The counter in the middle shows where you are in the deck.',
    },
    {
      getAnchor: activeMoreBtn,
      title: 'Generate more',
      body: 'Tap + to ask the AI for more questions on the same material. Useful when you want a longer session or extra practice.',
    },
    {
      getAnchor: activeBadgeBar,
      title: 'Mastery tracker',
      body: 'Your answers sort questions into Unfamiliar, Learning, Familiar, and Mastered. The goal: get everything to Mastered.',
    },
  ];

  function positionSpotlight(anchor) {
    var r   = anchor.getBoundingClientRect();
    var br  = window.getComputedStyle(anchor).borderRadius || '8px';
    var pad = 8;

    if (tip.parentNode !== document.body) document.body.appendChild(tip);

    if (!_hole) {
      _hole = document.createElement('div');
      _hole.id = 'obSpotlightHole';
      document.body.appendChild(_hole);
    }
    _hole.style.top          = (r.top  - pad) + 'px';
    _hole.style.left         = (r.left - pad) + 'px';
    _hole.style.width        = (r.width  + pad * 2) + 'px';
    _hole.style.height       = (r.height + pad * 2) + 'px';
    _hole.style.borderRadius = br;

    var tipH    = tip.offsetHeight || 120;
    var tipW    = tip.offsetWidth  || 232;
    var below   = window.innerHeight - r.bottom - pad - 12;
    var above   = r.top - pad - 12;
    var goAbove = below < tipH && above >= tipH;

    tip.classList.toggle('sr-ob-tip--above',  goAbove);
    tip.classList.toggle('sr-ob-tip--below', !goAbove);
    tip.classList.add('sr-ob-tip--spotlight');

    // Compute tip left first so arrow offset is relative to actual tip position
    var maxLeft = window.innerWidth - tipW - 8;
    var tipLeft = Math.max(8, Math.min(r.left, maxLeft));
    var anchorCx = r.left + r.width / 2;
    var arrowLeft = Math.round(anchorCx - tipLeft - 7);
    arrowLeft = Math.max(12, Math.min(arrowLeft, tipW - 20));

    tip.style.setProperty('--sr-ob-arrow-left', arrowLeft + 'px');
    tip.style.left = tipLeft + 'px';
    tip.style.top  = goAbove
      ? (r.top  - pad - 12 - tipH) + 'px'
      : (r.bottom + pad + 12) + 'px';
  }

  function renderStep(idx) {
    var step   = STEPS[idx];
    var anchor = step.getAnchor();
    if (!anchor) return false;

    titleEl.textContent = step.title;
    bodyEl.textContent  = step.body;
    stepEl.textContent  = (idx + 1) + ' / ' + STEPS.length;
    nextBtn.textContent = idx === STEPS.length - 1 ? 'Done' : 'Next →';

    positionSpotlight(anchor);
    return true;
  }

  function next() {
    if (cur >= STEPS.length - 1) { dismiss(); return; }
    tip.classList.remove('sr-ob-tip--visible');
    if (_hole) _hole.classList.remove('ob-hl--on');
    setTimeout(function () {
      cur++;
      // Skip steps whose anchor isn't available
      while (cur < STEPS.length && !STEPS[cur].getAnchor()) cur++;
      if (cur >= STEPS.length) { dismiss(); return; }
      if (renderStep(cur)) {
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            if (_hole) _hole.classList.add('ob-hl--on');
            tip.classList.add('sr-ob-tip--visible');
          });
        });
      }
    }, 220);
  }

  function dismiss() {
    tip.classList.remove('sr-ob-tip--visible', 'sr-ob-tip--spotlight');
    document.removeEventListener('click', outsideClick, true);
    if (_hole) {
      _hole.classList.remove('ob-hl--on');
      var h = _hole; _hole = null;
      setTimeout(function () { if (h.parentNode) h.parentNode.removeChild(h); }, 350);
    }
    localStorage.setItem(OB_KEY, '1');
  }

  function outsideClick(e) {
    if (tip.contains(e.target)) return;
    dismiss();
  }

  nextBtn.addEventListener('click', function (e) { e.stopPropagation(); next(); });
  skipBtn.addEventListener('click', function (e) { e.stopPropagation(); dismiss(); });

  function startTour() {
    if (_started) return;
    _started = true;
    cur = 0;
    // Skip first step if anchor is missing
    while (cur < STEPS.length && !STEPS[cur].getAnchor()) cur++;
    if (cur >= STEPS.length) return;
    if (!renderStep(cur)) return;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (_hole) _hole.classList.add('ob-hl--on');
        tip.classList.add('sr-ob-tip--visible');
      });
    });
    setTimeout(function () {
      document.addEventListener('click', outsideClick, true);
    }, 350);
  }

  // Watch each assessment panel for content being lazily mounted
  ['tab-flashcards', 'tab-quiz', 'tab-more'].forEach(function (panelId) {
    var panel = document.getElementById(panelId);
    if (!panel) return;
    var obs = new MutationObserver(function (mutations) {
      var hasNodes = mutations.some(function (m) { return m.addedNodes.length > 0; });
      if (!hasNodes) return;
      obs.disconnect();
      // Give the tab JS time to initialize content and show the nav bar
      setTimeout(startTour, 900);
    });
    obs.observe(panel, { childList: true });
  });
})();

/* ── Shared spotlight helper for tab tours ── */
function _srMiniTour(cfg) {
  var tip     = document.getElementById(cfg.tipId);
  var titleEl = document.getElementById(cfg.titleId);
  var bodyEl  = document.getElementById(cfg.bodyId);
  var stepEl  = document.getElementById(cfg.stepId);
  var nextBtn = document.getElementById(cfg.nextId);
  var skipBtn = document.getElementById(cfg.skipId);
  if (!tip || !titleEl || !bodyEl || !nextBtn || !skipBtn) return;

  var cur = 0, _hole = null, _started = false;

  function vis(el) {
    if (!el) return false;
    if (el.offsetParent === null && window.getComputedStyle(el).position !== 'fixed') return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function position(anchor) {
    var r   = anchor.getBoundingClientRect();
    var br  = window.getComputedStyle(anchor).borderRadius || '8px';
    var pad = 8;

    if (tip.parentNode !== document.body) document.body.appendChild(tip);

    if (!_hole) {
      _hole = document.createElement('div');
      _hole.id = 'obSpotlightHole';
      document.body.appendChild(_hole);
    }
    _hole.style.top          = (r.top  - pad) + 'px';
    _hole.style.left         = (r.left - pad) + 'px';
    _hole.style.width        = (r.width  + pad * 2) + 'px';
    _hole.style.height       = (r.height + pad * 2) + 'px';
    _hole.style.borderRadius = br;

    var tipH    = tip.offsetHeight || 120;
    var tipW    = tip.offsetWidth  || 232;
    var below   = window.innerHeight - r.bottom - pad - 12;
    var above   = r.top - pad - 12;
    var goAbove = below < tipH && above >= tipH;

    tip.classList.toggle('sr-ob-tip--above',  goAbove);
    tip.classList.toggle('sr-ob-tip--below', !goAbove);
    tip.classList.add('sr-ob-tip--spotlight');

    var maxLeft  = window.innerWidth - tipW - 8;
    var tipLeft  = Math.max(8, Math.min(r.left, maxLeft));
    var anchorCx = r.left + r.width / 2;
    var arrowLeft = Math.max(12, Math.min(Math.round(anchorCx - tipLeft - 7), tipW - 20));

    tip.style.setProperty('--sr-ob-arrow-left', arrowLeft + 'px');
    tip.style.left = tipLeft + 'px';
    tip.style.top  = goAbove
      ? (r.top  - pad - 12 - tipH) + 'px'
      : (r.bottom + pad + 12) + 'px';
  }

  function renderStep(idx) {
    var step   = cfg.steps[idx];
    var anchor = step.getAnchor ? step.getAnchor() : document.querySelector(step.sel);
    if (!anchor || !vis(anchor)) return false;
    titleEl.textContent = step.title;
    bodyEl.textContent  = step.body;
    stepEl.textContent  = (idx + 1) + ' / ' + cfg.steps.length;
    nextBtn.textContent = idx === cfg.steps.length - 1 ? 'Done' : 'Next →';
    position(anchor);
    return true;
  }

  function next() {
    if (cur >= cfg.steps.length - 1) { dismiss(); return; }
    tip.classList.remove('sr-ob-tip--visible');
    if (_hole) _hole.classList.remove('ob-hl--on');
    setTimeout(function () {
      cur++;
      while (cur < cfg.steps.length && !renderStep(cur)) cur++;
      if (cur >= cfg.steps.length) { dismiss(); return; }
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (_hole) _hole.classList.add('ob-hl--on');
          tip.classList.add('sr-ob-tip--visible');
        });
      });
    }, 220);
  }

  function dismiss() {
    tip.classList.remove('sr-ob-tip--visible', 'sr-ob-tip--spotlight');
    document.removeEventListener('click', outside, true);
    if (_hole) {
      _hole.classList.remove('ob-hl--on');
      var h = _hole; _hole = null;
      setTimeout(function () { if (h.parentNode) h.parentNode.removeChild(h); }, 350);
    }
    localStorage.setItem(cfg.key, '1');
  }

  function outside(e) { if (!tip.contains(e.target)) dismiss(); }
  nextBtn.addEventListener('click', function (e) { e.stopPropagation(); next(); });
  skipBtn.addEventListener('click', function (e) { e.stopPropagation(); dismiss(); });

  function start() {
    if (_started) return;
    // Extra guard: defer start until the target tab's UI is actually ready
    if (cfg.readyCheck && !cfg.readyCheck()) { _started = false; return; }
    _started = true;
    cur = 0;
    while (cur < cfg.steps.length && !renderStep(cur)) cur++;
    if (cur >= cfg.steps.length) { _started = false; return; }
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (_hole) _hole.classList.add('ob-hl--on');
        tip.classList.add('sr-ob-tip--visible');
      });
    });
    setTimeout(function () { document.addEventListener('click', outside, true); }, 350);
  }

  var panel = document.getElementById(cfg.panelId);
  if (panel) {
    var obs = new MutationObserver(function (mutations) {
      if (!mutations.some(function (m) { return m.addedNodes.length > 0; })) return;
      obs.disconnect();
      setTimeout(start, cfg.delay || 900);
    });
    obs.observe(panel, { childList: true });
  }
}

(function () {
  /* ─ Video tour ─ */
  var VID_KEY = 'ob_tip_vid_' + window.USER_ID;
  if (localStorage.getItem(VID_KEY)) return;

  _srMiniTour({
    key: VID_KEY, panelId: 'tab-video', delay: 700,
    tipId: 'srVideoTip', titleId: 'srVideoTitle', bodyId: 'srVideoBody',
    stepId: 'srVideoStep', nextId: 'srVideoNext', skipId: 'srVideoSkip',
    steps: [
      {
        getAnchor: function () {
          // Mobile: the bottom nav bar. Desktop: the overlay buttons on the player.
          var mob = document.getElementById('vtMobileNav');
          if (mob && mob.getBoundingClientRect().width > 0) return mob;
          return document.querySelector('.vt-overlay-group') || document.querySelector('.vt-player-wrap');
        },
        title: 'Navigate videos',
        body: 'Use the arrows to move between recommended videos in the playlist. The counter shows your current position.',
      },
      {
        getAnchor: function () { return document.getElementById('vtTranscriptSection'); },
        title: 'Transcript',
        body: 'Read along while the video plays, or tap a timestamp to jump to that moment. Use the copy button to grab the full text.',
      },
    ],
  });

  /* ─ AI tutor (interactive chat) tour ─ */
  // The tab-voice tab hosts an interactive AI chat. New key so existing users
  // who already saw the old tour get this one exactly once.
  var TOUR_KEY = 'ob_tip_ai_tutor_v2_' + window.USER_ID;
  if (localStorage.getItem(TOUR_KEY)) return;

  _srMiniTour({
    key: TOUR_KEY, panelId: 'tab-voice', delay: 900,
    tipId: 'srAItutorTip', titleId: 'srAItutorTitle', bodyId: 'srAItutorBody',
    stepId: 'srAItutorStep', nextId: 'srAItutorNext', skipId: 'srAItutorSkip',
    // Only start when the AI chat interface is actually visible
    readyCheck: function () {
      var interface = document.getElementById('tvShell');
      return interface && interface.style.display !== 'none';
    },
    steps: [
      {
        getAnchor: function () { return document.getElementById('tvOrb'); },
        title: 'AI tutor chat',
        body: 'This tab is now an interactive AI chat. Tap the orb and speak a question — get a live audible answer from an AI tutor that has read your entire pack. It listens hands-free, so you can just talk.',
      },
      {
        getAnchor: function () { return document.getElementById('tvModeBadge'); },
        title: 'Switch modes by voice',
        body: 'Say a keyword aloud to switch how the tutor responds: "quiz me" starts a scored quiz in 15-question rounds, "explain" walks you through a concept step by step, and "back to chat" resumes normal conversation.',
      },
    ],
  });

})();
