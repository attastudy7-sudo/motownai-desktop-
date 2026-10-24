// Study Room Chrome — tab switcher, AI pane, resize, reference viewer, toolbars, mic
;(function () {
document.addEventListener('DOMContentLoaded', function () {
  var footerBase = document.getElementById('chatFooterBase');
  if (footerBase) footerBase.style.display = '';
});

// ── ROOM TAB SWITCHER (left icon rail) ──
;(function () {
    let _activeRoom = (new URLSearchParams(window.location.search).get('open_notes') === '1') ? 'tab-notes' : window._defaultTabId;
    var _aiPaneCollapsed = false;
    var _AI_COLLAPSE_TABS = ['tab-flashcards', 'tab-quiz', 'tab-more'];

    function syncAiToggleIcons(collapsed) {
      // Show the appropriate SVG for topbar and floating tab depending on collapsed state.
      var topOpen = document.getElementById('srAiToggleIcon-open');
      var topCollapsed = document.getElementById('srAiToggleIcon-collapsed');
      var tabOpen = document.getElementById('aiToggleIcon-open');
      var tabCollapsed = document.getElementById('aiToggleIcon-collapsed');

      // Collapsed state: show the original icon. Expanded state: show the flipped icon.
      if (collapsed) {
        if (topOpen) { topOpen.style.display = ''; topOpen.style.transform = ''; }
        if (topCollapsed) { topCollapsed.style.display = 'none'; topCollapsed.style.transform = ''; }
        if (tabOpen) { tabOpen.style.display = ''; tabOpen.style.transform = ''; }
        if (tabCollapsed) { tabCollapsed.style.display = 'none'; tabCollapsed.style.transform = ''; }
      } else {
        if (topOpen) { topOpen.style.display = 'none'; topOpen.style.transform = ''; }
        if (topCollapsed) { topCollapsed.style.display = ''; }
        if (tabOpen) { tabOpen.style.display = 'none'; tabOpen.style.transform = ''; }
        if (tabCollapsed) { tabCollapsed.style.display = ''; }
      }
      // Also toggle a CSS class on the buttons for any styling hooks
      var topBtn = document.getElementById('srAiToggleBtn');
      var tabBtn = document.getElementById('aiToggleTab');
      if (topBtn) topBtn.classList.toggle('ai-collapsed-icon', !!collapsed);
      if (tabBtn) tabBtn.classList.toggle('ai-collapsed-icon', !!collapsed);
    }

    /* ── AI pane resize ──────────────────────────────────────── */
    (function () {
      var MIN_W = 380;
      var MAX_W = 680;
      var STORAGE_KEY = 'motown_ai_pane_w';

      var handle   = document.getElementById('aiResizeHandle');
      var paneAi   = document.getElementById('paneAi');

      if (!handle || !paneAi) return;

      /* Restore saved width */
      var savedW = parseInt(localStorage.getItem(STORAGE_KEY), 10);
      if (savedW && savedW >= MIN_W && savedW <= MAX_W) {
        _applyAiWidth(savedW);
      }

      function _applyAiWidth(w) {
        document.documentElement.style.setProperty('--ai-sidebar-w', w + 'px');
      }

      var _dragging = false;
      var _startX   = 0;
      var _startW   = 0;

      handle.addEventListener('mousedown', function (e) {
        if (paneAi.classList.contains('ai-collapsed')) return;
        e.preventDefault();
        _dragging = true;
        _startX   = e.clientX;
        _startW   = paneAi.getBoundingClientRect().width;
        document.body.classList.add('is-resizing');
        document.body.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
      });

      document.addEventListener('mousemove', function (e) {
        if (!_dragging) return;
        /* Handle is on LEFT border, dragging left = wider, right = narrower */
        var delta = _startX - e.clientX;
        var newW  = Math.min(MAX_W, Math.max(MIN_W, _startW + delta));
        /* Snap to nearest 10px for feel */
        newW = Math.round(newW / 10) * 10;
        _applyAiWidth(newW);
      });

      document.addEventListener('mouseup', function (e) {
        if (!_dragging) return;
        _dragging = false;
        document.body.classList.remove('is-resizing');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        /* Persist */
        var finalW = Math.round(paneAi.getBoundingClientRect().width);
        if (finalW >= MIN_W) localStorage.setItem(STORAGE_KEY, finalW);
      });

      /* Guard: if mouse leaves document during drag, inline userSelect leaks */
      document.addEventListener('mouseleave', function () {
        if (!_dragging) return;
        _dragging = false;
        document.body.classList.remove('is-resizing');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      });

      /* Touch support */
      var _resizeSafetyTimer = null;

      function _clearResizingState() {
        if (!_dragging) return;
        _dragging = false;
        clearTimeout(_resizeSafetyTimer);
        _resizeSafetyTimer = null;
        document.body.classList.remove('is-resizing');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        var finalW = Math.round(paneAi.getBoundingClientRect().width);
        if (finalW >= MIN_W) localStorage.setItem(STORAGE_KEY, finalW);
      }

      handle.addEventListener('touchstart', function (e) {
        if (paneAi.classList.contains('ai-collapsed')) return;
        var t = e.touches[0];
        _dragging = true;
        _startX   = t.clientX;
        _startW   = paneAi.getBoundingClientRect().width;
        document.body.classList.add('is-resizing');
        /* Safety: if touchend/touchcancel never fire, auto-clear after 4s */
        clearTimeout(_resizeSafetyTimer);
        _resizeSafetyTimer = setTimeout(_clearResizingState, 4000);
      }, { passive: true });

      document.addEventListener('touchmove', function (e) {
        if (!_dragging) return;
        var t = e.touches[0];
        var delta = _startX - t.clientX;
        var newW  = Math.min(MAX_W, Math.max(MIN_W, _startW + delta));
        newW = Math.round(newW / 10) * 10;
        _applyAiWidth(newW);
      }, { passive: true });

      document.addEventListener('touchend', _clearResizingState);
      document.addEventListener('touchcancel', _clearResizingState);
    })();
    /* ── end AI pane resize ──────────────────────────────────── */

    window.switchAiPaneTab = function (btn, targetPanel) {
      var paneAi = document.getElementById('paneAi');
      if (!paneAi || paneAi.dataset.activePanel === targetPanel) return;

      paneAi.querySelectorAll('.ai-tab-btn').forEach(function (b) {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      paneAi.querySelectorAll('.ai-vp').forEach(function (vp) {
        vp.classList.remove('ai-vp--active');
      });

      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');

      var targetVp = document.getElementById('vp-' + targetPanel);
      if (targetVp) targetVp.classList.add('ai-vp--active');

      // Chat input box lives outside .ai-viewports (it's shared chrome below
      // the active panel) — hide it on Content so the document gets the
      // full pane height, matching #vp-chat/#vp-content visibility.
      var footerBase = document.getElementById('chatFooterBase');
      if (footerBase) footerBase.style.display = (targetPanel === 'chat') ? '' : 'none';

      paneAi.dataset.activePanel = targetPanel;

      if (targetPanel === 'chat') {
        var inp = document.getElementById('chatInput');
        if (inp) requestAnimationFrame(function () { inp.focus({ preventScroll: true }); });
      }
    };

    // ── Reference attachment (Content tab) ──────────────────────────────
    // Independent of the pack's own document (Slides tab / #mysShelll).
    // Renders only a file the student explicitly attaches here. In-memory
    // only — never uploaded, never persisted, never sent to the AI.
    (function () {
      var fileInput  = document.getElementById('aiRefFileInput');
      var attachBtn  = document.getElementById('aiRefAttachBtn');
      var removeBtn  = document.getElementById('aiRefRemove');
      var emptyEl    = document.getElementById('aiRefEmpty');
      var viewerEl   = document.getElementById('aiRefViewer');
      var canvasWrap = document.getElementById('aiRefCanvasWrap');
      var pagesEl    = document.getElementById('aiRefPages');
      var pageNumEl  = document.getElementById('aiRefPageNum');
      var pageCntEl  = document.getElementById('aiRefPageCount');
      var zoomLblEl  = document.getElementById('aiRefZoomLabel');
      var prevBtn    = document.getElementById('aiRefPrev');
      var nextBtn    = document.getElementById('aiRefNext');
      var zoomInBtn  = document.getElementById('aiRefZoomIn');
      var zoomOutBtn = document.getElementById('aiRefZoomOut');
      if (!fileInput || !attachBtn) return;

      var pdfDoc = null, scale = 1.0, objectUrl = null;
      var observer = null, renderGen = 0;
      var pageWraps = [], currentPage = 1, scrollRaf = null, renderedWidth = -1;

      // Secondary nav alongside the scrollable column — prev/next just
      // scroll the target page into view, they don't replace the column
      // with single-page rendering.
      function setCurrentPage(num) {
        currentPage = num;
        if (pageNumEl && document.activeElement !== pageNumEl) pageNumEl.value = num;
        prevBtn.disabled = num <= 1;
        nextBtn.disabled = !pdfDoc || num >= pdfDoc.numPages;
      }

      function updateCurrentPageFromScroll() {
        if (!pageWraps.length) return;
        var wrapRect = canvasWrap.getBoundingClientRect();
        var anchorY = wrapRect.top + wrapRect.height * 0.25;
        var best = 1, bestDist = Infinity;
        pageWraps.forEach(function (w, idx) {
          var dist = Math.abs(w.getBoundingClientRect().top - anchorY);
          if (dist < bestDist) { bestDist = dist; best = idx + 1; }
        });
        if (best !== currentPage) setCurrentPage(best);
      }

      function goToPage(num) {
        if (!pdfDoc) return;
        num = Math.max(1, Math.min(pdfDoc.numPages, num));
        var target = document.getElementById('aiRefPage-' + num);
        if (target) target.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }

      // Renders every page as its own canvas, stacked in a single scrollable
      // column (not page-by-page navigation) — pages render lazily as they
      // scroll into view, via IntersectionObserver, for large documents.
      function renderAllPages() {
        if (!pdfDoc) return;
        var gen = ++renderGen;
        var prevPage = currentPage;
        if (observer) { observer.disconnect(); observer = null; }
        pagesEl.innerHTML = '';

        pdfDoc.getPage(1).then(function (firstPage) {
          if (gen !== renderGen) return;
          var containerW = Math.max(canvasWrap.clientWidth - 16, 120);
          var baseViewport = firstPage.getViewport({ scale: 1 });
          var renderScale = (containerW / baseViewport.width) * scale;

          pageWraps = [];
          for (var i = 1; i <= pdfDoc.numPages; i++) {
            var w = document.createElement('div');
            w.className = 'ai-ref-page';
            w.id = 'aiRefPage-' + i;
            w.style.width = Math.floor(baseViewport.width * renderScale) + 'px';
            w.style.height = Math.floor(baseViewport.height * renderScale) + 'px';
            pagesEl.appendChild(w);
            pageWraps.push(w);
          }
          setCurrentPage(Math.max(1, Math.min(prevPage, pdfDoc.numPages)));
          renderedWidth = canvasWrap.clientWidth;

          var restoredPage = document.getElementById('aiRefPage-' + currentPage);
          if (restoredPage) restoredPage.scrollIntoView({ block: 'start' });

          var rendered = {};
          observer = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
              if (!entry.isIntersecting) return;
              var num = parseInt(entry.target.id.replace('aiRefPage-', ''), 10);
              if (rendered[num]) return;
              rendered[num] = true;
              observer.unobserve(entry.target);
              renderOnePage(num, entry.target, renderScale, gen);
            });
          }, { root: canvasWrap, rootMargin: '400px 0px' });

          pageWraps.forEach(function (w) { observer.observe(w); });
          zoomLblEl.textContent = Math.round(scale * 100) + '%';
        });
      }

      function renderOnePage(num, wrapEl, renderScale, gen) {
        pdfDoc.getPage(num).then(function (page) {
          if (gen !== renderGen) return;
          var viewport = page.getViewport({ scale: renderScale });
          var w = Math.floor(viewport.width);
          var h = Math.floor(viewport.height);

          wrapEl.style.setProperty('--scale-factor', renderScale);
          /* total-scale-factor sizes the text layer; must equal the CSS scale
             (renderScale), not renderScale * dpr, or spans land off-position. */
          wrapEl.style.setProperty('--total-scale-factor', renderScale);
          wrapEl.style.setProperty('--scale-round-x', '1px');
          wrapEl.style.setProperty('--scale-round-y', '1px');

          /* Canvas — render below text layer */
          var canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          canvas.style.pointerEvents = 'none';
          wrapEl.appendChild(canvas);
          page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport });

          /* Text layer — captures clicks for text selection */
          var textLayer = document.createElement('div');
          textLayer.className = 'textLayer';
          textLayer.style.width = w + 'px';
          textLayer.style.height = h + 'px';
          wrapEl.appendChild(textLayer);

          page.getTextContent().then(function(textContent) {
            if (gen !== renderGen || !textContent) return;
            var lib = window.pdfjsLib;
            if (!lib) return;
            if (typeof lib.TextLayer === 'function') {
              try {
                new lib.TextLayer({
                  textContentSource: page.streamTextContent(),
                  container: textLayer,
                  viewport: viewport,
                }).render();
              } catch(e) {}
            } else if (typeof lib.renderTextLayer === 'function') {
              lib.renderTextLayer({
                textContentSource: textContent,
                container: textLayer,
                viewport: viewport,
              });
            }
          });
        });
      }

      function loadPdf(url) {
        var lib = window.pdfjsLib;
        if (!lib) return;
        lib.getDocument(url).promise.then(function (doc) {
          pdfDoc = doc;
          pageCntEl.textContent = doc.numPages;
          scale = 1.0;
          currentPage = 1;
          renderAllPages();
        });
      }

      function loadImage(url) {
        pdfDoc = null;
        pageWraps = [];
        if (observer) { observer.disconnect(); observer = null; }
        pagesEl.innerHTML = '';
        var img = document.createElement('img');
        img.className = 'ai-ref-image';
        img.src = url;
        pagesEl.appendChild(img);
        pageCntEl.textContent = '1';
        zoomLblEl.textContent = '100%';
        setCurrentPage(1);
      }

      function attachFile(file) {
        if (!file) return;
        var ext = file.name.split('.').pop().toLowerCase();
        var isImg = ['png', 'jpg', 'jpeg', 'webp'].indexOf(ext) !== -1;
        if (ext !== 'pdf' && !isImg) return;

        if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
        objectUrl = URL.createObjectURL(file);

        emptyEl.style.display = 'none';
        viewerEl.style.display = 'flex';

        if (isImg) loadImage(objectUrl);
        else loadPdf(objectUrl);
      }

      function detach() {
        if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
        pdfDoc = null;
        pageWraps = [];
        renderGen++;
        if (observer) { observer.disconnect(); observer = null; }
        pagesEl.innerHTML = '';
        fileInput.value = '';
        viewerEl.style.display = 'none';
        emptyEl.style.display = '';
      }

      attachBtn.addEventListener('click', function () { fileInput.click(); });
      fileInput.addEventListener('change', function () {
        if (fileInput.files && fileInput.files.length) attachFile(fileInput.files[0]);
      });
      removeBtn.addEventListener('click', detach);
      prevBtn.addEventListener('click', function () { goToPage(currentPage - 1); });
      nextBtn.addEventListener('click', function () { goToPage(currentPage + 1); });
      zoomInBtn.addEventListener('click', function () { scale = Math.min(scale + 0.2, 3.0); if (pdfDoc) renderAllPages(); });
      zoomOutBtn.addEventListener('click', function () { scale = Math.max(scale - 0.2, 0.4); if (pdfDoc) renderAllPages(); });

      /* Page-number input — type a page and press Enter to jump */
      pageNumEl.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        var val = parseInt(pageNumEl.value, 10);
        if (!isNaN(val) && pdfDoc) goToPage(val);
        else pageNumEl.value = currentPage;
        pageNumEl.blur();
      });
      pageNumEl.addEventListener('blur', function () {
        pageNumEl.value = currentPage;
      });
      pageNumEl.addEventListener('input', function () {
        pageNumEl.value = pageNumEl.value.replace(/[^0-9]/g, '');
      });

      canvasWrap.addEventListener('scroll', function () {
        if (scrollRaf) return;
        scrollRaf = requestAnimationFrame(function () {
          scrollRaf = null;
          updateCurrentPageFromScroll();
        });
      });

      var resizeTimer;
      if (window.ResizeObserver) {
        new ResizeObserver(function () {
          if (!pdfDoc) return;
          var w = canvasWrap.clientWidth;
          if (w < 120) return; /* hidden (display:none / collapsed to 0) */
          if (Math.abs(w - renderedWidth) < 4) return; /* no meaningful change */
          clearTimeout(resizeTimer);
          resizeTimer = setTimeout(renderAllPages, 200);
        }).observe(canvasWrap);
      }
    })();

    /* ── AI ref pane text-selection toolbar ── */
    (function() {
      var refSelToolbar = document.getElementById('aiRefSelToolbar');
      var refCanvasWrap = document.getElementById('aiRefCanvasWrap');
      var refPages = document.getElementById('aiRefPages');
      if (!refSelToolbar || !refCanvasWrap || !refPages) return;

      var PACK_ID = window.PACK_ID || 0;
      var _lastRefSelText = '';

      var CSRF = (function() {
        var m = document.querySelector('meta[name="csrf-token"]');
        return m ? m.getAttribute('content') : '';
      })();

      function getSelectedText() {
        var sel = window.getSelection();
        return (sel && sel.toString() || '').trim();
      }

      function showRefSelToolbar(rect) {
        var margin = 8;
        var w = refSelToolbar.offsetWidth || 150;
        var h = refSelToolbar.offsetHeight || 40;
        var x = Math.max(margin, Math.min(rect.left + window.scrollX + rect.width / 2 - 80, window.innerWidth - w - margin));
        var below = rect.bottom + window.scrollY + margin;
        var above = rect.top + window.scrollY - h - margin;
        var y = (below + h <= window.innerHeight - margin) ? below : Math.max(margin, above);
        refSelToolbar.style.display = 'flex';
        refSelToolbar.style.left = x + 'px';
        refSelToolbar.style.top = y + 'px';
      }

      function hideRefSelToolbar() {
        refSelToolbar.style.display = 'none';
      }

      function isInsideRefPane(el) {
        while (el) {
          if (el === refPages || el === refCanvasWrap) return true;
          el = el.parentNode;
        }
        return false;
      }

      function fallbackCopy(text) {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        ta.style.pointerEvents = 'none';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch(e) {}
        document.body.removeChild(ta);
      }

      function showCopyToast() {
        var toast = document.getElementById('aiRefSelToast');
        if (!toast) return;
        toast.classList.add('show');
        setTimeout(function() { toast.classList.remove('show'); }, 1500);
      }

      function expandSelectionToBlock(sel) {
        if (!sel || !sel.rangeCount) return;
        try {
          if (typeof sel.modify === 'function') {
            try {
              sel.modify('move', 'backward', 'paragraphboundary');
              sel.modify('extend', 'forward', 'paragraphboundary');
            } catch(e) {
              sel.modify('move', 'backward', 'lineboundary');
              sel.modify('extend', 'forward', 'lineboundary');
            }
          }
        } catch(e) {}
      }

      var hideRefSelTimer = null;

      document.addEventListener('mouseup', function(e) {
        if (!isInsideRefPane(e.target)) { hideRefSelToolbar(); return; }

        var isTripleClick = e.detail === 3;
        clearTimeout(hideRefSelTimer);
        setTimeout(function() {
          var sel = window.getSelection();
          if (isTripleClick && sel) expandSelectionToBlock(sel);
          var text = getSelectedText();
          if (text.length < 3 || !sel || !sel.rangeCount) { hideRefSelToolbar(); return; }
          _lastRefSelText = text;
          var rect = sel.getRangeAt(0).getBoundingClientRect();
          showRefSelToolbar(rect);
        }, 10);
      });

      document.addEventListener('mousedown', function(e) {
        if (refSelToolbar.contains(e.target)) return;
        hideRefSelTimer = setTimeout(hideRefSelToolbar, 150);
      });

      document.getElementById('aiRefSelCopy').addEventListener('click', function() {
        var text = _lastRefSelText || getSelectedText();
        if (!text) return;
        if (navigator.clipboard) {
          navigator.clipboard.writeText(text).catch(function() { fallbackCopy(text); });
        } else {
          fallbackCopy(text);
        }
        showCopyToast();
        hideRefSelToolbar();
      });

      document.getElementById('aiRefSelExplain').addEventListener('click', function() {
        var text = _lastRefSelText || getSelectedText();
        if (!text) return;
        hideRefSelToolbar();
        if (window.getSelection) window.getSelection().removeAllRanges();
        if (typeof autoSendToChat === 'function') {
          autoSendToChat(text + '\n\nExplain this.');
        }
      });

      document.getElementById('aiRefSelAsk').addEventListener('click', function() {
        var text = _lastRefSelText || getSelectedText();
        if (!text) return;
        hideRefSelToolbar();
        if (window.getSelection) window.getSelection().removeAllRanges();
        if (typeof window.setChatContext === 'function') {
          window.setChatContext(text);
        }
        if (window.toggleAiPane) window.toggleAiPane(false);
        var chatInput = document.getElementById('chatInput');
        if (chatInput) { chatInput.value = ''; chatInput.focus(); }
      });

      document.getElementById('aiRefSelFlashcard').addEventListener('click', function() {
        var text = _lastRefSelText || getSelectedText();
        if (!text) return;
        hideRefSelToolbar();
        if (window.getSelection) window.getSelection().removeAllRanges();
        if (typeof showToast === 'function') showToast('Generating flashcard\u2026', 'info');
        fetch('/api/notes/make-card-for-pack', {
          method: 'POST',
          headers: { 'X-CSRFToken': CSRF, 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: text, pack_id: PACK_ID }),
        }).then(function(r) { return r.json(); }).then(function(data) {
          if (data.ok && Array.isArray(data.cards) && data.cards.length) {
            if (typeof showToast === 'function') showToast(data.cards.length > 1 ? (data.cards.length + ' flashcards created!') : '\uD83C\uDF83 Flashcard created!', 'info');
            if (window._fcCards && Array.isArray(window._fcCards)) {
              var newIndex = window._fcCards.length;
              var seenKeys = {};
              window._fcCards.forEach(function (c) {
                var k = (window._dedupKey || function(){ return ''; })(c, 'flashcards');
                if (k) seenKeys[k] = true;
              });
              data.cards.forEach(function (c) {
                var k = (window._dedupKey || function(){ return ''; })(c, 'flashcards');
                if (k && seenKeys[k]) return;
                if (k) seenKeys[k] = true;
                window._fcCards.push({ front: c.front, back: c.back });
              });
              if (typeof window._fcInitDeck === 'function') window._fcInitDeck(window._fcCards);
              if (typeof window._fcLoad === 'function') window._fcLoad(newIndex);
            }
          } else {
            if (typeof showToast === 'function') showToast('Error: ' + (data.error || 'Unknown'), 'info');
          }
        }).catch(function() {
          if (typeof showToast === 'function') showToast('Could not create flashcard', 'info');
        });
      });
    })();

    /* ── Notes tab text-selection toolbar ── */
    (function() {
      var notesToolbar = document.getElementById('notesSelToolbar');
      if (!notesToolbar) return;

      var PACK_ID = window.PACK_ID || 0;
      var _lastNotesSelText = '';

      var CSRF = (function() {
        var m = document.querySelector('meta[name="csrf-token"]');
        return m ? m.getAttribute('content') : '';
      })();

      function getSelectedText() {
        var sel = window.getSelection();
        return (sel && sel.toString() || '').trim();
      }

      function showNotesToolbar(rect) {
        var margin = 8;
        var w = notesToolbar.offsetWidth || 150;
        var h = notesToolbar.offsetHeight || 40;
        var x = Math.max(margin, Math.min(rect.left + window.scrollX + rect.width / 2 - 80, window.innerWidth - w - margin));
        var below = rect.bottom + window.scrollY + margin;
        var above = rect.top + window.scrollY - h - margin;
        var y = (below + h <= window.innerHeight - margin) ? below : Math.max(margin, above);
        notesToolbar.style.display = 'flex';
        notesToolbar.style.left = x + 'px';
        notesToolbar.style.top = y + 'px';
      }

      function hideNotesToolbar() {
        notesToolbar.style.display = 'none';
      }

      function isInsideNotesTab(el) {
        while (el) {
          if (el.classList && (el.classList.contains('notes-prosemirror') || el.classList.contains('notes-editor-wrap'))) return true;
          el = el.parentNode;
        }
        return false;
      }

      function fallbackCopy(text) {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        ta.style.pointerEvents = 'none';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch(e) {}
        document.body.removeChild(ta);
      }

      function showCopyToast() {
        var toast = document.getElementById('notesSelToast');
        if (!toast) return;
        toast.classList.add('show');
        setTimeout(function() { toast.classList.remove('show'); }, 1500);
      }

      var hideNotesTimer = null;

      document.addEventListener('mouseup', function(e) {
        if (!isInsideNotesTab(e.target)) { hideNotesToolbar(); return; }

        clearTimeout(hideNotesTimer);
        setTimeout(function() {
          var sel = window.getSelection();
          var text = getSelectedText();
          if (text.length < 3 || !sel || !sel.rangeCount) { hideNotesToolbar(); return; }
          _lastNotesSelText = text;
          var rect = sel.getRangeAt(0).getBoundingClientRect();
          showNotesToolbar(rect);
        }, 10);
      });

      document.addEventListener('mousedown', function(e) {
        if (notesToolbar.contains(e.target)) return;
        hideNotesTimer = setTimeout(hideNotesToolbar, 150);
      });

      document.getElementById('notesSelCopy').addEventListener('click', function() {
        var text = _lastNotesSelText || getSelectedText();
        if (!text) return;
        if (navigator.clipboard) {
          navigator.clipboard.writeText(text).catch(function() { fallbackCopy(text); });
        } else {
          fallbackCopy(text);
        }
        showCopyToast();
        hideNotesToolbar();
      });

      document.getElementById('notesSelExplain').addEventListener('click', function() {
        var text = _lastNotesSelText || getSelectedText();
        if (!text) return;
        hideNotesToolbar();
        if (window.getSelection) window.getSelection().removeAllRanges();
        if (typeof autoSendToChat === 'function') {
          autoSendToChat(text + '\n\nExplain this.');
        }
      });

      document.getElementById('notesSelAsk').addEventListener('click', function() {
        var text = _lastNotesSelText || getSelectedText();
        if (!text) return;
        hideNotesToolbar();
        if (window.getSelection) window.getSelection().removeAllRanges();
        if (typeof window.setChatContext === 'function') {
          window.setChatContext(text);
        }
        if (window.toggleAiPane) window.toggleAiPane(false);
        var chatInput = document.getElementById('chatInput');
        if (chatInput) { chatInput.value = ''; chatInput.focus(); }
      });

      document.getElementById('notesSelFlashcard').addEventListener('click', function() {
        var text = _lastNotesSelText || getSelectedText();
        if (!text) return;
        hideNotesToolbar();
        if (window.getSelection) window.getSelection().removeAllRanges();
        if (typeof showToast === 'function') showToast('Generating flashcard\u2026', 'info');
        fetch('/api/notes/make-card-for-pack', {
          method: 'POST',
          headers: { 'X-CSRFToken': CSRF, 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: text, pack_id: PACK_ID }),
        }).then(function(r) { return r.json(); }).then(function(data) {
          if (data.ok && Array.isArray(data.cards) && data.cards.length) {
            if (typeof showToast === 'function') showToast(data.cards.length > 1 ? (data.cards.length + ' flashcards created!') : '\uD83C\uDF83 Flashcard created!', 'info');
            if (window._fcCards && Array.isArray(window._fcCards)) {
              var newIndex = window._fcCards.length;
              var seenKeys = {};
              window._fcCards.forEach(function (c) {
                var k = (window._dedupKey || function(){ return ''; })(c, 'flashcards');
                if (k) seenKeys[k] = true;
              });
              data.cards.forEach(function (c) {
                var k = (window._dedupKey || function(){ return ''; })(c, 'flashcards');
                if (k && seenKeys[k]) return;
                if (k) seenKeys[k] = true;
                window._fcCards.push({ front: c.front, back: c.back });
              });
              if (typeof window._fcInitDeck === 'function') window._fcInitDeck(window._fcCards);
              if (typeof window._fcLoad === 'function') window._fcLoad(newIndex);
            }
          } else {
            if (typeof showToast === 'function') showToast('Error: ' + (data.error || 'Unknown'), 'info');
          }
        }).catch(function() {
          if (typeof showToast === 'function') showToast('Could not create flashcard', 'info');
        });
      });
    })();

    /* ── Guide tab text-selection toolbar ── */
    (function() {
      var guideToolbar = document.getElementById('guideSelToolbar');
      if (!guideToolbar) return;

      var PACK_ID = window.PACK_ID || window.__PACK_ID__ || 0;
      var _lastGuideSelText = '';

      var CSRF = (function() {
        var m = document.querySelector('meta[name="csrf-token"]');
        return m ? m.getAttribute('content') : '';
      })();

      function getSelectedText() {
        var sel = window.getSelection();
        return (sel && sel.toString() || '').trim();
      }

      function showGuideToolbar(rect) {
        var margin = 8;
        var w = guideToolbar.offsetWidth || 150;
        var h = guideToolbar.offsetHeight || 40;
        var x = Math.max(margin, Math.min(rect.left + window.scrollX + rect.width / 2 - 80, window.innerWidth - w - margin));
        var below = rect.bottom + window.scrollY + margin;
        var above = rect.top + window.scrollY - h - margin;
        var y = (below + h <= window.innerHeight - margin) ? below : Math.max(margin, above);
        guideToolbar.style.display = 'flex';
        guideToolbar.style.left = x + 'px';
        guideToolbar.style.top = y + 'px';
      }

      function hideGuideToolbar() {
        guideToolbar.style.display = 'none';
      }

      function isInsideGuideText(el) {
        while (el) {
          if (el.classList && el.classList.contains('guided-study-text')) return true;
          el = el.parentNode;
        }
        return false;
      }

      function fallbackCopy(text) {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        ta.style.pointerEvents = 'none';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch(e) {}
        document.body.removeChild(ta);
      }

      function showCopyToast() {
        var toast = document.getElementById('guideSelToast');
        if (!toast) return;
        toast.classList.add('show');
        setTimeout(function() { toast.classList.remove('show'); }, 1500);
      }

      var hideGuideTimer = null;

      document.addEventListener('mouseup', function(e) {
        if (!isInsideGuideText(e.target)) { hideGuideToolbar(); return; }

        clearTimeout(hideGuideTimer);
        setTimeout(function() {
          var sel = window.getSelection();
          var text = getSelectedText();
          if (text.length < 3 || !sel || !sel.rangeCount) { hideGuideToolbar(); return; }
          _lastGuideSelText = text;
          var rect = sel.getRangeAt(0).getBoundingClientRect();
          showGuideToolbar(rect);
        }, 10);
      });

      document.addEventListener('mousedown', function(e) {
        if (guideToolbar.contains(e.target)) return;
        hideGuideTimer = setTimeout(hideGuideToolbar, 150);
      });

      document.getElementById('guideSelCopy').addEventListener('click', function() {
        var text = _lastGuideSelText || getSelectedText();
        if (!text) return;
        if (navigator.clipboard) {
          navigator.clipboard.writeText(text).catch(function() { fallbackCopy(text); });
        } else {
          fallbackCopy(text);
        }
        showCopyToast();
        hideGuideToolbar();
      });

      document.getElementById('guideSelExplain').addEventListener('click', function() {
        var text = _lastGuideSelText || getSelectedText();
        if (!text) return;
        hideGuideToolbar();
        if (window.getSelection) window.getSelection().removeAllRanges();
        if (typeof autoSendToChat === 'function') {
          autoSendToChat(text + '\n\nExplain this.');
        }
      });

      document.getElementById('guideSelAsk').addEventListener('click', function() {
        var text = _lastGuideSelText || getSelectedText();
        if (!text) return;
        hideGuideToolbar();
        if (window.getSelection) window.getSelection().removeAllRanges();
        if (typeof window.setChatContext === 'function') {
          window.setChatContext(text);
        }
        if (window.toggleAiPane) window.toggleAiPane(false);
        var chatInput = document.getElementById('chatInput');
        if (chatInput) { chatInput.value = ''; chatInput.focus(); }
      });

      document.getElementById('guideSelFlashcard').addEventListener('click', function() {
        var text = _lastGuideSelText || getSelectedText();
        if (!text) return;
        hideGuideToolbar();
        if (window.getSelection) window.getSelection().removeAllRanges();
        if (typeof showToast === 'function') showToast('Generating flashcard\u2026', 'info');
        fetch('/api/notes/make-card-for-pack', {
          method: 'POST',
          headers: { 'X-CSRFToken': CSRF, 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: text, pack_id: PACK_ID }),
        }).then(function(r) { return r.json(); }).then(function(data) {
          if (data.ok && Array.isArray(data.cards) && data.cards.length) {
            if (typeof showToast === 'function') showToast(data.cards.length > 1 ? (data.cards.length + ' flashcards created!') : '\uD83C\uDF83 Flashcard created!', 'info');
            if (window._fcCards && Array.isArray(window._fcCards)) {
              var newIndex = window._fcCards.length;
              var seenKeys = {};
              window._fcCards.forEach(function (c) {
                var k = (window._dedupKey || function(){ return ''; })(c, 'flashcards');
                if (k) seenKeys[k] = true;
              });
              data.cards.forEach(function (c) {
                var k = (window._dedupKey || function(){ return ''; })(c, 'flashcards');
                if (k && seenKeys[k]) return;
                if (k) seenKeys[k] = true;
                window._fcCards.push({ front: c.front, back: c.back });
              });
              if (typeof window._fcInitDeck === 'function') window._fcInitDeck(window._fcCards);
              if (typeof window._fcLoad === 'function') window._fcLoad(newIndex);
            }
          } else {
            if (typeof showToast === 'function') showToast('Error: ' + (data.error || 'Unknown'), 'info');
          }
        }).catch(function() {
          if (typeof showToast === 'function') showToast('Could not create flashcard', 'info');
        });
      });
    })();

    /* ── Mic / voice input ── */
    (function() {
      var micBtn = document.getElementById('chatMicBtn');
      var chatInput = document.getElementById('chatInput');
      if (!micBtn || !chatInput) return;

      var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) { micBtn.style.display = 'none'; return; }

      var recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      var isFinal = false;

      micBtn.addEventListener('click', function() {
        if (micBtn.classList.contains('is-recording')) {
          recognition.stop();
          return;
        }
        isFinal = false;
        try { recognition.start(); } catch(e) {}
      });

      recognition.onresult = function(e) {
        var transcript = '';
        var finalTranscript = '';
        for (var i = e.resultIndex; i < e.results.length; i++) {
          transcript += e.results[i][0].transcript;
          if (e.results[i].isFinal) finalTranscript += e.results[i][0].transcript;
        }
        chatInput.value = transcript;
        chatInput.dispatchEvent(new Event('input', { bubbles: true }));
      };

      recognition.onstart = function() {
        micBtn.classList.add('is-recording');
        micBtn.setAttribute('aria-label', 'Stop recording');
      };

      recognition.onend = function() {
        micBtn.classList.remove('is-recording');
        micBtn.setAttribute('aria-label', 'Voice input');
      };

      recognition.onerror = function(e) {
        micBtn.classList.remove('is-recording');
        micBtn.setAttribute('aria-label', 'Voice input');
        if (e && e.error === 'not-allowed') {
          showToast('Microphone access denied. Allow mic permissions in your browser to use voice input.');
        } else if (e && e.error === 'no-speech') {
          showToast('No speech detected. Please try again.');
        }
      };
    })();

    window.toggleAiPane = function(forceState) {
      var paneAi   = document.getElementById('paneAi');
      var paneMain = document.getElementById('paneMain');
      var roomWrap = document.getElementById('roomWrap');
      var mainContent = document.getElementById('main-content');
      var tab      = document.getElementById('aiToggleTab');

      if (!paneAi) return;

      if (forceState === true)  _aiPaneCollapsed = true;
      else if (forceState === false) _aiPaneCollapsed = false;
      else _aiPaneCollapsed = !_aiPaneCollapsed;

      if (_aiPaneCollapsed) {
        paneAi.classList.add('ai-collapsed');
        paneAi.classList.remove('show');
        if (paneMain) paneMain.classList.add('ai-pane-hidden');
        if (roomWrap) roomWrap.classList.add('ai-pane-hidden');
        if (mainContent) {
          mainContent.classList.remove('with-ai-panel', 'ai-panel-is-open');
          mainContent.style.marginRight = '0px';
          mainContent.style.width = '100%';
        }
        if (tab) tab.classList.add('ai-expand-tab');
        syncAiToggleIcons(true);
        // Move focus out before hiding — aria-hidden on a focused element is illegal
        if (paneAi.contains(document.activeElement)) {
          document.activeElement.blur();
        }
        paneAi.setAttribute('aria-hidden', 'true');
        paneAi.setAttribute('inert', '');
      } else {
        paneAi.classList.remove('ai-collapsed');
        paneAi.classList.add('show');
        if (paneMain) paneMain.classList.remove('ai-pane-hidden');
        if (roomWrap) roomWrap.classList.remove('ai-pane-hidden');
        if (mainContent) {
          mainContent.classList.add('with-ai-panel', 'ai-panel-is-open');
          var sidebarWidth = Math.round(paneAi.getBoundingClientRect().width || 0);
          if (sidebarWidth > 0) {
            mainContent.style.marginRight = sidebarWidth + 'px';
            mainContent.style.width = 'calc(100% - ' + sidebarWidth + 'px)';
          }
        }
        if (tab) tab.classList.remove('ai-expand-tab');
        syncAiToggleIcons(false);
        paneAi.removeAttribute('aria-hidden');
        paneAi.removeAttribute('inert');
      }
    };

    syncAiToggleIcons(_aiPaneCollapsed);

    // Mobile: start with AI panel collapsed (hidden)
    if (window.innerWidth <= 768) {
      window.toggleAiPane(true);
    }

    window.switchRoomTab = function (btn, targetId) {
      if (_activeRoom === targetId) return;
      _activeRoom = targetId;

      var titleMap = {
        'tab-upload': 'My Slides',
        'tab-video': 'Video',
        'tab-notes': 'Notes',
        'tab-flashcards': 'Flashcards',
        'tab-quiz': 'Quiz',
        'tab-more': 'Fill In',
        'tab-voice': 'AI Tutor'
      };
      var titleEl = document.getElementById('srTopbarTitle');
      var vidRow  = document.getElementById('srTopbarVidRow');
      if (targetId === 'tab-video') {
        if (titleEl) titleEl.style.display = 'none';
        if (vidRow) vidRow.style.display = 'flex';
// Sync counter on tab switch
(function() {
  var playlist = document.getElementById('vtPlaylist');
  if (!playlist) return;
  var items = Array.from(playlist.querySelectorAll('li'));
  var activeIdx = items.findIndex(function(li) { return li.dataset.active === '1'; });
  if (activeIdx === -1) activeIdx = 0;
  var prevBtn = document.getElementById('vidPrevBtn');
  var nextBtn = document.getElementById('vidNextBtn');
  var counter = document.getElementById('vidCounter');
  if (counter) counter.textContent = (activeIdx + 1) + '/' + items.length;
})();
      } else {
        if (titleEl && titleMap[targetId]) {
          titleEl.style.display = '';
          titleEl.textContent = titleMap[targetId];
        }
        if (vidRow) vidRow.style.display = 'none';
      }

      if (_AI_COLLAPSE_TABS.indexOf(targetId) !== -1) {
        window.toggleAiPane(true);
      } else if (_aiPaneCollapsed && window.innerWidth > 768) {
        window.toggleAiPane(false);
      }

      // deactivate buttons + aria
      document.querySelectorAll('.room-tab-btn').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      if (btn) {
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
      }

      // hide all panes
      document.querySelectorAll('.room-vp').forEach(p => p.classList.remove('room-vp--active'));

      // show target pane
      const target = document.getElementById(targetId);
      if (target) target.classList.add('room-vp--active');
    };

    // keyboard navigation for tablist
    var _tabBar = document.getElementById('mobileRoomTabs');
    if (_tabBar) {
      _tabBar.addEventListener('keydown', function(e) {
        var tabs = Array.from(this.querySelectorAll('[role="tab"]'));
        var current = tabs.findIndex(function(t) { return t.getAttribute('aria-selected') === 'true'; });
        if (current === -1) current = 0;
        var idx;
        if (e.key === 'ArrowRight') {
          idx = (current + 1) % tabs.length;
        } else if (e.key === 'ArrowLeft') {
          idx = (current - 1 + tabs.length) % tabs.length;
        } else if (e.key === 'Home') {
          idx = 0;
        } else if (e.key === 'End') {
          idx = tabs.length - 1;
        } else {
          return;
        }
        e.preventDefault();
        var target = tabs[idx];
        window.switchRoomTab(target, target.getAttribute('data-target'));
      });
    }

  })();

  // Move pane-ai, toggle, and the mobile FAB to body on mobile so z-index beats the
  // drawer stacking context and so the FAB's position:fixed isn't trapped inside
  // pane-ai's collapsed translateY(100%) transform (or its inert subtree).
  ;(function() {
    if (window.innerWidth > 860) return;
    var paneAi = document.getElementById('paneAi');
    var toggleTab = document.getElementById('aiToggleTab');
    var fabAi = document.querySelector('.fab-ai');
    if (paneAi && paneAi.parentNode && paneAi.parentNode !== document.body) {
      document.body.appendChild(paneAi);
    }
    if (toggleTab && toggleTab.parentNode && toggleTab.parentNode !== document.body) {
      document.body.appendChild(toggleTab);
    }
    if (fabAi && fabAi.parentNode && fabAi.parentNode !== document.body) {
      document.body.appendChild(fabAi);
    }

    // Click outside collapses the pane
    document.addEventListener('click', function(e) {
      if (!paneAi) return;
      if (paneAi.classList.contains('ai-collapsed')) return;
      if (paneAi.contains(e.target)) return;
      // Target was detached from DOM during event handling (e.g. sendBtn.innerHTML swap).
      // It was likely inside paneAi before detachment — don't collapse.
      if (!document.contains(e.target)) return;
      if (toggleTab && toggleTab.contains(e.target)) return;
      var topbarAiBtn = document.getElementById('srAiToggleBtn');
      if (topbarAiBtn && topbarAiBtn.contains(e.target)) return;
      var fabAi = document.querySelector('.fab-ai');
      if (fabAi && fabAi.contains(e.target)) return;
      window.toggleAiPane(true);
    });
  })();

  document.addEventListener('DOMContentLoaded', function () {
    var params = new URLSearchParams(window.location.search);
    var defaultId = params.get('open_notes') === '1' ? 'tab-notes' : (window._defaultTabId || 'tab-upload');
    var btn = document.querySelector('[data-target="' + defaultId + '"]');
    if (btn && !btn.classList.contains('active')) {
      if (typeof window.switchRoomTab === 'function') {
        window.switchRoomTab(btn, defaultId);
      } else {
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        var pane = document.getElementById(defaultId);
        if (pane) pane.classList.add('room-vp--active');
      }
    }
  });


    /* ── Share to Community ── */
    window._submitToCommunity = function() {
      var btn = document.getElementById('srShareCommunityBtn');
      var packId = window.PACK_ID;
      if (!packId) return;

      var confirmed = confirm(
        'Share this pack to the Motown community?\n\n' +
        'Your study materials (notes, flashcards, quizzes) will be visible ' +
        'to other students.\n\n' +
        'Your original slides/PDF will NOT be shared.'
      );
      if (!confirmed) return;

      if (btn) btn.disabled = true;

      var csrfToken = (
        typeof window._CSRF === 'function' ? window._CSRF() :
        typeof CSRF === 'function' ? CSRF() :
        typeof CSRF !== 'undefined' ? CSRF :
        (document.querySelector('meta[name="csrf-token"]') || {}).content || ''
      );
      fetch('/library/pack/' + packId + '/publish', {
        method: 'POST',
        headers: { 'X-CSRFToken': csrfToken },
      })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.status === 'completing') {
            alert(data.message || 'Your pack is being prepared. Please try again in a moment.');
            if (btn) btn.disabled = false;
          } else if (data.status === 'ok') {
            if (btn) {
              btn.title = 'Live on Discover';
              var badge = btn.querySelector('.sr-topbar-badge');
              if (!badge) {
                badge = document.createElement('span');
                badge.className = 'sr-topbar-badge';
                badge.style.background = '#22c55e';
                btn.appendChild(badge);
              }
              badge.textContent = '●';
            }
          } else {
            alert(data.error || 'Could not submit. Try again.');
            if (btn) btn.disabled = false;
          }
        })
        .catch(function() {
          alert('Network error. Please try again.');
          if (btn) btn.disabled = false;
        });
    };
})();
