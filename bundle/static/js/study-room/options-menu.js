// Study Room Options Menu — keyboard-accessible dropdown
/* ── Study Room Options Menu — wired at page load, not inside a lazy tab ── */
(function() {
  function initSrDropdown(btn, menu) {
    if (!btn || !menu) return null;

    function getItems() {
      return Array.from(menu.querySelectorAll('.sr-topbar-menu__item:not([disabled])'));
    }

    function setOpen(isOpen) {
      menu.classList.toggle('open', isOpen);
      btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      if (isOpen) {
        setTimeout(function() { var f = getItems()[0]; if (f) f.focus(); }, 0);
      }
    }

    function isOpen() {
      return menu.classList.contains('open');
    }

    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      setOpen(!isOpen());
    });

    btn.addEventListener('keydown', function(e) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true); }
    });

    menu.addEventListener('click', function(e) { e.stopPropagation(); });

    document.addEventListener('click', function(e) {
      if (!isOpen()) return;
      if (!menu.contains(e.target) && !btn.contains(e.target)) setOpen(false);
    });

    document.addEventListener('keydown', function(e) {
      if (!isOpen()) return;
      var items = getItems();
      var cur   = items.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false); btn.focus(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); items[(cur + 1) % items.length] && items[(cur + 1) % items.length].focus(); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); var p = (cur - 1 + items.length) % items.length; items[p] && items[p].focus(); return; }
      if (e.key === 'Home') { e.preventDefault(); items[0] && items[0].focus(); return; }
      if (e.key === 'End')  { e.preventDefault(); var last = items[items.length - 1]; if (last) last.focus(); return; }
      if (e.key === 'Tab') { setOpen(false); return; }
      if ((e.key === 'Enter' || e.key === ' ') && menu.contains(document.activeElement)) {
        e.preventDefault(); document.activeElement.click(); setOpen(false); btn.focus();
      }
    });

    return { setOpen: setOpen, isOpen: isOpen };
  }

  /* Topbar options menu (desktop) */
  var sr = initSrDropdown(document.getElementById('srOptionsBtn'), document.getElementById('srOptionsMenu'));

  /* Expose so podcast regen button can close the menu without a circular dep */
  window._srCloseOptionsMenu = function() { if (sr) sr.setOpen(false); };

  /* Chat pane kebab menu (mobile top bar) */
  var mobile = initSrDropdown(document.getElementById('srMobileChatMenuBtn'), document.getElementById('srMobileChatMenu'));
  window._srCloseMobileChatMenu = function() { if (mobile) mobile.setOpen(false); };

  /* ── Podcast-tab-only items: show regen button only when podcast tab is active ── */
  var srRegenBtn    = document.getElementById('srPodcastRegenMenuBtn');
  var srRegenDivider = document.getElementById('srRefMenuDividerTop');

  function _isPodcastTabActive() {
    var pcBtn = document.querySelector('.room-tab-btn[data-target="tab-voice"]');
    return pcBtn && pcBtn.classList.contains('active');
  }

  function _syncPodcastMenuItems() {
    var show = _isPodcastTabActive();
    if (srRegenBtn)    srRegenBtn.style.display    = show ? '' : 'none';
    if (srRegenDivider) srRegenDivider.style.display = show ? '' : 'none';
  }

  /* Patch switchRoomTab so we update visibility on every tab change */
  var _origSwitch = window.switchRoomTab;
  window.switchRoomTab = function(btn, targetId) {
    if (_origSwitch) _origSwitch(btn, targetId);
    _syncPodcastMenuItems();
  };

  _syncPodcastMenuItems(); /* set correct state on load */

  /* ── Reference document menu items ── */
  function goToSlides(cb) {
    var uploadBtn = document.querySelector('.room-tab-btn[data-target="tab-upload"]');
    if (uploadBtn && !uploadBtn.classList.contains('active') && typeof window.switchRoomTab === 'function') {
      window.switchRoomTab(uploadBtn, 'tab-upload');
      setTimeout(cb, 200);
    } else { cb(); }
  }

  var srAddRef     = document.getElementById('srAddRefMenuBtn');
  var srViewRef    = document.getElementById('srViewRefMenuBtn');
  var srReplaceRef = document.getElementById('srReplaceRefMenuBtn');
  var srBackSlides = document.getElementById('srBackSlidesMenuBtn');

  if (srAddRef) srAddRef.addEventListener('click', function(e) {
    e.preventDefault(); e.stopPropagation(); if (sr) sr.setOpen(false);
    goToSlides(function() { var ri = document.getElementById('refFileInput'); if (ri) ri.click(); });
  });
  if (srViewRef) srViewRef.addEventListener('click', function(e) {
    e.preventDefault(); e.stopPropagation(); if (sr) sr.setOpen(false);
    goToSlides(function() { if (typeof window._refSwitchView === 'function') window._refSwitchView(); });
  });
  if (srReplaceRef) srReplaceRef.addEventListener('click', function(e) {
    e.preventDefault(); e.stopPropagation(); if (sr) sr.setOpen(false);
    goToSlides(function() { var ri = document.getElementById('refFileInput'); if (ri) ri.click(); });
  });
  if (srBackSlides) srBackSlides.addEventListener('click', function(e) {
    e.preventDefault(); e.stopPropagation(); if (sr) sr.setOpen(false);
    if (typeof window._refSwitchBack === 'function') window._refSwitchBack();
  });

  /* ── Jump to section — opens topic modal ── */
  var srJumpSection = document.getElementById('srJumpSectionMenuBtn');
  if (srJumpSection) srJumpSection.addEventListener('click', function(e) {
    e.preventDefault(); e.stopPropagation(); if (sr) sr.setOpen(false);
    if (typeof window._openTopicModal === 'function') window._openTopicModal();
  });
})();
