/**
 * assessment-filter.js — Reusable Floating Filter-by-Topic FAB for assessment tabs.
 * 
 * Usage:
 *   initAssessmentFilter({
 *     fetchUrl: '/library/api/pack/123/questions', // or other endpoint
 *     getItems: () => window._qzData,             // current items array
 *     applyFilter: (filtered) => { window.renderQuiz(filtered); window._qzData = filtered; },
 *     getEmptyEl: () => document.getElementById('qzEmpty'),
 *     getTotalEl: () => document.getElementById('qzTotal'),
 *     getCounterEl: () => document.getElementById('qzCounter'),
 *     getStageEl: () => document.getElementById('qzStage'),
 *     getBadgeEl: () => document.querySelector('.sr-badge-bar'),
 *     tabId: 'tab-quiz',                          // for tab activation detection
 *     itemTopicProp: 'topic_slug'                 // property name on items that holds topic
 *   });
 */
(function () {
  'use strict';
  
  // Utility functions
  function slugify(s) { 
    return (s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'general'; 
  }
  
  function escapeHtml(s) { 
    var d = document.createElement('div'); 
    d.appendChild(document.createTextNode(s || '')); 
    return d.innerHTML; 
  }

// AssessmentFilter class
function AssessmentFilter(options) {
  // Required options
  this.fetchUrl = options.fetchUrl;
  this.getItems = options.getItems || (() => []);
  this.applyFilter = options.applyFilter || (() => {});
  this.getEmptyEl = options.getEmptyEl || (() => null);
  this.getTotalEl = options.getTotalEl || (() => null);
  this.getCounterEl = options.getCounterEl || (() => null);
  this.getStageEl = options.getStageEl || (() => null);
  this.getBadgeEl = options.getBadgeEl || (() => null);
  this.tabId = options.tabId || '';
  this.itemTopicProp = options.itemTopicProp || 'topic_slug';
  if (typeof options.deriveTopicsFromItems === 'function') {
    this.deriveTopicsFromItems = options.deriveTopicsFromItems;
  }
  
  // State
  this.STORAGE_KEY = function (pid) { return 'assessment.filter.' + this.tabId + '.' + pid; };
  this.topicsCache = [];
  this.mergedItems = [];
  this.selectedSet = new Set();
  this.pillBaseId = 'assessment-filter-' + this.tabId;  // Unique base ID for this instance
  this.pill = null;
  
  // Bind methods
  this.persistAndApply = this.persistAndApply.bind(this);
  this.renderPopover = this.renderPopover.bind(this);
  this.ensurePill = this.ensurePill.bind(this);
  this.wirePill = this.wirePill.bind(this);
  this.updatePillBadge = this.updatePillBadge.bind(this);
  this.updatePillVisibility = this.updatePillVisibility.bind(this);
  this.initFilterState = this.initFilterState.bind(this);
  this.fetchAndInit = this.fetchAndInit.bind(this);
  this.applyFilterToItems = this.applyFilterToItems.bind(this);
}
  
  AssessmentFilter.prototype = {
    slugify: slugify,
    escapeHtml: escapeHtml,
    
    parseUrlTopics: function () {
      try { 
        var sp = new URLSearchParams(window.location.search); 
        var v = sp.get('topics'); 
        if (v) return v.split(',').map(function (s) { return s.trim(); }).filter(Boolean); 
      } catch (_) {}
      return null;
    },
    
    readStorageTopics: function (pid) { 
      try { 
        var raw = localStorage.getItem(this.STORAGE_KEY(pid)); 
        if (raw) return JSON.parse(raw); 
      } catch (_) {} 
      return null; 
    },
    
    writeStorageTopics: function (pid, set) { 
      try { 
        localStorage.setItem(this.STORAGE_KEY(pid), JSON.stringify(Array.from(set))); 
      } catch (_) {} 
    },
    
    writeUrlTopics: function (set) {
      try {
        var url = new URL(window.location.href);
        if (!set || set.size === 0 || set.size === this.topicsCache.length) 
          url.searchParams.delete('topics');
        else 
          url.searchParams.set('topics', Array.from(set).join(','));
        history.replaceState(null, '', url.toString());
      } catch (_) {}
    },
    
    ensurePill: function () {
      var tab = document.getElementById(this.tabId);
      if (!tab) return null;
      
      var pillId = this.pillBaseId;  // Unique per instance
      var existing = document.getElementById(pillId);
      if (existing) return existing;
      
      var pillWrap = document.createElement('div');
      pillWrap.id = pillId;
      pillWrap.className = 'assessment-filter-pill';
      pillWrap.innerHTML =
        '<div class="assessment-filter-pill__inner">' +
        '<button class="assessment-filter-pill__btn" data-action="filter" aria-label="Filter by Topic" title="Filter by Topic">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-filter h-4 w-4"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>' +
        '</button>' +
        '</div>' +
        '<div class="assessment-filter-popover" id="' + pillId + '-popover" role="menu" style="display:none"></div>';
      
      tab.appendChild(pillWrap);
      return pillWrap;
    },
    
renderPopover: function () {
      var pop = document.getElementById(this.pillBaseId + '-popover');
      if (!pop) return;
      
      if (!this.topicsCache.length) {
        pop.className = 'assessment-filter-popover assessment-filter-popover--empty';
        pop.innerHTML = '<div class="assessment-filter-popover__headwrap"><h3 class="assessment-filter-popover__title">Filter by Topic</h3></div><div class="assessment-filter-popover__empty">No topics yet — generate content first.</div>';
        return;
      }
      
      pop.className = 'assessment-filter-popover';
      if (this.selectedSet.size === 0 && this.topicsCache.length) 
        this.topicsCache.forEach(function (t) { this.selectedSet.add(t.topic_slug); }.bind(this));
      
      var isAll = this.selectedSet.size === this.topicsCache.length;
      
      function _cb(checked) {
        if (checked) 
          return '<div class="assessment-filter-row__cb assessment-filter-row__cb--checked"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check h-2.5 w-2.5 text-white"><path d="M20 6 9 17l-5-5"></path></svg></div>';
        return '<div class="assessment-filter-row__cb"></div>';
      }
      
      var html = '<div class="assessment-filter-popover__headwrap"><h3 class="assessment-filter-popover__title">Filter by Topic</h3></div>';
      html += '<div class="assessment-filter-popover__bodywrap"><div class="assessment-filter-popover__scroll custom-scrollbar">';
      
      var _allCls = isAll ? 'assessment-filter-row assessment-filter-row--active' : 'assessment-filter-row';
      html += '<button class="' + _allCls + '" data-slug="__all"><div class="assessment-filter-row__left">' + _cb(isAll) + '<span class="assessment-filter-row__label">All Items</span></div><span class="assessment-filter-row__count">' + this.mergedItems.length + '</span></button>';
      
      this.topicsCache.forEach(function (t) {
        var checked = this.selectedSet.has(t.topic_slug);
        var _cls = checked ? 'assessment-filter-row assessment-filter-row--active' : 'assessment-filter-row';
        html += '<button class="' + _cls + '" data-slug="' + t.topic_slug.replace(/"/g, '&quot;') + '"><div class="assessment-filter-row__left">' + _cb(checked) + '<span class="assessment-filter-row__label">' + this.escapeHtml(t.title) + '</span></div><span class="assessment-filter-row__count">' + (t.count || 0) + '</span></button>';
      }.bind(this));
      
      html += '</div><div class="assessment-filter-popover__fade"></div><button class="assessment-filter-popover__chev" aria-label="Scroll"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-down h-5 w-5"><path d="m6 9 6 6 6-6"></path></svg></button></div>';
      
      pop.innerHTML = html;
      
      // Wire popover events
      pop.querySelectorAll('button[data-slug]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var slug = btn.getAttribute('data-slug');
          if (slug === '__all') { 
            if (isAll) this.selectedSet = new Set(); 
            else this.selectedSet = new Set(this.topicsCache.map(function (t) { return t.topic_slug; }));
          } else { 
            if (this.selectedSet.has(slug)) this.selectedSet.delete(slug); 
            else this.selectedSet.add(slug); 
          }
          if (this.selectedSet.size === 0 && this.topicsCache.length) {
            this.selectedSet = new Set(this.topicsCache.map(function (t) { return t.topic_slug; }));
          }
          this.persistAndApply(); 
          this.renderPopover();
        }.bind(this));
      }.bind(this));
      
      var chev = pop.querySelector('.assessment-filter-popover__chev');
      var scroller = pop.querySelector('.assessment-filter-popover__scroll');
      if (chev && scroller) {
        chev.addEventListener('click', function () { 
          scroller.scrollBy({ top: 80, behavior: 'smooth' }); 
        });
      }
      // Show fade + chevron only when the list actually overflows
      function _checkOverflow(pop) {
        if (!pop) return;
        var scroller = pop.querySelector('.assessment-filter-popover__scroll');
        if (!scroller) return;
        var isOverflow = scroller.scrollHeight > scroller.clientHeight + 2;
        pop.classList.toggle('assessment-filter-popover--overflow', isOverflow);
      }
      _checkOverflow(pop);
    },
    
    persistAndApply: function () {
      var pid = this.getPackId(); 
      if (pid) { 
        this.writeStorageTopics(pid, this.selectedSet); 
        this.writeUrlTopics(this.selectedSet); 
      }
      this.applyFilterToItems();
    },
    
    applyFilterToItems: function () {
      // Filter from the authoritative full list (server content), NOT from the
      // currently-rendered deck. The deck global (window._fcCards / _fiData)
      // is replaced by every filtered subset, so filtering it again would
      // progressively truncate cards and can wrongly produce an empty state
      // the moment a combination stops matching the in-memory subset. Fall
      // back to the live deck only when the server list isn't available yet.
      var items = this.mergedItems.length ? this.mergedItems : this.getItems();
      if (!items.length) return;
      
      if (this.topicsCache.length === 0) { 
        this.applyFilter(items); 
        return; 
      }
      
      var filtered = items.filter(function (item) { 
        var itemSlug = item[this.itemTopicProp];
        if (!itemSlug && typeof item.topic === 'string' && item.topic.trim()) {
          itemSlug = this.slugify(item.topic);
        }
        return this.selectedSet.has(itemSlug || 'general');
      }.bind(this));
      
      // Update window globals if they exist (for backward compatibility)
      if (this.tabId === 'tab-quiz') {
        window._quizFilteredData = filtered;
        window._qzData = filtered;
      }
      
      this.applyFilter(filtered);
      
      // Update UI elements
      var totEl = this.getTotalEl();
      if (totEl) totEl.textContent = String(filtered.length);
      
      var curEl = this.getCounterEl();
      if (curEl) curEl.style.display = filtered.length ? '' : 'none';
      
      var stageEl = this.getStageEl();
      if (stageEl) stageEl.style.display = filtered.length ? '' : 'none';
      
      var emptyEl = this.getEmptyEl();
      if (emptyEl) {
        if (filtered.length === 0) {
          emptyEl.style.display = 'flex';
          var sub = emptyEl.querySelector('.podcast-empty-sub');
          if (sub) sub.textContent = 'No items for the selected topics. Adjust the filter or generate more.';
        } else {
          emptyEl.style.display = 'none';
        }
      }
      
      var badgeEl = this.getBadgeEl();
      if (badgeEl) badgeEl.style.display = '';
      
      this.updatePillBadge();
      this.updatePillVisibility();
    },
    
    updatePillBadge: function () {
      var pillEl = document.getElementById(this.pillBaseId);
      if (!pillEl) return;
      var btn = pillEl.querySelector('.assessment-filter-pill__btn[data-action="filter"]');
      if (!btn) return;
      var isFiltered = this.selectedSet.size > 0 && this.selectedSet.size < this.topicsCache.length;
      btn.classList.toggle('assessment-filter-pill__btn--active', isFiltered);
    },
    
    updatePillVisibility: function () {
      var pill = document.getElementById(this.pillBaseId);
      if (!pill) return;
      
      var emptyEl = this.getEmptyEl();
      var isGateVisible = emptyEl && emptyEl.style.display !== 'none' && emptyEl.offsetParent !== null;
      var hasItems = this.mergedItems.length > 0;
      var hasTopicWithItems = this.topicsCache.some(function (t) { return (t.count || 0) > 0; });
      
      if (isGateVisible || (!hasItems && !hasTopicWithItems)) {
        pill.style.display = 'none';
      } else {
        pill.style.display = '';
      }
    },
    
     deriveTopicsFromItems: function () {
       var items = this.getItems();
       if (!items.length) return;
       var seen = {};
       items.forEach(function (item) {
         var rawSlug = item[this.itemTopicProp];
         var rawTopic = typeof item.topic === 'string' && item.topic.trim() ? item.topic : '';
         var slug = rawSlug || this.slugify(rawTopic) || 'general';
         if (!seen[slug]) {
           seen[slug] = { topic_slug: slug, title: rawTopic || slug.replace(/-/g, ' ').replace(/^\w/, function(c){return c.toUpperCase()}) || 'General', count: 0 };
         }
         seen[slug].count++;
       }.bind(this));
       this.topicsCache = Object.keys(seen).map(function (s) { return seen[s]; });
     },
     
     initFilterState: function () {
       var pid = this.getPackId();
       var urlTopics = this.parseUrlTopics();
       var storeTopics = pid ? this.readStorageTopics(pid) : null;
       
       if (this.topicsCache.length === 0) {
         this.deriveTopicsFromItems();
       }
       
       if (urlTopics && urlTopics.length) 
         this.selectedSet = new Set(urlTopics);
       else if (storeTopics && Array.isArray(storeTopics) && storeTopics.length) 
         this.selectedSet = new Set(storeTopics);
       else 
         this.selectedSet = new Set(this.topicsCache.map(function (t) { return t.topic_slug; }));
       
var valid = new Set(this.topicsCache.map(function (t) { return t.topic_slug; }));
        // Prune selection slugs that no longer exist — build a new set instead
        // of mutating inside the forEach callback ('this' is undefined there
        // in strict mode, so the old delete-bug threw and aborted init).
        var pruned = new Set();
        this.selectedSet.forEach(function (s) {
          if (valid.has(s)) pruned.add(s);
        });
        this.selectedSet = pruned;
       
       if (this.selectedSet.size === 0 && this.topicsCache.length) 
         this.selectedSet = new Set(this.topicsCache.map(function (t) { return t.topic_slug; }));
     },
     
_refreshFromApi: function (applyFilter, done, emptyOk) {
      var self = this;
      var pid = this.getPackId();
      if (!pid) return;

      var url = typeof this.fetchUrl === 'function' ? this.fetchUrl() : this.fetchUrl;
      if (!url) return;

      fetch(url, { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (!data || !data.ok) {
            if (typeof done === 'function') done();
            return;
          }

          self.topicsCache = Array.isArray(data.topics) ? data.topics : [];
          self.mergedItems = Array.isArray(data.questions) ? data.questions : (Array.isArray(data.items) ? data.items : []);

          // Resource-content envelope: { ok, content: { flashcards: [...] } }
          if (!self.mergedItems.length && data.content && typeof data.content === 'object') {
            var contentKeys = Object.keys(data.content);
            for (var ci = 0; ci < contentKeys.length; ci++) {
              if (Array.isArray(data.content[contentKeys[ci]])) {
                self.mergedItems = data.content[contentKeys[ci]];
                break;
              }
            }
          }

          // Store globals for backward compatibility
          if (self.tabId === 'tab-quiz') {
            window._quizMergedItems = self.mergedItems;
            window._quizTopics = self.topicsCache;
          }

          var pill = self.ensurePill();
          if (!pill) {
            if (typeof done === 'function') done();
            return;
          }

          self.initFilterState();
          self.renderPopover();
          self.wirePill();
          self.updatePillVisibility();
          // Regenerate/Delete live next to the Filter button (assessment-item-actions.js).
          if (window._assessmentItemActions) window._assessmentItemActions.mount(self.tabId);

          // If backend didn't return topics but we have items, derive them client-side
          if (self.topicsCache.length === 0 && self.mergedItems.length) {
            self.deriveTopicsFromItems();
            self.initFilterState(); // Re-init with derived topics
            self.renderPopover();
            self.updatePillBadge();
            self.updatePillVisibility();
          }

          // Mount-time init only: re-assert the authoritative deck from the
          // server so a previously-filtered global (window._fcCards / _fiData)
          // can never leave the tab stuck on a stale subset or the empty state.
          if (applyFilter) {
            if (self.mergedItems && self.mergedItems.length) {
              if (self.tabId === 'tab-flashcards') {
                window._fcCards = self.mergedItems;
              } else if (self.tabId === 'tab-more') {
                window._fiData = self.mergedItems;
              }
              if (self.parseUrlTopics() || self.readStorageTopics(pid)) {
                self.applyFilterToItems();
              } else if (self.applyFilter) {
                // No saved filter — re-render the full authoritative deck so a
                // stale empty/subset widget can't stick across tab remounts.
                self.applyFilter(self.mergedItems);
              }
            } else if (emptyOk && self.applyFilter) {
              // Mutation refresh left the deck with zero items — blank it so a
              // deleted last item can't stay on screen.
              self.applyFilter([]);
            }
          }
          if (typeof done === 'function') done();
        }.bind(this))
        .catch(function () {
          if (typeof done === 'function') done();
        });
    },

    fetchAndInit: function (done, emptyOk) {
      this._refreshFromApi(true, done, emptyOk);
    },

    refreshTopics: function () {
      this._refreshFromApi(false);
    },
    
    wirePill: function () {
      var pill = document.getElementById(this.pillBaseId);
      if (!pill || pill._wired) return; 
      pill._wired = true;
      
      try { 
        var gate = this.getEmptyEl(); 
        if (gate && window.MutationObserver) { 
          var obs = new MutationObserver(function () { this.updatePillVisibility(); }.bind(this)); 
          obs.observe(gate, { attributes: true, attributeFilter: ['style', 'class'] }); 
        } 
      } catch (_) {}
      
      var filterBtn = pill.querySelector('[data-action="filter"]'); 
      var pop = document.getElementById(this.pillBaseId + '-popover');
      
      if (filterBtn && pop) {
        filterBtn.addEventListener('click', function (e) { 
          e.stopPropagation(); 
          var open = pop.style.display !== 'none'; 
          pop.style.display = open ? 'none' : 'block'; 
          filterBtn.setAttribute('aria-expanded', open ? 'false' : 'true'); 
          if (!open) this.renderPopover(); 
        }.bind(this));
        
        // Single document-level click-away handler, owned by this instance
        // and replaced on every wirePill. Tabs are unmounted by wiping the
        // pane's innerHTML (which destroys prior pill nodes); the old
        // handler would otherwise keep living with a detached pill whose
        // contains() is always false — force-hiding the current popover and
        // making the filter button look "randomly broken" after a tab switch.
        if (this._outsideDocHandler) {
          document.removeEventListener('click', this._outsideDocHandler);
          this._outsideDocHandler = null;
        }
        this._outsideDocHandler = function (e) {
          if (!document.body.contains(pill)) return;          // our pill was destroyed
          if (pop.contains(e.target)) return;                // interactions inside the popover
          if (!pill.contains(e.target)) {
            pop.style.display = 'none';
            filterBtn.setAttribute('aria-expanded', 'false');
          }
        };
        document.addEventListener('click', this._outsideDocHandler);
      }
    },
    
    getPackId: function () { 
      return window.PACK_ID || window.__PACK_ID__ || null; 
    },
    
    // Public method for selecting a topic (for integration with Study Guide)
    selectTopic: function (topicSlug) {
      var slug = this.slugify(topicSlug); 
      this.selectedSet = new Set([slug]); 
      this.persistAndApply(); 
      this.renderPopover();
      
      // Try to switch to this tab
      var btn = document.querySelector('.room-tab-btn[data-target="' + this.tabId + '"]');
      if (typeof window.switchRoomTab === 'function' && btn) {
        window.switchRoomTab(btn, this.tabId); 
      } else {
        var tab = document.getElementById(this.tabId); 
        if (tab) tab.scrollIntoView(); 
      }
    }
  };
  
  // Export the factory function
  window.initAssessmentFilter = function (options) {
    return new AssessmentFilter(options);
  };
  
  // For backward compatibility - keep the existing quizFilterSelectTopic global
  window.quizFilterSelectTopic = function (topicSlug) {
    // Try to find an existing assessment filter for quiz tab
    if (window._quizAssessmentFilter) {
      window._quizAssessmentFilter.selectTopic(topicSlug);
    } else {
      // Fallback to old behavior
      if (typeof window.showToast === 'function') window.showToast('Filter applied');
    }
  };
  
  // Auto-initialize for quiz tab on DOMContentLoaded (maintaining backward compatibility)
  // DISABLED: room-tab-lazy.js handles Quiz filter init when the tab mounts lazily.
  // document.addEventListener('DOMContentLoaded', function () { 
  //   setTimeout(function () {
  //     if (!window._quizAssessmentFilter) {
  //       var quizFilter = window.initAssessmentFilter({
  //         fetchUrl: function () { 
  //           var pid = window.PACK_ID || window.__PACK_ID__; 
  //           return pid ? '/library/api/pack/' + pid + '/questions' : null; 
  //         },
  //         getItems: function () { return window._qzData || []; },
  //         applyFilter: function (filtered) { 
  //           if (typeof window.renderQuiz === 'function') {
  //             window.renderQuiz(filtered);
  //             window._qzData = filtered;
  //           }
  //         },
  //         getEmptyEl: function () { return document.getElementById('qzEmpty'); },
  //         getTotalEl: function () { return document.getElementById('qzTotal'); },
  //         getCounterEl: function () { return document.getElementById('qzCounter'); },
  //         getStageEl: function () { return document.getElementById('qzStage'); },
  //         getBadgeEl: function () { return document.querySelector('.sr-badge-bar'); },
  //         tabId: 'tab-quiz',
  //         itemTopicProp: 'topic_slug'
  //       });
  //       window._quizAssessmentFilter = quizFilter;
  //       setTimeout(function () { quizFilter.fetchAndInit(); }, 600);
  //     }
  //   }, 100);
  // });
  
})();