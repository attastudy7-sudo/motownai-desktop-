// Study Room AI Chat Engine ” markdown, typewriter, bubbles, suggestions, tools, images, docs, history
// Study-room chat wiring
;(function () {
  if (window._studyRoomChatBooted) return;
  window._studyRoomChatBooted = true;

  const CSRF = document.querySelector('meta[name="csrf-token"]')?.content || '';
  const VIDEO_ACTIVE = window.VIDEO_ACTIVE;
  const VIDEO_ID = window.VIDEO_ID;
  const VIDEO_TITLE = window.VIDEO_TITLE;
  const UPLOAD_TITLE = window.UPLOAD_TITLE;
  const PACK_ID = window.PACK_ID;

  function escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Configure marked.js: wrap list item content in <p> for Gemini-style spacing
  if (typeof marked !== 'undefined' && marked.use) {
    marked.use({
      renderer: {
        listItem: function (text) {
          return '<li><p>' + text + '</p></li>';
        }
      }
    });
  }

  function renderMarkdown(text, inline) {
    var raw = String(text ?? '');
    if (!raw.trim()) return '';

    // Protect math delimiters from marked.js (MathJax processes them later)
    var mathBlocks = [];
    var mathInline = [];
    var mIdx = 0;

    raw = raw.replace(/\$\$([\s\S]*?)\$\$/g, function (_, expr) {
      var t = 'XMATHBLOCK' + mIdx + 'X';
      mathBlocks[mIdx] = expr;
      mIdx++;
      return t;
    });
    raw = raw.replace(/\\\[[\s\S]*?\\\]/g, function (expr) {
      var inner = expr.slice(2, -2);
      var t = 'XMATHBLOCK' + mIdx + 'X';
      mathBlocks[mIdx] = inner;
      mIdx++;
      return t;
    });
    raw = raw.replace(/(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)/g, function (_, expr) {
      var t = 'XMATHINLINE' + mIdx + 'X';
      mathInline[mIdx] = expr;
      mIdx++;
      return t;
    });
    raw = raw.replace(/\\\([\s\S]*?\\\)/g, function (expr) {
      var inner = expr.slice(2, -2);
      var t = 'XMATHINLINE' + mIdx + 'X';
      mathInline[mIdx] = inner;
      mIdx++;
      return t;
    });

    // Parse with marked.js (inline mode for short content like MCQ options so a
    // leading "-5" or "1." is not re-interpreted as a list/heading)
    var html;
    if (typeof marked !== 'undefined' && marked.parse) {
      html = inline
        ? marked.parseInline(raw, { breaks: true, gfm: true })
        : marked.parse(raw, { breaks: true, gfm: true });
    } else {
      // Fallback: basic paragraph wrapping if marked.js not loaded
      html = '<p>' + raw.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>') + '</p>';
    }

    // Sanitize with DOMPurify (allow the HTML elements we need).
    // Inline styles are forbidden so AI-generated content can't hardcode
    // light-mode colors into the dark theme — themed callouts rely on
    // <blockquote>, which already carries the right look.
    if (typeof DOMPurify !== 'undefined') {
      html = DOMPurify.sanitize(html, {
        ADD_TAGS: ['table', 'thead', 'tbody', 'tr', 'th', 'td'],
        ADD_ATTR: ['class'],
        FORBID_ATTR: ['style'],
      });
    }

    // Restore math delimiters
    html = html.replace(/XMATHBLOCK(\d+)X/g, function (_, idx) {
      return '$$' + (mathBlocks[Number(idx)] || '') + '$$';
    });
    html = html.replace(/XMATHINLINE(\d+)X/g, function (_, idx) {
      return '$' + (mathInline[Number(idx)] || '') + '$';
    });

    if (!inline) {
      html = html.replace(/(<table\b[^>]*>[\s\S]*?<\/table>)/g, '<div class="md-table-wrap">$1</div>');
    }

    return html;
  }

  function wrapProse(html) {
    return html ? '<div class="prose">' + html + '</div>' : '';
  }

  // Sanitize authoritative reply_html (server-rendered) the same way as
  // streamed markdown, so hardcoded inline styles never survive into the DOM.
  function cleanAIHtml(html) {
    if (!html) return html;
    if (typeof DOMPurify !== 'undefined') {
      return DOMPurify.sanitize(html, {
        ADD_TAGS: ['table', 'thead', 'tbody', 'tr', 'th', 'td'],
        ADD_ATTR: ['class'],
        FORBID_ATTR: ['style'],
      });
    }
    return html;
  }

  function isChatNearBottom(el, threshold) {
    if (!el) return true;
    var distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    return distance <= (threshold || 24);
  }

  function scrollChatToBottom(el, smooth) {
    if (!el) return;
    _lastProgrammaticScroll = Date.now();
    if (smooth && typeof el.scrollTo === 'function') {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }

  // Coalesce typewriter scroll requests into one write per animation frame.
  // Reads nothing — the write is unconditional if _autoScroll is still set.
  function _scheduleScroll(el) {
    if (_scrollRafId || !_autoScroll || !el) return;
    _scrollRafId = requestAnimationFrame(function () {
      _scrollRafId = null;
      if (_autoScroll) {
        _lastProgrammaticScroll = Date.now();
        el.scrollTop = el.scrollHeight;
      }
    });
  }

  // "5h 12m" / "32m" / "under a minute" — quota reset countdown label.
  function _fmtQuotaTime(seconds) {
    seconds = Math.max(0, Math.floor(seconds));
    var h = Math.floor(seconds / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    if (h >= 1) return h + 'h ' + m + 'm';
    if (m >= 1) return m + 'm';
    return 'under a minute';
  }

  function _updateChatScrollBtn() {
    var messages = _chatMessagesEl();
    var btn = document.getElementById('chatScrollBtn');
    var thread = _chatThreadEl();
    if (!messages || !btn || !thread) return;
    // Already at the bottom of the thread — nothing further to scroll to, hide regardless
    // of where the latest AI message's top landmark sits.
    if (isChatNearBottom(messages, 24)) { btn.style.display = 'none'; return; }
    var userWraps = thread.querySelectorAll('.cmsg-user-wrap');
    var lastUser = userWraps.length ? userWraps[userWraps.length - 1] : null;
    if (!lastUser) { btn.style.display = 'none'; return; }
    // Where scrollTop would need to be to put the start of the newest user
    // message at the top of the viewport — the button's actual destination.
    var targetTop = lastUser.getBoundingClientRect().top - messages.getBoundingClientRect().top + messages.scrollTop;
    var aheadBy = targetTop - messages.scrollTop;
    // Already there (or scrolled past it) — hide. Still above it — show.
    btn.style.display = aheadBy > 24 ? 'flex' : 'none';
  }

  // Scrolls so the given element sits near the top of the chat viewport.
  // Used on send so the newest user message anchors the top and the assistant's
  // reply streams into view beneath it. Runs on the next frame so it lands after
  // any pending scroll writes (e.g. the thinking bubble's bottom-follow), and the
  // streaming typewriter's normal bottom-follow then takes over as text grows.
  function _pinUserMessageTop(el, targetEl, gap) {
    if (!el || !targetEl) return;
    requestAnimationFrame(function () {
      _autoScroll = false;
      var gapTop = gap || 14;
      var target = targetEl.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - gapTop;
      if (target < 0) target = 0;
      _lastProgrammaticScroll = Date.now();
      _pinTarget = target;
      el.scrollTop = target;
      _updateChatScrollBtn();
    });
  }

  // Reserves scroll room below the newest user message so _pinUserMessageTop
  // can actually reach the top of the viewport. Without room below, scrollTop
  // clamps to scrollHeight - clientHeight and a message at the end of a long
  // thread lands at the bottom instead of the top.
  function _makeRoomForPin(el, targetEl, gap) {
    var thread = _chatThreadEl();
    if (!el || !targetEl || !thread) return;
    _lastProgrammaticScroll = Date.now();
    var gapTop = gap || 14;
    var target = targetEl.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - gapTop;
    if (target < 0) target = 0;
    var maxScroll = el.scrollHeight - el.clientHeight;
    var need = target - maxScroll;
    if (need > 0) {
      thread.style.paddingBottom = (need + 24) + 'px';
    } else {
      thread.style.paddingBottom = '';
    }
  }

  function _collapseThreadSpacer() {
    var thread = _chatThreadEl();
    if (!thread) return;
    var messages = _chatMessagesEl();
    if (messages && messages.scrollTop <= _pinTarget + 120) return;
    thread.style.paddingBottom = '0px';
  }

  // Follows the streaming bubble's bottom edge so the pinned user message stays
  // anchored just below the header while the reply is short, and only scrolls
  // (incrementally, by the overflow) once the reply outgrows the viewport.
  function getNotesEditor() {
    return document.querySelector('.notes-prosemirror');
  }

  function loadNotesDraft() {
    const editor = getNotesEditor();
    if (!editor) return;
    try {
      const saved = localStorage.getItem(window.STUDY_ROOM_NOTES_KEY);
      if (saved) editor.innerHTML = typeof DOMPurify !== 'undefined'
        ? DOMPurify.sanitize(saved, { USE_PROFILES: { html: true }, FORBID_ATTR: ['style'] })
        : saved;
    } catch (_) {}
  }

  window._notesSaveTimer = null;
  function _isNotesTransientState(html) {
    return !html || html.includes('notes-loading-bar-wrap') || html.includes('notes-generating-error');
  }

  function persistNotesDraft() {
    const editor = getNotesEditor();
    if (!editor) return;
    var html = editor.innerHTML;
    // Don't persist loading/error states — they're transient UI, not user content
    if (_isNotesTransientState(html)) return;
    // localStorage: immediate (skip if over 4 MB to avoid QuotaExceededError)
    try {
      if (html.length < 4 * 1024 * 1024) {
        localStorage.setItem(window.STUDY_ROOM_NOTES_KEY, html);
      }
    } catch (_) {}
    // server: debounced 2.5s — silently fails, localStorage is the safety net
    clearTimeout(_notesSaveTimer);
    _notesSaveTimer = setTimeout(function () {
      if (!html || !html.trim()) return;
      var packId = window.PACK_ID;
      if (!packId) return;
      var csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
      fetch('/library/pack/' + packId + '/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
        body: JSON.stringify({ html: html }),
      }).catch(function () {});
    }, 2500);
  }

function appendToNotes(html) {
  const editor = getNotesEditor();
  if (!editor) return false;
  
  // Enhance the notes content for better visual appeal
  const enhancedHtml = enhanceNotesContent(html);
  
  const block = document.createElement('div');
  block.className = 'sr-notes-tool-block';
  block.innerHTML = typeof DOMPurify !== 'undefined'
    ? DOMPurify.sanitize(enhancedHtml, { USE_PROFILES: { html: true }, FORBID_ATTR: ['style'] })
    : enhancedHtml;
  editor.appendChild(block);
  if (window.motownTypesetMath) {
    window.motownTypesetMath(block);
  }
  persistNotesDraft();
  return true;
}

function enhanceNotesContent(content) {
  if (!content) return '';
  // If it looks like plain text / markdown, run it through renderMarkdown
  // so notes content is consistent with chat rendering
  var isHtml = /<[a-z][\s\S]*>/i.test(content);
  if (!isHtml) {
    content = renderMarkdown(content);
  }
  var clean = typeof DOMPurify !== 'undefined'
    ? DOMPurify.sanitize(content, { USE_PROFILES: { html: true }, FORBID_ATTR: ['style'] })
    : content;
  return '<div class="notes-enhancement">' + clean + '</div>';
}

  function switchToNotesTab() {
    const notesBtn = document.querySelector('.room-tab-btn[data-target="tab-notes"]');
    if (window.switchRoomTab && notesBtn) {
      window.switchRoomTab(notesBtn, 'tab-notes');
    }
  }

  function switchToQuizTab() {
    const quizBtn = document.querySelector('.room-tab-btn[data-target="tab-quiz"]');
    if (window.switchRoomTab && quizBtn) {
      window.switchRoomTab(quizBtn, 'tab-quiz');
    }
  }

  function switchToFlashcardsTab() {
    const fcBtn = document.querySelector('.room-tab-btn[data-target="tab-flashcards"]');
    if (window.switchRoomTab && fcBtn) {
      window.switchRoomTab(fcBtn, 'tab-flashcards');
    }
  }

  function switchToCheatsheetTab() {
    const csBtn = document.querySelector('.room-tab-btn[data-target="tab-cheatsheet"]');
    if (window.switchRoomTab && csBtn) {
      window.switchRoomTab(csBtn, 'tab-cheatsheet');
    }
  }

  function switchToBossQuizTab() {
    const bqBtn = document.querySelector('.room-tab-btn[data-target="tab-boss-quiz"]');
    if (window.switchRoomTab && bqBtn) {
      window.switchRoomTab(bqBtn, 'tab-boss-quiz');
    }
  }

  var STAGE_LABELS = {
    'processing': 'Extracting text from your image...',
    'generating': 'Generating your answer...',
    'thinking':   'Thinking...',
  };

  function showThinkingBubble(initialLabel) {
    var thread = _chatThreadEl();
    if (!thread) return null;

    var wrap = document.createElement('div');
    wrap.className = 'cmsg-thinking';
    wrap.innerHTML =
      '<span class="cmsg-loader" aria-hidden="true">' +
        '<svg class="cmsg-loader__star" viewBox="0 0 24 24"><path d="M12 0 C12.4 6.4 17.6 11.6 24 12 C17.6 12.4 12.4 17.6 12 24 C11.6 17.6 6.4 12.4 0 12 C6.4 11.6 11.6 6.4 12 0 Z"/></svg>' +
        '<span class="cmsg-loader__orbit"><span class="cmsg-loader__dot"></span></span>' +
      '</span>' +
      '<span class="cmsg-thinking-text cmsg-thinking-text--shimmer"></span>';
    thread.appendChild(wrap);

    var label = wrap.querySelector('.cmsg-thinking-text');
    label.textContent = STAGE_LABELS[initialLabel] || 'Thinking...';
    wrap._thinkLabel = label;

    var chatMessages = _chatMessagesEl();
    _scheduleScroll(chatMessages);
    return wrap;
  }

  function clearThinkingBubble(bubble) {
    if (!bubble) return;
    bubble.remove();
  }

  function updateThinkingStage(bubble, stage) {
    if (!bubble || !bubble._thinkLabel) return;
    var text = STAGE_LABELS[stage];
    if (text) bubble._thinkLabel.textContent = text;
  }

  window.renderToolResult = function(action, payload) {
    if (!action) return false;

     if (action === 'append_notes') {
       const html = payload?.html || payload?.text || '';
       switchToNotesTab();
       if (html) {
         // Defer append until the notes editor is mounted and any server
         // fetch has completed — _fetchServerNotes overwrites innerHTML
         // with a loading bar and then with the fetched content, so
         // appending before it settles causes the content to be wiped.
         const deadline = Date.now() + 30000;
         (function waitForNotes() {
           const ed = getNotesEditor();
           if (ed && !ed.querySelector('.notes-loading-bar-wrap')) {
             appendToNotes(html);
             ed.focus();
           } else if (ed && ed.querySelector('.notes-generating-error')) {
             // Server notes failed — clear the error and inject the AI content directly
             ed.innerHTML = '';
             appendToNotes(html);
             ed.focus();
           } else if (Date.now() < deadline) {
             setTimeout(waitForNotes, 300);
           }
         })();
       }
       return true;
     }

    if (action === 'open_notes') {
      switchToNotesTab();
      const editor = getNotesEditor();
      if (editor) editor.focus();
      return true;
    }

    if (action === 'open_quiz') {
      switchToQuizTab();
      return true;
    }

    if (action === 'generate_fill_in') {
      var questions = (payload && Array.isArray(payload.questions)) ? payload.questions : [];
      if (questions.length && typeof window.renderFillIns === 'function') {
        if (window._fiAppending && Array.isArray(window._fiQ)) {
          var seenKeys = {};
          window._fiQ.forEach(function(q) {
            var k = (window._dedupKey || function(){ return ''; })(q, 'fill_in');
            if (k) seenKeys[k] = true;
          });
          questions.forEach(function(q) {
            var k = (window._dedupKey || function(){ return ''; })(q, 'fill_in');
            if (k && seenKeys[k]) return;
            if (k) seenKeys[k] = true;
            window._fiQ.push(q);
          });
          var totalEl = document.getElementById('fiTotal');
          if (totalEl) totalEl.textContent = window._fiQ.length;
          var fiStage = document.getElementById('fiStage');
          var fiEmpty = document.getElementById('fiEmpty');
          if (fiEmpty) fiEmpty.style.display = 'none';
          if (fiStage) fiStage.style.display = '';
          var fiMoreRow = document.getElementById('fiMoreRow');
          if (fiMoreRow) fiMoreRow.style.display = window._fiQ.length > 0 ? '' : 'none';
          // Save the full merged set
          var allQ = window._fiQ;
          window._fiData = allQ;
          if (PACK_ID) {
            fetch('/library/pack/' + PACK_ID + '/save-fillins', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-CSRFToken': CSRF },
              body: JSON.stringify({ questions: allQ, group_index: 0 }),
            })
            .then(function(r) { return r.json(); })
            .then(function(data) {
              if (data && (data.ok || data.status === 'ok')) {
                var ms = document.getElementById('fiMoreStatus');
                if (ms) ms.textContent = 'Saved';
                setTimeout(function () { if (ms) ms.textContent = ''; }, 2000);
              }
            }).catch(function(){ /* ignore */ });
          }
        } else {
          window._fiData = questions;
          window.renderFillIns(questions);
          var fiBtn = document.querySelector('.room-tab-btn[data-target="tab-more"]');
          if (window.switchRoomTab && fiBtn) window.switchRoomTab(fiBtn, 'tab-more');
          // Save to DB so they persist on reload
          if (PACK_ID) {
            fetch('/library/pack/' + PACK_ID + '/save-fillins', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-CSRFToken': CSRF },
              body: JSON.stringify({ questions: questions, group_index: 0 }),
            })
            .then(function(r) { return r.json(); })
            .then(function(data) {
              if (data && (data.ok || data.status === 'ok')) {
                var gs = document.getElementById('fiGenStatus');
                if (gs) gs.textContent = 'Saved';
                setTimeout(function () { if (gs) gs.textContent = ''; }, 2000);
              }
            }).catch(function(){ /* ignore */ });
          }
        }
      }
      window._fiAppending = false;
      return true;
    }

    if (action === 'generate_quiz') {
      var questions = (payload && Array.isArray(payload.questions)) ? payload.questions : [];
      if (questions.length && typeof window.renderQuiz === 'function') {
        if (window._qzAppending && Array.isArray(window._qzQ)) {
          var seenTexts = {};
          window._qzQ.forEach(function(q) {
            var t = q && q.question;
            if (typeof t === 'string') seenTexts[' ' + t.trim().toLowerCase()] = true;
          });
          questions.forEach(function(q) {
            var t = q && (q.question || q.question_text || q.text || '');
            if (typeof t === 'string') {
              var key = ' ' + t.trim().toLowerCase();
              if (seenTexts[key]) return;
              seenTexts[key] = true;
            }
            window._qzQ.push(typeof window._qzNormalizeQuestion === 'function' ? window._qzNormalizeQuestion(q) : q);
          });
          window._qzData = window._qzQ.slice();
          var qzTotal = document.getElementById('qzTotal');
          if (qzTotal) qzTotal.textContent = window._qzQ.length;
          if (typeof window._qzSetTotal === 'function') window._qzSetTotal(window._qzQ.length);
          if (window.SrAppendOverlay) window.SrAppendOverlay.hide('tab-quiz');
          if (window.PACK_ID) {
            fetch('/library/pack/' + window.PACK_ID + '/save-quiz', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-CSRFToken': CSRF },
              body: JSON.stringify({ questions: window._qzData, group_index: 0 }),
            }).catch(function() {
              if (typeof window.showFatalErrorModal === 'function') {
                var qzQuestions = window._qzData;
                window.showFatalErrorModal('Failed to save your quiz. Please try again.', function () {
                  var csrfToken = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
                  fetch('/library/pack/' + window.PACK_ID + '/save-quiz', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken },
                    body: JSON.stringify({ questions: qzQuestions, group_index: 0 }),
                  }).catch(function () {});
                });
              }
            });
          }
        } else {
          window._qzData = questions;
          window.renderQuiz(questions);
          var quizBtn = document.querySelector('.room-tab-btn[data-target="tab-quiz"]');
          if (window.switchRoomTab && quizBtn) window.switchRoomTab(quizBtn, 'tab-quiz');
        }
      }
      window._qzAppending = false;
      return true;
    }

    if (action === 'append_flashcards') {
      var newCards = (payload && Array.isArray(payload.cards)) ? payload.cards : [];
      if (!newCards.length) return false;

      var MAX_CARDS = 30;

      newCards = newCards.map(function(c) {
        return {
          front: c.front || c.question || '',
          back:  c.back  || c.answer   || '',
        };
      }).filter(function(c) { return c.front && c.back; });

      if (!newCards.length) return false;

      if (typeof CARDS !== 'undefined' && Array.isArray(CARDS)) {
        var slots = MAX_CARDS - CARDS.length;
        var toAdd = newCards.slice(0, Math.max(0, slots));
        toAdd.forEach(function(c) { CARDS.push(c); });

        var totalEl = document.getElementById('fcTotal');
        if (totalEl) totalEl.textContent = CARDS.length;

        var fcEmpty = document.getElementById('fcEmpty');
        var fcStage = document.getElementById('fcStage');
        var fcNav   = document.getElementById('fcNav');
        var fcCounter = document.getElementById('fcCounter');
        if (CARDS.length > 0 && fcStage && fcStage.style.display === 'none') {
          if (fcEmpty)   fcEmpty.style.display   = 'none';
          if (fcStage)   fcStage.style.display   = '';
          if (fcNav)     fcNav.style.display      = '';
          if (fcCounter) fcCounter.style.display  = '';
          if (typeof window._fcLoad === 'function') window._fcLoad(CARDS.length - toAdd.length);
        }

        var moreRow = document.getElementById('fcMoreRow');
        if (moreRow) {
          moreRow.style.display = (CARDS.length > 0 && CARDS.length < MAX_CARDS) ? '' : 'none';
        }

        var nextBtn = document.getElementById('fcNext');
        var idx = typeof window._fcIdx !== 'undefined' ? window._fcIdx : 0;
        if (nextBtn) nextBtn.disabled = (idx === CARDS.length - 1);
        if (window.SrAppendOverlay) window.SrAppendOverlay.hide('tab-flashcards');
      }

      switchToFlashcardsTab();
      return true;
    }

    if (action === 'open_flashcards') {
      switchToFlashcardsTab();
      return true;
    }

    if (action === 'open_cheatsheet') {
      switchToCheatsheetTab();
      return true;
    }

    if (action === 'open_boss_quiz') {
      switchToBossQuizTab();
      return true;
    }

    return false;
  }

  function inferToolRequest(message) {
    const text = String(message || '').toLowerCase();
    
    // Notes patterns
    const wantsSummary = /summari[sz]e|summary|take notes|put it in my notes|put this in my notes|add to notes|save to notes|(?:give|make|write|generate|create|prepare)\s+(?:me\s+)?(?:some\s+)?notes\b|\bnotes\s+(?:on|about|for)\b/.test(text);
    const wantsNotes = /open notes|show notes|switch to notes|go to notes/.test(text);
    
    // Fill-in patterns
    const wantsFillIn = /fill.?in|fill.?blank|cloze|complete the sentence|blank exercise/.test(text);

    // Quiz patterns
    const wantsQuiz = /quiz me|give me a quiz|pop quiz|quick quiz|test me|ask me questions|question time/.test(text);

    // Quiz generation patterns
    const wantsGenQuiz = /generate.*quiz|make.*quiz|create.*quiz|give.*quiz|question me|mcq/.test(text);
    
    // Flashcards patterns
    const wantsAddFlashcards = /add.*cards?|add.*flashcards?|give me.*cards?|make.*cards?|create.*cards?|generate.*cards?|\d+\s*flashcards?/.test(text);
    const wantsFlashcards = /open flashcards|show flashcards|switch to flashcards|go to flashcards|review cards/.test(text);
    
    // Cheatsheet patterns
    const wantsCheatsheet = /cheatsheet|cheat sheet|quick reference|reference sheet|summary sheet/.test(text);
    
    // Boss quiz (most difficult)
    const wantsBossQuiz = /boss quiz|final quiz|hard quiz|challenging quiz|master quiz/.test(text);

    if (wantsBossQuiz) return 'open_boss_quiz';
    if (wantsGenQuiz) return 'generate_quiz';
    if (wantsFillIn) return 'generate_fill_in';
    if (wantsQuiz) return 'open_quiz';
    if (wantsAddFlashcards) return 'append_flashcards';
    if (wantsFlashcards) return 'open_flashcards';
    if (wantsCheatsheet) return 'open_cheatsheet';
    if (wantsSummary) return 'append_notes';
    if (wantsNotes) return 'open_notes';
    return null;
  }

  function buildNotesSummary(replyText) {
    const lines = String(replyText || '')
      .split(/\n+/)
      .map(line => line.trim())
      .filter(Boolean)
      .slice(0, 5);

    const bullets = lines.length
      ? lines.map(line => `<li>${renderMarkdown(line)}</li>`).join('')
      : '<li>Key idea from the lesson will appear here.</li>';

    return `
      <h3>Study Room Notes</h3>
      <p><strong>${escapeHtml(UPLOAD_TITLE || VIDEO_TITLE || 'Current topic')}</strong></p>
      <ul>${bullets}</ul>
    `;
  }

  function _computeSuggestions(replyText, history) {
    var len = history ? history.length : 0;
    if (len <= 2) {
      return [
        { label: 'Quiz me on this', prompt: 'Quiz me on this topic with multiple-choice questions.', tool_hint: 'generate_quiz' },
        { label: 'Make flashcards', prompt: 'Generate 10 flashcards for this topic.', tool_hint: 'append_flashcards' },
        { label: 'Summarise key points', prompt: 'Summarise the key takeaways from what we just covered.', tool_hint: 'append_notes' },
        { label: 'Explain a concept', prompt: 'Pick the most important concept from this topic and explain it simply.' }
      ];
    }
    if (/explain|because|means/i.test(replyText || '')) {
      return [
        { label: 'Give me an example', prompt: 'Give me a concrete example of what you just explained.' },
        { label: 'Test my understanding', prompt: 'Ask me a question to check if I understood this.' },
        { label: 'Add to notes', prompt: 'Add the key points from this explanation to my study notes.', tool_hint: 'append_notes' },
        { label: 'Fill-in exercises', prompt: 'Create fill-in-the-blank exercises based on this topic.', tool_hint: 'generate_fill_in' }
      ];
    }
    if (/quiz|question|test|try|answer/i.test(replyText || '')) {
      return [
        { label: 'Another question', prompt: 'Give me another question on this topic.' },
        { label: 'Explain in more depth', prompt: 'Explain the reasoning behind the correct answer in more detail.' },
        { label: 'Next topic', prompt: 'What should I study next based on what I know?' },
        { label: 'Make flashcards', prompt: 'Turn these Q&A into flashcards.', tool_hint: 'append_flashcards' }
      ];
    }
    return [
      { label: 'Tell me more', prompt: 'Tell me more about this topic.' },
      { label: 'Give an example', prompt: 'Give me a real-world example to help me understand.' },
      { label: 'Summarise', prompt: 'Summarise what we just discussed.', tool_hint: 'append_notes' },
      { label: "What's next", prompt: 'What should I focus on next?' }
    ];
  }

  function _renderSuggestions(suggestions) {
    var thread = _chatThreadEl();
    if (!thread) return;
    var old = thread.querySelector('.chat-inline-suggestions');
    if (old) old.remove();
    if (!suggestions || !suggestions.length) return;
    var container = document.createElement('div');
    if (!_chatTarget) container.id = 'chatInlineSuggestions';
    container.className = 'chat-inline-suggestions';
    suggestions.forEach(function(s) {
      var btn = document.createElement('div');
      btn.className = 'chat-suggestion-pill';
      btn.textContent = s.label;
      btn.setAttribute('role', 'button');
      btn.setAttribute('tabindex', '0');
      btn.addEventListener('click', function() {
        container.remove();
        window.sendChat(s.tool_hint ? { message: s.prompt, tool_hint: s.tool_hint } : s.prompt);
      });
      btn.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); btn.click(); }
      });
      container.appendChild(btn);
    });
    thread.appendChild(container);
    _scheduleScroll(_chatMessagesEl());
  }

  // Suggestion pills are turn-scoped: a pending render is cleared when a new
  // exchange starts, and only the newest turn may actually draw them. Without
  // this guard, a previous turn's timer could fire mid-stream and re-add stale
  // pills while the new answer is still appearing.
  var _suggestTimer = null;
  var _suggestTurn = 0;

  // Code blocks, math display blocks, fenced blocks commit instantly.
  function _isInstantBlock(text) {
    return /^```/.test(text) || /^\$\$/.test(text) || /^\\\[]/.test(text) || /^---/.test(text);
  }

  // Estimated typewriter reveal time for a reply, matching startTypewriter's
  // cadence (18ms per char + up to 6ms jitter; instant blocks commit in one step).
  function _estimateTypewriterMs(reply) {
    var speed = 18, jitter = 6;
    var blocks = _splitIntoBlocks(String(reply || ''));
    var ms = 0;
    for (var i = 0; i < blocks.length; i++) {
      ms += _isInstantBlock(blocks[i]) ? speed : blocks[i].length * (speed + jitter / 2);
      ms += speed;
    }
    return ms;
  }

  function _scheduleSuggestions(reply, turn, delayOverride) {
    if (_suggestTimer) { clearTimeout(_suggestTimer); _suggestTimer = null; }
    _currentSuggestions = _computeSuggestions(reply, window._history);
    var delay;
    if (delayOverride != null) {
      delay = delayOverride;
    } else if (_streamWrapper && _streamWrapper.parentNode) {
      // Streamed replies are already committed when the result lands — show the
      // pills almost immediately instead of guessing at a typewriter that never ran.
      delay = 250;
    } else {
      // Non-streamed replies are still typewriting — wait for the animation to
      // finish before offering follow-ups (no arbitrary 4s cap that lands them
      // before long replies are done typing).
      delay = Math.min(_estimateTypewriterMs(reply) + 300, 8000);
    }
    _suggestTimer = setTimeout(function () {
      _suggestTimer = null;
      if (turn === _suggestTurn) _renderSuggestions(_currentSuggestions);
    }, delay);
  }

  var _dashSeq = 0;

  function appendBubble(role, text, instant, replyHtml, contextWasAttached, attachedImages, attachedDocs, skipStickScroll) {
    var _thisDash = ++_dashSeq;
    var thread = _chatThreadEl();
    if (!thread) return null;
    var messages = _chatMessagesEl();
    var shouldStick = isChatNearBottom(messages);

    var rendered = wrapProse(renderMarkdown(text));
    var wrap = document.createElement('div');

if (role === 'user') {
       // Strip server-injected prefixes from history-reloaded messages so they never appear as raw text.
       // Order: image blocks may precede or follow [Context]; strip both.
       var _msgText = String(text || '');
       // 1. Strip any leading [Image description] / [Attached image text] blocks
       _msgText = _msgText.replace(/^(?:\[(?:Image description|Attached image text)\]\n[\s\S]*?\n\n)+/, '');
       // 2. Strip [Context] block and flag its presence
       var _ctxMatch = _msgText.match(/^\[Context\]\n([\s\S]*?)\n\n([\s\S]*)$/);
       if (_ctxMatch) {
         contextWasAttached = contextWasAttached || _ctxMatch[1];
         _msgText = _ctxMatch[2];
       }
       // 3. Strip any image blocks that follow the context block
       _msgText = _msgText.replace(/^(?:\[(?:Image description|Attached image text)\]\n[\s\S]*?\n\n)+/, '');
       if (_msgText !== text) {
         text = _msgText;
         rendered = wrapProse(renderMarkdown(text));
       }
       var contextChip = contextWasAttached
         ? '<div class="cmsg-context-chip"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg> With context</div>'
         : '';
       var imgHtml = '';
       if (attachedImages && Array.isArray(attachedImages) && attachedImages.length) {
         var imgs = attachedImages.map(function(url) {
           return '<div class="chat-attached-image"><img src="' + url + '" loading="lazy"></div>';
         }).join('');
         var gridClass = attachedImages.length === 1 ? ' chat-attached-images--single' : '';
         imgHtml = '<div class="chat-attached-images' + gridClass + '">' + imgs + '</div>';
       }
       var docHtml = '';
       if (attachedDocs && Array.isArray(attachedDocs) && attachedDocs.length) {
         var docChips = attachedDocs.map(function(d) {
           var ext = (d.name.split('.').pop() || '').toUpperCase();
           return '<div class="chat-attached-doc"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><span>' + escapeHtml(d.name) + '</span></div>';
         }).join('');
         docHtml = '<div class="chat-attached-docs">' + docChips + '</div>';
       }
         wrap.className = 'cmsg-user-wrap';
         wrap.setAttribute('_dash', _thisDash);
       var _ctxDataAttr = contextWasAttached
         ? ' data-context="' + escapeHtml(typeof contextWasAttached === 'string' ? contextWasAttached : '') + '"'
         : '';
        wrap.innerHTML =
          '<div class="cmsg-bubble cmsg-bubble--user"' + _ctxDataAttr + '">' +
            contextChip +
            imgHtml +
            docHtml +
            '<div class="cmsg-body">' + rendered + '</div>' +
           '<div class="cmsg-actions cmsg-actions--user">' +
             '<button class="cmsg-action-btn" aria-label="Copy" onclick="window.copyMessage(this)">' +
               '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>' +
             '</button>' +
             '<button class="cmsg-action-btn" aria-label="Edit" onclick="window.editMessage(this)">' +
               '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"></path><path d="m15 5 4 4"></path></svg>' +
             '</button>' +
           '</div>' +
         '</div>';
       if (window.motownTypesetMath) {
         setTimeout(function () { window.motownTypesetMath(wrap); }, 50);
       }
       _highlightCode(wrap, 0);
     } else if (role === 'system') {
         wrap.className = 'cmsg-system-wrap';
         wrap.setAttribute('_dash', _thisDash);
       wrap.innerHTML =
         '<div class="cmsg-text cmsg-text--system">' + rendered + '</div>' +
         '<div class="cmsg-actions">' +
           '<button class="cmsg-action-btn" aria-label="Copy" onclick="window.copyMessage(this)">' +
             '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>' +
           '</button>' +
         '</div>';
       if (window.motownTypesetMath) {
         setTimeout(function () { window.motownTypesetMath(wrap); }, 50);
       }
       _highlightCode(wrap, 0);
     } else {
      // AI bubble: render with typewriter effect
      wrap.className = 'cmsg-ai-wrap';
      wrap.setAttribute('_dash', _thisDash);
      // store raw text (plain) for typing; rendered contains HTML, but
      // typing will reveal plain text progressively then convert to markdown
      var safeText = String(text || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      var rawText = String(text || '');
      var htmlAttr = replyHtml ? ' data-html="' + escapeHtml(replyHtml) + '"' : '';
      wrap.innerHTML =
        '<div class="cmsg-text cmsg-text--ai"><div class="ai-typewriter" data-full="' + safeText + '" data-raw="' + escapeHtml(rawText) + '"' + htmlAttr + '></div></div>' +
        '<div class="cmsg-actions">' +
          '<button class="cmsg-action-btn" aria-label="Copy" onclick="window.copyMessage(this)">' +
            '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>' +
          '</button>' +
        '</div>';
      // If instant rendering requested (e.g., loading history), show full text immediately
      if (instant) {
        var sp = wrap.querySelector('.ai-typewriter');
         if (sp) {
           var immediateHtml = sp.getAttribute('data-html') || '';
           var immediateRaw = sp.getAttribute('data-raw') || sp.getAttribute('data-full') || '';
           sp.innerHTML = immediateHtml ? wrapProse(cleanAIHtml(immediateHtml)) : wrapProse(renderMarkdown(immediateRaw));
           if (window.motownTypesetMath) {
             setTimeout(function () { window.motownTypesetMath(sp); }, 50);
           }
           _highlightCode(sp, 0);
         }
      } else {
        // start typewriter animation asynchronously
        setTimeout(function () { startTypewriter(wrap); }, 20);
      }
    }

    thread.appendChild(wrap);

    var emptyState = document.getElementById('chatEmptyState');
    if (emptyState) emptyState.style.display = 'none';

    if (messages && shouldStick && !skipStickScroll) scrollChatToBottom(messages, false);
    _updateChatScrollBtn();
    return wrap;
  }

  // Split raw markdown into independently renderable blocks.
  // Block math ($$...$$, \[...\]) and fenced code are kept as atomic units;
  // everything else is split at double-newline paragraph boundaries.
  function _splitIntoBlocks(text) {
    var blocks = [];
    var remaining = text;
    while (remaining.length) {
      var m;
      if ((m = remaining.match(/^\$\$([\s\S]*?)\$\$/))) {
        blocks.push(m[0]); remaining = remaining.slice(m[0].length); continue;
      }
      if ((m = remaining.match(/^\\\[([\s\S]*?)\\\]/))) {
        blocks.push(m[0]); remaining = remaining.slice(m[0].length); continue;
      }
      if ((m = remaining.match(/^```[\s\S]*?```/))) {
        blocks.push(m[0]); remaining = remaining.slice(m[0].length); continue;
      }
      // Find the nearest block boundary
      var indices = [];
      [/\$\$/, /\\\[/, /```/, /\n\n/].forEach(function (re) {
        var idx = remaining.search(re);
        if (idx > 0) indices.push(idx);
      });
      var next = indices.length ? Math.min.apply(null, indices) : -1;
      if (next === -1) {
        blocks.push(remaining); remaining = '';
      } else if (remaining.slice(next, next + 2) === '\n\n') {
        blocks.push(remaining.slice(0, next + 2));
        remaining = remaining.slice(next + 2);
      } else {
        if (next > 0) blocks.push(remaining.slice(0, next));
        remaining = remaining.slice(next);
      }
    }
    return blocks.filter(Boolean);
  }

  // Typewriter: reveal AI reply block-by-block with live MathJax per block.
  // Each paragraph/math block is committed as a permanent DOM element once fully
  // typed, then typeset once — it is never overwritten, so MathJax output persists.
  //
  // Performance: code/math/fenced blocks commit instantly (no char-by-char).
  // Paragraphs reveal plain text char-by-char, then commit with rendered markdown.
  // This avoids re-running renderMarkdown() on every keystroke — the expensive
  // regex pass now runs once per block instead of once per character.
  function startTypewriter(wrap, opts) {
    try {
      var span = wrap.querySelector('.ai-typewriter');
      if (!span) return;
      var full = span.getAttribute('data-full') || '';
      var messagesEl = _chatMessagesEl();
      span.innerHTML = '';

      var speed = (opts && opts.speed) || 18;
      var jitter = (opts && opts.jitter) || 6;

      var blocks = _splitIntoBlocks(full);
      if (!blocks.length) return;

      var blockIdx = 0;
      var charIdx = 0;

      // Live element: receives partial reveals while a paragraph block is being typed.
      // Replaced with a committed div when the block completes.
      var liveEl = document.createElement('span');
      liveEl.className = 'ai-tw-live';
      span.appendChild(liveEl);

      function _blockHasMath(text) {
        return /\$\$|\\\[|\\\(|\$[^$]/.test(text);
      }

      function _commitBlock(text) {
        if (liveEl.parentNode) liveEl.parentNode.removeChild(liveEl);
        var el = document.createElement('div');
        el.className = 'ai-tw-block';
        el.innerHTML = wrapProse(renderMarkdown(text));
        span.appendChild(el);
        _highlightCode(el, 0);
        if (_blockHasMath(text) && window.motownTypesetMath) {
          window.motownTypesetMath(el);
        }
        liveEl = document.createElement('span');
        liveEl.className = 'ai-tw-live';
        span.appendChild(liveEl);
        charIdx = 0;
      }

      function step() {
        if (blockIdx >= blocks.length) {
          if (liveEl.parentNode) liveEl.parentNode.removeChild(liveEl);
          if (window.motownTypesetMath) {
            setTimeout(function () { window.motownTypesetMath(span); }, 50);
          }
          _scheduleScroll(messagesEl);
          _updateChatScrollBtn();
          return;
        }

        var block = blocks[blockIdx];

        // Code/math/fenced blocks: commit instantly (no char-by-char animation)
        if (_isInstantBlock(block)) {
          _commitBlock(block);
          blockIdx++;
          _scheduleScroll(messagesEl);
          setTimeout(step, speed);
          return;
        }

        // Paragraph blocks: reveal plain text char-by-char, then commit rendered markdown
        if (charIdx >= block.length) {
          _commitBlock(block);
          blockIdx++;
          _scheduleScroll(messagesEl);
          setTimeout(step, speed);
          return;
        }

        charIdx++;
        // Show plain text during typing — renderMarkdown only runs once on commit
        liveEl.textContent = block.slice(0, charIdx);
        _scheduleScroll(messagesEl);
        setTimeout(step, speed + Math.floor(Math.random() * jitter));
      }

      step();
    } catch (e) {
      var span = wrap.querySelector('.ai-typewriter');
      if (span) {
        var html = span.getAttribute('data-html') || '';
        var raw = span.getAttribute('data-raw') || '';
        span.innerHTML = html ? wrapProse(html) : wrapProse(renderMarkdown(raw || span.getAttribute('data-full') || ''));
        if (window.motownTypesetMath) setTimeout(function () { window.motownTypesetMath(span); }, 50);
        _highlightCode(span, 0);
      }
    }
  }

  window.copyMessage = function (btn) {
    var wrap = btn.closest('.cmsg-user-wrap, .cmsg-ai-wrap, .cmsg-system-wrap');
    if (!wrap) return;
    var textEl = wrap.querySelector('.cmsg-body, .cmsg-text--ai, .cmsg-text--system, .cmsg-bubble--user');
    if (!textEl) return;
    var text = textEl.textContent || '';
    var copy = function () {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).catch(function () {});
      } else {
        var ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch (e) {}
        document.body.removeChild(ta);
      }
      btn.classList.add('copied');
      btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
      setTimeout(function () {
        btn.classList.remove('copied');
        btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>';
      }, 1500);
    };
    copy();
  };

  window.editMessage = function (btn) {
    var wrap = btn.closest('.cmsg-user-wrap');
    if (!wrap) return;
    var textEl = wrap.querySelector('.cmsg-bubble--user');
    if (!textEl) return;
    var text = textEl.textContent || '';
    var next = wrap.nextElementSibling;
    while (next && (next.classList.contains('cmsg-ai-wrap') || next.classList.contains('cmsg-system-wrap') || next.classList.contains('cmsg-thinking'))) {
      var toRemove = next;
      next = next.nextElementSibling;
      toRemove.remove();
    }
    wrap.remove();
    window._lastHistoryEdit = window._history ? window._history.length : 0;
    var input = _chatInputEl();
    if (input) { input.value = text; input.focus(); }
  };

  var _currentSuggestions = [];
  var _suggestionsEl = null;
  let busy = false;
  var _chatAbortController = null;
  window._history = [];
  window._chatContext = '';

  // Chat-render target override. While the AI Tutor tab is mounted the engine
  // renders into the tab's DOM (thread/messages/composer) instead of the side
  // pane; clearing the target (tab unmount) restores the pane's usual pipeline.
  var _chatTarget = null;
  function _chatThreadEl() { return _chatTarget ? _chatTarget.thread : document.getElementById('chatThread'); }
  function _chatMessagesEl() { return _chatTarget ? _chatTarget.messages : document.getElementById('chatMessages'); }
  function _chatInputEl() { return _chatTarget ? _chatTarget.input : document.getElementById('chatInput'); }
  function _chatSendBtnEl() { return _chatTarget ? _chatTarget.sendBtn : document.getElementById('chatSendBtn'); }

  // Image-lightbox / context-chip / click-to-scroll delegation for whichever
  // thread is live (pane at boot, the tab's thread while the tab is mounted).
  function bindThreadDelegates(thread) {
    if (!thread || thread._tvDelegates) return;
    thread._tvDelegates = true;
    thread.addEventListener('click', function (e) {
      var imgEl = e.target.closest('.chat-attached-image');
      if (imgEl) {
        var img = imgEl.querySelector('img');
        if (img && window._chatOpenImage) { window._chatOpenImage(img.src); return; }
      }
      var chip = e.target.closest('.cmsg-context-chip');
      if (chip) {
        var bubble = chip.closest('.cmsg-bubble--user');
        var ctx = bubble && bubble.dataset.context ? bubble.dataset.context : (chip.dataset.context || null);
        if (ctx && window._chatOpenContext) { window._chatOpenContext(ctx); return; }
      }
      var wrap = e.target.closest('.cmsg-user-wrap, .cmsg-ai-wrap, .cmsg-system-wrap');
      if (!wrap) return;
      var container = _chatMessagesEl();
      if (!container) return;
      var targetTop = wrap.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - 80;
      container.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
      wrap.classList.remove('cmsg-scroll-target');
      void wrap.offsetWidth;
      wrap.classList.add('cmsg-scroll-target');
    });
  }

  // The AI Tutor tab (room-tab-lazy.js) calls this on mount/unmount to point
  // the engine at the tab DOM, or back at the side-pane chat.
  window._setChatTarget = function (target) {
    _chatTarget = target || null;
    if (_chatTarget && _chatTarget.thread) bindThreadDelegates(_chatTarget.thread);
  };

  // Auto-scroll state: true = follow the bottom as content arrives.
  // Set to false the moment the user intentionally scrolls up mid-response.
  // Restored when they reach the bottom again or click the scroll button.
  var _autoScroll = true;
  var _scrollRafId = null;
  // Timestamp of the last programmatic scroll write. Used by the scroll listener
  // to avoid treating our own pin/follow writes as user gestures.
  var _lastProgrammaticScroll = 0;
  // Last scrollTop used to pin a just-sent message to the top of the thread.
  // The spacer collapses once the user scrolls past this (they've left the
  // pinned "just began" position and are reading), so the reserved room below
  // the reply doesn't linger as dead space.
  var _pinTarget = 0;

  // Streaming state: accumulated tokens and live bubble reference
  var _streamText = '';
  var _streamLiveEl = null;
  var _streamReRenderTimer = null;
  var _streamWrapper = null;  // the .cmsg-ai-wrap created during streaming
  // Number of leading \n\n-separated parts already committed as stable
  // .ai-tw-block elements during streaming. Only the tail re-renders per tick.
  var _streamCommittedCount = 0;

  // ── Streaming rendering helpers ────────────────────────────────────────
  function _finalizeStream() {
    if (_streamReRenderTimer) { clearTimeout(_streamReRenderTimer); _streamReRenderTimer = null; }
    if (_streamLiveEl) {
      // Commit the uncommitted tail (held while an open fence/math construct was
      // being streamed, plus the live partial) as the final block. Earlier parts
      // were already committed as stable .ai-tw-block elements — re-rendering the
      // whole text here would wipe them and flash raw→formatted.
      var tail = _streamText.split(/\n\n/).slice(_streamCommittedCount).join('\n\n');
      if (tail) {
        var el = document.createElement('div');
        el.className = 'ai-tw-block';
        el.innerHTML = wrapProse(renderMarkdown(tail));
        _streamLiveEl.parentNode.replaceChild(el, _streamLiveEl);
        _highlightCode(el, 0);
        if (/\$\$|\\\[|\\\(|\$[^$]/.test(tail) && window.motownTypesetMath) {
          setTimeout(function () { window.motownTypesetMath(el); }, 50);
        }
      } else if (_streamLiveEl.parentNode) {
        _streamLiveEl.parentNode.removeChild(_streamLiveEl);
      }
      _streamLiveEl = null;
    }
    _streamText = '';
    _streamCommittedCount = 0;
  }

  // True when a streamed fragment holds an unclosed construct that renderMarkdown
  // would mangle — an open code fence or an unmatched math delimiter. Such
  // fragments stay raw-escaped until the construct closes, then render normally.
  function _hasOpenConstruct(text) {
    var fences = (text.match(/```/g) || []).length;
    if (fences % 2 === 1) return true;
    var dollarBlocks = (text.match(/\$\$/g) || []).length;
    if (dollarBlocks % 2 === 1) return true;
    var openBracket = (text.match(/\\\[/g) || []).length;
    var closeBracket = (text.match(/\\\]/g) || []).length;
    if (openBracket !== closeBracket) return true;
    var openParen = (text.match(/\\\(/g) || []).length;
    var closeParen = (text.match(/\\\)/g) || []).length;
    if (openParen !== closeParen) return true;
    return false;
  }

  var _lastHljsAt = 0;
  function _highlightCode(root, throttleMs) {
    if (!root || typeof hljs === 'undefined' || !hljs.highlightElement) return;
    if (!root.querySelector('pre code')) return;
    var now = Date.now();
    if (throttleMs && now - _lastHljsAt < throttleMs) return;
    root.querySelectorAll('pre code').forEach(function (el) {
      if (!el.dataset.highlighted) {
        hljs.highlightElement(el);
      }
    });
    _lastHljsAt = now;
  }

  // Periodically re-render accumulated streaming text into the live bubble.
  // Splits on double-newlines to find block boundaries — committed blocks are
  // rendered once with renderMarkdown and stay stable; the current partial
  // block is re-rendered through renderMarkdown each tick so users always see
  // formatted markdown (never raw `**`, `#`, `$`, backticks), except while an
  // open fence/math construct is mid-stream (falls back to escaped raw text).
  function _streamRenderBlocks() {
    _streamReRenderTimer = null;
    if (!_streamLiveEl) return;

    var text = _streamText;
    var parts = text.split(/\n\n/);
    var partial = parts.pop();

    // Commit completed parts ONCE as stable blocks. Never commit a prefix that
    // still holds an open fence/math construct: split across \n\n it would
    // render as prose. Only the tail re-renders while the construct is open.
    var safeCount = 0;
    var acc = '';
    for (var i = 0; i < parts.length; i++) {
      acc += parts[i] + '\n\n';
      if (_hasOpenConstruct(acc)) break;
      safeCount = i + 1;
    }

    var messagesEl = _chatMessagesEl();
    while (_streamCommittedCount < safeCount) {
      _commitStreamBlock(parts[_streamCommittedCount]);
      _streamCommittedCount++;
      _scheduleScroll(messagesEl);
    }

    // Held prefix (inside an open construct) + live partial are the only
    // fragments rebuilt per tick — the already-committed blocks stay untouched.
    var tail = _streamCommittedCount < parts.length
      ? parts.slice(_streamCommittedCount).join('\n\n') + '\n\n'
      : '';
    var heldHtml = tail
      ? '<span class="ai-tw-streaming-partial">' + escapeHtml(tail) + '</span>'
      : '';
    var partialHtml = partial
      ? (_hasOpenConstruct(partial) ? escapeHtml(partial) : renderMarkdown(partial))
      : '';
    _streamLiveEl.innerHTML = heldHtml + partialHtml;
    _highlightCode(_streamLiveEl, 250);
    _scheduleScroll(messagesEl);
  }

  // Commit one completed streamed part as a permanent, stable .ai-tw-block.
  function _commitStreamBlock(part) {
    var el = document.createElement('div');
    el.className = 'ai-tw-block';
    el.innerHTML = wrapProse(renderMarkdown(part));
    _streamLiveEl.parentNode.insertBefore(el, _streamLiveEl);
    _highlightCode(el, 0);
    if (/\$\$|\\\[|\\\(|\$[^$]/.test(part) && window.motownTypesetMath) {
      window.motownTypesetMath(el);
    }
  }

  window.setChatContext = function (text) {
    window._chatContext = text || '';
    const bar = document.getElementById('chatContextBar');
    const txt = document.getElementById('chatContextText');
    if (!bar || !txt) return;
    if (window._chatContext) {
      txt.textContent = window._chatContext.length > 120
        ? window._chatContext.slice(0, 120) + '…'
        : window._chatContext;
      bar.style.display = 'flex';
    } else {
      bar.style.display = 'none';
    }
  };

  document.getElementById('chatContextClear')?.addEventListener('click', function () {
    window.setChatContext('');
  });

  async function _safeJson(resp) {
    try { return await resp.json(); } catch (e) { return {}; }
  }

  function _setChatSendBtnMode(sendBtn, isStop) {
    if (!sendBtn) return;
    sendBtn.classList.toggle('chat-send-btn--stop', !!isStop);
    sendBtn.setAttribute('aria-label', isStop ? 'Stop response' : 'Send message');
    sendBtn.innerHTML = isStop
      ? '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"><rect x="6" y="6" width="12" height="12" rx="3" fill="currentColor"></rect></svg>'
      : '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 7-7 7 7"></path><path d="M12 19V5"></path></svg>';
  }

  async function sendChat(forcedMessage, opts) {
    const forcedObj = typeof forcedMessage === 'object' && forcedMessage !== null;
    const isForced = typeof forcedMessage === 'string' || forcedObj;
    // The AI Tutor tab is voice-first: sendChat is called with a forced message
    // (voice / mode seeds) and has no composer, so input/sendBtn may be absent.
    // Only typed pane sends actually need the composer.
    const input = _chatInputEl();
    const sendBtn = _chatSendBtnEl();
    if (busy) return;
    if (!isForced && (!input || !sendBtn)) return;

    const context = window._chatContext || '';
    const message = forcedObj ? (forcedMessage.message || '') : (isForced ? forcedMessage : input.value.trim());
    const fullMessage = context ? '[Context]\n' + context + '\n\n' + message : message;
    if (!fullMessage) return;

    busy = true;
    _chatAbortController = new AbortController();
    _setChatSendBtnMode(sendBtn, true);
    _streamText = '';
    _streamCommittedCount = 0;
    // New turn: invalidate any still-pending suggestion render from the last one
    _suggestTurn++;
    if (_suggestTimer) { clearTimeout(_suggestTimer); _suggestTimer = null; }
    _streamLiveEl = null;
    _streamWrapper = null;
    var typing = null;
    /* Voice mode (opts.voice): streaming TTS reuses the study-guide engine
       (window.srNarrateText → POST /api/readto/speak → srSpeakChunk) per
       sentence so first audio starts <300ms after first tokens, not at result.
       Falls back to whole-reply at _voiceResult if nothing flushed. */
    var _voice = (opts && opts.voice) ? { buffer: '', timer: null, spoke: false, done: false, firstBufferMs: Date.now() } : null;

    function _voiceDribble() { if (_voice) _voiceFlush(); }
    function _voiceFlush() {
      if (!_voice) return;
      if (_voice.timer) { clearTimeout(_voice.timer); _voice.timer = null; }
      var raw = _voice.buffer.replace(/\s+$/, '');
      _voice.buffer = '';
      if (!raw || raw.length < 2) return;
      // Reuse study-guide cleaning via srNarrateText (server does _to_spoken too).
      var seg = raw.replace(/```[\s\S]*?```/g,' ').replace(/`([^`]+)`/g,'$1').replace(/\*\*([^*]+)\*\*/g,'$1').replace(/\*([^*]+)\*/g,'$1').replace(/^#{1,6}\s+/gm,'').replace(/^\s*[-*]\s+/gm,'').replace(/^\s*\d+\.\s+/gm,'').replace(/\|/g,' ').replace(/^\s*>\s?/gm,'').replace(/\s{2,}/g,' ').trim();
      if (!seg || seg.length < 2 || typeof window.srNarrateText !== 'function') return;
      var ok = false;
      try { ok = !!window.srNarrateText(seg, true); } catch (e) { console.error('[voice] srNarrateText threw in flush', e); }
      if (ok) _voice.spoke = true;
    }
    function _voiceFeed(tok) {
      if (!_voice) return;
      _voice.buffer += (tok || '');
      if (!_voice.timer) _voice.timer = setTimeout(_voiceDribble, 300);
      var trimmed = _voice.buffer.replace(/\s+$/, '');
      // Aggressive flush for 300ms target: sentence boundary at >=12 chars, or 80 chars, or 300ms dribble.
      if (trimmed.length >= 80) { _voiceFlush(); return; }
      if (/[.!?。！？]\s*$/.test(_voice.buffer) && trimmed.length >= 12) _voiceFlush();
      // Hard 300ms guarantee: if we've buffered >300ms since first token, force flush mid-sentence.
      if (Date.now() - _voice.firstBufferMs > 300 && trimmed.length >= 8) { _voiceFlush(); _voice.firstBufferMs = Date.now(); }
    }

    /* Mark the exchange finished — abort path (errors/quota/session). */
    function _voiceEndEarly() {
      if (!_voice || _voice.done) return;
      _voice.done = true;
      if (typeof window.srVoiceAbort === 'function') window.srVoiceAbort();
      else if (typeof window.srVoiceEnded === 'function') window.srVoiceEnded();
    }

    /* Render the completed user→AI pair into the pane (called at result for
       unspoken replies, or on sr:narration-end once the audible reply wraps). */
    function _renderVoicePair(reply, replyHtml, imgPreviews) {
      if (!_voice || _voice.done) return;
      _voice.done = true;
      appendBubble('user', message, false, null, context, imgPreviews, _capturedDocs, true);
      appendBubble('ai', reply, false, replyHtml);
      var messages = _chatMessagesEl();
      if (messages && isChatNearBottom(messages, 80)) {
        _autoScroll = true;
        _scheduleScroll(messages);
      }
      if (typeof window.srVoiceEnded === 'function') window.srVoiceEnded();
    }

    function _voiceResult(data) {
      _finalizeStream();
      clearThinkingBubble(typing);

      if (data.credit_balance !== undefined && typeof updateCreditsBar === 'function') {
        updateCreditsBar(data.credit_balance);
      }

      var reply = (data.reply || data.answer || data.response || data.error || 'No response received.').trim();
      var replyHtml = data.reply_html || null;
      var action = data.action || data.tool?.name || null;
      var payload = data.payload || data.tool?.payload || null;

      if (action) window.renderToolResult(action, payload);

      // Quota wall — surface it in the pane + orb, then end the exchange.
      if ((data.error === 'quota') || (data.error === 'gemini_quota_exceeded')) {
        var quotaThread = _chatThreadEl();
        var resetsInSeconds = parseInt(data.resets_in_seconds, 10);
        var resetLabel = (!isNaN(resetsInSeconds) && resetsInSeconds >= 0)
          ? 'resets in ' + _fmtQuotaTime(resetsInSeconds)
          : 'or come back tomorrow';
        if (quotaThread) {
          var qWrap = document.createElement('div');
          qWrap.className = 'cmsg-system-wrap';
          var qText = (data.error === 'gemini_quota_exceeded')
            ? (data.reply || 'The AI is temporarily unavailable — please try again in a moment.')
            : 'You\'ve used all your AI chat messages for today.';
          qWrap.innerHTML =
            '<div class="cmsg-quota-bubble">' +
              '<svg class="cmsg-quota-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' +
              '<span class="cmsg-quota-text">' + qText + '</span>' +
              '<span class="cmsg-quota-sub">' + resetLabel + '</span>' +
            '</div>';
          quotaThread.appendChild(qWrap);
          _scheduleScroll(_chatMessagesEl());
        }
        if (window.maybeShowCreditsExhausted && window.maybeShowCreditsExhausted(data, 'AI chat messages')) {
          _voiceEndEarly();
          return;
        }
        if (typeof window.showQuotaModal === 'function') {
          var qdd = data.quota || {};
          window.showQuotaModal({
            resource: data.error === 'gemini_quota_exceeded' ? 'AI chat' : 'AI chat messages',
            used: qdd.used,
            limit: qdd.limit,
            resetsInSeconds: data.resets_in_seconds,
            tier: data.tier,
          });
        }
        _voiceEndEarly();
        return;
      }

      var userEntry = { role: 'user', content: fullMessage };
      if (_sentImages && _sentImages.length) userEntry.images = _sentImages;
      window._history.push(userEntry, { role: 'assistant', content: reply });

      _scheduleSuggestions(reply, _suggestTurn);

      // Streamed per-sentence via srNarrateText (same engine as guide) for <300ms first audio.
      // Flush any tail that didn't hit a sentence boundary; if nothing ever spoke (short reply), speak whole reply.
      if (_voice) {
        if (_voice.buffer && _voice.buffer.trim()) { try { _voiceFlush(); } catch (e) {} }
        if (!_voice.spoke && typeof window.srNarrateText === 'function') {
          try { _voice.spoke = !!window.srNarrateText(reply, true); } catch (e) { _voice.spoke = false; console.error('[voice] srNarrateText threw for full reply', e); }
        }
      }

      if (_voice && _voice.spoke) {
        // Defer the pane pair until the audible reply finishes.
        var flushed = false;
        function flushNow() {
          if (flushed) return;
          flushed = true;
          _renderVoicePair(reply, replyHtml, _imgPreviews);
        }
        /* The tail flush just above is still synthesizing its TTS chunk — wait
           a beat for it to enqueue (which sets srNarrationState().active) before
           deciding to tail the narration or flush immediately. */
        setTimeout(function () {
          var ns = (typeof window.srNarrationState === 'function') ? window.srNarrationState() : null;
          if (ns && ns.active) {
            document.addEventListener('sr:narration-end', flushNow);
            setTimeout(flushNow, 30000);   /* safety net so the pair always lands */
          } else {
            flushNow();
          }
        }, 700);
      } else {
        _renderVoicePair(reply, replyHtml, _imgPreviews);
      }
    }
    try {
      if (!isForced) {
        input.value = '';
        input.style.height = 'auto';
        input.disabled = true;
        sendBtn.classList.add('is-disabled');
      }

      // User is sending — disable bottom-follow BEFORE the thinking bubble so it
      // can't jump to the thread bottom; the view pins to the sent message below
      // the header and never auto-scrolls (scroll-to-bottom button is the escape).
      _autoScroll = false;

      // Capture image & doc data BEFORE clearing the preview bar
      var _capturedImages = window._chatAttachedImages ? window._chatAttachedImages.slice() : [];
      var _capturedDocs = window._chatAttachedDocs ? window._chatAttachedDocs.slice() : [];
      var _imgPreviews = _capturedImages.length
        ? _capturedImages.map(function(i) { return i.dataUrl; })
        : null;

      if (_voice) {
        // Voice mode: keep the pane quiet during the exchange — the cluster of
        // history/attachments is flushed with the finished pair on result.
        if (context) window.setChatContext('');
        _clearAttachedImage();
        window._clearAttachedDoc();
      } else {
        var _userWrap = appendBubble('user', message, false, null, context, _imgPreviews, _capturedDocs, true);
        if (context) window.setChatContext('');
        // Clear attachments immediately once they've appeared in the bubble
        _clearAttachedImage();
        window._clearAttachedDoc();
        var _initialStage = _capturedImages.length ? 'processing' : 'thinking';
        typing = showThinkingBubble(_initialStage);
        // Pin the user's message near the top so the reply flows into view below it.
        _makeRoomForPin(_chatMessagesEl(), _userWrap, 14);
        _pinUserMessageTop(_chatMessagesEl(), _userWrap, 14);
      }

      const explicitToolHint = (typeof forcedMessage === 'object' && forcedMessage) ? (forcedMessage.tool_hint || forcedMessage.toolHint) : null;
      const toolHint = explicitToolHint || (opts && opts.tool_hint) || inferToolRequest(fullMessage);

      var _sendThread = _chatThreadEl();
      var oldSugs = _sendThread ? _sendThread.querySelector('.chat-inline-suggestions') : null;
      if (oldSugs) oldSugs.remove();
      const notesEditor = getNotesEditor();
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        signal: _chatAbortController.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': CSRF,
        },
        body: JSON.stringify({
          message: fullMessage,
          history: window._history,
          video_id: VIDEO_ACTIVE ? VIDEO_ID : null,
          pack_id: PACK_ID,
          group_index: window.CURRENT_GROUP_INDEX,
          tool_hint: toolHint,
          voice: _voice ? 1 : undefined,
          mode: (opts && opts.mode) || (forcedObj ? (forcedMessage.mode || '') : '') || '',
          notes_content: notesEditor ? notesEditor.innerHTML : '',
          images: _capturedImages.length
            ? _capturedImages.map(function(i) { return { data: i.dataUrl.split(',')[1], mime: i.mime }; })
            : undefined,
          images_thumb: _capturedImages.length ? _imgPreviews : undefined,
          documents: _capturedDocs.length
            ? _capturedDocs.map(function(d) { return { data: d.dataUrl.split(',')[1], mime: d.mime, name: d.name }; })
            : undefined,
        }),
      });
      var _sentImages = _imgPreviews;

      // ── Response handler (shared between streaming, SSE, and JSON paths) ──
      function handleResult(data) {
        // Finalize any in-progress streaming content
        _finalizeStream();
        clearThinkingBubble(typing);

        if (data.credit_balance !== undefined && typeof updateCreditsBar === 'function') {
          updateCreditsBar(data.credit_balance);
        }

        var reply = (data.reply || data.answer || data.response || data.error || 'No response received.').trim();
        var replyHtml = data.reply_html || null;
        var action = data.action || data.tool?.name || null;
        var payload = data.payload || data.tool?.payload || null;

        if (action) {
          window.renderToolResult(action, payload);
        }

        // Quota wall — covers both the daily user limit (error='quota') and
        // the AI provider hitting its own rate-limit/quota (error='gemini_quota_exceeded').
        var _isQuotaErr = (data.error === 'quota') || (data.error === 'gemini_quota_exceeded');
        if (_isQuotaErr) {
          var quotaThread = _chatThreadEl();
          var resetsInSeconds = parseInt(data.resets_in_seconds, 10);
          var resetLabel = (!isNaN(resetsInSeconds) && resetsInSeconds >= 0)
            ? 'resets in ' + _fmtQuotaTime(resetsInSeconds)
            : 'or come back tomorrow';
          if (quotaThread) {
            var qWrap = document.createElement('div');
            qWrap.className = 'cmsg-system-wrap';
            var qText = (data.error === 'gemini_quota_exceeded')
              ? (data.reply || 'The AI is temporarily unavailable — please try again in a moment.')
              : 'You\'ve used all your AI chat messages for today.';
            qWrap.innerHTML =
              '<div class="cmsg-quota-bubble">' +
                '<svg class="cmsg-quota-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' +
                '<span class="cmsg-quota-text">' + qText + '</span>' +
                '<span class="cmsg-quota-sub">' + resetLabel + '</span>' +
              '</div>';
            quotaThread.appendChild(qWrap);
            var qMsg = _chatMessagesEl();
            _scheduleScroll(qMsg);
          }
if (window.maybeShowCreditsExhausted && window.maybeShowCreditsExhausted(data, 'AI chat messages')) {
          _streamWrapper = null;
          return;
        }
        if (typeof window.showQuotaModal === 'function') {
          var qd = data.quota || {};
          window.showQuotaModal({
            resource: data.error === 'gemini_quota_exceeded' ? 'AI chat' : 'AI chat messages',
            used: qd.used,
            limit: qd.limit,
            resetsInSeconds: data.resets_in_seconds, tier: data.tier,
          });
        }
        _streamWrapper = null;
        return;
        }

        // Streaming bubble already holds the fully-rendered reply — `_finalizeStream()`
        // committed the final partial through renderMarkdown. Don't wipe and re-render
        // it (that flashes raw→formatted and re-runs MathJax). Only rebuild when the
        // server supplied authoritative reply_html, or when no tokens ever arrived.
        if (_streamWrapper && _streamWrapper.parentNode) {
          var textEl = _streamWrapper.querySelector('.cmsg-text--ai');
          var hasCommitted = textEl && textEl.querySelector('.ai-tw-block');
          if (textEl && (!hasCommitted || replyHtml)) {
            var finalHtml = replyHtml ? wrapProse(cleanAIHtml(replyHtml)) : wrapProse(renderMarkdown(reply));
            textEl.innerHTML = '<div class="ai-tw-block">' + finalHtml + '</div>';
            if (window.motownTypesetMath) {
              setTimeout(function () { window.motownTypesetMath(textEl); }, 50);
            }
            _highlightCode(textEl, 0);
          }
          _streamWrapper = null;
        } else {
          // Non-streaming path: create a new bubble
          appendBubble('ai', reply, false, replyHtml);
        }

        var userEntry = { role: 'user', content: fullMessage };
        if (_sentImages && _sentImages.length) userEntry.images = _sentImages;
        window._history.push(
          userEntry,
          { role: 'assistant', content: reply }
        );

        _scheduleSuggestions(reply, _suggestTurn);

        // Narrate substantive replies in the narrator's voice while a Read-to-Me
        // narration session is running (see readto-fab.js srNarrateText). Gated on
        // a present mini bar, a non-tool reply, and a real sentence worth reading.
        if (!action && reply.length >= 40 &&
            typeof window.srNarrationActive === 'function' && window.srNarrationActive() &&
            typeof window.srNarrateText === 'function') {
          window.srNarrateText(reply);
        }
      }

      // ── Read response: SSE streaming or JSON ──
      if (response.status === 400 || response.status === 403) {
        clearThinkingBubble(typing);
        var _sessionExpiredMsg =
          'Your session has expired. ' +
          '<a href="javascript:location.reload()" style="color:inherit;text-decoration:underline;">Refresh the page</a> to continue chatting.';
        appendBubble('system', _sessionExpiredMsg, false, _sessionExpiredMsg);
        _voiceEndEarly();
        busy = false;
        _chatAbortController = null;
        _setChatSendBtnMode(sendBtn, false);
        if (!isForced) {
          input.disabled = false;
          sendBtn.classList.remove('is-disabled');
          requestAnimationFrame(() => input.focus());
        }
        return;
      }
      var contentType = response.headers.get('Content-Type') || '';
      if (contentType.includes('text/event-stream')) {
        var reader = response.body.getReader();
        var decoder = new TextDecoder();
        var buffer = '';
        while (true) {
          var _r = await reader.read();
          if (_r.done) break;
          buffer += decoder.decode(_r.value, { stream: true });
          var parts = buffer.split('\n\n');
          buffer = parts.pop() || '';
          for (var _p = 0; _p < parts.length; _p++) {
            var line = parts[_p].trim();
            if (!line || !line.startsWith('data: ')) continue;
            try {
              var evt = JSON.parse(line.slice(6));
              if (evt.type === 'progress') {
                updateThinkingStage(typing, evt.stage);
              } else if (evt.type === 'token') {
                // ── Streaming: accumulate token ──
                _streamText += (evt.token || '');
                if (_voice) {
                  _voiceFeed(evt.token || '');
                } else if (!_streamLiveEl) {
                  // First token — create the AI bubble with a live streaming element
                  _finalizeStream();  // clear any stale state
                  clearThinkingBubble(typing);
                  var _thread = _chatThreadEl();
                  var _wrap = document.createElement('div');
                  _wrap.className = 'cmsg-ai-wrap';
                  _wrap.setAttribute('_dash', ++_dashSeq);
                  _wrap.innerHTML =
                    '<div class="cmsg-text cmsg-text--ai"><div class="ai-typewriter"><span class="ai-tw-live"></span></div></div>' +
                    '<div class="cmsg-actions">' +
                      '<button class="cmsg-action-btn" aria-label="Copy" onclick="window.copyMessage(this)">' +
                        '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>' +
                      '</button>' +
                    '</div>';
                  _thread.appendChild(_wrap);
                  _streamLiveEl = _wrap.querySelector('.ai-tw-live');
                  _streamWrapper = _wrap;
                }
                // Throttle re-renders to one per 60ms
                if (!_voice && !_streamReRenderTimer) {
                  _streamReRenderTimer = setTimeout(_streamRenderBlocks, 60);
                }
              } else if (evt.type === 'result') {
                if (_voice) _voiceResult(evt);
                else handleResult(evt);
              }
            } catch(e) {}
          }
        }
        // Stream ended without a result event (edge case) — try the same
        // whole-reply narration the guide uses, then land the pair.
        if (_voice) {
          if (_voice.buffer && _voice.buffer.trim()) { try { _voiceFlush(); } catch (e) {} }
          if (!_voice.spoke && _streamText && typeof window.srNarrateText === 'function') {
            try { _voice.spoke = !!window.srNarrateText(_streamText, true); } catch (e) { console.error('[voice] srNarrateText threw for stream tail', e); }
          }
          if (!_voice.done) {
            if (_voice.spoke) {
              var _edgeFlushed = false;
              function _edgeFlushNow() { if (_edgeFlushed) return; _edgeFlushed = true; _renderVoicePair(_streamText || 'No response received.', null, _imgPreviews); }
              setTimeout(function () {
                var _ens = (typeof window.srNarrationState === 'function') ? window.srNarrationState() : null;
                if (_ens && _ens.active) { document.addEventListener('sr:narration-end', _edgeFlushNow); setTimeout(_edgeFlushNow, 30000); } else { _edgeFlushNow(); }
              }, 700);
            } else {
              _renderVoicePair(_streamText || 'No response received.', null, _imgPreviews);
            }
          }
        } else if (_streamLiveEl && _streamText) {
          _finalizeStream();
        }
      } else {
        var data = await _safeJson(response);
        if (_voice) _voiceResult(data); else handleResult(data);
      }
    } catch (error) {
      _finalizeStream();
      clearThinkingBubble(typing);
      _voiceEndEarly();
      if (error?.name !== 'AbortError') {
        appendBubble('system', error?.message || 'Could not reach the AI tutor right now. Please try again.');
      }
    } finally {
      busy = false;
      _chatAbortController = null;
      _setChatSendBtnMode(sendBtn, false);
      if (!isForced) {
        input.disabled = false;
        sendBtn.classList.remove('is-disabled');
        requestAnimationFrame(() => input.focus());
      }
    }
  }
  window.sendChat = sendChat;
  // Exposed for the AI Tutor tab's ask-stream path (room-tab-lazy), which
  // renders its user→AI pairs into the tab's transcript directly instead of
  // going through sendChat's voice narration.
  window.appendBubble = appendBubble;
  window.chatIsBusy = function () { return busy; };
  window.chatAbort = function () { if (_chatAbortController) _chatAbortController.abort(); };

  window._renderImgPreview = function() {
    var container = document.getElementById('chatImgPreviewItems');
    var pv = document.getElementById('chatImgPreview');
    if (!container || !pv) return;
    container.innerHTML = '';
    var hasImgs = window._chatAttachedImages && window._chatAttachedImages.length > 0;
    var hasDocs = window._chatAttachedDocs && window._chatAttachedDocs.length > 0;
    if (!hasImgs && !hasDocs) {
      pv.style.display = 'none';
      return;
    }
    pv.style.display = 'inline-flex';
    if (hasImgs) {
      window._chatAttachedImages.forEach(function(item, idx) {
        var div = document.createElement('div');
        div.className = 'chat-img-preview-item';
        div.innerHTML =
          '<img src="' + item.dataUrl + '" alt="' + item.name + '">' +
          '<span class="chat-img-item-name">' + item.name + '</span>' +
          '<button type="button" class="chat-img-item-remove" data-type="img" data-idx="' + idx + '">&times;</button>';
        div.querySelector('.chat-img-item-remove').addEventListener('click', function(e) {
          e.stopPropagation();
          window._clearAttachedImage(Number(this.getAttribute('data-idx')));
        });
        container.appendChild(div);
      });
    }
    if (hasDocs) {
      window._chatAttachedDocs.forEach(function(item, idx) {
        var div = document.createElement('div');
        div.className = 'chat-doc-preview-item';
        var ext = (item.name.split('.').pop() || '').toUpperCase();
        var sizeKb = item.size ? Math.round(item.size / 1024) : 0;
        var sizeLabel = sizeKb > 1024 ? (sizeKb / 1024).toFixed(1) + ' MB' : sizeKb + ' KB';
        div.innerHTML =
          '<svg class="chat-doc-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' +
          '<span class="chat-doc-preview-name">' + item.name + '</span>' +
          '<span class="chat-doc-preview-size">' + sizeLabel + '</span>' +
          '<button type="button" class="chat-doc-preview-remove" data-type="doc" data-idx="' + idx + '">&times;</button>';
        div.querySelector('.chat-doc-preview-remove').addEventListener('click', function(e) {
          e.stopPropagation();
          window._clearAttachedDoc(Number(this.getAttribute('data-idx')));
        });
        container.appendChild(div);
      });
    }
  };

  window._clearAttachedImage = function(index) {
    if (typeof index === 'number') {
      if (window._chatAttachedImages && window._chatAttachedImages.length > index) {
        window._chatAttachedImages.splice(index, 1);
      }
      window._renderImgPreview();
      return;
    }
    window._chatAttachedImages = [];
    var _imgInput = document.getElementById('chatImageInput');
    if (_imgInput) _imgInput.value = '';
    window._renderImgPreview();
  };

  window._chatSendTool = function(action, defaultMessage) {
    var msg = defaultMessage || 'generate ' + action.replace('generate_', '');
    var csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
    fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
      body: JSON.stringify({
        message: msg,
        history: window._history || [],
        video_id: typeof VIDEO_ID !== 'undefined' ? VIDEO_ID : null,
        pack_id: typeof PACK_ID !== 'undefined' ? PACK_ID : null,
        group_index: 0,
        tool_hint: action,
      }),
    })
    .then(function(response) {
      var ct = response.headers.get('Content-Type') || '';
      if (ct.includes('text/event-stream')) {
        // SSE: read stream, find the result event
        var reader = response.body.getReader();
        var decoder = new TextDecoder();
        var buffer = '';
        return (function readLoop() {
          return reader.read().then(function(_r) {
            if (_r.done) return null;
            buffer += decoder.decode(_r.value, { stream: true });
            var parts = buffer.split('\n\n');
            buffer = parts.pop() || '';
            for (var i = 0; i < parts.length; i++) {
              var line = parts[i].trim();
              if (!line || !line.startsWith('data: ')) continue;
              try {
                var evt = JSON.parse(line.slice(6));
                if (evt.type === 'result') return evt;
              } catch(e) {}
            }
            return readLoop();
          });
        })();
      }
      // JSON fallback
      return response.json();
    })
    .then(function(data) {
      if (!data) return;
      var act = data.action || data.tool?.name || null;
      var payload = data.payload || data.tool?.payload || null;
      if (act && typeof window.renderToolResult === 'function') {
        window.renderToolResult(act, payload);
      }
    })
    .catch(function() {
      if (typeof window.showFatalErrorModal === 'function') {
        window.showFatalErrorModal('Something went wrong processing your request. Please try again.');
      }
    });
  };

  document.addEventListener('DOMContentLoaded', () => {
    const input = _chatInputEl();
    const sendBtn = _chatSendBtnEl();
    if (!input || !sendBtn) return;

    loadNotesDraft();
    const editor = getNotesEditor();
    editor?.addEventListener('input', persistNotesDraft);

    // Set contextual greeting in the empty state (no system bubble)
    var _emptyHeadline = document.getElementById('chatEmptyHeadline');
    if (_emptyHeadline) {
      var _topic = (UPLOAD_TITLE || (VIDEO_ACTIVE && VIDEO_TITLE) || '').trim();
      if (_topic) {
        var _short = _topic.length > 32 ? _topic.slice(0, 30).trimEnd() + '…' : _topic;
        _emptyHeadline.textContent = 'Ready to help with ' + _short;
      }
    }

    // Load server-persisted chat history for this session
    (async function loadChatHistory() {
      try {
        const res = await fetch('/api/ai/chat/history?pack_id=' + encodeURIComponent(PACK_ID || ''), { credentials: 'same-origin' });
        if (!res.ok) return;
        const data = await _safeJson(res);
        const hist = Array.isArray(data.history) ? data.history : [];
        // render each saved message
        for (const msg of hist) {
          if (!msg || !msg.role) continue;
          const role = msg.role === 'user' ? 'user' : (msg.role === 'assistant' ? 'ai' : 'system');
          // render history instantly (no typewriter)
          appendBubble(role, msg.content || '', true, null, null, msg.images || (msg.image ? [msg.image] : null));
        }
        // populate client-side history with last messages for use in prompts
        window._history.length = 0;
        var last = hist.slice(-12).map(function (m) {
          var e = { role: m.role, content: m.content };
          if (m.images) e.images = m.images;
          else if (m.image) e.images = [m.image];
          return e;
        });
        window._history.push.apply(window._history, last);

        // render suggestions based on the last assistant message
        var lastAsst = null;
        for (var j = hist.length - 1; j >= 0; j--) {
          if (hist[j] && hist[j].role === 'assistant') { lastAsst = hist[j].content; break; }
        }
        if (lastAsst) {
          _scheduleSuggestions(lastAsst, _suggestTurn, 600);
        }
      } catch (e) {
        /* ignore load errors */
      }
    })();

    // Auto-resize textarea up to the CSS cap (--chat-input-max), then scroll
    function autoResize() {
      input.style.height = 'auto';
      // Force a synchronous reflow before reading scrollHeight — on iOS
      // Safari a stale layout can otherwise yield a wrong inline height on
      // first paint and deform the composer pill.
      void input.offsetHeight;
      var sh = input.scrollHeight;
      var cap = parseInt(getComputedStyle(input).getPropertyValue('--chat-input-max'), 10);
      if (!isFinite(cap) || cap <= 0) cap = 200;
      input.style.height = Math.min(sh, cap) + 'px';
      sendBtn.classList.toggle('is-disabled', input.value.trim().length === 0);
      var wrap = input.closest('.chat-input-wrap');
      if (wrap) {
        var minH = parseFloat(getComputedStyle(input).minHeight) || 44;
        var contentH = Math.max(sh, minH);
        wrap.classList.toggle('chat-input-wrap--grown', contentH > 52);
        wrap.classList.toggle('chat-input-wrap--grown-lg', contentH > 110);
      }
    }
    input.addEventListener('input', autoResize);
    autoResize();

    sendBtn.addEventListener('click', function () {
      if (busy) {
        _chatAbortController?.abort();
        return;
      }
      sendChat();
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChat();
      }
    });

    // ── Tool toolbar: explicit action buttons ──────────────────────
    var toolBar = document.getElementById('chatToolBar');
    if (toolBar) {
      toolBar.addEventListener('click', function(e) {
        var btn = e.target.closest('.chat-tool-btn');
        if (!btn || busy) return;
        var tool = btn.getAttribute('data-tool');
        if (!tool) return;
        var toolMsgs = {
          'append_notes': 'Generate notes from what we discussed',
          'append_flashcards': 'Create flashcards from this material',
          'generate_fill_in': 'Make fill-in-the-blank exercises',
          'generate_quiz': 'Quiz me on this material',
        };
        var msg = toolMsgs[tool] || 'Help me with this';
        sendChat(msg, { tool_hint: tool });
      });
    }

    // ── Paste: attach images from clipboard ────────────────────────
    input.addEventListener('paste', function(e) {
      var items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      var imgFiles = [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].kind === 'file' && items[i].type.startsWith('image/')) {
          var f = items[i].getAsFile();
          if (f) imgFiles.push(f);
        }
      }
      if (imgFiles.length) {
        e.preventDefault();
        window._chatImgReadFiles(imgFiles);
      }
    });

    // ── Attachment menu toggle ──────────────────────────────────────
    (function() {
      var attachBtn = document.getElementById('chatAttachBtn');
      var attachMenu = document.getElementById('chatAttachMenu');
      if (attachBtn && attachMenu) {
        attachBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          attachMenu.classList.toggle('open');
        });
        // Close on outside click
        document.addEventListener('click', function (e) {
          if (!attachMenu.contains(e.target) && !attachBtn.contains(e.target)) {
            attachMenu.classList.remove('open');
          }
        });
        // Close menu when an option is clicked
        attachMenu.querySelectorAll('.chat-attach-menu-item').forEach(function (item) {
          item.addEventListener('click', function () {
            attachMenu.classList.remove('open');
          });
        });
      }
    })();

    // ── Image attach ──────────────────────────────────────────────
    window._chatAttachedImages = [];
    (function() {
      var ib = document.getElementById('chatImgBtn');
      var ii = document.getElementById('chatImageInput');
      var is_ = document.getElementById('chatImgStatus');
      var pendingFiles = [];
      function _readNext() {
        if (pendingFiles.length === 0) {
          window._renderImgPreview();
          if (is_) is_.textContent = '';
          input.focus();
          return;
        }
        var file = pendingFiles.shift();
        if (file.size > 10 * 1024 * 1024) {
          if (is_) is_.textContent = '"' + file.name + '" too large (max 10 MB) — skipped';
          _readNext();
          return;
        }
        if (!file.type.startsWith('image/')) {
          if (is_) is_.textContent = '"' + file.name + '" is not an image — skipped';
          _readNext();
          return;
        }
        var reader = new FileReader();
        reader.onload = function (ev) {
          window._chatAttachedImages.push({
            dataUrl: ev.target.result,
            mime: file.type,
            name: file.name,
          });
          _readNext();
        };
        reader.readAsDataURL(file);
      }
      if (ib && ii) {
        ib.addEventListener('click', function () { ii.click(); });
        ii.addEventListener('change', function (e) {
          var files = e.target.files;
          if (!files || files.length === 0) return;
          pendingFiles = Array.prototype.slice.call(files);
          _readNext();
        });
      }
      // Expose for drop handler
      window._chatImgReadFiles = function(files) { pendingFiles = files; _readNext(); };
    })();

    // ── Document attach ────────────────────────────────────────────
    window._chatAttachedDocs = [];
    var _ALLOWED_DOC_TYPES = {
      'application/pdf': true,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': true,
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': true,
      'application/msword': true,
      'application/vnd.ms-powerpoint': true,
    };
    var _ALLOWED_DOC_EXTS = ['.pdf', '.docx', '.pptx', '.doc', '.ppt'];
    function _isAllowedDoc(file) {
      if (_ALLOWED_DOC_TYPES[file.type]) return true;
      var lower = (file.name || '').toLowerCase();
      return _ALLOWED_DOC_EXTS.some(function(ext) { return lower.endsWith(ext); });
    }
    function _readNextDoc() {
      if (_pendingDocFiles.length === 0) {
        window._renderImgPreview();
        var is_ = document.getElementById('chatImgStatus');
        if (is_) is_.textContent = '';
        input.focus();
        return;
      }
      var file = _pendingDocFiles.shift();
      if (file.size > 10 * 1024 * 1024) {
        var is_ = document.getElementById('chatImgStatus');
        if (is_) is_.textContent = '"' + file.name + '" too large (max 10 MB) — skipped';
        _readNextDoc();
        return;
      }
      if (!_isAllowedDoc(file)) {
        var is_ = document.getElementById('chatImgStatus');
        if (is_) is_.textContent = '"' + file.name + '" is not a supported file type — skipped';
        _readNextDoc();
        return;
      }
      var reader = new FileReader();
      reader.onload = function (ev) {
        window._chatAttachedDocs.push({
          dataUrl: ev.target.result,
          mime: file.type || 'application/octet-stream',
          name: file.name,
          size: file.size,
        });
        _readNextDoc();
      };
      reader.readAsDataURL(file);
    }
    var _pendingDocFiles = [];
    window._clearAttachedDoc = function(index) {
      if (typeof index === 'number' && window._chatAttachedDocs.length > index) {
        window._chatAttachedDocs.splice(index, 1);
      } else {
        window._chatAttachedDocs.length = 0;
        var di = document.getElementById('chatDocInput');
        if (di) di.value = '';
      }
      window._renderImgPreview();
    };
    (function() {
      var db = document.getElementById('chatDocBtn');
      var di = document.getElementById('chatDocInput');
      if (db && di) {
        db.addEventListener('click', function () { di.click(); });
        di.addEventListener('change', function (e) {
          var files = e.target.files;
          if (!files || files.length === 0) return;
          _pendingDocFiles = Array.prototype.slice.call(files);
          _readNextDoc();
          di.value = '';
        });
      }
    })();

    // ── Drag-and-drop on the chat footer ───────────────────────────
    (function() {
      var footer = document.getElementById('aiFooter');
      var overlay = document.getElementById('chatDropOverlay');
      if (!footer) return;
      var _dragCounter = 0;
      var _hideOverlayTimer = null;
      function _showOverlay() {
        footer.classList.add('chat-drop-active');
        if (_hideOverlayTimer) { clearTimeout(_hideOverlayTimer); _hideOverlayTimer = null; }
      }
      function _hideOverlay() {
        footer.classList.remove('chat-drop-active');
      }
      footer.addEventListener('dragenter', function(e) {
        e.preventDefault();
        e.stopPropagation();
        _dragCounter++;
        _showOverlay();
      });
      footer.addEventListener('dragover', function(e) {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
      });
      footer.addEventListener('dragleave', function(e) {
        e.preventDefault();
        e.stopPropagation();
        _dragCounter--;
        if (_dragCounter <= 0) { _dragCounter = 0; _hideOverlay(); }
      });
      footer.addEventListener('drop', function(e) {
        e.preventDefault();
        e.stopPropagation();
        _dragCounter = 0;
        _hideOverlay();
        var files = e.dataTransfer && e.dataTransfer.files;
        if (files && files.length > 0) {
          var imgFiles = [];
          var docFiles = [];
          for (var i = 0; i < files.length; i++) {
            var f = files[i];
            if (f.type.startsWith('image/')) {
              imgFiles.push(f);
            } else if (_isAllowedDoc(f)) {
              docFiles.push(f);
            } else {
              var is_ = document.getElementById('chatImgStatus');
              if (is_) is_.textContent = '"' + f.name + '" is not a supported file type — skipped';
            }
          }
          if (imgFiles.length) {
            window._chatImgReadFiles(imgFiles);
          }
          if (docFiles.length) {
            _pendingDocFiles = docFiles;
            _readNextDoc();
          }
          return;
        }
        // No files — check for dropped text → attach as context
        var droppedText = e.dataTransfer.getData('text/plain');
        if (droppedText && typeof window.setChatContext === 'function') {
          window.setChatContext(droppedText);
          var chatInput = _chatInputEl();
          if (chatInput) { chatInput.value = ''; chatInput.focus(); }
        }
      });
    })();

    // ── Clear chat (topbar options menu + mobile chat pane kebab menu) ─
    function _clearChatSession() {
      if (!confirm('Reset the conversation? This will clear all messages.')) return;
      var thread = _chatThreadEl();
      if (thread) {
        thread.innerHTML = '';
        thread.style.paddingBottom = '0px';
      }
      window._history.length = 0;
      var _ci = _chatInputEl();
      var _cs = _chatSendBtnEl();
      if (_ci) { _ci.value = ''; _ci.style.height = 'auto'; }
      if (_cs) _cs.classList.add('is-disabled');
      if (window._clearAttachedImage) window._clearAttachedImage();
      if (window._clearAttachedDoc) window._clearAttachedDoc();
      // Kill any in-flight stream so it can't finish into the cleared thread.
      if (_chatAbortController) { _chatAbortController.abort(); _chatAbortController = null; }
      if (_streamReRenderTimer) { clearTimeout(_streamReRenderTimer); _streamReRenderTimer = null; }
      _streamText = '';
      _streamLiveEl = null;
      _streamWrapper = null;
      _streamCommittedCount = 0;
      // No stale suggestion pills may survive into the fresh conversation.
      if (_suggestTimer) { clearTimeout(_suggestTimer); _suggestTimer = null; }
      _suggestTurn++;
      // Return to the initial greeting state — re-show the empty-state hero.
      var emptyState = document.getElementById('chatEmptyState');
      if (emptyState) emptyState.style.display = '';
      var messagesEl = _chatMessagesEl();
      if (messagesEl) { messagesEl.scrollTop = 0; }
      _autoScroll = true;
      _updateChatScrollBtn();
      input.focus();
    }

    var srClearChatBtn = document.getElementById('srClearChatMenuBtn');
    if (srClearChatBtn) srClearChatBtn.addEventListener('click', function () {
      _clearChatSession();
      if (window._srCloseOptionsMenu) window._srCloseOptionsMenu();
    });

    var srMobileClearChatBtn = document.getElementById('srMobileClearChatMenuBtn');
    if (srMobileClearChatBtn) srMobileClearChatBtn.addEventListener('click', function () {
      _clearChatSession();
      if (window._srCloseMobileChatMenu) window._srCloseMobileChatMenu();
    });

    // ── Jump-to-newest-AI-response button ──────────────────────────
    var chatScrollBtn = document.getElementById('chatScrollBtn');
    var chatMessagesEl = _chatMessagesEl();
    if (chatScrollBtn && chatMessagesEl) {
      var _scrollBtnRaf = null;
      chatMessagesEl.addEventListener('scroll', function () {
        // Ignore our own programmatic scrolls (pin-to-top on send, bottom-follow
        // while streaming) so they don't flip _autoScroll off mid-response.
        if (Date.now() - _lastProgrammaticScroll < 120) return;
        // Update intent flag immediately — no DOM write, just a comparison.
        _autoScroll = isChatNearBottom(chatMessagesEl, 80);
        // Throttle the expensive button-visibility update to one DOM read per frame.
        if (_scrollBtnRaf) return;
        _scrollBtnRaf = requestAnimationFrame(function () {
          _scrollBtnRaf = null;
          _collapseThreadSpacer();
          _updateChatScrollBtn();
        });
      }, { passive: true });

      chatScrollBtn.addEventListener('click', function () {
        _autoScroll = true;
        var start   = chatMessagesEl.scrollTop;
        var end     = chatMessagesEl.scrollHeight - chatMessagesEl.clientHeight;
        if (end <= start) return;
        // Instant jump when the user prefers reduced motion.
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          _lastProgrammaticScroll = Date.now();
          chatMessagesEl.scrollTop = end;
          _updateChatScrollBtn();
          return;
        }
        var duration = Math.max(280, Math.min(560, (end - start) * 0.35));
        var t0 = null;
        function easeInOutCubic(t) {
          return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        }
        function step(now) {
          if (t0 === null) t0 = now;
          var p = Math.min((now - t0) / duration, 1);
          _lastProgrammaticScroll = Date.now();
          chatMessagesEl.scrollTop = start + (end - start) * easeInOutCubic(p);
          if (p < 1) requestAnimationFrame(step);
          else _updateChatScrollBtn();
        }
        requestAnimationFrame(step);
      });
      _updateChatScrollBtn();
    }

    // ── Chat lightbox controller ───────────────────────────────────────────────
    (function () {
      var lb      = document.getElementById('chatLightbox');
      var lbClose = document.getElementById('chatLightboxClose');
      var lbImg   = document.getElementById('chatLightboxImg');
      var lbImgW  = document.getElementById('chatLightboxImgWrap');
      var lbCtxW  = document.getElementById('chatLightboxCtxWrap');
      var lbCtxT  = document.getElementById('chatLightboxCtxText');
      if (!lb) return;

      function openImage(src) {
        lbImg.src = src;
        lbImgW.style.display = 'flex';
        lbCtxW.style.display = 'none';
        lb.style.display = 'flex';
        lbClose.focus();
      }

      function openContext(text) {
        lbCtxT.textContent = text;
        lbCtxW.style.display = '';
        lbImgW.style.display = 'none';
        lb.style.display = 'flex';
        lbClose.focus();
      }

      function closeLb() {
        lb.style.display = 'none';
        lbImg.src = '';
      }

      lbClose.addEventListener('click', closeLb);
      lb.addEventListener('click', function (e) {
        if (e.target === lb) closeLb();
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && lb.style.display !== 'none') closeLb();
      });

      // Bubbles: images in chat thread (delegated — bubbles added dynamically)
      var thread = _chatThreadEl();
      if (thread) {
        thread.addEventListener('click', function (e) {
          // Attached image thumbnail
          var imgEl = e.target.closest('.chat-attached-image');
          if (imgEl) {
            var img = imgEl.querySelector('img');
            if (img) openImage(img.src);
            return;
          }
          // "With context" chip
          var chip = e.target.closest('.cmsg-context-chip');
          if (chip) {
            // Retrieve the full context from the data attribute on the bubble,
            // falling back to the chip's own text content minus the label.
            var bubble = chip.closest('.cmsg-bubble--user');
            var ctx = bubble && bubble.dataset.context
              ? bubble.dataset.context
              : (chip.dataset.context || null);
            if (ctx) { openContext(ctx); return; }
            // No stored context — nothing richer to show
          }
        });
      }

      // Preview bar: thumbnail images above the input (delegated)
      var previewItems = document.getElementById('chatImgPreviewItems');
      if (previewItems) {
        previewItems.addEventListener('click', function (e) {
          var item = e.target.closest('.chat-img-preview-item');
          if (!item) return;
          // Don't open lightbox if they clicked the remove button
          if (e.target.closest('.chat-img-item-remove')) return;
          var img = item.querySelector('img');
          if (img) openImage(img.src);
        });
      }

      // Preview bar: context text label above the input
      var ctxText = document.getElementById('chatContextText');
      if (ctxText) {
        ctxText.addEventListener('click', function () {
          var text = window._chatContext || ctxText.textContent || '';
          if (text) openContext(text);
        });
      }

      // Expose so appendBubble can stamp the full context on the bubble element
      window._chatOpenContext = openContext;
      window._chatOpenImage   = openImage;

      // Click-to-scroll: jump to clicked message with brief highlight
      _chatThreadEl().addEventListener('click', function (e) {
        var wrap = e.target.closest('.cmsg-user-wrap, .cmsg-ai-wrap, .cmsg-system-wrap');
        if (!wrap) return;
        var container = _chatMessagesEl();
        if (!container) return;
        var targetTop = wrap.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - 80;
        container.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
        wrap.classList.remove('cmsg-scroll-target');
        void wrap.offsetWidth;
        wrap.classList.add('cmsg-scroll-target');
        wrap.addEventListener('animationend', function handler() {
          wrap.classList.remove('cmsg-scroll-target');
          wrap.removeEventListener('animationend', handler);
        });
      });
    })();
  });

  // Shared markdown pipeline (marked + math protection + DOMPurify) — reused by
  // the quiz/fill-in/flashcard engines so study material renders code, tables,
  // lists, and LaTeX consistently across tabs.
  window.motownRenderMarkdown = function (text, inline) {
    return renderMarkdown(text, inline);
  };
})();