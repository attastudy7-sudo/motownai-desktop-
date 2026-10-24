// Study Room Podcast Engine — audio player, interrupt, speech recognition

// ── PODCAST ENGINE (simplified, single <audio> element) ────────────────────
window._initPodcastEngine = function () {
  if (window._podcastBooted) return;
  window._podcastBooted = true;

  const CSRF = () => (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
  const audio = document.getElementById('podcastAudio');
  if (!audio) return;

  // State
  var _turns = [];
  var _turnIdx = 0;
  var _interrupted = false;
  var _replyPlaying = false;
  var _speechCommitInFlight = false;
  var _pendingInterruptSnapshot = null;
  var _recognition = null;
  var _convoHistory = [];
  var _typingBubble = null;
  var _audioBlobUrl = null;
  var _turnByteEnds = [];
  var _audioChunkToTurnIdx = [];
  var _resumeTime = 0;
  var _postReplyTimer = null;

  // Elements
  var $ = function(id) { return document.getElementById(id); };
  var shell = $('podcastShell');
  var empty = $('podcastEmpty');
  var loading = $('podcastLoading');
  var player = $('podcastPlayer');
  var genBtn = $('podcastGenBtn');
  var genStatus = $('podcastGenStatus');
  var epTitle = $('podcastEpTitle');
  var interruptBtn = $('podcastInterruptBtn');
  var convo = $('podcastConvo');
  var stageGen = $('podcastStageGen');
  var genLabel = $('podcastGenLabel');
  var optionsBtn = $('srOptionsBtn');
  var optionsMenu = $('srOptionsMenu');
  var podcastRegenMenuBtn = $('srPodcastRegenMenuBtn');
  var speedBtn = $('pcSpeedBtn');
  var downloadBtn = $('pcDownloadBtn');
  var _tutorSpeaker = 'Tutor';

  if (!shell) return;

  if (downloadBtn) { downloadBtn.style.opacity = '0.5'; downloadBtn.style.pointerEvents = 'none'; }

  _tryLoadExisting();

  // ── Typing indicator ──
  function _showTypingIndicator() {
    if (!convo) return;
    if (_typingBubble && _typingBubble.parentNode) _typingBubble.parentNode.removeChild(_typingBubble);
    var div = document.createElement('div');
    div.className = 'pc-bubble-body pc-bubble-body--tutor pc-bubble-body--typing';
    div.innerHTML = '<div class="gen-thinking-dots"><span></span><span></span><span></span></div>';
    convo.appendChild(div);
    convo.scrollTop = convo.scrollHeight;
    _typingBubble = div;
  }
  function _removeTypingIndicator() {
    if (_typingBubble && _typingBubble.parentNode) _typingBubble.parentNode.removeChild(_typingBubble);
    _typingBubble = null;
  }

  function _enterInterruptMode() {
    interruptBtn.disabled = true;
    interruptBtn.classList.add('pc-raise-hand--listening');
    interruptBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><span>Listening...</span>';
  }
  function _exitInterruptMode() {
    _removeTypingIndicator();
    interruptBtn.disabled = false;
    interruptBtn.classList.remove('pc-raise-hand--listening');
    interruptBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg><span>Raise Hand</span>';
  }

  // ── Render current turn: highlight + autoscroll ──
  function _renderTurn(idx) {
    if (!convo || !_turns[idx]) return;
    var prev = convo.querySelector('.pc-bubble-wrap--active');
    if (prev) prev.classList.remove('pc-bubble-wrap--active');
    var active = convo.querySelector('.pc-bubble-wrap[data-turn-idx="' + idx + '"]');
    if (active) {
      active.classList.add('pc-bubble-wrap--active');
      active.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  // ── Track turn progression while playing (byte-offset sync) ──
  audio.addEventListener('timeupdate', function() {
    if (!_turns.length || _interrupted || !audio.duration) return;
    var progress = audio.currentTime / audio.duration;
    var idx = 0;
    for (var i = 0; i < _turnByteEnds.length; i++) {
      if (progress < _turnByteEnds[i]) { idx = i; break; }
      idx = i;
    }
    var turnIdx = _audioChunkToTurnIdx[idx] !== undefined ? _audioChunkToTurnIdx[idx] : idx;
    if (turnIdx !== _turnIdx) {
      _turnIdx = turnIdx;
      _renderTurn(turnIdx);
      _convoHistory.push(_turns[turnIdx].speaker + ': ' + _turns[turnIdx].text);
      if (_convoHistory.length > 6) _convoHistory = _convoHistory.slice(-6);
    }
  });

  // ── Concatenate base64 audio chunks into a Blob (auto-detect WAV vs MP3) ──
  function _detectMime(firstBase64) {
    if (!firstBase64) return 'audio/mpeg';
    try {
      var raw = atob(firstBase64);
      if (raw.length < 4) return 'audio/mpeg';
      var code = raw.charCodeAt(0) << 16 | raw.charCodeAt(1) << 8 | raw.charCodeAt(2);
      // WAV: RIFF header; MP3: ID3 or 0xFFFB sync
      if (raw.charCodeAt(0) === 0x52 && raw.charCodeAt(1) === 0x49 &&
          raw.charCodeAt(2) === 0x46 && raw.charCodeAt(3) === 0x46) return 'audio/wav';
      return 'audio/mpeg';
    } catch (_) { return 'audio/mpeg'; }
  }
  function _loadAudio(data) {
    if (_audioBlobUrl) { URL.revokeObjectURL(_audioBlobUrl); _audioBlobUrl = null; }
    if (!data.audio || !data.audio.length) { audio.removeAttribute('src'); return; }

    // Build decoded chunks, tracking which turn index each chunk belongs to.
    // audio[i] maps 1:1 with turns[i]; null entries mean that turn has no audio.
    var allBytes = [];
    _audioChunkToTurnIdx = [];
    var audioIdx = 0;
    for (var t = 0; t < _turns.length; t++) {
      _turns[t]._duration = _turns[t].duration_secs || 0;
      if (audioIdx < data.audio.length && data.audio[audioIdx] != null) {
        var b64 = data.audio[audioIdx];
        var binary = atob(b64);
        var bytes = new Uint8Array(binary.length);
        for (var j = 0; j < binary.length; j++) bytes[j] = binary.charCodeAt(j);
        allBytes.push(bytes);
        _audioChunkToTurnIdx.push(t);
        audioIdx++;
      } else {
        if (data.audio[audioIdx] === null) audioIdx++;
      }
    }

    // Build byte-proportion boundary map (immune to TTS timing drift)
    var totalBytes = 0;
    for (var i = 0; i < allBytes.length; i++) totalBytes += allBytes[i].length;
    _turnByteEnds = [];
    var cumBytes = 0;
    for (var i = 0; i < allBytes.length; i++) {
      cumBytes += allBytes[i].length;
      _turnByteEnds.push(cumBytes / totalBytes);
    }

    var mime = _detectMime(data.audio[0] || data.audio.find(function(x){ return x != null; }));
    _audioBlobUrl = URL.createObjectURL(new Blob(allBytes, { type: mime }));
    audio.src = _audioBlobUrl;
    audio.load();
  }

  // ── Create a conversation bubble ──
  function _createBubble(turn, idx) {
    var isTutor = _tutorSpeaker === turn.speaker;
    var initial = turn.speaker ? turn.speaker.charAt(0).toUpperCase() : '?';
    var wrap = document.createElement('div');
    wrap.className = 'pc-bubble-wrap' + (idx === 0 ? ' pc-bubble-wrap--active' : '') + (isTutor ? '' : ' pc-bubble-wrap--reverse');
    wrap.dataset.turnIdx = idx;

    var avatar = document.createElement('div');
    avatar.className = 'pc-bubble-avatar pc-bubble-avatar--' + (isTutor ? 'tutor' : 'student');
    avatar.textContent = initial;

    var body = document.createElement('div');
    body.className = 'pc-bubble-body pc-bubble-body--' + (isTutor ? 'tutor' : 'student');

    var name = document.createElement('span');
    name.className = 'pc-bubble-name';
    name.textContent = turn.speaker || 'Speaker';

    var text = document.createElement('div');
    text.className = 'pc-bubble-text';
    text.textContent = turn.text || '';

    body.appendChild(name);
    body.appendChild(text);
    wrap.appendChild(avatar);
    wrap.appendChild(body);
    return wrap;
  }

  // ── Setup podcast after generation ──
  function _setupPodcast(data) {
    _turns = data.turns || [];
    _turnIdx = 0;
    _interrupted = false;
    _convoHistory = [];
    if (_turns.length > 0) _tutorSpeaker = _turns[0].speaker;
    if (convo) {
      convo.innerHTML = '';
      convo.classList.remove('pc-convo--expanded');
      _turns.forEach(function(turn, i) {
        convo.appendChild(_createBubble(turn, i));
      });
    }
    if (epTitle) epTitle.textContent = data.title || 'AI Podcast';
    _loadAudio(data);
    _renderTurn(0);

    if (downloadBtn) {
      downloadBtn.style.opacity = '';
      downloadBtn.style.pointerEvents = '';
      downloadBtn.onclick = function() {
        if (!_audioBlobUrl) return;
        var a = document.createElement('a');
        a.href = _audioBlobUrl;
        a.download = (epTitle ? epTitle.textContent : 'podcast') + '.mp3';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      };
    }
  }

  // ── Stage UI ──
  function _showEmpty() { empty.style.display = ''; loading.style.display = 'none'; player.style.display = 'none'; }
  function _showLoading() {
    if (empty) empty.style.display = 'none';
    if (player) player.style.display = 'none';
    if (loading) loading.style.display = 'flex';
    if (stageGen) stageGen.style.display = 'none';
  }
  function _showPlayer() {
    _stopPodcastPhases();
    if (empty) empty.style.display = 'none';
    if (loading) loading.style.display = 'none';
    if (player) player.style.display = 'flex';
  }
  function _showError(msg) {
    _stopPodcastPhases();
    if (loading) loading.style.display = 'none';
    if (player) player.style.display = 'none';
    if (empty) {
      empty.style.display = '';
      if (genStatus) genStatus.textContent = '\u26A0 ' + (msg || 'Something went wrong.');
      var retryBtn = $('podcastRetryBtn');
      if (!retryBtn) {
        retryBtn = document.createElement('button');
        retryBtn.id = 'podcastRetryBtn';
        retryBtn.className = 'podcast-gen-btn';
        retryBtn.textContent = 'Try Again';
        retryBtn.addEventListener('click', function() { retryBtn.parentNode && retryBtn.parentNode.removeChild(retryBtn); _generate(); });
        empty.appendChild(retryBtn);
      }
    }
  }

  function _setOptionsMenuOpen(isOpen) {
    if (!optionsBtn || !optionsMenu) return;
    optionsMenu.classList.toggle('open', isOpen);
    optionsBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    if (isOpen) {
      setTimeout(function() {
        var first = _getMenuItems()[0];
        if (first) first.focus();
      }, 0);
    }
  }

  function _getMenuItems() {
    if (!optionsMenu) return [];
    return Array.from(optionsMenu.querySelectorAll('.sr-topbar-menu__item:not([disabled])'));
  }

  function _focusMenuItem(delta) {
    var items = _getMenuItems();
    if (!items.length) return;
    var idx = items.indexOf(document.activeElement);
    if (idx < 0) idx = 0;
    idx = (idx + delta + items.length) % items.length;
    items[idx].focus();
  }

  function _closeOptionsMenu() {
    _setOptionsMenuOpen(false);
  }

  function _toggleOptionsMenu() {
    if (!optionsBtn || !optionsMenu) return;
    _setOptionsMenuOpen(!optionsMenu.classList.contains('open'));
  }

  function _runPodcastRegenerate() {
    if (podcastRegenMenuBtn && podcastRegenMenuBtn.disabled) return;
    if (podcastRegenMenuBtn) {
      podcastRegenMenuBtn.disabled = true;
      podcastRegenMenuBtn.textContent = 'Regenerating…';
    }

    if (typeof window._srCloseOptionsMenu === 'function') window._srCloseOptionsMenu();
    if (downloadBtn) { downloadBtn.style.opacity = '0.5'; downloadBtn.style.pointerEvents = 'none'; downloadBtn.onclick = null; }

    if (typeof window._podcastRegenerate === 'function') {
      window._podcastRegenerate();
    }

    if (podcastRegenMenuBtn) {
      podcastRegenMenuBtn.disabled = false;
      podcastRegenMenuBtn.textContent = '↺ Regenerate';
    }
  }

  // ── Generation progress phases ──
  var _podcastPhases = ['Writing the script…', 'Recording the voices…', 'Mixing audio…', 'Almost done…'];
  var _podcastDelays = [6000, 18000, 35000, 55000];
  var _podcastPhaseTimers = [];
  function _startPodcastPhases() {
    _stopPodcastPhases();
    if (genLabel) genLabel.textContent = 'Generating your podcast…';
    _podcastPhaseTimers = _podcastPhases.map(function(label, i) {
      return setTimeout(function() { if (genLabel) genLabel.textContent = label; }, _podcastDelays[i]);
    });
  }
  function _stopPodcastPhases() {
    _podcastPhaseTimers.forEach(clearTimeout);
    _podcastPhaseTimers = [];
  }

  // ── Generate ──
  function _generate() {
    if (loading) loading.style.display = 'flex';
    if (empty) empty.style.display = 'none';
    if (player) player.style.display = 'none';
    if (genStatus) genStatus.textContent = '';
    if (stageGen) stageGen.style.display = '';
    _startPodcastPhases();

    fetch('/api/podcast/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': (document.querySelector('meta[name="csrf-token"]') || {}).content || '',
      },
      body: JSON.stringify({
        video_id: typeof VIDEO_ID !== 'undefined' ? VIDEO_ID : null,
        pack_id: typeof PACK_ID !== 'undefined' ? PACK_ID : null,
        duration_minutes: (window.USER_LIMITS && window.USER_LIMITS.podcast_minutes) || 5,
      }),
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.quota_exceeded) {
        _showError('');
        if (window.maybeShowCreditsExhausted && window.maybeShowCreditsExhausted(data, 'podcast minutes')) {
          return;
        }
        if (typeof window.showQuotaModal === 'function') {
          window.showQuotaModal({
            resource: 'podcast minutes',
            used: data.used,
            limit: data.limit,
            resetsInSeconds: data.resets_in_seconds, tier: data.tier,
          });
        } else if (typeof window.openUpgradeModal === 'function') {
          window.openUpgradeModal();
        } else {
          window.location.href = '/pricing';
        }
        return;
      }
      if (!data.ok || !data.turns || !data.turns.length) {
          var errMsg = data.message || data.error || 'Generation failed. Try again.';
          _showError(errMsg);
          return;
        }
      _setupPodcast(data);
      _showPlayer();
    })
    .catch(function() { _showError('Network error. Try again.'); });
  }

  // ── Load existing podcast ──
  function _tryLoadExisting() {
    if (typeof PACK_ID === 'undefined' || !PACK_ID) { _showEmpty(); return; }
    _showLoading();
    fetch('/api/podcast/' + PACK_ID, { headers: { 'X-CSRFToken': CSRF() } })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.ok && data.turns && data.turns.length) { _setupPodcast(data); _showPlayer(); return; }
      _showEmpty();
    })
    .catch(function() { _showEmpty(); });
  }

  // ── Interrupt / Ask AI ──
  function _addConvoBubble(role, text) {
    if (!convo) return;
    var isTutor = role === 'tutor' || role === _tutorSpeaker.toLowerCase();
    var initial = role.charAt(0).toUpperCase();
    var wrap = document.createElement('div');
    wrap.className = 'pc-bubble-wrap pc-bubble-wrap--active' + (isTutor ? '' : ' pc-bubble-wrap--reverse');
    var avatar = document.createElement('div');
    avatar.className = 'pc-bubble-avatar pc-bubble-avatar--' + (isTutor ? 'tutor' : 'student');
    avatar.textContent = initial;
    var body = document.createElement('div');
    body.className = 'pc-bubble-body pc-bubble-body--' + (isTutor ? 'tutor' : 'student');
    var name = document.createElement('span');
    name.className = 'pc-bubble-name';
    name.textContent = role.charAt(0).toUpperCase() + role.slice(1);
    var txt = document.createElement('div');
    txt.className = 'pc-bubble-text';
    txt.textContent = text;
    body.appendChild(name);
    body.appendChild(txt);
    wrap.appendChild(avatar);
    wrap.appendChild(body);
    convo.appendChild(wrap);
    convo.scrollTop = convo.scrollHeight;
  }
  function _resumePodcast() {
    _speechCommitInFlight = false;
    _exitInterruptMode();
    _interrupted = false;
    _replyPlaying = false;
    _renderTurn(_turnIdx);
    if (_resumeTime !== undefined && _resumeTime >= 0) audio.currentTime = _resumeTime;
    audio.play();
  }
  function _handleInterruptQuestion(question) {
    if (!question || !question.trim()) { _resumePodcast(); return; }
    _addConvoBubble('user', question.trim());
    _showTypingIndicator();
    var snap = _pendingInterruptSnapshot || {};
    var _abortCtrl = new AbortController();
    var _abortTimer = setTimeout(function() { _abortCtrl.abort(); }, 25000);

    fetch('/api/podcast/interrupt', {
      method: 'POST',
      signal: _abortCtrl.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': (document.querySelector('meta[name="csrf-token"]') || {}).content || ''
      },
      body: JSON.stringify({
        question: question,
        pack_id: PACK_ID,
        context: (snap.recentHistory || []).join('\n'),
        full_transcript: snap.fullTranscript || '',
        interrupt_marker: {
          turn_index: snap.turnIndex || 0,
          turn_speaker: snap.turnSpeaker || '',
          turn_text: snap.turnText || '',
          elapsed_seconds: Math.round(snap.elapsedSeconds || 0),
          turn_duration_seconds: Math.round(snap.turnDurationSeconds || 0),
          total_turns: snap.totalTurns || 0,
        },
      }),
    })
    .then(function(r) { clearTimeout(_abortTimer); return r.json(); })
    .then(function(data) {
      var reply   = (data && data.reply)   ? data.reply   : "Let's keep going for now.";
      var speaker = (data && data.speaker) ? data.speaker : 'Alex';
      var audiob64 = (data && data.audio_b64) ? data.audio_b64 : null;

      _removeTypingIndicator();
      _addConvoBubble(speaker.toLowerCase(), reply);

      _replyPlaying = true;
      interruptBtn.disabled = true;

      function _onReplyEnd() {
        _replyPlaying = false;
        interruptBtn.disabled = false;
        _interrupted = false; // allow re-interruption
        _speechCommitInFlight = false;
        // Wait 3s before resuming; re-interrupt cancels the timer
        if (_postReplyTimer) clearTimeout(_postReplyTimer);
        _postReplyTimer = setTimeout(function() {
          if (!_interrupted) _resumePodcast();
        }, 3000);
      }

      if (audiob64) {
        // ── Primary: play server-synthesised Edge-TTS/Kokoro audio ──
        try {
          var replyAudio = document.getElementById('podcastReplyAudio');
          var binary = atob(audiob64);
          var bytes = new Uint8Array(binary.length);
          for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          // Detect WAV vs MP3 from header
          var mime = (bytes[0] === 0x52 && bytes[1] === 0x49) ? 'audio/wav' : 'audio/mpeg';
          var blob = new Blob([bytes], { type: mime });
          var replyUrl = URL.createObjectURL(blob);

          // Play reply on separate element — podcast audio stays untouched.
          // Handlers set before play() so onended can't fire before they're registered.
          replyAudio.onended = function() {
            URL.revokeObjectURL(replyUrl);
            replyAudio.onended = null;
            replyAudio.onerror = null;
            replyAudio.src = '';
            _onReplyEnd();
          };
          replyAudio.onerror = function() {
            URL.revokeObjectURL(replyUrl);
            replyAudio.onended = null;
            replyAudio.onerror = null;
            replyAudio.src = '';
            _onReplyEnd();
          };
          replyAudio.src = replyUrl;
          replyAudio.load();
          replyAudio.play().catch(function() {
            URL.revokeObjectURL(replyUrl);
            replyAudio.onended = null;
            replyAudio.onerror = null;
            _onReplyEnd();
          });
        } catch (e) {
          _onReplyEnd();
        }
      } else {
        // ── Fallback: browser speechSynthesis if server TTS failed ──
        if (window.speechSynthesis) {
          var utt = new SpeechSynthesisUtterance(reply);
          utt.rate = 0.95;
          utt.pitch = speaker === 'Sam' ? 1.1 : 0.9;
          utt.onend  = _onReplyEnd;
          utt.onerror = _onReplyEnd;
          window.speechSynthesis.speak(utt);
        } else {
          _onReplyEnd();
        }
      }
    })
    .catch(function() {
      clearTimeout(_abortTimer);
      _removeTypingIndicator();
      _addConvoBubble('alex', "Sorry, I couldn't get a response in time. Let's keep going.");
      _speechCommitInFlight = false;
      _resumePodcast();
    });
  }

  if (interruptBtn) interruptBtn.addEventListener('click', function() {
    if (!_turns.length || _interrupted || _replyPlaying) return;
    _pendingInterruptSnapshot = {
      turnIndex: _turnIdx, turnText: (_turns[_turnIdx] && _turns[_turnIdx].text) || '', turnSpeaker: (_turns[_turnIdx] && _turns[_turnIdx].speaker) || '',
      elapsedSeconds: audio.currentTime, turnDurationSeconds: (_turns[_turnIdx] && _turns[_turnIdx]._duration) || 0,
      totalTurns: _turns.length, recentHistory: _convoHistory.slice(-6),
      fullTranscript: _turns.map(function(t) { return t.speaker + ': ' + t.text; }).join('\n'),
    };
    _resumeTime = audio.currentTime;
    _interrupted = true;
    _speechCommitInFlight = false;
    if (_postReplyTimer) { clearTimeout(_postReplyTimer); _postReplyTimer = null; }
    _enterInterruptMode();
    audio.pause();

    setTimeout(function() {
      var _SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!_SpeechRecognitionCtor) {
        var fb = $('podcastFallbackInput');
        if (fb) {
          fb.style.display = 'flex';
          var inp = $('podcastFallbackText');
          if (inp) inp.value = '';
          if (inp) inp.focus();
          function _r() {}
          function _s() { var q = inp ? inp.value.trim() : ''; fb.style.display = 'none'; _r(); if (q) _handleInterruptQuestion(q); else _resumePodcast(); }
          function _c() { fb.style.display = 'none'; _r(); _resumePodcast(); }
          $('podcastFallbackSubmit').onclick = _s; $('podcastFallbackCancel').onclick = _c;
          if (inp) inp.onkeydown = function(e) { if (e.key === 'Enter') _s(); };
        } else { _resumePodcast(); }
        return;
      }
      function _resetUI() {}
      // CHANGE 3 — Replace native VAD with 3-second silence timer
      _recognition = new _SpeechRecognitionCtor();
      _recognition.lang = 'en-US';
      _recognition.interimResults = true;   // needed so we get interim events to reset the silence timer
      _recognition.continuous = true;       // keep mic open; we close it ourselves after the silence threshold
      _recognition.maxAlternatives = 1;

      var _silenceTimer = null;
      var _finalTranscript = '';
      var _SILENCE_MS = 3000; // 3.0-second inactivity threshold

      function _commitSpeech() {
        _speechCommitInFlight = true;
        if (_silenceTimer) { clearTimeout(_silenceTimer); _silenceTimer = null; }
        try { _recognition.stop(); } catch (_) {}
        _resetUI();
        var q = _finalTranscript.trim();
        _finalTranscript = '';
        if (q) {
          _handleInterruptQuestion(q);
        } else {
          _speechCommitInFlight = false;
          _resumePodcast();
        }
      }

      function _resetSilenceTimer() {
        if (_silenceTimer) clearTimeout(_silenceTimer);
        _silenceTimer = setTimeout(_commitSpeech, _SILENCE_MS);
      }

      _recognition.onresult = function(e) {
        var interim = '';
        for (var i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) {
            _finalTranscript += e.results[i][0].transcript;
          } else {
            interim += e.results[i][0].transcript;
          }
        }
        if (_finalTranscript || interim) {
          _resetSilenceTimer();
        }
      };

      _recognition.onerror = function(e) {
        if (e.error === 'no-speech') return;
        if (_speechCommitInFlight) { _speechCommitInFlight = false; return; }
        if (_silenceTimer) { clearTimeout(_silenceTimer); _silenceTimer = null; }
        _finalTranscript = '';
        _resetUI();
        _resumePodcast();
      };

      _recognition.onend = function() {
        if (_speechCommitInFlight) { return; }
        if (!_silenceTimer && !_finalTranscript.trim()) {
          _resetUI();
          _resumePodcast();
        } else if (_finalTranscript.trim() && !_silenceTimer) {
          _commitSpeech();
        }
      };

      _resetSilenceTimer();
      _recognition.start();
    }, 300);
  });

  // ── Speed toggle ──
  var _speeds = [1, 1.25, 1.5, 2];
  var _speedIdx = 0;
  if (speedBtn) speedBtn.addEventListener('click', function() {
    _speedIdx = (_speedIdx + 1) % _speeds.length;
    audio.playbackRate = _speeds[_speedIdx];
    speedBtn.textContent = _speeds[_speedIdx] + 'x';
  });

  // ── Volume ──
  var volumeTrack = $('pcVolumeTrack');
  var volumeFill = $('pcVolumeFill');
  var volumeBtn = $('pcVolumeBtn');
  var _muted = false;
  if (volumeBtn) volumeBtn.addEventListener('click', function() {
    _muted = !_muted;
    audio.muted = _muted;
  });
  if (volumeTrack) volumeTrack.addEventListener('click', function(e) {
    var rect = volumeTrack.getBoundingClientRect();
    var pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.volume = pct;
    if (volumeFill) volumeFill.style.width = (pct * 100) + '%';
    if (_muted) { _muted = false; audio.muted = false; }
  });

  // ── Sync duration label ──
  var durLabel = $('pcDurationLabel');
  audio.addEventListener('loadedmetadata', function() {
    if (durLabel && audio.duration) {
      var m = Math.floor(audio.duration / 60);
      var s = Math.floor(audio.duration % 60);
      durLabel.textContent = m + ':' + (s < 10 ? '0' : '') + s;
    }
  });

  if (genBtn) genBtn.addEventListener('click', _generate);
  if (podcastRegenMenuBtn) podcastRegenMenuBtn.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    _runPodcastRegenerate();
  });

  window._tryLoadExistingPodcast = _tryLoadExisting;

  window._podcastRegenerate = function() {
    if (audio) { audio.pause(); audio.removeAttribute('src'); }
    if (_audioBlobUrl) { URL.revokeObjectURL(_audioBlobUrl); _audioBlobUrl = null; }
    _turns = []; _turnIdx = 0; _interrupted = false; _replyPlaying = false;
    _speechCommitInFlight = false; _convoHistory = []; _resumeTime = 0;
    if (convo) { convo.innerHTML = ''; convo.classList.remove('pc-convo--expanded'); }
    _showLoading();
    var packId = typeof PACK_ID !== 'undefined' ? PACK_ID : null;
    if (!packId) { _generate(); return; }
    fetch('/api/podcast/clear/' + packId, {
      method: 'POST',
      headers: { 'X-CSRFToken': CSRF(), 'Content-Type': 'application/json' },
    })
    .then(function() { _generate(); })
    .catch(function() { _generate(); });
  };
};
