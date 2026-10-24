/* ask-ai-fab.js — "Ask AI" voice prompt while a Read-to-Me narration runs.
 *
 * A small FAB floats just above the now-playing bar (#askAiFab), visible only
 * while that bar is shown. Tapping it opens a calm, immersive overlay orb.
 * The transcript is visible beside the orb as it's dictated, then the orb
 * animates through listening → thinking → speaking as the reply is voiced
 * sentence-by-sentence in the narrator's voice (see chat-engine.js voice mode).
 * The orb pulses with live audio energy — mic while listening, narrator output
 * while speaking — smoothed into --ask-amp.
 *
 * Falls back to the chat pane, focused for typing, when speech recognition is
 * unavailable or the mic is denied.
 *
 * Depends on readto-fab.js (sr:mini-changed, sr:narration-start/end,
 * srNarrateText) and chat-engine.js (window.sendChat) — all load before this
 * file.
 */
(function () {
  'use strict';

  var fab = document.getElementById('askAiFab');
  var overlay = document.getElementById('askOrbOverlay');
  var orb = document.getElementById('askOrb');
  var userMsg = document.getElementById('askOrbUserMsg');
  var userMsgText = document.getElementById('askOrbUserMsgText');
  var replyMsg = document.getElementById('askOrbReply');
  var replyText = document.getElementById('askOrbReplyText');
  var hintEl = document.getElementById('askOrbHint');
  var mini = document.getElementById('readtoMini');

  if (!fab || !overlay || !orb || !hintEl) return;

  var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  /* Touch/coarse-pointer UI (phones, tablets — Chrome, Safari, no Edge on
     mobile). Two Web Speech constraints only matter here: iOS Safari cannot
     run getUserMedia and webkitSpeechRecognition on the same mic at once, and
     it blocks recognizer restarts that aren't backed by a fresh user gesture.
     Feature-detect by pointer type instead of UA sniffing. */
  var isCoarsePointer = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
                        ('ontouchstart' in window);
  var recognition = null;
  var recognitionGen = 0;      /* retires stale recognizer event handlers */
  var finalTranscript = '';
  var interimTranscript = '';
  var active = false;          /* overlay is open */
  var phase = null;            /* 'listen' | 'think' | 'speak' | null */
  var watchdogTimer = null;
  /* Delayed commit: a commit is only fired after the SAME transcribed words
     have persisted untouched for a full grace window. New recognizer activity
     re-arms it, so the user is never cut off mid-thought — they must finish
     speaking and stay silenced for the whole grace period before we move to
     thinking. */
  var commitTimer = null;
  var pendingCommitText = '';
  var restartingRec = false;
  /* Chrome confirms a finished sentence with a "final" result, but with
     continuous=true it ALSO finalizes a segment after a brief pause even when
     the student is mid-thought. So a final result does not reliably mean
     "done". Deliberately slow commits: the transcript must survive a full
     window with NO recognizer activity at all (every event re-arms the
     countdown). Any lingering interim means the user is mid-utterance and
     gets the longer window. Tailored to "never cut the user off" over
     responsiveness. */
  var FINAL_GRACE_MS = 3500;
  var INTERIM_GRACE_MS = 4500;
  var WATCHDOG_MS = 25000;

  // Persistent barge-in listener — always on while narration is playing on Study Guide
  var persistentRec = null;
  var persistentWanted = false;
  var persistentStarting = false;

  /* Voice pipeline: generation counter retires stale in-flight /speak
     responses, voiceText feeds the AI transcript as segments narrate. */
  var voiceGen = 0;
  var voiceText = '';
  /* Audio-energy reactivity — mic analyser while listening, the narrator's
     reply element while speaking, both smoothed into --ask-amp. */
  var audioCtx = null;
  var micAnalyser = null;
  var micStream = null;
  var micGen = 0;                 /* retires getUserMedia resolves after teardown */
  var replySrc = null;
  var replyAnalyser = null;
  var energyRaf = 0;
  var prevAmp = 0;

  var PHASE_LABELS = {
    listen: 'Ask AI — listening',
    think: 'Ask AI — thinking',
    speak: 'Ask AI — speaking'
  };

  /* The FAB rides ~64px above the now-playing bar — same pane centre as
     the bar itself so the two pop as a single unit above the study guide. */
  function positionFab() {
    var cx = (typeof window.__srPaneCenter === 'function') ? window.__srPaneCenter() : window.innerWidth / 2;
    fab.style.left = cx + 'px';
  }

  function setFabVisible(v) {
    // set left before un-hiding so the 1s delayed pop starts from the exact centre
    if (v) positionFab();
    fab.hidden = !v;
  }

  /* Anchor the orb dialog to the study-guide pane's centre (readto-fab.js
     exposes __srPaneCenter). --ask-center-x is px, overlaying the CSS fallback. */
  function updateOverlayAnchor() {
    var cx = (typeof window.__srPaneCenter === 'function') ? window.__srPaneCenter() : window.innerWidth / 2;
    overlay.style.setProperty('--ask-center-x', cx + 'px');
  }

  function syncFromMini() {
    setFabVisible(!!(mini && !mini.hidden));
  }

  /* Keep the FAB in lock-step with the now-playing bar — readto-fab.js
     dispatches sr:mini-changed on every show/hide. */
  document.addEventListener('sr:mini-changed', function (e) {
    setFabVisible(!!(e && e.detail && e.detail.visible));
  });
  if (window.MutationObserver && mini) {
    var mo = new MutationObserver(syncFromMini);
    mo.observe(mini, { attributes: true, attributeFilter: ['hidden'] });
  }
  syncFromMini();

  function showToast(msg) {
    if (typeof window.showToast === 'function') window.showToast(msg, 'info');
  }

  function setHint(msg) {
    if (hintEl) hintEl.textContent = msg || '';
  }

  function setOrbState(state) {
    orb.classList.remove('is-listening', 'is-thinking', 'is-speaking', 'is-error');
    if (state) orb.classList.add(state);
  }

  function setPhase(p) {
    phase = p;
    if (orb) orb.setAttribute('aria-label', PHASE_LABELS[p] || 'Ask AI');
  }

  function setPhaseUI(p, orbState, hint) {
    setPhase(p);
    setOrbState(orbState);
    setHint(hint);
  }

  function clearTranscript() {
    if (userMsgText) userMsgText.textContent = '';
    if (userMsg) userMsg.hidden = true;
    if (replyText) replyText.textContent = '';
    if (replyMsg) replyMsg.hidden = true;
  }

  function clearCommitTimer() {
    if (commitTimer) { clearTimeout(commitTimer); commitTimer = null; }
    pendingCommitText = '';
  }

  function stopRecognition() {
    if (recognition) {
      try { recognition.stop(); } catch (e) {}
      recognition = null;
    }
    clearCommitTimer();
  }

  /* Live transcript changed → start a fresh grace countdown. The commit only
     fires once the transcript has been fully quiet — NO new recognizer events
     — for the whole grace window. If any interim is still pending, the user
     is (possibly) mid-utterance, so we demand a long quiet settle; only a
     settled transcript gets the shorter grace. If ANY new activity arrives
     before then, this re-arms — the user is still talking or paused between
     clauses, so we never cut them off. */
  function armSpeechCommit() {
    if (!active || phase !== 'listen') return;
    var text = (finalTranscript + ' ' + interimTranscript).trim();
    if (!text) return;
    if (commitTimer) clearTimeout(commitTimer);
    pendingCommitText = text;
    var grace = interimTranscript.trim() ? INTERIM_GRACE_MS : FINAL_GRACE_MS;
    commitTimer = setTimeout(function () {
      commitTimer = null;
      commitStableSpeech(pendingCommitText);
    }, grace);
  }

  function commitStableSpeech(expectedText) {
    if (!active || phase !== 'listen') return;
    var text = (finalTranscript + ' ' + interimTranscript).trim();
    /* The words changed while the timer was running — the user was NOT done.
       Re-arm the countdown against the new words instead of committing. */
    if (text !== expectedText) {
      armSpeechCommit();
      return;
    }
    if (!text) return;
    finalTranscript = '';
    interimTranscript = '';
    pendingCommitText = '';
    commitQuestion(text);
  }

  /* The recognizer died (onend/no-speech/network). Never dismiss the orb and
     never commit from here — just quietly start a fresh recognizer so the
     user can keep talking. */
  var touchRearmCount = 0;
  function rearmRecognition() {
    if (restartingRec) return;
    if (!active || phase !== 'listen') return;
    /* Touch: restarts here are not gesture-backed, and iOS webkitSpeechRecognition
       either refuses them or bounces to error 'not-allowed' (which our error
       handler treats as a hard failure → typing fallback). The grace-commit
       timer already owns any captured words, so rearming is only wanted to
       catch a user who hasn't started speaking yet. Bound quiet retries so a
       silent recognizer can't daisy-chain forever. */
    if (isCoarsePointer) {
      var hasWords = (finalTranscript + ' ' + interimTranscript).trim();
      if (hasWords) return;                    /* commit timer handles these */
      if (++touchRearmCount > 2) {
        setHint('Tap the orb to ask again');
        return;
      }
    }
    restartingRec = true;
    setTimeout(function () {
      restartingRec = false;
      if (!active || phase !== 'listen') return;
      startRecognition();
    }, 400);
  }

  function clearWatchdog() {
    if (watchdogTimer) { clearTimeout(watchdogTimer); watchdogTimer = null; }
  }

  function getCSRF() {
    var m = document.querySelector('meta[name="csrf-token"]');
    return m ? m.content : '';
  }

  function postJSON(url, body) {
    return fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCSRF() },
      body: JSON.stringify(body || {})
    });
  }

  /* ── Audio-energy reactivity ────────────────────────────────────────
     Live RMS from the mic while listening and from the narrator's reply
     element while speaking, EMA-smoothed into --ask-amp on the orb (mirrors
     the voice-orb repo's technique: amp += (target - amp) * rate with a fast
     attack, slower decay). Falls back to the CSS keyframes silently when the
     analyser is unavailable. */
  function getAudioCtx() {
    if (audioCtx) {
      try { if (audioCtx.state === 'suspended') audioCtx.resume(); } catch (e) {}
      return audioCtx;
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { audioCtx = new AC(); } catch (e) { return null; }
    return audioCtx;
  }
  // Exposed for readto-fab to resume before TTS (gesture expiry after long think)
  window.__askAudioCtx = getAudioCtx;
  window.__askAudioCtxState = function () { return audioCtx ? audioCtx.state : null; };
  // Reply-analyser accessor for the AI Tutor tab's orb — the narrator's reply
  // element is wired once by ensureReplyAnalyser (shared across readers), so
  // the tab reuses that node without creating a second MediaElementSource.
  window.__askReplyAnalyser = function () { return replyAnalyser || null; };

  function startMicAnalyser() {
    /* Touch UI: skip getUserMedia entirely. On iOS/Safari a live mic MediaStream
       fights webkitSpeechRecognition for the same input and the recognizer
       dies (works in chat because chat never grabs a MediaStream). The CSS
       keyframes (ask-halo/ask-ring/ask-breathe) carry the orb's visual
       reactivity instead. */
    if (isCoarsePointer) return;
    if (micAnalyser || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    var ctx = getAudioCtx();
    if (!ctx) return;
    var myMic = ++micGen;
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      .then(function (stream) {
        if (myMic !== micGen || !active || !audioCtx) {
          try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
          return;
        }
        micStream = stream;
        micAnalyser = ctx.createAnalyser();
        micAnalyser.fftSize = 256;
        ctx.createMediaStreamSource(stream).connect(micAnalyser);
      })
      .catch(function () { micAnalyser = null; });
  }

  function stopMicAnalyser() {
    micGen++;
    if (micStream) {
      try { micStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      micStream = null;
    }
    micAnalyser = null;
  }

  // Persistent listening is now in-modal only: after AI answers, we auto-return to listening.
  // Background barge-in while the orb is closed is disabled per product decision.
  function shouldPersistListen(){ return false; }
  function handleBargeIn(captured){}
  function startPersistentListener(){}
  function stopPersistentListener(){}
  function updatePersistentListener(){}

  /* One AnalyserNode on readto-fab's persistent replyAudio element — created
     once, keeps working across chunk src swaps and reconnects output.
     If AudioContext is suspended (gesture expiry), skip wiring so audio plays
     directly via the element instead of being muted through WebAudio. */
  function ensureReplyAnalyser() {
    if (replySrc) return;
    if (typeof window.srReplyAudioEl !== 'function') return;
    var el = window.srReplyAudioEl();
    if (!el || !el.src) return;
    var ctx = getAudioCtx();
    if (!ctx) return;
    // Don't hijack audio output while suspended — let element play directly
    if (ctx.state === 'suspended') {
      try { ctx.resume(); } catch (e) {}
      if (ctx.state === 'suspended') return;
    }
    try {
      replySrc = ctx.createMediaElementSource(el);
      replyAnalyser = ctx.createAnalyser();
      replyAnalyser.fftSize = 256;
      replySrc.connect(replyAnalyser);
      replyAnalyser.connect(ctx.destination);
    } catch (e) { replySrc = null; replyAnalyser = null; }
  }

  function rmsOf(buf) {
    var sum = 0;
    for (var i = 0; i < buf.length; i++) {
      var v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    return Math.min(1, Math.sqrt(sum / buf.length) * 3.2);
  }

  function tickEnergy() {
    energyRaf = requestAnimationFrame(tickEnergy);
    var target = 0;
    if (phase === 'listen' && micAnalyser) {
      var d1 = new Uint8Array(micAnalyser.frequencyBinCount);
      micAnalyser.getByteTimeDomainData(d1);
      target = rmsOf(d1);
    } else if (phase === 'speak' && replyAnalyser) {
      var d2 = new Uint8Array(replyAnalyser.frequencyBinCount);
      replyAnalyser.getByteTimeDomainData(d2);
      target = rmsOf(d2);
    }
    var rate = target > prevAmp ? 0.28 : 0.12;
    prevAmp += (target - prevAmp) * rate;
    var amp = (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      ? 0 : prevAmp;
    orb.style.setProperty('--ask-amp', amp.toFixed(3));
  }

  function startEnergy() {
    if (!energyRaf) energyRaf = requestAnimationFrame(tickEnergy);
    ensureReplyAnalyser();
  }

  function stopEnergy() {
    if (energyRaf) { cancelAnimationFrame(energyRaf); energyRaf = 0; }
    prevAmp = 0;
    orb.style.setProperty('--ask-amp', '0');
  }

  /* Tear the overlay down entirely and return the FAB to the bar. */
  function resetOverlay() {
    active = false;
    stopRecognition();
    clearWatchdog();
    stopEnergy();
    stopMicAnalyser();
    if (_postReplyTimer) { clearTimeout(_postReplyTimer); _postReplyTimer = null; }
    if (_voiceAbortCtrl) { try{ _voiceAbortCtrl.abort(); }catch(e){} _voiceAbortCtrl = null; }
    try{ if(askAudio){ askAudio.pause(); askAudio.onended=null; askAudio.onerror=null; } }catch(e){}
    try{ window.speechSynthesis && window.speechSynthesis.cancel(); }catch(e){}
    setPhaseUI(null, '', '');
    clearTranscript();
    overlay.hidden = true;
    syncFromMini();
    // resume persistent barge-in listening after a short gap
    setTimeout(function(){ try{ updatePersistentListener(); }catch(e){} }, 800);
  }

  /* If the pane is resized mid-session (AI pane drag/collapse, side-nav
     toggle), the bar re-centres via readto-fab.js — keep the FAB in step. */
  if (window.ResizeObserver) {
    var paneAnchor = document.getElementById('paneMain');
    if (paneAnchor) {
      var fabTick = null;
      new ResizeObserver(function () {
        if (fabTick) return;
        fabTick = requestAnimationFrame(function () {
          fabTick = null;
          positionFab();
          updateOverlayAnchor();
        });
      }).observe(paneAnchor);
    }
  }

  function openAiChatPane() {
    if (typeof window.toggleAiPane === 'function') window.toggleAiPane(true);
    var chatBtn = document.querySelector('.ai-tab-btn[data-tab-target="chat"]');
    if (chatBtn && typeof window.switchAiPaneTab === 'function') {
      window.switchAiPaneTab(chatBtn, 'chat');
    }
  }

  /* Speech unavailable / denied → drop into the chat pane, focused to type. */
  function openTypingFallback() {
    resetOverlay();
    openAiChatPane();
    var inp = document.getElementById('chatInput');
    if (inp) {
      requestAnimationFrame(function () { inp.focus({ preventScroll: true }); });
    }
  }

  var askAudio = null;
  var _postReplyTimer = null;
  var _voiceAbortCtrl = null;
  function getAskAudio() {
    if (askAudio) return askAudio;
    var el = document.getElementById('askReplyAudio');
    if (el) { askAudio = el; return el; }
    el = document.createElement('audio');
    el.id = 'askReplyAudio';
    el.preload = 'auto';
    el.style.display = 'none';
    document.body.appendChild(el);
    askAudio = el;
    return el;
  }

  var _askQueue = [];
  var _askPlaying = false;
  var _bargingIn = false;
  function _restartListening(){
    // after AI answers, automatically go back to listening within same overlay
    // — clear BOTH transcripts so only one speaker's words ever show at a time.
    clearCommitTimer();
    finalTranscript = '';
    interimTranscript = '';
    voiceText = '';
    clearTranscript();
    setPhaseUI('listen', 'is-listening', 'Listening…');
    if (overlay) overlay.hidden = false;
    if (fab) fab.hidden = true;
    startEnergy();
    startMicAnalyser();
    touchRearmCount = 0;
    // restart speech recognition fresh
    try{ if (recognition){ try{ recognition.stop(); }catch(e){} recognition=null; } }catch(e){}
    startRecognition();
  }
  function _finishSpeakingHold(){
    // auto-return to listening instead of waiting for tap
    _restartListening();
  }
  function _playNextAskChunk(){
    if (_askPlaying || !_askQueue.length) return;
    _askPlaying = true;
    var item = _askQueue.shift();
    try {
      var aEl = getAskAudio();
      var binary = atob(item.b64);
      var bytes = new Uint8Array(binary.length);
      for (var i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);
      var mime = (bytes[0]===0x52 && bytes[1]===0x49) ? 'audio/wav' : 'audio/mpeg';
      var blob = new Blob([bytes], {type:mime});
      var url = URL.createObjectURL(blob);
      function _onChunkEnd(){
        try{ URL.revokeObjectURL(url);}catch(e){}
        aEl.onended=null; aEl.onerror=null;
        _askPlaying=false;
        if (_askQueue.length) _playNextAskChunk();
        else _finishSpeakingHold();
      }
      aEl.onended=_onChunkEnd; aEl.onerror=_onChunkEnd;
      aEl.src=url; aEl.load();
      // Streamed voice replies match the narrator's chosen playback speed.
      var _rate = (window.srNarrationSpeed && window.srNarrationSpeed()) || 1;
      try{ aEl.playbackRate = _rate; }catch(e){}
      setPhaseUI('speak', 'is-speaking', 'Speaking…');
      try{ ensureReplyAnalyser(); }catch(e){}
      var p=aEl.play(); if(p&&p.then) p.catch(function(){ _onChunkEnd(); });
    } catch(e){ _askPlaying=false; if(_askQueue.length) _playNextAskChunk(); else _finishSpeakingHold(); }
  }
  function _playVoiceReply(reply, audio_b64) {
    if (replyText) replyText.textContent = reply || '';
    if (replyMsg) replyMsg.hidden = !reply;
    // single-transcript rule: the AI's words replace the user's on screen
    if (userMsgText) userMsgText.textContent = '';
    if (userMsg) userMsg.hidden = true;
    if (!audio_b64) {
      if (window.speechSynthesis) {
        try {
          var utt = new SpeechSynthesisUtterance(reply);
          utt.rate = 0.95;
          utt.onend = function(){ _restartListening(); };
          utt.onerror = function(){ _restartListening(); };
          setPhaseUI('speak', 'is-speaking', 'Speaking…');
          window.speechSynthesis.speak(utt);
          return;
        } catch(e) {}
      }
      setPhaseUI('speak', 'is-speaking', 'Tap to close');
      // even without audio, auto-return to listening after a beat so conversation continues
      setTimeout(_restartListening, 1800);
      return;
    }
    _askQueue = [{b64: audio_b64}];
    _askPlaying = false;
    _playNextAskChunk();
  }
  function _bargeIn(){
    // user cut the AI off — stop reasoning + audio instantly, drop back to listening
    voiceGen++;
    _bargingIn = true;
    if (_voiceAbortCtrl) { try{ _voiceAbortCtrl.abort(); }catch(e){} _voiceAbortCtrl = null; }
    if (_postReplyTimer) { clearTimeout(_postReplyTimer); _postReplyTimer = null; }
    clearWatchdog();
    _askQueue = [];
    _askPlaying = false;
    try{ if(askAudio){ askAudio.pause(); try{ askAudio.onended=null; askAudio.onerror=null; }catch(e){} askAudio.src=''; } }catch(e){}
    try{ window.speechSynthesis && window.speechSynthesis.cancel(); }catch(e){}
    _restartListening();
  }

  function commitQuestion(q) {
    stopRecognition();
    active = true;
    _bargingIn = false;
    if (!q) { resetOverlay(); return; }
    if (userMsgText) userMsgText.textContent = q;
    if (userMsg) userMsg.hidden = false;
    setPhaseUI('think', 'is-thinking', 'Thinking…');
    if (overlay) { overlay.hidden = false; updateOverlayAnchor(); }
    if (fab) fab.hidden = true;
    clearWatchdog();
    if (_postReplyTimer) { clearTimeout(_postReplyTimer); _postReplyTimer = null; }
    if (_voiceAbortCtrl) { try{ _voiceAbortCtrl.abort(); }catch(e){} _voiceAbortCtrl = null; }
    voiceGen++;
    // interrupt-style: single POST, no chat streaming
    var ctx = '';
    try {
      if (window._history && window._history.length) {
        var last = window._history.slice(-6);
        ctx = last.map(function(h){ return (h.role||'')+': '+(h.content||'').slice(0,300); }).join('\n').slice(-2000);
      }
    } catch(e) {}
    // current study section — lets the voice AI tailor its answer
    var sectionCtx = '';
    try {
      if (window._chatContext && typeof window._chatContext === 'string') {
        sectionCtx = window._chatContext.slice(-700);
      }
    } catch(e) {}
    _voiceAbortCtrl = new AbortController();
    var abortTimer = setTimeout(function(){ try{ _voiceAbortCtrl.abort(); }catch(e){} }, 25000);
    // also watchdog for total voice round-trip — keep open, user must tap
    watchdogTimer = setTimeout(function(){
      watchdogTimer=null;
      clearTimeout(abortTimer);
      showToast('Voice reply is taking a while — please try again.');
      setPhaseUI(null, 'is-error', 'Tap to close');
    }, WATCHDOG_MS);
    var packId = (typeof PACK_ID !== 'undefined' ? PACK_ID : (window.PACK_ID || window.__PACK_ID__ || null));
    // streaming voice: first audio <700ms, gapless queue
    _askQueue = []; _askPlaying = false;
    if (replyText) replyText.textContent = '';
    if (replyMsg) replyMsg.hidden = true;
    var fullReply = '';
    var streamFailed = false;
    var gotAudio = false;
    var historyPushed = false;
    fetch('/api/voice/ask-stream', {
      method: 'POST',
      signal: _voiceAbortCtrl.signal,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCSRF() },
      body: JSON.stringify({ question: q, pack_id: packId, context: ctx, section_context: sectionCtx, history: (window._history||[]).slice(-6) })
    }).then(function(r){
      clearTimeout(abortTimer);
      if (!r.ok) {
        return r.json().then(function(j){ throw {status:r.status, body:j}; });
      }
      var ct = (r.headers.get('Content-Type')||'');
      if (ct.indexOf('text/event-stream') === -1) {
        return r.json().then(function(j){ _playVoiceReply((j.reply||'').trim()||'No reply', j.audio_b64); fullReply=j.reply||''; throw 'done_json'; });
      }
      var reader = r.body.getReader();
      var decoder = new TextDecoder();
      var buf = '';
      function pump(){
        return reader.read().then(function(res){
          if (res.done){
            if (fullReply && !replyText.textContent) { if(replyText) replyText.textContent=fullReply; if(replyMsg) replyMsg.hidden=false; }
            if (!gotAudio && !_askQueue.length && !_askPlaying) {
              if (fullReply) {
                // no audio arrived — fallback speechSynthesis (holds until tap)
                if (!fullReply.trim()) fullReply="I could not get a response.";
                if (replyText) replyText.textContent=fullReply;
                if (replyMsg) replyMsg.hidden=false;
                if (userMsgText) userMsgText.textContent='';
                if (userMsg) userMsg.hidden=true;
                _playVoiceReply(fullReply, null);
              } else { setPhaseUI(null, 'is-error', 'No reply — tap to close'); }
            } else if (fullReply) {
              // audio already streamed — queue is draining and will auto-return to
              // listening via _finishSpeakingHold; only record history once.
              try{ if(window._history && !historyPushed){ historyPushed = true; window._history.push({role:'user', content:q},{role:'assistant', content:fullReply}); } }catch(e){}
            }
            clearWatchdog();
            return;
          }
          buf += decoder.decode(res.value, {stream:true});
          var parts = buf.split('\n\n'); buf = parts.pop()||'';
          for (var i=0;i<parts.length;i++){
            var line = parts[i].trim();
            if (!line || line.indexOf('data: ')!==0) continue;
            try{
              var evt = JSON.parse(line.slice(6));
              if (evt.type==='audio' && evt.audio_b64){
                gotAudio = true;
                fullReply += (evt.text||'') + ' ';
                if (replyText) replyText.textContent = (replyText.textContent||'') + (evt.text||'') + ' ';
                if (replyMsg) replyMsg.hidden=false;
                if (userMsgText) userMsgText.textContent = '';
                if (userMsg) userMsg.hidden=true;
                _askQueue.push({b64: evt.audio_b64});
                // instant visual: first audio → speaking
                if (!_askPlaying) _playNextAskChunk();
                clearWatchdog();
              } else if (evt.type==='done'){
                fullReply = (evt.reply||fullReply).trim();
                if (replyText) replyText.textContent = fullReply;
                if (replyMsg) replyMsg.hidden=!fullReply;
                if (userMsgText) userMsgText.textContent = '';
                if (userMsg) userMsg.hidden=true;
                try{ if(window._history && !historyPushed){ historyPushed = true; window._history.push({role:'user', content:q},{role:'assistant', content:fullReply}); } }catch(e){}
                watchdogTimer && clearWatchdog();
              }
            }catch(e){}
          }
          return pump();
        });
      }
      return pump();
    }).catch(function(err){
      clearTimeout(abortTimer);
      if (err==='done_json'){ try{ if(window._history && fullReply) window._history.push({role:'user', content:q},{role:'assistant', content:fullReply}); }catch(e){} return; }
      if (!active) return;
      if (_bargingIn) { _bargingIn = false; clearWatchdog(); return; }
      // fallback to non-stream endpoint once
      if (!streamFailed && err && err.status){
        streamFailed=true;
        return fetch('/api/voice/ask', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCSRF() },
          body: JSON.stringify({ question: q, pack_id: packId, context: ctx, section_context: sectionCtx, history: (window._history||[]).slice(-6) })
        }).then(function(r2){ return r2.json().then(function(j){ return {status:r2.status, body:j}; }); })
        .then(function(res2){
          clearWatchdog();
          var data=res2.body||{};
          if(res2.status>=400){ showToast(data.error||'Voice reply failed.'); setPhaseUI(null, 'is-error', 'Tap to close'); return; }
          var reply=(data.reply||'').trim()||'No reply';
          _playVoiceReply(reply, data.audio_b64);
          try{ if(window._history) window._history.push({role:'user', content:q},{role:'assistant', content:reply}); }catch(e){}
        }).catch(function(e2){ clearWatchdog(); showToast('Voice reply failed.'); setPhaseUI(null, 'is-error', 'Tap to close'); });
        return;
      }
      clearWatchdog();
      var isAbort = err && err.name === 'AbortError';
      showToast(isAbort ? 'Voice reply timed out — please try again.' : 'Voice reply failed — please try again.');
      setPhaseUI(null, 'is-error', 'Tap to close');
    });
  }

  /* The narrated reply is now audible — keep focus on voice, not text.
     The orb shifts to speaking and is driven by --ask-amp. */
  function onNarrationStart() {
    if (!active || (phase !== 'think' && phase !== 'speak')) return;
    ensureReplyAnalyser();
    clearWatchdog();
    setPhaseUI('speak', 'is-speaking', 'Speaking…');
  }

  /* Reply finished — keep open until user taps (legacy readto path). */
  function onNarrationEnd() {
    if (!active || phase !== 'speak') return;
    voiceGen++;
    setPhaseUI('speak', 'is-speaking', 'Tap to close');
  }

  function startRecognition() {
    if (!SpeechRecognition) {
      showToast('Voice input is not supported in this browser — you can type your question instead.');
      openTypingFallback();
      return;
    }
    var myGen = ++recognitionGen;
    var rec = new SpeechRecognition();
    recognition = rec;
    rec.lang = 'en-US';
    rec.interimResults = true;
    /* Continuous mode only on non-touch: mobile/Safari stops the recognizer
       after one utterance and restarts it at the end of every sentence,
       which loses pauses between clauses. The proven chat mic uses
       continuous=false everywhere and just re-arms per utterance. */
    rec.continuous = !isCoarsePointer;
    rec.maxAlternatives = 1;

    rec.onresult = function (e) {
      if (recognition !== rec || recognitionGen !== myGen) return;
      if (phase !== 'listen') return;
      var interim = '';
      for (var i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalTranscript += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      interimTranscript = interim;
      var shown = (finalTranscript + ' ' + interim).trim();
      if (userMsgText) userMsgText.textContent = shown;
      if (userMsg) userMsg.hidden = !shown;
      if (hintEl) hintEl.textContent = 'Listening…';
      /* Re-arm the grace countdown on EVERY recognizer event, repeats
         included. Chrome re-fires the same interim while the user pauses
         between clauses — a single event proves the recognizer is still
         live, so we reset the window instead of letting the old countdown
         commit a half-finished thought. */
      if (shown) armSpeechCommit();
    };

    rec.onstart = function () {
      if (recognition !== rec || recognitionGen !== myGen) return;
      if (phase !== 'listen' && phase !== null) return;
      setOrbState('is-listening');
      if (hintEl) hintEl.textContent = 'Listening…';
    };

    rec.onend = function () {
      if (recognition !== rec || recognitionGen !== myGen) return;
      if (!active) return;
      /* The recognizer ended on its own — never commit from here, that's the
         stable-transcript timer's job. Keep the session alive: a queued
         commit will fire if the words were stable, otherwise a fresh
         recognizer takes over so the user can keep talking. */
      if (phase === 'listen') rearmRecognition();
    };

    rec.onerror = function (e) {
      if (recognition !== rec || recognitionGen !== myGen) return;
      if (!active) return;
      var err = e && e.error;
      if (err === 'aborted') return;                  /* user cancelled via UI */
      if (err === 'no-speech' || err === 'network') {
        // Browser heard silence / a blip — persist for the user to speak,
        // never dismiss. The grace commit handles any words already heard.
        rearmRecognition();
      } else if (err === 'not-allowed' || err === 'service-not-allowed') {
        showToast('Microphone access is blocked. Allow the mic to ask by voice — or just type below.');
        openTypingFallback();
      } else {
        resetOverlay();
        showToast('I could not hear you clearly — type your question in the AI chat instead.');
        openTypingFallback();
      }
    };

    try { rec.start(); } catch (e) {
      // start() racing a previous recognizer teardown — retry shortly.
      setTimeout(function () {
        if (active && phase === 'listen' && recognition === rec && recognitionGen === myGen) {
          try { rec.start(); } catch (e2) {}
        }
      }, 400);
    }
  }

  function openListening() {
    if (active) return;
    active = true;
    fab.hidden = true;
    clearCommitTimer();
    finalTranscript = '';
    interimTranscript = '';
    voiceText = '';
    clearTranscript();
    setPhaseUI('listen', 'is-listening', 'Listening…');
    overlay.hidden = false;
    updateOverlayAnchor();
    startEnergy();
    startMicAnalyser();
    touchRearmCount = 0;
    // unlock audio for subsequent TTS (browsers block play() without gesture)
    try {
      var aCtx = getAudioCtx();
      if (aCtx && aCtx.state === 'suspended') aCtx.resume();
      var rEl = (typeof window.srReplyAudioEl === 'function') ? window.srReplyAudioEl() : null;
      if (rEl) {
        /* A play() on an <audio> with no src never actually plays anything,
           so it doesn't register as a real gesture-backed playback and the
           "unlock" was a no-op — real narration minutes later still got
           autoplay-blocked. Give it one real (silent) sample to play first. */
        if (!rEl.src) rEl.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
        rEl.muted = true;
        var p = rEl.play();
        if (p && p.then) p.then(function(){ try{ rEl.pause(); rEl.currentTime = 0; rEl.muted=false; }catch(e){} }).catch(function(){});
      }
    } catch(e) {}
    startRecognition();
  }

  fab.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    openListening();
  });

  overlay.addEventListener('click', function (e) {
    e.stopPropagation();
    if (phase === 'listen') {
      var q = (finalTranscript + ' ' + interimTranscript).trim();
      if (q) {
        finalTranscript = '';
        interimTranscript = '';
        commitQuestion(q);
      } else {
        stopRecognition();
        resetOverlay();
      }
      return;
    }
    if (phase === 'think' || phase === 'speak') {
      _bargeIn();
      return;
    }
    resetOverlay();
  });

  document.addEventListener('sr:narration-start', onNarrationStart);
  document.addEventListener('sr:narration-end', onNarrationEnd);
  document.addEventListener('sr:narration-error', function () {
    if (!active) return;
    clearWatchdog();
    setPhaseUI(null, 'is-error', 'Audio blocked — tap to close');
  });

  // ── Tab scoping: narration is Study-Guide-only ─────────────────────
  document.addEventListener('sr:tab-switched-away', function () {
    // close voice overlay if open, abort in-flight voice, but keep session
    if (active) resetOverlay();
    else {
      // ensure fab stays hidden (mini is already hidden by tab-switcher)
      setFabVisible(false);
    }
  });
  document.addEventListener('sr:tab-return-guided', function () {
    syncFromMini();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !overlay.hidden) resetOverlay();
  });

  /* ── Voice-mode hooks (consumed by chat-engine.js voice mode) ────────
     Backwards-compatible shim — production path now goes through the shared
     study-guide narrator (window.srNarrateText → POST /api/readto/speak →
     srSpeakChunk on the same replyAudio element), so this reuses that
     machinery instead of duplicating synthesis per segment. */
  window.srNarrateVoiceSegment = function (seg) {
    if (!active || (phase !== 'think' && phase !== 'speak')) return false;
    var text = String(seg || '').trim();
    if (!text || typeof window.srNarrateText !== 'function') return false;
    voiceText += (voiceText ? ' ' : '') + text;
    try { return window.srNarrateText(text, true); } catch (e) { return false; }
  };

  window.srVoiceEnded = function () {
    if (!active) return;
    voiceGen++;
    stopRecognition();
    resetOverlay();
  };

  window.srVoiceAbort = function () {
    if (!active) return;
    voiceGen++;
    stopRecognition();
    resetOverlay();
  };

  /* readto-fab.js fires this right before each reply chunk starts playing, so
      the orb's AnalyserNode is guaranteed a valid element src to tap. */
  window.__srBeforeReplyPlay = function () {
    ensureReplyAnalyser();
  };
  window.__testVoiceAsk = commitQuestion;
  window.__testVoiceState = function(){ return {phase: phase, active: active, overlayHidden: overlay.hidden}; };
})();