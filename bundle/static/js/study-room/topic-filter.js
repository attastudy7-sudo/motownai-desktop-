/**
 * topic-filter.js — Floating Filter-by-Topic FAB for Quiz thread.
 * FAB: position fixed — floats over the page at bottom-left, does not
 * scroll with quiz content. Hidden automatically when quiz tab inactive
 * (lives inside #tab-quiz, which goes display:none).
 */
(function () {
  'use strict';
  var STORAGE_KEY = function (pid) { return 'quiz.filter.' + pid; };
  function slugify(s) { return (s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'general'; }
  function getPackId() { return window.PACK_ID || window.__PACK_ID__ || null; }
  function parseUrlTopics() {
    try { var sp = new URLSearchParams(window.location.search); var v = sp.get('topics'); if (v) return v.split(',').map(function (s) { return s.trim(); }).filter(Boolean); } catch (_) {}
    return null;
  }
  function readStorageTopics(pid) { try { var raw = localStorage.getItem(STORAGE_KEY(pid)); if (raw) return JSON.parse(raw); } catch (_) {} return null; }
  function writeStorageTopics(pid, set) { try { localStorage.setItem(STORAGE_KEY(pid), JSON.stringify(Array.from(set))); } catch (_) {} }
  function writeUrlTopics(set) {
    try {
      var url = new URL(window.location.href);
      if (!set || set.size === 0 || set.size === topicsCache.length) url.searchParams.delete('topics');
      else url.searchParams.set('topics', Array.from(set).join(','));
      history.replaceState(null, '', url.toString());
    } catch (_) {}
  }
  var topicsCache = [];
  var mergedQuestions = [];
  var selectedSet = new Set();
  function ensurePill() {
    var tab = document.getElementById('tab-quiz');
    if (!tab) return null;
    var existing = document.getElementById('quizFilterPill');
    if (existing) return existing;
    var pillWrap = document.createElement('div');
    pillWrap.id = 'quizFilterPill';
    pillWrap.className = 'quiz-filter-pill';
    pillWrap.innerHTML =
      '<div class="quiz-filter-pill__inner">' +
      '<button class="quiz-filter-pill__btn quiz-filter-pill__btn--filter" data-action="filter" aria-label="Filter by Topic" title="Filter by Topic" aria-expanded="false" aria-haspopup="menu">' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-filter h-4 w-4"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>' +
      '</button>' +
      '</div>' +
      '<div class="quiz-filter-popover" id="quizFilterPopover" role="menu" style="display:none"></div>';
    tab.appendChild(pillWrap);
    return pillWrap;
  }
  function renderPopover() {
    var pop = document.getElementById('quizFilterPopover');
    if (!pop) return;
    if (!topicsCache.length) {
      pop.className = 'quiz-filter-popover quiz-filter-popover--empty';
      pop.innerHTML = '<div class="quiz-filter-popover__headwrap"><h3 class="quiz-filter-popover__title">Filter by Topic</h3></div><div class="quiz-filter-popover__empty">No topics yet — generate a study guide first.</div>';
      return;
    }
    pop.className = 'quiz-filter-popover';
    if (selectedSet.size === 0 && topicsCache.length) topicsCache.forEach(function (t) { selectedSet.add(t.topic_slug); });
    var isAll = selectedSet.size === topicsCache.length;
    function _cb(checked) {
      if (checked) return '<div class="quiz-filter-row__cb quiz-filter-row__cb--checked"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check h-2.5 w-2.5 text-white"><path d="M20 6 9 17l-5-5"></path></svg></div>';
      return '<div class="quiz-filter-row__cb"></div>';
    }
    var html = '<div class="quiz-filter-popover__headwrap"><h3 class="quiz-filter-popover__title">Filter by Topic</h3></div>';
    html += '<div class="quiz-filter-popover__bodywrap"><div class="quiz-filter-popover__scroll custom-scrollbar">';
    var _allCls = isAll ? 'quiz-filter-row quiz-filter-row--active' : 'quiz-filter-row';
    html += '<button class="' + _allCls + '" data-slug="__all"><div class="quiz-filter-row__left">' + _cb(isAll) + '<span class="quiz-filter-row__label">All Questions</span></div><span class="quiz-filter-row__count">' + mergedQuestions.length + '</span></button>';
    topicsCache.forEach(function (t) {
      var checked = selectedSet.has(t.topic_slug);
      var _cls = checked ? 'quiz-filter-row quiz-filter-row--active' : 'quiz-filter-row';
      html += '<button class="' + _cls + '" data-slug="' + t.topic_slug.replace(/"/g, '&quot;') + '"><div class="quiz-filter-row__left">' + _cb(checked) + '<span class="quiz-filter-row__label">' + escapeHtml(t.title) + '</span></div><span class="quiz-filter-row__count">' + (t.count || 0) + '</span></button>';
    });
    html += '</div><div class="quiz-filter-popover__fade"></div><button class="quiz-filter-popover__chev" aria-label="Scroll"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-down h-5 w-5"><path d="m6 9 6 6 6-6"></path></svg></button></div>';
    pop.innerHTML = html;
    pop.querySelectorAll('button[data-slug]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var slug = btn.getAttribute('data-slug');
        if (slug === '__all') { if (isAll) selectedSet = new Set(); else selectedSet = new Set(topicsCache.map(function (t) { return t.topic_slug; })); }
        else { if (selectedSet.has(slug)) selectedSet.delete(slug); else selectedSet.add(slug); }
        persistAndApply(); renderPopover();
      });
    });
    var chev = pop.querySelector('.quiz-filter-popover__chev');
    var scroller = pop.querySelector('.quiz-filter-popover__scroll');
    if (chev && scroller) chev.addEventListener('click', function () { scroller.scrollBy({ top: 80, behavior: 'smooth' }); });
    // Show fade + chevron only when the list actually overflows
    _checkOverflow(pop);
  }
  function _checkOverflow(pop) {
    if (!pop) return;
    var scroller = pop.querySelector('.quiz-filter-popover__scroll');
    if (!scroller) return;
    var isOverflow = scroller.scrollHeight > scroller.clientHeight + 2;
    pop.classList.toggle('quiz-filter-popover--overflow', isOverflow);
  }
  function escapeHtml(s) { var d = document.createElement('div'); d.appendChild(document.createTextNode(s || '')); return d.innerHTML; }
  function persistAndApply() { var pid = getPackId(); if (pid) { writeStorageTopics(pid, selectedSet); writeUrlTopics(selectedSet); } applyFilterToQuiz(); }
  function applyFilterToQuiz() {
    if (!mergedQuestions.length) return;
    var filtered = mergedQuestions.filter(function (q) { return selectedSet.has(q.topic_slug || 'general'); });
    // A persisted/derived selection can pass validity checks yet match zero
    // questions (e.g. "general", or a section whose items were regenerated
    // under a different topic). Left alone, this strands the deck on the
    // "no questions for the selected topics" gate even though items exist.
    // Self-heal to the topics that actually have questions and re-apply.
    if (!filtered.length) {
      selectedSet = defaultSelection();
      var healPid = getPackId();
      if (healPid) { writeStorageTopics(healPid, selectedSet); writeUrlTopics(selectedSet); }
      filtered = mergedQuestions.filter(function (q) { return selectedSet.has(q.topic_slug || 'general'); });
    }
    window._quizFilteredData = filtered;
    if (filtered.length) {
      if (typeof window._qzApplyFilter === 'function') {
        window._qzApplyFilter(filtered);
      } else if (typeof window.renderQuiz === 'function') {
        window.renderQuiz(filtered);
      }
      var tot = document.getElementById('qzTotal'); if (tot) tot.textContent = String(filtered.length);
      var cur = document.getElementById('qzCounter'); if (cur) cur.style.display = '';
    } else {
      var stage = document.getElementById('qzStage'); if (stage) stage.style.display = 'none';
      var empty = document.getElementById('qzEmpty'); if (empty) { empty.style.display = 'flex'; var sub = empty.querySelector('.podcast-empty-sub'); if (sub) sub.textContent = 'No questions for the selected topics. Adjust the filter or generate more.'; }
    }
    updatePillBadge(); updatePillVisibility();
  }
  function updatePillBadge() { var btn = document.querySelector('.quiz-filter-pill__btn--filter'); if (!btn) return; var isFiltered = selectedSet.size > 0 && selectedSet.size < topicsCache.length; btn.classList.toggle('quiz-filter-pill__btn--active', isFiltered); }
  function updatePillVisibility() {
    var pill = document.getElementById('quizFilterPill'); if (!pill) return;
    var qzEmpty = document.getElementById('qzEmpty');
    var isGateVisible = qzEmpty && qzEmpty.style.display !== 'none' && qzEmpty.offsetParent !== null;
    var hasQuestions = mergedQuestions.length > 0;
    var hasTopicWithQuestions = topicsCache.some(function (t) { return (t.count || 0) > 0; });
    if (isGateVisible || (!hasQuestions && !hasTopicWithQuestions)) pill.style.display = 'none'; else pill.style.display = '';
  }
  function allTopicSlugs() { return topicsCache.map(function (t) { return t.topic_slug; }); }
  function topicsWithQuestions() { return topicsCache.filter(function (t) { return (t.count || 0) > 0; }).map(function (t) { return t.topic_slug; }); }
  function defaultSelection() {
    // Default to topics that actually have questions so the deck is never
    // rendered empty by a selection that matches nothing.
    var withQ = topicsWithQuestions();
    return new Set(withQ.length ? withQ : allTopicSlugs());
  }
  function selectionHasQuestions(set) {
    for (var i = 0; i < mergedQuestions.length; i++) {
      if (set.has(mergedQuestions[i].topic_slug || 'general')) return true;
    }
    return false;
  }
  function initFilterState() {
    var pid = getPackId(); var urlTopics = parseUrlTopics(); var storeTopics = pid ? readStorageTopics(pid) : null;
    var persisted = (urlTopics && urlTopics.length) ? urlTopics : ((storeTopics && Array.isArray(storeTopics) && storeTopics.length) ? storeTopics : null);
    selectedSet = persisted ? new Set(persisted) : defaultSelection();
    var valid = new Set(allTopicSlugs());
    selectedSet.forEach(function (s) { if (!valid.has(s)) selectedSet.delete(s); });
    // Valid slugs can still collectively match zero questions. Fall back to a
    // selection that renders items rather than a dead "no questions" gate.
    if (!selectionHasQuestions(selectedSet)) selectedSet = defaultSelection();
  }
  function fetchAndInit(done, emptyOk) {
    var pid = getPackId(); if (!pid) return;
    fetch('/library/api/pack/' + pid + '/questions', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.ok) { if (typeof done === 'function') done(); return; }
        topicsCache = Array.isArray(data.topics) ? data.topics : [];
        mergedQuestions = Array.isArray(data.questions) ? data.questions : [];
        window._quizMergedQuestions = mergedQuestions; window._quizTopics = topicsCache;
        var pill = ensurePill(); if (!pill) { if (typeof done === 'function') done(); return; }
        initFilterState(); renderPopover(); wirePill(); updatePillVisibility();
        // Regenerate/Delete live next to the Filter button (assessment-item-actions.js).
        if (window._assessmentItemActions) window._assessmentItemActions.mount('tab-quiz');
        if (mergedQuestions.length) {
          applyFilterToQuiz();
        } else if (emptyOk && typeof window._qzApplyFilter === 'function') {
          // Mutation refresh left the deck with zero questions — blank it so a
          // deleted last item can't stay on screen.
          window._qzApplyFilter([]);
        }
        if (typeof done === 'function') done();
      }).catch(function () { if (typeof done === 'function') done(); });
  }
  function wirePill() {
    var pill = document.getElementById('quizFilterPill'); if (!pill || pill._wired) return; pill._wired = true;
    try { var gate = document.getElementById('qzEmpty'); if (gate && window.MutationObserver) { var obs = new MutationObserver(function () { updatePillVisibility(); }); obs.observe(gate, { attributes: true, attributeFilter: ['style', 'class'] }); } } catch (_) {}
    var filterBtn = pill.querySelector('[data-action="filter"]'); var pop = document.getElementById('quizFilterPopover');
    if (filterBtn && pop) {
      filterBtn.addEventListener('click', function (e) { e.stopPropagation(); var open = pop.style.display !== 'none'; pop.style.display = open ? 'none' : 'block'; filterBtn.setAttribute('aria-expanded', open ? 'false' : 'true'); if (!open) renderPopover(); });
      // Single table-wide click-away handler, replaced on every wirePill. The
      // quiz pane is wiped on tab unmount, destroying prior pill nodes; stale
      // handlers closed over a detached pill used to force-hide the live
      // popover after any tab switch (filter button "randomly doesn't work").
      if (window._quizDocCloseHandler) {
        document.removeEventListener('click', window._quizDocCloseHandler);
        window._quizDocCloseHandler = null;
      }
      window._quizDocCloseHandler = function (e) {
        if (!document.body.contains(pill)) return;
        if (pop.contains(e.target)) return;
        if (!pill.contains(e.target)) { pop.style.display = 'none'; filterBtn.setAttribute('aria-expanded', 'false'); }
      };
      document.addEventListener('click', window._quizDocCloseHandler);
    }
  }
  window.quizFilterSelectTopic = function (topicSlug) {
    var slug = slugify(topicSlug); selectedSet = new Set([slug]); persistAndApply(); renderPopover();
    var btn = document.querySelector('.room-tab-btn[data-target="tab-quiz"]');
    if (typeof window.switchRoomTab === 'function') window.switchRoomTab(btn, 'tab-quiz'); else { var tab = document.getElementById('tab-quiz'); if (tab) tab.scrollIntoView(); }
  };
  document.addEventListener('DOMContentLoaded', function () { setTimeout(fetchAndInit, 600); });
  (function patchSwitch() {
    if (typeof window.switchRoomTab !== 'function') { setTimeout(patchSwitch, 300); return; }
    var orig = window.switchRoomTab;
    window.switchRoomTab = function (btn, targetId) {
      var res = orig.apply(this, arguments);
      if (targetId === 'tab-quiz') setTimeout(function () { fetchAndInit(); if (mergedQuestions.length) setTimeout(applyFilterToQuiz, 200); }, 250);
      return res;
    };
  })();
  window._topicFilter = { fetchAndInit: fetchAndInit, applyFilterToQuiz: applyFilterToQuiz, getTopics: function () { return topicsCache; } };

  // Share Regenerate / Delete with the rest of the assessment tabs.
  if (window._assessmentItemActions) {
    window._assessmentItemActions.register('tab-quiz', {
      buttonClass: 'quiz-filter-pill__btn',
      labels: {
        regen: 'Regenerate question',
        del: 'Delete question',
        confirmTitle: 'Delete this question?',
        confirmBody: 'This question will be permanently removed from the quiz.'
      },
      getFilterButton: function () {
        var pill = document.getElementById('quizFilterPill');
        return pill ? pill.querySelector('[data-action="filter"]') : null;
      },
      resolveItem: function () {
        var arrs = [window._quizFilteredData, window._qzData];
        var idx = window._qzIdx;
        var i, arr, item = null;
        // Preferred: an item that carries server coordinates (resource_id +
        // question_index) so delete/regenerate hit the exact persisted slot.
        for (i = 0; i < arrs.length; i++) {
          arr = arrs[i];
          if (Array.isArray(arr) && typeof idx === 'number' && idx >= 0 && idx < arr.length) {
            var c = arr[idx];
            if (c && c.resource_id != null && c.question_index != null) { item = c; break; }
          }
        }
        if (!item) {
          for (i = 0; i < arrs.length; i++) {
            arr = arrs[i];
            if (Array.isArray(arr) && typeof idx === 'number' && idx >= 0 && idx < arr.length && arr[idx]) { item = arr[idx]; break; }
          }
        }
        if (!item) return null;
        return {
          resource_type: item.resource_type || 'quiz',
          resource_id: item.resource_id != null ? item.resource_id : (window._qzResourceId || null),
          item_index: item.question_index != null ? item.question_index : idx,
          fingerprint: (window._dedupKey || function () { return ''; })(item, 'quiz'),
          topic: item.topic || null
        };
      },
      refresh: function (done) { fetchAndInit(done, true); },
      isDisabled: function () { return false; }
    });
  }
})();
