  (function () {
  'use strict';

  var tabContentCache = new Map();
  var activeTabId = null;

  // AI Tutor tab: the orb's "speaking" pulse reads the energy of the reply
  // audio. The tab plays through its own #tvReplyAudio element (not the FAB's
  // reply element), so we wire THAT element to a shared-Analyser once and read
  // it in _tvAmpTick. createMediaElementSource can only be called once per
  // element, hence the module-level guard (the element persists across tabs).
  var _tvReplyWired = false;
  var _tvReplyAnalyser = null;

  // Compatibility shim — legacy callers used a suffix-based overlay system.
  // The new system is per-pane and lives in sr-spinner.js. This shim
  // translates the old suffix-based call into the new pane-id-based one so
  // we can migrate incrementally without breaking any straggler call sites.
  var _SUFFIX_TO_PANE = {
    'video': 'tab-video', 'notes': 'tab-notes',
    'flashcards': 'tab-flashcards', 'quiz': 'tab-quiz',
    'more': 'tab-more', 'voice': 'tab-voice', 'upload': 'tab-upload',
  };
  function _dismissOverlay(suffix) {
    var paneId = _SUFFIX_TO_PANE[suffix];
    if (paneId && window.SrSpinner) window.SrSpinner.hide(paneId);
  }
  window._dismissRoomOverlay = _dismissOverlay;

  // True when a background generation job for `type` (flashcards/quiz/fill_in)
  // is already running server-side, so an auto-start on tab open won't double-fire.
  function _srResourceInFlight(type) {
    var s = window.FC_RESOURCE_STATUS || {};
    var prefix = type + ':group:';
    return Object.keys(s).some(function (k) {
      return k.indexOf(prefix) === 0 && (s[k] === 'pending' || s[k] === 'generating');
    });
  }

  // True when a student may auto-start generation for `resource`
  // ('flashcards' | 'quiz' | 'fill_in') without pressing a button: either they
  // hold credits, or their plan still has daily allowance for that resource.
  // Mirrors the eligibility check used by the "+ more" appenders
  // (quiz-engine.js `_qzAppendMore`) so auto-start and manual retry agree.
  function _srGenEligible(resource) {
    if ((window.USER_CREDITS || 0) > 0) return true;
    var limits = window.USER_LIMITS || {};
    var daily = window.USER_DAILY || {};
    var key = resource === 'fill_in' ? 'fillin' : resource;
    var cap = limits[key + '_per_day'] || 0;
    var used = daily[key] || 0;
    return cap > 0 && (cap - used) > 0;
  }

  function _pollResource(packId, resourceType, callbacks) {
    var delay = 2000;
    var maxDur = 180000;
    var start = Date.now();
    var timer;
    var cancelled = false;

    function scheduleNext() {
      if (cancelled) return;
      if (Date.now() - start >= maxDur) {
        if (typeof window.showFatalErrorModal === 'function') {
          window.showFatalErrorModal('This is taking longer than expected. Please try again.');
        }
        return;
      }
      delay = Math.min(delay * 1.5, 8000);
      timer = setTimeout(tick, delay);
    }

    function tick() {
      fetch('/library/pack/' + packId + '/resource-status')
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (cancelled) return;
          var statuses = data.statuses || {};
          var typeKeys = Object.keys(statuses).filter(function (k) {
            return k.startsWith(resourceType + ':group:');
          });
          if (typeKeys.length === 0) {
            if (callbacks.onEmpty) callbacks.onEmpty();
            return;
          }
          var doneKey = typeKeys.find(function (k) { return statuses[k] === 'done'; });
          if (doneKey) {
            // Fetch persisted content once the status reads 'done'. If this
            // fetch fails or comes back without ok (a transient blip, a 5xx,
            // a half-written row), keep polling instead of stopping — a
            // single failed content fetch used to strand the tab on its empty
            // state forever even though the items existed on the server.
            fetch('/library/pack/' + packId + '/resource-content?type=' + resourceType + '&group=0')
              .then(function (r) { return r.json(); })
              .then(function (cd) {
                if (cancelled) return;
                if (!cd || !cd.ok) { scheduleNext(); return; }
                if (callbacks.onData) callbacks.onData(cd);
              })
              .catch(function () { scheduleNext(); });
            return;
          }
          var failKey = typeKeys.find(function (k) { return statuses[k] === 'failed'; });
          if (failKey) {
            if (callbacks.onFail) callbacks.onFail(statuses[failKey + '_error'] || 'Generation failed');
            return;
          }
          scheduleNext();
        })
        .catch(function () { scheduleNext(); });
    }
    tick();
    return { cancel: function () { cancelled = true; clearTimeout(timer); } };
  }
  window._pollResource = _pollResource;

  function getTemplateHtml(tabId) {
    var tpl = document.getElementById('tpl-' + tabId);
    if (!tpl) return null;
    return tpl.innerHTML;
  }

  // ── Background video-discovery helpers ──

  function _escapeHtml(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  function _iframeHtml(youtubeId) {
    return '<iframe src="https://www.youtube.com/embed/' + youtubeId +
      '?rel=0&modestbranding=1&enablejsapi=1" frameborder="0" allowfullscreen ' +
      'allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" ' +
      'style="width:100%;height:100%;position:absolute;inset:0;"></iframe>';
  }

  window._seekVideo = function(seconds) {
    var iframes = [
      document.getElementById('mainVideoIframe'),
      document.querySelector('#vtPlayerWrap iframe'),
      document.querySelector('#tab-video iframe')
    ];
    for (var i = 0; i < iframes.length; i++) {
      var f = iframes[i];
      if (f && f.contentWindow) {
        f.contentWindow.postMessage(JSON.stringify({event:'command',func:'seekTo',args:[seconds,true]}), '*');
        break;
      }
    }
  };

  function _buildVideoTab(videos) {
    var pane = document.getElementById('tab-video');
    if (!pane || !videos || !videos.length) return;

    var first = videos[0];
    var count = videos.length;
    var isSingle = count <= 1;

    // ── Main structure ──
    var html = '<div class="vt-shell">';

    // Player wrap
    html += '<div class="vt-player-wrap" id="vtPlayerWrap">';
    html += '<div class="vt-iframe-ratio">';
    html += '<div id="videoWrap">' + _iframeHtml(first.youtube_id) + '</div>';

    // Overlay — only if >1 video
    if (!isSingle) {
      html += '<div class="vt-overlay" id="vtOverlay" aria-hidden="true">';
      html += '<div class="vt-overlay-group"><button class="vt-overlay-btn vt-overlay-prev" onclick="navigatePlaylist(-1)" aria-label="Previous video">';
      html += '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>';
      html += '</button><span class="vt-overlay-label">Prev</span></div>';
      html += '<div class="vt-overlay-group"><button class="vt-overlay-btn vt-overlay-next" onclick="navigatePlaylist(1)" aria-label="Next video">';
      html += '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';
      html += '</button><span class="vt-overlay-label">Next</span></div></div>';
    }

    html += '</div>'; // .vt-iframe-ratio
    html += '<div class="vt-title" id="vtTitle">' + _escapeHtml(first.title) + '</div>';

    // Mobile nav — only if >1 video
    if (!isSingle) {
      html += '<div class="vt-mobile-nav" id="vtMobileNav">';
      html += '<button class="vt-mobile-nav-btn" onclick="navigatePlaylist(-1)" aria-label="Previous video" type="button">';
      html += '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>';
      html += '</button>';
      html += '<span class="vt-mobile-nav-count" id="vtNavCount">1 of ' + count + '</span>';
      html += '<button class="vt-mobile-nav-btn" onclick="navigatePlaylist(1)" aria-label="Next video" type="button">';
      html += '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';
      html += '</button></div>';
    }

    html += '</div>'; // .vt-player-wrap

    // ── Transcript section ──
    html += '<div class="vt-transcript-section" id="vtTranscriptSection">';
    html += '<div class="vt-transcript-header">';
    html += '<h4 class="vt-transcript-label">Transcript</h4>';
    html += '<div class="vt-transcript-actions">';

    // Copy button
    html += '<button class="vt-action-btn" id="vtCopyBtn" aria-label="Copy transcript" onclick="(function(){';
    html += "var b=document.getElementById('vtTranscriptBody');if(!b)return;var t=b.innerText||b.textContent||'';";
    html += "navigator.clipboard.writeText(t).then(function(){var btn=document.getElementById('vtCopyBtn');if(!btn)return;";
    html += "var i=btn.querySelector('svg');if(i)i.style.color='var(--sr-green)';";
    html += "setTimeout(function(){if(i)i.style.color='';},1800);}).catch(function(){})})()\">";
    html += '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="vt-btn-icon">';
    html += '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg></button>';

    // Hide / Show toggle
    html += '<button class="vt-action-btn vt-toggle-btn" id="vtToggleBtn" onclick="(function(){';
    html += "var w=document.getElementById('vtPlayerWrap'),b=document.getElementById('vtToggleBtn'),c=document.getElementById('vtChevron');";
    html += "if(!w||!b)return;var h=w.getAttribute('data-hidden')==='1';";
    html += "if(h){w.style.display='';w.removeAttribute('data-hidden');b.querySelector('.vt-toggle-label').textContent='Hide video';if(c)c.style.transform='';}";
    html += "else{w.style.display='none';w.setAttribute('data-hidden','1');b.querySelector('.vt-toggle-label').textContent='Show video';if(c)c.style.transform='rotate(180deg)';}";
    html += "})()\">";
    html += '<span class="vt-toggle-label">Hide video</span>';
    html += '<svg id="vtChevron" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="vt-btn-icon" style="transition:transform 0.2s ease;">';
    html += '<path d="m18 15-6-6-6 6"></path></svg></button>';

    html += '</div></div>'; // .vt-transcript-header

    // Scrollable transcript body
    html += '<div class="vt-transcript-scroll custom-scrollbar" id="vtTranscriptScroll">';

    var transcript = first.transcript_text || '';
    if (transcript) {
      html += '<div class="vt-transcript-inner"><div class="vt-transcript-segments" id="vtTranscriptBody">';
      var words = transcript.split(/\s+/);
      var segmentSize = 60;
      for (var i = 0; i < words.length; i += segmentSize) {
        var chunk = words.slice(i, i + segmentSize).join(' ');
        var seconds = Math.floor(i / segmentSize) * 45;
        var minutes = Math.floor(seconds / 60);
        var secs = seconds % 60;
        var tsLabel = minutes + ':' + (secs < 10 ? '0' : '') + secs;
        html += '<button class="vt-segment-btn" data-seconds="' + seconds + '" onclick="window._seekVideo(' + seconds + ')">';
        html += '<div class="vt-segment-inner">';
        html += '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="vt-segment-icon">';
        html += '<circle cx="12" cy="12" r="10"></circle><polygon points="10 8 16 12 10 16 10 8"></polygon></svg>';
        html += '<div class="vt-segment-body"><div class="vt-segment-ts">' + tsLabel + '</div>';
        html += '<p class="vt-segment-text">' + _escapeHtml(chunk) + '</p></div>';
        html += '</div></button>';
      }
      html += '</div></div>';
    } else {
      html += '<div class="vt-transcript-empty">Transcript is not available for this lesson yet.</div>';
    }

    html += '</div></div></div>'; // end transcript section + vt-shell

    // ── Hidden playlist ──
    html += '<ol id="vtPlaylist" style="display:none" aria-hidden="true">';
    for (var i = 0; i < videos.length; i++) {
      var v = videos[i];
      html += '<li data-video-id="' + v.id + '"';
      html += ' data-embed-url="' + _escapeHtml(v.embed_url) + '"';
      html += ' data-title="' + _escapeHtml(v.title) + '"';
      html += ' data-duration="' + (v.duration_seconds || '') + '"';
      if (i === 0) html += ' data-active="1"';
      html += '></li>';
    }
    html += '</ol>';

    pane.innerHTML = html;
    pane.setAttribute('data-lazy-mounted', 'true');

    // Wire up the video overlay (prev/next buttons, postMessage listener)
    if (typeof initVideoOverlay === 'function') initVideoOverlay();
  }

  function _fetchAndBuildVideoTab(packId) {
    fetch('/library/pack/' + packId + '/videos-data', { credentials: 'same-origin' })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.ready && data.videos && data.videos.length) {
          _buildVideoTab(data.videos);
          // Show notification banner — only if user isn't already on the video tab
          var isOnVideoTab = document.getElementById('tab-video') &&
            document.getElementById('tab-video').classList.contains('room-vp--active');
          if (!isOnVideoTab) {
            _showVideoBanner();
          }
        } else {
          _hideVideoBanner();
        }
      })
      .catch(function() {
        if (typeof window.showFatalErrorModal === 'function') {
          window.showFatalErrorModal('Failed to load videos. Please try again.', function () {
            _fetchAndBuildVideoTab(packId);
          });
        }
      });
  }

  function _showVideoBanner() {
    var banner = document.getElementById('vtDiscoveryBanner');
    if (banner) banner.style.display = '';
  }

  function _hideVideoBanner() {
    var banner = document.getElementById('vtDiscoveryBanner');
    if (banner) banner.style.display = 'none';
  }

  // ── Shared video-poll guard ──
  // Prevents _startVideoWatcher and the tab-video mount polling from running
  // simultaneously (which doubled request rate).
  var _videoPollActive = false;

  // ── Background video-discovery watcher ──
  // Starts polling immediately on page load (not tied to video-tab mount).
  // When videos are found, builds the tab DOM and shows a notification banner.
  function _startVideoWatcher(packId) {
    if (!packId || _videoPollActive) return;
    _videoPollActive = true;
    var POLL_MS = 10000;
    var MAX_MS = 180000;
    var pollStart = Date.now();
    var pollTimer = null;
    var done = false;

    function _stop() { done = true; _videoPollActive = false; if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; } }

    function _tick() {
      if (done) return;
      fetch('/library/pack/' + packId + '/video-count', { credentials: 'same-origin' })
        .then(function(r) { return r.json(); })
        .then(function(j) {
          if (done || !j) return;
          var s = j.video_status;
          var count = j.video_count || 0;
          if (count > 0 || s === 'done' || s === 'complete') {
            _stop();
            _fetchAndBuildVideoTab(packId);
            return;
          }
          if (s === 'failed' || s === 'no_results') { _stop(); return; }
          if (j.ingest_status === 'abandoned') { _stop(); return; }
          _scheduleNext();
        })
        .catch(function() { _scheduleNext(); });
    }

    function _scheduleNext() {
      if (done) return;
      if (Date.now() - pollStart >= MAX_MS) { _stop(); return; }
      pollTimer = setTimeout(_tick, POLL_MS);
    }

    pollTimer = setTimeout(_tick, 1000);
  }

  function mountTab(tabId) {
    var pane = document.getElementById(tabId);
    if (!pane) return;
    if (pane.getAttribute('data-lazy-mounted') === 'true') return;

    var html = tabContentCache.has(tabId)
      ? tabContentCache.get(tabId)
      : getTemplateHtml(tabId);

    if (html !== null && html !== undefined) {
      pane.innerHTML = html;
    }

    // Defensive: strip any spinner or generation overlay nodes left over
    // from a cached snapshot before reusing this pane.
    pane.querySelectorAll('.sr-mount-spinner, .sr-append-overlay').forEach(function (o) {
        if (o.parentNode) o.parentNode.removeChild(o);
    });

    // Re-show the append-generation overlay if a generation is still pending
    // for this tab (e.g. the student switched away mid-generation). The
    // overlay registry lives in sr-append-overlay.js and survives unmount.
    if (window.SrAppendOverlay && window.SrAppendOverlay.isPending(tabId)) {
      var _pending = window.SrAppendOverlay.pendingInfo(tabId) || {};
      window.SrAppendOverlay.show(tabId, _pending);
    }

    pane.setAttribute('data-lazy-mounted', 'true');

    // Run init on every mount — restores state + re-wires listeners
    // on the fresh DOM nodes restored from cache
    switch (tabId) {
      case 'tab-video':
        // Poll video discovery status and update the placeholder UI
        // Skip if _startVideoWatcher is already polling (prevents double-rate requests)
        ;(function() {
          var placeholder = document.getElementById('vtPlaceholder');
          var placeholderText = document.getElementById('vtPlaceholderText');
          var placeholderIcon = placeholder ? placeholder.querySelector('i') : null;
          if (!placeholderText || document.querySelector('#tab-video iframe')) return;
          var packId = typeof PACK_ID !== 'undefined' ? PACK_ID : (
            typeof window.PACK_ID !== 'undefined' ? window.PACK_ID : null
          );
          if (!packId) return;
          if (_videoPollActive) return;

          var POLL_MS = 10000;
          var MAX_MS = 180000;
          var pollStart = Date.now();
          var pollTimer = null;

          function _stopPoll() {
            if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
          }

          function _showPending() {
            if (placeholderIcon) {
              placeholderIcon.className = 'fa-solid fa-spinner fa-spin';
              placeholderIcon.style.color = '';
            }
            placeholderText.textContent = 'Finding the best videos\u2026';
            _removeRetryBtn();
          }

          function _showFailed(status, ingestError) {
            _stopPoll();
            if (placeholderIcon) {
              placeholderIcon.className = 'fa-solid fa-exclamation-triangle';
              placeholderIcon.style.color = 'var(--sr-warning, #f59e0b)';
            }
            if (ingestError) {
              placeholderText.textContent = ingestError;
            } else {
              placeholderText.textContent = status === 'no_results'
                ? 'No suitable videos were found for this topic.'
                : 'Couldn\u2019t find relevant videos.';
            }
            _addRetryBtn();
          }

          function _removeRetryBtn() {
            var old = document.getElementById('vtRetryBtn');
            if (old && old.parentNode) old.parentNode.removeChild(old);
          }

          function _addRetryBtn() {
            if (document.getElementById('vtRetryBtn')) return;
            var btn = document.createElement('button');
            btn.id = 'vtRetryBtn';
            btn.textContent = 'Retry video search';
            btn.style.cssText = 'margin-top:12px;padding:8px 20px;border-radius:8px;border:1px solid var(--sr-border,rgba(255,255,255,0.15));background:transparent;color:var(--sr-light);cursor:pointer;font-size:0.85rem;';
            btn.onclick = function() {
              btn.disabled = true;
              btn.textContent = 'Retrying\u2026';
              var csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
              fetch('/library/pack/' + packId + '/retry-videos', {
                method: 'POST',
                headers: { 'X-CSRFToken': csrf },
              })
                .then(function(r) { return r.json(); })
                .then(function(d) {
                  if (d.status === 'ok') { window.location.reload(); }
                  else { btn.disabled = false; btn.textContent = 'Try again'; }
                })
                .catch(function() { btn.disabled = false; btn.textContent = 'Try again'; });
            };
            var wrap = placeholder && placeholder.parentNode;
            if (wrap) wrap.appendChild(btn);
          }

          function _tick() {
            fetch('/library/pack/' + packId + '/video-count', { credentials: 'same-origin' })
              .then(function(r) { return r.json(); })
              .then(function(j) {
                if (!j) { _scheduleNext(); return; }
                var s = j.video_status;
                var count = j.video_count || 0;
                if (count > 0 || s === 'done' || s === 'complete') {
                  _stopPoll();
                  _fetchAndBuildVideoTab(packId);
                  return;
                }
                if (s === 'failed' || s === 'no_results') { _showFailed(s, j.ingest_error); return; }
                if (j.ingest_status === 'abandoned') { _showFailed('no_results', j.ingest_error); return; }
                if (s === 'pending' || s === 'processing' || s === 'searching') {
                  _showPending();
                  _scheduleNext();
                  return;
                }
                _scheduleNext();
              })
              .catch(function() { _scheduleNext(); });
          }

          function _scheduleNext() {
            if (Date.now() - pollStart >= MAX_MS) {
              _stopPoll();
              if (placeholderIcon) {
                placeholderIcon.className = 'fa-solid fa-clock';
                placeholderIcon.style.color = 'var(--sr-warning, #f59e0b)';
              }
              placeholderText.textContent = 'Video discovery is taking longer than expected.';
              _addRetryBtn();
              return;
            }
            pollTimer = setTimeout(_tick, POLL_MS);
          }

          pollTimer = setTimeout(_tick, 1000);
        })();
        initVideoOverlay();
        break;
      case 'tab-upload':
        // Upload tab initializes its own viewer (initEmbedPDF in
        // _upload_tab_content.html). Error handling is done there —
        // no safety timer needed, as CSP or network delays can cause
        // false positives on slow connections.
        break;
      case 'tab-notes':
        initNotesTab(pane);
        break;
      case 'tab-voice':
        // Voice UI lives in this tab's own bottom dock (#tvBar) — mounted /
        // unmounted with the tab like every other lazy pane.
        initChatTab(pane);
        break;
      case 'tab-flashcards':
        initFlashcardsTab(pane);
        break;
      case 'tab-quiz':
        initQuizTab(pane);
        break;
      case 'tab-more':
        initFillInTab(pane);
        break;
      case 'tab-guided':
        // Guided path content is inline in template. If an in-progress section
        // quiz was saved on unmount, restore it (resuming its countdown);
        // otherwise initialize fresh.
        if (typeof window._guidedPathRestore === 'function') {
          window._guidedPathRestore();
        } else if (typeof window._guidedPathInit === 'function') {
          window._guidedPathInit();
        } else if (!document.querySelector('#tab-guided script[src*="guided-path"]')) {
          var s = document.createElement('script');
          s.src = '/static/js/guided-path.js?v=20260926z';
          document.body.appendChild(s);
        }
        break;
    }

  }

  function unmountTab(tabId) {
    // Cancel any pending spinner on the tab we're leaving
    if (window.SrSpinner) window.SrSpinner.hide(tabId);
    if (tabId === 'tab-upload') {
      if (window._uploadSafetyTimer) { clearTimeout(window._uploadSafetyTimer); window._uploadSafetyTimer = null; }
      return;
    }
    // Persist notes before clearing the pane
    if (tabId === 'tab-notes') {
      if (window._notesPoller) { window._notesPoller.cancel(); window._notesPoller = null; }
      if (typeof window.persistNotesDraft === 'function') window.persistNotesDraft();
      // flush any pending debounced server save immediately on tab leave
      if (typeof window._notesSaveTimer !== 'undefined') clearTimeout(window._notesSaveTimer);
      (function () {
        var ed = document.querySelector('.notes-prosemirror');
        if (!ed) return;
        var html = ed.innerHTML;
        if (!html || !html.trim() || html.trim().length < 20) return;
        if (html.includes('notes-loading-bar-wrap') || html.includes('notes-generating-error')) return;
        var packId = window.PACK_ID;
        if (!packId) return;
        var csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
        fetch('/library/pack/' + packId + '/notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
          body: JSON.stringify({ html: html }),
        }).catch(function () {
          if (typeof window.showFatalErrorModal === 'function') {
            var savedHtml = html;
            window.showFatalErrorModal('Failed to save your notes. Please try again.', function () {
              var csrfToken = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
              fetch('/library/pack/' + packId + '/notes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken },
                body: JSON.stringify({ html: savedHtml }),
              }).catch(function () {});
            });
          }
        });
      })();
      var _notesEd = document.querySelector('.notes-prosemirror');
      if (_notesEd && _notesEd._mathSelCleanup) {
        _notesEd._mathSelCleanup();
        _notesEd._mathSelCleanup = null;
      }
    }
    // Persist in-progress guided-path section quiz before the DOM is cleared
    // so mountTab can restore it (resuming the countdown) on the next visit.
    if (tabId === 'tab-guided') {
      if (typeof window._guidedPathSave === 'function') window._guidedPathSave();
      if (typeof window._guidedPathStopTimer === 'function') window._guidedPathStopTimer();
    }
// Reset quiz nav wiring flag so buttons get re-wired on remount
      if (tabId === 'tab-quiz') {
        window._qzNavWired = false;
        if (window._qzPoller) { window._qzPoller.cancel(); window._qzPoller = null; }
        window._qzPollStarted = false;
        // Stop the quiz countdown when leaving the tab so it doesn't tick
        // against a detached DOM and fire an auto-submit on remount.
        if (window._qzStopTimer) window._qzStopTimer();
      }
    // Cancel fill-in background poller on unmount
    if (tabId === 'tab-more') {
      if (window._fiPoller) { window._fiPoller.cancel(); window._fiPoller = null; }
      window._fiPollStarted = false;
    }
    // Cleanup video overlay document listener
    if (tabId === 'tab-video') {
      var vtOverlay = document.getElementById('vtOverlay');
      if (vtOverlay && vtOverlay._overlayCleanup) {
        vtOverlay._overlayCleanup();
        vtOverlay._overlayCleanup = null;
      }
    }
    // Point chat-engine back at the side-pane chat when leaving the AI Tutor
    // tab, and stop any in-flight dictation + its narration-status listeners.
    if (tabId === 'tab-voice') {
      if (typeof window._setChatTarget === 'function') window._setChatTarget(null);
      if (typeof window._tvStopRecognition === 'function') window._tvStopRecognition();
      var _nhooks = window._tvNarrationHooks;
      if (_nhooks) {
        window.removeEventListener('sr:narration-start', _nhooks.start);
        window.removeEventListener('sr:narration-end', _nhooks.end);
        window._tvNarrationHooks = null;
      }
    }
    var pane = document.getElementById(tabId);
    if (!pane) return;
    if (pane.getAttribute('data-lazy-mounted') !== 'true') return;

    // Note: the append-generation overlay (if any) is NOT hidden here — its
    // registry entry survives the unmount and mountTab re-shows it from
    // SrAppendOverlay. Only the DOM node dies with the pane.

    // Empty the study-room lottie holders BEFORE snapshotting the pane. The
    // loader bakes its animation `<svg>` into each `[data-sr-lottie]` holder;
    // if that svg were captured into the cache, mountTab's restore would bring
    // the baked svg back AND the loader's MutationObserver scan would re-attach
    // + re-play into the same holder on the next visit — a second, duplicate
    // animation stacked on the cached one. Empty every holder now (destroyAll
    // is idempotent and no-ops when the loader/library is unavailable offline)
    // so the cache keeps a clean holder and exactly one animation ever remounts.
    if (typeof window.SrLottie === 'function' || (window.SrLottie && window.SrLottie.destroyAll)) {
      try { window.SrLottie.destroyAll(); } catch (e) {}
    }
    var inner = pane.innerHTML;
    if (inner.trim()) {
      tabContentCache.set(tabId, inner);
    }
    pane.innerHTML = '';
    pane.removeAttribute('data-lazy-mounted');
    pane.removeAttribute('data-listeners');
  }

  function initNotesTab(pane) {
    if (typeof window._tiptapToolbar === 'undefined') {
        // Retry up to 10 times at 100ms intervals (1s total) before giving up
        var _notesRetry = 0;
        var _notesTimer = setInterval(function() {
            _notesRetry++;
            if (typeof window._tiptapToolbar !== 'undefined') {
                clearInterval(_notesTimer);
                initNotesTab(pane);
            } else if (_notesRetry >= 10) {
                clearInterval(_notesTimer);
                if (window.SrSpinner) window.SrSpinner.hide('tab-notes');
            }
        }, 100);
        return;
    }
    var wrap = pane.querySelector('.notes-editor-wrap');
    if (!wrap) {
      if (window.SrSpinner) window.SrSpinner.hide('tab-notes');
      return;
    }
    if (window.SrSpinner) window.SrSpinner.hide('tab-notes');
    var editor = wrap.querySelector('.notes-prosemirror');
    if (!editor) return;

    if (!wrap.querySelector('.tiptap-toolbar')) {
      var toolbar = window._tiptapToolbar.createToolbar();
      wrap.insertBefore(toolbar, wrap.firstChild);
    }
    window._tiptapToolbar.initToolbar(wrap);
    var key = window.STUDY_ROOM_NOTES_KEY;
    if (key) {
      try {
        var saved = localStorage.getItem(key);
        var _isTransient = saved && (saved.includes('notes-loading-bar-wrap') || saved.includes('notes-generating-error'));
        if (saved && !_isTransient && !editor.innerHTML.trim()) {
          editor.style.visibility = 'hidden';
          editor.innerHTML = saved;
          var _localDone = function () { editor.style.visibility = ''; };
          if (typeof window.motownTypesetMath === 'function' && /\$|\\|mathjax/i.test(saved)) {
            window.motownTypesetMath(pane).then(_localDone, _localDone);
          } else {
            _localDone();
          }
        } else if (_isTransient) {
          try { localStorage.removeItem(key); } catch (_) {}
        }
      } catch (_) {}
    }

    // If editor still empty after localStorage, pull AI-generated notes from server
    if (!editor.innerHTML.trim()) {
      if (window._notesPoller) window._notesPoller.cancel();
      window._notesPoller = _fetchServerNotes(editor, wrap, pane);
    }

    // Persist notes on every input (fresh DOM element each mount — safe to add listener)
    if (typeof window.persistNotesDraft === 'function') {
      editor.addEventListener('input', window.persistNotesDraft);
    }

    // MathJax CHTML renders glyphs as individual styled elements — copying them
    // produces one character per line. Replace each mjx-container in the clipboard
    // with its aria-label (MathJax's own readable description of the expression).
    editor.addEventListener('copy', function (e) {
      var sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      var frag = sel.getRangeAt(0).cloneContents();
      if (!frag.querySelector('mjx-container')) return; // no math — let browser handle
      frag.querySelectorAll('mjx-container').forEach(function (el) {
        var label = el.getAttribute('aria-label') || '';
        el.replaceWith(document.createTextNode(label ? ' ' + label + ' ' : ' '));
      });
      var tmp = document.createElement('div');
      tmp.appendChild(frag);
      e.clipboardData.setData('text/plain', tmp.textContent);
      e.preventDefault();
    });

    // Stamp inline user-select:text on every mjx-container and its descendants
    // as MathJax adds them. MathJax injects its own stylesheet after the page CSS
    // loads; inline styles guarantee the override regardless of cascade order.
    function _stampMathSelectable(root) {
      var containers = root.nodeName.toLowerCase() === 'mjx-container'
        ? [root]
        : Array.from(root.querySelectorAll ? root.querySelectorAll('mjx-container') : []);
      containers.forEach(function (el) {
        el.style.userSelect = 'text';
        el.style.webkitUserSelect = 'text';
        el.style.display = 'inline-block';
        el.style.verticalAlign = 'middle';
        el.querySelectorAll('*').forEach(function (child) {
          child.style.userSelect = 'text';
          child.style.webkitUserSelect = 'text';
        });
      });
    }

    var _mathObserver = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        m.addedNodes.forEach(function (node) {
          if (node.nodeType === 1) _stampMathSelectable(node);
        });
      });
    });
    _mathObserver.observe(editor, { childList: true, subtree: true });

    // Visual highlight for math in selection — selectionchange + intersectsNode
    // detects which mjx-containers are spanned by the range; mjx-in-sel paints
    // a clean container-level background highlight.
    function _updateMathHighlight() {
      var containers = editor.querySelectorAll('mjx-container');
      if (!containers.length) return;
      var sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount || !editor.contains(sel.anchorNode)) {
        containers.forEach(function (el) { el.classList.remove('mjx-in-sel'); });
        return;
      }
      var range = sel.getRangeAt(0);
      containers.forEach(function (el) {
        try { el.classList.toggle('mjx-in-sel', range.intersectsNode(el)); }
        catch (_) { el.classList.remove('mjx-in-sel'); }
      });
    }
    document.addEventListener('selectionchange', _updateMathHighlight);

    // Store cleanup reference so unmountTab can remove the listener
    editor._mathSelCleanup = function () {
      document.removeEventListener('selectionchange', _updateMathHighlight);
      editor.querySelectorAll('.mjx-in-sel').forEach(function (el) {
        el.classList.remove('mjx-in-sel');
      });
      _mathObserver.disconnect();
    };

    // Typeset math after loading saved content — skip if no math markers present
    if (typeof window.motownTypesetMath === 'function' && /\$|\\|mathjax/i.test(pane.innerHTML)) {
      window.motownTypesetMath(pane);
    }

    // Debounced live LaTeX rendering on user input — only when math markers present
    var _mathJaxTimer = null;
    editor.addEventListener('input', function () {
      var html = editor.innerHTML || '';
      if (!html) return;
      if (/\\\\\(|\\\\\[|\$\$/i.test(html)) {
        clearTimeout(_mathJaxTimer);
        _mathJaxTimer = setTimeout(function () {
          if (typeof window.motownTypesetMath !== 'function') return;
          var sel = window.getSelection();
          var savedRange = null;
          if (sel && sel.rangeCount && editor.contains(sel.anchorNode)) {
            savedRange = sel.getRangeAt(0).cloneRange();
          }
          window.motownTypesetMath(editor).then(function () {
            if (savedRange) {
              try {
                sel.removeAllRanges();
                sel.addRange(savedRange);
              } catch (_) {}
            }
          });
        }, 800);
      }
    });

    // ── Notes search (Ctrl+F) ──
    (function() {
      var searchBar = document.getElementById('notesSearchBar');
      var searchInput = document.getElementById('notesSearchInput');
      var searchCount = document.getElementById('notesSearchCount');
      var searchPrev = document.getElementById('notesSearchPrev');
      var searchNext = document.getElementById('notesSearchNext');
      var searchClose = document.getElementById('notesSearchClose');
      if (!searchBar || !searchInput) return;

      var _matches = [];
      var _activeIdx = -1;

      function openSearch() {
        searchBar.classList.add('open');
        searchInput.focus();
        searchInput.select();
      }
      function closeSearch() {
        searchBar.classList.remove('open');
        clearHighlights();
        searchInput.value = '';
        searchCount.textContent = '';
        _matches = [];
        _activeIdx = -1;
      }
      function clearHighlights() {
        editor.querySelectorAll('.notes-search-match').forEach(function(el) {
          var parent = el.parentNode;
          parent.replaceChild(document.createTextNode(el.textContent), el);
          parent.normalize();
        });
      }

      function doSearch(query) {
        clearHighlights();
        _matches = [];
        _activeIdx = -1;
        if (!query || query.length < 2) { searchCount.textContent = ''; return; }

        // Walk text nodes and wrap matches
        var walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null, false);
        var nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);

        var lowerQuery = query.toLowerCase();
        nodes.forEach(function(node) {
          var text = node.textContent;
          var lowerText = text.toLowerCase();
          var idx = 0;
          while ((idx = lowerText.indexOf(lowerQuery, idx)) !== -1) {
            var range = document.createRange();
            range.setStart(node, idx);
            range.setEnd(node, idx + query.length);
            var mark = document.createElement('mark');
            mark.className = 'notes-search-match';
            range.surroundContents(mark);
            _matches.push(mark);
            idx += query.length;
          }
        });

        searchCount.textContent = _matches.length ? ('1 / ' + _matches.length) : 'No results';
        if (_matches.length) { _activeIdx = 0; highlightActive(); }
      }

      function highlightActive() {
        _matches.forEach(function(m, i) { m.classList.toggle('active', i === _activeIdx); });
        if (_matches[_activeIdx]) {
          _matches[_activeIdx].scrollIntoView({ behavior: 'smooth', block: 'center' });
          searchCount.textContent = (_activeIdx + 1) + ' / ' + _matches.length;
        }
      }
      function goNext() { if (!_matches.length) return; _activeIdx = (_activeIdx + 1) % _matches.length; highlightActive(); }
      function goPrev() { if (!_matches.length) return; _activeIdx = (_activeIdx - 1 + _matches.length) % _matches.length; highlightActive(); }

      var _searchTimer = null;
      searchInput.addEventListener('input', function() {
        clearTimeout(_searchTimer);
        _searchTimer = setTimeout(function() { doSearch(searchInput.value.trim()); }, 200);
      });
      searchInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? goPrev() : goNext(); }
        if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
      });
      if (searchPrev) searchPrev.addEventListener('click', goPrev);
      if (searchNext) searchNext.addEventListener('click', goNext);
      if (searchClose) searchClose.addEventListener('click', closeSearch);

      // Intercept Ctrl+F / Cmd+F when notes tab is active
      document.addEventListener('keydown', function(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
          // Only intercept if notes tab is the active tab
          var notesTab = document.getElementById('tab-notes');
          if (notesTab && notesTab.classList.contains('room-vp--active')) {
            e.preventDefault();
            openSearch();
          }
        }
      });
    })();

    // ── Notes word count ──
    (function() {
      var wcEl = document.getElementById('notesWordCount');
      if (!wcEl) return;
      var _wcTimer = null;
      function updateCount() {
        var text = (editor.innerText || '').trim();
        if (!text) { wcEl.textContent = ''; return; }
        var words = text.split(/\s+/).filter(function(w) { return w.length > 0; }).length;
        var chars = text.length;
        wcEl.textContent = words + (words === 1 ? ' word' : ' words') + ' \u00b7 ' + chars.toLocaleString() + ' characters';
      }
      editor.addEventListener('input', function() {
        clearTimeout(_wcTimer);
        _wcTimer = setTimeout(updateCount, 400);
      });
      updateCount();
    })();

  }

  function _fetchServerNotes(editor, wrap, pane) {
    var noop = { cancel: function () {} };
    var packId = typeof PACK_ID !== 'undefined' ? PACK_ID : null;
    if (!packId) return noop;
    // 'absent' means no PackResource row exists yet — notes generation is
    // disabled, so leave the editor empty for the student to write into.
    if (window.NOTES_STATUS === 'absent') return noop;
    // Notes pre-loaded in the page — inject directly, no XHR needed.
    if (window._notesHtml) {
      editor.style.visibility = 'hidden';
      editor.innerHTML = window._notesHtml;
      var _preKey = window.STUDY_ROOM_NOTES_KEY;
      if (_preKey) { try { localStorage.setItem(_preKey, window._notesHtml); } catch (_e) {} }
      var _typesetDone = function () { editor.style.visibility = ''; };
      if (typeof window.motownTypesetMath === 'function' && /\$|\\|mathjax/i.test(pane.innerHTML)) {
        window.motownTypesetMath(pane).then(_typesetDone, _typesetDone);
      } else {
        _typesetDone();
      }
      window._tiptapToolbar.initToolbar(wrap);
      return noop;
    }
    var _notesDelay = 1000;
    var _notesBackoffDelay = 4000;
    var _notesMax = 180000;
    var _notesStart = Date.now();
    var _cancelled = false;
    var _pollTimer = null;
    var _catchCount = 0;
    var _pollCount = 0;
    // Neutral loading message while fetching server-side notes
    editor.innerHTML = '<div class="notes-loading-bar-wrap"><div class="notes-loading-header"><span class="notes-gen-phase">Loading notes…</span><span class="notes-gen-pct">0%</span></div><div class="notes-loading-track"><div class="notes-loading-fill"></div></div></div>';
    // Animate percentage 0→95% with easing curve
    var _nPctStart = Date.now();
    var _nPctRaf;
    function _notesPctEase(t) {
      if (t < 0.15) return (t / 0.15) * 25;
      if (t < 0.45) return 25 + ((t - 0.15) / 0.3) * 35;
      if (t < 0.75) return 60 + ((t - 0.45) / 0.3) * 25;
      if (t < 1.0)  return 85 + ((t - 0.75) / 0.25) * 10;
      return 95;
    }
    function _notesPctTick() {
      var elapsed = (Date.now() - _nPctStart) / 1000;
      var t = Math.min(elapsed / 30, 1);
      var pctEl = editor.querySelector('.notes-gen-pct');
      if (pctEl) pctEl.textContent = Math.floor(_notesPctEase(t)) + '%';
      if (t < 1) _nPctRaf = requestAnimationFrame(_notesPctTick);
    }
    _nPctRaf = requestAnimationFrame(_notesPctTick);
    function _notesPctStop(snap) {
      cancelAnimationFrame(_nPctRaf);
      var pctEl = editor.querySelector('.notes-gen-pct');
      if (snap && pctEl) pctEl.textContent = '100%';
    }
    var _nTimers = [];
    function _notesShowError(msg) {
      _nTimers.forEach(clearTimeout);
      _notesPctStop(false);
      editor.innerHTML = '<div class="notes-generating-error">' + msg +
        ' <button onclick="window.location.reload()" style="margin-left:8px;cursor:pointer;">Retry</button></div>';
    }
    function _notesPoll() {
      if (_cancelled) return;
      _pollCount++;
      if (_pollCount >= 3) _notesDelay = _notesBackoffDelay;
      if (Date.now() - _notesStart > _notesMax) {
        _notesShowError('Notes generation timed out.');
        return;
      }
      fetch('/library/pack/' + packId + '/notes')
        .then(function(r) {
          if (!r.ok) { throw new Error('HTTP ' + r.status); }
          return r.json();
        })
        .then(function(data) {
          if (_cancelled) return;
          if (data.ok && (data.html || data.generation_status === 'done')) {
            _nTimers.forEach(clearTimeout);
            _notesPctStop(true);
            editor.style.visibility = 'hidden';
            editor.innerHTML = data.html || '';
            var key = window.STUDY_ROOM_NOTES_KEY;
            if (key) { try { localStorage.setItem(key, data.html); } catch (_) {} }
            var _typesetDone = function () { editor.style.visibility = ''; };
            if (typeof window.motownTypesetMath === 'function') {
              window.motownTypesetMath(pane).then(_typesetDone, _typesetDone);
            } else {
              _typesetDone();
            }
            window._tiptapToolbar.initToolbar(wrap);
            return;
          }
          if (data.generation_status === 'failed') {
            _notesShowError('Notes generation failed.');
            return;
          }
          // Notes generation is disabled — with no ready notes document, stop
          // polling and leave the editor empty for the student to write into.
          _nTimers.forEach(clearTimeout);
          _notesPctStop(false);
          editor.innerHTML = '';
          return;
        })
        .catch(function() {
          if (_cancelled) return;
          _catchCount++;
          if (_catchCount >= 5) {
            if (typeof window.showFatalErrorModal === 'function') {
              window.showFatalErrorModal('Failed to load notes. Please try again.', function () {
                _catchCount = 0;
                _startGeneratingPhases();
                _pollTimer = setTimeout(_notesPoll, 300);
              });
            } else {
              _notesShowError('Failed to load notes. Please try again.');
            }
            return;
          }
          _startGeneratingPhases();
          _pollTimer = setTimeout(_notesPoll, _notesDelay);
        });
    }
    // Poll immediately on first load — if notes exist they appear right away
    _notesPoll();
    return {
      cancel: function () {
        _cancelled = true;
        clearTimeout(_pollTimer);
        _nTimers.forEach(clearTimeout);
        _notesPctStop(false);
      }
    };
  }

  // Persistent interaction mode for the AI Tutor dock. The mode buttons do NOT
  // switch tabs — they instruct the agent how to run the session (open chat,
  // an interactive quiz Q&A, or a step-by-step explainer). Sent with every
  // utterance so the backend keeps the chosen directive in the system prompt.
  var _tvActiveMode = 'chat';
  // Module-level (survives per-mount re-init): the visibilitychange handler
  // is rebound per mount so it always references the LIVE closure's loop, and
  // the one-time audio unlock only ever binds once.
  var _tvVisHandler = null;
  var _tvUnlockOnce = false;

  function initChatTab(root) {
    var orb = root.querySelector('#tvOrb');
    var orbHint = root.querySelector('#tvOrbHint');
    var emptyState = root.querySelector('#tvEmpty');
    var capUser = root.querySelector('#tvCapUser');
    var capUserText = root.querySelector('#tvCapUserText');
    var capAi = root.querySelector('#tvCapAi');
    var capAiText = root.querySelector('#tvCapAiText');
    var IDLE_HINT = 'Always listening…';
    var badge = root.querySelector('#tvModeBadge');
    var badgeText = root.querySelector('#tvModeBadgeText');

    // Bottom-dock captions: show the *current* exchange as it's being said
    // (user utterance → AI reply), not a threaded chat log. So no chat-engine
    // thread targeting and no chat-thread/appendBubble styling here.
    function _tvSyncEmpty() {
      if (!emptyState) return;
      var u = capUserText ? capUserText.textContent.trim() : '';
      var a = capAiText ? capAiText.textContent.trim() : '';
      emptyState.style.display = (u || a) ? 'none' : '';
    }
    function _tvSetUserCaption(t) {
      if (!capUserText) return;
      capUserText.textContent = t || '';
      if (capUser) capUser.hidden = !(t && t.trim());
      // A fresh question starts a fresh exchange — clear the old reply.
      if (capAi && capAiText) {
        capAiText.textContent = '';
        capAi.hidden = true;
        capAi.classList.remove('is-live');
      }
      _tvSyncEmpty();
    }
    function _tvSetAiCaption(t, live) {
      if (!capAiText) return;
      capAiText.textContent = t || (live ? '' : '');
      if (capAi) {
        capAi.hidden = !(t && t.trim()) && !live;
        capAi.classList.toggle('is-live', !!live);
      }
      // Single-speaker rule: while the AI's line is showing, the user's line
      // steps aside — never both transcripts at the same time.
      if (capUser) capUser.hidden = true;
      _tvSyncEmpty();
    }

    /* Orb state driver — idle / listening / thinking / speaking / error.
       The live status rides the orb's hint line under the orb. */
    function _tvSetOrb(state) {
      if (!orb) return;
      orb.classList.remove('is-listening', 'is-thinking', 'is-speaking', 'is-error', 'is-idle');
      if (state) orb.classList.add(state);
    }
    function _tvStatus(text) {
      if (orbHint) orbHint.textContent = (text === '' ? IDLE_HINT : text);
    }
    function _tvRenderBadge(mode, flash) {
      if (!badgeText) return;
      badgeText.textContent = _tvModeLabel(mode);
      if (flash && badge) {
        badge.classList.remove('is-flash');
        void badge.offsetWidth; /* restart the flash animation */
        badge.classList.add('is-flash');
      }
    }
    _tvSetOrb('is-idle');

    /* ── Audio-energy reactivity ─────────────────────────────────────────
       Mirrors ask-ai-fab's tickEnergy: live RMS from the mic while listening
       and from the narrator's replyAnalyser while speaking, EMA-smoothed into
       --ask-amp so the orb core/rings scale with the voice. The reply element
       is wired by the FAB once (shared MediaElementSource), so we reuse its
       analyser read-only; mic is skipped on coarse pointers (iOS fights the
       recognizer). Falls back to the CSS keyframes silently when unavailable. */
    var _tvAmp = 0;
    var _tvAmpRaf = 0;
    var _tvMicAnalyser = null;
    var _tvMicStream = null;
    var _tvMicGen = 0;
    var _reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var _tvWaveBars = [];
    var _tvWaveLv = [];
    var _tvWaveFreq = null;
    var _tvWaveN = 24;
    /* Bar geometry: each segment is ONE closed sector path — a thick bar whose
       inner edge is rooted just under the orb rim and whose outer edge is an
       arc cap. The outer radius is rebuilt per-frame from the audio, so the
       bar grows outward from the orb like a voice-recorder meter, with the
       arc riding on top as its rounded tip. */
    var _tvWaveCX = 84, _tvWaveCY = 84;
    var _tvWaveR0 = 52;      /* inner radius (tucks under the rim at 54)  */
    var _tvWaveRBase = 56;   /* bar length at silence                     */
    var _tvWaveRMax = 80;    /* bar tip at full voice                     */
    var _tvWaveHalf = 5;     /* degrees each side of slot centre          */

    function _tvRmsOf(buf) {
      var sum = 0;
      for (var i = 0; i < buf.length; i++) {
        var v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      return Math.min(1, Math.sqrt(sum / buf.length) * 3.2);
    }

    /* Thick connected bars: N sector paths arranged around the orb. Each sector
       spans _tvWaveHalf each side of its slot centre, from the rim (R0) out to
       an audio-driven outer radius — rebuilt per-frame from getByteFrequencyData
       so the bar grows outward from the orb and the arc caps its tip. The ring
       is intentionally NOT gated on prefers-reduced-motion — the bars are live
       audio feedback, not decorative looping motion (JS still zeroes the
       core/ring swelling amp under reduce-motion). */
    function _tvWavePath(rOut, i) {
      var slot = ((i % _tvWaveN) / _tvWaveN) * 360;
      var a1 = (slot - _tvWaveHalf) * Math.PI / 180;
      var a2 = (slot + _tvWaveHalf) * Math.PI / 180;
      /* inner edge (rooted at the orb rim) then outer edge (arc cap) */
      var i1x = (_tvWaveCX + _tvWaveR0 * Math.cos(a1)).toFixed(2);
      var i1y = (_tvWaveCY + _tvWaveR0 * Math.sin(a1)).toFixed(2);
      var i2x = (_tvWaveCX + _tvWaveR0 * Math.cos(a2)).toFixed(2);
      var i2y = (_tvWaveCY + _tvWaveR0 * Math.sin(a2)).toFixed(2);
      var o1x = (_tvWaveCX + rOut * Math.cos(a1)).toFixed(2);
      var o1y = (_tvWaveCY + rOut * Math.sin(a1)).toFixed(2);
      var o2x = (_tvWaveCX + rOut * Math.cos(a2)).toFixed(2);
      var o2y = (_tvWaveCY + rOut * Math.sin(a2)).toFixed(2);
      return 'M ' + i1x + ' ' + i1y +
             ' L ' + o1x + ' ' + o1y +
             ' A ' + rOut + ' ' + rOut + ' 0 0 1 ' + o2x + ' ' + o2y +
             ' L ' + i2x + ' ' + i2y + ' Z';
    }

    function _tvBuildWaves() {
      var stage = root.querySelector('.tv-orb__stage');
      if (!stage) return;
      var host = stage.querySelector('.tv-orb__waves');
      if (!host || _tvWaveBars.length) return;
      var ns = 'http://www.w3.org/2000/svg';
      var svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('viewBox', '0 0 168 168');
      svg.classList.add('tv-orb__arc');
      for (var i = 0; i < _tvWaveN; i++) {
        var p = document.createElementNS(ns, 'path');
        p.setAttribute('d', _tvWavePath(_tvWaveRBase, i));
        svg.appendChild(p);
        _tvWaveBars.push(p);
        _tvWaveLv.push(0.14);
      }
      host.appendChild(svg);
    }

    /* Map a 0..1 index (k/(N-1)) onto a frequency bin, skewing toward the
       low end so the voiced spectrum spreads across the ring nicely. */
    function _tvWaveBinOf(k, frac, binCount) {
      var idx = Math.floor(Math.pow(frac, 1.35) * (binCount - 1));
      return Math.max(0, Math.min(binCount - 1, idx));
    }

    function _tvWaveTarget(target) {
      return 0.14 + target * 0.86;   /* 0.14 base keeps an idle ring alive */
    }

    /* Map a smoothed 0.14..1 energy onto an outer bar radius. 0.56 holds the bar
       short at silence; ~0.80 pushes its arc tip toward the stage edge. */
    function _tvArcScale(lv) {
      return _tvWaveRBase + lv * (_tvWaveRMax - _tvWaveRBase);
    }

    function _tvUpdateWaves(target, an) {
      if (!_tvWaveBars.length) return;
      var buf = _tvWaveFreq;
      if (an && an.fftSize) {
        var bc = an.frequencyBinCount;
        if (!buf || buf.length !== bc) { buf = _tvWaveFreq = new Uint8Array(bc); }
        try { an.getByteFrequencyData(buf); }
        catch (e) { buf = null; }
      } else {
        buf = null;
      }
      var n = _tvWaveBars.length;
      var k;
      var peak = 0;
      if (buf) { for (k = 0; k < buf.length; k++) { if (buf[k] > peak) peak = buf[k]; } }
      for (k = 0; k < n; k++) {
        var frac = k / (n - 1);
        var s;
        if (buf) {
          var idx = _tvWaveBinOf(k, frac, buf.length);
          var v = buf[idx] / 255;
          /* blend toward the global peak so quiet-bottom arcs still sway */
          var sway = 0.45 * v + 0.55 * (peak / 255);
          s = 0.14 + sway * 0.86;
        } else {
          s = _tvWaveTarget(target);
        }
        var lv = _tvWaveLv[k];
        var rate = s > lv ? 0.55 : 0.16;
        lv += (s - lv) * rate;
        _tvWaveLv[k] = lv;
        _tvWaveBars[k].setAttribute('d', _tvWavePath(_tvArcScale(lv), k));
      }
    }
    _tvBuildWaves();

    function _tvWireReplyAnalyser() {
      if (_tvReplyAnalyser) return Promise.resolve(_tvReplyAnalyser);
      if (typeof window.__askAudioCtx !== 'function') return Promise.resolve(null);
      var el = document.getElementById('tvReplyAudio');
      if (!el) return Promise.resolve(null);
      var ctx = window.__askAudioCtx();
      if (!ctx) return Promise.resolve(null);
      /* Wiring a suspended graph mutes the element, so connect only once the
         context actually reaches 'running'. resume() resolves async — wait for
         it (mirrors readto-fab's _resumeP.then(_doPlay)). If resume never
         settles (no user gesture yet, autoplay policy), a 1s stall-guard falls
         through and the chunk plays natively — audible, but without a live
         analyser reading until the graph is unlocked. */
      function wire() {
        if (ctx.state !== 'running') return null;   /* stall won — stay native */
        try {
          var src = ctx.createMediaElementSource(el);
          var an = ctx.createAnalyser();
          an.fftSize = 256;
          src.connect(an);
          an.connect(ctx.destination);
          _tvReplyWired = true;
          _tvReplyAnalyser = an;
          return an;
        } catch (e) {
          return null;   /* fall back to CSS keyframes */
        }
      }
      var rp = null;
      try { rp = ctx.resume(); } catch (e) {}
      var resumeP = (rp && rp.then) ? rp : Promise.resolve();
      var stall = new Promise(function (res) { setTimeout(res, 1000); });
      return Promise.race([resumeP, stall])
        .then(wire)
        .catch(function () { return null; });
    }

    function _tvAmpTick() {
      _tvAmpRaf = requestAnimationFrame(_tvAmpTick);
      var target = 0;
      var an = null;
      if (_tvListening && _tvMicAnalyser) {
        an = _tvMicAnalyser;
        var d1 = new Uint8Array(_tvMicAnalyser.frequencyBinCount);
        _tvMicAnalyser.getByteTimeDomainData(d1);
        target = _tvRmsOf(d1);
      } else if (_tvSpeaking) {
        // The tab's own reply element drives the pulse; fall back to the FAB's
        // shared analyser (readto/ask-ai reply element) when not wired here.
        var ra = _tvReplyAnalyser || ((typeof window.__askReplyAnalyser === 'function') ? window.__askReplyAnalyser() : null);
        if (ra) {
          an = ra;
          var d2 = new Uint8Array(ra.frequencyBinCount);
          ra.getByteTimeDomainData(d2);
          target = _tvRmsOf(d2);
        }
      }
      // Wave-recorder feel: fast attack, slower decay so the orb swells and
      // falls with the AI's actual words instead of a metronomic blink.
      var rate = target > _tvAmp ? 0.5 : 0.14;
      _tvAmp += (target - _tvAmp) * rate;
      var ampVal = _reducedMotion ? 0 : _tvAmp;
      if (orb) orb.style.setProperty('--ask-amp', ampVal.toFixed(3));
      _tvUpdateWaves(ampVal, an);
    }

    function _tvStartAmp() {
      if (!_tvAmpRaf) _tvAmpRaf = requestAnimationFrame(_tvAmpTick);
    }
    function _tvStopAmp(reset) {
      if (_tvAmpRaf) { cancelAnimationFrame(_tvAmpRaf); _tvAmpRaf = 0; }
      _tvAmp = 0;
      for (var i = 0; i < _tvWaveLv.length; i++) _tvWaveLv[i] = 0;
      if (reset && orb) orb.style.setProperty('--ask-amp', '0');
      if (reset && _tvWaveBars.length) {
        for (var j = 0; j < _tvWaveBars.length; j++) {
          _tvWaveBars[j].setAttribute('d', _tvWavePath(_tvWaveRBase, j));
        }
      }
    }

    function _tvStartMicAnalyser() {
      if (_isCoarse) return;              /* keyframes carry reactivity on iOS */
      if (_tvMicAnalyser || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
      var ctx = (typeof window.__askAudioCtx === 'function') ? window.__askAudioCtx() : null;
      if (!ctx) return;
      var myMic = ++_tvMicGen;
      navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
        .then(function (stream) {
          if (myMic !== _tvMicGen || !_tvListening) {
            try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
            return;
          }
          _tvMicStream = stream;
          _tvMicAnalyser = ctx.createAnalyser();
          _tvMicAnalyser.fftSize = 256;
          ctx.createMediaStreamSource(stream).connect(_tvMicAnalyser);
        })
        .catch(function () { _tvMicAnalyser = null; });
    }

    function _tvStopMicAnalyser() {
      _tvMicGen++;
      if (_tvMicStream) {
        try { _tvMicStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
        _tvMicStream = null;
      }
      _tvMicAnalyser = null;
    }

    // Status line for the live voice loop — "Listening… / Speaking…"
    function _tvOnNarrationStart() {
      _tvSpeaking = true;
      _tvSetOrb('is-speaking');
      _tvStatus('Speaking…');
      _tvStartAmp();
    }
    function _tvOnNarrationEnd() {
      _tvSpeaking = false;
      _tvStopAmp(true);
      _tvSetOrb('is-idle');
      _tvStatus('');
    }
    window._tvNarrationHooks = {
      start: _tvOnNarrationStart,
      end: _tvOnNarrationEnd
    };
    window.addEventListener('sr:narration-start', _tvOnNarrationStart);
    window.addEventListener('sr:narration-end', _tvOnNarrationEnd);

    // No physical mode toggles anymore — modes are activated by spoken
    // keywords below. Just reflect the persisted mode on the badge.
    _tvRenderBadge(_tvActiveMode, false);

    /* ── Live voice loop ─────────────────────────────────────────────
       Mirrors ask-ai-fab's proven recognition loop but hands-free: listening
       starts automatically, the utterance is committed once the transcript
       has been quiet for a grace window, then /api/voice/ask-stream streams
       the reply aloud and the captions land the finished user→AI pair. */
    var _tvRec = null;
    var _tvFinalText = '';
    var _tvInterimText = '';
    var _tvCommitTimer = null;
    var _tvPendingText = '';
    var _tvRecognizerGen = 0;
    var _tvListening = false;
    var _tvSpeaking = false;
    var _tvSpokenOnce = false;
    var FINAL_GRACE_MS = 3500;
    var INTERIM_GRACE_MS = 4500;
    var _isCoarse = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
      ('ontouchstart' in window);

    function _tvClearCommitTimer() {
      if (_tvCommitTimer) { clearTimeout(_tvCommitTimer); _tvCommitTimer = null; }
      _tvPendingText = '';
    }

    function _tvStopRecognition() {
      _tvRecognizerGen++;
      if (_tvRearmTimer) { clearTimeout(_tvRearmTimer); _tvRearmTimer = null; }
      if (_tvRec) {
        try { _tvRec.stop(); } catch (e) {}
        _tvRec = null;
      }
      _tvClearCommitTimer();
      _tvListening = false;
      _tvStopMicAnalyser();
      _tvStopAmp(true);
      _tvSetOrb(_tvSpeaking ? 'is-speaking' : 'is-idle');
      if (!_tvSpeaking) _tvStatus('');
    }

    function _tvArmCommit() {
      if (!_tvListening) return;
      var text = (_tvFinalText + ' ' + _tvInterimText).trim();
      if (!text) return;
      if (_tvCommitTimer) clearTimeout(_tvCommitTimer);
      _tvPendingText = text;
      var grace = _tvInterimText.trim() ? INTERIM_GRACE_MS : FINAL_GRACE_MS;
      _tvCommitTimer = setTimeout(function () {
        _tvCommitTimer = null;
        _tvCommitStable(text);
      }, grace);
    }

    // A spoken mode command ("quiz me", "explain…", "back to chat") replaces
    // the old physical toggles. The keyword is detected here and becomes the
    // seed for a mode-switch "tool call" — the agent picks up the mode and runs
    // the session accordingly (quiz rounds are scored, explain is step-by-step,
    // chat is normal exchanges).
    function _tvHandleModeCommand(cmd, spokenText) {
      _tvSpokenOnce = true;
      _tvActiveMode = cmd.mode;
      var subject = _tvSubjectFromAfter(cmd.after);
      var q = _tvBuildModeSeed(cmd.mode, subject);
      _tvRenderBadge(cmd.mode, true);
      _tvAskStream(q, { sourceText: spokenText });
    }

    function _tvCommitStable(expectedText) {
      if (!_tvListening) return;
      var text = (_tvFinalText + ' ' + _tvInterimText).trim();
      if (text !== expectedText) { _tvArmCommit(); return; }
      if (!text) return;
      _tvSpokenOnce = true;
      var cmd = _tvDetectModeCommand(text);
      if (cmd) {
        var alreadyActive = (cmd.mode === _tvActiveMode);
        // Skip redundant switches: a quiz keyword mid-quiz ("quiz me") or a
        // chat keyword mid-chat is just the student's normal phrasing, not a
        // switch — the utterance is handled as a normal exchange below.
        if (!alreadyActive) {
          _tvStopRecognition();
          _tvFinalText = '';
          _tvInterimText = '';
          _tvHandleModeCommand(cmd, text);
          return;
        }
      }
      _tvStopRecognition();
      _tvFinalText = '';
      _tvInterimText = '';
      _tvAskStream(text);
    }

    /* ── Ask-stream voice round-trip ─────────────────────────────────────
       Mirror of ask-ai-fab's proven /api/voice/ask-stream pipeline — the AI
       reply arrives as SSE 'audio' events whose audio_b64 chunks play through
       a dedicated Blob/objectURL element (same mechanism as the Ask-AI orb),
       instead of the readto srNarrateText → /api/readto/speak chain that can
       fail silently. The transcript still lands the full user→AI pair whether
       or not audio came back. */
    var _tvStreamCtrl = null;
    var _tvStreamDone = false;
    var _tvAskQueue = [];
    var _tvAskPlaying = false;
    var _tvAskAudioEl = null;
    var _tvAskText = '';
    var _tvAskUserText = '';
    var _tvAskGotAudio = false;
    var _tvHistoryPushed = false;
    var _tvPaused = false;
    var _tvRelistenTimer = null;

    function _tvGetAskAudio() {
      if (_tvAskAudioEl) return _tvAskAudioEl;
      var el = document.getElementById('tvReplyAudio');
      if (el) { _tvAskAudioEl = el; return el; }
      el = document.createElement('audio');
      el.id = 'tvReplyAudio';
      el.preload = 'auto';
      el.style.display = 'none';
      document.body.appendChild(el);
      _tvAskAudioEl = el;
      return el;
    }

    function _tvAskPlayNext() {
      if (_tvAskPlaying || !_tvAskQueue.length) return;
      _tvAskPlaying = true;
      var item = _tvAskQueue.shift();
      try {
        var aEl = _tvGetAskAudio();
        var binary = atob(item.b64);
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        var mime = (bytes[0] === 0x52 && bytes[1] === 0x49) ? 'audio/wav' : 'audio/mpeg';
        var blob = new Blob([bytes], { type: mime });
        var url = URL.createObjectURL(blob);
        function _fire() {
          function _onChunkEnd() {
            try { URL.revokeObjectURL(url); } catch (e) {}
            aEl.onended = null;
            aEl.onerror = null;
            _tvAskPlaying = false;
            if (_tvAskQueue.length) { _tvAskPlayNext(); return; }
            _tvAskQueueDrained();
          }
          aEl.onended = _onChunkEnd;
          aEl.onerror = _onChunkEnd;
          aEl.src = url;
          aEl.load();
          var _rate = (window.srNarrationSpeed && window.srNarrationSpeed()) || 1;
          try { aEl.playbackRate = _rate; } catch (e) {}
          _tvOnNarrationStart();
          var _p = aEl.play();
          if (_p && _p.then) _p.catch(function () { _onChunkEnd(); });
        }
        /* Wire the analyser first (resume context + createMediaElementSource)
           so the chunk's audio flows through the graph into the orb's reader.
           Never block playback — if wiring can't happen, fire natively. */
        Promise.resolve()
          .then(function () { return _tvWireReplyAnalyser(); })
          .then(_fire)
          .catch(_fire);
      } catch (e) {
        _tvAskPlaying = false;
        if (_tvAskQueue.length) { _tvAskPlayNext(); return; }
        _tvAskQueueDrained();
      }
    }

    function _tvAskQueueDrained() {
      if (_tvStreamDone) {
        _tvOnNarrationEnd();
        _tvScheduleRelisten();
      }
    }

    function _tvAskStopAudio() {
      _tvAskQueue = [];
      _tvAskPlaying = false;
      try {
        if (_tvAskAudioEl) {
          _tvAskAudioEl.pause();
          _tvAskAudioEl.onended = null;
          _tvAskAudioEl.onerror = null;
          _tvAskAudioEl.src = '';
        }
      } catch (e) {}
    }

    function _tvAskPushHistory(final) {
      if (_tvHistoryPushed) return;
      _tvHistoryPushed = true;
      try {
        if (window._history) {
          if (_tvAskUserText) window._history.push({ role: 'user', content: _tvAskUserText });
          if (final) window._history.push({ role: 'assistant', content: final });
        }
      } catch (e) {}
    }

    function _tvAskFinalize() {
      if (_tvStreamDone) return;
      _tvStreamDone = true;
      _tvStreamCtrl = null;
      var final = (_tvAskText || '').trim() || 'No reply received.';
      _tvSetAiCaption(final, false);
      _tvAskPushHistory(final);
      _tvAskText = '';
      if (!_tvAskPlaying && !_tvAskQueue.length) {
        _tvOnNarrationEnd();
        _tvScheduleRelisten();
      }
    }

    function _tvAskStreamAbortCleanup() {
      if (!_tvStreamCtrl && !_tvAskPlaying && !_tvAskQueue.length) return;
      try { if (_tvStreamCtrl) _tvStreamCtrl.abort(); } catch (e) {}
      _tvStreamCtrl = null;
      _tvStreamDone = true;
      _tvHistoryPushed = true;
      _tvAskStopAudio();
      _tvSetAiCaption('', false);
      _tvAskText = '';
    }

    function _tvAskStream(text, opts) {
      opts = opts || {};
      var q = text;
      var ctx = '';
      try {
        if (window._history && window._history.length) {
          var last = window._history.slice(-6);
          ctx = last.map(function (h) { return (h.role || '') + ': ' + (h.content || '').slice(0, 300); }).join('\n').slice(-2000);
        }
      } catch (e) {}
      var sectionCtx = '';
      try {
        if (window._chatContext && typeof window._chatContext === 'string') sectionCtx = window._chatContext.slice(-700);
      } catch (e) {}
      var packId = window.PACK_ID || window.__PACK_ID__ || null;
      var csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';

      _tvAskUserText = text;
      _tvAskText = '';
      _tvAskGotAudio = false;
      _tvHistoryPushed = false;
      _tvStreamDone = false;
      _tvAskQueue = [];
      _tvAskPlaying = false;
      _tvStreamCtrl = new AbortController();

      // The user's utterance lands as a caption; the AI reply streams live
      // into the AI caption as synthesized segments arrive.
      _tvSetUserCaption(opts.sourceText || text);
      _tvSetOrb('is-thinking');
      _tvStatus('Thinking…');

      fetch('/api/voice/ask-stream', {
        method: 'POST',
        signal: _tvStreamCtrl.signal,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
        body: JSON.stringify({
          question: q,
          pack_id: packId,
          context: ctx,
          section_context: sectionCtx,
          mode: _tvActiveMode,
          history: (window._history || []).slice(-8)
        })
      }).then(function (r) {
        if (!r.ok) {
          return r.json().then(function (j) { throw { status: r.status, body: j }; });
        }
        var ct = (r.headers.get('Content-Type') || '');
        if (ct.indexOf('text/event-stream') === -1) {
          return r.json().then(function (j) {
            _tvAskText = (j.reply || '').trim() || 'No reply';
            if (j.audio_b64) {
              _tvAskGotAudio = true;
              _tvAskQueue.push({ b64: j.audio_b64 });
              if (!_tvAskPlaying) _tvAskPlayNext();
            }
            _tvAskFinalize();
          });
        }
        var reader = r.body.getReader();
        var decoder = new TextDecoder();
        var buf = '';
        function pump() {
          return reader.read().then(function (res) {
            if (res.done) {
              _tvAskFinalize();
              return;
            }
            buf += decoder.decode(res.value, { stream: true });
            var parts = buf.split('\n\n');
            buf = parts.pop() || '';
            for (var i = 0; i < parts.length; i++) {
              var line = parts[i].trim();
              if (!line || line.indexOf('data: ') !== 0) continue;
              try {
                var evt = JSON.parse(line.slice(6));
                if (evt.type === 'audio' && evt.audio_b64) {
                  _tvAskGotAudio = true;
                  _tvAskText += (evt.text || '') + ' ';
                  _tvSetAiCaption(_tvAskText, true);
                  _tvAskQueue.push({ b64: evt.audio_b64 });
                  if (!_tvAskPlaying) _tvAskPlayNext();
                } else if (evt.type === 'done') {
                  _tvAskText = (evt.reply || _tvAskText).trim();
                  _tvSetAiCaption(_tvAskText, true);
                  if (!_tvAskGotAudio) _tvAskFinalize();
                }
              } catch (e) {}
            }
            return pump();
          });
        }
        return pump();
      }).catch(function (err) {
        if (err && err.name === 'AbortError') return;   /* user barged in */
        _tvAskText = 'The voice assistant ran into a problem — please try again.';
        _tvAskFinalize();
      });
    }

    // Recognizer died (onend / no-speech / network). Re-arm with a FRESH
    // instance — restarting a dead webkitSpeechRecognition is unreliable,
    // especially on iOS. Bounded on coarse pointers so a silent recognizer
    // can't daisy-chain forever; the grace-commit timer owns any words heard.
    var _tvRearmTimer = null;
    var _tvRearmCount = 0;
    function _tvRearmRecognition() {
      if (!_tvListening || _tvRearmTimer) return;
      if (_isCoarse) {
        var hasWords = (_tvFinalText + ' ' + _tvInterimText).trim();
        if (hasWords) return;                  /* commit timer owns these */
        if (++_tvRearmCount > 2) { _tvStatus('Listening paused — tap the orb to resume'); return; }
      }
      _tvRearmTimer = setTimeout(function () {
        _tvRearmTimer = null;
        if (!_tvListening) return;
        _tvStartRecognition();
      }, 400);
    }

    function _tvStartRecognition() {
      var SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRec) {
        _tvSetOrb('is-error');
        _tvStatus('Voice input isn\'t supported in this browser');
        if (typeof window.showToast === 'function') {
          window.showToast('Voice input isn\'t supported in this browser.', 'info');
        }
        return;
      }
      _tvStopRecognition();
      _tvFinalText = '';
      _tvInterimText = '';
      _tvRearmCount = 0;
      _tvListening = true;
      var gen = ++_tvRecognizerGen;
      _tvSetOrb('is-listening');
      _tvStatus('Listening…');
      _tvStartMicAnalyser();
      _tvStartAmp();
      try {
        var rec = new SpeechRec();
        _tvRec = rec;
        rec.lang = 'en-US';
        rec.interimResults = true;
        rec.continuous = !_isCoarse;
        rec.maxAlternatives = 1;

        rec.onstart = function () {
          if (_tvRec !== rec || gen !== _tvRecognizerGen) return;
          _tvSetOrb('is-listening');
          _tvStatus('Listening…');
        };
        rec.onresult = function (e) {
          if (_tvRec !== rec || gen !== _tvRecognizerGen || !_tvListening) return;
          var interim = '';
          for (var i = e.resultIndex; i < e.results.length; i++) {
            if (e.results[i].isFinal) _tvFinalText += e.results[i][0].transcript;
            else interim += e.results[i][0].transcript;
          }
          _tvInterimText = interim;
          var shown = (_tvFinalText + ' ' + _tvInterimText).trim();
          if (shown) {
            _tvSetUserCaption(shown);
            _tvStatus('Listening…');
            _tvArmCommit();
          }
        };
        rec.onend = function () {
          if (_tvRec !== rec || gen !== _tvRecognizerGen) return;
          // Never commit from onend — the grace timer owns commits. Re-arm a
          // fresh recognizer if still in a listening turn.
          if (_tvListening) _tvRearmRecognition();
        };
        rec.onerror = function (e) {
          if (_tvRec !== rec || gen !== _tvRecognizerGen) return;
          if (e && e.error === 'aborted') return;
          if (e && (e.error === 'no-speech' || e.error === 'network')) {
            if (_tvListening) _tvRearmRecognition();
            return;
          }
          _tvStopRecognition();
          _tvSetOrb('is-error');
          _tvStatus('I couldn\'t hear you — listening will retry');
          if (typeof window.showToast === 'function') {
            window.showToast('I couldn\'t hear you clearly — trying again.', 'info');
          }
          if (!_tvPaused) _tvScheduleRelisten();
        };

        rec.start();
      } catch (err) {
        _tvListening = false;
        _tvStopMicAnalyser();
        _tvStopAmp(true);
        _tvSetOrb('is-error');
        _tvStatus('Couldn\'t start voice input');
      }
    }

    // The orb is an indicator + optional control. Hands-free listening is the
    // default, so tapping only PAUSES listening, barges in mid-reply, or
    // resumes after a pause/error.
    if (orb) {
      orb.addEventListener('click', function () {
if (_tvListening) {
          _tvPaused = true;
          _tvStopRecognition();
          _tvSetOrb('is-idle');
          _tvStatus('Paused — tap to resume hands-free listening');
          if (typeof window.showToast === 'function') {
            window.showToast('AI tutor paused. Tap the orb to start listening again.', 'info');
          }
          return;
        }
        // Voice exchange in flight — barge in: cut the stream + audio
        // instantly so our next utterance can take over.
        if (_tvStreamCtrl || _tvAskPlaying || _tvAskQueue.length) {
          _tvAskStreamAbortCleanup();
        }
        if (window.chatIsBusy && window.chatIsBusy()) {
          if (window.chatAbort) window.chatAbort();
          var ns = (typeof window.srNarrationState === 'function') ? window.srNarrationState() : null;
          if (ns && ns.stop) { try { ns.stop(); } catch (e) {} }
        }
        if (window.srVoiceAbort) { try { window.srVoiceAbort(); } catch (e) {} }
        _tvPaused = false;
        _tvUnlockAudio();
        if (!_tvListening) _tvStartRecognition();
      });
      window._tvStopRecognition = _tvStopRecognition;
    }

    /* ── Hands-free loop ──────────────────────────────────────────────────
       Listening starts automatically and re-arms by itself — after each
       spoken reply, after transient recognizer errors, and when the page
       becomes visible again. The orb is only ever a *pause / resume* control.
       The very first start also doubles as the mic-permission prompt. */
    function _tvUnlockAudio() {
      try {
        var aCtx = (typeof window.__askAudioCtx === 'function') ? window.__askAudioCtx() : null;
        if (aCtx && aCtx.state === 'suspended') aCtx.resume();
        var rEl = (typeof window.srReplyAudioEl === 'function') ? window.srReplyAudioEl() : null;
        if (rEl) {
          if (!rEl.src) rEl.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
          rEl.muted = true;
          var p = rEl.play();
          if (p && p.then) p.then(function () { try { rEl.pause(); rEl.currentTime = 0; rEl.muted = false; } catch (e) {} }).catch(function () {});
        }
      } catch (e) {}
    }
    // First user gesture anywhere on the page unlocks audio playback for the
    // whole origin, so the reply TTS isn't blocked by autoplay policy. Bound
    // once per page load, not per tab mount.
    if (!_tvUnlockOnce) {
      _tvUnlockOnce = true;
      document.addEventListener('pointerdown', function () {
        _tvUnlockAudio();
      }, { once: true, passive: true });
    }

    // Re-arm listening when the page/tab becomes visible again. Rebound every
    // mount so it closes over THIS mount's live loop state.
    if (_tvVisHandler) document.removeEventListener('visibilitychange', _tvVisHandler);
    _tvVisHandler = function () {
      if (!document.hidden && !_tvPaused) {
        _tvScheduleRelisten();
      }
    };
    document.addEventListener('visibilitychange', _tvVisHandler);

    function _tvScheduleRelisten() {
      if (_tvPaused || _tvSpeaking) return;
      if (_tvListening && _tvRec) return;
      if (_tvStreamCtrl || _tvAskPlaying || _tvAskQueue.length) return;
      if (document.hidden) return;
      if (_isCoarse && !_tvSpokenOnce) return;
      if (_tvRelistenTimer) return;
      _tvRelistenTimer = setTimeout(function () {
        _tvRelistenTimer = null;
        if (_tvPaused || _tvSpeaking) return;
        if (_tvListening && _tvRec) return;
        if (_tvStreamCtrl || _tvAskPlaying || _tvAskQueue.length) return;
        if (document.hidden) return;
        _tvStartRecognition();
      }, 600);
    }

    // Boot the hands-free loop: listening starts immediately, no tap needed.
    // (On coarse/touch pointers, after that we only re-listen on demand or
    // after a real spoken exchange — the recognizer's own re-arms are capped.)
    if (!document.hidden) _tvStartRecognition();
  }

  /* ── Spoken mode commands — replace the old physical toggle chips. ──────
   The student activates a mode by saying an encoded keyword aloud; the
   matched command is then delivered to the agent as a mode-switch "tool
   call" (mode field on the ask-stream request + a seed prompt), so the
   agent runs the session in that style until a different keyword is said.
   chat   → normal open exchanges.
   quiz   → one question at a time, scored, rounds of 15 with score
            announced out loud at the end of each round.
   explain→ one concept at a time, step by step. */
var _tvModeLabels = { chat: 'Chat', quiz: 'Quiz', explain: 'Explain' };
function _tvModeLabel(mode) { return _tvModeLabels[mode] || 'Chat'; }

var _tvModeKeywords = {
  // Phrase keywords match anywhere; single words match on word boundaries so
  // "explain" inside "any explain-y tangent" never false-triggers.
  quiz: [
    'quiz me', 'start the quiz', 'start quiz', 'begin the quiz', 'begin quiz',
    'take a quiz', 'take the quiz', 'enter quiz mode', 'quiz mode', 'quiz time',
    "let's quiz", 'lets quiz', 'start a quiz', 'start a quiz on',
    'start quizzing', 'ask me questions', 'quiz me on'
  ],
  explain: [
    'explain mode', 'enter explain mode', 'start explaining', 'explain step by step',
    'explain it step by step', 'walk me through it', 'walk me through',
    'break it down', 'break this down', 'teach me step by step',
    'explain this to me', 'explain to me', 'explain'
  ],
  chat: [
    'chat mode', 'back to chat', 'switch to chat', 'go back to chat',
    'normal chat', 'talk normally', 'exit quiz', 'stop the quiz', 'stop quiz',
    'end the quiz', 'end quiz', 'quit the quiz', 'cancel quiz',
    'no more questions', 'stop asking questions', "let's just talk",
    'lets just talk', 'stop'
  ]
};

function _tvMatchKeyword(lowerText, kw) {
  if (kw.indexOf(' ') !== -1) return lowerText.indexOf(kw) !== -1;
  var safe = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(^|[^a-z])' + safe + '([^a-z]|$)').test(lowerText);
}

// Returns { mode, keyword, before, after } for the first matching keyword, or
// null when the utterance is not a mode-switch command.
function _tvDetectModeCommand(utterance) {
  var t = (utterance || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!t) return null;
  var order = ['quiz', 'explain', 'chat'];
  for (var i = 0; i < order.length; i++) {
    var mode = order[i];
    var kws = _tvModeKeywords[mode];
    for (var j = 0; j < kws.length; j++) {
      var kw = kws[j];
      if (!_tvMatchKeyword(t, kw)) continue;
      var idx = t.indexOf(kw);
      var after = t.slice(idx + kw.length).replace(/^[,.\s!?]+|[,.\s!?]+$/g, ' ').trim();
      var before = t.slice(0, idx).replace(/^[,.\s!?]+|[,.\s!?]+$/g, ' ').trim();
      // "don't quiz me", "why explain that" etc. are not mode commands —
      // skip this keyword when the lead-in negates or questions the intent.
      if (/^(don't|do not|no|never|not|why|shouldn't|should not|stop|quit|please don't|please do not)\s*$/i.test(before)) continue;
      return { mode: mode, keyword: kw, before: before, after: after };
    }
  }
  return null;
}

// Tail after the keyword becomes the topic scope ("quiz me on the water
// cycle" → subject "the water cycle"). Returns '' when there is none.
function _tvSubjectFromAfter(after) {
  var s = (after || '').replace(/^[\s,]+/, '').replace(/[,.\s!?]+$/, '').trim();
  if (!s) return '';
  var conn = s.match(/^(on|about|for|over|regarding|the|of|in)\s+/i);
  if (conn) s = s.slice(conn[0].length).trim();
  if (!s || s.length > 90) return '';
  // Don't let a stray mode word slip in as the subject.
  if (_tvDetectModeCommand(s)) return '';
  return s;
}

function _tvBuildModeSeed(mode, subject) {
  if (mode === 'quiz') {
    return subject
      ? "Start a spoken quiz on '" + subject + "'. Ask me the first question on that topic now."
      : 'Start a spoken quiz. Ask me the first question from the material now.';
  }
  if (mode === 'explain') {
    return subject
      ? "Explain '" + subject + "' step by step, grounded in the material."
      : 'Start explaining the key concepts in this material, step by step.';
  }
  // chat — normal exchanges resume; a short ack keeps the agent in step.
  return 'Switch back to normal conversation mode.';
}

  function initFlashcardsTab(pane) {
    var PACK_ID = window.PACK_ID;

    // Generation percentage counter handle. Started when a flashcard
    // generation journey (two-step widget or the plain generate button)
    // shows the loading card, snapped to 100% when content lands.
    var _fcPctStop = null;
    function _fcPctStart() {
      if (_fcPctStop) { _fcPctStop(false); _fcPctStop = null; }
      _fcPctStop = _startGenPct('fcPct');
    }
    function _fcPctDone(snap) {
      if (_fcPctStop) { _fcPctStop(snap); _fcPctStop = null; }
    }

    // Initialize the floating topic filter on EVERY mount — not just when
    // cards are already present. If the deck is empty at mount time the pill
    // still mounts (empty state), and refreshes as soon as cards arrive.
    window._initFilterForTab({
      tabId: 'tab-flashcards',
      fetchType: 'flashcards',
      itemGetter: '_fcCards',
      renderFunc: function (filtered) {
        window.CARDS = filtered;
        window._fcCards = filtered;
        if (typeof window._fcInitDeck !== 'function') return;
        // Preserve the student's place in the deck instead of resetting to
        // card 1 on every filter change.
        var prevIdx = (typeof window._fcIdx === 'number') ? window._fcIdx : 0;
        window._fcInitDeck(filtered);
        if (filtered && filtered.length) {
          window._fcLoad(Math.min(prevIdx, filtered.length - 1));
        }
      },
      emptyElId: '#fcEmpty',
      totalElId: '#fcTotal',
      counterElId: '#fcCounter',
      stageElId: '#fcStage',
      badgeElSel: '.sr-badge-bar',
      indexGetter: function () { return (typeof window._fcIdx === 'number') ? window._fcIdx : 0; }
    });

    if (typeof window._fcCards !== 'undefined' && Array.isArray(window._fcCards) && window._fcCards.length) {
      if (typeof window._fcInitDeck === 'function') {
        window._fcInitDeck(window._fcCards);
      }
      var fcBadgeBar = pane.querySelector('.sr-badge-bar');
      if (fcBadgeBar) fcBadgeBar.style.display = '';
      if (window._initTopicPickerIfReady) window._initTopicPickerIfReady('fc', PACK_ID || window.PACK_ID);
      // Wait for MathJax typesetting before hiding spinner — skip if no math present.
      if (typeof window.motownTypesetMath === 'function' && /\$|\\|mathjax/i.test(pane.innerHTML)) {
        var p = window.motownTypesetMath(pane);
        if (p && typeof p.then === 'function') {
          p.then(function () { if (window.SrSpinner) window.SrSpinner.hide('tab-flashcards'); });
        } else {
          if (window.SrSpinner) window.SrSpinner.hide('tab-flashcards');
        }
      } else {
        if (window.SrSpinner) window.SrSpinner.hide('tab-flashcards');
      }
    } else {
      var fcLoadingEl = document.getElementById('fcLoading');
      var fcAlreadyLoading = fcLoadingEl && fcLoadingEl.style.display !== 'none';
      var empty = document.getElementById('fcEmpty');
      var stage = document.getElementById('fcStage');
      var nav = document.getElementById('fcNav');
      if (!fcAlreadyLoading) {
        if (empty) empty.style.display = 'flex';
      }
      if (stage) stage.style.display = 'none';
      if (nav) nav.style.display = 'none';
      var counter = document.getElementById('fcCounter');
      if (counter) counter.style.display = 'none';

      // Re-create two-step widget on every mount (fresh listeners for remount)
      var fcMount = document.getElementById('fcTwoStepMount');
      if (fcMount && typeof window._buildTwoStepGen === 'function') {
        fcMount.innerHTML = '';
        var widget = window._buildTwoStepGen({
          step1Html: '<div class="podcast-empty-icon" style="color:var(--primary,#4ecdc4);"><svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3.604 7.197l7.138 -3.109a0.96 .96 0 0 1 1.27 .527l4.924 11.902a1.004 1.004 0 0 1 -.514 1.304l-7.137 3.109a0.96 .96 0 0 1 -1.271 -.527l-4.924 -11.903a1.005 1.005 0 0 1 .514 -1.304z"/><path d="M15 4h1a1 1 0 0 1 1 1v3.5"/><path d="M20 6c.264 .112 .52 .217 .768 .315a1 1 0 0 1 .53 1.311l-2.298 5.374"/></svg></div><div class="podcast-empty-title">Get flashcards</div><div class="podcast-empty-sub">Generate cards from your uploaded slides or the video transcript. How many would you like?</div>',
          generateBtnLabel: 'Generate Flashcards',
          tiers: (function() {
            var cap = (window.USER_LIMITS && window.USER_LIMITS.study_gen_cap) || 5;
            return [
              { value: 5,  label: '5',   sub: 'Basic',    popular: cap >= 10 ? false : true  },
              { value: 10, label: '10',  sub: 'Standard', popular: cap >= 10 && cap < 35 ? true : false },
              { value: 35, label: '30+', sub: 'Starter',  popular: cap >= 35 && cap < 65 ? true : false },
              { value: 65, label: '60+', sub: 'Premium',  popular: cap >= 65 ? true : false  },
            ].filter(function(t) { return t.value <= cap; });
          })(),
          confirmLabel: 'Start Generating',
          onConfirm: function(count) {
            var genStatus  = document.getElementById('fcGenerateStatus');
            var fcLoadingEl = document.getElementById('fcLoading');
            var fcEmptyEl   = document.getElementById('fcEmpty');
            var csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
            if (fcEmptyEl)   fcEmptyEl.style.display   = 'none';
            if (fcLoadingEl) fcLoadingEl.style.display  = 'flex';
            _fcPctStart();
            fetch('/library/pack/' + PACK_ID + '/generate-flashcards', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
              body: JSON.stringify({ group_index: 0, force: true, video_id: null, card_count: count, topic: window._topicState.selected ? window._topicState.selected.title : null }),
            })
            .then(function(r) { return r.json(); })
            .then(function(data) {
              if (data.credit_balance !== undefined && typeof updateCreditsBar === 'function') {
                updateCreditsBar(data.credit_balance);
              }
              if (data.cycle_index != null && window._topicState) {
                window._topicState.cycleIndex = data.cycle_index;
                if (typeof _updateAllTopicLabels === 'function') {
                  var labels = document.querySelectorAll('#srTopicLabelBar');
                  _updateAllTopicLabels(labels);
                }
              }
              if (!data.ok) {
                _fcPctDone(false);
                if (fcLoadingEl) fcLoadingEl.style.display = 'none';
                if (fcEmptyEl)   fcEmptyEl.style.display   = 'flex';
                if (data.quota_exceeded) {
                  if (genStatus) genStatus.textContent = '';
                  if (window.maybeShowCreditsExhausted && window.maybeShowCreditsExhausted(data, 'flashcards')) {
                    return;
                  }
                  if (typeof window.showQuotaModal === 'function') {
                    window.showQuotaModal({
                      resource: 'flashcards',
                      used: data.used,
                      limit: data.limit,
                      resetsInSeconds: data.resets_in_seconds, tier: data.tier,
                    });
                  } else if (typeof window.openUpgradeModal === 'function') {
                    window.openUpgradeModal();
                  }
                  return;
                }
                if (genStatus) genStatus.textContent      = '\u26A0 ' + (data.error || 'Generation failed');
                return;
              }
              if (data.status === 'done') {
                _fcInjectContent(data.flashcards, data.resource_id);
                return;
              }
              if (data.status === 'already_done') {
                if (fcLoadingEl) fcLoadingEl.style.display = 'none';
                fetch('/library/pack/' + PACK_ID + '/resource-content?type=flashcards&group=0')
                  .then(function(r) { return r.json(); })
                  .then(function(cd) {
                    if (cd.ok && cd.content && cd.content.flashcards) {
                      _fcInjectContent(cd.content.flashcards, cd.resource_id);
                    }
                  });
                return;
              }
              var src = data.context_source === 'document' ? '\uD83D\uDCC4 Document' : '\uD83C\uDFAC Transcript';
              if (genStatus) genStatus.textContent = src + ' \u00B7 generating ' + count + ' cards\u2026';
              _fcFastPoll = true;
              _fcPollDelay = 4000;
              _fcPollCount = 0;
              _fcPollStart = Date.now();
              _fcPoll();
            })
.catch(function() {
              _fcPctDone(false);
              if (fcLoadingEl) fcLoadingEl.style.display = 'none';
              if (fcEmptyEl)   fcEmptyEl.style.display   = 'flex';
              if (genStatus)   genStatus.textContent      = '⚠ Network error. Please try again.';
            });
          },
        });
        fcMount.appendChild(widget);
      }

      if (window._initTopicPickerIfReady) window._initTopicPickerIfReady('fc', PACK_ID || window.PACK_ID);

      // One-time listener + poller setup (guard reset on unmount)
      if (pane.getAttribute('data-listeners') === 'true') return;
      pane.setAttribute('data-listeners', 'true');

      // Start poller and wire generate button if on a pack page
      if (PACK_ID) {
        var genBtn = document.getElementById('fcGenerateBtn');
        var genStatus = document.getElementById('fcGenerateStatus');
        var fcLoadingEl = document.getElementById('fcLoading');
        var fcEmptyEl = document.getElementById('fcEmpty');

        // Clear any stale poller from a previous mount cycle
        var _fcPollTimer;
        var _fcFastPoll = false;
        var _fcPollCount = 0;
        var _fcPollStart = Date.now();
        var _fcPollDelay = 8000;

        function _fcInjectContent(cards, resourceId) {
          _fcPctDone(true);
          window.CARDS = cards;
          window._fcCards = cards;
          if (resourceId) window._fcResourceId = resourceId;
          if (window.SrAppendOverlay) window.SrAppendOverlay.hide('tab-flashcards');
          var fcMoreBtnEl = document.getElementById('fcMoreBtn');
          if (fcMoreBtnEl) { fcMoreBtnEl.disabled = false; fcMoreBtnEl.classList.remove('sr-more-loading'); }
          if (fcLoadingEl) fcLoadingEl.style.display = 'none';
          if (fcEmptyEl)   fcEmptyEl.style.display   = 'none';
          var s = document.getElementById('fcStage');
          var n = document.getElementById('fcNav');
          var c = document.getElementById('fcCounter');
          if (s) s.style.display = '';
          if (n) n.style.display = '';
          if (c) c.style.display = '';
          var fcBB = pane.querySelector('.sr-badge-bar');
          if (fcBB) fcBB.style.display = '';
          if (typeof window._fcInitDeck === 'function') window._fcInitDeck(cards);
          if (window._refreshAssessmentFilter) window._refreshAssessmentFilter('tab-flashcards');
        }

        function _fcPoll() {
          _fcPollCount++;
          fetch('/library/pack/' + PACK_ID + '/resource-status')
            .then(function (r) {
              if (r.status === 429) {
                _fcPollDelay = Math.min(_fcPollDelay * 2, 60000);
                _fcPollTimer = setTimeout(_fcPoll, _fcPollDelay);
                return null;
              }
              return r.json();
            })
            .then(function (data) {
              if (!data) return;
              var statuses = data.statuses || {};
              var doneKey = Object.keys(statuses).find(function (k) {
                return k.startsWith('flashcards:group:') && statuses[k] === 'done';
              });
              if (doneKey) {
                fetch('/library/pack/' + PACK_ID + '/resource-content?type=flashcards&group=0')
                  .then(function(r) { return r.json(); })
                  .then(function(cd) {
                    if (cd.ok && cd.content && cd.content.flashcards) {
                      _fcInjectContent(cd.content.flashcards, cd.resource_id);
                    } else {
                      window.location.reload();
                    }
                  })
                  .catch(function() { window.location.reload(); });
                return;
              }
              var failKey = Object.keys(statuses).find(function (k) {
                return k.startsWith('flashcards:group:') && statuses[k] === 'failed';
              });
              if (failKey) {
                _fcPctDone(false);
                var errMsg = statuses[failKey + '_error'] || 'Generation failed. Try again.';
                if (genStatus) genStatus.textContent = '⚠ ' + errMsg;
                if (genBtn) { genBtn.style.display = ''; genBtn.disabled = false; genBtn.textContent = 'Try Again'; }
                _fcFastPoll = false;
                return;
              }
              if (_fcFastPoll && Date.now() - _fcPollStart > 60000) {
                if (genStatus) genStatus.textContent = '⏳ Still generating… check console (F12) for details.';
              }
              _fcPollDelay = _fcFastPoll ? 4000 : 8000;
              _fcPollTimer = setTimeout(_fcPoll, _fcPollDelay);
            })
            .catch(function () {
              _fcPollTimer = setTimeout(_fcPoll, _fcPollDelay);
            });
        }

        if (genBtn) {
          genBtn.addEventListener('click', function () {
            genBtn.disabled = true;
            genBtn.textContent = 'Generating…';
            if (genStatus) genStatus.textContent = 'This usually takes 15–30 seconds.';
            if (fcEmptyEl) fcEmptyEl.style.display = 'none';
            if (fcLoadingEl) fcLoadingEl.style.display = 'flex';
            _fcPctStart();

            var numCards = (window.USER_LIMITS && window.USER_LIMITS.study_gen_cap) || 15;
            var csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
            fetch('/library/pack/' + PACK_ID + '/generate-flashcards', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrf,
              },
              body: JSON.stringify({ group_index: 0, force: true, video_id: null, card_count: numCards }),
            })
            .then(function(r) { return r.json(); })
            .then(function(data) {
              if (data.credit_balance !== undefined && typeof updateCreditsBar === 'function') {
                updateCreditsBar(data.credit_balance);
              }
              if (data.cycle_index != null && window._topicState) {
                window._topicState.cycleIndex = data.cycle_index;
                if (typeof _updateAllTopicLabels === 'function') {
                  var labels = document.querySelectorAll('#srTopicLabelBar');
                  _updateAllTopicLabels(labels);
                }
              }
              if (!data.ok) {
                _fcPctDone(false);
                if (genStatus) genStatus.textContent = '⚠ ' + (data.error || 'Generation failed');
                genBtn.disabled = false;
                genBtn.textContent = 'Try Again';
                return;
              }
              if (data.status === 'done') {
                genBtn.style.display = 'none';
                _fcInjectContent(data.flashcards, data.resource_id);
                return;
              }
              if (data.status === 'already_done') {
                genBtn.style.display = 'none';
                if (fcLoadingEl) fcLoadingEl.style.display = 'none';
                fetch('/library/pack/' + PACK_ID + '/resource-content?type=flashcards&group=0')
                  .then(function(r) { return r.json(); })
                  .then(function(cd) {
                    if (cd.ok && cd.content && cd.content.flashcards) {
                      _fcInjectContent(cd.content.flashcards, cd.resource_id);
                    }
                  });
                return;
              }
              var src = data.context_source === 'document'
                ? '📄 Using your uploaded document (' + (data.card_count_target || numCards) + ' cards)'
                : '🎬 Using video transcript (' + numCards + ' cards)';
              if (genStatus) genStatus.textContent = src + ' — polling for completion…';
              genBtn.style.display = 'none';
              if (fcEmptyEl) fcEmptyEl.style.display = 'none';
              if (fcLoadingEl) fcLoadingEl.style.display = 'flex';

              clearTimeout(_fcPollTimer);
              _fcFastPoll = true;
              _fcPollDelay = 4000;
              _fcPollCount = 0;
              _fcPollStart = Date.now();
              _fcPoll();
            })
            .catch(function() {
              _fcPctDone(false);
              if (genStatus) genStatus.textContent = '⚠ Network error. Please try again.';
              genBtn.disabled = false;
              genBtn.textContent = 'Try Again';
            });
          });

          // Auto-start generation the first time an empty flashcards tab opens
          // while the student is eligible (credits or remaining plan allowance)
          // and no job is already running (re-fire guard).
          if (!window.__srAutoGenFc
              && _srGenEligible('flashcards')
              && !fcAlreadyLoading
              && !_srResourceInFlight('flashcards')) {
            window.__srAutoGenFc = true;
            genBtn.click();
          }
        }
      }
    }
    _dismissOverlay('flashcards');
  }

  function initQuizTab(pane) {
    if (typeof window._qzData !== 'undefined' && Array.isArray(window._qzData) && window._qzData.length) {
      window._qzNavWired = false;
      // _qzRerender re-shows the quiz at the current question without wiping answers;
      // fall back to renderQuiz only if _qzQ hasn't been populated yet (first load).
      if (typeof window._qzRerender === 'function' && window._qzRerender()) {
        // re-rendered with answers intact
      } else if (typeof window.renderQuiz === 'function') {
        window.renderQuiz(window._qzData);
      }
      if (typeof window._qzEnsureTimer === 'function') {
        window._qzEnsureTimer();
      }
      // Quiz uses its own richer pill (export/regen/delete/edit) from
      // topic-filter.js (quizFilterPill) — skip the reusable assessment
      // filter here to avoid stacking two fixed FABs at the same corner.
      /*
      window._initFilterForTab({
        tabId: 'tab-quiz',
        fetchUrl: function () { 
          var pid = window.PACK_ID || window.__PACK_ID__; 
          return pid ? '/library/api/pack/' + pid + '/questions' : null; 
        },
        itemGetter: '_quizMergedItems',
        applyFilter: function (filtered) {
          if (typeof window.renderQuiz === 'function') window.renderQuiz(filtered);
          window._qzData = filtered;
        },
        emptyElId: '#qzEmpty',
        totalElId: '#qzTotal',
        counterElId: '#qzCounter',
        stageElId: '#qzStage',
        badgeElSel: '.sr-badge-bar'
      });
      */
      var qzBadgeBar = pane.querySelector('.sr-badge-bar');
      if (qzBadgeBar) qzBadgeBar.style.display = '';
      if (typeof window.motownTypesetMath === 'function' && /\$|\\|mathjax/i.test(pane.innerHTML)) {
        var p = window.motownTypesetMath(pane);
        if (p && typeof p.then === 'function') {
          p.then(function () { if (window.SrSpinner) window.SrSpinner.hide('tab-quiz'); });
        } else {
          if (window.SrSpinner) window.SrSpinner.hide('tab-quiz');
        }
      } else {
        if (window.SrSpinner) window.SrSpinner.hide('tab-quiz');
      }
    } else {
      var qzStage = document.getElementById('qzStage');
      if (qzStage) qzStage.style.display = 'none';
      var qzNav = document.getElementById('qzNav');
      if (qzNav) qzNav.style.display = 'none';
      var qzCounter = document.getElementById('qzCounter');
      if (qzCounter) qzCounter.style.display = 'none';
      var qzMoreRow = document.getElementById('qzMoreRow');
      if (qzMoreRow) qzMoreRow.style.display = 'none';
      var qzTotal = document.getElementById('qzTotal');
      if (qzTotal) qzTotal.textContent = '0';
      var qzLoadingEl = document.getElementById('qzLoading');
      var qzAlreadyLoading = qzLoadingEl && qzLoadingEl.style.display !== 'none';
      var qzEmpty = document.getElementById('qzEmpty');
      if (!qzAlreadyLoading && qzEmpty) {
        qzEmpty.style.display = 'flex';
      }

      // Re-create two-step widget on every mount (fresh listeners for remount)
      var qzMount = document.getElementById('qzTwoStepMount');
      if (qzMount && typeof window._buildTwoStepGen === 'function') {
        qzMount.innerHTML = '';
        var widget = window._buildTwoStepGen({
          step1Html: '<div class="podcast-empty-icon" style="color:var(--primary,#4ecdc4);"><svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg></div><div class="podcast-empty-title">Get quiz questions</div><div class="podcast-empty-sub">Generate MCQ questions from the video or your uploaded slides. How many would you like?</div>',
          generateBtnLabel: 'Generate Quiz',
          tiers: (function() {
            var cap = (window.USER_LIMITS && window.USER_LIMITS.study_gen_cap) || 5;
            return [
              { value: 5,  label: '5',   sub: 'Basic',    popular: cap >= 10 ? false : true  },
              { value: 10, label: '10',  sub: 'Standard', popular: cap >= 10 && cap < 35 ? true : false },
              { value: 35, label: '30+', sub: 'Starter',  popular: cap >= 35 && cap < 65 ? true : false },
              { value: 65, label: '60+', sub: 'Premium',  popular: cap >= 65 ? true : false  },
            ].filter(function(t) { return t.value <= cap; });
          })(),
          confirmLabel: 'Start Generating',
          onConfirm: function(count) {
            if (typeof window.generateQuiz === 'function') {
              var origRenderQuiz = window.renderQuiz;
              window.renderQuiz = function(questions) {
                if (origRenderQuiz) origRenderQuiz(questions);
                if (qzMount._widget && qzMount._widget.enableWidget) qzMount._widget.enableWidget();
                window.renderQuiz = origRenderQuiz;
              };
              window.generateQuiz(count);
            }
          },
        });
        qzMount.appendChild(widget);
        qzMount._widget = widget;
      }
      if (typeof window._wireQzGenBtn === 'function') window._wireQzGenBtn();
      // Poll for background-generated quiz content
      if (window.PACK_ID && !window._qzPollStarted) {
        window._qzPollStarted = true;
        window._qzPoller = _pollResource(window.PACK_ID, 'quiz', {
          onEmpty: function() {
            var qzEmpty = document.getElementById('qzEmpty');
            var qzLoading = document.getElementById('qzLoading');
            if (qzEmpty && !(qzLoading && qzLoading.style.display !== 'none')) {
              qzEmpty.style.display = 'flex';
            }
            if (window.SrSpinner) window.SrSpinner.hide('tab-quiz');
          },
          onData: function(res) {
            var questions = (res.content && (res.content.quiz || res.content.questions)) || [];
            if (!questions.length) return;
            window._qzData = questions;
            if (res.resource_id) window._qzResourceId = res.resource_id;
            if (typeof window.renderQuiz === 'function') {
              var qzEmpty = document.getElementById('qzEmpty');
              var qzStage = document.getElementById('qzStage');
              var qzLoading = document.getElementById('qzLoading');
              if (qzEmpty) qzEmpty.style.display = 'none';
              if (qzStage) qzStage.style.display = '';
              if (qzLoading) qzLoading.style.display = 'none';
              var qzBB = pane.querySelector('.sr-badge-bar');
              if (qzBB) qzBB.style.display = '';
              window.renderQuiz(questions);
              if (typeof window._qzEnsureTimer === 'function') {
                window._qzEnsureTimer();
              }
              if (window.SrAppendOverlay) window.SrAppendOverlay.hide('tab-quiz');
              var qzMoreBtn = document.getElementById('qzMoreBtn');
              if (qzMoreBtn) { qzMoreBtn.disabled = false; qzMoreBtn.classList.remove('sr-more-loading'); }
              requestAnimationFrame(function() { _dismissOverlay('quiz'); });
            }
          },
          onFail: function() {
            var qzEmpty = document.getElementById('qzEmpty');
            if (qzEmpty) qzEmpty.style.display = 'flex';
            if (window.SrSpinner) window.SrSpinner.hide('tab-quiz');
          },
        });
      }
      if (window._initTopicPickerIfReady) window._initTopicPickerIfReady('qz', window.PACK_ID);

      // Auto-start generation the first time an empty quiz tab opens while the
      // student is eligible (credits or remaining plan allowance) and no job is
      // already running (re-fire guard).
      if (window.PACK_ID
          && !window.__srAutoGenQz
          && _srGenEligible('quiz')
          && !qzAlreadyLoading
          && !_srResourceInFlight('quiz')
          && typeof window.generateQuiz === 'function') {
        window.__srAutoGenQz = true;
        window.generateQuiz();
      }
    }

    // Listener wiring — runs once per mount cycle (guard reset on unmount)
    if (pane.getAttribute('data-listeners') === 'true') return;
    pane.setAttribute('data-listeners', 'true');

    // qzPrev / qzNext are wired inside renderQuiz (quiz engine) — redundant here
    // Wire qzMoreBtn here (not at page load) because its element is inside a
    // <template> tag and isn't in the DOM until mountTab clones it in.
    if (typeof window._qzWireMoreBtn === 'function') window._qzWireMoreBtn();
  }


  // ── Assessment Filter Initialization ──────────────────────────────────
  /**
   * Initialize the floating topic filter for a given assessment tab.
   * 
   * @param {object} opts       - { tabId, fetchType, itemGetter, renderFunc, emptyElId, totalElId, counterElId, stageElId, badgeElSel }
   */
  window._initFilterForTab = function (opts) {
    var composedFetchUrl = typeof opts.fetchUrl === 'function' 
      ? opts.fetchUrl 
      : function () { return '/library/pack/' + (window.PACK_ID || window.__PACK_ID__) + '/resource-content?type=' + opts.fetchType + '&group=0'; };
    
    var tabModule = initAssessmentFilter({
      fetchUrl: composedFetchUrl,
      getItems: typeof opts.itemGetter === 'function' ? opts.itemGetter : function () { return window[opts.itemGetter] || []; },
      applyFilter: opts.applyFilter || function (filtered) {
        if (typeof opts.renderFunc === 'function') opts.renderFunc(filtered);
      },
      getEmptyEl: opts.emptyElId ? function () { return document.querySelector(opts.emptyElId); } : null,
      getTotalEl: opts.totalElId ? function () { return document.querySelector(opts.totalElId); } : null,
      getCounterEl: opts.counterElId ? function () { return document.querySelector(opts.counterElId); } : null,
      getStageEl: opts.stageElId ? function () { return document.querySelector(opts.stageElId); } : null,
      getBadgeEl: opts.badgeElSel ? function () { return document.querySelector(opts.badgeElSel); } : null,
      tabId: opts.tabId,
      itemTopicProp: 'topic_slug'
    });
    
    // Fetch topics and create the filter pill DOM
    if (typeof tabModule.fetchAndInit === 'function') {
      tabModule.fetchAndInit();
    } else {
      // Fallback: create pill immediately if fetchAndInit is not available
      if (typeof tabModule.ensurePill === 'function') {
        tabModule.ensurePill();
      }
    }

    // Registry + refresh hook used when deck data arrives or grows ("+ more"):
    // re-fetches the server-computed topics so the popover always reflects
    // what is actually in the deck. refreshTopics never re-applies the filter,
    // so it can be called from render paths without looping.
    window._assessmentFilters = window._assessmentFilters || {};
    window._assessmentFilters[opts.tabId] = tabModule;
    window._refreshAssessmentFilter = function (tabId) {
      var m = window._assessmentFilters && window._assessmentFilters[tabId];
      if (m && typeof m.refreshTopics === 'function') m.refreshTopics();
    };

    // Share Regenerate / Delete with the rest of the assessment tabs.
    if (window._assessmentItemActions) {
      var aType = opts.fetchType || 'flashcards';
      window._assessmentItemActions.register(opts.tabId, {
        buttonClass: 'assessment-filter-pill__btn',
        labels: {
          regen: aType === 'fill_in' ? 'Regenerate exercise' : 'Regenerate card',
          del: aType === 'fill_in' ? 'Delete exercise' : 'Delete card',
          confirmTitle: aType === 'fill_in' ? 'Delete this exercise?' : 'Delete this card?',
          confirmBody: aType === 'fill_in'
            ? 'This exercise will be permanently removed from the deck.'
            : 'This card will be permanently removed from the deck.'
        },
        getFilterButton: function () {
          var el = document.getElementById(tabModule.pillBaseId);
          return el ? el.querySelector('[data-action="filter"]') : null;
        },
        resolveItem: function () {
          var items = window[opts.itemGetter] || [];
          var idx = (typeof opts.indexGetter === 'function') ? opts.indexGetter() : null;
          var item = (typeof idx === 'number' && idx >= 0 && idx < items.length) ? items[idx] : items[0];
          if (!item) return null;
          var rid = item.resource_id != null
            ? item.resource_id
            : (aType === 'fill_in' ? (window._fiResourceId || null) : (window._fcResourceId || null));
          return {
            resource_type: aType,
            resource_id: rid != null ? rid : null,
            item_index: item.item_index != null ? item.item_index : (typeof idx === 'number' ? idx : 0),
            fingerprint: (window._dedupKey || function () { return ''; })(item, aType),
            topic: item.topic || null
          };
        },
        refresh: function (done) { tabModule.fetchAndInit(done, true); },
        isDisabled: function () { return false; }
      });
    }

    return tabModule;
  };


  function initFillInTab(pane) {
    // Initialize the floating topic filter on EVERY mount (same reasoning as
    // the flashcards tab): mount the pill even when no exercises exist yet and
    // let it refresh as soon as data arrives or grows.
    // Fill-in content lives inside the #tab-more pane (see switch at the
    // top of this file), so the pill must mount there.
    window._initFilterForTab({
      tabId: 'tab-more',
      fetchType: 'fill_in',
      itemGetter: '_fiData',
      renderFunc: function (filtered) {
        var prevIdx = (typeof window._fiIdx === 'number') ? window._fiIdx : 0;
        window._fiData = filtered;
        if (typeof window.renderFillIns === 'function') {
          if (filtered && filtered.length) {
            // Preserve the student's place in the deck instead of resetting to
            // exercise 1 on every filter change or item refresh.
            window.renderFillIns(filtered, { resumeAt: Math.min(prevIdx, filtered.length - 1) });
          } else {
            window.renderFillIns(filtered);
          }
        }
      },
      emptyElId: '#fiEmpty',
      totalElId: '#fiTotal',
      counterElId: '#fiCounter',
      stageElId: '#fiStage',
      badgeElSel: '.sr-badge-bar',
      indexGetter: function () { return (typeof window._fiIdx === 'number') ? window._fiIdx : 0; }
    });

    if (typeof window._fiData !== 'undefined' && Array.isArray(window._fiData) && window._fiData.length) {
      if (typeof window.renderFillIns === 'function') {
        window.renderFillIns(window._fiData);
      }
      var fiBadgeBar = pane.querySelector('.sr-badge-bar');
      if (fiBadgeBar) fiBadgeBar.style.display = '';
      if (typeof window.motownTypesetMath === 'function' && /\$|\\|mathjax/i.test(pane.innerHTML)) {
        var p = window.motownTypesetMath(pane);
        if (p && typeof p.then === 'function') {
          p.then(function () { if (window.SrSpinner) window.SrSpinner.hide('tab-more'); });
        } else {
          if (window.SrSpinner) window.SrSpinner.hide('tab-more');
        }
      } else {
        if (window.SrSpinner) window.SrSpinner.hide('tab-more');
      }
    } else {
      var fiStage = document.getElementById('fiStage');
      if (fiStage) fiStage.style.display = 'none';
      var fiPrev = document.getElementById('fiPrev');
      var fiNext = document.getElementById('fiNext');
      if (fiPrev) fiPrev.style.display = 'none';
      if (fiNext) fiNext.style.display = 'none';
      var fiCounter = document.getElementById('fiCounter');
      if (fiCounter) fiCounter.style.display = 'none';
      var fiMoreRow = document.getElementById('fiMoreRow');
      if (fiMoreRow) fiMoreRow.style.display = 'none';
      var fiNav = document.getElementById('fiNav');
      if (fiNav) fiNav.style.display = 'none';
      var fiLoadingEl = document.getElementById('fiLoading');
      var fiAlreadyLoading = fiLoadingEl && fiLoadingEl.style.display !== 'none';
      var fiEmpty = document.getElementById('fiEmpty');
      if (!fiAlreadyLoading && fiEmpty) {
        fiEmpty.style.display = 'flex';
      }

      // Re-create two-step widget on every mount (fresh listeners for remount)
      var fiMount = document.getElementById('fiTwoStepMount');
      if (fiMount && typeof window._buildTwoStepGen === 'function') {
        fiMount.innerHTML = '';
        var widget = window._buildTwoStepGen({
          step1Html: '<div class="podcast-empty-icon" style="color:var(--primary,#4ecdc4);"><svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg></div><div class="podcast-empty-title">Get fill-in exercises</div><div class="podcast-empty-sub">Generate fill-in-the-blank exercises from the video or your uploaded slides. How many would you like?</div>',
          generateBtnLabel: 'Generate Fill-Ins',
          tiers: (function() {
            var cap = (window.USER_LIMITS && window.USER_LIMITS.study_gen_cap) || 5;
            return [
              { value: 5,  label: '5',   sub: 'Basic',    popular: cap >= 10 ? false : true  },
              { value: 10, label: '10',  sub: 'Standard', popular: cap >= 10 && cap < 35 ? true : false },
              { value: 35, label: '30+', sub: 'Starter',  popular: cap >= 35 && cap < 65 ? true : false },
              { value: 65, label: '60+', sub: 'Premium',  popular: cap >= 65 ? true : false  },
            ].filter(function(t) { return t.value <= cap; });
          })(),
          confirmLabel: 'Start Generating',
          onConfirm: function(count) {
            if (typeof window.generateFillIn === 'function') {
              var origRenderFillIns = window.renderFillIns;
              window.renderFillIns = function(questions) {
                if (origRenderFillIns) origRenderFillIns(questions);
                if (fiMount._widget && fiMount._widget.enableWidget) fiMount._widget.enableWidget();
                window.renderFillIns = origRenderFillIns;
              };
              window.generateFillIn(count);
            }
          },
        });
        fiMount.appendChild(widget);
        fiMount._widget = widget;
      }
      // Poll for background-generated fill-in content
      if (window.PACK_ID && !window._fiPollStarted) {
        window._fiPollStarted = true;
        window._fiPoller = _pollResource(window.PACK_ID, 'fill_in', {
          onEmpty: function() {
            var fiEmpty = document.getElementById('fiEmpty');
            var fiLoading = document.getElementById('fiLoading');
            if (fiEmpty && !(fiLoading && fiLoading.style.display !== 'none')) {
              fiEmpty.style.display = 'flex';
            }
            if (window.SrSpinner) window.SrSpinner.hide('tab-more');
          },
          onData: function(res) {
            var questions = (res.content && res.content.fill_in) || [];
            if (!questions.length) return;
            window._fiData = questions;
            if (res.resource_id) window._fiResourceId = res.resource_id;
            if (typeof window.renderFillIns === 'function') {
              var fiEmpty = document.getElementById('fiEmpty');
              var fiStage = document.getElementById('fiStage');
              var fiLoading = document.getElementById('fiLoading');
              if (fiEmpty) fiEmpty.style.display = 'none';
              if (fiStage) fiStage.style.display = '';
              if (fiLoading) fiLoading.style.display = 'none';
              var fiBB = pane.querySelector('.sr-badge-bar');
              if (fiBB) fiBB.style.display = '';
              window.renderFillIns(questions);
              if (window._refreshAssessmentFilter) window._refreshAssessmentFilter('tab-more');
              requestAnimationFrame(function() { _dismissOverlay('more'); });
            }
          },
          onFail: function() {
            var fiEmpty = document.getElementById('fiEmpty');
            if (fiEmpty) fiEmpty.style.display = 'flex';
            if (window.SrSpinner) window.SrSpinner.hide('tab-more');
          },
        });
      }
      if (window._initTopicPickerIfReady) window._initTopicPickerIfReady('fi', window.PACK_ID);

      // Auto-start generation the first time an empty fill-in tab opens while
      // the student is eligible (credits or remaining plan allowance) and no
      // job is already running (re-fire guard).
      if (window.PACK_ID
          && !window.__srAutoGenFi
          && _srGenEligible('fill_in')
          && !fiAlreadyLoading
          && !_srResourceInFlight('fill_in')
          && typeof window.generateFillIn === 'function') {
        window.__srAutoGenFi = true;
        window.generateFillIn();
      }
    }

    // Listener wiring — runs once per mount cycle (guard reset on unmount)
    if (pane.getAttribute('data-listeners') === 'true') return;
    pane.setAttribute('data-listeners', 'true');

    // Wire fiGenerateBtn and nav buttons
    if (typeof window._fiWireHandlers === 'function') {
      window._fiWireHandlers();
    }

    // Wire fiMoreBtn — the actual work lives in window._fiAppendMore
    // (fill_in_engine.js) so the guided-path promo can share it.
    var fiMoreBtn = document.getElementById('fiMoreBtn');
    var fiMoreStatus = document.getElementById('fiMoreStatus');
    if (fiMoreBtn) {
      fiMoreBtn.addEventListener('click', function() {
        if (typeof window._fiAppendMore === 'function') {
          window._fiAppendMore({ btn: fiMoreBtn, statusEl: fiMoreStatus });
        }
      });
    }
  }

  var origSwitchRoomTab = window.switchRoomTab;
  window.switchRoomTab = function (btn, targetId) {
    if (activeTabId === targetId) {
      if (origSwitchRoomTab) origSwitchRoomTab(btn, targetId);
      return;
    }

    if (activeTabId) {
      unmountTab(activeTabId);
    }

    if (origSwitchRoomTab) {
      origSwitchRoomTab(btn, targetId);
    }

    activeTabId = targetId;
    mountTab(targetId);
  };

  document.addEventListener('DOMContentLoaded', function () {
    var initialActive = document.querySelector('.room-vp--active');
    if (initialActive) {
      activeTabId = initialActive.id;
      if (initialActive.id === 'tab-upload') {
        _dismissOverlay('upload');
        initialActive.setAttribute('data-lazy-mounted', 'true');
      } else if (initialActive.id === 'tab-guided') {
        // Guided path is inline; just init the JS. The script is normally
        // injected by mountTab, which never runs for the already-active
        // default tab — so load it here or init() never fires and the pane
        // sits on "Loading study guide…" until the user switches tabs.
        initialActive.setAttribute('data-lazy-mounted', 'true');
        if (typeof window._guidedPathInit === 'function') {
          window._guidedPathInit();
        } else if (!document.querySelector('#tab-guided script[src*="guided-path"]')) {
          var s = document.createElement('script');
          s.src = '/static/js/guided-path.js?v=20260926z';
          document.body.appendChild(s);
        }
      } else {
        mountTab(initialActive.id);
      }
    }

    // Start background video-discovery watcher if no iframe yet.
    // This catches packs whose video pipeline is still running — the watcher
    // polls for completion, builds the tab DOM, and shows a notification banner
    // without any page reload.
    var packId = typeof PACK_ID !== 'undefined' ? PACK_ID : (typeof window.PACK_ID !== 'undefined' ? window.PACK_ID : null);
    if (packId && !document.querySelector('#tab-video iframe')) {
      _startVideoWatcher(packId);
    }
  });

  // ── Video navigation overlay + mobile nav bar ──
  function initVideoOverlay() {
    var overlay = document.getElementById('vtOverlay');
    if (!overlay) return;

    var playlist = document.getElementById('vtPlaylist');
    var items = playlist ? Array.from(playlist.querySelectorAll('li')) : [];
    if (items.length <= 1) return;

    var _hideTimer = null;
    var isTouch = window.matchMedia('(hover: none)').matches;
    var videoArea = overlay.parentElement;

    // Populate mobile nav count "1 of 3"
    var navCount = document.getElementById('vtNavCount');
    if (navCount) {
      var currentIdx = 0;
      var itemsArr = playlist ? Array.from(playlist.querySelectorAll('li')) : [];
      itemsArr.forEach(function(li, i) {
        if (li.dataset.active === '1') currentIdx = i + 1;
      });
      navCount.textContent = currentIdx + ' of ' + itemsArr.length;
    }

    function show() {
      if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; }
      overlay.classList.add('vt-overlay--visible');
    }

    function hide() {
      if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; }
      overlay.classList.remove('vt-overlay--visible');
    }

    function showTemporarily(delay) {
      show();
      _hideTimer = setTimeout(hide, delay);
    }

    // YouTube iframe sends postMessage on player state changes (play/pause/etc.)
    function onYouTubeMessage(e) {
      if (e.origin !== 'https://www.youtube.com') return;
      try {
        var data = JSON.parse(e.data);
        if (data.event === 'onStateChange') {
          showTemporarily(isTouch ? 5000 : 3000);
        }
      } catch (_) {}
    }
    window.addEventListener('message', onYouTubeMessage);

    if (!isTouch) {
      // Desktop: also respond to mousemove over the video area
      function inVideoArea(e) {
        var r = videoArea.getBoundingClientRect();
        return e.clientX >= r.left && e.clientX <= r.right &&
               e.clientY >= r.top && e.clientY <= r.bottom;
      }

      function onDesktopMove(e) {
        if (inVideoArea(e)) showTemporarily(3000);
      }
      document.addEventListener('mousemove', onDesktopMove);

      overlay.addEventListener('mouseenter', show);
      overlay.addEventListener('mouseleave', function() {
        showTemporarily(3000);
      });

      overlay._overlayCleanup = function() {
        window.removeEventListener('message', onYouTubeMessage);
        document.removeEventListener('mousemove', onDesktopMove);
      };
    } else {
      overlay._overlayCleanup = function() {
        window.removeEventListener('message', onYouTubeMessage);
      };
    }

    // Hide overlay when navigating to another video
    var _origNavigate = window.navigatePlaylist;
    if (_origNavigate) {
      window.navigatePlaylist = function(direction) {
        hide();
        _origNavigate(direction);
      };
    }
    }
})();
