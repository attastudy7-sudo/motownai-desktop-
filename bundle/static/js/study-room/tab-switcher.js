// ══════════════════════════════════════════════════════════════════
//  SIDEBAR TAB SWITCHER
//  – Guards against double-click remounts (streaming-text safe)
//  – Hides/shows Section C (chat footer) when leaving/entering Chat
// ══════════════════════════════════════════════════════════════════
(function () {
  let _activePanel = 'chat';   // tracks current active panel ID

  function applyFooterVisibility(panel) {
    var footerBase = document.getElementById('chatFooterBase');
    if (footerBase) footerBase.style.display = (panel === 'chat') ? '' : 'none';
  }

  document.addEventListener('DOMContentLoaded', function () { applyFooterVisibility(_activePanel); });

  window.switchSidebarTab = function (btn, targetPanel) {
    // ── Lock: drop if already active ──────────────────────────────
    if (_activePanel === targetPanel) return;
    _activePanel = targetPanel;

    const paneAi  = document.getElementById('paneAi');

    // ── Deactivate all tab buttons & panels ───────────────────────
    paneAi.querySelectorAll('.ai-tab-btn').forEach(b => {
      b.classList.remove('active');
      b.setAttribute('aria-selected', 'false');
    });
    paneAi.querySelectorAll('.ai-vp').forEach(vp => {
      vp.classList.remove('ai-vp--active');
    });

    // ── Activate target ───────────────────────────────────────────
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');

    const targetVp = document.getElementById('vp-' + targetPanel);
    if (targetVp) targetVp.classList.add('ai-vp--active');

    // ── Section C: only visible on Chat panel ─────────────────────
    applyFooterVisibility(targetPanel);

    // ── Sync pane-ai data attribute (used by existing CSS/JS) ─────
    paneAi.dataset.activePanel = targetPanel;

    // ── Autofocus input when switching back to Chat ───────────────
    if (targetPanel === 'chat') {
      const inp = document.getElementById('chatInput');
      if (inp) requestAnimationFrame(() => inp.focus());
    }
  };

  // ── ROOM TAB SWITCHER (left icon rail) ──
  (function () {
    let _activeRoom = 'tab-upload';
    var _aiPaneCollapsed = false;
    var _notesScrollTop = 0;
    var _AI_COLLAPSE_TABS = ['tab-flashcards', 'tab-quiz', 'tab-more'];

    window.toggleAiPane = function(forceState) {
      var paneAi   = document.getElementById('paneAi');
      var paneMain = document.getElementById('paneMain');
      var roomWrap = document.getElementById('roomWrap');
      var mainContent = document.getElementById('main-content');
      var tab      = document.getElementById('aiToggleTab');
      var tabOpen  = document.getElementById('aiToggleIcon-open');
      var tabCollapsed = document.getElementById('aiToggleIcon-collapsed');
      var resizeHandle = document.getElementById('aiResizeHandle');

      if (!paneAi) return;

      if (forceState === true)  _aiPaneCollapsed = true;
      else if (forceState === false) _aiPaneCollapsed = false;
      else _aiPaneCollapsed = !_aiPaneCollapsed;

      if (_aiPaneCollapsed) {
        paneAi.classList.add('ai-collapsed');
        if (resizeHandle) resizeHandle.classList.add('is-hidden');
        if (paneMain) paneMain.classList.add('ai-pane-hidden');
        if (roomWrap) roomWrap.classList.add('ai-pane-hidden');
        if (mainContent) {
          mainContent.classList.remove('with-ai-panel', 'ai-panel-is-open');
          mainContent.style.marginRight = '0px';
          mainContent.style.width = '100%';
        }
        if (tab) tab.classList.add('ai-expand-tab');
        // Collapsed: show original (open) icon
        if (tabOpen) { tabOpen.style.display = ''; tabOpen.style.transform = ''; }
        if (tabCollapsed) { tabCollapsed.style.display = 'none'; tabCollapsed.style.transform = ''; }
        // Move focus out before hiding — aria-hidden on a focused element is illegal
        if (paneAi.contains(document.activeElement)) {
          document.activeElement.blur();
        }
        paneAi.setAttribute('aria-hidden', 'true');
        paneAi.setAttribute('inert', '');
      } else {
        paneAi.classList.remove('ai-collapsed');
        if (resizeHandle) resizeHandle.classList.remove('is-hidden');
        if (paneMain) paneMain.classList.remove('ai-pane-hidden');
        if (roomWrap) roomWrap.classList.remove('ai-pane-hidden');
        if (mainContent) {
          mainContent.classList.add('with-ai-panel', 'ai-panel-is-open');
          var sidebarWidth = Math.round(paneAi.getBoundingClientRect().width || 0);
          if (sidebarWidth > 0) {
            mainContent.style.marginRight = sidebarWidth + 'px';
            mainContent.style.width = 'calc(100% - ' + sidebarWidth + 'px)';
          }
        }
        if (tab) tab.classList.remove('ai-expand-tab');
        // Expanded: show flipped (collapsed) icon
        if (tabOpen) { tabOpen.style.display = 'none'; tabOpen.style.transform = ''; }
        if (tabCollapsed) { tabCollapsed.style.display = ''; }
        paneAi.removeAttribute('aria-hidden');
        paneAi.removeAttribute('inert');
      }
    };

    // Mobile: start with AI panel collapsed (hidden)
    if (window.innerWidth <= 768) {
      window.toggleAiPane(true);
    }

    window.switchRoomTab = function (btn, targetId) {
      if (_activeRoom === targetId) return;
      _activeRoom = targetId;

      var _outgoingNotesEditor = document.querySelector('#tab-notes .notes-prosemirror');
      if (_outgoingNotesEditor) _notesScrollTop = _outgoingNotesEditor.scrollTop;

      // Tab not persisted — always starts fresh on upload

      if (_AI_COLLAPSE_TABS.indexOf(targetId) !== -1) {
        window.toggleAiPane(true);
      } else if (_aiPaneCollapsed) {
        window.toggleAiPane(false);
      }

      // deactivate buttons + aria
      document.querySelectorAll('.room-tab-btn').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      if (btn) {
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
      }

      // hide all panes
      document.querySelectorAll('.room-vp').forEach(p => p.classList.remove('room-vp--active'));

      // show target pane
      const target = document.getElementById(targetId);
      if (target) target.classList.add('room-vp--active');

      if (targetId === 'tab-notes') {
        requestAnimationFrame(function () {
          var ed = document.querySelector('#tab-notes .notes-prosemirror');
          if (ed) ed.scrollTop = _notesScrollTop;
        });
      }

      // ── Narration FABs are Study-Guide-only ─────────────────────
      // Must not appear on any other tab after a switch (fixes leak where
      // position:fixed mini/fabs persisted across tabs).
      try {
        var _isGuided = targetId === 'tab-guided';
        var _rm = document.getElementById('readtoMini');
        var _af = document.getElementById('askAiFab');
        var _sf = document.getElementById('srAiFab');
        var _ov = document.getElementById('askOrbOverlay');
        if (!_isGuided) {
          if (_rm) _rm.hidden = true;
          if (_af) _af.hidden = true;
          if (_sf) _sf.hidden = true;
          var _fabMenu = document.getElementById('srAiFabMenu');
          if (_fabMenu) _fabMenu.classList.remove('is-open');
          // notify voice/readto to teardown overlay/audio but keep session
          document.dispatchEvent(new CustomEvent('sr:tab-switched-away', { detail: { targetId: targetId }}));
        } else {
          // returning to guide — restore mini if a session is still active
          if (_rm && typeof window.srNarrationActive === 'function' && window.srNarrationActive()) {
            _rm.hidden = false;
            // nudge ask-ai fab sync (it observes mini hidden)
            _rm.dispatchEvent(new Event('change'));
            document.dispatchEvent(new CustomEvent('sr:tab-return-guided'));
          } else if (_rm) {
            // no session — keep hidden
            _rm.hidden = true;
          }
        }
      } catch(e) {}
    };

    // keyboard navigation for tablist
    var _tabBar = document.getElementById('mobileRoomTabs');
    if (_tabBar) {
      _tabBar.addEventListener('keydown', function(e) {
        var tabs = Array.from(this.querySelectorAll('[role="tab"]'));
        var current = tabs.findIndex(function(t) { return t.getAttribute('aria-selected') === 'true'; });
        if (current === -1) current = 0;
        var idx;
        if (e.key === 'ArrowRight') {
          idx = (current + 1) % tabs.length;
        } else if (e.key === 'ArrowLeft') {
          idx = (current - 1 + tabs.length) % tabs.length;
        } else if (e.key === 'Home') {
          idx = 0;
        } else if (e.key === 'End') {
          idx = tabs.length - 1;
        } else {
          return;
        }
        e.preventDefault();
        var target = tabs[idx];
        window.switchRoomTab(target, target.getAttribute('data-target'));
      });
    }

  })();

  // Move pane-ai, toggle, and the mobile FAB to body on mobile so z-index beats the
  // drawer stacking context and so the FAB's position:fixed isn't trapped inside
  // pane-ai's collapsed translateY(100%) transform (or its inert subtree).
  (function() {
    if (window.innerWidth > 860) return;
    var paneAi = document.getElementById('paneAi');
    var toggleTab = document.getElementById('aiToggleTab');
    var fabAi = document.querySelector('.fab-ai');
    if (paneAi && paneAi.parentNode && paneAi.parentNode !== document.body) {
      document.body.appendChild(paneAi);
    }
    if (toggleTab && toggleTab.parentNode && toggleTab.parentNode !== document.body) {
      document.body.appendChild(toggleTab);
    }
    if (fabAi && fabAi.parentNode && fabAi.parentNode !== document.body) {
      document.body.appendChild(fabAi);
    }

    // Click outside collapses the pane
    document.addEventListener('click', function(e) {
      if (!paneAi) return;
      if (paneAi.classList.contains('ai-collapsed')) return;
      if (paneAi.contains(e.target)) return;
      if (toggleTab && toggleTab.contains(e.target)) return;
      window.toggleAiPane(true);
    });
  })();

  document.addEventListener('DOMContentLoaded', function () {
    var target = 'tab-upload';
    var btn = document.querySelector('.room-tab-btn[data-target="' + target + '"]');
    var pane = document.getElementById(target);
    if (btn && pane) {
      document.querySelectorAll('.room-tab-btn').forEach(function(b) {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      document.querySelectorAll('.room-vp').forEach(function(p) { p.classList.remove('room-vp--active'); });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      pane.classList.add('room-vp--active');
      _activeRoom = target;
    }
  });

  })();
