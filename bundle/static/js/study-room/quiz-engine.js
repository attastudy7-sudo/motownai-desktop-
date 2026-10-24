// Quiz engine
(function(){
  var _qzQ = [];
  var _qzIdx = 0;
  var _qzSelected = {}; // idx -> option index
  var _qzCorrect = {};  // idx -> true/false
  var _qzQpMap = new Map(); // idx -> {tier, streak}
  var _qzQpLoading = true;
  var _qzQpTotal = 0;
  var _qzAuraEarned = 0;
  // Accumulators that survive renderQuiz resets (carry totals across "More" rounds)
  var _qzAccumCorrect = 0;
  var _qzAccumTotal = 0;
  var _qzAccumAura = 0;

  var TIERS = ['unfamiliar','learning','familiar','mastered'];

  // Quiz timer — mirrors the guided-path section quiz timer. Auto-submits the
  // round (shows the summary) when time runs out. Gated by the shared
  // 'Quiz timer' preference and a one-time first-run consent banner.
  var _qzTimerEnd = 0;
  var _qzTimerHandle = null;
  var _qzTimerFallback = null;
  var _qzTimerDone = false;

  function _qzNextTier(t) {
    var i = TIERS.indexOf(t);
    return i >= 0 && i < TIERS.length - 1 ? TIERS[i + 1] : t;
  }
  function _qzPrevTier(t) {
    var i = TIERS.indexOf(t);
    return i > 0 ? TIERS[i - 1] : t;
  }

  function _qzUpdateBadgeBar() {
    var counts = { unfamiliar: 0, learning: 0, familiar: 0, mastered: 0 };
    var total = _qzQpTotal || _qzQ.length;
    var tracked = 0;
    _qzQpMap.forEach(function(p) {
      if (counts.hasOwnProperty(p.tier)) counts[p.tier]++;
      tracked++;
    });
    counts.unfamiliar += Math.max(0, total - tracked);
    counts.total = total;
    var bar = document.querySelector('#tab-quiz .sr-badge-bar');
    if (!bar) return;
    TIERS.forEach(function(t) {
      var el = bar.querySelector('#badge-' + t);
      if (el) el.textContent = counts[t];
    });
  }
  window._qzSetTotal = function(n) { _qzQpTotal = n; _qzUpdateBadgeBar(); };
  window._qzGoTo = function(i) { _qzNavTo(i); };

  function _qzRecordAnswer(questionIdx, correct) {
    var p = _qzQpMap.get(questionIdx) || { tier: 'unfamiliar', streak: 0 };
    if (correct) {
      p.streak++;
      if (p.streak >= 1 && p.tier !== 'mastered') {
        p.tier = _qzNextTier(p.tier);
        p.streak = 0;
      }
    } else {
      p.tier = _qzPrevTier(p.tier);
      p.streak = 0;
    }
    _qzQpMap.set(questionIdx, p);
    _qzUpdateBadgeBar();

    var resId = window._qzResourceId;
    var packId = window.PACK_ID;
    if (!resId || !packId || !window.USER_IS_AUTHENTICATED) return;
    var csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
    fetch('/api/question-answer', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-CSRFToken': csrf},
      body: JSON.stringify({
        pack_id: packId, resource_id: resId,
        item_type: 'quiz', question_idx: questionIdx, correct: correct
      })
    }).then(function(r){return r.json()}).then(function(data){
      if (!data.badges) return;
      // Sync server-side result
      var sp = _qzQpMap.get(questionIdx);
      if (sp) { sp.tier = data.tier; sp.streak = data.streak; }
      // Update badge counts from server authoritative response
      var bar = document.querySelector('#tab-quiz .sr-badge-bar');
      if (bar) {
        TIERS.forEach(function(t) {
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
        _qzAuraEarned += data.xp_earned;
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
              item_type: 'quiz', question_idx: questionIdx, correct: correct
            })
          }).catch(function() {});
        });
      }
    });
  }

  // Shown once the user advances past the last question — displays the
  // cumulative score across all "More" rounds, then resets or continues.
  function _qzShowRoundComplete() {
    _qzStopTimer();
    var roundCorrect = 0;
    for (var k in _qzCorrect) { if (_qzCorrect[k]) roundCorrect++; }
    var totalCorrect = _qzAccumCorrect + roundCorrect;
    var totalQuestions = _qzAccumTotal + _qzQ.length;
    var totalAura = _qzAccumAura + _qzAuraEarned;
    var doStartOver = function () {
      _qzAccumCorrect = 0;
      _qzAccumTotal = 0;
      _qzAccumAura = 0;
      _qzSelected = {};
      _qzCorrect = {};
      _qzAuraEarned = 0;
      _qzNavTo(0);
      _qzEnsureTimer();
    };
    var doMoreQuestions = function () {
      var btn = document.getElementById('qzMoreBtn');
      if (btn && !btn.disabled) {
        // Snapshot cumulative totals before appending new round
        _qzAccumCorrect = totalCorrect;
        _qzAccumTotal = totalQuestions;
        _qzAccumAura = totalAura;
        btn.click();
        return;
      }
      // Button missing or still loading — just dismiss, don't reset accumulated score
    };
    if (typeof window.showRoundSummary === 'function') {
      window.showRoundSummary('qzRoundSummary', totalAura, { correct: totalCorrect, total: totalQuestions }, doStartOver, doMoreQuestions);
    } else {
      doStartOver();
    }
  }

  function _qzFormatTime(totalSec) {
    var m = Math.floor(totalSec / 60);
    var s = totalSec % 60;
    return m + ':' + (s < 10 ? '0' + s : s);
  }

  function _qzTimerEnabled() {
    return typeof window.motownQuizTimerEnabled !== 'function' || window.motownQuizTimerEnabled();
  }

  function _qzTimerConsented() {
    return localStorage.getItem('motown-quiz-timer-consent') === '1';
  }

  function _qzSetTimerConsented() {
    localStorage.setItem('motown-quiz-timer-consent', '1');
  }

  // First-run consent: show once when a quiz loads with the timer on. The
  // choice is sticky (writes the preference), so later runs just respect it.
  function _qzShowTimerConsent() {
    var banner = document.getElementById('qzTimerConsent');
    var timerEl = document.getElementById('qzTimer');
    if (!banner) return;
    if (!_qzTimerEnabled() || _qzTimerConsented() || !_qzQ.length) return;
    banner.style.display = 'flex';
    if (timerEl) timerEl.style.display = 'none';
    _qzStopTimer();

    // Wire consent buttons once
    if (!banner._qzWired) {
      banner._qzWired = true;
      var keep = document.getElementById('qzTimerConsentKeep');
      var off = document.getElementById('qzTimerConsentOff');
      if (keep) keep.addEventListener('click', function() {
        _qzSetTimerConsented();
        banner.style.display = 'none';
        _qzStartTimer(_qzQ.length);
      });
      if (off) off.addEventListener('click', function() {
        _qzSetTimerConsented();
        localStorage.setItem('motown-quiz-timer', '0');
        window.dispatchEvent(new CustomEvent('motown:quiz-timer', { detail: { enabled: false } }));
        banner.style.display = 'none';
        var timerEl2 = document.getElementById('qzTimer');
        if (timerEl2) timerEl2.style.display = 'none';
        _qzStopTimer();
      });
    }
  }

  function _qzStartTimer(totalQuestions) {
    _qzStopTimer();
    _qzTimerDone = false;

    var timerEl = document.getElementById('qzTimer');
    var textEl = document.getElementById('qzTimerText');
    if (!timerEl || !textEl) return;

    var durationSec = totalQuestions * 60;
    _qzTimerEnd = Date.now() + durationSec * 1000;
    textEl.textContent = _qzFormatTime(durationSec);
    timerEl.classList.remove('warning');
    timerEl.style.display = 'inline-flex';

    _qzTimerHandle = setInterval(function () {
      var remaining = Math.max(0, Math.round((_qzTimerEnd - Date.now()) / 1000));
      if (textEl) textEl.textContent = _qzFormatTime(remaining);
      timerEl.classList.toggle('warning', remaining <= 60);
      if (remaining <= 0) _qzAutoSubmitQuiz();
    }, 500);

    _qzTimerFallback = setTimeout(function () {
      _qzAutoSubmitQuiz();
    }, durationSec * 1000 + 500);
  }

  function _qzStopTimer() {
    if (_qzTimerHandle) { clearInterval(_qzTimerHandle); _qzTimerHandle = null; }
    if (_qzTimerFallback) { clearTimeout(_qzTimerFallback); _qzTimerFallback = null; }
  }

  // "Submit" on timeout — jump to the existing round summary. Guards against
  // double-fire from the interval + fallback timer.
  function _qzAutoSubmitQuiz() {
    if (_qzTimerDone) return;
    _qzTimerDone = true;
    _qzStopTimer();
    var timerEl = document.getElementById('qzTimer');
    if (timerEl) timerEl.style.display = 'none';
    if (window._qzTimedOut === true) return;
    if (_qzQ.length && _qzStageActive()) _qzShowRoundComplete();
  }

  function _qzStageActive() {
    var stage = document.getElementById('qzStage');
    return !!stage && stage.style.display !== 'none';
  }

  // Called after a quiz is (re)rendered. Starts the countdown when the timer
  // is enabled and consented; otherwise surfaces the one-time consent banner.
  function _qzEnsureTimer() {
    var banner = document.getElementById('qzTimerConsent');
    if (!_qzQ.length || !_qzStageActive()) {
      if (banner) banner.style.display = 'none';
      return;
    }
    if (!_qzTimerEnabled()) {
      _qzStopTimer();
      var timerEl = document.getElementById('qzTimer');
      if (timerEl) timerEl.style.display = 'none';
      if (banner) banner.style.display = 'none';
      return;
    }
    if (!_qzTimerConsented()) {
      _qzShowTimerConsent();
      return;
    }
    if (banner) banner.style.display = 'none';
    _qzStartTimer(_qzQ.length);
  }

  window._qzStopTimer = _qzStopTimer;
  window._qzStartTimer = _qzStartTimer;
  window._qzEnsureTimer = _qzEnsureTimer;
  function _qzEsc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Render AI content (markdown: LaTeX, fenced code, pipe tables, lists) via the
  // shared sanitized pipeline. Falls back to plain escaping when marked is absent
  // so we never inject unsanitized HTML.
  function _qzRich(s, inline) {
    var t = String(s == null ? '' : s);
    if (!t.trim()) return '';
    if (typeof window.motownRenderMarkdown === 'function' &&
        typeof marked !== 'undefined' && marked.parse) {
      return window.motownRenderMarkdown(t, inline);
    }
    return _qzEsc(t);
  }

  function _qzNormalizeQuestion(q) {
    q = q || {};
    var _qzLetters = ['A','B','C','D','E','F'];
    var rawOptions = Array.isArray(q.options) ? q.options : [];
    var options = rawOptions.map(function(opt) {
      if (typeof opt === 'string') return { letter: '', text: opt };
      if (opt && typeof opt === 'object') {
        return { letter: String(opt.letter || '').toUpperCase(), text: opt.text || opt.label || opt.value || '' };
      }
      return { letter: '', text: '' };
    }).filter(function(o) { return !!o.text; });

    options.forEach(function(o, i) {
      if (!o.letter) o.letter = _qzLetters[i] || String(i + 1);
    });

    var correct = q.correct;
    if (correct === undefined || correct === null || correct === '') {
      correct = q.correct_answer;
    }
    if (correct === undefined || correct === null || correct === '') {
      correct = q.answer;
    }

    var correctLetter = '';
    if (typeof correct === 'string') {
      var t = correct.trim().toUpperCase();
      if (_qzLetters.indexOf(t) >= 0) {
        correctLetter = t;
        correct = options.findIndex(function(o) { return o.letter === t; });
      } else {
        correct = options.findIndex(function(o) {
          return o.text.trim().toUpperCase() === t;
        });
        if (correct >= 0) correctLetter = options[correct].letter;
      }
    } else {
      correct = parseInt(correct, 10);
      if (isNaN(correct)) correct = 0;
      if (correct >= 0 && correct < options.length) correctLetter = options[correct].letter;
    }
    if (correct < 0 || correct >= options.length) { correct = 0; correctLetter = options[correct].letter; }

    var rawExp = (q.option_explanations && typeof q.option_explanations === 'object') ? q.option_explanations : {};
    var expByIndex = {};
    options.forEach(function(o, i) {
      var byLetter = rawExp[o.letter] !== undefined ? rawExp[o.letter] : rawExp[String(i)];
      expByIndex[i] = (typeof byLetter === 'string') ? byLetter : '';
    });

    // Shuffle options so order is unpredictable each session load
    var idx = options.map(function(_, i) { return i; });
    for (var si = idx.length - 1; si > 0; si--) {
      var sj = Math.floor(Math.random() * (si + 1));
      var tmp = idx[si]; idx[si] = idx[sj]; idx[sj] = tmp;
    }
    var shuffledTexts = [];
    var shuffledExp = {};
    var newCorrect = 0;
    idx.forEach(function(oldIdx, newIdx) {
      shuffledTexts.push(options[oldIdx].text);
      shuffledExp[newIdx] = expByIndex[oldIdx];
      if (oldIdx === correct) newCorrect = newIdx;
    });
    if (newCorrect < 0 || newCorrect >= shuffledTexts.length) newCorrect = 0;

    // Options are re-shuffled (and re-lettered) on every render, so re-point
    // unambiguous "correct answer" references in the AI's explanation/solution
    // at the letter actually shown. The AI always writes the letter it
    // generated for the correct answer; the shuffle moves that answer to a new
    // position, so these phrases must be rewritten to the post-shuffle letter.
    var correctLetter = _qzLetters[newCorrect] || String(newCorrect + 1);
    var newExplanation = _qzResolveOptionRefs(q.explanation || '', correctLetter);
    var newSolution = _qzResolveOptionRefs(q.solution || '', correctLetter);

    return {
      question: q.question || q.question_text || q.text || '—',
      options: shuffledTexts,
      correct: newCorrect,
      explanation: newExplanation,
      solution: newSolution,
      option_explanations: shuffledExp,
    };
  }

  // Rewrite option-letter references in AI-generated explanation text so they
  // stay consistent after options are shuffled. A {CORRECT} placeholder (the
  // token generation prompts instruct the AI to use) is substituted with the
  // letter actually shown. Legacy phrases that unambiguously name the correct
  // answer ("the correct answer is B", "B is the correct answer") are
  // re-pointed at the post-shuffle letter. References to WRONG options
  // ("Option C is incorrect") are left untouched — we can't know their target.
  function _qzResolveOptionRefs(text, correctLetter) {
    if (!text || !correctLetter) return text || '';
    var L = String(correctLetter).toUpperCase();
    var upperLetter = function (m, pre, letter) {
      return (letter === letter.toUpperCase()) ? pre + ' ' + L : m;
    };
    return String(text)
      .replace(/\{\s*CORRECT\s*\}/gi, L)
      .replace(/\[\s*CORRECT\s*\]/gi, L)
      .replace(/\b(the correct answer(?: is| was)?:?)\s*\(?\s*([A-F])\s*\)?(?![A-Za-z0-9])/gi, upperLetter)
      .replace(/\b(correct answer(?:\s+(?:is|was):?|:))\s*\(?\s*([A-F])\s*\)?(?![A-Za-z0-9])/gi, upperLetter)
      .replace(/\b((?:the )?answer (?:is|was):?)\s*\(?\s*([A-F])\s*\)?(?![A-Za-z0-9])/gi, upperLetter)
      .replace(/\b([A-F])\s+is the correct answer\b/gi, function (m, letter) {
        return (letter === letter.toUpperCase()) ? L + ' is the correct answer' : m;
      })
      .replace(/\b((?:answer choice|option|choice))\s+([A-F])\s+is correct\b/gi, function (m, kind, letter) {
        return (letter === letter.toUpperCase()) ? kind + ' ' + L + ' is correct' : m;
      });
  }

  var _qzAnimating = false;

  function _qzAnimateOptions() {
    var cards = document.querySelectorAll('.qz-choice');
    cards.forEach(function(card, i) {
      card.style.opacity = '0';
      card.style.transform = 'translateY(12px)';
      setTimeout(function() {
        card.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        card.style.opacity = '1';
        card.style.transform = 'translateY(0)';
        setTimeout(function() {
          card.style.transition = '';
          card.style.opacity = '';
          card.style.transform = '';
        }, 350);
      }, i * 60);
    });
  }

  function _qzNavTo(i) {
    if (i === _qzIdx || _qzAnimating) return;
    var stage = document.getElementById('qzStage');
    if (!stage) { _qzLoad(i); return; }
    var forward = i > _qzIdx;

    _qzAnimating = true;
    var p = document.getElementById('qzPrev'), n = document.getElementById('qzNext');
    if (p) p.disabled = true; if (n) n.disabled = true;

    var exitClass = forward ? 'qz-anim-exit-left' : 'qz-anim-exit-right';
    var enterClass = forward ? 'qz-anim-enter-left' : 'qz-anim-enter-right';

    var fallbackTimer = setTimeout(function() {
      stage.removeEventListener('animationend', onAnimEnd);
      stage.classList.remove('qz-anim-exit-left', 'qz-anim-exit-right', 'qz-anim-enter-left', 'qz-anim-enter-right');
      _qzLoad(i);
      _qzAnimating = false;
      if (p) p.disabled = false; if (n) n.disabled = false;
    }, 1000);

    function onAnimEnd(e) {
      clearTimeout(fallbackTimer);
      stage.removeEventListener('animationend', onAnimEnd);
      if (e.animationName === 'qz-exit-left' || e.animationName === 'qz-exit-right') {
        stage.classList.remove('qz-anim-exit-left', 'qz-anim-exit-right');
        _qzLoad(i);
        void stage.offsetHeight;
        fallbackTimer = setTimeout(function() {
          stage.removeEventListener('animationend', onAnimEnd);
          stage.classList.remove('qz-anim-enter-left', 'qz-anim-enter-right');
          _qzAnimating = false;
          if (p) p.disabled = false; if (n) n.disabled = false;
        }, 1000);
        stage.classList.add(enterClass);
        stage.addEventListener('animationend', onAnimEnd);
      } else if (e.animationName === 'qz-enter-left' || e.animationName === 'qz-enter-right') {
        stage.classList.remove('qz-anim-enter-left', 'qz-anim-enter-right');
        _qzAnimating = false;
        if (p) p.disabled = false; if (n) n.disabled = false;
      }
    }

    stage.classList.add(exitClass);
    stage.addEventListener('animationend', onAnimEnd);
  }

  function _qzLoad(i) {
    _qzIdx = i;
    window._qzIdx = i;
    var q = _qzQ[i];
    if (!q) return;

    var prevIdx = window._qzPrevIdx;
    window._qzPrevIdx = i;
    var isNewQuestion = (prevIdx !== i);

    var answered = _qzSelected[i] !== undefined;
    var qzCurrentEl = document.getElementById('qzCurrent');
    if (qzCurrentEl) qzCurrentEl.textContent = i + 1;
    var qzQuestionEl = document.getElementById('qzText');
    if (qzQuestionEl) qzQuestionEl.innerHTML = _qzRich(q.question || '—');
    var qzEyeEl = document.getElementById('qzEye');
    if (qzEyeEl) qzEyeEl.textContent = 'Question ' + (i + 1) + ' of ' + (_qzQ.length || 1);

    var options = q.options || [];
    var selected = _qzSelected[i];
    var answered = selected !== undefined;

    var labels = ['A','B','C','D','E','F'];
    var optHtml = '';
    options.forEach(function(opt, oi) {
      var letter = labels[oi] || (oi + 1);
      var isCorrect = answered && oi === q.correct;
      var isWrong   = answered && oi === selected && oi !== q.correct;
      var isSelected = !answered && oi === selected;
      var cardCls = 'qz-choice';
      if (isCorrect)  cardCls += ' qz-choice--correct';
      if (isWrong)    cardCls += ' qz-choice--wrong';
      if (isSelected) cardCls += ' qz-choice--selected';
      if (answered && !isCorrect && !isWrong) cardCls += ' qz-choice--dimmed';
      optHtml += '<button type="button" class="' + cardCls + '" data-opt="' + oi + '"' + (answered ? ' disabled' : '') + '>' +
        '<span class="qz-bub">' + letter + '</span>' +
        '<span class="qz-choice-text">' + _qzRich(opt, true) + '</span>' +
        '</button>';
    });
    var optsEl = document.getElementById('qzChoices');
    if (optsEl) optsEl.innerHTML = optHtml;
    if (isNewQuestion) _qzAnimateOptions();

    // Bottom feedback content (no card flip)
    var qzExplanationEl = document.getElementById('qzExplanation');
    if (qzExplanationEl) {
      if (!answered) {
        qzExplanationEl.style.display = 'none';
        qzExplanationEl.innerHTML = '';
      } else {
        qzExplanationEl.style.display = '';
        var fbHtml = '';
        var pickedExp = (q.option_explanations && q.option_explanations[String(selected)]) || '';
        var mainText = q.solution || q.explanation || '';
        var headText = q.solution ? 'Solution' : 'Explanation';
        if (pickedExp || mainText) {
          if (mainText) {
            fbHtml += '<div class="qz-solution__head">' + headText + '</div>';
          }
          if (pickedExp) {
            fbHtml += '<div class="qz-choice-exp">' + _qzRich(pickedExp) + '</div>';
          }
          if (mainText) {
            fbHtml += '<div class="qz-solution__body">' + _qzRich(mainText) + '</div>';
          }
        }
        qzExplanationEl.innerHTML = fbHtml;
      }
    }

    var nextBtn = document.getElementById('qzNext');
    if (nextBtn) {
      if (answered) {
        nextBtn.classList.add('fc-nav-btn--active');
        nextBtn.disabled = false;
      } else {
        nextBtn.classList.remove('fc-nav-btn--active');
        nextBtn.disabled = false;
      }
    }

    var prevBtn = document.getElementById('qzPrev');
    if (prevBtn) prevBtn.disabled = (i === 0);

    // Attach click listeners if not answered
    if (!answered && optsEl) {
      optsEl.querySelectorAll('.qz-choice').forEach(function(el) {
        el.addEventListener('click', function() {
          var oi = parseInt(this.dataset.opt);
          _qzSelected[_qzIdx] = oi;
          var q2 = _qzQ[_qzIdx];
          var correct = (oi === q2.correct);
          _qzCorrect[_qzIdx] = correct;
          _qzLoad(_qzIdx); // re-render with bottom explanation
          _qzRecordAnswer(_qzIdx, correct);
        });
      });
    }
    if (answered) {
      setTimeout(function () {
        var tab = document.querySelector('#tab-quiz.room-vp');
        if (tab) {
          var target = tab.scrollHeight - tab.clientHeight;
          document.documentElement.classList.add('qz-quiz-scrolling');
          if (target > 0) {
            var start = tab.scrollTop;
            var diff = target - start;
            var duration = 700;
            var startTime = null;
            function step(now) {
              if (!startTime) startTime = now;
              var elapsed = now - startTime;
              var t = Math.min(elapsed / duration, 1);
              var ease = 1 - Math.pow(1 - t, 3);
              tab.scrollTop = start + diff * ease;
              if (t < 1) requestAnimationFrame(step);
              else document.documentElement.classList.remove('qz-quiz-scrolling');
            }
            requestAnimationFrame(step);
          } else {
            document.documentElement.classList.remove('qz-quiz-scrolling');
          }
        }
      }, 250);
    }
    // Show Enter-to-continue hint; dim before answering, bright after
    var hint = document.getElementById('qzEnterHint');
    if (hint) {
      hint.style.display = '';
      if (answered) {
        hint.classList.add('active');
      } else {
        hint.classList.remove('active');
      }
    }

    // Typeset math in quiz content
    if (typeof window.motownTypesetMath === 'function') {
      var qzStage = document.getElementById('qzStage');
      if (qzStage) window.motownTypesetMath(qzStage);
    }
  }

  window.renderQuiz = function(questions) {
    // Wire nav buttons once (uses private _qzIdx/_qzQ directly)
    if (!window._qzNavWired) {
      window._qzNavWired = true;
      var prev = document.getElementById('qzPrev');
      var next = document.getElementById('qzNext');
      if (prev) prev.addEventListener('click', function () {
        if (_qzIdx > 0) _qzNavTo(_qzIdx - 1);
      });
      if (next) next.addEventListener('click', function () {
        if (_qzIdx < _qzQ.length - 1) {
          _qzNavTo(_qzIdx + 1);
        } else {
          _qzShowRoundComplete();
        }
      });
    }
    _qzQ = Array.isArray(questions) ? questions.map(_qzNormalizeQuestion) : [];
    if (typeof window._dedupItems === 'function') {
      _qzQ = window._dedupItems(_qzQ, 'quiz');
    }
    window._qzQ = _qzQ;
    _qzIdx = 0;
    window._qzIdx = 0;
    _qzSelected = {};
    _qzCorrect = {};
    _qzAuraEarned = 0;
    _qzAccumCorrect = 0;
    _qzAccumTotal = 0;
    _qzAccumAura = 0;
    _qzQpMap = new Map();
    _qzQpTotal = _qzQ.length;
    document.getElementById('qzLoading').style.display = 'none';
    if (!_qzQ.length) {
      document.getElementById('qzStage').style.display = 'none';
      document.getElementById('qzNav').style.display = 'none';
      document.getElementById('qzCounter').style.display = 'none';
      document.getElementById('qzMoreRow').style.display = 'none';
      document.getElementById('qzEmpty').style.display = 'flex';
      var qzTotalEmpty = document.getElementById('qzTotal');
      if (qzTotalEmpty) qzTotalEmpty.textContent = '0';
      var hintEmpty = document.getElementById('qzEnterHint');
      if (hintEmpty) hintEmpty.style.display = 'none';
      return;
    }

    document.getElementById('qzEmpty').style.display = 'none';
    document.getElementById('qzNav').style.display = '';
    document.getElementById('qzCounter').style.display = '';
    document.getElementById('qzStage').style.display = '';
    document.getElementById('qzMoreRow').style.display = '';
    var qzBar = document.querySelector('#tab-quiz .sr-badge-bar');
    if (qzBar) qzBar.style.display = '';
    var qzTotal = document.getElementById('qzTotal');
    if (qzTotal) qzTotal.textContent = _qzQ.length;

    // Fetch per-question progress and populate map
    var resId = window._qzResourceId;
    if (!resId || !window.USER_IS_AUTHENTICATED) { _qzUpdateBadgeBar(); _qzLoad(0); _qzEnsureTimer(); return; }
    fetch('/api/question-progress?resource_id=' + resId + '&item_type=quiz')
      .then(function(r) { return r.json(); })
      .then(function(rows) {
        rows.forEach(function(r) {
          _qzQpMap.set(r.question_idx, { tier: r.tier, streak: r.streak });
        });
        _qzUpdateBadgeBar();
        _qzLoad(0);
        _qzEnsureTimer();
      })
      .catch(function() {
        _qzLoad(0);
        _qzEnsureTimer();
      });
  };

  window.generateQuiz = function(count) {
    var numQuestions = count;
    if (!numQuestions) {
      numQuestions = (window.USER_LIMITS && window.USER_LIMITS.study_gen_cap) || 15;
    }

    var qzEmpty = document.getElementById('qzEmpty');
    var qzNav = document.getElementById('qzNav');
    var qzCounter = document.getElementById('qzCounter');
    var qzStage = document.getElementById('qzStage');
    var qzMoreRow = document.getElementById('qzMoreRow');
    var qzLoading = document.getElementById('qzLoading');
    var genBtn = document.getElementById('qzGenerateBtn');

    if (qzEmpty) qzEmpty.style.display = 'none';
    if (qzNav) qzNav.style.display = 'none';
    if (qzCounter) qzCounter.style.display = 'none';
    if (qzStage) qzStage.style.display = 'none';
    if (qzMoreRow) qzMoreRow.style.display = 'none';
    if (qzLoading) qzLoading.style.display = 'flex';
    var _qzStopPct = _startGenPct('qzPct');
    if (genBtn) genBtn.disabled = true;

    var packId = window.PACK_ID || (window.STUDY_ROOM_CONFIG && window.STUDY_ROOM_CONFIG.packId);
    if (!packId) {
      if (_qzStopPct) _qzStopPct(false);
      if (qzLoading) qzLoading.style.display = 'none';
      if (qzEmpty) qzEmpty.style.display = 'flex';
      if (genBtn) genBtn.disabled = false;
      return;
    }

    var csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
    fetch('/library/pack/' + packId + '/generate-quiz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch', 'X-CSRFToken': csrf },
      body: JSON.stringify({ num_items: numQuestions, group_index: 0, topic: window._topicState && window._topicState.selected ? window._topicState.selected.title : null, section_text: window._topicState && window._topicState.selected ? window._topicState.selected.section_text : null }),
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
      // Async path: backend queued the job, poll until done
      if (data.ok && data.status === 'generating') {
        if (data.resource_id) window._qzResourceId = data.resource_id;
        if (window._qzPoller) { window._qzPoller.cancel(); window._qzPoller = null; }
        window._qzPollStarted = true;
        var _poll = window._pollResource || function() { return { cancel: function() {} }; };
        window._qzPoller = _poll(packId, 'quiz', {
          onEmpty: function() {
            if (_qzStopPct) _qzStopPct(false);
            if (qzLoading) qzLoading.style.display = 'none';
            if (qzEmpty) qzEmpty.style.display = 'flex';
            if (genBtn) { genBtn.disabled = false; genBtn.textContent = 'Try Again'; }
          },
          onData: function(res) {
            if (_qzStopPct) _qzStopPct(true);
            var questions = (res.content && (res.content.quiz || res.content.questions)) || [];
            // Guard against transient poll ticks that haven't populated the
            // content yet — renderQuiz([]) would blank the deck into the empty
            // state even though questions are being generated. Matches the
            // guard already used by _qzAppendMore's poll.
            if (!questions.length) return;
            if (res.resource_id) window._qzResourceId = res.resource_id;
            window._qzData = questions;
            if (typeof window.renderQuiz === 'function') window.renderQuiz(questions);
          },
          onFail: function() {
            if (_qzStopPct) _qzStopPct(false);
            if (qzLoading) qzLoading.style.display = 'none';
            if (qzEmpty) qzEmpty.style.display = 'flex';
            if (genBtn) { genBtn.disabled = false; genBtn.textContent = 'Try Again'; }
          },
        });
        return;
      }

      if (_qzStopPct) _qzStopPct(true);
      if (qzLoading) qzLoading.style.display = 'none';
      if (genBtn) genBtn.disabled = false;

      if (data.quota_exceeded) {
        if (qzEmpty) qzEmpty.style.display = 'flex';
        if (window.maybeShowCreditsExhausted && window.maybeShowCreditsExhausted(data, 'quiz questions')) {
          return;
        }
        if (typeof window.showQuotaModal === 'function') {
          window.showQuotaModal({
            resource: 'quiz questions',
            used: data.used,
            limit: data.limit,
            resetsInSeconds: data.resets_in_seconds, tier: data.tier,
          });
        } else if (typeof window.openUpgradeModal === 'function') {
          window.openUpgradeModal();
        }
        return;
      }

      if (data.ok && data.questions && data.questions.length) {
        if (qzEmpty) qzEmpty.style.display = 'none';
        if (data.resource_id) window._qzResourceId = data.resource_id;
        window._qzData = data.questions;
        window._qzQ = data.questions.map(_qzNormalizeQuestion);
        _qzQ = window._qzQ;
        window._qzIdx = 0;
        _qzIdx = 0;
        window._qzAnswered = {};
        _qzAuraEarned = 0;
        _qzAccumCorrect = 0;
        _qzAccumTotal = 0;
        _qzAccumAura = 0;
        if (qzCounter) qzCounter.style.display = '';
        if (qzNav) qzNav.style.display = '';
        if (qzStage) qzStage.style.display = '';
        if (qzMoreRow) qzMoreRow.style.display = '';
        var qzTotal = document.getElementById('qzTotal');
        if (qzTotal) qzTotal.textContent = window._qzQ.length;
        _qzLoad(0);
        _qzEnsureTimer();
      } else {
        if (qzEmpty) qzEmpty.style.display = 'flex';
        if (genBtn) genBtn.textContent = 'Try Again';
      }
    })
    .catch(function() {
      if (_qzStopPct) _qzStopPct(false);
      if (qzLoading) qzLoading.style.display = 'none';
      if (qzEmpty) qzEmpty.style.display = 'flex';
      if (genBtn) { genBtn.disabled = false; genBtn.textContent = 'Try Again'; }
    });
  };

  // Re-render the current question without resetting _qzSelected/_qzCorrect.
  // Used by initQuizTab on remount so previously answered questions stay answered.
  window._qzRerender = function() {
    if (!_qzQ.length) return false;
    if (!window._qzNavWired) {
      window._qzNavWired = true;
      var prev = document.getElementById('qzPrev');
      var next = document.getElementById('qzNext');
      if (prev) prev.addEventListener('click', function() {
        if (_qzIdx > 0) _qzNavTo(_qzIdx - 1);
      });
      if (next) next.addEventListener('click', function() {
        if (_qzIdx < _qzQ.length - 1) {
          _qzNavTo(_qzIdx + 1);
        } else {
          _qzShowRoundComplete();
        }
      });
    }
    var _g = function(id) { return document.getElementById(id); };
    var l = _g('qzLoading'); if (l) l.style.display = 'none';
    var e = _g('qzEmpty');   if (e) e.style.display = 'none';
    var n = _g('qzNav');     if (n) n.style.display = '';
    var c = _g('qzCounter'); if (c) c.style.display = '';
    var s = _g('qzStage');   if (s) s.style.display = '';
    var m = _g('qzMoreRow'); if (m) m.style.display = '';
    var t = _g('qzTotal');   if (t) t.textContent = _qzQ.length;
    _qzLoad(_qzIdx);
    _qzEnsureTimer();
    return true;
  };

  // Re-filter the quiz question set without resetting answers/progress.
  // Used by the topic filter (topic-filter.js) to swap question lists
  // while preserving _qzSelected/_qzCorrect for questions that remain.
  window._qzApplyFilter = function(filtered) {
    var normed = (Array.isArray(filtered) ? filtered : []).map(_qzNormalizeQuestion);
    var prevQ = _qzQ.slice();
    var prevSelected = Object.assign({}, _qzSelected);
    var prevCorrect = Object.assign({}, _qzCorrect);
    _qzQ = normed;
    window._qzQ = _qzQ;
    window._qzData = Array.isArray(filtered) ? filtered : [];
    // Re-map answers for questions still present (matched by question text)
    _qzSelected = {};
    _qzCorrect = {};
    normed.forEach(function(q, i) {
      var qText = (q && q.question) || '';
      for (var j = 0; j < prevQ.length; j++) {
        var prevQText = (prevQ[j] && prevQ[j].question) || '';
        if (qText === prevQText) {
          if (prevSelected[j] !== undefined) _qzSelected[i] = prevSelected[j];
          if (prevCorrect[j] !== undefined) _qzCorrect[i] = prevCorrect[j];
          break;
        }
      }
    });
    if (!_qzQ.length) {
      var stage = document.getElementById('qzStage');
      var nav = document.getElementById('qzNav');
      var counter = document.getElementById('qzCounter');
      var more = document.getElementById('qzMoreRow');
      var empty = document.getElementById('qzEmpty');
      if (stage) stage.style.display = 'none';
      if (nav) nav.style.display = 'none';
      if (counter) counter.style.display = 'none';
      if (more) more.style.display = 'none';
      if (empty) empty.style.display = 'flex';
      var qzTotalEl = document.getElementById('qzTotal');
      if (qzTotalEl) qzTotalEl.textContent = '0';
      return;
    }
    if (_qzIdx >= _qzQ.length) _qzIdx = 0;
    window._qzIdx = _qzIdx;
    _qzLoad(_qzIdx);
    _qzEnsureTimer();
    var qzTotal = document.getElementById('qzTotal');
    if (qzTotal) qzTotal.textContent = String(_qzQ.length);
  };

  // Setup event listeners immediately (script runs at bottom of body)
  // Elements are inside a <template> and don't exist yet — null-guard is required
  var _qzPrevEl = document.getElementById('qzPrev');
  if (_qzPrevEl) _qzPrevEl.addEventListener('click', function() {
    if (_qzIdx > 0) _qzNavTo(_qzIdx - 1);
  });
  var _qzNextEl = document.getElementById('qzNext');
  if (_qzNextEl) _qzNextEl.addEventListener('click', function() {
    if (_qzIdx < _qzQ.length - 1) {
      _qzNavTo(_qzIdx + 1);
    } else {
      _qzShowRoundComplete();
    }
  });
  window._wireQzGenBtn = function() {
    var genBtn = document.getElementById('qzGenerateBtn');
    if (genBtn && !genBtn._qzWired) {
      genBtn._qzWired = true;
      genBtn.addEventListener('click', function () { window.generateQuiz(); });
    }
  };
  window._wireQzGenBtn();

  // Global Enter key — advances quiz when hint is visible
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      var hint = document.getElementById('qzEnterHint');
      if (hint && hint.style.display !== 'none') {
        var next = document.getElementById('qzNext');
        if (next && !next.disabled) { next.click(); e.preventDefault(); }
      }
    }
  });

  window._qzAppendMore = function(opts) {
    opts = opts || {};
    var btn = opts.btn || document.getElementById('qzMoreBtn');
    var moreStatus = opts.statusEl || document.getElementById('qzMoreStatus');
    var moreRow = document.getElementById('qzMoreRow');
    var packId = window.STUDY_ROOM_CONFIG && window.STUDY_ROOM_CONFIG.packId;
    if (!packId) return Promise.resolve(null);

    var limits = window.USER_LIMITS || {};
    var daily  = window.USER_DAILY  || {};
    var credits = window.USER_CREDITS || 0;
    if (credits <= 0) {
      var qzRemaining = (limits.quiz_per_day || 0) - (daily.quiz || 0);
      if (qzRemaining <= 0) {
        if (moreStatus) moreStatus.textContent = '⚠ Daily limit reached — upgrade for more';
        if (moreRow) moreRow.style.display = 'none';
        return Promise.resolve(null);
      }
    }

    if (btn) { btn.disabled = true; btn.classList.add('sr-more-loading'); }
    if (moreStatus) moreStatus.textContent = '';
    var stopQzMorePhases = window.srStartMorePhases ? window.srStartMorePhases(moreStatus, ['Writing questions…', 'Verifying quality…', 'Almost done…']) : function () {};

    var overlay = window.SrAppendOverlay;
    if (overlay && !overlay.isPending('tab-quiz')) {
      overlay.show('tab-quiz', {
        hint: 'Generating more quiz questions…',
        sub: 'This takes a few seconds — the new questions get added at the end.',
        onCancel: function () {
          if (btn) { btn.disabled = false; btn.classList.remove('sr-more-loading'); }
        },
      });
    }

    var body = { group_index: window.STUDY_ROOM_CONFIG.groupIndex, count: 15 };
    if (window._topicState && window._topicState.selected) body.topic = window._topicState.selected.title;
    if (opts.count) body.count = opts.count;
    if (opts.sectionText) body.section_text = opts.sectionText;

    return fetch('/library/pack/' + packId + '/generate-quiz/more', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'fetch',
        'X-CSRFToken': (document.querySelector('meta[name="csrf-token"]') || {}).content || '',
      },
      body: JSON.stringify(body),
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      stopQzMorePhases();
      if (overlay && !overlay.isPending('tab-quiz')) {
        // Student cancelled — drop the results, keep the button usable.
        if (btn) { btn.disabled = false; btn.classList.remove('sr-more-loading'); }
        return data;
      }
      if (data.credit_balance !== undefined) {
        updateCreditsBar(data.credit_balance);
      }
      if (data.cycle_index != null && window._topicState) {
        window._topicState.cycleIndex = data.cycle_index;
        if (typeof _updateAllTopicLabels === 'function') {
          var labels = document.querySelectorAll('#srTopicLabelBar');
          _updateAllTopicLabels(labels);
        }
      }
      if (!data.ok && data.status !== 'max_reached') {
        if (data.error === 'No content available') {
          if (moreStatus) moreStatus.textContent = 'Asking AI tutor…';
          window._qzAppending = true;
          if (window._chatSendTool) {
            window._chatSendTool('generate_quiz', 'Please generate 5 more multiple-choice questions for this topic.');
            // Keep the overlay up — chat-engine hides it when the questions land.
            if (btn) btn.textContent = '+ more questions';
            return data;
          }
          if (overlay) overlay.hide('tab-quiz');
          if (moreStatus) moreStatus.textContent = '⚠ ' + (data.error || 'Failed');
          if (btn) { btn.disabled = false; btn.classList.remove('sr-more-loading'); }
          return data;
        }
        if (data.quota_exceeded) {
          if (overlay) overlay.hide('tab-quiz');
          if (moreRow) moreRow.style.display = 'none';
          if (moreStatus) moreStatus.textContent = '';
          if (btn) { btn.disabled = false; btn.classList.remove('sr-more-loading'); }
          if (window.maybeShowCreditsExhausted && window.maybeShowCreditsExhausted(data, 'quiz questions')) {
            return data;
          }
          if (typeof window.showQuotaModal === 'function') {
            window.showQuotaModal({
              resource: 'quiz questions',
              used: data.used,
              limit: data.limit,
              resetsInSeconds: data.resets_in_seconds, tier: data.tier,
            });
          } else {
            if (moreStatus) moreStatus.textContent = '⚠ Daily limit reached — upgrade for more';
          }
          return data;
        }
        if (overlay) overlay.hide('tab-quiz');
        if (moreStatus) moreStatus.textContent = '⚠ ' + (data.error || 'Failed');
        if (btn) { btn.disabled = false; btn.classList.remove('sr-more-loading'); }
        return data;
      }
      if (data.status === 'max_reached') {
        if (overlay) overlay.hide('tab-quiz');
        if (moreRow) moreRow.style.display = 'none';
        if (moreStatus) moreStatus.textContent = '';
        if (btn) { btn.disabled = false; btn.classList.remove('sr-more-loading'); }
        return data;
      }
      if (data.status === 'rate_limited') {
        if (overlay) overlay.hide('tab-quiz');
        if (moreStatus) moreStatus.textContent = '⚠ Please wait a moment before generating more.';
        setTimeout(function() { if (moreStatus) moreStatus.textContent = ''; }, 3000);
        if (btn) { btn.disabled = false; btn.classList.remove('sr-more-loading'); }
        return data;
      }
      if (data.status === 'no_new') {
        if (overlay) overlay.hide('tab-quiz');
        if (moreStatus) moreStatus.textContent = '✓ No new questions added — everything here is already in your quiz';
        setTimeout(function() { if (moreStatus) moreStatus.textContent = ''; }, 3000);
        if (btn) { btn.disabled = false; btn.classList.remove('sr-more-loading'); }
        if (data.total >= 30) {
          if (moreRow) moreRow.style.display = 'none';
        }
        return data;
      }
      // Async path: backend queued a fresh generation (no done quiz existed to
      // extend), or an existing generation is already in flight. Poll for it
      // ourselves; onData renders and hides the overlay.
      if (data.ok && (data.status === 'generating' || data.status === 'in_progress')) {
        if (data.resource_id) window._qzResourceId = data.resource_id;
        if (window._qzPoller) { window._qzPoller.cancel(); window._qzPoller = null; }
        window._qzPollStarted = true;
        var _poll = window._pollResource || function() { return { cancel: function() {} }; };
        window._qzPoller = _poll(packId, 'quiz', {
          onData: function(res) {
            var questions = (res.content && (res.content.quiz || res.content.questions)) || [];
            if (!questions.length) return;
            if (overlay) overlay.hide('tab-quiz');
            window._qzData = questions;
            if (res.resource_id) window._qzResourceId = res.resource_id;
            if (typeof window.renderQuiz === 'function') {
              window.renderQuiz(questions);
              if (typeof window._qzEnsureTimer === 'function') window._qzEnsureTimer();
            }
            if (moreStatus) moreStatus.textContent = '✓ ' + questions.length + ' questions ready';
            setTimeout(function() { if (moreStatus) moreStatus.textContent = ''; }, 3000);
            if (btn) { btn.disabled = false; btn.classList.remove('sr-more-loading'); }
          },
          onFail: function() {
            if (overlay) overlay.hide('tab-quiz');
            if (moreStatus) moreStatus.textContent = '⚠ Generation failed';
            if (btn) { btn.disabled = false; btn.classList.remove('sr-more-loading'); }
          },
        });
        return data;
      }
      if (data.ok && data.status === 'existing') {
        if (overlay) overlay.hide('tab-quiz');
        if (btn) { btn.disabled = false; btn.classList.remove('sr-more-loading'); }
        return data;
      }
      var newQuestions = data.new_questions || [];
      // Defense-in-depth: the server already dedups, but drop any question whose
      // text already exists in the live set so a stray duplicate never reaches
      // the student (e.g. from the chat-tool path or a cached poll response).
      var seenTexts = {};
      _qzQ.forEach(function(q) {
        var t = q && q.question;
        if (typeof t === 'string') seenTexts[' ' + t.trim().toLowerCase()] = true;
      });
      newQuestions = newQuestions.filter(function(q) {
        var t = q && (q.question || q.question_text || q.text || '');
        if (typeof t !== 'string') return true;
        var key = ' ' + t.trim().toLowerCase();
        if (seenTexts[key]) return false;
        seenTexts[key] = true;
        return true;
      });
      if (!newQuestions.length) {
        if (overlay) overlay.hide('tab-quiz');
        if (btn) { btn.disabled = false; btn.classList.remove('sr-more-loading'); }
        if (data.max_reached || data.total >= 30) {
          if (moreRow) moreRow.style.display = 'none';
          if (moreStatus) moreStatus.textContent = '';
        } else {
          if (moreStatus) moreStatus.textContent = '⚠ No new questions generated';
        }
        return data;
      }
      if (overlay) overlay.hide('tab-quiz');
      if (window.USER_DAILY) window.USER_DAILY.quiz = (window.USER_DAILY.quiz || 0) + newQuestions.length;
      var previousLen = _qzQ.length;
      newQuestions.forEach(function(q) {
        _qzQ.push(_qzNormalizeQuestion(q));
        if (Array.isArray(window._qzData)) window._qzData.push(q);
      });
      var qzTotal = document.getElementById('qzTotal');
      if (qzTotal) qzTotal.textContent = _qzQ.length;
      if (data.max_reached || data.total >= 30) {
        if (moreRow) moreRow.style.display = 'none';
      } else {
        if (btn) { btn.disabled = false; btn.classList.remove('sr-more-loading'); }
        if (moreStatus) moreStatus.textContent = '✓ ' + newQuestions.length + ' questions added';
        setTimeout(function() { if (moreStatus) moreStatus.textContent = ''; }, 3000);
      }
      _qzNavTo(previousLen);
      _qzEnsureTimer();
      fetch('/library/pack/' + packId + '/save-quiz', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': (document.querySelector('meta[name="csrf-token"]') || {}).content || '',
        },
        body: JSON.stringify({ questions: _qzQ, group_index: window.STUDY_ROOM_CONFIG.groupIndex }),
      }).catch(function() {
        if (typeof window.showFatalErrorModal === 'function') {
          var savedQuizQ = _qzQ.slice();
          window.showFatalErrorModal('Failed to save your quiz. Please try again.', function () {
            var csrfToken = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
            fetch('/library/pack/' + packId + '/save-quiz', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrfToken,
              },
              body: JSON.stringify({ questions: savedQuizQ, group_index: window.STUDY_ROOM_CONFIG.groupIndex }),
            }).catch(function() {});
          });
        }
      });
      return data;
    })
    .catch(function() {
      stopQzMorePhases();
      if (overlay) overlay.hide('tab-quiz');
      if (moreStatus) moreStatus.textContent = '⚠ Network error';
      if (btn) { btn.disabled = false; btn.textContent = '+ more questions'; }
      return null;
    });
  };

  window._qzWireMoreBtn = function() {
    var moreBtn = document.getElementById('qzMoreBtn');
    var moreRow = document.getElementById('qzMoreRow');
    var moreStatus = document.getElementById('qzMoreStatus');
    if (!moreBtn || !moreRow || typeof window.STUDY_ROOM_CONFIG.packId === 'undefined' || moreBtn._qzWired) return;
    moreBtn._qzWired = true;
    moreBtn.addEventListener('click', function() {
      window._qzAppendMore({ btn: moreBtn, statusEl: moreStatus });
    });
  };

  // React to the quiz-timer preference changing in Settings → Preferences
  window.addEventListener('motown:quiz-timer', function(e) {
    var enabled = e && e.detail && e.detail.enabled;
    if (!enabled) {
      _qzStopTimer();
      var timerEl = document.getElementById('qzTimer');
      if (timerEl) timerEl.style.display = 'none';
    } else if (_qzTimerConsented() && _qzQ.length && _qzStageActive()) {
      _qzStartTimer(_qzQ.length);
    }
  });
})();
