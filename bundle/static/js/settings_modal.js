(function(){
  function getModal(){ return document.getElementById('settingsModal'); }
  function getShell(){ const m = getModal(); return m ? m.querySelector(':scope > div') : null; }
  function getThemePicker(){ const modal = getModal(); return modal ? modal.querySelector('.stg-theme-picker') : null; }
  function getThemeTrigger(){ const modal = getModal(); return modal ? modal.querySelector('#settings-theme-button') : null; }
  function getThemeMenu(){ const modal = getModal(); return modal ? modal.querySelector('#settings-theme-menu') : null; }
  function getThemeChoiceButtons(){
    const modal = getModal();
    return modal ? modal.querySelectorAll('[data-theme-choice]') : [];
  }
  function getStoredThemeMode(){
    const isAuth = document.documentElement.getAttribute('data-is-authenticated') === 'true';
    return localStorage.getItem('motown-theme-mode') || (isAuth ? 'system' : 'dark');
  }
  function resolveTheme(mode){
    if (mode === 'system' || !['dark', 'light'].includes(mode)) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return mode;
  }
  function updateThemeControls(){
    const currentMode = getStoredThemeMode();
    const label = document.getElementById('settings-theme-current');
    if (label) {
      const pretty = currentMode === 'system' ? 'System' : currentMode.charAt(0).toUpperCase() + currentMode.slice(1);
      label.textContent = pretty;
    }
    getThemeChoiceButtons().forEach(function(btn){
      const active = btn.getAttribute('data-theme-choice') === currentMode;
      btn.classList.toggle('active-theme', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      btn.setAttribute('aria-checked', active ? 'true' : 'false');
    });
    window.syncThemeButtons?.();
  }
  function openThemeMenu(){
    const picker = getThemePicker();
    const menu = getThemeMenu();
    const trigger = getThemeTrigger();
    if (!picker || !menu || !trigger) return;
    picker.classList.add('is-open');
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
  }
  function closeThemeMenu(){
    const picker = getThemePicker();
    const menu = getThemeMenu();
    const trigger = getThemeTrigger();
    if (!picker || !menu || !trigger) return;
    picker.classList.remove('is-open');
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  }
  function toggleThemeMenu(){
    const menu = getThemeMenu();
    if (!menu) return;
    if (menu.hidden) openThemeMenu();
    else closeThemeMenu();
  }
  function applyThemeMode(mode){
    if (typeof window.setTheme === 'function') {
      window.setTheme(mode);
    } else {
      localStorage.setItem('motown-theme-mode', mode);
      const resolved = resolveTheme(mode);
      document.documentElement.setAttribute('data-theme', resolved);
      document.documentElement.setAttribute('data-user-preference', mode);
    }
    if (typeof window.updateDarkToggleUI === 'function') {
      window.updateDarkToggleUI(resolveTheme(mode));
    }
    updateThemeControls();
  }
  function getNavButtons(){
    const modal = getModal();
    return modal ? modal.querySelectorAll('.stg-nav-item[data-panel]') : [];
  }
  function getPanels(){ const modal = getModal(); return modal ? modal.querySelectorAll('.stg-panel[data-panel]') : []; }

  function setActivePanel(panelName){
    const modal = getModal(); if(!modal) return;
    const buttons = getNavButtons();
    const panels = getPanels();

    buttons.forEach(function(button){
      const active = button.getAttribute('data-panel') === panelName;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    panels.forEach(function(panel){
      const active = panel.getAttribute('data-panel') === panelName;
      panel.classList.toggle('active', active);
      panel.hidden = !active;
    });
  }

  window.openSettingsModal = function(tab = null){
    const modal = getModal(); if(!modal) return;
    // Desktop default: open straight on the Account tab when no specific tab
    // was requested. Mobile keeps its rows-list navigation untouched — never
    // auto-open a bottom sheet here.
    if (tab === null && window.innerWidth > 768) tab = 'account';
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    setActivePanel(tab);
    updateThemeControls();
    closeThemeMenu();
    refreshNarratorVoice();
    setTimeout(()=> modal.classList.add('open'), 10);
    // On mobile, open the bottom sheet directly only when a specific tab is requested.
    // Without a tab, the rows list is the correct mobile navigation — don't open a redundant sheet.
    if (window.innerWidth <= 768 && tab) {
      setTimeout(function(){ openSettingsSheet(tab); }, 50);
    }
  };

  window.closeSettingsModal = function(){
    const modal = getModal(); if(!modal) return;
    closeSettingsSheet();
    modal.classList.remove('open');
    // Allow animation frame, then hide
    setTimeout(()=>{
      modal.style.display = 'none';
      document.body.style.overflow = '';
    }, 180);
  };

  // ── Mobile bottom sheet ──────────────────────────────────────────
  var closeSheetTimer = null;

  var SHEET_LABELS = {
    account: 'Account',
    preferences: 'Preferences',
    education: 'Education',
    billing: 'Billing',
    'data-controls': 'Privacy',
    uploads: 'Uploads'
  };

  var SHEET_SUBTITLES = {
    account: 'Manage your account information and profile settings.',
    preferences: 'Customize your app experience and interface.',
    education: 'Update your institution and programme details.',
    billing: 'Check your current subscription and payment details.',
    'data-controls': 'Manage your privacy settings and data preferences.',
    uploads: 'Upload notes and documents from the modal or jump into the upload flow.'
  };

  window.openSettingsSheet = function(panelName) {
    if (closeSheetTimer) {
      clearTimeout(closeSheetTimer);
      closeSheetTimer = null;
    }

    var modal = getModal();
    if (!modal) return;

    var titleEl = document.getElementById('settingsMobileSheetTitle');
    var subtitleEl = document.getElementById('settingsMobileSheetSubtitle');
    var body = document.getElementById('settingsMobileSheetBody');
    if (!body) return;
    body.innerHTML = '';

    if (!panelName) {
      if (titleEl) titleEl.textContent = 'Settings';
      if (subtitleEl) subtitleEl.textContent = 'Choose a section';
      var list = document.createElement('div');
      list.className = 'settings-mobile-chooser';
      Object.keys(SHEET_LABELS).forEach(function(key) {
        var item = document.createElement('button');
        item.className = 'settings-mobile-chooser-item';
        item.textContent = SHEET_LABELS[key];
        item.addEventListener('click', function() {
          openSettingsSheet(key);
        });
        list.appendChild(item);
      });
      body.appendChild(list);
    } else {
      var panel = modal.querySelector('.stg-panel[data-panel="' + panelName + '"]');
      if (!panel) return;

      if (titleEl) titleEl.textContent = SHEET_LABELS[panelName] || panelName;
      if (subtitleEl) subtitleEl.textContent = SHEET_SUBTITLES[panelName] || '';

      var clone = panel.cloneNode(true);
      clone.classList.add('active');
      clone.removeAttribute('hidden');
      body.appendChild(clone);
    }

    var sheet = document.getElementById('settingsBottomSheet');
    if (sheet) sheet.classList.add('open');

    // Populate the fresh clone's narrator-voice dropdown from the server.
    if (panelName === 'preferences') refreshNarratorVoice();
  };

  window.closeSettingsSheet = function() {
    var sheet = document.getElementById('settingsBottomSheet');
    if (!sheet) return;
    sheet.classList.remove('open');
    if (closeSheetTimer) clearTimeout(closeSheetTimer);
    closeSheetTimer = setTimeout(function() {
      var body = document.getElementById('settingsMobileSheetBody');
      if (body) body.innerHTML = '';
      closeSheetTimer = null;
    }, 250);
  };

  document.addEventListener('DOMContentLoaded', function(){
    const modal = getModal(); if(!modal) return;
    const closeBtn = modal.querySelector('.stg-desktop-close-btn');
    if(closeBtn) closeBtn.addEventListener('click', window.closeSettingsModal);

    getNavButtons().forEach(function(button){
      button.addEventListener('click', function(){
        setActivePanel(button.getAttribute('data-panel'));
      });
    });

    // AJAX form submission — keeps modal open after save
    document.addEventListener('submit', function(e) {
        var form = e.target.closest('#settingsModal form.stg-account-form, #settingsModal form.stg-form');
        if (!form) return;
        // Don't intercept file upload forms — they need multipart and full navigation
        if (form.enctype === 'multipart/form-data') return;
        e.preventDefault();
        var btn = form.querySelector('[type="submit"]');
        var originalText = btn ? btn.textContent : '';
        if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
        fetch(form.action, {
            method: form.method || 'POST',
            headers: { 'X-Requested-With': 'XMLHttpRequest' },
            body: new FormData(form)
        }).then(function(r) { return r.json(); })
        .then(function(data) {
            if (btn) { btn.disabled = false; btn.textContent = data.ok || data.success ? 'Saved' : originalText; }
            setTimeout(function() { if (btn) btn.textContent = originalText; }, 2000);
        }).catch(function() {
            if (btn) { btn.disabled = false; btn.textContent = originalText; }
        });
    });

    // Delegated: works for both the original panel and clones inside the mobile sheet
    modal.addEventListener('click', function(e){
      var promoBtn = e.target.closest('#settingsPromoRedeem');
      if (promoBtn) {
        e.stopPropagation();
        if (typeof window.redeemPromoCode === 'function') window.redeemPromoCode(promoBtn);
        return;
      }
      var trigger = e.target.closest('#settings-theme-button');
      if (!trigger) return;
      e.stopPropagation();
      var picker = trigger.closest('.stg-theme-picker');
      if (!picker) return;
      var menu = picker.querySelector('#settings-theme-menu');
      if (!menu) return;
      if (menu.hidden) {
        picker.classList.add('is-open');
        menu.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
      } else {
        picker.classList.remove('is-open');
        menu.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
      }
    });

    document.addEventListener('click', function(e){
      const btn = e.target.closest('[data-theme-choice]');
      if (!btn) return;
      document.querySelectorAll('.stg-theme-picker').forEach(function(p){
        p.classList.remove('is-open');
        var m = p.querySelector('#settings-theme-menu');
        if (m) m.hidden = true;
        var t = p.querySelector('#settings-theme-button');
        if (t) t.setAttribute('aria-expanded', 'false');
      });
      applyThemeMode(btn.getAttribute('data-theme-choice'));
    });

    window.syncThemeButtons = function() {
      const stored = getStoredThemeMode();
      document.querySelectorAll('.dsn-theme-btn, .ms-theme__pill').forEach(function(btn) {
        const active = btn.getAttribute('data-theme-choice') === stored;
        btn.classList.toggle('active-theme', active);
      });
    };

    setActivePanel('preferences');
    updateThemeControls();

    // Click outside to close — but treat the mobile bottom sheet as "inside"
    // so taps on the sheet's close button, backdrop, or any control within
    // it don't bubble up and tear down the entire modal.
    modal.addEventListener('click', function(e){
      const shell = getShell();
      const sheet = document.getElementById('settingsBottomSheet');
      if (shell && shell.contains(e.target)) return;
      if (sheet && sheet.contains(e.target)) return;
      window.closeSettingsModal();
    });

    document.addEventListener('click', function(e){
      var pickers = document.querySelectorAll('.stg-theme-picker');
      var outsideAll = true;
      pickers.forEach(function(p){
        if (p.contains(e.target)) outsideAll = false;
      });
      if (!outsideAll) return;
      pickers.forEach(function(p){
        p.classList.remove('is-open');
        var m = p.querySelector('#settings-theme-menu');
        if (m) m.hidden = true;
        var t = p.querySelector('#settings-theme-button');
        if (t) t.setAttribute('aria-expanded', 'false');
      });
    });

    // Escape key
    document.addEventListener('keydown', function(e){
      if(e.key === 'Escape') {
        if (isNarratorMenuOpen()) { closeNarratorMenus(); return; }
        var sheet = document.getElementById('settingsBottomSheet');
        if (sheet && sheet.classList.contains('open')) {
          closeSettingsSheet();
        } else if (!getThemeMenu()?.hidden) {
          closeThemeMenu();
        } else {
          window.closeSettingsModal();
        }
      }
    });
  });

  (function () {
    var KEY = 'motown-auto-guide-gen';
    var cb = document.getElementById('settingsAutoGuideToggle');
    if (!cb) return;
    var stored = localStorage.getItem(KEY);
    cb.checked = stored === null ? true : stored === '1';
    cb.addEventListener('change', function () {
      localStorage.setItem(KEY, cb.checked ? '1' : '0');
    });
  })();

  (function () {
    var KEY = 'motown-animations';
    var cb = document.getElementById('settingsAnimationsToggle');
    if (!cb) return;
    var stored = localStorage.getItem(KEY);
    cb.checked = stored === '1';
    cb.addEventListener('change', function () {
      localStorage.setItem(KEY, cb.checked ? '1' : '0');
      document.documentElement.classList.toggle('force-animations', cb.checked);
    });
  })();

  // Shared quiz-timer preference — consumed by both the study-room quiz tab
  // (quiz-engine.js) and the guided-path section quiz (guided-path.js).
  // Defaults to ON so behavior matches the always-on guided-path timer.
  var QUIZ_TIMER_KEY = 'motown-quiz-timer';
  window.motownQuizTimerEnabled = function () {
    return localStorage.getItem(QUIZ_TIMER_KEY) !== '0';
  };
  (function () {
    var cb = document.getElementById('settingsQuizTimerToggle');
    if (!cb) return;
    cb.checked = window.motownQuizTimerEnabled();
    cb.addEventListener('change', function () {
      localStorage.setItem(QUIZ_TIMER_KEY, cb.checked ? '1' : '0');
      window.dispatchEvent(new CustomEvent('motown:quiz-timer', {
        detail: { enabled: cb.checked }
      }));
    });
  })();

  // ── Narrator voice (Read-to-Me) ──────────────────────────────────
  // The dropdown lives in the Preferences panel and mirrors the study-room
  // picker via a shared `sr:voice-changed` event. Works for both the
  // desktop panel and its clones inside the mobile bottom sheet.
  var NARRATOR_CORE_KEYS = ['kofi_warm', 'efua_gentle'];
  var narratorVoiceCache = null;

  function narratorVoiceDDs() {
    var modal = getModal();
    if (!modal) return [];
    return Array.prototype.slice.call(modal.querySelectorAll('#settingsNarratorVoice'));
  }

  function narratorVoiceByKey(key) {
    var found = null;
    (narratorVoiceCache || []).forEach(function (v) { if (v.key === key) found = v; });
    return found;
  }

  function setNarratorVoiceValue(key) {
    narratorVoiceDDs().forEach(function (dd) {
      var dot = dd.querySelector('[data-narrator-dot]');
      var value = dd.querySelector('[data-narrator-value]');
      var menu = dd.querySelector('[data-narrator-menu]');
      var voice = narratorVoiceByKey(key);
      if (value) value.textContent = (voice && voice.name) || key || 'Choose a narrator';
      if (dot) dot.style.background = (voice && voice.color) || '';
      if (menu) {
        Array.prototype.forEach.call(menu.querySelectorAll('.stg-dd__opt'), function (opt) {
          opt.setAttribute('aria-selected', opt.getAttribute('data-key') === key ? 'true' : 'false');
        });
      }
    });
  }

  function buildNarratorOption(v, selected) {
    var opt = document.createElement('button');
    opt.type = 'button';
    opt.className = 'stg-dd__opt' + (v.key === selected ? ' is-selected' : '');
    opt.setAttribute('role', 'option');
    opt.setAttribute('data-key', v.key);
    opt.setAttribute('aria-selected', v.key === selected ? 'true' : 'false');

    var dot = document.createElement('span');
    dot.className = 'stg-dd__optdot';
    dot.setAttribute('aria-hidden', 'true');
    dot.style.background = v.color || '';

    var meta = document.createElement('span');
    meta.className = 'stg-dd__optmeta';
    var name = document.createElement('span');
    name.className = 'stg-dd__optname';
    name.textContent = v.name;
    meta.appendChild(name);
    if (v.description) {
      var desc = document.createElement('span');
      desc.className = 'stg-dd__optdesc';
      desc.textContent = v.description;
      meta.appendChild(desc);
    }
    opt.appendChild(dot);
    opt.appendChild(meta);

    var check = document.createElement('span');
    check.className = 'stg-dd__optcheck';
    check.setAttribute('aria-hidden', 'true');
    check.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    opt.appendChild(check);

    return opt;
  }

  function refreshNarratorVoice() {
    if (document.documentElement.getAttribute('data-is-authenticated') !== 'true') return;
    var dds = narratorVoiceDDs();
    if (!dds.length) return;
    var csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
    fetch('/api/readto/voices', { headers: { 'X-CSRFToken': csrf }, credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
      .then(function (data) {
        narratorVoiceCache = data && data.voices ? data.voices : null;
        var selected = data && data.selected ? data.selected : (NARRATOR_CORE_KEYS[0] || '');
        var voices = narratorVoiceCache || [];
        dds.forEach(function (dd) {
          var menu = dd.querySelector('[data-narrator-menu]');
          if (!menu) return;
          while (menu.firstChild) menu.removeChild(menu.firstChild);
          voices.forEach(function (v) { menu.appendChild(buildNarratorOption(v, selected)); });
          setNarratorVoiceValue(selected);
        });
      })
      .catch(function () {
        setNarratorVoiceValue('kofi_warm');
      });
  }

  document.addEventListener('sr:voice-changed', function (e) {
    var key = e && e.detail && e.detail.voice_key;
    if (!key) return;
    setNarratorVoiceValue(key);
  });

  function openNarratorMenu(dd) {
    var menu = dd.querySelector('[data-narrator-menu]');
    if (!menu) return;
    closeNarratorMenus();
    menu.hidden = false;
    var trigger = dd.querySelector('[data-narrator-trigger]');
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
    var sel = menu.querySelector('.stg-dd__opt[aria-selected="true"]');
    var target = sel || menu.querySelector('.stg-dd__opt');
    if (target) target.focus();
  }

  function closeNarratorMenus() {
    narratorVoiceDDs().forEach(function (dd) {
      var menu = dd.querySelector('[data-narrator-menu]');
      var trigger = dd.querySelector('[data-narrator-trigger]');
      if (menu) menu.hidden = true;
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
    });
  }

  function isNarratorMenuOpen() {
    var any = false;
    narratorVoiceDDs().forEach(function (dd) {
      var menu = dd.querySelector('[data-narrator-menu]');
      if (menu && !menu.hidden) any = true;
    });
    return any;
  }

  function toggleNarratorMenu(dd) {
    var menu = dd.querySelector('[data-narrator-menu]');
    if (menu && !menu.hidden) closeNarratorMenus(); else openNarratorMenu(dd);
  }

  function moveNarratorFocus(dir) {
    var open = null;
    narratorVoiceDDs().forEach(function (dd) {
      var menu = dd.querySelector('[data-narrator-menu]');
      if (menu && !menu.hidden) open = menu;
    });
    if (!open) return;
    var opts = Array.prototype.slice.call(open.querySelectorAll('.stg-dd__opt'));
    if (!opts.length) return;
    var idx = opts.indexOf(document.activeElement);
    idx = (idx === -1 ? (dir > 0 ? -1 : 0) : idx) + dir;
    idx = (idx + opts.length) % opts.length;
    opts[idx].focus();
  }

  function pickNarratorVoice(key) {
    if (!key) return;
    setNarratorVoiceValue(key);
    closeNarratorMenus();
    var csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
    fetch('/api/readto/preference', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
      credentials: 'same-origin',
      body: JSON.stringify({ voice_key: key })
    }).catch(function () {});
    document.dispatchEvent(new CustomEvent('sr:voice-changed', {
      detail: { voice_key: key }
    }));
  }

  document.addEventListener('DOMContentLoaded', function () {
    var modal = getModal();
    if (!modal) return;

    // Delegated: the panel is cloned into the mobile bottom sheet, so bind on
    // the modal and resolve the closest narrator dropdown from the target.
    modal.addEventListener('click', function (e) {
      var trigger = e.target.closest ? e.target.closest('[data-narrator-trigger]') : null;
      if (trigger) {
        e.stopPropagation();
        var dd = trigger.closest('#settingsNarratorVoice');
        if (dd) toggleNarratorMenu(dd);
        return;
      }
      var opt = e.target.closest ? e.target.closest('[data-narrator-menu] .stg-dd__opt') : null;
      if (opt) {
        e.stopPropagation();
        pickNarratorVoice(opt.getAttribute('data-key'));
      }
    });
    modal.addEventListener('keydown', function (e) {
      var openCnt = isNarratorMenuOpen();
      var trigger = e.target.closest ? e.target.closest('[data-narrator-trigger]') : null;
      if (trigger && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        e.stopPropagation();
        var tdd = trigger.closest('#settingsNarratorVoice');
        if (tdd && !openCnt) openNarratorMenu(tdd);
        else if (openCnt) moveNarratorFocus(e.key === 'ArrowDown' ? 1 : -1);
        return;
      }
      if (trigger && e.key === 'Escape' && openCnt) {
        e.preventDefault();
        e.stopPropagation();
        closeNarratorMenus();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
        var inMenu = e.target.closest && e.target.closest('[data-narrator-menu] .stg-dd__opt');
        if (inMenu && openCnt) {
          e.preventDefault();
          if (e.key === 'Home') {
            var fm = inMenu.closest('[data-narrator-menu]');
            var fo = fm ? fm.querySelector('.stg-dd__opt') : null;
            if (fo) fo.focus();
          } else if (e.key === 'End') {
            var lm = inMenu.closest('[data-narrator-menu]');
            var lo = lm ? lm.querySelectorAll('.stg-dd__opt') : null;
            if (lo && lo.length) lo[lo.length - 1].focus();
          } else {
            moveNarratorFocus(e.key === 'ArrowDown' ? 1 : -1);
          }
        }
      }
    });
    document.addEventListener('click', function (e) {
      if (!isNarratorMenuOpen()) return;
      if (e.target.closest && e.target.closest('#settingsNarratorVoice')) return;
      closeNarratorMenus();
    });
  });
})();
