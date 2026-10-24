// Study Room Flashcard Engine — player, fill-in data, quiz data, generation

;(function () {
  var cardsData = window.FC_CARDS_RAW || [];

  var CARDS = Array.isArray(cardsData) ? cardsData.filter(function(c) { return c && (c.front || c.question) && (c.back || c.answer); }) : [];
  window._fcCards = CARDS;
  window._fcResourceId = window.FC_RESOURCE_ID;

  // Deck state is module-scope so re-inits (topic filter, "more" appends)
  // swap the card list without stacking duplicate listeners/handlers.
  var _fcDeck = { cards: [], idx: 0, flipped: false, fcQpMap: new Map(), fcAuraEarned: 0, fcCorrectCount: 0, wired: false };
  var _fcEl = {};

  // ── LOAD SAVED FILL-IN QUESTIONS ──
  var fillInData = window.FI_RAW || [];
  window._fiData = Array.isArray(fillInData) ? fillInData.filter(function(f) { return f && (f.sentence || (Array.isArray(f.text_segments) && f.text_segments.length >= 2)); }) : [];
  window._fiResourceId = window.FI_RESOURCE_ID;

    if (Array.isArray(window._fiData) && window._fiData.length) {
    // Data is exposed as window._fiData; render happens on tab mount via room-tab-lazy.js
  } else {
    var fiEmpty = document.getElementById('fiEmpty');
    var fiStage = document.getElementById('fiStage');
    if (fiEmpty) fiEmpty.style.display = 'flex';
    if (fiStage) fiStage.style.display = 'none';
    var _fiPrev = document.getElementById('fiPrev');
    var _fiNext = document.getElementById('fiNext');
    if (_fiPrev) _fiPrev.style.display = 'none';
    if (_fiNext) _fiNext.style.display = 'none';
    var _fiCounterEl = document.getElementById('fiCounter');
    if (_fiCounterEl) _fiCounterEl.style.display = 'none';
    var _fiMoreRowEl = document.getElementById('fiMoreRow');
    if (_fiMoreRowEl) _fiMoreRowEl.style.display = 'none';
  }

  if (!CARDS.length) {
    var empty = document.getElementById('fcEmpty');
    var stage = document.getElementById('fcStage');
    var nav   = document.getElementById('fcNav');
    if (empty) empty.style.display = 'flex';
    if (stage) stage.style.display = 'none';
    if (nav)   nav.style.display   = 'none';
    var _fcCounterEl = document.getElementById('fcCounter');
    if (_fcCounterEl) _fcCounterEl.style.display = 'none';
    if (typeof PACK_ID !== 'undefined' && PACK_ID) {
      var _fcPollDelay = 8000;
      var _fcPollTimer;
      var _fcFastPoll = false;

      var _fcPollCount = 0;
      var _fcPollStart = Date.now();

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

            // Log to console for debugging
            if (_fcFastPoll && _fcPollCount <= 3) {
              console.log('[Flashcard Poll]', JSON.stringify(statuses));
            }

            var expectedKey = 'flashcards:group:' + (window.CURRENT_GROUP_INDEX || 0);
            if (statuses[expectedKey] === 'done') {
              window.location.reload();
              return;
            }
            if (statuses[expectedKey] === 'failed') {
              var errMsg = statuses[expectedKey + '_error'] || 'Generation failed. Try again.';
              if (genStatus) genStatus.textContent = '⚠ ' + errMsg;
              if (genBtn) { genBtn.style.display = ''; genBtn.disabled = false; genBtn.textContent = 'Try Again'; }
              _fcFastPoll = false;
              return;
            }
            // Timeout warning after 60s of fast-polling
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

      // Only start polling if there is actually a resource in-flight to wait for.
      // 'absent' means never started; no point polling for it.
      var _fcShouldPoll = (function() {
        var s = window.FC_RESOURCE_STATUS || {};
        var key = 'flashcards:group:' + (window.CURRENT_GROUP_INDEX || 0);
        var state = s[key];
        return state === 'pending' || state === 'generating';
      })();
      if (_fcShouldPoll) {
        _fcPollTimer = setTimeout(_fcPoll, _fcPollDelay);
        setTimeout(function () { clearTimeout(_fcPollTimer); }, 180000);
      }

      // ── Generate button ──
      var genBtn    = document.getElementById('fcGenerateBtn');
      var genStatus = document.getElementById('fcGenerateStatus');

      if (genBtn && typeof PACK_ID !== 'undefined' && PACK_ID) {
        genBtn.addEventListener('click', function () {
          genBtn.disabled = true;
          genBtn.textContent = 'Generating…';
          if (genStatus) genStatus.textContent = 'This usually takes 15–30 seconds.';

          fetch('/library/pack/' + PACK_ID + '/generate-flashcards', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Requested-With': 'fetch',
              'X-CSRFToken': (document.querySelector('meta[name="csrf-token"]') || {}).content || '',
            },
            body: JSON.stringify({ group_index: window.CURRENT_GROUP_INDEX || 0, force: false, video_id: VIDEO_ID || null, topic: window._topicState.selected ? window._topicState.selected.title : null, num_items: (window.USER_LIMITS && window.USER_LIMITS.study_gen_cap) || 15 }),
          })
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (!data.ok) {
              if (data.quota_exceeded) {
                genBtn.disabled = false;
                genBtn.textContent = 'Generate Flashcards';
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
                } else {
                  window.location.href = '/pricing';
                }
                return;
              }
              if (genStatus) genStatus.textContent = '⚠ ' + (data.error || 'Generation failed');
              genBtn.disabled = false;
              genBtn.textContent = 'Try Again';
              return;
            }
            if (data.cycle_index != null && window._topicState) {
              window._topicState.cycleIndex = data.cycle_index;
              if (typeof _updateAllTopicLabels === 'function') {
                var labels = document.querySelectorAll('#srTopicLabelBar');
                _updateAllTopicLabels(labels);
              }
            }
            if (data.status === 'done') {
              genBtn.style.display = 'none';
              window.CARDS = data.flashcards;
              window._fcCards = data.flashcards;
              window._fcResourceId = data.resource_id;
              var fcLoadingEl = document.getElementById('fcLoading');
              if (fcLoadingEl) fcLoadingEl.style.display = 'none';
              var fcEmptyEl = document.getElementById('fcEmpty');
              if (fcEmptyEl) fcEmptyEl.style.display = 'none';
              var s = document.getElementById('fcStage');
              var n = document.querySelector('.fc-nav');
              var c = document.getElementById('fcCounter');
              if (s) s.style.display = '';
              if (n) n.style.display = '';
              if (c) c.style.display = '';
              if (typeof window._fcInitDeck === 'function') window._fcInitDeck(data.flashcards);
              if (window._refreshAssessmentFilter) window._refreshAssessmentFilter('tab-flashcards');
              return;
            }
            if (data.status === 'already_done') {
              fetch('/library/pack/' + PACK_ID + '/resource-content?type=flashcards&group=' + (window.CURRENT_GROUP_INDEX || 0))
                .then(function(r) { return r.json(); })
                .then(function(cd) {
                  if (cd.ok) {
                    genBtn.style.display = 'none';
                    window.CARDS = cd.content.flashcards;
                    window._fcCards = cd.content.flashcards;
                    window._fcResourceId = cd.resource_id;
                    var fcLoadingEl = document.getElementById('fcLoading');
                    if (fcLoadingEl) fcLoadingEl.style.display = 'none';
                    var fcEmptyEl = document.getElementById('fcEmpty');
                    if (fcEmptyEl) fcEmptyEl.style.display = 'none';
                    var s = document.getElementById('fcStage');
                    var n = document.getElementById('fcNav');
                    var c = document.getElementById('fcCounter');
                    if (s) s.style.display = '';
                    if (n) n.style.display = '';
                    if (c) c.style.display = '';
                    if (typeof window._fcInitDeck === 'function') window._fcInitDeck(cd.content.flashcards);
                    if (window._refreshAssessmentFilter) window._refreshAssessmentFilter('tab-flashcards');
                  }
                });
              return;
            }
            var src = data.context_source === 'document'
              ? '📄 Using your uploaded document (' + data.card_count + ' cards)'
              : '🎬 Using video transcript (10 cards)';
            if (genStatus) genStatus.textContent = src + ' — polling for completion…';
            genBtn.style.display = 'none';
            var fcLoadingEl = document.getElementById('fcLoading');
            if (fcLoadingEl) fcLoadingEl.style.display = 'flex';
            _startGenPct('fcPct');

            clearTimeout(_fcPollTimer);
            _fcFastPoll = true;
            _fcPollDelay = 4000;
            _fcPollCount = 0;
            _fcPollStart = Date.now();
            _fcPoll();
          })
          .catch(function() {
            if (genStatus) genStatus.textContent = '⚠ Network error. Please try again.';
            genBtn.disabled = false;
            genBtn.textContent = 'Try Again';
          });
        });
      }

      // ── Generate Fill-Ins button wiring ──
      window.generateFillIns = function(count) {
        if (!window._chatSendTool) return;
        window._fiAppending = false;
        var numItems = count || ((window.USER_LIMITS && window.USER_LIMITS.study_gen_cap) || 15);
        window._chatSendTool('generate_fill_in', 'Please generate fill-in-the-blank exercises for this topic.', { num_items: numItems });
      };

      var fiGenBtnEl = document.getElementById('fiGenerateBtn');
      if (fiGenBtnEl) fiGenBtnEl.addEventListener('click', function () { window.generateFillIns(); });

      var qzGenBtnEl = document.getElementById('qzGenerateBtn');
      if (qzGenBtnEl && !qzGenBtnEl._qzWired) {
        qzGenBtnEl._qzWired = true;
        qzGenBtnEl.addEventListener('click', function () {
          if (typeof window.generateQuiz === 'function') window.generateQuiz();
        });
      }

      // fiMoreBtn is wired once in room-tab-lazy.js's initFillInTab — do not
      // re-wire here (a duplicate listener here used to cause double-fired
      // /generate-fill-ins/more requests whenever tab-more was the default tab).
    }
  }

  function fcUpdateBadgeBar() {
    var counts = { unfamiliar: 0, learning: 0, familiar: 0, mastered: 0 };
    _fcDeck.fcQpMap.forEach(function(p) { if (counts.hasOwnProperty(p.tier)) counts[p.tier]++; });
    _fcDeck.cards.forEach(function(c) {
      var k = (c && c._fcOriginIndex != null) ? c._fcOriginIndex : -1;
      if (k < 0 || !_fcDeck.fcQpMap.has(k)) counts.unfamiliar++;
    });
    counts.total = _fcDeck.cards.length;
    var bar = document.querySelector('#tab-flashcards .sr-badge-bar');
    if (!bar) return;
    var fcTIERS = ['unfamiliar','learning','familiar','mastered'];
    fcTIERS.forEach(function(t) {
      var el = bar.querySelector('#badge-' + t);
      if (el) el.textContent = counts[t];
    });
  }

  function fcRecordAnswer(deckIdx, correct) {
    var card = _fcDeck.cards[deckIdx];
    var qIdx = (card && card._fcOriginIndex != null) ? card._fcOriginIndex : deckIdx;
    if (correct) _fcDeck.fcCorrectCount++;
    var fcTIERS = ['unfamiliar','learning','familiar','mastered'];
    function fcNextTier(t) { var i = fcTIERS.indexOf(t); return i >= 0 && i < fcTIERS.length - 1 ? fcTIERS[i + 1] : t; }
    function fcPrevTier(t) { var i = fcTIERS.indexOf(t); return i > 0 ? fcTIERS[i - 1] : t; }
    var p = _fcDeck.fcQpMap.get(qIdx) || { tier: 'unfamiliar', streak: 0 };
    if (correct) {
      p.streak++;
      if (p.streak >= 1 && p.tier !== 'mastered') { p.tier = fcNextTier(p.tier); p.streak = 0; }
    } else {
      p.tier = fcPrevTier(p.tier); p.streak = 0;
    }
    _fcDeck.fcQpMap.set(qIdx, p);
    fcUpdateBadgeBar();
    var resId = window._fcResourceId, packId = window.PACK_ID;
    if (!resId || !packId) return;
    var csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
    fetch('/api/question-answer', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-CSRFToken': csrf},
      body: JSON.stringify({ pack_id: packId, resource_id: resId, item_type: 'flashcard', question_idx: qIdx, correct: correct })
    }).then(function(r){return r.json()}).then(function(data){
      if (!data.badges) return;
      var sp = _fcDeck.fcQpMap.get(qIdx);
      if (sp) { sp.tier = data.tier; sp.streak = data.streak; }
      var bar = document.querySelector('#tab-flashcards .sr-badge-bar');
      if (bar) {
        var herd = ['unfamiliar','learning','familiar','mastered'];
        herd.forEach(function(t) {
          var el = bar.querySelector('#badge-' + t);
          if (el) el.textContent = data.badges[t];
        });
      }
      if (data.promoted || data.demoted) {
        var badge = bar ? bar.querySelector('.sr-badge--' + data.tier) : null;
        if (badge) { badge.classList.remove('badge-bumping'); void badge.offsetWidth; badge.classList.add('badge-bumping'); }
      }
      if (data.xp_earned && correct) {
        _fcDeck.fcAuraEarned += data.xp_earned;
      }
    }).catch(function() {
      if (typeof window.showFatalErrorModal === 'function') {
        window.showFatalErrorModal('Failed to save your progress. Please try again.', function () {
          var csrfToken = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
          fetch('/api/question-answer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken },
            body: JSON.stringify({ pack_id: packId, resource_id: resId, item_type: 'flashcard', question_idx: qIdx, correct: correct })
          }).catch(function() {});
        });
      }
    });
  }

  function fcShowRoundComplete() {
    var doStartOver = function () {
      _fcDeck.fcAuraEarned = 0;
      _fcDeck.fcCorrectCount = 0;
      if (typeof window._fcLoad === 'function' && _fcDeck.cards.length) window._fcLoad(0);
    };
    var doMoreQuestions = function () {
      var btn = document.getElementById('fcMoreBtn');
      if (btn && !btn.disabled) { btn.click(); return; }
      doStartOver();
    };
    if (typeof window.showRoundSummary === 'function') {
      window.showRoundSummary('fcRoundSummary', _fcDeck.fcAuraEarned, { correct: _fcDeck.fcCorrectCount, total: _fcDeck.cards.length }, doStartOver, doMoreQuestions);
    } else {
      doStartOver();
    }
  }

  window._fcLoad = function load(i) {
    if (!_fcDeck.cards[i]) return;
    var forward = (_fcDeck.idx === i) ? true : i > _fcDeck.idx;
    _fcDeck.idx = i;
    window._fcIdx = i;
    // Suppress the flip-back CSS transition before resetting state.
    // On iOS/WebKit, `offsetWidth` reflows do not reliably cancel an
    // in-progress transition, so removing `.flipped` while a transition
    // is active causes the card to visibly flip back (180°→0°) before
    // the entrance animation plays — the "double flip" on iOS.
    _fcEl.front.style.transition = 'none';
    _fcEl.back.style.transition  = 'none';
    _fcDeck.flipped = false;
    _fcEl.front.classList.remove('flipped');
    _fcEl.back.classList.remove('flipped');
    void _fcEl.front.offsetWidth; // commit the instant reset before restoring transitions
    _fcEl.front.style.transition = '';
    _fcEl.back.style.transition  = '';
    _fcEl.question.textContent = _fcDeck.cards[i].front || _fcDeck.cards[i].question || '—';
    _fcEl.answer.textContent   = _fcDeck.cards[i].back || _fcDeck.cards[i].answer || '—';
    var animClass = forward ? 'fc-anim-enter-right' : 'fc-anim-enter-left';
    _fcEl.front.classList.remove('fc-anim-enter-right', 'fc-anim-enter-left');
    void _fcEl.front.offsetWidth;
    _fcEl.front.classList.add(animClass);
    if (_fcEl.current) _fcEl.current.textContent = i + 1;
    if (_fcEl.prevBtn) _fcEl.prevBtn.disabled = (i === 0);
    if (_fcEl.nextBtn) _fcEl.nextBtn.disabled = false;
    if (typeof window.motownTypesetMath === 'function') {
      window.motownTypesetMath(_fcEl.stage);
    }
  };

  function _fcFetchProgress() {
    var resId = window._fcResourceId;
    if (!resId) return;
    fetch('/api/question-progress?resource_id=' + resId + '&item_type=flashcard')
      .then(function(r) { return r.json(); })
      .then(function(rows) {
        rows.forEach(function(r) { _fcDeck.fcQpMap.set(r.question_idx, { tier: r.tier, streak: r.streak }); });
        fcUpdateBadgeBar();
      })
      .catch(function() {
        if (typeof window.showFatalErrorModal === 'function') {
          window.showFatalErrorModal('Failed to load study progress. Please try again.', _fcFetchProgress);
        }
      });
  }

  function _fcFlip() {
    _fcDeck.flipped = !_fcDeck.flipped;
    _fcEl.front.classList.toggle('flipped', _fcDeck.flipped);
    _fcEl.back.classList.toggle('flipped', _fcDeck.flipped);
  }

  function _fcWire() {
    if (_fcDeck.wired) return;
    _fcDeck.wired = true;

    // On iOS, a tap fires touchend then a synthetic click — guard against double-flip.
    var _fcTouchHandled = false;
    if (_fcEl.stage) _fcEl.stage.addEventListener('touchend', function (e) {
      if (e.target.closest('.fc-action-btn')) return;
      e.preventDefault();          // suppress the synthetic click that follows
      _fcTouchHandled = true;
      _fcFlip();
      setTimeout(function () { _fcTouchHandled = false; }, 600);
    }, { passive: false });
    if (_fcEl.stage) _fcEl.stage.addEventListener('click', function (e) {
      if (e.target.closest('.fc-action-btn')) return;
      if (_fcTouchHandled) return; // already handled by touchend
      _fcFlip();
    });

    if (_fcEl.gotItBtn) _fcEl.gotItBtn.addEventListener('click', function () {
      fcRecordAnswer(_fcDeck.idx, true);
      if (_fcDeck.idx < _fcDeck.cards.length - 1) window._fcLoad(_fcDeck.idx + 1);
      else fcShowRoundComplete();
    });
    if (_fcEl.dontKnowBtn) _fcEl.dontKnowBtn.addEventListener('click', function () {
      fcRecordAnswer(_fcDeck.idx, false);
      if (_fcDeck.idx < _fcDeck.cards.length - 1) window._fcLoad(_fcDeck.idx + 1);
      else fcShowRoundComplete();
    });

    if (_fcEl.prevBtn) _fcEl.prevBtn.addEventListener('click', function () { if (_fcDeck.idx > 0) window._fcLoad(_fcDeck.idx - 1); });
    if (_fcEl.nextBtn) _fcEl.nextBtn.addEventListener('click', function () {
      if (_fcDeck.idx < _fcDeck.cards.length - 1) window._fcLoad(_fcDeck.idx + 1);
      else window._fcLoad(0);
    });

    var moreBtn = document.getElementById('fcMoreBtn');
    if (moreBtn) moreBtn.addEventListener('click', function() {
      window._fcAppendMore({ btn: moreBtn, statusEl: document.getElementById('fcMoreStatus') });
    });

    document.addEventListener('keydown', function (e) {
      if (!document.getElementById('tab-flashcards')?.classList.contains('room-vp--active')) return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.code === 'Space') { e.preventDefault(); _fcFlip(); }
      if (e.key  === 'k' || e.key === 'K') { if (_fcEl.gotItBtn) _fcEl.gotItBtn.click(); }
      if (e.key  === 'd' || e.key === 'D') { if (_fcEl.dontKnowBtn) _fcEl.dontKnowBtn.click(); }
      if (e.key  === 'ArrowLeft')  { if (_fcEl.prevBtn) _fcEl.prevBtn.click(); }
      if (e.key  === 'ArrowRight' || e.key === 'Enter') { if (_fcEl.nextBtn) _fcEl.nextBtn.click(); }
    });
  }

  window._fcInitDeck = function _fcInitDeck(cards) {
    if (typeof window._dedupItems === 'function') {
      cards = window._dedupItems(cards, 'flashcards');
    }
    cards = (cards || []).filter(function(c) { return c && (c.front || c.question) && (c.back || c.answer); });
    window._fcCards = cards;
    _fcDeck.cards = cards;
    cards.forEach(function(c, i) { if (c._fcOriginIndex == null) c._fcOriginIndex = i; });

    _fcEl.front = document.getElementById('fcFront');
    _fcEl.back = document.getElementById('fcBack');
    _fcEl.question = document.getElementById('fcQuestion');
    _fcEl.answer = document.getElementById('fcAnswer');
    _fcEl.current = document.getElementById('fcCurrent');
    _fcEl.total = document.getElementById('fcTotal');
    _fcEl.prevBtn = document.getElementById('fcPrev');
    _fcEl.nextBtn = document.getElementById('fcNext');
    _fcEl.gotItBtn = document.getElementById('fcGotIt');
    _fcEl.dontKnowBtn = document.getElementById('fcDontKnow');
    _fcEl.stage = document.getElementById('fcStage');

    if (!_fcEl.front || !_fcEl.back || !_fcEl.question || !_fcEl.answer || !_fcEl.current || !_fcEl.total || !_fcEl.prevBtn || !_fcEl.nextBtn || !_fcEl.gotItBtn || !_fcEl.dontKnowBtn || !_fcEl.stage) {
      return;
    }

    _fcDeck.idx = 0;
    window._fcIdx = 0;
    _fcDeck.flipped = false;

    if (_fcEl.total) _fcEl.total.textContent = cards.length;

    var fcBar = document.querySelector('#tab-flashcards .sr-badge-bar');
    if (fcBar) fcBar.style.display = '';
    var fcCounterEl = document.getElementById('fcCounter');
    if (fcCounterEl) fcCounterEl.style.display = '';

    var MAX_CARDS = 30;
    var moreRow = document.getElementById('fcMoreRow');
    if (moreRow) moreRow.style.display = (cards.length > 0 && cards.length < MAX_CARDS) ? '' : 'none';

    _fcWire();

    window._fcLoad(0);
    _fcFetchProgress();
  };

  if (CARDS.length) {
    var fcStageEl = document.getElementById('fcStage');
    if (fcStageEl) window._fcInitDeck(CARDS);
  }

  // ── "+ more flashcards" ────────────────────────────────────────────────
  // Shared by the fcMoreBtn click handler and the guided-path "Want more
  // practice?" promo. Shows the blocking append overlay while the endpoint
  // runs. When the deck is empty, falls back to a fresh background generation
  // and polls for it ourselves (the fc tab only polls when a generation was
  // already in-flight at page load, so a runtime trigger needs its own poller).
  window._fcAppendMore = function (opts) {
    opts = opts || {};
    var btn = opts.btn || document.getElementById('fcMoreBtn');
    var moreStatus = opts.statusEl || document.getElementById('fcMoreStatus');
    var moreRow = document.getElementById('fcMoreRow');
    var MAX_CARDS = 30;
    var PACK = (typeof PACK_ID !== 'undefined') ? PACK_ID : window.PACK_ID;
    if (!PACK) return Promise.resolve(null);

    var limits = window.USER_LIMITS || {};
    var daily  = window.USER_DAILY  || {};
    var credits = window.USER_CREDITS || 0;
    if (credits <= 0) {
      var fcRemaining = (limits.flashcards_per_day || 0) - (daily.flashcards || 0);
      if (fcRemaining <= 0) {
        if (moreStatus) moreStatus.textContent = '⚠ Daily limit reached — upgrade for more';
        if (moreRow) moreRow.style.display = 'none';
        return Promise.resolve(null);
      }
    }

    if (btn) { btn.disabled = true; btn.classList.add('sr-more-loading'); }
    if (moreStatus) moreStatus.textContent = '';
    var stopFcMorePhases = window.srStartMorePhases ? window.srStartMorePhases(moreStatus, ['Generating flashcards…', 'Verifying quality…', 'Almost done…']) : function () {};

    var overlay = window.SrAppendOverlay;
    if (overlay && !overlay.isPending('tab-flashcards')) {
      overlay.show('tab-flashcards', {
        hint: 'Generating more flashcards…',
        sub: 'This takes a few seconds — the new cards get added at the end.',
        onCancel: function () {
          if (btn) { btn.disabled = false; btn.classList.remove('sr-more-loading'); }
        },
      });
    }

    var deck = window._fcCards || window.CARDS;
    var useFresh = !deck || !deck.length;
    var genCap = (window.USER_LIMITS && window.USER_LIMITS.study_gen_cap) || 15;
    var csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';

    var body = { group_index: 0, topic: window._topicState.selected ? window._topicState.selected.title : null, card_count: genCap };
    if (opts.sectionText) body.section_text = opts.sectionText;
    var url = '/library/pack/' + PACK + '/generate-flashcards';
    if (useFresh) {
      body.force = true;
      body.card_count = opts.count || genCap;
    } else {
      url += '/more';
    }

    function _fcRevealDeck(cards, resourceId) {
      if (overlay) overlay.hide('tab-flashcards');
      if (typeof window._dedupItems === 'function') {
        cards = window._dedupItems(cards, 'flashcards');
      }
      window.CARDS = cards;
      window._fcCards = cards;
      if (resourceId) window._fcResourceId = resourceId;
      var fcEmpty = document.getElementById('fcEmpty');
      var fcLoadingEl = document.getElementById('fcLoading');
      var fcStage = document.getElementById('fcStage');
      var fcNav = document.getElementById('fcNav');
      var fcCounter = document.getElementById('fcCounter');
      if (fcEmpty) fcEmpty.style.display = 'none';
      if (fcLoadingEl) fcLoadingEl.style.display = 'none';
      if (fcStage) fcStage.style.display = '';
      if (fcNav) fcNav.style.display = '';
      if (fcCounter) fcCounter.style.display = '';
      if (moreStatus) moreStatus.textContent = '';
      if (btn) { btn.disabled = false; btn.classList.remove('sr-more-loading'); }
      if (typeof window._fcInitDeck === 'function') window._fcInitDeck(cards);
      if (window._refreshAssessmentFilter) window._refreshAssessmentFilter('tab-flashcards');
    }

    function _fcPollForFresh() {
      var tries = 0;
      var poll = function () {
        if (overlay && !overlay.isPending('tab-flashcards')) return; // cancelled
        tries++;
        fetch('/library/pack/' + PACK + '/resource-status')
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (overlay && !overlay.isPending('tab-flashcards')) return;
            var statuses = data.statuses || {};
            var doneKey = Object.keys(statuses).find(function (k) {
              return k.startsWith('flashcards:group:') && statuses[k] === 'done';
            });
            if (doneKey) {
              fetch('/library/pack/' + PACK + '/resource-content?type=flashcards&group=0')
                .then(function (r) { return r.json(); })
                .then(function (cd) {
                  if (overlay && !overlay.isPending('tab-flashcards')) return;
                  if (cd.ok && cd.content && cd.content.flashcards) {
                    _fcRevealDeck(cd.content.flashcards, cd.resource_id);
                  } else {
                    if (overlay) overlay.hide('tab-flashcards');
                  }
                })
                .catch(function () {
                  if (overlay) overlay.hide('tab-flashcards');
                });
              return;
            }
            var failKey = Object.keys(statuses).find(function (k) {
              return k.startsWith('flashcards:group:') && statuses[k] === 'failed';
            });
            if (failKey) {
              if (overlay) overlay.hide('tab-flashcards');
              if (moreStatus) moreStatus.textContent = '⚠ ' + (statuses[failKey + '_error'] || 'Generation failed');
              if (btn) { btn.disabled = false; btn.classList.remove('sr-more-loading'); }
              return;
            }
            if (tries > 120) { // ~4 min safety cap
              if (overlay) overlay.hide('tab-flashcards');
              return;
            }
            setTimeout(poll, 2000);
          })
          .catch(function () {
            if (overlay && !overlay.isPending('tab-flashcards')) return;
            if (tries > 120) return;
            setTimeout(poll, 3000);
          });
      };
      setTimeout(poll, 2000);
    }

    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'fetch',
        'X-CSRFToken': csrf,
      },
      body: JSON.stringify(body),
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      stopFcMorePhases();
      if (overlay && !overlay.isPending('tab-flashcards')) {
        if (btn) { btn.disabled = false; btn.classList.remove('sr-more-loading'); }
        return data;
      }
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
      if (useFresh) {
        if (data.ok && data.status === 'generating') {
          // Background generation — the fresh poller reveals + hides the overlay.
          _fcPollForFresh();
          return data;
        }
        if (data.ok && data.status === 'already_done') {
          fetch('/library/pack/' + PACK + '/resource-content?type=flashcards&group=0')
            .then(function (r) { return r.json(); })
            .then(function (cd) {
              if (cd.ok && cd.content && cd.content.flashcards) {
                _fcRevealDeck(cd.content.flashcards, cd.resource_id);
              } else {
                if (overlay) overlay.hide('tab-flashcards');
              }
            })
            .catch(function () { if (overlay) overlay.hide('tab-flashcards'); });
          return data;
        }
        if (overlay) overlay.hide('tab-flashcards');
        if (data.quota_exceeded) {
          if (window.maybeShowCreditsExhausted && window.maybeShowCreditsExhausted(data, 'flashcards')) {
            if (btn) { btn.disabled = false; btn.classList.remove('sr-more-loading'); }
            return data;
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
          } else {
            window.location.href = '/pricing';
          }
        }
        if (moreStatus) moreStatus.textContent = '⚠ ' + (data.error || 'Generation failed');
        if (btn) { btn.disabled = false; btn.classList.remove('sr-more-loading'); }
        return data;
      }

      if (!data.ok && data.status !== 'max_reached') {
        if (overlay) overlay.hide('tab-flashcards');
        if (btn) btn.classList.remove('sr-more-loading');
        if (data.quota_exceeded) {
          if (moreRow) moreRow.style.display = 'none';
          if (window.maybeShowCreditsExhausted && window.maybeShowCreditsExhausted(data, 'flashcards')) {
            if (btn) { btn.disabled = false; btn.classList.remove('sr-more-loading'); }
            return data;
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
          } else {
            window.location.href = '/pricing';
          }
          return data;
        }
        if (moreStatus) moreStatus.textContent = '⚠ ' + (data.error || 'Failed');
        if (btn) btn.disabled = false;
        return data;
      }
      if (data.status === 'max_reached') {
        if (overlay) overlay.hide('tab-flashcards');
        if (moreRow) moreRow.style.display = 'none';
        if (moreStatus) moreStatus.textContent = '';
        if (btn) { btn.disabled = false; btn.classList.remove('sr-more-loading'); }
        return data;
      }
      if (data.status === 'in_progress') {
        // A generation is already running for this pack — poll instead of
        // starting a duplicate, and do not charge anything.
        _fcPollForFresh();
        return data;
      }
      if (data.status === 'rate_limited') {
        if (overlay) overlay.hide('tab-flashcards');
        if (moreStatus) moreStatus.textContent = '⚠ Please wait a moment before generating more.';
        setTimeout(function() { if (moreStatus) moreStatus.textContent = ''; }, 3000);
        if (btn) { btn.disabled = false; btn.classList.remove('sr-more-loading'); }
        return data;
      }
      if (data.status === 'no_new') {
        if (overlay) overlay.hide('tab-flashcards');
        if (moreStatus) moreStatus.textContent = '✓ No new cards added — everything here is already in your deck';
        setTimeout(function() { if (moreStatus) moreStatus.textContent = ''; }, 3000);
        if (btn) { btn.disabled = false; btn.classList.remove('sr-more-loading'); }
        if (data.total >= MAX_CARDS) {
          if (moreRow) moreRow.style.display = 'none';
        }
        return data;
      }
      var newCards = data.new_cards || [];
      var previousLen = (deck || []).length;
      if (window.USER_DAILY) window.USER_DAILY.flashcards = (window.USER_DAILY.flashcards || 0) + newCards.length;
      newCards.forEach(function(c) { if (Array.isArray(deck)) deck.push(c); });
      if (overlay) overlay.hide('tab-flashcards');
      var total = document.getElementById('fcTotal');
      if (total) total.textContent = deck ? deck.length : 0;
      var nextBtn = document.getElementById('fcNext');
      if (nextBtn) nextBtn.disabled = false;
      if (newCards.length && typeof window._fcLoad === 'function') window._fcLoad(previousLen);
      if (data.max_reached || data.total >= MAX_CARDS) {
        if (moreRow) moreRow.style.display = 'none';
        if (btn) btn.classList.remove('sr-more-loading');
        if (moreStatus) moreStatus.textContent = '';
      } else {
        if (btn) { btn.disabled = false; btn.classList.remove('sr-more-loading'); }
        if (moreStatus) moreStatus.textContent = '✓ ' + newCards.length + ' cards added';
        setTimeout(function() { if (moreStatus) moreStatus.textContent = ''; }, 3000);
      }
      return data;
    })
    .catch(function() {
      stopFcMorePhases();
      if (overlay) overlay.hide('tab-flashcards');
      if (btn) btn.classList.remove('sr-more-loading');
      if (moreStatus) moreStatus.textContent = '⚠ Could not reach server. Check your connection.';
      if (btn) btn.disabled = false;
      return null;
    });
  };
})();

// Quiz engine logic is loaded from /static/js/study-room/quiz-engine.js

// ── LOAD SAVED QUIZ QUESTIONS ──
var quizData = window.QZ_RAW || [];
window._qzData = Array.isArray(quizData) ? quizData.filter(function(q) { return q && (q.question || q.question_text || q.text) && Array.isArray(q.options) && q.options.length; }) : [];
window._qzResourceId = window.QZ_RESOURCE_ID;
