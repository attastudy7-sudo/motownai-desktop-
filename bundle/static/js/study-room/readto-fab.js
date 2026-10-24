/* readto-fab.js — AI FAB action menu + the Read-to-Me narrator player.
 *
 * The mobile AI FAB (#srAiFab) opens a small action menu with two options:
 *   · Chat with AI   → the existing AI pane (window.toggleAiPane)
 *   · Interactive AI → the Read-to-Me narrator (curated voices, generated
 *                      narration of the pack's notes).
 *
 * Flow: pick a narrator → hit Start → the narration begins and the modal
 * minimises into a compact "now playing" bar; tapping that bar reopens the
 * full player (stage text, prev/next transport).
 *
*  Asking questions during a narration goes through the AI chat pane (see
 *  ask-ai-fab.js): typed/voice questions land in the chat via window.sendChat.
 *  Typed replies are narrated back here via srNarrateText (one synthesized
 *  chunk); voice mode streams pre-synthesised chunks through srSpeakChunk that
 *  drain back-to-back. The audible reply is announced with sr:narration-start /
 *  sr:narration-end events so the Ask-AI orb can animate through its speaking
 *  state.
 *
 * Purely additive to the study room: it relies on window.PACK_ID already
 * being set by the page and the /api/readto/* blueprint (registered for
 * authenticated users) for data. Backstage-works with Edge fallback.
 */
(function () {
  'use strict';

  var PACK_ID = window.PACK_ID ? Number(window.PACK_ID) : null;

  var fab = document.getElementById('srAiFab');
  var menu = document.getElementById('srAiFabMenu');
  var readtoItem = document.getElementById('srAiFabReadto');
  var readtoHint = document.getElementById('srAiFabReadtoHint');

  var modal = document.getElementById('readtoModal');
  var mathToggle = document.getElementById('readtoMathToggle');
  var speedOpts = document.getElementById('readtoSpeedOpts');
  var mini = document.getElementById('readtoMini');
  var miniBody = document.getElementById('readtoMiniBody');
  var miniTitle = document.getElementById('readtoMiniTitle');
  var miniSub = document.getElementById('readtoMiniSub');
  var miniFill = document.getElementById('readtoMiniFill');
  var miniPlay = document.getElementById('readtoMiniPlay');
  var miniStop = document.getElementById('readtoMiniStop');
  var POLL_MS = 4000;

  /* ── Reader state ─────────────────────────────────────────────────── */
  var reader = {
    voices: [],
    selected: null,
    frames: [],
    total: 0,
    ready: 0,
    cur: 0,
    playing: false,
    answered: false,
    mathTranscribe: true,
    narrationSpeed: 1
  };

  var audio = new Audio();
  audio.preload = 'none';
  audio.playbackRate = 1;
  var audioUrl = null;
  var pollTimer = null;
  var urlPending = false;

  /* Follow-along bookkeeping: which frame we last mirrored onto the page and
     which guide section we've navigated to (so we never double-jump). */
  var followState = { idx: -1, el: null, navFor: null };
  var MATCH_THRESHOLD = 0.5;
  var MATCH_SLOP_OVERLAP = 3;

  var MATCH_SLOP_SCORE = 0.3;
  var MIN_CANDIDATE_TOKENS = 1;

  /* ── tiny helpers ─────────────────────────────────────────────────── */

  function getCSRF() {
    var m = document.querySelector('meta[name="csrf-token"]');
    return m ? m.content : '';
  }

  function postJSON(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': getCSRF(),
        'X-Requested-With': 'fetch'
      },
      body: JSON.stringify(body || {})
    });
  }

  function fmtResets(secs) {
    if (secs == null) return '';
    var m = Math.ceil(secs / 60);
    if (m >= 60) return 'Resets in ' + (m / 60).toFixed(m % 60 ? 1 : 0) + 'h.';
    return 'Resets in ' + m + 'm.';
  }

  function showError(msg) {
    var el = document.getElementById('readtoError');
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  function setBusy(busy) {
    var btn = document.getElementById('readtoGenerate');
    if (!btn) return;
    var spinner = btn.querySelector('.r2m-btn__spinner');
    var label = btn.querySelector('.r2m-btn__label');
    if (spinner) spinner.hidden = !busy;
    if (label) label.textContent = busy ? 'Generating narration…' : '';
    btn.disabled = busy;
    syncSetupButtons();
  }

  /* The setup view has a single primary action: "Start narration". On a fresh
     pack (or one whose narration expired) it begins generating; once a usable
     narration exists the same click plays it. Busy-state text lives in setBusy. */
  function syncSetupButtons() {
    var genBtn = document.getElementById('readtoGenerate');
    if (!genBtn) return;
    var busy = genBtn.disabled;
    var label = genBtn.querySelector('.r2m-btn__label');
    if (label && !busy) label.textContent = 'Start narration';
    genBtn.classList.remove('r2m-btn--ghost');
    genBtn.classList.add('r2m-btn--primary');
  }

  function playExisting() {
    if (!hasSession()) return;
    minimizeReader();
    playCurrent();
  }

  /* Single handoff point for the "Start narration" button. A narration with
     ready frames is just played; otherwise a fresh generation begins. */
  function onPrimaryAction() {
    var genBtn = document.getElementById('readtoGenerate');
    if (genBtn && genBtn.disabled) return;
    if (hasSession()) {
      playExisting();
    } else {
      generate();
    }
  }

  function curFrame() {
    return (reader.frames && reader.frames[reader.cur]) || null;
  }

  function frameReady(i) {
    return i >= 0 && i < reader.ready;
  }

  /* ── FAB menu ────────────────────────────────────────────────────── */

  function isMenuOpen() {
    return menu ? menu.classList.contains('is-open') : false;
  }

  function openMenu() {
    if (!menu) return;
    menu.classList.add('is-open');
    if (fab) fab.setAttribute('aria-expanded', 'true');
  }

  function closeMenu() {
    if (!menu) return;
    menu.classList.remove('is-open');
    if (fab) fab.setAttribute('aria-expanded', 'false');
  }

  function toggleMenu() {
    if (isMenuOpen()) closeMenu(); else openMenu();
  }

  function menuActionChat() {
    closeMenu();
    if (typeof window.toggleAiPane === 'function') {
      window.toggleAiPane();
    } else if (typeof window.toggleAiChat === 'function') {
      window.toggleAiChat();
    }
  }

  function menuActionReadto() {
    closeMenu();
    if (!PACK_ID) {
      if (!readtoItem) return;
      if (readtoHint) readtoHint.hidden = false;
      readtoItem.classList.add('is-disabled');
      setTimeout(function () {
        readtoItem.classList.remove('is-disabled');
        if (readtoHint) readtoHint.hidden = true;
      }, 2600);
      return;
    }
    openReader();
  }

  /* ── Reader: open / close ────────────────────────────────────────── */

  function openReader() {
    if (!modal) return;
    showError('');
    resetPlayback();
    modal.hidden = false;
    document.body.classList.add('sr-modal-open');
    loadVoices();
    restoreExisting();
    /* no explicit view switching — the modal is a single narration-settings view */
  }

  /* An active narration session keeps running (and playing) behind the
     mini bar; closing the modal only minimises it unless nothing is live. */
  function hasSession() {
    return !!(pollTimer || reader.ready > 0 || reader.playing || reader.total > 0);
  }

  function minimizeReader() {
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove('sr-modal-open');
    showMini();
  }

  function openPlayerFromMini() {
    if (!modal) return;
    hideMini();
    modal.hidden = false;
    document.body.classList.add('sr-modal-open');
    syncMini();
  }

  function closeReader() {
    if (!modal) return;
    stopPolling();
    resetPlayback();
    modal.hidden = true;
    document.body.classList.remove('sr-modal-open');
    hideMini();
  }

  /* The mini bar is position:fixed, so it centers on the viewport by default.
     Re-anchor it (and anything that floats above it) to the horizontal centre
     of #paneMain — the study-guide pane — so it sits over the content it is
     narrating, not the whole screen. Falls back to viewport centre. */
  function paneCenterX() {
    var pane = document.getElementById('paneMain');
    if (pane) {
      var r = pane.getBoundingClientRect();
      if (r && r.width > 0) return r.left + r.width / 2;
    }
    return window.innerWidth / 2;
  }

  function positionMini() {
    if (!mini) return;
    mini.style.left = paneCenterX() + 'px';
  }

  function showMini() {
    if (!mini || !hasSession()) return;
    // Study-Guide-only: don't surface on other tabs after a switch
    var _activeTab = document.querySelector('.room-vp--active');
    if (_activeTab && _activeTab.id !== 'tab-guided') return;
    syncMini();
    positionMini();
    mini.hidden = false;
    if (document.dispatchEvent) {
      document.dispatchEvent(new CustomEvent('sr:mini-changed', { detail: { visible: true, left: paneCenterX() } }));
    }
  }

  function hideMini() {
    if (!mini) return;
    mini.hidden = true;
    if (miniFill) miniFill.style.width = '0%';
    if (document.dispatchEvent) {
      document.dispatchEvent(new CustomEvent('sr:mini-changed', { detail: { visible: false } }));
    }
  }

  function syncMini() {
    if (!mini || mini.hidden) return;
    var f = curFrame();
    if (miniTitle) miniTitle.textContent = (f && f.title) ? f.title : 'Study Guide';
    if (miniFill) miniFill.style.width = Math.round(Math.min(1, Math.max(0, reader.total ? reader.ready / reader.total : 0)) * 100) + '%';
    var sub;
    if (reader.total && reader.ready >= reader.total && !reader.playing) {
      sub = 'Narration finished';
    } else if (reader.playing) {
      sub = 'Reading · ' + reader.ready + '/' + reader.total + ' parts ready';
    } else if (reader.waitingForFrame || (reader.total && reader.ready < reader.total)) {
      sub = 'Preparing part ' + (reader.cur + 1) + '…';
    } else {
      sub = 'Paused';
    }
    if (miniSub) miniSub.textContent = sub;
    updateMiniPlay();
  }

  function updateMiniPlay() {
    if (!miniPlay) return;
    var loading = !!reader.waitingForFrame;
    miniPlay.classList.toggle('is-loading', loading);
    miniPlay.classList.toggle('is-paused', !loading && !!reader.playing);
    miniPlay.setAttribute('aria-label', loading ? 'Loading narration…' : (reader.playing ? 'Pause narration' : 'Play narration'));
  }

  function resetPlayback() {
    stopAudio();
    reader.frames = [];
    reader.total = 0;
    reader.ready = 0;
    reader.cur = 0;
    reader.playing = false;
    reader.waitingForFrame = false;
    pendingSectionSeek = null;
    hideMini();
    clearFollow();
  }

  function stopAudio() {
    audio.pause();
    audio.removeAttribute('src');
    if (audioUrl) { try { URL.revokeObjectURL(audioUrl); } catch (e) {} audioUrl = null; }
    reader.waitingForFrame = false;
    setPlayBtnVisual(false);
    reader.playing = false;
  }

  /* ── Voice picker (custom dropdown) ──────────────────────────────── */

  function loadVoices() {
    var trigger = document.getElementById('readtoVoiceTrigger');
    if (!trigger) return;
    setVoiceTrigger(null, 'Loading voices…');
    fetch('/api/readto/voices', { headers: { 'X-CSRFToken': getCSRF() } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.ok) { setVoiceTrigger(null, 'Could not load voices.'); return; }
        reader.voices = data.voices || [];
        var selected = data.selected || data.default || (data.voices && data.voices[0] && data.voices[0].key) || null;
        if (!(reader.frames && reader.frames.length)) reader.selected = selected;
        if (typeof data.math_transcribe === 'boolean') {
          reader.mathTranscribe = data.math_transcribe;
          reflectMathToggle();
        }
        if (typeof data.narration_speed === 'number') {
          reader.narrationSpeed = data.narration_speed;
          reflectSpeed();
        }
        renderVoices();
      })
      .catch(function () {
        setVoiceTrigger(null, 'Could not load voices.');
      });
  }

  function renderVoices() {
    var menu = document.getElementById('readtoVoiceMenu');
    if (!menu) return;
    var options = reader.voices || [];
    while (menu.firstChild) menu.removeChild(menu.firstChild);
    if (!options.length) { setVoiceTrigger(null, 'No voices available.'); return; }
    options.forEach(function (v) {
      var opt = document.createElement('button');
      opt.type = 'button';
      opt.className = 'r2m-dd__opt';
      opt.setAttribute('role', 'option');
      opt.setAttribute('data-key', v.key);
      opt.setAttribute('aria-selected', v.key === reader.selected ? 'true' : 'false');

      var dot = document.createElement('span');
      dot.className = 'r2m-dd__optdot';
      dot.setAttribute('aria-hidden', 'true');
      dot.style.background = v.color || '';

      var meta = document.createElement('span');
      meta.className = 'r2m-dd__optmeta';
      var name = document.createElement('span');
      name.className = 'r2m-dd__optname';
      name.textContent = v.name;
      meta.appendChild(name);
      if (v.description) {
        var desc = document.createElement('span');
        desc.className = 'r2m-dd__optdesc';
        desc.textContent = v.description;
        meta.appendChild(desc);
      }

      var check = document.createElement('span');
      check.className = 'r2m-dd__optcheck';
      check.setAttribute('aria-hidden', 'true');
      check.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
      opt.appendChild(dot);
      opt.appendChild(meta);
      opt.appendChild(check);
      opt.addEventListener('click', function () { pickVoice(v.key); });
      menu.appendChild(opt);
    });
    syncVoiceTrigger();
  }

  function voiceByKey(key) {
    var found = null;
    (reader.voices || []).forEach(function (v) { if (v.key === key) found = v; });
    return found;
  }

  function setVoiceTrigger(voice, fallback) {
    var valueEl = document.getElementById('readtoVoiceValue');
    var dotEl = document.getElementById('readtoVoiceDot');
    if (valueEl) valueEl.textContent = (voice && voice.name) || fallback || 'Choose a narrator';
    if (dotEl) dotEl.style.background = (voice && voice.color) || 'var(--primary, #7c6cfa)';
  }

  function syncVoiceTrigger() {
    setVoiceTrigger(voiceByKey(reader.selected));
  }

  function openVoiceMenu() {
    var menu = document.getElementById('readtoVoiceMenu');
    var trigger = document.getElementById('readtoVoiceTrigger');
    if (!menu) return;
    menu.hidden = false;
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
    var sel = menu.querySelector('.r2m-dd__opt[aria-selected="true"]');
    var target = sel || menu.querySelector('.r2m-dd__opt');
    if (target) target.focus();
  }

  function closeVoiceMenu() {
    var menu = document.getElementById('readtoVoiceMenu');
    var trigger = document.getElementById('readtoVoiceTrigger');
    if (!menu) return;
    menu.hidden = true;
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  }

  function isVoiceMenuOpen() {
    var menu = document.getElementById('readtoVoiceMenu');
    return !!menu && !menu.hidden;
  }

  function toggleVoiceMenu() {
    if (isVoiceMenuOpen()) closeVoiceMenu(); else openVoiceMenu();
  }

  function moveVoiceFocus(dir) {
    var menu = document.getElementById('readtoVoiceMenu');
    if (!menu) return;
    var opts = Array.prototype.filter.call(menu.querySelectorAll('.r2m-dd__opt'), function (o) { return !o.disabled; });
    if (!opts.length) return;
    var idx = -1;
    for (var i = 0; i < opts.length; i++) { if (opts[i] === document.activeElement) { idx = i; break; } }
    idx = (idx === -1 ? (dir > 0 ? -1 : 0) : idx) + dir;
    idx = (idx + opts.length) % opts.length;
    opts[idx].focus();
  }

  function initVoiceDropdown() {
    var trigger = document.getElementById('readtoVoiceTrigger');
    var menu = document.getElementById('readtoVoiceMenu');
    var dd = document.getElementById('readtoVoiceDropdown');
    if (!trigger || !menu) return;

    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleVoiceMenu();
    });
    trigger.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        if (!isVoiceMenuOpen()) openVoiceMenu();
        else moveVoiceFocus(e.key === 'ArrowDown' ? 1 : -1);
      } else if (e.key === 'Escape' && isVoiceMenuOpen()) {
        e.stopPropagation();
        closeVoiceMenu();
      }
    });
    menu.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveVoiceFocus(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveVoiceFocus(-1); }
      else if (e.key === 'Home') {
        e.preventDefault();
        var f = menu.querySelector('.r2m-dd__opt');
        if (f) f.focus();
      } else if (e.key === 'End') {
        e.preventDefault();
        var all = menu.querySelectorAll('.r2m-dd__opt');
        if (all.length) all[all.length - 1].focus();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeVoiceMenu();
        trigger.focus();
      }
    });
    if (dd) {
      document.addEventListener('click', function (e) {
        if (isVoiceMenuOpen() && !dd.contains(e.target)) closeVoiceMenu();
      });
    }
  }

  function pickVoice(key) {
    if (!key) return;
    reader.selected = key;
    var menu = document.getElementById('readtoVoiceMenu');
    if (menu) {
      Array.prototype.forEach.call(menu.querySelectorAll('.r2m-dd__opt'), function (o) {
        o.setAttribute('aria-selected', o.getAttribute('data-key') === key ? 'true' : 'false');
      });
    }
    syncVoiceTrigger();
    closeVoiceMenu();
    postJSON('/api/readto/preference', { voice_key: key }).catch(function () {});
    document.dispatchEvent(new CustomEvent('sr:voice-changed', {
      detail: { voice_key: key, source: 'readto' }
    }));
  }

  /* Keep in lock-step with the Settings → Narrator voice dropdown: a choice
     made there lands back on the picker the next time the modal is opened. */
  document.addEventListener('sr:voice-changed', function (e) {
    var key = e && e.detail && e.detail.voice_key;
    if (!key || key === reader.selected) return;
    var known = reader.voices.some(function (v) { return v.key === key; });
    if (!known) return;
    reader.selected = key;
    renderVoices();
  });

  /* Narration-settings toggle: AI math transcription ("4(5)" → "4 times 5"). */
  function reflectMathToggle() {
    if (!mathToggle) return;
    mathToggle.setAttribute('aria-checked', reader.mathTranscribe ? 'true' : 'false');
  }

  function toggleMathTranscribe() {
    reader.mathTranscribe = !reader.mathTranscribe;
    reflectMathToggle();
    postJSON('/api/readto/preference', {
      math_transcribe: reader.mathTranscribe
    }).catch(function () {});
  }

  /* Narration-settings segmented control: playback speed (0.75×–2×). Mirrors
     the readto library state; applied to playbackRate of the narrator audio
     and of live-chat reply audio so guide frames and AI replies match. */
  function reflectSpeed() {
    if (!speedOpts) return;
    speedOpts.querySelectorAll('.r2m-speed__opt').forEach(function (btn) {
      var val = parseFloat(btn.getAttribute('data-speed'));
      var on = (Math.abs(val - reader.narrationSpeed) < 0.001);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  function applyNarrationSpeed() {
    var rate = reader.narrationSpeed || 1;
    try { audio.playbackRate = rate; } catch (e) {}
    try { replyAudio.playbackRate = rate; } catch (e) {}
  }

  function pickSpeed(value) {
    var rate = (typeof value === 'string') ? parseFloat(value) : value;
    if (!(rate > 0)) return;
    reader.narrationSpeed = rate;
    reflectSpeed();
    applyNarrationSpeed();
    postJSON('/api/readto/preference', { narration_speed: rate }).catch(function () {});
  }

  /* ── Existing narration check (resume support) ───────────────────── */

  function countReadyFromPayload(payload) {
    var audio = payload.audio || [];
    var urls = payload.audio_urls || [];
    var frames = payload.frames || [];
    var n = 0;
    for (var i = 0; i < frames.length; i++) {
      if ((audio[i] && audio[i] !== null) || (urls[i] && urls[i] !== null)) n++;
    }
    return n;
  }

  /* Re-open a persisted narration after a page reload: load the frames back
     into the player instead of forcing the user to regenerate. Runs on
     'live' (playable now) and 'generating' (resume-with-pending — what's
     ready is playable, polling will surface the rest). */
  function resumeExisting(data) {
    reader.total = data.total_frames || (data.frames || []).length;
    reader.frames = data.frames || [];
    reader.cur = 0;
    reader.ready = countReadyFromPayload(data);
    reader.answered = false;
    if (data.voice_key) reader.selected = data.voice_key;
    ensureGuideTab();
    stageFrame();
    armAudio();
    startPolling();
  }

  function restoreExisting() {
    if (!PACK_ID) return;
    fetch('/api/readto/' + PACK_ID, { headers: { 'X-CSRFToken': getCSRF() } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.ok) return;
        if (data.status === 'live' || data.status === 'generating') {
          resumeExisting(data);
        } else if (data.status === 'expired') {
          var sub = document.getElementById('readtoModalPack');
          if (sub) sub.textContent = 'Your previous narration has expired — generating now starts a fresh one.';
        }
        syncSetupButtons();
      })
      .catch(function () {});
  }

  /* ── Generate + poll ─────────────────────────────────────────────── */

  function generate() {
    showError('');
    setBusy(true);
    postJSON('/api/readto/generate', {
      pack_id: PACK_ID,
      voice_key: reader.selected,
      math_transcribe: reader.mathTranscribe
    })
      .then(function (r) {
        return r.json().then(function (data) { return { status: r.status, data: data }; });
      })
      .then(function (res) {
        var data = res.data;
        if (res.status === 403 && data && data.quota_exceeded) {
          showError((data.error || 'Daily limit reached.') + ' ' + fmtResets(data.resets_in_seconds));
          setBusy(false);
          return;
        }
        if (res.status === 400 && data && data.error) {
          if (data.busy && data.status === 'generating') {
            // Another generation is already running for this pack — resume it instead of showing an error
            showError('');
            setBusy(false);
            // Pull the existing payload and resume where it left off
            fetch('/api/readto/' + PACK_ID, { headers: { 'X-CSRFToken': getCSRF() } })
              .then(function (r) { return r.json(); })
              .then(function (d) {
                if (d && d.ok && (d.status === 'live' || d.status === 'generating')) {
                  resumeExisting(d);
                  setTimeout(function () { minimizeReader(); playCurrent(); }, 400);
                } else {
                  showError(data.error);
                }
              }).catch(function () { showError(data.error); });
            return;
          }
          showError(data.error);
          setBusy(false);
          return;
        }
        if (!data || !data.ok) {
          showError((data && data.error) || 'Could not start the narration.');
          setBusy(false);
          return;
        }
        setBusy(false);
        reader.total = data.total_frames || 0;
        reader.frames = data.frames || [];
        reader.cur = 0;
        reader.ready = syncReadyCount(reader.frames);
        reader.answered = false;
        ensureGuideTab();
        armAudio();
        startPolling();
        minimizeReader();
        playCurrent();
      })
      .catch(function () {
        showError('Network error — please try again.');
        setBusy(false);
      });
  }

  function syncReadyCount(frames) {
    var n = 0;
    (frames || []).forEach(function (f) {
      if (f.audio || f.audio_url || f.audioUrl) n++;
    });
    /* The generate payload doesn't carry per-frame readiness; lead frames are
       the FIRST sync_count frames, so fall back to "first ready are ready". */
    return Math.max(n, Math.min((frames || []).length, 1));
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(pollStatus, POLL_MS);
    pollStatus();
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function pollStatus() {
    if (!PACK_ID) return;
    fetch('/api/readto/' + PACK_ID + '/frames', { headers: { 'X-CSRFToken': getCSRF() } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.ok) return;
        reader.frames = data.frames || reader.frames;
        reader.total = data.total_frames || reader.frames.length;
        reader.ready = Math.max(reader.ready, data.ready_frames || 0);
        // A section the user jumped to may have been generating its narration;
        // once its frames finally appear, restart playback at the section top.
        if (pendingSectionSeek) {
          var sid = pendingSectionSeek;
          if (firstFrameForSection(sid) >= 0) {
            pendingSectionSeek = null;
            skipNarrationToSection(sid);
          }
        }
        syncMini();
        if (reader.total && reader.ready >= reader.total) stopPolling();
        if (reader.waitingForFrame && frameReady(reader.cur)) {
          reader.waitingForFrame = false;
          playCurrent();
        }
      })
      .catch(function () {});
  }

  /* ── Playback ────────────────────────────────────────────────────── */

  /* The modal no longer hosts a play transport (the mini bar owns it);
     this keeps the visual for legacy callers harmless when the button is
     gone, and the mini/"now playing" bar is still toggled via syncMini. */
  function setPlayBtnVisual(playing) {
    var playBtn = document.getElementById('readtoPlay');
    if (!playBtn) return;
    var playSvg = playBtn.querySelector('.r2m-ctl__play');
    var pauseSvg = playBtn.querySelector('.r2m-ctl__pause');
    if (playing) {
      playBtn.classList.add('r2m-ctl--paused');
      playBtn.setAttribute('aria-label', 'Pause');
      if (playSvg) playSvg.hidden = true;
      if (pauseSvg) pauseSvg.hidden = false;
    } else {
      playBtn.classList.remove('r2m-ctl--paused');
      playBtn.setAttribute('aria-label', 'Play');
      if (playSvg) playSvg.hidden = false;
      if (pauseSvg) pauseSvg.hidden = true;
    }
  }

  function setPlayPauseVisual(playing) {
    setPlayBtnVisual(playing);
    syncMini();
    try{ if(window.__askUpdatePersistent) window.__askUpdatePersistent(); }catch(e){}
  }

  // Barge-in from persistent voice listener — pause but keep session alive
  document.addEventListener('sr:barge-pause', function () {
    if (reader.playing) {
      try { audio.pause(); } catch(e) {}
      reader.playing = false;
      setPlayPauseVisual(false);
      syncMini();
    }
  });

  function armAudio() {
    audio.onended = function () {
      reader.playing = false;
      setPlayPauseVisual(false);
      if (!reader.answered && frameReady(reader.cur + 1)) {
        reader.cur += 1;
        stageFrame();
        playCurrent();
      } else if (!reader.answered) {
        reader.waitingForFrame = reader.cur + 1 < reader.total;
        updateMiniPlay();
      }
    };
    audio.onplaying = function () {
      reader.playing = true;
      setPlayPauseVisual(true);
    };
    audio.onpause = function () {
      reader.playing = false;
      if (audio.currentTime > 0 && audio.currentTime < (audio.duration || Infinity)) {
        setPlayPauseVisual(false);
      }
    };
    audio.onerror = function () {
      if (urlPending) { /* frame may not be ready yet; poll continues */ }
    };
  }

  function fetchFrameAudio(idx) {
    return fetch('/api/readto/audio/' + PACK_ID + '/' + idx, { headers: { 'X-CSRFToken': getCSRF() } })
      .then(function (r) {
        if (r.status === 404 || r.status >= 500) throw new Error('not-ready');
        return r.blob();
      });
  }

  function playCurrent() {
    if (!PACK_ID || frameReady(reader.cur) === false) {
      reader.waitingForFrame = true;
      updateMiniPlay();
      return;
    }
    if (urlPending) return;
    urlPending = true;
    fetchFrameAudio(reader.cur)
      .then(function (blob) {
        urlPending = false;
        reader.waitingForFrame = false;
        if (audioUrl) { try { URL.revokeObjectURL(audioUrl); } catch (e) {} }
        audioUrl = URL.createObjectURL(blob);
        audio.src = audioUrl;
        applyNarrationSpeed();
        audio.play().then(function () {
          reader.playing = true;
          setPlayPauseVisual(true);
        }).catch(function () {
          /* autoplay blocked — leave paused, poll will retry when playing */
        });
      })
      .catch(function () {
        urlPending = false;
        /* not ready yet; pollStatus will call playCurrent again */
      });
  }

  /* ── Read-to-Me follow-along ───────────────────────────────────────
     Mirrors the current narration frame onto the guide: this frame's text
     (already spoken-form, math converted server-side) is fuzzily matched
     against the visible .guided-study-text blocks, the winner gets a soft
     reading-band highlight, and the page scrolls it into view. When the
     frame belongs to a different section than the one rendered, the guide
     is navigated across first (guidedNavigateBySectionId). Degrades to a
     no-op when the frame can't be matched (e.g. fallback notes content). */

  function guideTabVisible() {
    var pane = document.getElementById('tab-guided');
    if (!pane) return false;
    if (pane.classList.contains('room-vp--active')) return true;
    var style = getComputedStyle(pane);
    return style.display !== 'none' && pane.offsetParent !== null;
  }

  function ensureGuideTab() {
    var pane = document.getElementById('tab-guided');
    if (!pane || pane.classList.contains('room-vp--active')) return;
    var btn = document.querySelector('.room-tab-btn[data-target="tab-guided"]');
    if (!btn) return;
    if (typeof window.switchRoomTab === 'function') {
      window.switchRoomTab(btn, 'tab-guided');
    } else {
      btn.click();
    }
  }

  function cleanMarkdown(t) {
    return String(t == null ? '' : t)
      .split(/\n+/)
      .map(function (line) {
        line = line.replace(/^\s*(\*{1,3}|-)\s?/, '');
        line = line.replace(/\*\*/g, '');
        line = line.replace(/`{1,3}/g, '');
        return line;
      })
      .filter(function (line) { return line.trim() !== ''; })
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  var STOPWORDS = {
    'a': 1, 'an': 1, 'the': 1, 'and': 1, 'or': 1, 'but': 1, 'if': 1,
    'of': 1, 'in': 1, 'for': 1, 'to': 1, 'from': 1, 'with': 1, 'at': 1,
    'by': 1, 'on': 1, 'is': 1, 'are': 1, 'was': 1, 'were': 1, 'be': 1,
    'been': 1, 'being': 1, 'it': 1, 'its': 1, 'this': 1, 'that': 1,
    'these': 1, 'those': 1, 'we': 1, 'you': 1, 'he': 1, 'she': 1,
    'they': 1, 'them': 1, 'as': 1, 'than': 1, 'so': 1, 'then': 1, 'not': 1
  };

  function normalizeText(t) {
    return cleanMarkdown(t).toLowerCase().split(/[^a-z0-9]+/).filter(function (s) {
      return s && !STOPWORDS[s];
    });
  }

  /* Ordered walk of a block's text, swapping each mjx-container for its
     aria-label (MathJax's own readable form) — mirrors room-tab-lazy.js. */
  function collectReadable(node, parts) {
    var i;
    if (node.nodeType === 3) { parts.push(node.data); return; }
    if (node.nodeType !== 1) return;
    var tag = node.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'svg') return;
    if (tag === 'mjx-container') {
      parts.push(node.getAttribute('aria-label') || node.title || node.textContent || '');
      return;
    }
    var kids = node.childNodes;
    for (i = 0; i < kids.length; i++) collectReadable(kids[i], parts);
  }

  function readableText(el) {
    var parts = [];
    collectReadable(el, parts);
    return normalizeText(parts.join(' '));
  }

  function overlapScore(a, b) {
    var sa = {}, sb = {}, i, n = 0, union = 0;
    a.forEach(function (t) { sa[t] = true; });
    b.forEach(function (t) { sb[t] = true; });
    for (i in sa) { if (Object.prototype.hasOwnProperty.call(sa, i)) union++; }
    for (i in sb) {
      if (Object.prototype.hasOwnProperty.call(sb, i)) {
        if (sa[i]) n++; else union++;
      }
    }
    return { score: union === 0 ? 0 : n / union, overlap: n };
  }

  function blockLike(root) {
    var els = root.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, blockquote, td, th, mjx-container[display="true"]');
    var out = [];
    for (var i = 0; i < els.length; i++) {
      var text = readableText(els[i]);
      if (text.length) out.push({ el: els[i], text: text });
    }
    return out;
  }

  function matchFrame(f) {
    var guide = document.querySelector('.guided-study-text');
    if (!guide || !f) return null;
    var target = normalizeText(f.text || '');
    if (!target.length) return null;
    var best = null, bestScore = 0;
    blockLike(guide).forEach(function (c) {
      if (c.text.length < MIN_CANDIDATE_TOKENS) return;
      var r = overlapScore(target, c.text);
      if (r.score >= MATCH_THRESHOLD ||
          (r.score >= MATCH_SLOP_SCORE && r.overlap >= MATCH_SLOP_OVERLAP)) {
        if (r.score > bestScore) { bestScore = r.score; best = c.el; }
      }
    });
    return best;
  }

  function applyHighlight(el) {
    if (followState.el === el) return;
    if (followState.el) followState.el.classList.remove('r2m-read-hl');
    el.classList.add('r2m-read-hl');
    followState.el = el;
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    try {
      el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
    } catch (e) {
      el.scrollIntoView();
    }
  }

  function clearBand() {
    if (followState.el) {
      followState.el.classList.remove('r2m-read-hl');
      followState.el = null;
    }
  }

  function clearFollow() {
    clearBand();
    followState.idx = -1;
    followState.navFor = null;
  }

  var pendingSectionEnsures = {};
  var pendingSectionSeek = null;
  function ensureSectionNarration(sectionId) {
    if (!sectionId || !PACK_ID) return;
    var sid = String(sectionId);
    if (pendingSectionEnsures[sid]) return;
    var has = reader.frames.some(function(fr){ return String(fr.section_id) === sid; });
    if (has) return;
    pendingSectionEnsures[sid] = true;
    postJSON('/api/readto/section/' + PACK_ID + '/' + sid + '/ensure', {}).then(function(r){ return r.json(); }).then(function(data){
      if (data && data.ok) pollStatus();
    }).catch(function(){}).finally(function(){ delete pendingSectionEnsures[sid]; });
  }

  /* Find the first frame belonging to a guide section. Frames are ordered by
     section + position, so the first match is that section's opener. */
  function firstFrameForSection(sectionId) {
    var sid = String(sectionId);
    for (var i = 0; i < reader.frames.length; i++) {
      if (reader.frames[i] && String(reader.frames[i].section_id) === sid) return i;
    }
    return -1;
  }

  /* When the user hops between guide sections, move a live narration along
     with them: restart from the new section's first frame (resuming playback
     if it was playing). No-ops when no narration is active or the position
     is already at the top of that section. */
  function skipNarrationToSection(sectionId) {
    if (!sectionId || !reader.frames || !reader.frames.length) return;
    var sid = String(sectionId);
    var cur = curFrame();
    // Narration already inside this section (e.g. the follow-along just
    // steered the guide to where it was reading) — nothing to skip.
    if (cur && String(cur.section_id) === sid) return;
    var idx = firstFrameForSection(sectionId);
    if (idx < 0) {
      // Narration for this section may still be generating — remember the
      // pending skip (bumped on each section change) and re-apply it the
      // next time pollStatus surfaces the section's frames.
      pendingSectionSeek = sid;
      ensureSectionNarration(sectionId);
      return;
    }
    pendingSectionSeek = null;
    var wasPlaying = reader.playing;
    stopAudio();
    reader.cur = idx;
    reader.answered = false;
    stageFrame();
    if (wasPlaying && frameReady(idx)) playCurrent();
  }

  window.addEventListener('guided:section-shown', function (e) {
    var sid = e && e.detail && e.detail.sectionId;
    if (sid != null) skipNarrationToSection(sid);
  });
  // Wrap guided navigation so moving section→section lazily renews narration
  (function(){
    var tries=0;
    function tryWrap(){
      if (typeof window.guidedNavigateBySectionId === 'function' && !window.guidedNavigateBySectionId.__readtoWrapped){
        var orig = window.guidedNavigateBySectionId;
        window.guidedNavigateBySectionId = function(sid, cb){
          ensureSectionNarration(sid);
          return orig.call(this, sid, cb);
        };
        window.guidedNavigateBySectionId.__readtoWrapped = true;
      } else if (tries++ < 30) setTimeout(tryWrap, 400);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tryWrap);
    else setTimeout(tryWrap, 400);
  })();

  function followAlong() {
    var f = curFrame();
    if (!f || followState.idx === reader.cur) return;
    var sectionId = f.section_id != null ? String(f.section_id) : null;
    // Lazy: ensure narration for this section exists before trying to highlight/play
    if (sectionId) ensureSectionNarration(sectionId);
    var el = matchFrame(f);
    if (el) {
      applyHighlight(el);
      followState.idx = reader.cur;
      return;
    }
    clearBand();
    followState.idx = reader.cur;
    if (sectionId && guideTabVisible() && sectionId !== followState.navFor &&
        typeof window.guidedNavigateBySectionId === 'function') {
      followState.navFor = sectionId;
      window.guidedNavigateBySectionId(sectionId, function (ok) {
        if (!ok) return;
        var el2 = matchFrame(f);
        if (el2) applyHighlight(el2);
      });
    }
  }

  function stageFrame() {
    /* The modal's stage panel is gone — keep the follow-along wiring that
       depends on frame progression (mini title, readable-text export, guide
       highlight/navigation). */
    var f = curFrame();
    try{ window.__currentReadText = f && f.text ? f.text : ''; }catch(e){}
    syncMini();
    followAlong();
  }

  function nextFrame() {
    if (reader.cur + 1 >= reader.frames.length && reader.ready >= reader.total) return;
    stopAudio();
    if (reader.cur + 1 < reader.frames.length) {
      reader.cur += 1;
      stageFrame();
      if (frameReady(reader.cur)) playCurrent();
    }
  }

  function prevFrame() {
    if (reader.cur <= 0) return;
    stopAudio();
    reader.cur -= 1;
    stageFrame();
    if (frameReady(reader.cur)) playCurrent();
  }

  function togglePlay() {
    if (reader.playing) {
      audio.pause();
      reader.playing = false;
      setPlayPauseVisual(false);
    } else if (!audio.getAttribute('src') || audio.ended) {
      reader.answered = false; /* resuming playback after a pause */
      playCurrent();
    } else {
      audio.play().catch(function () {});
    }
  }

  /* ── Live-chat reply narration ──────────────────────────────────────
     Pauses the guide mid-frame, speaks one or more audio chunks in the
     narrator's voice on a SECOND audio element (the guide's onended/onplaying
     handlers stay untouched), then resumes the guide at the same position.
     Replies can arrive as a single chunk (typed chat → srNarrateText) or as a
     stream of pre-synthesised chunks (voice mode → srSpeakChunk) that drain
     back-to-back. A module-level generation counter retires stale in-flight
     TTS; srNarrationStop() orphans it to interrupt instantly. No-op when no
     narration session is active. */
  var narrate = { active: false, resume: false, pos: 0, url: null };
  var narrateGen = 0;
  var narrateChunks = [];
  var narrateDraining = false;
  var narrateToken = null;
  var narrateHeard = false;
  var replyAudio = new Audio();

  function finishNarration() {
    narrate.active = false;
    narrateChunks = [];
    narrateDraining = false;
    narrateToken = null;
    setPlayPauseVisual(false);
    window.dispatchEvent(new CustomEvent('sr:narration-end'));
    if (narrate.resume) {
      var a = audio;
      var ok = false;
      try {
        if (narrate.url && a.src !== narrate.url) a.src = narrate.url;
        if (narrate.pos > 0.25) a.currentTime = narrate.pos;
        ok = true;
      } catch (e) { ok = false; }
      if (ok) {
        a.play().then(function () {
          reader.playing = true;
          setPlayPauseVisual(true);
        }).catch(function () { playCurrent(); });
      } else {
        playCurrent();
      }
    } else {
      syncMini();
    }
  }

  /* Start a fresh narration burst — pause the guide once (remembering the
     resume position) so reply audio can play. Idempotent: later chunks
     extend the same burst rather than re-pausing the guide.
     allowWithoutSession=true lets the voice orb speak even before a read-to
     session exists (its FAB is gated on the mini, but we don't require it). */
  function srNarrationBegin(allowWithoutSession) {
    if (!allowWithoutSession && !hasSession()) return false;
    if (narrate.active) return true;
    narrateHeard = false;
    narrate.resume = reader.playing;
    narrate.pos = audio.currentTime || 0;
    narrate.url = audioUrl;
    if (narrate.resume) {
      audio.pause();
      setPlayPauseVisual(false);
    }
    narrate.active = true;
    if (miniSub && mini && !mini.hidden) miniSub.textContent = 'Reading your answer…';
    return true;
  }

  /* Play queued chunks back-to-back on the ONE persistent replyAudio element
     (a single element so the Ask-AI orb can tap its output with an
     AnalyserNode). Fires sr:narration-start on the first audible chunk and
     finishNarration() once the queue empties. */
  /* Retrying a blocked play() with the SAME (unmuted) conditions just fails
     the same way again — muted playback is always allowed by autoplay
     policy, and un-muting a media element that's already playing does not
     re-trigger the gate, so this is a real fallback rather than a no-op. */
  function _retryPlayMuted(onOk, onFail) {
    try { replyAudio.muted = true; } catch (e) {}
    var retry;
    try { retry = replyAudio.play(); } catch (e) { onFail(); return; }
    if (retry && retry.then) {
      retry.then(function () { try { replyAudio.muted = false; } catch (e) {} onOk(); })
        .catch(function () { onFail(); });
    } else {
      try { replyAudio.muted = false; } catch (e) {}
      onOk();
    }
  }

  function drainNarration() {
    if (narrateDraining || !narrate.active || !narrateChunks.length) return;
    var b64 = narrateChunks.shift();
    if (!b64) { drainNarration(); return; }

    narrateDraining = true;
    narrateToken = { live: true };
    var token = narrateToken;

    function onChunkEnd() {
      if (!token.live) return;
      token.live = false;
      if (narrateToken === token) narrateToken = null;
      replyAudio.onended = null;
      replyAudio.onerror = null;
      narrateDraining = false;
      if (narrateChunks.length) { drainNarration(); return; }
      if (narrate.active) finishNarration();
    }

    try { replyAudio.pause(); } catch (e) {}
    try { replyAudio.muted = false; replyAudio.volume = 1; } catch (e) {}
    // Resume Ask-AI AudioContext if suspended (long think > gesture window) and wait for it
    var _resumeP = null;
    try {
      if (typeof window.__askAudioCtx === 'function') {
        var _ac = window.__askAudioCtx();
        if (_ac && _ac.state === 'suspended' && _ac.resume) _resumeP = _ac.resume();
      }
    } catch (e) {}
    function _doPlay() {
      replyAudio.onended = onChunkEnd;
      replyAudio.onerror = function () {
        window.dispatchEvent(new CustomEvent('sr:narration-error', { detail: {} }));
        onChunkEnd();
      };
      replyAudio.src = 'data:audio/mpeg;base64,' + b64;
      try { replyAudio.playbackRate = reader.narrationSpeed || 1; } catch (e) {}
      if (typeof window.__srBeforeReplyPlay === 'function') window.__srBeforeReplyPlay();
      var playPromise = replyAudio.play();
    // will be closed below, but keep structure
    return playPromise;
    }
    var playPromise;
    if (_resumeP && _resumeP.then) {
      // Wait for context to resume before playing through WebAudio graph
      _resumeP.then(function () {
        playPromise = _doPlay();
        if (playPromise && playPromise.then) {
          playPromise.then(function () {
            if (!token.live) return;
            if (!narrateHeard) { narrateHeard = true; window.dispatchEvent(new CustomEvent('sr:narration-start', { detail: {} })); }
          }).catch(function () {
            _retryPlayMuted(function () {
              if (!token.live) return;
              if (!narrateHeard) { narrateHeard = true; window.dispatchEvent(new CustomEvent('sr:narration-start', { detail: {} })); }
            }, function () {
              if (!token.live) return;
              window.dispatchEvent(new CustomEvent('sr:narration-error', { detail: {} }));
              onChunkEnd();
            });
          });
        } else if (!narrateHeard) { narrateHeard = true; window.dispatchEvent(new CustomEvent('sr:narration-start', { detail: {} })); }
      }).catch(function () {
        playPromise = _doPlay();
        if (playPromise && playPromise.then) {
          playPromise.then(function () {
            if (!token.live) return;
            if (!narrateHeard) { narrateHeard = true; window.dispatchEvent(new CustomEvent('sr:narration-start', { detail: {} })); }
          }).catch(function () { window.dispatchEvent(new CustomEvent('sr:narration-error', { detail: {} })); onChunkEnd(); });
        }
      });
      return;
    } else {
      playPromise = _doPlay();
    }
    if (playPromise && playPromise.then) {
      playPromise.then(function () {
        if (!token.live) return;
        if (!narrateHeard) {
          /* Narration actually audible — announce it so the Ask-AI orb can
             shift to its speaking state (see ask-ai-fab.js). */
          narrateHeard = true;
          window.dispatchEvent(new CustomEvent('sr:narration-start', { detail: {} }));
        }
      }).catch(function (err) {
        // Autoplay blocked — retry muted (always allowed), then unmute.
        _retryPlayMuted(function () {
          if (!token.live) return;
          if (!narrateHeard) {
            narrateHeard = true;
            window.dispatchEvent(new CustomEvent('sr:narration-start', { detail: {} }));
          }
        }, function () {
          if (!token.live) return;
          window.dispatchEvent(new CustomEvent('sr:narration-error', { detail: {} }));
          onChunkEnd();
        });
      });
    } else {
      // No promise (old browser) — assume playing, fire start.
      if (!narrateHeard) {
        narrateHeard = true;
        window.dispatchEvent(new CustomEvent('sr:narration-start', { detail: {} }));
      }
    }
  }

  /* Enqueue a pre-synthesised audio chunk into the active narration burst. */
  function srSpeakChunk(audioB64) {
    if (!audioB64) return false;
    if (!srNarrationBegin(true)) return false;
    narrateChunks.push(audioB64);
    drainNarration();
    return true;
  }

  /* Interrupt the current narration burst NOW — purge queued chunks, cut the
     playing audio, resume the guide, announce sr:narration-end. */
  function srNarrationStop() {
    narrateGen++;                          /* orphan in-flight /speak responses */
    if (narrateToken) narrateToken.live = false;
    narrateToken = null;
    narrateChunks = [];
    narrateDraining = false;
    try { replyAudio.pause(); } catch (e) {}
    replyAudio.onended = null;
    replyAudio.onerror = null;
    if (narrate.active) finishNarration();
  }

  function srNarrateText(text, allowWithoutSession) {
    console.log('[readto] srNarrateText', allowWithoutSession, (text||'').slice(0,60), 'hasSession', hasSession(), 'len', (text||'').length);
    if ((!allowWithoutSession && !hasSession()) || !text) { console.warn('[readto] srNarrateText blocked', !allowWithoutSession, hasSession()); return false; }
    var clean = cleanMarkdown(text);
    console.log('[readto] clean', clean.slice(0,80), 'len', clean.length);
    if (clean.length < 8) { console.warn('[readto] clean too short'); return false; }

    if (!srNarrationBegin(!!allowWithoutSession)) return false;
    /* Share this burst's generation rather than minting a new one per call:
       voice mode calls srNarrateText once per streamed sentence, and each
       call used to orphan the previous sentence's still-in-flight /speak
       response (myGen !== narrateGen by the time it resolved), so almost
       every synthesised chunk was discarded even though the server
       returned 200 + audio every time. narrateGen still advances on
       srNarrationStop(), which correctly cancels a whole burst. */
    var myGen = narrateGen;
    postJSON('/api/readto/speak', { text: clean, voice_key: reader.selected || null })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (myGen !== narrateGen) return;
        if (!data || !data.ok || !data.audio_b64) return; /* drop just this segment, not the whole burst */
        srSpeakChunk(data.audio_b64);
      })
      .catch(function () {});

    return true;
  }

  /* ── New narration / clear ───────────────────────────────────────── */

  function newNarration() {
    showError('');
    resetPlayback();
    postJSON('/api/readto/clear/' + PACK_ID, {}).catch(function () {});
    var sub = document.getElementById('readtoModalPack');
    if (sub) sub.textContent = 'Pick a narrator for your study guide.';
    loadVoices();
  }

  /* ── Wiring ──────────────────────────────────────────────────────── */

  function initMenu() {
    if (fab) fab.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleMenu();
    });
    /* desktop "Narrate to me" entry (bottom-left of the study guide action
       bar) — delegated so it binds the button guided-path.js injects on
       every section render */
    document.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-readto-entry]') : null;
      if (!btn) return;
      e.stopPropagation();
      if (!PACK_ID) return;
      closeMenu();
      openReader();
    });
    if (menu) {
      menu.addEventListener('click', function (e) { e.stopPropagation(); });
      menu.addEventListener('click', function (e) {
        var item = e.target.closest('[data-fab-action]');
        if (!item) return;
        if (item.getAttribute('data-fab-action') === 'chat') menuActionChat();
        else if (item.getAttribute('data-fab-action') === 'readto') menuActionReadto();
      });
    }
    document.addEventListener('click', function () { closeMenu(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (isMenuOpen()) closeMenu();
        if (modal && !modal.hidden) {
          if (hasSession()) minimizeReader(); else closeReader();
        } else if (mini && !mini.hidden) {
          closeReader();
        }
      }
    });
    window.__srPaneCenter = paneCenterX;
    var paneAnchor = document.getElementById('paneMain');
    if (paneAnchor && window.ResizeObserver) {
      var recenterTick = null;
      new ResizeObserver(function () {
        if (recenterTick) return;
        recenterTick = requestAnimationFrame(function () {
          recenterTick = null;
          positionMini();
        });
      }).observe(paneAnchor);
    }
    window.addEventListener('resize', function () { closeMenu(); });
  }

  function initReader() {
    if (!modal) return;
    modal.querySelectorAll('[data-readto-close]').forEach(function (el) {
      el.addEventListener('click', function () {
        if (hasSession()) minimizeReader(); else closeReader();
      });
    });

    var genBtn = document.getElementById('readtoGenerate');
    if (genBtn) genBtn.addEventListener('click', onPrimaryAction);

    initVoiceDropdown();

    /* Narration settings live in the modal now; playback stays on the mini
       ("now playing") bar — the modal's own transports were removed. */
    if (mathToggle) mathToggle.addEventListener('click', toggleMathTranscribe);
    if (speedOpts) {
      speedOpts.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest ? e.target.closest('.r2m-speed__opt') : null;
        if (btn) pickSpeed(btn.getAttribute('data-speed'));
      });
    }

    if (miniBody) {
      miniBody.addEventListener('click', openPlayerFromMini);
      miniBody.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openPlayerFromMini();
        }
      });
    }
    if (miniPlay) miniPlay.addEventListener('click', function (e) {
      e.stopPropagation();
      togglePlay();
    });
    if (miniStop) miniStop.addEventListener('click', function (e) {
      e.stopPropagation();
      closeReader();
    });
  }

  /* disable the read-to-me item when no pack is open (the hint explains why) */
  if (readtoItem && !PACK_ID) {
    readtoItem.classList.add('is-disabled');
  }

  initMenu();
  initReader();

  window.__readtoReader = {
    open: openReader,
    close: closeReader,
    getState: function () { return { cur: reader.cur, total: reader.total, ready: reader.ready, playing: reader.playing }; }
  };
  window.srNarrationActive = function () { return hasSession(); };
  window.srNarrationVoice = function () { return reader.selected || null; };
  window.srNarrationSpeed = function () { return reader.narrationSpeed || 1; };
  window.srNarrateText = srNarrateText;
  window.srNarrationBegin = srNarrationBegin;
  window.srSpeakChunk = srSpeakChunk;
  window.srNarrationStop = srNarrationStop;
  window.srReplyAudioEl = function () { return replyAudio; };
  window.srNarrationState = function () {
    return { active: narrate.active, heard: narrateHeard, queued: narrateChunks.length };
  };

  // ── Final guard: ensure narration FABs never leak onto other tabs ──────
  // Wraps the *final* window.switchRoomTab (after all other wrappers) so the
  // Study-Guide-only rule survives every patching layer.
  (function () {
    var _wrapDelay = 1200;
    function _installFinalGuard() {
      if (typeof window.switchRoomTab !== 'function') {
        if (_wrapDelay > 0) { _wrapDelay -= 100; setTimeout(_installFinalGuard, 100); }
        return;
      }
      if (window.switchRoomTab.__readtoGuard) return;
      var _orig = window.switchRoomTab;
      window.switchRoomTab = function (btn, targetId) {
        var r = _orig.apply(this, arguments);
        try {
          var isGuided = targetId === 'tab-guided';
          var rm = document.getElementById('readtoMini');
          var af = document.getElementById('askAiFab');
          var sf = document.getElementById('srAiFab');
          if (!isGuided) {
            if (rm) rm.hidden = true;
            if (af) af.hidden = true;
            if (sf) sf.hidden = true;
            var sm = document.getElementById('srAiFabMenu');
            if (sm) sm.classList.remove('is-open');
            document.dispatchEvent(new CustomEvent('sr:tab-switched-away', { detail: { targetId: targetId }}));
          } else {
            if (rm && typeof hasSession === 'function' && hasSession()) {
              // defer to next tick so tab pane is already active
              setTimeout(function(){
                var pane = document.getElementById('tab-guided');
                if (pane && pane.classList.contains('room-vp--active')) showMini();
              }, 30);
            }
          }
        } catch(e) {}
        return r;
      };
      window.switchRoomTab.__readtoGuard = true;
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _installFinalGuard);
    else setTimeout(_installFinalGuard, 400);
  })();
})();