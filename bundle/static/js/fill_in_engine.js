(function () {
  'use strict';

  var _fiQ = [];
  var _fiIdx = 0;
  var _fiStatus = new Map();
  var _fiAnswers = new Map();
  var _hintHideTimer = null;
  var _fiQpMap = new Map();
  var _fiQpTotal = 0;
  var _fiQpLoading = true;
  var _fiAuraEarned = 0;

  var FI_TIERS = ['unfamiliar','learning','familiar','mastered'];

  function _fiNextTier(t) {
    var i = FI_TIERS.indexOf(t);
    return i >= 0 && i < FI_TIERS.length - 1 ? FI_TIERS[i + 1] : t;
  }
  function _fiPrevTier(t) {
    var i = FI_TIERS.indexOf(t);
    return i > 0 ? FI_TIERS[i - 1] : t;
  }

  function _fiUpdateBadgeBar() {
    var counts = { unfamiliar: 0, learning: 0, familiar: 0, mastered: 0 };
    var total = _fiQpTotal || _fiQ.length;
    var tracked = 0;
    _fiQpMap.forEach(function(p) {
      if (counts.hasOwnProperty(p.tier)) counts[p.tier]++;
      tracked++;
    });
    counts.unfamiliar += Math.max(0, total - tracked);
    counts.total = total;
    var bar = document.querySelector('#tab-more .sr-badge-bar');
    if (!bar) return;
    FI_TIERS.forEach(function(t) {
      var el = bar.querySelector('#badge-' + t);
      if (el) el.textContent = counts[t];
    });
  }

  function _fiRecordAnswer(questionIdx, correct) {
    var p = _fiQpMap.get(questionIdx) || { tier: 'unfamiliar', streak: 0 };
    if (correct) {
      p.streak++;
      if (p.streak >= 1 && p.tier !== 'mastered') {
        p.tier = _fiNextTier(p.tier);
        p.streak = 0;
      }
    } else {
      p.tier = _fiPrevTier(p.tier);
      p.streak = 0;
    }
    _fiQpMap.set(questionIdx, p);
    _fiUpdateBadgeBar();

    var resId = window._fiResourceId;
    var packId = window.PACK_ID;
    if (!resId || !packId || !window.USER_IS_AUTHENTICATED) return;
    var csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
    fetch('/api/question-answer', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-CSRFToken': csrf},
      body: JSON.stringify({
        pack_id: packId, resource_id: resId,
        item_type: 'fillin', question_idx: questionIdx, correct: correct
      })
    }).then(function(r){return r.json()}).then(function(data){
      if (!data.badges) return;
      var sp = _fiQpMap.get(questionIdx);
      if (sp) { sp.tier = data.tier; sp.streak = data.streak; }
      var bar = document.querySelector('#tab-more .sr-badge-bar');
      if (bar) {
        FI_TIERS.forEach(function(t) {
          var el = bar.querySelector('#badge-' + t);
          if (el) el.textContent = data.badges[t];
        });
      }
      if (data.promoted || data.demoted) {
        var badge = bar ? bar.querySelector('.sr-badge--' + data.tier) : null;
        if (badge) {
          badge.classList.remove('badge-bumping');
          void badge.offsetWidth;
          badge.classList.add('badge-bumping');
        }
      }
      if (data.xp_earned && correct) {
        _fiAuraEarned += data.xp_earned;
      }
    }).catch(function() {
      if (typeof window.showFatalErrorModal === 'function') {
        window.showFatalErrorModal('Failed to save your progress. Please try again.', function () {
          var csrfToken = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
          fetch('/api/question-answer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken },
            body: JSON.stringify({
              pack_id: packId, resource_id: resId,
              item_type: 'fillin', question_idx: questionIdx, correct: correct
            })
          }).catch(function() {});
        });
      }
    });
  }

  window._fiQ = _fiQ;
  window._fiIdx = _fiIdx;

  // Expose batch normaliser (used by generateFillIn and fiMoreBtn handler)
  function _normaliseAll(items) {
    return (Array.isArray(items) ? items : []).map(_normalise).filter(Boolean);
  }
  window._normaliseAll = _normaliseAll;

  function $id(id) { return document.getElementById(id); }
  function $qs(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $qsa(sel, ctx) { return Array.from((ctx || document).querySelectorAll(sel)); }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function _normalise(q) {
    if (!q) return null;
    if (Array.isArray(q.text_segments) && Array.isArray(q.blank_keys)
        && q.text_segments.length >= 2 && q.blank_keys.length >= 1) {
      return q;
    }

    var sentence = (q.sentence || '').trim();
    var answer = (q.blank || q.answer || '').trim();
    if (!sentence || !answer) return null;

    var segments = sentence.split('___');
    if (segments.length < 2) {
      segments = [sentence, ''];
    }

    var altRaw = q.acceptable_answers || q.blank_alternatives || q.alternatives || [];
    var blankAlternatives;
    if (Array.isArray(altRaw)) {
      blankAlternatives = (Array.isArray(altRaw[0]) && altRaw.length > 0)
        ? altRaw
        : [altRaw.map(String)];
    } else {
      blankAlternatives = [];
    }

    return Object.assign({}, q, {
      text_segments: segments,
      blank_keys: [answer],
      blank_alternatives: blankAlternatives,
    });
  }

  function _wrapParagraphs(text) {
    return '<div class="space-y-4 whitespace-normal"><p>' + escHtml(text || '') + '</p></div>';
  }

  function _renderQuestionMarkup(q, qi) {
    var segments = q.text_segments || [];
    var blanks = q.blank_keys || [];
    var parts = [];

      segments.forEach(function (seg, segIdx) {
      parts.push('<div class="inline [&>p]:m-0 [&>p]:inline">' + _wrapParagraphs(seg) + '</div>');
      if (segIdx < blanks.length) {
        var blankIdx = segIdx;
        var stateKey = qi + ':' + blankIdx;
        var outcome = _fiStatus.get(stateKey);
        var width = _blankWidth(blanks[blankIdx]);
        var alts = (q.blank_alternatives && Array.isArray(q.blank_alternatives[blankIdx]))
          ? q.blank_alternatives[blankIdx]
          : [];
        parts.push(
          '<input'
          + ' type="text"'
          + ' class="fi-blank' + (outcome ? ' ' + outcome : '') + '"'
          + ' data-fi-q="' + qi + '"'
          + ' data-fi-blank="' + blankIdx + '"'
          + ' data-fi-answer="' + escHtml(blanks[blankIdx]) + '"'
          + ' data-fi-alternatives="' + escHtml(JSON.stringify(alts)) + '"'
          + ' placeholder=""'
          + ' autocomplete="off"'
          + ' spellcheck="false"'
          + (outcome ? ' disabled' : '')
          + ' style="min-width: ' + width + 'px;"'
          + ' />'
        );
      }
    });

    return parts.join('');
  }

  function _blankWidth(answer) {
    var ch = Math.max(String(answer || '').length, 4);
    return Math.min(Math.max(ch * 11, 80), 260);
  }

  // ── Feedback: confirmation icon + explanation, no answer label ───────────
  function _refreshFeedback(i, q) {
    // Feedback replaces hint — hide hint elements
    var _hintText = $id('fiHintText');
    if (_hintText) _hintText.classList.remove('-visible');
    var _hintBtn = document.querySelector('[data-fi-hint-toggle]');
    if (_hintBtn) _hintBtn.style.display = 'none';

    var fb = $id('fiFeedbackWrap');
    if (!fb) return;

    var blankKeys = q.blank_keys;
    var allAnswered = blankKeys.every(function (_, bi) {
      return _fiStatus.has(i + ':' + bi);
    });

    if (!allAnswered) {
      fb.style.display = 'none';
      fb.innerHTML = '';
      return;
    }

    var expHtml = q.explanation
      ? '<div class="fi-explanation-line">' + escHtml(q.explanation) + '</div>'
      : '';

    fb.innerHTML = expHtml;
    fb.style.display = '';
    if (typeof window.motownTypesetMath === 'function') {
      window.motownTypesetMath(fb);
    }
  }

  // ── Enter hint with slide-in ──────────────────────────────────────────────
  function _showEnterHint(text) {
    var hintEl = $id('fiEnterHintOutside');
    if (!hintEl) return;
    hintEl.textContent = text;
    hintEl.style.display = '';
    hintEl.classList.remove('fi-enter-slide');
    void hintEl.offsetWidth;
    hintEl.classList.add('fi-enter-slide');
  }

  // ── The original card HTML structure — restored on every load ─────────────
  var _cardOriginalHTML = null;
  var _boundSentenceArea = null;
  var _boundGotItStage = null;

  function _getCardEl() {
    var stage = $id('fiStage');
    if (!stage) return null;
    var faceInner = $qs('.fc-face-inner', stage);
    return faceInner;
  }

  function _bindSentenceHandlers() {
    var sentenceArea = $id('fiSentence');
    if (!sentenceArea || sentenceArea === _boundSentenceArea) return;

    sentenceArea.addEventListener('input', function (e) {
      var target = e.target;
      if (!target || target.tagName !== 'INPUT' || !target.hasAttribute('data-fi-blank')) return;
      var qi = parseInt(target.getAttribute('data-fi-q'), 10);
      var bi = parseInt(target.getAttribute('data-fi-blank'), 10);
      _fiAnswers.set(qi + ':' + bi, target.value || '');
      target.classList.remove('correct', 'wrong');
      _updateNextChevron();
    });

    sentenceArea.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target && e.target.tagName === 'INPUT') {
        e.preventDefault();
        var q = _normalise(_fiQ[_fiIdx]);
        if (!q) return;
        var allAnswered = q.blank_keys.every(function (_, bi) {
          return _fiStatus.has(_fiIdx + ':' + bi);
        });
        if (allAnswered) return;
        var allFilled = q.blank_keys.every(function (_, bi) {
          var live = (_fiAnswers.get(_fiIdx + ':' + bi) || '').trim();
          return live.length > 0;
        });
        if (allFilled) {
          _fiDoCheck();
          e.stopPropagation();
          var advanceBtn = $id('fiGotIt');
          if (advanceBtn) {
            setTimeout(function () { advanceBtn.click(); }, 1500);
          }
          return;
        }
      }
    });

    _boundSentenceArea = sentenceArea;
  }

  function _bindCurrentCardButtons() {
    var stage = $id('fiStage');
    if (stage && stage !== _boundGotItStage) {
      stage.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          var btn = $id('fiGotIt');
          if (btn && btn.style.display !== 'none') {
            e.preventDefault();
            btn.click();
          }
        }
      });
      _boundGotItStage = stage;
    }
  }

  function _focusCurrentBlank() {
    var sentenceEl = $id('fiSentence');
    if (!sentenceEl) return;

    var firstBlank = sentenceEl.querySelector('input[data-fi-blank]:not([disabled])');
    if (!firstBlank) return;

    requestAnimationFrame(function () {
      try {
        firstBlank.focus({ preventScroll: true });
      } catch (err) {
        firstBlank.focus();
      }
      if (typeof firstBlank.select === 'function') {
        firstBlank.select();
      }
    });
  }

  function _hideHintAfterDelay() {
    var hintEl = $qs('[data-fi-hint]', $id('fiStage'));
    if (!hintEl) return;

    if (_hintHideTimer) {
      clearTimeout(_hintHideTimer);
      _hintHideTimer = null;
    }

    _hintHideTimer = setTimeout(function () {
      hintEl.classList.remove('-visible');
      var hintBtn = document.querySelector('[data-fi-hint-toggle]');
      if (hintBtn) hintBtn.style.display = '';
      _hintHideTimer = null;
    }, 4000);
  }

  function _ensureResultAnimationStyles() {
    if ($id('fiResultAnimationStyles')) return;

    var style = document.createElement('style');
    style.id = 'fiResultAnimationStyles';
    style.textContent = [
      '#fiStage .fi-result-popup {',
      '  animation: fiPopupIn 360ms cubic-bezier(0.175, 0.885, 0.32, 1.275) both;',
      '  transform-origin: center;',
      '}',
      '#fiStage .fi-result-badge {',
      '  animation: fiBadgePop 420ms cubic-bezier(0.175, 0.885, 0.32, 1.275) both;',
      '}',
      '#fiStage .fi-result-copy {',
      '  animation: fiCopyRise 420ms ease both;',
      '}',
      '#fiStage .fi-result-action {',
      '  animation: fiActionRise 420ms ease both;',
      '}',
      '#fiStage .fi-result-action .no-fi-anim {',
      '  animation: none !important;',
      '}',
      '@keyframes fiPopupIn {',
      '  0% { opacity: 0; transform: translateY(14px) scale(0.88); }',
      '  65% { opacity: 1; transform: translateY(-2px) scale(1.03); }',
      '  100% { opacity: 1; transform: translateY(0) scale(1); }',
      '}',
      '@keyframes fiBadgePop {',
      '  0% { opacity: 0; transform: scale(0.25) rotate(-10deg); }',
      '  60% { opacity: 1; transform: scale(1.15) rotate(3deg); }',
      '  100% { opacity: 1; transform: scale(1) rotate(0deg); }',
      '}',
      '@keyframes fiCopyRise {',
      '  0% { opacity: 0; transform: translateY(10px); }',
      '  100% { opacity: 1; transform: translateY(0); }',
      '}',
      '@keyframes fiActionRise {',
      '  0% { opacity: 0; transform: translateY(12px); }',
      '  100% { opacity: 1; transform: translateY(0); }',
      '}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function _restoreCard() {
    var cardEl = _getCardEl();
    // If #fiSentence is gone (card was replaced), re-scaffold from saved HTML
    if (!cardEl || !$id('fiSentence')) {
      var stage = $id('fiStage');
      if (!stage || !_cardOriginalHTML) return;
      // Find the face-inner and restore
      var faceInner = $qs('.fc-face-inner', stage);
      if (faceInner && _cardOriginalHTML) {
        faceInner.innerHTML = _cardOriginalHTML;
        _boundSentenceArea = null;
        _bindSentenceHandlers();
        _bindCurrentCardButtons();
      }
    }
  }

  function _fiLoad(i) {
    _fiIdx = i;
    window._fiIdx = i;
    var q = _normalise(_fiQ[i]);
    if (!q) return;

    if (_hintHideTimer) {
      clearTimeout(_hintHideTimer);
      _hintHideTimer = null;
    }

    // ── Restore card structure if it was replaced by success state ───────────
    _restoreCard();

    // ── Save original card HTML on first ever load ───────────────────────────
    if (_cardOriginalHTML === null) {
      var faceInner = $qs('.fc-face-inner', $id('fiStage'));
      if (faceInner) _cardOriginalHTML = faceInner.innerHTML;
    }

    _bindSentenceHandlers();

    var cur = $id('fiCurrent');
    if (cur) cur.textContent = i + 1;

    var sentenceEl = $id('fiSentence');
    if (!sentenceEl) return;

    sentenceEl.innerHTML = _renderQuestionMarkup(q, i);
    var fiStageEl = $id('fiStage');
    if (fiStageEl) fiStageEl.style.display = '';
    if (typeof window.motownTypesetMath === 'function') {
      if (fiStageEl) window.motownTypesetMath(fiStageEl);
    }

    // ── Hint ─────────────────────────────────────────────────────────────────
    var hintToggle = document.querySelector('[data-fi-hint-toggle]');
    if (hintToggle) hintToggle.style.display = '';
    var hintEl = $qs('[data-fi-hint]', $id('fiStage'));
    if (hintEl) {
      hintEl.classList.remove('-visible');
      hintEl.textContent = q.hint || '';
    }

    // ── Clear feedback ───────────────────────────────────────────────────────
    var fb = $id('fiFeedbackWrap');
    if (fb) { fb.style.display = 'none'; fb.innerHTML = ''; }

    // ── Already answered this card before? ───────────────────────────────────
    var allAnswered = q.blank_keys.every(function (_, bi) {
      return _fiStatus.has(i + ':' + bi);
    });

    var gotItBtn = $id('fiGotIt');

    if (gotItBtn) {
      gotItBtn.style.display = allAnswered ? '' : 'none';
      gotItBtn.textContent = (i < _fiQ.length - 1) ? 'Next \u2192' : 'Finished';
    }

    var prevBtn = $id('fiPrev');
    var nextBtn = $id('fiNext');
    if (prevBtn) { prevBtn.style.display = ''; prevBtn.disabled = (i === 0); }
    if (nextBtn) { nextBtn.style.display = ''; nextBtn.disabled = (i === _fiQ.length - 1); }

    _bindCurrentCardButtons();
    _focusCurrentBlank();

    // ── If already answered, re-apply disabled+coloured inputs and feedback ──
    if (allAnswered) {
      var blanks = $qsa('input[data-fi-blank]', sentenceEl);
      blanks.forEach(function (inp) {
        var bi = parseInt(inp.getAttribute('data-fi-blank'), 10);
        var outcome = _fiStatus.get(i + ':' + bi);
        inp.classList.add(outcome);
        inp.disabled = true;
        if (outcome === 'wrong') inp.value = q.blank_keys[bi];
      });
      _refreshFeedback(i, q);
      return;
    }

    // ── Enter hint for unanswered questions ──
    _showEnterHint('Press Enter to submit');

    // ── Chevron highlight based on input ──
    _updateNextChevron();
  }

  // ── Input-driven chevron highlight ──
  function _updateNextChevron() {
    var q = _normalise(_fiQ[_fiIdx]);
    if (!q) return;
    var nextBtn = $id('fiNext');
    if (!nextBtn) return;
    var allFilled = q.blank_keys.every(function (_, bi) {
      return (_fiAnswers.get(_fiIdx + ':' + bi) || '').trim().length > 0;
    });
    nextBtn.classList.toggle('fi-has-input', allFilled);
    // Same highlight flow as the quiz tab: light up once all blanks are filled
    // (base .fc-nav-bar-btn.fc-nav-btn--active styles this with --primary).
    nextBtn.classList.toggle('fc-nav-btn--active', allFilled);
  }

  function _normalizeAnswer(s) {
    return s.toLowerCase().trim()
      .replace(/['\u2019\u2018`\u201C\u201D"]/g, '')
      .replace(/[.,!?;:()\-/\\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function _levenshtein(a, b) {
    var m = a.length, n = b.length;
    var prev, cur = new Array(n + 1);
    for (var j = 0; j <= n; j++) cur[j] = j;
    for (var i = 1; i <= m; i++) {
      prev = cur;
      cur = new Array(n + 1);
      cur[0] = i;
      for (var j = 1; j <= n; j++) {
        var cost = a[i - 1] === b[j - 1] ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      }
    }
    return cur[n];
  }

  function _fuzzyMatch(a, b) {
    if (a === b) return true;
    var maxLen = Math.max(a.length, b.length);
    if (maxLen <= 2) return false;
    var threshold = Math.max(1, Math.min(3, Math.floor(maxLen * 0.2)));
    return _levenshtein(a, b) <= threshold;
  }

  function _matchesAnswer(userVal, expected, alternativesJson) {
    if (expected === userVal || _fuzzyMatch(userVal, expected)) return true;
    var alts = [];
    try {
      var parsed = JSON.parse(alternativesJson || '');
      if (Array.isArray(parsed)) alts = parsed;
    } catch (e) { /* ignore malformed alternatives */ }
    for (var i = 0; i < alts.length; i++) {
      var alt = _normalizeAnswer(String(alts[i]));
      if (alt && (alt === userVal || _fuzzyMatch(userVal, alt))) return true;
    }
    return false;
  }

  function _fiDoCheck() {
    var q = _normalise(_fiQ[_fiIdx]);
    if (!q) return;

    var sentenceEl = $id('fiSentence');
    if (!sentenceEl) return;

    var blanks = $qsa('input[data-fi-blank]', sentenceEl);
    var allCorrect = true;

    blanks.forEach(function (inp) {
      var blankIdx = parseInt(inp.getAttribute('data-fi-blank'), 10);
      var expected = _normalizeAnswer(inp.getAttribute('data-fi-answer') || '');
      var userVal = _normalizeAnswer(inp.value || '');
      var stateKey = _fiIdx + ':' + blankIdx;

      _fiAnswers.set(stateKey, inp.value || '');

      var ok = _matchesAnswer(userVal, expected, inp.getAttribute('data-fi-alternatives') || '');
      if (!ok) allCorrect = false;
      _fiStatus.set(stateKey, ok ? 'correct' : 'wrong');
      inp.classList.add(ok ? 'correct' : 'wrong');
      inp.disabled = true;
      if (!ok) inp.value = q.blank_keys[blankIdx];
    });

    _refreshFeedback(_fiIdx, q);

    var gotItBtn = $id('fiGotIt');
    if (gotItBtn) {
      gotItBtn.style.display = '';
      gotItBtn.textContent = (_fiIdx < _fiQ.length - 1) ? 'Next \u2192' : 'Finished';
    }

    _fiRecordAnswer(_fiIdx, allCorrect);
  }

  function _fiSerialise() {
    return _fiQ.map(function (raw, qi) {
      var q = _normalise(raw);
      if (!q) return [];
      return q.blank_keys.map(function (key, bi) {
        var stateKey = qi + ':' + bi;
        return {
          question_index: qi,
          blank_index: bi,
          user_answer: (_fiAnswers.get(stateKey) || '').trim(),
          expected: key,
          status: _fiStatus.get(stateKey) || 'unanswered',
        };
      });
    }).reduce(function (acc, rows) { return acc.concat(rows); }, []);
  }

  window.renderFillIns = function (questions, opts) {
    var resumeAt = (opts && typeof opts.resumeAt === 'number' && opts.resumeAt >= 0 && opts.resumeAt < questions.length) ? opts.resumeAt : 0;
    var isAppend = (opts && opts.append === true);
    _fiQ = questions;
    if (typeof window._dedupItems === 'function') {
      _fiQ = window._dedupItems(_fiQ, 'fill_in');
    }
    window._fiQ = _fiQ;
    window._fiData = _fiQ;
    _fiIdx = resumeAt;
    window._fiIdx = _fiIdx;
    if (!isAppend) {
      _fiStatus = new Map();
      _fiAnswers = new Map();
      _fiQpMap = new Map();
      _fiAuraEarned = 0;
    }
    _fiQpTotal = _fiQ.length;

    $id('fiLoading') && ($id('fiLoading').style.display = 'none');
    $id('fiEmpty') && ($id('fiEmpty').style.display = 'none');

    var prevShow = $id('fiPrev');
    var nextShow = $id('fiNext');
    if (prevShow) prevShow.style.display = 'none';
    if (nextShow) nextShow.style.display = 'none';

    $id('fiCounter') && ($id('fiCounter').style.display = '');
    $id('fiNav') && ($id('fiNav').style.display = '');
    $id('fiStage') && ($id('fiStage').style.display = 'none');
    var fiBar = document.querySelector('#tab-more .sr-badge-bar');
    if (fiBar) fiBar.style.display = '';

    var fiTotal = $id('fiTotal');
    if (fiTotal) fiTotal.textContent = _fiQ.length;

    $id('fiMoreRow') && ($id('fiMoreRow').style.display = _fiQ.length > 0 ? '' : 'none');

    var resId = window._fiResourceId;
    if (!resId || !window.USER_IS_AUTHENTICATED) { _fiUpdateBadgeBar(); _fiLoad(resumeAt); return; }
    if (isAppend) { _fiUpdateBadgeBar(); _fiLoad(resumeAt); return; }
    fetch('/api/question-progress?resource_id=' + resId + '&item_type=fillin')
      .then(function(r) { return r.json(); })
      .then(function(rows) {
        rows.forEach(function(r) {
          _fiQpMap.set(r.question_idx, { tier: r.tier, streak: r.streak });
        });
        _fiUpdateBadgeBar();
        _fiLoad(resumeAt);
      })
      .catch(function() {
        _fiLoad(resumeAt);
      });
  };

  window._fiGetPayload = _fiSerialise;

  window.generateFillIn = function (count) {
    var numItems = count || ((window.USER_LIMITS && window.USER_LIMITS.study_gen_cap) || 15);
    var genBtn = $id('fiGenerateBtn');
    $id('fiEmpty') && ($id('fiEmpty').style.display = 'none');
    $id('fiPrev') && ($id('fiPrev').style.display = 'none');
    $id('fiNext') && ($id('fiNext').style.display = 'none');
    $id('fiCounter') && ($id('fiCounter').style.display = 'none');
    $id('fiNav') && ($id('fiNav').style.display = 'none');
    $id('fiStage') && ($id('fiStage').style.display = 'none');
    $id('fiMoreRow') && ($id('fiMoreRow').style.display = 'none');
    $id('fiLoading') && ($id('fiLoading').style.display = 'flex');
    var _fiStopPct = _startGenPct('fiPct');
    if (genBtn) genBtn.disabled = true;

    var packId = window.PACK_ID || (window.STUDY_ROOM_CONFIG && window.STUDY_ROOM_CONFIG.packId);
    if (!packId) {
      if (_fiStopPct) _fiStopPct(false);
      $id('fiLoading') && ($id('fiLoading').style.display = 'none');
      $id('fiEmpty') && ($id('fiEmpty').style.display = 'flex');
      if (genBtn) genBtn.disabled = false;
      return;
    }

    var csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
    fetch('/library/pack/' + packId + '/generate-fill-ins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
      body: JSON.stringify({ num_items: numItems, group_index: 0, topic: window._topicState && window._topicState.selected ? window._topicState.selected.title : null, section_text: window._topicState && window._topicState.selected ? window._topicState.selected.section_text : null }),
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.cycle_index != null && window._topicState) {
        window._topicState.cycleIndex = data.cycle_index;
        if (typeof _updateAllTopicLabels === 'function') {
          var labels = document.querySelectorAll('#srTopicLabelBar');
          _updateAllTopicLabels(labels);
        }
      }
      if (data.ok && data.status === 'generating') {
        if (data.resource_id) window._fiResourceId = data.resource_id;
        window._pollResource(packId, 'fill_in', {
          onData: function(res) {
            if (_fiStopPct) _fiStopPct(true);
            if (window.SrAppendOverlay) window.SrAppendOverlay.hide('tab-more');
            var questions = (res.content && res.content.fill_in) || [];
            $id('fiLoading') && ($id('fiLoading').style.display = 'none');
            if (!questions.length) {
              $id('fiEmpty') && ($id('fiEmpty').style.display = 'flex');
              if (genBtn) genBtn.disabled = false;
              return;
            }
            if (res.resource_id) window._fiResourceId = res.resource_id;
            window.renderFillIns(_normaliseAll(questions));
            if (window._refreshAssessmentFilter) window._refreshAssessmentFilter('tab-more');
          },
          onEmpty: function() {
            if (_fiStopPct) _fiStopPct(false);
            if (window.SrAppendOverlay) window.SrAppendOverlay.hide('tab-more');
            $id('fiLoading') && ($id('fiLoading').style.display = 'none');
            $id('fiEmpty') && ($id('fiEmpty').style.display = 'flex');
            if (genBtn) { genBtn.disabled = false; genBtn.textContent = 'Try Again'; }
          },
          onFail: function() {
            if (_fiStopPct) _fiStopPct(false);
            if (window.SrAppendOverlay) window.SrAppendOverlay.hide('tab-more');
            $id('fiLoading') && ($id('fiLoading').style.display = 'none');
            $id('fiEmpty') && ($id('fiEmpty').style.display = 'flex');
            if (genBtn) { genBtn.disabled = false; genBtn.textContent = 'Try Again'; }
            var m = $id('fiTwoStepMount');
            if (m && m._widget && m._widget.enableWidget) m._widget.enableWidget();
          },
        });
        return;
      }
      if (_fiStopPct) _fiStopPct(true);
      if (window.SrAppendOverlay) window.SrAppendOverlay.hide('tab-more');
      $id('fiLoading') && ($id('fiLoading').style.display = 'none');
      if (data.ok && data.questions && data.questions.length) {
        if (data.resource_id) window._fiResourceId = data.resource_id;
        window.renderFillIns(_normaliseAll(data.questions));
        if (window._refreshAssessmentFilter) window._refreshAssessmentFilter('tab-more');
      } else if (data.quota_exceeded) {
        $id('fiEmpty') && ($id('fiEmpty').style.display = 'flex');
        if (genBtn) genBtn.disabled = false;
        var m = $id('fiTwoStepMount');
        if (m && m._widget && m._widget.enableWidget) m._widget.enableWidget();
        if (window.maybeShowCreditsExhausted && window.maybeShowCreditsExhausted(data, 'fill-in exercises')) {
          return;
        }
        if (typeof window.showQuotaModal === 'function') {
          window.showQuotaModal({
            resource: 'fill-in exercises',
            used: data.used,
            limit: data.limit,
            resetsInSeconds: data.resets_in_seconds, tier: data.tier,
          });
        } else if (typeof window.openUpgradeModal === 'function') {
          window.openUpgradeModal();
        }
      } else {
        $id('fiEmpty') && ($id('fiEmpty').style.display = 'flex');
        if (genBtn) { genBtn.disabled = false; genBtn.textContent = 'Try Again'; }
        var m = $id('fiTwoStepMount');
        if (m && m._widget && m._widget.enableWidget) m._widget.enableWidget();
      }
    })
    .catch(function() {
      if (_fiStopPct) _fiStopPct(false);
      $id('fiLoading') && ($id('fiLoading').style.display = 'none');
      $id('fiEmpty') && ($id('fiEmpty').style.display = 'flex');
      if (genBtn) { genBtn.disabled = false; genBtn.textContent = 'Try Again'; }
      var m = $id('fiTwoStepMount');
      if (m && m._widget && m._widget.enableWidget) m._widget.enableWidget();
    });
  };

  window._fiWireHandlers = function () {
    var prevBtn = $id('fiPrev');
    var nextBtn = $id('fiNext');
    var gotItBtn = $id('fiGotIt');
    var genBtn = $id('fiGenerateBtn');

    if (prevBtn) prevBtn.addEventListener('click', function () { if (_fiIdx > 0) _fiLoad(_fiIdx - 1); });
    if (nextBtn) nextBtn.addEventListener('click', function () {
      var q = _normalise(_fiQ[_fiIdx]);
      if (q) {
        var allFilled = q.blank_keys.every(function (_, bi) {
          return (_fiAnswers.get(_fiIdx + ':' + bi) || '').trim().length > 0;
        });
        var allAnswered = q.blank_keys.every(function (_, bi) {
          return _fiStatus.has(_fiIdx + ':' + bi);
        });
        if (allFilled && !allAnswered) {
          _fiDoCheck();
          var advanceBtn = $id('fiGotIt');
          if (advanceBtn) {
            setTimeout(function () { advanceBtn.click(); }, 1500);
          }
          return;
        }
      }
      if (_fiIdx < _fiQ.length - 1) _fiLoad(_fiIdx + 1);
    });
    if (gotItBtn) gotItBtn.addEventListener('click', function () {
      if (_fiIdx < _fiQ.length - 1) {
        _fiLoad(_fiIdx + 1);
      } else {
        var doStartOver = function () {
          _fiStatus  = new Map();
          _fiAnswers = new Map();
          _fiAuraEarned = 0;
          _fiLoad(0);
        };
        var doMoreQuestions = function () {
          var btn = document.getElementById('fiMoreBtn');
          if (btn && !btn.disabled) { btn.click(); return; }
          doStartOver();
        };
        var _fiCorrectCount = 0;
        _fiStatus.forEach(function (v) { if (v === 'correct') _fiCorrectCount++; });
        if (typeof window.showRoundSummary === 'function') {
          window.showRoundSummary('fiRoundSummary', _fiAuraEarned, { correct: _fiCorrectCount, total: _fiQ.length }, doStartOver, doMoreQuestions);
        } else {
          setTimeout(doStartOver, 1800);
        }
      }
    });
    if (genBtn) genBtn.addEventListener('click', function () {
      if (typeof window.generateFillIn === 'function') window.generateFillIn();
    });

    // ── Hint toggle ──
    var fiStage = $id('fiStage');
    if (fiStage) {
      fiStage.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-fi-hint-toggle]');
        if (!btn) return;
        var hintEl = $qs('[data-fi-hint]', fiStage);
        if (!hintEl) return;

        var shouldShow = !hintEl.classList.contains('-visible');
        hintEl.classList.toggle('-visible');

        if (_hintHideTimer) {
          clearTimeout(_hintHideTimer);
          _hintHideTimer = null;
        }

        if (shouldShow) {
          btn.style.display = 'none';
          _hideHintAfterDelay();
        }
      });
    }

  };

  // ── Keyboard shortcuts (live lookups — no caching to survive unmount/remount) ──
  document.addEventListener('keydown', function (e) {
    var tabEl = $id('tab-more');
    if (!tabEl || !tabEl.classList.contains('room-vp--active')) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    var prevBtn = $id('fiPrev');
    var nextBtn = $id('fiNext');
    if (e.key === 'ArrowLeft' && prevBtn && !prevBtn.disabled) prevBtn.click();
    if (e.key === 'ArrowRight' && nextBtn && !nextBtn.disabled) nextBtn.click();
  });

  // ── "+ more fill-ins" ────────────────────────────────────────────────────
  // Shared by the fiMoreBtn click handler (room-tab-lazy.js) and the
  // guided-path "Want more practice?" promo. Shows the blocking append overlay
  // while the endpoint runs, and drops the results if the student cancels
  // mid-flight. When no fill-ins exist yet, falls back to a fresh generation
  // (generateFillIn) so a guided-path trigger works on an empty deck.
  window._fiAppendMore = function (opts) {
    opts = opts || {};
    var btn = opts.btn || null;
    var moreStatus = opts.statusEl || null;
    var PACK_ID = window.PACK_ID || (window.STUDY_ROOM_CONFIG && window.STUDY_ROOM_CONFIG.packId);
    if (!PACK_ID) return Promise.resolve(null);

    var limits = window.USER_LIMITS || {};
    var daily  = window.USER_DAILY  || {};
    var credits = window.USER_CREDITS || 0;
    var fiMoreRowEl = document.getElementById('fiMoreRow');
    if (credits <= 0) {
      var remaining = (limits.fillin_per_day || 0) - (daily.fillin || 0);
      if (remaining <= 0) {
        if (moreStatus) moreStatus.textContent = '\u26A0 Daily limit reached \u2014 upgrade for more';
        if (fiMoreRowEl) fiMoreRowEl.style.display = 'none';
        return Promise.resolve(null);
      }
    }

    var hasExisting = (window._fiQ && window._fiQ.length) || (window._fiData && window._fiData.length);

    var overlay = window.SrAppendOverlay;
    if (overlay && !overlay.isPending('tab-more')) {
      overlay.show('tab-more', {
        hint: hasExisting ? 'Generating more fill-ins\u2026' : 'Generating fill-ins\u2026',
        sub: 'This takes a few seconds \u2014 the new ones get added at the end.',
        phases: ['Generating fill-ins\u2026', 'Verifying quality\u2026', 'Almost done\u2026'],
        phaseDelays: [0, 4000, 9000],
        onCancel: function () {
          if (btn) { btn.disabled = false; btn.classList.remove('sr-more-loading'); }
        },
      });
    }

    if (btn) { btn.disabled = true; btn.classList.add('sr-more-loading'); }
    if (moreStatus) moreStatus.textContent = 'Generating\u2026';
    var stopFiMorePhases = window.srStartMorePhases ? window.srStartMorePhases(moreStatus, ['Generating fill-ins\u2026', 'Verifying quality\u2026', 'Almost done\u2026']) : function () {};
    window._fiAppending = true;

    // Fresh generation path (guided-path trigger on an empty deck). Falls
    // through to generateFillIn, whose poller hides the overlay when done.
    if (!hasExisting) {
      var genCap = (window.USER_LIMITS && window.USER_LIMITS.study_gen_cap) || 15;
      stopFiMorePhases();
      if (typeof window.generateFillIn === 'function') {
        window.generateFillIn(opts.count || genCap);
      } else {
        if (overlay) overlay.hide('tab-more');
        if (btn) { btn.disabled = false; btn.classList.remove('sr-more-loading'); }
      }
      return Promise.resolve(null);
    }

    var body = { group_index: 0, count: 15 };
    if (window._topicState && window._topicState.selected) body.topic = window._topicState.selected.title;
    if (opts.count) body.count = opts.count;
    if (opts.sectionText) body.section_text = opts.sectionText;

    return fetch('/library/pack/' + PACK_ID + '/generate-fill-ins/more', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': (document.querySelector('meta[name="csrf-token"]') || {}).content || '',
      },
      body: JSON.stringify(body),
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      window._fiAppending = false;
      stopFiMorePhases();
      if (overlay && !overlay.isPending('tab-more')) {
        // Student cancelled — drop the results.
        if (btn) { btn.disabled = false; btn.classList.remove('sr-more-loading'); }
        return data;
      }
      if (overlay) overlay.hide('tab-more');
      if (data.credit_balance !== undefined) {
        if (typeof updateCreditsBar === 'function') updateCreditsBar(data.credit_balance);
      }
      if (data.cycle_index != null && window._topicState) {
        window._topicState.cycleIndex = data.cycle_index;
        if (typeof _updateAllTopicLabels === 'function') {
          var labels = document.querySelectorAll('#srTopicLabelBar');
          _updateAllTopicLabels(labels);
        }
      }
      if (data.status === 'in_progress') {
        // A generation is already running for this pack — poll for completion
        // instead of double-firing (and do not charge anything). The quiz +
        // more handler uses the same pattern.
        if (window._fiPoller) { window._fiPoller.cancel(); window._fiPoller = null; }
        var _poll = window._pollResource || function() { return { cancel: function() {} }; };
        window._fiPoller = _poll(PACK_ID, 'fill_in', {
          onData: function(res) {
            var qs = (res.content && res.content.fill_in) || [];
            if (!qs.length) return;
            window._fiData = qs;
            if (res.resource_id) window._fiResourceId = res.resource_id;
            if (typeof window.renderFillIns === 'function') window.renderFillIns(qs);
            if (window._refreshAssessmentFilter) window._refreshAssessmentFilter('tab-more');
            if (btn) { btn.disabled = false; btn.classList.remove('sr-more-loading'); }
            if (moreStatus) moreStatus.textContent = '\u2713 ' + qs.length + ' fill-ins ready';
            setTimeout(function() { if (moreStatus) moreStatus.textContent = ''; }, 3000);
          },
          onFail: function() {
            if (moreStatus) moreStatus.textContent = '\u26A0 Generation failed';
            if (btn) { btn.disabled = false; btn.classList.remove('sr-more-loading'); }
          },
        });
        return data;
      }
      if (data.status === 'rate_limited') {
        if (moreStatus) moreStatus.textContent = '\u26A0 Please wait a moment before generating more.';
        setTimeout(function() { if (moreStatus) moreStatus.textContent = ''; }, 3000);
        if (btn) { btn.disabled = false; btn.classList.remove('sr-more-loading'); }
        return data;
      }
      if (data.status === 'no_new') {
        if (moreStatus) moreStatus.textContent = '\u2713 No new fill-ins added \u2014 everything here is already in your exercises';
        setTimeout(function() { if (moreStatus) moreStatus.textContent = ''; }, 3000);
        if (btn) { btn.disabled = false; btn.classList.remove('sr-more-loading'); }
        if (data.total >= 30 && fiMoreRowEl) fiMoreRowEl.style.display = 'none';
        return data;
      }
      if (data.ok && data.questions && data.questions.length) {
        if (window.USER_DAILY) window.USER_DAILY.fillin = (window.USER_DAILY.fillin || 0) + (data.added || 0);
        var normalised = (typeof window._normaliseAll === 'function') ? window._normaliseAll(data.questions) : data.questions;
        if (typeof window.renderFillIns === 'function') {
          var resumeAt = (typeof data.total === 'number' && typeof data.added === 'number') ? (data.total - data.added) : (window._fiIdx || 0);
          window.renderFillIns(normalised, { resumeAt: resumeAt, append: true });
          if (window._refreshAssessmentFilter) window._refreshAssessmentFilter('tab-more');
        } else {
          window._fiQ = normalised;
        }
        var totalEl = document.getElementById('fiTotal');
        if (totalEl) totalEl.textContent = normalised.length;
        if (btn) { btn.disabled = false; btn.classList.remove('sr-more-loading'); }
        if (moreStatus) moreStatus.textContent = '\u2713 ' + data.added + ' fill-ins added';
        setTimeout(function() { if (moreStatus) moreStatus.textContent = ''; }, 3000);
        if (data.max_reached && fiMoreRowEl) fiMoreRowEl.style.display = 'none';
      } else if (data.status === 'max_reached') {
        if (fiMoreRowEl) fiMoreRowEl.style.display = 'none';
        if (moreStatus) moreStatus.textContent = '';
      } else if (data.quota_exceeded) {
        if (moreStatus) moreStatus.textContent = '';
        if (fiMoreRowEl) fiMoreRowEl.style.display = 'none';
        if (window.maybeShowCreditsExhausted && window.maybeShowCreditsExhausted(data, 'fill-in exercises')) {
          if (btn) { btn.disabled = false; btn.classList.remove('sr-more-loading'); }
          return data;
        }
        if (typeof window.showQuotaModal === 'function') {
          window.showQuotaModal({
            resource: 'fill-in exercises',
            used: data.used,
            limit: data.limit,
            resetsInSeconds: data.resets_in_seconds, tier: data.tier,
          });
        } else {
          if (moreStatus) moreStatus.textContent = '\u26A0 Daily limit reached \u2014 upgrade for more';
        }
      } else {
        if (moreStatus) moreStatus.textContent = '\u26A0 ' + (data.error || 'Failed');
        if (btn) { btn.disabled = false; btn.classList.remove('sr-more-loading'); }
      }
      return data;
    })
    .catch(function() {
      window._fiAppending = false;
      stopFiMorePhases();
      if (overlay) overlay.hide('tab-more');
      if (moreStatus) moreStatus.textContent = '\u26A0 Network error';
      if (btn) { btn.disabled = false; btn.textContent = '+ more fill-ins'; }
      return null;
    });
  };
})();
