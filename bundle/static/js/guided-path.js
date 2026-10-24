/**
 * guided-path.js — Frontend logic for Guided Path v1.
 *
 * Fetches sections, renders sidebar + content, handles checkpoint
 * questions, tracks progress, supports edit mode.
 *
 * Relies on window.__PACK_ID__ and window.__PACK_VERSION__ set in template.
 */
(function () {
  'use strict';

  var packId = window.__PACK_ID__;
  var packVersion = window.__PACK_VERSION__;
  var packTitle = window.__PACK_TITLE__ || '';
  if (!packId || packVersion !== 1) return;

  function _toTitleCase(s) {
    if (!s) return s;
    var up = s.replace(/[^A-Z]/g, '').length;
    var letters = s.replace(/[^A-Za-z]/g, '').length;
    if (letters < 3 || up / letters < 0.7) return s;
    var minor = ['a','an','the','and','but','or','for','nor','in','on','at','to','by','of','with','as'];
    return s.toLowerCase().replace(/\b\w+/g, function(w, i) {
      return i === 0 || minor.indexOf(w) === -1 ? w.charAt(0).toUpperCase() + w.slice(1) : w;
    });
  }

  var sections = [];
  var currentIndex = 0;
  var answeredCheckpoints = {}; // cpId -> { correct, answer }
  var sectionScores = {};      // sectionId -> { score, total }
  var _pollNoChangeCount = 0;
  var _pollTotalCount = 0;
  var _POLL_MAX_TOTAL = 200; // ~10 minutes of polling before giving up (sections can take 30-120s+ each)
  var _sectionRetryCount = 0;
  var _SECTION_RETRY_MAX = 36; // 3 minutes of content polling before giving up
  var _quizState = null;       // { sectionId, mode, checkpoints, currentIndex } — active quiz session (mode: 'section' | 'boss')
  var _quizTimerHandle = null;
  var _quizTimerFallback = null;
  var _quizTimerEnd = 0;
  var _quizTimedOut = false;
  var _loadingSectionId = null;
  var _lastGenData = null;
var _quizGateScroller = null;
  var _quizGateHandler = null;
  var _savedQuiz = null; // in-progress quiz session preserved across tab remounts
  var _finishConfetti = null;

  // ── Init ─────────────────────────────────────────────────────────────

  function init() {
    fetchSections();
  }

  // ── Fetch sections list ──────────────────────────────────────────────

  function fetchSections() {
    fetch('/library/api/pack/' + packId + '/sections')
      .then(function (r) {
        if (r.status === 401) {
          if (typeof openAuthModal === 'function') {
            window._authModalDismissPath = '/';
            openAuthModal('signup');
          }
          return null;
        }
        return r.json();
      })
      .then(function (data) {
        if (!data) return;
        if (!data.ok) return;
        sections = data.sections;
        // The API reports current_index === sections.length when every
        // section is completed (all done). Clamp to the last section so the
        // lookups below (sections[currentIndex]) stay in bounds instead of
        // crashing the whole guide on a TypeError.
        currentIndex = data.current_index || 0;
        if (sections.length > 0 && currentIndex >= sections.length) {
          currentIndex = sections.length - 1;
        }
        _lastGenData = data.generation || null;

        // If generation is still in progress, show the progress UI and poll
        var gen = data.generation;
        if (gen && (gen.status === 'generating' || gen.status === 'pending' || gen.status === 'discovering' || gen.status === 'checkpoints')) {
          var container = document.getElementById('guided-sections-container');
          if (container) {
            _hideReadProgress();
            container.innerHTML = renderProgressUI(
              gen.completed_sections, gen.total_sections, gen.failed_sections, gen.status
            );
          }
          pollForSections();
          return;
        }

        renderLayout();
        if (sections.length > 0) {
          loadSection(sections[currentIndex].id);
        } else {
          showEmpty();
        }
      })
      .catch(function () {
        if (typeof window.showFatalErrorModal === 'function') {
          window.showFatalErrorModal('Failed to load study guide. Please try again.', function () {
            fetchSections();
          });
        } else {
          showError('Failed to load study guide.');
        }
      });
  }

  // ── Render full layout (sidebar + content area) ──────────────────────

  function renderLayout() {
    var container = document.getElementById('guided-sections-container');
    if (!container) return;

    var html = '<div class="guided-layout">';

    // Content area (sidebar hidden via CSS — skip rendering it)
    html += '<div class="guided-content" id="guided-content"></div>';

    html += '</div>'; // layout

    container.innerHTML = html;
  }

  // ── Load section content ─────────────────────────────────────────────

  function _getGuidedScroller(el) {
    var node = el;
    while (node && node !== document.body) {
      if (node.scrollHeight > node.clientHeight + 1) {
        var st = getComputedStyle(node);
        if (/(auto|scroll)/.test(st.overflowY) || /(auto|scroll)/.test(st.overflow)) return node;
      }
      node = node.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  function _resetGuidedScroll() {
    var contentDiv = document.getElementById('guided-content');
    if (!contentDiv) return;
    var scroller = _getGuidedScroller(contentDiv);
    if (!scroller) return;
    scroller.scrollTop = 0;
    // Reset again after layout settles so Chrome scroll-anchoring can't restore
    // the previous reading position once the new section's content renders.
    requestAnimationFrame(function () {
      scroller.scrollTop = 0;
    });
  }

  function _gateQuizButton(quizBtn) {
    quizBtn.disabled = true;
    var scroller = _getGuidedScroller(quizBtn);
    if (_quizGateScroller && _quizGateHandler) {
      _quizGateScroller.removeEventListener('scroll', _quizGateHandler);
    }
    _quizGateScroller = scroller;
    _quizGateHandler = function () {
      if (!quizBtn || !quizBtn.isConnected) return;
      if (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 12) {
        quizBtn.disabled = false;
      }
    };
    scroller.addEventListener('scroll', _quizGateHandler, { passive: true });
    _quizGateHandler();
  }

  // ── Reading progress bar ─────────────────────────────────────────────
  // Sticky strip at the top of the guide tab. Width = how much of the
  // CURRENT section's reading text has been scrolled past — dense, always
  // moving feedback while reading — with a "Section X of N" label carrying
  // the big picture. Reading-only: hidden whenever a quiz is active.

  var _readProgressScroller = null;

  function _onReadProgressScroll() {
    _updateReadProgress();
  }

  function _bindReadProgressScroller(scroller) {
    if (!scroller || _readProgressScroller === scroller) return;
    if (_readProgressScroller) {
      _readProgressScroller.removeEventListener('scroll', _onReadProgressScroll, { passive: true });
    }
    _readProgressScroller = scroller;
    scroller.addEventListener('scroll', _onReadProgressScroll, { passive: true });
  }

  function _computeReadProgress(textEl, scroller) {
    var scrollerRect = scroller.getBoundingClientRect();
    var textRect = textEl.getBoundingClientRect();
    var isRoot = scroller === document.scrollingElement || scroller === document.documentElement;
    var clientHeight = isRoot ? (scroller.clientHeight || window.innerHeight) : scroller.clientHeight;

    // Content-anchored position of the reading text top inside the scroller
    // (invariant to current scroll position).
    var topSpan = (textRect.top - scrollerRect.top) + scroller.scrollTop;

    // Bar hits 100% exactly when the text's bottom edge reaches the bottom
    // of the reading viewport (fully covered).
    var denom = Math.max(1, topSpan + Math.max(1, textRect.height) - clientHeight);
    var pct = Math.round((scroller.scrollTop / denom) * 100);
    return Math.max(0, Math.min(100, pct));
  }

  function _updateReadProgress() {
    var bar = document.getElementById('gp-read-progress');
    if (!bar) return;
    var total = sections.length;
    var contentDiv = document.getElementById('guided-content');
    var textEl = contentDiv ? contentDiv.querySelector('.guided-study-text') : null;
    var idx = Math.max(0, Math.min(currentIndex, total - 1));
    var label = document.getElementById('gp-read-progress-label');
    if (label) {
      label.textContent = total ? (idx + 1) + ' of ' + total : '';
      label.style.display = total ? '' : 'none';
    }

    // No reading text (quiz, menu, loading, error) → hidden
    if (!textEl || !total) {
      _hideReadProgress();
      return;
    }

    var scroller = _getGuidedScroller(textEl) || document.scrollingElement || document.documentElement;
    _bindReadProgressScroller(scroller);

    var fill = document.getElementById('gp-read-progress-fill');
    if (fill) fill.style.width = _computeReadProgress(textEl, scroller) + '%';
    bar.hidden = false;
  }

  function _hideReadProgress() {
    var bar = document.getElementById('gp-read-progress');
    if (bar) bar.hidden = true;
  }

  function loadSection(sectionId) {
    var contentDiv = document.getElementById('guided-content');
    if (!contentDiv) return;

    _destroyFinishConfetti();

    // While load is in flight we're not reading yet — keep the bar hidden
    // until the section content actually renders.
    _hideReadProgress();

    // Only reset counter for a NEW section, not retries
    if (sectionId !== _loadingSectionId) {
      _sectionRetryCount = 0;
      _loadingSectionId = sectionId;
    }

    // Reset quiz session when switching sections
    _quizState = null;

    fetch('/library/api/pack/' + packId + '/section/' + sectionId + '/content')
      .then(function (r) {
        if (r.status === 401) {
          if (typeof openAuthModal === 'function') {
            window._authModalDismissPath = '/';
            openAuthModal('signup');
          }
          return null;
        }
        if (r.status === 202) return r.json().catch(function () { return { ok: false, status: 'pending' }; });
        return r.json();
      })
      .then(function (data) {
        if (!data) return;
        if (!data.ok) {
          if (data.status === 'pending' || data.status === 'generating') {
            _sectionRetryCount++;
            if (_sectionRetryCount > _SECTION_RETRY_MAX) {
              contentDiv.innerHTML = '<div class="guided-error-state">'
                + '<h3>Content seems stuck</h3>'
                + '<p>This section\'s content is taking too long. The generation may have been interrupted.</p>'
                + '<button class="guided-btn guided-btn-outline" id="guided-retry-section-btn" style="margin-top:12px">Retry</button>'
                + '</div>';
              var retryBtn = document.getElementById('guided-retry-section-btn');
              if (retryBtn) {
                retryBtn.addEventListener('click', function () {
                  _sectionRetryCount = 0;
                  regenerateSection(sectionId);
                });
              }
              return;
            }
            // Silently retry — progress ring stays visible in the parent container
            setTimeout(function () { loadSection(sectionId); }, 5000);
          } else if (data.status === 'failed') {
            contentDiv.innerHTML = '<div class="guided-error-state">'
              + '<h3>Generation failed</h3>'
              + '<p>This section could not be generated. You can try regenerating it.</p>'
              + '<button class="guided-btn guided-btn-outline" id="guided-retry-section-btn" style="margin-top:12px">Retry</button>'
              + '</div>';
            var retryBtn = document.getElementById('guided-retry-section-btn');
            if (retryBtn) {
              retryBtn.addEventListener('click', function () {
                regenerateSection(sectionId);
              });
            }
          } else {
            contentDiv.innerHTML = '<div class="guided-error-state"><h3>Unable to load content</h3></div>';
          }
          return;
        }

        var sectionTitle = data.section_title || 'Section';
        var html = '<div class="guided-breadcrumb">'
          + '<button class="guided-breadcrumb-back" type="button">'
          + '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 19-7-7 7-7"></path><path d="M19 12H5"></path></svg>'
          + '<span class="guided-breadcrumb-back-text">' + escapeHtml(packTitle) + '</span>'
          + '</button>'
          + '<span class="guided-breadcrumb-sep">/</span>'
          + '<h2 class="guided-breadcrumb-title">' + escapeHtml(_toTitleCase(sectionTitle)) + '</h2>'
          + '<div class="guided-menu-wrap">'
          + '<button class="guided-menu-btn" type="button" aria-label="Study guide options" aria-expanded="false" aria-haspopup="true">'
          + '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg>'
          + '</button>'
          + '<div class="guided-menu-dropdown" role="menu">'
          + '<button class="guided-menu-item" type="button" role="menuitem" data-action="regen-section">'
          + '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path></svg>'
          + 'Regenerate Section'
          + '</button>'
          + '<button class="guided-menu-item" type="button" role="menuitem" data-action="regen-all">'
          + '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path></svg>'
          + 'Regenerate All'
          + '</button>'
          + '</div>'
          + '</div>'
          + '</div>';
        html += '<div class="guided-study-text">' + data.html + '</div>';
        html += '<div id="guided-checkpoint-area"></div>';
        html += '<div class="guided-actions">';
        html += '<button class="guided-narrate-btn" type="button" data-readto-entry="1" title="Narrate to me" aria-label="Narrate to me">'
          + '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><path d="M12 19v3"/></svg>'
          + '<span>Narrate to me</span>'
          + '</button>';
        html += '<div class="guided-nav">';
        html += '<button class="guided-btn guided-btn-outline" id="guided-btn-prev"' + (currentIndex === 0 ? ' disabled' : '') + '>'
          + '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"></path></svg>'
          + 'Previous</button>';

        var currentSection = sections[currentIndex];
        var isSectionCompleted = currentSection && currentSection.status === 'completed';
        if (data.has_checkpoints) {
          if (isSectionCompleted) {
            var retakeLabel = 'Retake Quiz';
            if (currentSection.total > 0) retakeLabel += ' \u00b7 ' + currentSection.score + '/' + currentSection.total;
            html += '<button class="guided-btn guided-btn-default" id="guided-btn-quiz">' + retakeLabel + '</button>';
            if (currentIndex < sections.length - 1) {
              html += '<button class="guided-btn guided-btn-outline" id="guided-btn-next">Continue'
                + '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>'
                + '</button>';
            } else {
              html += '<button class="guided-btn guided-btn-primary guided-btn-success" id="guided-btn-finish">Finish</button>';
            }
          } else {
            html += '<button class="guided-btn guided-btn-default" id="guided-btn-quiz">Take Section Quiz'
              + '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>'
              + '</button>';
          }
        } else if (currentIndex < sections.length - 1) {
          html += '<button class="guided-btn guided-btn-default" id="guided-btn-next">Next'
            + '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>'
            + '</button>';
        } else {
          html += '<button class="guided-btn guided-btn-primary guided-btn-success" id="guided-btn-finish">Finish</button>';
        }
        html += '</div>';
        html += '</div>';

        contentDiv.innerHTML = html;

        // Reading view → show the sticky reading-progress bar for this section
        _updateReadProgress();

        // Tell the Read-to-Me narrator a new section is on screen so a live
        // narration can restart at the top of it (see readto-fab.js).
        if (window.dispatchEvent) {
          window.dispatchEvent(new CustomEvent('guided:section-shown', { detail: { sectionId: sectionId } }));
        }

        // Every section gets the "more practice" strip (quiz / flashcards / fill-in).
        var moreArea = document.getElementById('guided-checkpoint-area');
        if (moreArea) {
          moreArea.classList.add('active');
          _appendXpromoMoreBanner(moreArea);
        }

        // Render any LaTeX math in the section body
        _typeset(contentDiv);

        // Re-trigger fade-in animation
        contentDiv.classList.remove('guided-content');
        void contentDiv.offsetWidth; // force reflow
        contentDiv.classList.add('guided-content');

        // Bind Previous button
        var btnPrev = document.getElementById('guided-btn-prev');
        if (btnPrev) {
          btnPrev.addEventListener('click', function () {
            goToPrevSection();
          });
        }

        // Bind Next / Continue button
        var btnNext = document.getElementById('guided-btn-next');
        if (btnNext) {
          btnNext.addEventListener('click', function () {
            goToNextSection();
          });
        }

        // Bind Finish button
        var btnFinish = document.getElementById('guided-btn-finish');
        if (btnFinish) {
          btnFinish.addEventListener('click', function () {
            // Terminal Finish for a section WITHOUT checkpoints (most often the
            // last section of the guide) never had a quiz-results path to fire
            // completeSection, so its SectionProgress row was never written and
            // the pack could not reach 100%. Register it now (idempotent on the
            // server; score/total 0 is correct — there was no quiz to score).
            // This button only ever renders for a normal section (the boss/final
            // assessment uses the quiz-results Finish path instead), so no mode
            // guard is needed — _quizState may be null on the reading view.
            if (currentSection && currentSection.status !== 'completed') {
              completeSection(currentSection.id, 0, 0);
            }
            showFinishMessage();
          });
        }

        // Bind Take Section Quiz / Retake Quiz button
        var btnQuiz = document.getElementById('guided-btn-quiz');
        if (btnQuiz) {
          btnQuiz.addEventListener('click', function () {
            startQuiz(sectionId);
          });
          _gateQuizButton(btnQuiz);
        }

        // Bind menu toggle
        var menuBtn = contentDiv.querySelector('.guided-menu-btn');
        var menuDropdown = contentDiv.querySelector('.guided-menu-dropdown');
        if (menuBtn && menuDropdown) {
          menuBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            var isOpen = menuDropdown.classList.contains('open');
            menuDropdown.classList.toggle('open');
            menuBtn.setAttribute('aria-expanded', !isOpen);
          });

          // Close menu on outside click
          document.addEventListener('click', function () {
            menuDropdown.classList.remove('open');
            menuBtn.setAttribute('aria-expanded', 'false');
          });

          // Bind menu items
          var menuItems = menuDropdown.querySelectorAll('.guided-menu-item');
          menuItems.forEach(function (item) {
            item.addEventListener('click', function (e) {
              e.stopPropagation();
              var action = item.getAttribute('data-action');
              menuDropdown.classList.remove('open');
              menuBtn.setAttribute('aria-expanded', 'false');
              if (action === 'regen-section') {
                regenerateSection(sectionId);
              } else if (action === 'regen-all') {
                regenerateAll();
              }
            });
          });
        }

        // Bind breadcrumb back button to open section menu
        var btnBack = contentDiv.querySelector('.guided-breadcrumb-back');
        if (btnBack) {
          btnBack.addEventListener('click', function () {
            renderSectionMenu();
          });
        }

        // Scroll content to top — the real scroller is an ancestor (the
        // .guided-layout), not #guided-content itself.
        _resetGuidedScroll();
      })
      .catch(function () {
        contentDiv.innerHTML = '<div class="guided-error-state"><h3>Connection error</h3><p>Please try again.</p></div>';
      });
  }

  // ── Section quiz (viewport mode) ────────────────────────────────────

  function startQuiz(sectionId) {
    var contentDiv = document.getElementById('guided-content');
    if (!contentDiv) return;

    _hideReadProgress();

    contentDiv.innerHTML = '<div class="guided-quiz-loading"><div class="sr-spinner-mini"></div><p>Loading quiz...</p></div>';
    _resetGuidedScroll();

    fetch('/library/api/pack/' + packId + '/section/' + sectionId + '/checkpoints')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.ok || !data.checkpoints || !data.checkpoints.length) {
          loadSection(sectionId);
          return;
        }

        // Fresh attempt — clear any in-session answers for this section's questions
        data.checkpoints.forEach(function (cp) {
          delete answeredCheckpoints[cp.id];
        });

        // Randomize option order per attempt so positions never repeat
        data.checkpoints.forEach(function (cp) { _shuffleCheckpoint(cp); });

        _quizState = { sectionId: sectionId, mode: 'section', checkpoints: data.checkpoints, currentIndex: 0 };
        renderQuizShell();
        renderQuizQuestion();
      })
      .catch(function () {
        loadSection(sectionId);
      });
  }

  // ── Pack final assessment (boss-quiz mode) ───────────────────────────
  // Assembled server-side from the pack's boss_quiz resource and/or section
  // checkpoints. Graded locally in the browser — the correct answer ships
  // with each question since there's no per-question submit endpoint.

  var _BOSS_OFFSET = 900000000; // synthetic ids for assessment questions — well clear of real checkpoint ids

  function startFinalAssessment() {
    var contentDiv = document.getElementById('guided-content');
    if (!contentDiv) return;

    _hideReadProgress();

    contentDiv.innerHTML = '<div class="guided-quiz-loading"><div class="sr-spinner-mini"></div><p>Loading assessment...</p></div>';

    fetch('/library/api/pack/' + packId + '/final-assessment')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.ok || !data.questions || !data.questions.length) {
          showToast('No final assessment is available for this pack yet.');
          renderSectionMenu();
          return;
        }

        var checkpoints = data.questions.map(function (q, i) {
          return {
            id: _BOSS_OFFSET + i,
            question: q.question,
            options: q.options,
            correct_answer: q.correct_answer,
            explanation: q.explanation
          };
        });

        // Fresh attempt — clear any in-session answers for the assessment questions
        checkpoints.forEach(function (cp) { delete answeredCheckpoints[cp.id]; });

        // Randomize option order per attempt so positions never repeat
        checkpoints.forEach(function (cp) { _shuffleCheckpoint(cp); });

        _quizState = { sectionId: null, mode: 'boss', checkpoints: checkpoints, currentIndex: 0 };
        renderQuizShell();
        renderQuizQuestion();
      })
      .catch(function () {
        showToast('Could not load the final assessment. Please try again.');
        renderSectionMenu();
      });
  }

  function renderQuizShell() {
    var contentDiv = document.getElementById('guided-content');
    if (!contentDiv || !_quizState) return;

    _hideReadProgress();

    var total = _quizState.checkpoints.length;
    // Respect the shared quiz-timer preference (defaults to ON). When the user
    // has turned the countdown off, hide the timer pill and skip auto-submit.
    var timerEnabled = typeof window.motownQuizTimerEnabled === 'function'
      ? window.motownQuizTimerEnabled()
      : true;
    var html = '<div class="guided-quiz">';
    html += '<div class="guided-quiz-header">';
    html += '<div class="guided-quiz-counter">Question</div> <div class="guided-quiz-counter" id="guided-quiz-counter">1 of ' + total + '</div>';
    if (timerEnabled) {
      html += '<div class="guided-quiz-timer" id="guided-quiz-timer" role="timer" aria-label="Quiz time remaining">'
        + '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13" r="8"></circle><path d="M12 9v4l2 2"></path><path d="M5 3 2 6"></path><path d="m22 6-3-3"></path></svg>'
        + '<span id="guided-quiz-timer-text">' + _formatTime(total * 60) + '</span>'
        + '</div>';
    }
    html += '</div>';
    html += '<div class="guided-quiz-body" id="guided-quiz-body"></div>';
    html += '<div class="guided-quiz-footer">';
    html += '<button class="guided-btn guided-btn-outline" id="guided-quiz-back" type="button">'
      + '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 19-7-7 7-7"></path><path d="M19 12H5"></path></svg>'
      + '<span>Back</span>'
      + '</button>';
    html += '<button class="guided-btn guided-btn-default guided-quiz-next-btn" id="guided-quiz-next-btn" type="button" disabled>'
      + '<span class="guided-quiz-next-label">Next Question</span>'
      + '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>'
      + '</button>';
    html += '</div>';
    html += '</div>';

contentDiv.innerHTML = html;
    _resetGuidedScroll();

    if (timerEnabled) {
      _startQuizTimer(total);
    }

    var backBtn = document.getElementById('guided-quiz-back');
    if (backBtn) {
      backBtn.addEventListener('click', function () {
        _stopQuizTimer();
        if (_quizState.mode === 'boss') {
          renderSectionMenu();
        } else {
          loadSection(_quizState.sectionId);
        }
      });
    }

    var nextBtn = document.getElementById('guided-quiz-next-btn');
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        if (!_quizState) return;
        var isLast = _quizState.currentIndex >= _quizState.checkpoints.length - 1;
        if (isLast) {
          showQuizResults(_quizState.sectionId);
        } else {
          _quizState.currentIndex++;
          renderQuizQuestion();
        }
      });
    }
  }

  function _formatTime(totalSec) {
    var m = Math.floor(totalSec / 60);
    var s = totalSec % 60;
    return m + ':' + (s < 10 ? '0' + s : s);
  }

  function _startQuizTimer(totalQuestions, endTime) {
    // Respect the shared quiz-timer preference (defaults to ON)
    if (typeof window.motownQuizTimerEnabled === 'function' && !window.motownQuizTimerEnabled()) {
      return;
    }
    _stopQuizTimer();
    _quizTimedOut = false;

    var durationSec = totalQuestions * 60;
    // When resuming from a saved session, honor the original deadline so the
    // countdown reflects the time that elapsed while the tab was unmounted.
    _quizTimerEnd = (endTime && endTime > 0) ? endTime : Date.now() + durationSec * 1000;

    var timerEl = document.getElementById('guided-quiz-timer');
    var textEl = document.getElementById('guided-quiz-timer-text');
    var remainingNow = Math.max(0, Math.round((_quizTimerEnd - Date.now()) / 1000));
    if (timerEl && textEl) {
      textEl.textContent = _formatTime(remainingNow);
      timerEl.classList.toggle('warning', remainingNow <= 60);
    }

    _quizTimerHandle = setInterval(function () {
      var remaining = Math.max(0, Math.round((_quizTimerEnd - Date.now()) / 1000));
      if (timerEl && textEl) {
        textEl.textContent = _formatTime(remaining);
        timerEl.classList.toggle('warning', remaining <= 60);
      }
      if (remaining <= 0) _autoSubmitQuiz();
    }, 500);

    _quizTimerFallback = setTimeout(function () {
      _autoSubmitQuiz();
    }, Math.max(0, _quizTimerEnd - Date.now()) + 500);
  }

function _stopQuizTimer() {
    if (_quizTimerHandle) { clearInterval(_quizTimerHandle); _quizTimerHandle = null; }
    if (_quizTimerFallback) { clearTimeout(_quizTimerFallback); _quizTimerFallback = null; }
  }

  // ── Quiz session persistence across tab remounts ─────────────────────
  // The study-room tab system unmounts the guided pane (clearing its DOM)
  // when the user switches tabs and re-inits it on return. Without a snapshot
  // the in-progress section quiz — and its countdown — is lost. We save the
  // session (state + answers + timer deadline) on unmount and restore it on
  // remount so the countdown resumes from where it left off.

  function _saveQuizSession() {
    if (!_quizState) { _savedQuiz = null; return; }
    _savedQuiz = {
      sectionId: _quizState.sectionId,
      mode: _quizState.mode || 'section',
      currentIndex: _quizState.currentIndex,
      checkpoints: _quizState.checkpoints,
      answered: Object.assign({}, answeredCheckpoints),
      timerEnd: _quizTimerEnd || 0,
      timedOut: _quizTimedOut
    };
    _stopQuizTimer();
  }

  function _restoreQuizSession() {
    var saved = _savedQuiz;
    _savedQuiz = null;
    if (!saved) { fetchSections(); return; }

    var timerEnabled = typeof window.motownQuizTimerEnabled === 'function'
      ? window.motownQuizTimerEnabled()
      : true;

    renderLayout();
    _quizState = {
      sectionId: saved.sectionId,
      mode: saved.mode || 'section',
      checkpoints: saved.checkpoints,
      currentIndex: saved.currentIndex || 0
    };
    answeredCheckpoints = saved.answered || {};
    _quizTimedOut = saved.timedOut || false;

    renderQuizShell();
    renderQuizQuestion();

    // Resume the countdown from the saved deadline (renderQuizShell already
    // started a fresh full-duration timer — override it with the saved one).
    if (timerEnabled && saved.timerEnd > 0) {
      _startQuizTimer(_quizState.checkpoints.length, saved.timerEnd);
    }
  }

  function _autoSubmitQuiz() {
    if (!_quizState || _quizTimedOut) return;
    _quizTimedOut = true;
    _stopQuizTimer();
    showQuizResults(_quizState.sectionId, true);
  }

  function renderQuizQuestion() {
    if (!_quizState) return;
    var body = document.getElementById('guided-quiz-body');
    if (!body) return;

    var cps = _quizState.checkpoints;
    var i = _quizState.currentIndex;
    var cp = cps[i];
    var total = cps.length;
    var opts = cp.options || [];

    var counter = document.getElementById('guided-quiz-counter');
    if (counter) counter.textContent = (i + 1) + ' of ' + total;

    var nextBtn = document.getElementById('guided-quiz-next-btn');
    if (nextBtn) {
      nextBtn.disabled = true;
      var nextLabel = nextBtn.querySelector('.guided-quiz-next-label');
      if (nextLabel) nextLabel.textContent = (i >= total - 1) ? 'See Results' : 'Next Question';
    }

    var html = '<div class="guided-quiz-card" id="cp-' + cp.id + '">';
    html += '<p class="guided-cp-question"><strong>' + (i + 1) + '.</strong> ' + _safeHtml(cp.question) + '</p>';
    html += '<div class="guided-cp-options">';

    opts.forEach(function (opt) {
      var letter = opt.letter || opt.charAt(0);
      var text = opt.text || opt.substring(2);
      html += '<button class="guided-cp-option" data-cp="' + cp.id + '" data-answer="' + letter + '">';
      html += '<span class="guided-cp-letter">' + letter + '</span> ' + _safeHtml(text);
      html += '</button>';
    });

    html += '</div>';
    html += '<div class="guided-cp-feedback" id="feedback-' + cp.id + '"></div>';
    html += '</div>';

    body.innerHTML = html;
    _typeset(body);

    body.querySelectorAll('.guided-cp-option').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var cpId = parseInt(btn.getAttribute('data-cp'), 10);
        var answer = btn.getAttribute('data-answer');
        submitAnswer(cpId, answer);
      });
    });
  }

  function _applyAnswerFeedback(cpId, answer, result) {
    answeredCheckpoints[cpId] = { correct: !!result.correct, answer: answer };

    // Update option styles
    var btns = document.querySelectorAll('[data-cp="' + cpId + '"]');
    btns.forEach(function (b) {
      b.disabled = true;
      b.classList.add('answered');
      var bAnswer = b.getAttribute('data-answer');
      if (bAnswer === result.correct_answer) {
        b.classList.add('selected-correct');
      } else if (bAnswer === answer && !result.correct) {
        b.classList.add('selected-wrong');
      }
    });

    // Show feedback
    var feedback = document.getElementById('feedback-' + cpId);
    var cls = result.correct ? 'guided-cp-correct' : 'guided-cp-wrong';
    var msg = result.correct ? '&#10003; Correct!' : '&#10007; Incorrect — the answer is <strong>' + result.correct_answer + '</strong>';
    feedback.innerHTML = '<span class="' + cls + '">' + msg + '</span>'
      + (result.explanation ? '<p class="guided-cp-explain">' + _safeHtml(_resolveOptionRefs(result.explanation, result.correct_answer)) + '</p>' : '');
    _typeset(feedback);

    // Enable the footer's Next / See Results button
    var nextBtn = document.getElementById('guided-quiz-next-btn');
    if (nextBtn && _quizState) {
      var isLast = _quizState.currentIndex >= _quizState.checkpoints.length - 1;
      var nextLabel = nextBtn.querySelector('.guided-quiz-next-label');
      if (nextLabel) nextLabel.textContent = isLast ? 'See Results' : 'Next Question';
      nextBtn.disabled = false;
    }
  }

  // Randomize a checkpoint's option order (Fisher-Yates) in place and re-point
  // `correct_answer` to the letter that now holds the right answer. Mirrors the
  // study-room quiz tab so positions never repeat across attempts. Handles both
  // server option shapes: {letter, text} objects and plain strings ("A. text").
  // If the correct answer can't be located, the checkpoint is left untouched.
  function _shuffleCheckpoint(cp) {
    var opts = cp.options || [];
    if (!opts.length) return cp;

    var letters = ['A','B','C','D','E','F','G','H','I','J','K','L','M',
                   'N','O','P','Q','R','S','T','U','V','W','X','Y','Z'];
    var ans = (cp.correct_answer || '').toString().trim().toUpperCase();

    var parsed = [];
    var correctOldIdx = -1;
    opts.forEach(function (opt) {
      var letter, text;
      if (opt && typeof opt === 'object') {
        letter = String(opt.letter || '').trim().toUpperCase();
        text = opt.text || opt.label || '';
      } else {
        text = String(opt == null ? '' : opt).trim();
        letter = text ? String(text.charAt(0)).toUpperCase() : '';
      }
      var idx = parsed.length;
      if (letter && letter === ans) correctOldIdx = idx;
      parsed.push({ letter: letter, text: text });
    });

    // Fallback: the answer might be a 1-based option number.
    if (correctOldIdx === -1 && /^[0-9]+$/.test(ans)) {
      var n = parseInt(ans, 10);
      if (n >= 1 && n <= parsed.length) correctOldIdx = n - 1;
    }
    if (correctOldIdx === -1) return cp;

    var correctOpt = parsed[correctOldIdx];

    for (var i = parsed.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = parsed[i]; parsed[i] = parsed[j]; parsed[j] = tmp;
    }

    var newOptions = [];
    parsed.forEach(function (p, idx) {
      var letter = letters[idx] || String(idx + 1);
      if (p === correctOpt) cp.correct_answer = letter;
      newOptions.push({ letter: letter, text: p.text });
    });
    cp.options = newOptions;
    return cp;
  }

  // Substitute the {CORRECT} placeholder (which AI prompts may use) with the
  // letter actually shown to the student for the correct answer.
  function _resolveOptionRefs(text, letter) {
    if (!text || !letter) return text || '';
    return String(text).replace(/\{\s*CORRECT\s*\}/gi, String(letter).toUpperCase());
  }

  function submitAnswer(cpId, answer) {
    // Prevent double-submit
    if (answeredCheckpoints[cpId]) return;

    // Graded locally in the browser for both section quizzes and the final
    // assessment — the correct answer ships with each checkpoint. Instant
    // feedback mirrors the study-room quiz tab instead of waiting on a
    // submit round-trip.
    if (!_quizState) return;
    var cp = null;
    _quizState.checkpoints.forEach(function (c) { if (c.id === cpId) cp = c; });
    if (!cp) return;
    _applyAnswerFeedback(cpId, answer, {
      correct: cp.correct_answer === answer,
      correct_answer: cp.correct_answer,
      explanation: cp.explanation
    });
  }

  // ── Quiz results ─────────────────────────────────────────────────────

  function showQuizResults(sectionId, timedOut) {
    if (!_quizState) return;
    _stopQuizTimer();
    _hideReadProgress();
    var contentDiv = document.getElementById('guided-content');
    if (!contentDiv) return;

    var boss = _quizState.mode === 'boss';
    var cps = _quizState.checkpoints;
    var total = cps.length;
    var correctCount = 0;
    cps.forEach(function (cp) {
      if (answeredCheckpoints[cp.id] && answeredCheckpoints[cp.id].correct) correctCount++;
    });

    // Persist section completion (idempotent on retake) — the pack-wide final
    // assessment has no section to mark complete.
    if (!boss) completeSection(sectionId, correctCount, total);

    var isLastSection = !boss && currentIndex >= sections.length - 1;
    var content = '<div class="guided-quiz-results">';
    content += '<div class="guided-quiz-results-icon">' + _renderProgressCircle(total ? Math.round((correctCount / total) * 100) : 0) + '</div>';
    content += '<h3 class="guided-quiz-results-title">' + (timedOut ? 'Time\u2019s Up' : (boss ? 'Assessment Complete' : 'Section Complete')) + '</h3>';
    content += '<div class="guided-quiz-results-score">' + correctCount + ' / ' + total + ' correct</div>';
    content += '<p class="guided-quiz-results-msg">' + (timedOut
      ? 'Time\u2019s up \u2014 review the explanations to strengthen your understanding.'
      : (correctCount === total ? 'Perfect score!' : 'Review the explanations to strengthen your understanding.')) + '</p>';
    content += '<div class="guided-quiz-results-actions">';
    content += '<button class="guided-btn guided-btn-outline" id="guided-quiz-results-retake" type="button">' + (boss ? 'Retake Assessment' : 'Retake Quiz') + '</button>';
    if (boss) {
      content += '<button class="guided-btn guided-btn-primary guided-btn-success" id="guided-quiz-results-finish" type="button">Finish</button>';
    } else if (isLastSection) {
      content += '<button class="guided-btn guided-btn-primary guided-btn-success" id="guided-quiz-results-finish" type="button">Finish</button>';
    } else {
      content += '<button class="guided-btn guided-btn-default" id="guided-quiz-results-next" type="button">Continue</button>';
    }
    content += '</div>';
    content += '<button class="guided-quiz-back-link" id="guided-quiz-results-back" type="button">' + (boss ? 'Back to sections' : 'Back to section') + '</button>';
    content += '</div>';

    contentDiv.innerHTML = content;
    _resetGuidedScroll();

    var retakeBtn = document.getElementById('guided-quiz-results-retake');
    if (retakeBtn) {
      retakeBtn.addEventListener('click', function () {
        _quizState.checkpoints.forEach(function (cp) {
          delete answeredCheckpoints[cp.id];
        });
        _quizState.currentIndex = 0;
        renderQuizShell();
        renderQuizQuestion();
      });
    }
    var backBtn = document.getElementById('guided-quiz-results-back');
    if (backBtn) {
      backBtn.addEventListener('click', function () {
        if (boss) {
          renderSectionMenu();
        } else {
          loadSection(sectionId);
        }
      });
    }
    var nextBtn = document.getElementById('guided-quiz-results-next');
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        goToNextSection();
      });
    }
    var finishBtn = document.getElementById('guided-quiz-results-finish');
    if (finishBtn) {
      finishBtn.addEventListener('click', function () {
        showFinishMessage();
      });
    }
  }

  // ── Mark section complete ────────────────────────────────────────────

  function completeSection(sectionId, score, total) {
    var csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
    fetch('/library/api/pack/' + packId + '/section/' + sectionId + '/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
      body: JSON.stringify({ score: score, total: total })
    })
    .then(function (r) { return r.json(); })
    .then(function () {
      // Update local state
      var section = sections.find(function (s) { return s.id === sectionId; });
      if (section) {
        section.status = 'completed';
        section.score = score;
        section.total = total;
      }
      sectionScores[sectionId] = { score: score, total: total };
    });
  }

  // ── Cross-promotion links ──────────────────────────────────────────

  var _xpromoTabMap = { flashcards: 'tab-flashcards', quiz: 'tab-quiz', 'fill-in': 'tab-more', 'ai-tutor': 'tab-voice' };

  function _handleXpromoClick(type) {
    var sectionTitle = sections[currentIndex] ? sections[currentIndex].title : '';
    if (!sectionTitle) return;

    // Scope generation to this section's topic
    window._topicState = window._topicState || {};
    var sectionText = (sections[currentIndex] && sections[currentIndex].source_text) || '';
    window._topicState.selected = { title: sectionTitle, section_text: sectionText };

    var tabId = _xpromoTabMap[type];
    if (!tabId) return;

    var genCap = (window.USER_LIMITS && window.USER_LIMITS.study_gen_cap) || 15;
    var label = type === 'fill-in' ? 'fill-in questions' : type;
    showToast('Generating ' + label + ' for "' + sectionTitle + '"…');

    // Switch tab — find the tab button for aria/click state
    var tabBtn = document.querySelector('.room-tab-btn[data-target="' + tabId + '"]');
    if (typeof window.switchRoomTab === 'function') {
      window.switchRoomTab(tabBtn || null, tabId);
    }

    // Cancel any init pollers started by initQuizTab / initFillInTab during switchRoomTab.
    // Otherwise their first onEmpty tick races with the generate fetch and re-shows the empty state.
    if (window._qzPoller) { window._qzPoller.cancel(); window._qzPoller = null; }
    if (window._fiPoller) { window._fiPoller.cancel(); window._fiPoller = null; }

    // Trigger generation immediately — the append helpers show the blocking
    // overlay, scope generation to this section, and fall back to a fresh
    // generation when the target tab has nothing to extend yet.
    if (type === 'flashcards') {
      if (typeof window._fcAppendMore === 'function') {
        window._fcAppendMore({ sectionText: sectionText, count: genCap });
      } else {
        var _genSectionFlashcards = function () {
          var csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
          fetch('/library/pack/' + packId + '/generate-flashcards', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
            body: JSON.stringify({ group_index: 0, force: true, topic: sectionTitle, card_count: genCap, section_text: sectionText })
          })
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (data && data.quota_exceeded) {
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
              }
            }
          })
          .catch(function () {
            if (typeof window.showFatalErrorModal === 'function') {
              window.showFatalErrorModal('Failed to generate section flashcards. Please try again.', _genSectionFlashcards);
            }
          });
        };
        _genSectionFlashcards();
      }
    } else if (type === 'quiz') {
      if (typeof window._qzAppendMore === 'function') {
        window._qzAppendMore({ sectionText: sectionText, count: genCap });
      } else if (typeof window.generateQuiz === 'function') {
        window.generateQuiz(genCap);
      }
    } else if (type === 'fill-in') {
      if (typeof window._fiAppendMore === 'function') {
        window._fiAppendMore({ sectionText: sectionText, count: genCap });
      } else if (typeof window.generateFillIn === 'function') {
        window.generateFillIn(genCap);
      }
    } else if (type === 'ai-tutor') {
      if (window.switchRoomTab) {
        var btn = document.querySelector('.room-tab-btn[data-target="tab-voice"]');
        if (btn) window.switchRoomTab(btn, 'tab-voice');
      }
    }
  }

  function _appendXpromoMoreBanner(area) {
    var banner = document.createElement('div');
    banner.className = 'gp-xpromo-more';
    banner.innerHTML = '<div class="gp-xpromo-more__title">Want more practice?</div>'
      + _xpromoCard('quiz',
          '<svg class="gp-xpromo-more__icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>',
          'More quiz questions', 'Test yourself on this section')
      + _xpromoCard('flashcards',
          '<svg class="gp-xpromo-more__icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.604 7.197l7.138-3.109a0.96.96 0 0 1 1.27.527l4.924 11.902a1.004 1.004 0 0 1-.514 1.304l-7.137 3.109a0.96.96 0 0 1-1.271-.527l-4.924-11.903a1.005 1.005 0 0 1 .514-1.304z"></path><path d="M15 4h1a1 1 0 0 1 1 1v3.5"></path><path d="M20 6c.264.112.52.217.768.315a1 1 0 0 1 .53 1.311l-2.298 5.374"></path></svg>',
          'Flashcards on this', 'Flip through the key ideas')
      + _xpromoCard('fill-in',
          '<svg class="gp-xpromo-more__icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>',
          'Fill-in-the-blank', 'Fill in terms from memory');
    banner.querySelectorAll('.gp-xpromo-more__link').forEach(function (btn) {
      btn.addEventListener('click', function () {
        _handleXpromoClick(btn.getAttribute('data-type'));
      });
    });
    area.appendChild(banner);
  }

  function _xpromoCard(type, icon, label, desc) {
    var cls = type === 'fill-in' ? 'fill' : type;
    return '<button class="gp-xpromo-more__link gp-xpromo-more__link--' + cls + '" data-type="' + type + '" type="button">'
      + icon
      + '<span class="gp-xpromo-more__text">'
      + '<span class="gp-xpromo-more__label">' + label + '</span>'
      + '<span class="gp-xpromo-more__desc">' + desc + '</span>'
      + '</span>'
      + '</button>';
  }

  // ── Navigation ───────────────────────────────────────────────────────

  function goToNextSection() {
    if (currentIndex >= sections.length - 1) return;

    // Mark current section complete if it has no checkpoints and wasn't completed yet
    var currentSection = sections[currentIndex];

    if (currentSection && currentSection.status !== 'completed' && currentSection.checkpoint_count === 0) {
      completeSection(currentSection.id, 0, 0);
    }

    currentIndex++;
    loadSection(sections[currentIndex].id);
  }

  function goToPrevSection() {
    if (currentIndex > 0) {
      currentIndex--;
      loadSection(sections[currentIndex].id);
    }
  }

  // ── Section Menu ─────────────────────────────────────────────────────

  function _renderProgressCircle(percent) {
    var circumference = 2 * Math.PI * 16.5;
    var offset = circumference - (percent / 100) * circumference;
    var color = percent === 100 ? '#22C55E' : 'var(--primary)';

    return '<div class="guided-progress-ring">'
      + '<svg viewBox="0 0 36 36">'
      + '<circle cx="18" cy="18" r="16.5" fill="none" stroke-width="3" class="guided-progress-ring-bg"></circle>'
      + '<circle cx="18" cy="18" r="16.5" fill="none" stroke="' + color + '" stroke-width="3" stroke-dasharray="' + circumference + '" stroke-dashoffset="' + offset + '" stroke-linecap="round" class="guided-progress-ring-fill"></circle>'
      + '</svg>'
      + '<div class="guided-progress-ring-label"><span>' + percent + '%</span></div>'
      + '</div>';
  }

  function renderSectionMenu() {
    var contentDiv = document.getElementById('guided-content');
    if (!contentDiv) return;

    _hideReadProgress();
    _destroyFinishConfetti();

    var html = '<div class="guided-section-menu">';
    html += '<div class="guided-section-menu-header"><span class="guided-section-menu-title">Outline</span></div>';
    html += '<div class="guided-section-list">';

    sections.forEach(function (s, i) {
      var progress = sectionScores[s.id] || {};
      var score = progress.score || s.score || 0;
      var total = progress.total || s.total || s.checkpoint_count || 0;
      var percent = total > 0 ? Math.round((score / total) * 100) : 0;
      var isCurrent = i === currentIndex;
      var isCompleted = s.status === 'completed';

      html += '<div class="guided-section-card' + (isCurrent ? ' current' : '') + (isCompleted ? ' completed' : '') + '" data-index="' + i + '">';
      html += '<div class="guided-section-info">';
      html += '<h3 class="guided-section-title">' + escapeHtml(_toTitleCase(s.title)) + '</h3>';
      html += '<p class="guided-section-subtitle">' + total + ' checkpoints · ' + (isCompleted ? 'Completed' : isCurrent ? 'In Progress' : 'Not Started') + '</p>';
      html += '</div>';
      html += _renderProgressCircle(isCompleted && total === 0 ? 100 : percent);
      html += '</div>';
    });

    html += '</div>';

    // Add section button
    html += '<button class="guided-add-section-btn" id="guided-add-section-btn" type="button">';
    html += '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
    html += '</button>';

    html += '</div>';
    contentDiv.innerHTML = html;
    _resetGuidedScroll();

    // Bind click handlers for section cards
    contentDiv.querySelectorAll('.guided-section-card').forEach(function (card) {
      card.addEventListener('click', function () {
        var idx = parseInt(this.dataset.index, 10);
        navigateToSection(idx);
      });
    });

    // Bind add section button to open modal
    var addBtn = document.getElementById('guided-add-section-btn');
    if (addBtn) {
      addBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        openAddSectionModal();
      });
    }
  }

  function openAddSectionModal() {
    var existing = document.getElementById('guided-add-section-modal');
    if (existing) existing.remove();

    var modal = document.createElement('div');
    modal.id = 'guided-add-section-modal';
    modal.className = 'guided-modal-overlay';
    modal.innerHTML = '<div class="guided-modal">'
      + '<div class="guided-modal-header">'
      + '<h3 class="guided-modal-title">Add Section</h3>'
      + '<button class="guided-modal-close" id="guided-modal-close" type="button">&times;</button>'
      + '</div>'
      + '<div class="guided-modal-body" id="guided-modal-body">'
      + '<div class="guided-topic-loading">Loading topics...</div>'
      + '</div>'
      + '</div>';

    document.body.appendChild(modal);

    // Close handlers
    document.getElementById('guided-modal-close').addEventListener('click', function () {
      modal.remove();
    });
    modal.addEventListener('click', function (e) {
      if (e.target === modal) modal.remove();
    });

    fetchTocTopics();
  }

  function fetchTocTopics() {
    var body = document.getElementById('guided-modal-body');
    if (!body) return;

    fetch('/library/api/pack/' + packId + '/toc-topics')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.ok || !data.topics || data.topics.length === 0) {
          body.innerHTML = '<div class="guided-topic-empty">No additional topics found</div>';
          return;
        }

        var html = '<div class="guided-modal-topic-list">';
        data.topics.forEach(function (topic) {
          html += '<button class="guided-modal-topic-item" type="button" data-title="' + escapeHtml(topic.title) + '">';
          html += '<span>' + escapeHtml(topic.title) + '</span>';
          html += '</button>';
        });
        html += '</div>';
        body.innerHTML = html;

        // Bind topic item clicks
        body.querySelectorAll('.guided-modal-topic-item').forEach(function (item) {
          item.addEventListener('click', function (e) {
            e.stopPropagation();
            var title = this.getAttribute('data-title');
            var modal = document.getElementById('guided-add-section-modal');
            if (modal) modal.remove();
            addSectionFromTopic(title);
          });
        });
      })
      .catch(function () {
        body.innerHTML = '<div class="guided-topic-empty">Failed to load topics</div>';
      });
  }

  function addSectionFromTopic(title) {
    var csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';

    // Show loading state
    var contentDiv = document.getElementById('guided-content');
    if (contentDiv) {
      contentDiv.innerHTML = '<div class="guided-loading"><div class="sr-spinner-mini"></div><p>Adding section: ' + escapeHtml(title) + '...</p></div>';
    }

    fetch('/library/api/pack/' + packId + '/add-section', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
      body: JSON.stringify({ title: title })
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.ok) {
        // Reset poll counters so stale state from prior generation doesn't cause bailout
        _pollNoChangeCount = 0;
        _pollTotalCount = 0;
        // Reload sections and show the new one
        fetchSections();
      } else {
        showError(data.error || 'Failed to add section');
      }
    })
    .catch(function () {
      showError('Connection error — please try again.');
    });
  }

  function navigateToSection(index) {
    if (index >= 0 && index < sections.length) {
      currentIndex = index;
      loadSection(sections[currentIndex].id);
    }
  }

  function _destroyFinishConfetti() {
    if (_finishConfetti) {
      try { _finishConfetti.destroy(); } catch (e) {}
      _finishConfetti = null;
    }
  }

  function _startFinishConfetti() {
    var container = document.getElementById('guided-complete-confetti');
    if (!container) {
      console.warn('[guided-path] confetti: container #guided-complete-confetti not found');
      return;
    }
    if (typeof window.lottie === 'undefined') {
      console.warn('[guided-path] confetti: window.lottie is undefined');
      return;
    }
    console.log('[guided-path] confetti: starting animation', { container: !!container, lottie: !!window.lottie });
    _destroyFinishConfetti();
    try {
      _finishConfetti = window.lottie.loadAnimation({
        container: container,
        renderer: 'svg',
        loop: false,
        autoplay: true,
        rendererSettings: { preserveAspectRatio: 'xMidYMid slice' },
        path: '/static/lottie/confetti.json',
      });
      if (_finishConfetti) {
        _finishConfetti.addEventListener('DOMLoaded', function () {
          console.log('[guided-path] confetti: DOMLoaded - animation ready');
        });
        _finishConfetti.addEventListener('error', function (err) {
          console.error('[guided-path] confetti: load error', err);
        });
      }
    } catch (e) {
      console.error('[guided-path] confetti: exception', e);
      _finishConfetti = null;
    }
  }

  function showFinishMessage() {
    var contentDiv = document.getElementById('guided-content');
    if (!contentDiv) return;

    _hideReadProgress();

    var completedCount = sections.filter(function (s) { return s.status === 'completed'; }).length;
    var totalScore = 0;
    var totalQ = 0;
    sections.forEach(function (s) {
      if (sectionScores[s.id]) {
        totalScore += sectionScores[s.id].score;
        totalQ += sectionScores[s.id].total;
      }
    });

    var percent = totalQ > 0 ? Math.round((totalScore / totalQ) * 100) : (completedCount === sections.length ? 100 : 0);

    var hasQuiz = !!window.QZ_RESOURCE_ID;
    var nextActionHtml;
    if (hasQuiz) {
      nextActionHtml = '<button class="guided-btn guided-btn-default" id="guided-btn-next-action">Take the Quiz</button>';
    } else {
      nextActionHtml = '';
    }

    var actionSuggestion = hasQuiz
      ? 'You finished the whole guide — now test yourself with a quiz to lock it in.'
      : 'You finished the whole guide — your packed sections are ready. Head to the tab bar to keep going, or review any section again.';

    contentDiv.innerHTML = '<div class="guided-complete-screen">'
      + '<div class="guided-complete-confetti" id="guided-complete-confetti" aria-hidden="true"></div>'
      + '<div class="guided-complete-icon">' + _renderProgressCircle(percent) + '</div>'
      + '<h3 class="guided-complete-title">Study Guide Complete!</h3>'
      + '<p class="guided-complete-stats">' + completedCount + '/' + sections.length + ' sections · Score: ' + totalScore + '/' + totalQ + '</p>'
      + '<p class="guided-complete-msg">' + actionSuggestion + '</p>'
      + '<div class="guided-complete-actions">'
      + nextActionHtml
      + '<button class="guided-btn guided-btn-outline" id="guided-btn-menu">Back to Menu</button>'
      + '<button class="guided-btn guided-btn-outline" id="guided-btn-restart">Start Over</button>'
      + '</div>'
      + '</div>';

    // Bind buttons
    document.getElementById('guided-btn-menu').addEventListener('click', function () {
      _destroyFinishConfetti();
      renderSectionMenu();
    });
    document.getElementById('guided-btn-restart').addEventListener('click', function () {
      _destroyFinishConfetti();
      currentIndex = 0;
      loadSection(sections[0].id);
    });
    var nextActionBtn = document.getElementById('guided-btn-next-action');
    if (nextActionBtn) {
      nextActionBtn.addEventListener('click', function () {
        _destroyFinishConfetti();
        var quizTabBtn = document.querySelector('.room-tab-btn[data-target="tab-quiz"]');
        if (quizTabBtn) {
          window.switchRoomTab(quizTabBtn, 'tab-quiz');
        }
      });
    }

    _startFinishConfetti();
  }

  // ── Regeneration ────────────────────────────────────────────────────

  function _showRegenSpinner(msg) {
    var contentDiv = document.getElementById('guided-content');
    if (!contentDiv) return;
    _hideReadProgress();
    _destroyFinishConfetti();
    contentDiv.innerHTML = '<div class="guided-loading">'
      + '<div class="sr-spinner-mini"></div>'
      + '<p>' + escapeHtml(msg) + '</p>'
      + '</div>';
  }

  function regenerateSection(sectionId) {
    _showRegenSpinner('Regenerating section...');
    var csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
    fetch('/library/api/pack/' + packId + '/section/' + sectionId + '/regenerate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf }
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.ok) {
        loadSection(sectionId);
      } else {
        showError(data.error || 'Regeneration failed');
      }
    })
    .catch(function () {
      showError('Connection error — please try again.');
    });
  }

  function regenerateAll() {
    _showRegenSpinner('Regenerating all sections...');
    var csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
    fetch('/library/api/pack/' + packId + '/sections/regenerate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf }
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.ok) {
        if (data.regenerating) {
          _showRegenSpinner(data.rebuild
            ? 'Discarding old sections and rebuilding the study guide...'
            : 'Regenerating all sections...');
          // Background thread running — poll for completion
          _pollRegeneration();
        } else {
          if (typeof showToast === 'function') showToast(data.message || 'Nothing to regenerate.', 'info');
          loadSection(sections[currentIndex].id);
        }
      } else {
        showError(data.error || 'Regeneration failed');
      }
    })
    .catch(function () {
      showError('Connection error — please try again.');
    });
  }

  function _pollRegeneration() {
    // Reuse pollForSections which already handles all completion states
    // and renders the layout + loads the first section when done.
    _pollTotalCount = 0;
    _pollNoChangeCount = 0;
    pollForSections();
  }

  // ── Empty / error states ─────────────────────────────────────────────

  function showEmpty() {
    var container = document.getElementById('guided-sections-container');
    if (!container) return;

    _hideReadProgress();

    container.innerHTML = '<div class="guided-empty-state">'
      + '<div class="guided-empty-icon">'
      + '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">'
      + '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path>'
      + '<path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>'
      + '</svg>'
      + '</div>'
      + '<h3>No study guide yet</h3>'
      + '<p>Generate a structured study guide with sections, key concepts, and practice questions.</p>'
      + '<button class="guided-empty-btn guided-empty-btn--primary" id="guidedGenerateBtn">'
      + _getGenerateBtnLabel()
      + '</button>'
      + '</div>';

    var btn = document.getElementById('guidedGenerateBtn');
    if (btn) {
      btn.addEventListener('click', function () {
        triggerGeneration(container, btn);
      });
      // Auto-start generation the first time an empty guide tab opens while
      // the student is eligible (credits or remaining weekly pack gens) and
      // no job is already running (re-fire guard) — mirrors the flashcards,
      // quiz, and fill-in tabs' credits-first auto-start.
      if (!window.__srAutoGenGuided && _guidedAutoStartEligible()) {
        window.__srAutoGenGuided = true;
        triggerGeneration(container, btn);
      }
    }
  }

  function _guidedAutoStartEligible() {
    if ((window.USER_CREDITS || 0) > 0) return true;
    var remaining = _lastGenData && _lastGenData.remaining_pack_gens;
    return remaining !== undefined && remaining !== null && remaining > 0;
  }

  function _getGenerateBtnLabel() {
    var remaining = _lastGenData && _lastGenData.remaining_pack_gens;
    if (remaining !== undefined && remaining !== null && remaining < 999) {
      return 'Generate Study Guide (' + remaining + ' left this week)';
    }
    return 'Generate Study Guide';
  }

  function triggerGeneration(container, btn) {
    btn.disabled = true;
    btn.textContent = 'Generating\u2026';
    _pollNoChangeCount = 0;
    _pollTotalCount = 0;

    container.innerHTML = renderProgressUI(0, 0, 0, 'discovering');

    fetch('/library/api/pack/' + packId + '/sections/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': (document.querySelector('meta[name="csrf-token"]') || {}).content || '',
      },
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.ok) {
          showError(data.error || 'Failed to start generation.');
          return;
        }
        if (data.status === 'already_exists') {
          sections = data.sections;
          currentIndex = data.current_index || 0;
          renderLayout();
          if (sections.length > 0) loadSection(sections[currentIndex].id);
          return;
        }
        if (data.regenerating) {
          // Background thread running — poll for completion
          _pollRegeneration();
          return;
        }
        // Poll for completion
        pollForSections();
      })
      .catch(function () {
        showError('Failed to start generation.');
      });
  }

  function renderProgressUI(completed, total, failed, status) {
    var circumference = 264;
    var pct;
    var offset;
    var ringLabel = 'Processing\u2026';
    var ringClass = '';

    if (status === 'discovering') {
      // Discovery phase: ring sits at 0%, spinning animation
      pct = 0;
      offset = circumference;
      ringLabel = 'Discovering\u2026';
      ringClass = 'gp-gen-ring__fill--spinning';
    } else if (status === 'failed') {
      pct = 0;
      offset = circumference;
      ringLabel = 'Failed';
    } else if (status === 'done') {
      pct = 100;
      offset = 0;
      ringLabel = 'Complete';
    } else if (status === 'checkpoints') {
      // Checkpoint phase: all section content is done; hold just short of
      // complete while practice questions generate.
      pct = 93;
      offset = circumference * (1 - pct / 100);
      ringLabel = 'Adding questions\u2026';
      ringClass = 'gp-gen-ring__fill--spinning';
    } else if (total > 0) {
      // Generation phase: discovery is done (33%), section content fills
      // 33% -> 90% — the last stretch is reserved for the checkpoint phase.
      var genPct = Math.round((completed / total) * 100);
      pct = Math.round(33 + (genPct * 0.57));
      offset = circumference * (1 - pct / 100);
      ringLabel = pct + '%';
    } else {
      pct = 0;
      offset = circumference;
    }

    // Determine step states
    var step1Class = 'pending';
    var step2Class = 'pending';
    var step3Class = 'pending';
    var step2Status = '';
    var step3Status = '';

    if (status === 'discovering') {
      step1Class = 'active';
    } else if (total > 0) {
      step1Class = 'done';
    }

    if (status === 'generating' || status === 'partial') {
      step2Class = completed < total ? 'active' : 'done';
      step2Status = completed < total ? completed + ' of ' + total : 'Complete';
    } else if (status === 'checkpoints') {
      // Section content is finished; practice questions are being written.
      step2Class = 'done';
      step2Status = 'Complete';
      step3Class = 'active';
      step3Status = 'Writing questions\u2026';
    } else if (status === 'done') {
      step2Class = 'done';
      step2Status = 'Complete';
    }

    if (status === 'done') {
      step3Class = 'done';
      step3Status = 'Complete';
    }

    // Checkmark SVG for done steps
    var checkSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
    // Spinner SVG for active step
    var spinnerSvg = '<svg class="gp-step-spinner" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>';
    // Error SVG for failed
    var errorSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

    var step1Icon = step1Class === 'done' ? checkSvg : (step1Class === 'active' ? spinnerSvg : '1');
    var step2Icon = step2Class === 'done' ? checkSvg : (step2Class === 'active' ? spinnerSvg : '2');
    var step3Icon = step3Class === 'done' ? checkSvg : (step3Class === 'active' ? spinnerSvg : '3');

    var step1StatusText = total > 0 ? total + ' sections' : (status === 'discovering' ? 'Discovering sections\u2026' : 'Starting\u2026');
    if (status === 'failed') {
      step1StatusText = 'Failed';
      step1Class = 'error';
      step1Icon = errorSvg;
    }

    var html = '<div class="guided-progress">'
      // Progress ring
      + '<div class="gp-gen-ring">'
      + '<svg class="gp-gen-ring__svg" viewBox="0 0 100 100" aria-hidden="true">'
      + '<circle class="gp-gen-ring__bg" cx="50" cy="50" r="42" />'
      + '<circle class="gp-gen-ring__fill ' + ringClass + '" cx="50" cy="50" r="42"'
      + ' style="stroke-dashoffset:' + offset + '" />'
      + '</svg>'
      + '<div class="gp-gen-ring__text">'
      + '<span class="gp-gen-ring__pct">' + (status === 'discovering' ? '0%' : pct + '%') + '</span>'
      + '</div>'
      + '</div>'
      // Steps
      + '<div class="guided-progress-steps">'
      + '<div class="guided-progress-step ' + step1Class + '">'
      + '<div class="guided-progress-step-icon">' + step1Icon + '</div>'
      + '<div class="guided-progress-step-text">Breaking content into sections</div>'
      + '<div class="guided-progress-step-status">' + step1StatusText + '</div>'
      + '</div>'
      + '<div class="guided-progress-step ' + step2Class + '">'
      + '<div class="guided-progress-step-icon">' + step2Icon + '</div>'
      + '<div class="guided-progress-step-text">Generating study material</div>'
      + '<div class="guided-progress-step-status">' + step2Status + '</div>'
      + '</div>'
      + '<div class="guided-progress-step ' + step3Class + '">'
      + '<div class="guided-progress-step-icon">' + step3Icon + '</div>'
      + '<div class="guided-progress-step-text">Adding practice questions</div>'
      + '<div class="guided-progress-step-status">' + step3Status + '</div>'
      + '</div>'
      + '</div>'
      + '</div>';

    return html;
  }

  function pollForSections() {
    var container = document.getElementById('guided-sections-container');
    if (!container) return;

    setTimeout(function () {
      _pollTotalCount++;

      if (_pollTotalCount > _POLL_MAX_TOTAL) {
        showError('Generation is taking longer than expected. Please try again.');
        return;
      }

      fetch('/library/api/pack/' + packId + '/sections')
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (!data.ok) return;

          var gen = data.generation || {};
          var completed = gen.completed_sections || 0;
          var total = gen.total_sections || 0;
          var failed = gen.failed_sections || 0;
          var genStatus = gen.status || 'pending';

          // Handle failed status
          if (genStatus === 'failed') {
            showError('Generation failed. Please try again.');
            return;
          }

          // Heartbeat staleness detection — if status_at is >4min old and not done/failed, thread crashed.
          // (Generations run concurrently now, but a single provider call can still take up to ~3min.)
          // A NULL status_at means the pack never recorded an active run — treat as stale too so the
          // tab doesn't poll forever on a dead generation.
          if (genStatus !== 'done' && genStatus !== 'failed' && genStatus !== 'partial') {
            var statusAt = gen.status_at ? new Date(gen.status_at).getTime() : null;
            if (statusAt === null || (Date.now() - statusAt) / 1000 > 240) {
              showError('Generation seems to have stalled. Please try again.');
              return;
            }
          }

          // Always update progress UI (including when total=0 during discovery)
          container.innerHTML = renderProgressUI(completed, total, failed, genStatus);

          if (data.sections && data.sections.length > 0) {
            var newCount = data.sections.length;
            var oldCount = sections.length;

            sections = data.sections;
            currentIndex = data.current_index || 0;

            if (genStatus === 'done' || genStatus === 'partial' || genStatus === 'failed') {
              // Generation complete (or partial/failed) — render layout and load first section
              renderLayout();
              loadSection(sections[currentIndex].id);
              _pollNoChangeCount = 0;
              _pollTotalCount = 0;
              return;
            }

            if (oldCount === 0) {
              // First time sections appeared — keep polling for content
              _pollNoChangeCount = 0;
            } else if (newCount > oldCount) {
              // New sections were added — reset counter
              _pollNoChangeCount = 0;
            } else {
              _pollNoChangeCount++;
            }

            // Keep polling while generating
            if (_pollNoChangeCount < _POLL_MAX_TOTAL) {
              pollForSections();
            } else {
              // Timed out waiting for completion — show what we have
              renderLayout();
              if (sections.length > 0) loadSection(sections[currentIndex].id);
            }
          } else {
            // No sections yet — keep polling
            pollForSections();
          }
        })
        .catch(function () {
          pollForSections();
        });
    }, 3000); // Poll every 3 seconds for faster feedback
  }

  function showError(msg) {
    var container = document.getElementById('guided-sections-container');
    if (container) {
      _hideReadProgress();
      container.innerHTML = '<div class="guided-error-state">'
        + '<h3>Oops</h3>'
        + '<p>' + escapeHtml(msg) + '</p>'
        + '<button class="guided-btn guided-btn-outline" id="guided-retry-btn" style="margin-top:12px">Try Again</button>'
        + '</div>';
      var retryBtn = document.getElementById('guided-retry-btn');
      if (retryBtn) {
        retryBtn.addEventListener('click', function () {
          showEmpty();
        });
      }
    }
  }

  // ── Utilities ────────────────────────────────────────────────────────

  function escapeHtml(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  /* Lightweight HTML sanitizer that strips dangerous tags/attributes
     but preserves LaTeX delimiters ($, \, {, }) so MathJax can process them. */
  var _SAFE_RE = /<script\b[^<]*(?:<\/script[^<]*)*>/gi;
  var _ON_ATTR_RE = /\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*')/gi;
  function _safeHtml(str) {
    if (!str) return '';
    return str.replace(_SAFE_RE, '').replace(_ON_ATTR_RE, '');
  }

  /* Typeset MathJax inside an element. Fire-and-forget — mirrors the
     pattern used by every other tab in the study room. */
  function _typeset(el) {
    if (typeof window.motownTypesetMath === 'function' && el &&
        /\$|\\|mathjax/i.test(el.innerHTML)) {
      window.motownTypesetMath(el);
    }
  }

  // ── Expose for external calls (room-tab-lazy integration) ────────────

  window._guidedPathInit = init;
  // Save the current in-progress section quiz (persists answers + timer end)
  // so it can be restored when the study-room tab is mounted again later.
  window._guidedPathSave = _saveQuizSession;
  // Restore a previously-saved section quiz (resuming its countdown), or
  // fall back to a fresh init if no session was saved.
  window._guidedPathRestore = _restoreQuizSession;
  // Stop any running quiz countdown when the tab is unmounted so it doesn't
  // tick against a detached DOM.
  window._guidedPathStopTimer = _stopQuizTimer;

  // Read-to-Me follow-along: open the given section and call `done(true)`
  // once its .guided-study-text content has rendered (or `done(false)` if the
  // section can't be found / rendered). No-ops when it's already on screen.
  window.guidedNavigateBySectionId = function (sectionId, done) {
    var idx = -1;
    for (var i = 0; i < sections.length; i++) {
      if (String(sections[i].id) === String(sectionId)) { idx = i; break; }
    }
    if (idx < 0) {
      if (done) done(false);
      return false;
    }
    if (idx === currentIndex && document.querySelector('#guided-content .guided-study-text')) {
      if (done) done(true);
      return true;
    }
    navigateToSection(idx);
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      var text = document.querySelector('#guided-content .guided-study-text');
      if (text && text.children.length) {
        clearInterval(timer);
        if (done) done(true);
      } else if (tries >= 50) {
        clearInterval(timer);
        if (done) done(false);
      }
    }, 120);
    return true;
  };

  // Auto-init if the tab is already active (e.g. default tab)
  if (document.getElementById('tab-guided') &&
      document.getElementById('tab-guided').classList.contains('room-vp--active')) {
    init();
  }

  // React to the quiz-timer preference changing in Settings → Preferences
  window.addEventListener('motown:quiz-timer', function(e) {
    var enabled = e && e.detail && e.detail.enabled;
    if (!enabled) {
      _stopQuizTimer();
      var timerEl = document.getElementById('guided-quiz-timer');
      if (timerEl) timerEl.style.display = 'none';
    } else if (_quizState && _quizState.checkpoints) {
      // Only restart if a section quiz is currently active
      _startQuizTimer(_quizState.checkpoints.length);
    }
  });
})();
