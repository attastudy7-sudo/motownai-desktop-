(function () {
  'use strict';

  var MIN_PANE_WIDTH = 320;
  var STORAGE_KEY = 'motown_focus_split_ratio';
  var DEFAULT_RATIO = 0.6;

  var wrap = document.getElementById('roomWrap');
  var main = document.getElementById('paneMain');
  var splitPane = document.getElementById('splitNotesPane');
  var gutter = document.getElementById('paneResizeGutter');
  function getToggle() {
    return document.querySelector('.btn-split-toggle');
  }
  var viewports = main ? main.querySelector('.room-viewports') : null;

  var isSplit = false;
  var isDragging = false;
  var savedRatio = null;

  function loadSavedRatio() {
    try {
      var v = localStorage.getItem(STORAGE_KEY);
      if (v !== null) {
        var r = parseFloat(v);
        if (r >= 0.3 && r <= 0.85) return r;
      }
    } catch (_) {}
    return DEFAULT_RATIO;
  }

  function saveRatio(ratio) {
    try { localStorage.setItem(STORAGE_KEY, String(ratio)); } catch (_) {}
  }

  function applyRatio(ratio) {
    if (!wrap || !viewports) return;
    var pct = (ratio * 100).toFixed(1) + '%';
    wrap.style.setProperty('--split-ratio', pct);
    savedRatio = ratio;
  }

  function isDesktop() {
    return window.innerWidth >= 1280;
  }

  function isNotesActive() {
    var notesVp = document.getElementById('tab-notes');
    return notesVp && notesVp.classList.contains('room-vp--active');
  }

  function mountSplitNotes() {
    if (!splitPane) return;
    if (splitPane.getAttribute('data-lazy-mounted') === 'true') return;

    var tpl = document.getElementById('tpl-tab-notes');
    if (!tpl) return;

    splitPane.innerHTML = tpl.innerHTML;
    splitPane.setAttribute('data-lazy-mounted', 'true');

    if (typeof window._tiptapToolbar !== 'undefined' && window._tiptapToolbar.initToolbar) {
      window._tiptapToolbar.initToolbar(splitPane);
    }
    if (typeof window._tiptapToolbar !== 'undefined' && window._tiptapToolbar.createToolbar) {
      var toolbar = window._tiptapToolbar.createToolbar();
      var editorWrap = splitPane.querySelector('.notes-editor-wrap');
      if (editorWrap && toolbar) {
        editorWrap.insertBefore(toolbar, editorWrap.firstChild);
      }
    }

    var notesContent = splitPane.querySelector('.tiptap');
    if (notesContent) {
      try {
        var saved = localStorage.getItem('motown_notes_' + (window.PACK_ID || 'draft'));
        if (saved) notesContent.innerHTML = saved;
      } catch (_) {}
    }

    splitPane._splitInitDone = true;
  }

  function unmountSplitNotes() {
    if (!splitPane) return;
    splitPane.innerHTML = '';
    splitPane.removeAttribute('data-lazy-mounted');
    splitPane._splitInitDone = false;
  }

  function activateSplit() {
    if (!isDesktop()) return;
    if (isNotesActive()) {
      showTooltip('Notes already open');
      return;
    }
    if (isSplit) return;

    isSplit = true;
    wrap.classList.add('workspace-split-active');

    var ratio = loadSavedRatio();
    applyRatio(ratio);

    mountSplitNotes();

    var tb = getToggle();
    if (tb) tb.classList.add('active');
  }

  function deactivateSplit() {
    if (!isSplit) return;

    isSplit = false;
    wrap.classList.remove('workspace-split-active');

    unmountSplitNotes();

    var tb = getToggle();
    if (tb) tb.classList.remove('active');
  }

  function toggleSplit() {
    if (isSplit) {
      deactivateSplit();
    } else {
      activateSplit();
    }
  }

  function showTooltip(msg) {
    var tb = getToggle();
    if (!tb) return;
    var t = tb.querySelector('.split-tooltip');
    if (!t) {
      t = document.createElement('span');
      t.className = 'split-tooltip';
      t.style.cssText = 'position:absolute;top:calc(100% + 6px);right:0;background:#1a1a1a;color:#fff;padding:4px 10px;border-radius:6px;font-size:0.72rem;white-space:nowrap;pointer-events:none;z-index:999;border:1px solid rgba(255,255,255,0.1);';
      tb.appendChild(t);
    }
    t.textContent = msg;
    t.style.display = 'block';
    clearTimeout(t._hideTimer);
    t._hideTimer = setTimeout(function () { t.style.display = 'none'; }, 1800);
  }

  /* ── Drag-to-resize ── */
  function onGutterDown(e) {
    if (!isSplit || !isDesktop() || !wrap || !viewports || !splitPane) return;
    isDragging = true;
    document.body.classList.add('is-resizing');
    e.preventDefault();

    var startX = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
    var startRatio = savedRatio || loadSavedRatio();
    var wrapRect = wrap.getBoundingClientRect();
    var totalW = wrapRect.width;

    function onMove(ev) {
      if (!isDragging) return;
      var cx = ev.clientX || (ev.touches && ev.touches[0] ? ev.touches[0].clientX : 0);
      var dx = cx - startX;
      var newRatio = startRatio + (dx / totalW);

      newRatio = Math.max(MIN_PANE_WIDTH / totalW, Math.min(1 - MIN_PANE_WIDTH / totalW, newRatio));

      requestAnimationFrame(function () {
        applyRatio(newRatio);
      });
    }

    function onUp() {
      if (!isDragging) return;
      isDragging = false;
      document.body.classList.remove('is-resizing');
      saveRatio(savedRatio);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('touchend', onUp);
  }

  /* ── Event wiring (delegated listener on viewports to survive tab swaps) ── */
  if (viewports) {
    viewports.addEventListener('click', function (e) {
      var btn = e.target.closest('.btn-split-toggle, .btn-split-toggle--global');
      if (btn) toggleSplit();
    });
  }

  if (gutter) {
    gutter.addEventListener('mousedown', onGutterDown);
    gutter.addEventListener('touchstart', onGutterDown, { passive: true });
  }

  /* ── Recalc on resize ── */
  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (isSplit && !isDesktop()) {
        deactivateSplit();
      }
    }, 200);
  });

  /* ── Listen for tab switches: if user switches to Notes while split is active, close split ── */
  var origSwitch = window.switchRoomTab;
  if (typeof origSwitch === 'function') {
    window.switchRoomTab = function (btn, tabId) {
      origSwitch(btn, tabId);
      if (isSplit && tabId === 'tab-notes') {
        deactivateSplit();
      }
    };
  }

})();
