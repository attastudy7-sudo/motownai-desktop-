// Offline bootstrap — wires download + offline render + sync queue on study-room and downloads page.
// Loaded after db.js, persist.js, audio.js, version.js, quotas.js, download.js, sync-queue.js
// (all precached by SW v25). This file is the only entry point to include.

(function () {
  if (window._offlineBootstrapped) return;
  window._offlineBootstrapped = true;

  function byId(id) { return document.getElementById(id); }
  function packId() {
    if (typeof window.PACK_ID !== 'undefined' && window.PACK_ID) return window.PACK_ID;
    if (typeof window.STUDY_ROOM_CONFIG !== 'undefined' && window.STUDY_ROOM_CONFIG && window.STUDY_ROOM_CONFIG.packId) return window.STUDY_ROOM_CONFIG.packId;
    if (typeof window.__PACK_ID__ !== 'undefined' && window.__PACK_ID__) return window.__PACK_ID__;
    return null;
  }

  // 1. Wire sync queue (offline fetch patch + online flush) globally, once
  try {
    if (window.MotownOfflineSync) {
      window.MotownOfflineSync.wireStudyRoom();
      // SW -> page flush hint
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', function (e) {
          if (e.data && e.data.type === 'OFFLINE_SYNC_FLUSH' && window.MotownOfflineSync) {
            window.MotownOfflineSync.scheduleFlush(200);
          }
        });
      }
    }
  } catch (e) { console.warn('[offline-bootstrap] sync wire failed', e); }

  // 2. On study-room pages: inject Download button + offline bundle fallback
  var pid = packId();
  if (pid && window.MotownOfflineDB && window.MotownOfflineDownload) {
    ensurePackShell(pid);
  }

  // 3. On downloads page: render list
  if (document.getElementById('offlineDownloadsRoot')) {
    renderDownloadsPage();
  }

  // ── pack shell injection ──────────────────────────────────────────
  function ensurePackShell(pid) {
    var topbarRight = document.querySelector('.sr-topbar-right');
    // Avoid duplicate
    if (byId('offlineDownloadBtn')) return;

    // Gate: incognito / private — disable with tooltip
    var incognito = false;
    try {
      if (!navigator.storage || !window.indexedDB) incognito = true;
    } catch (_) { incognito = true; }

    var btn = document.createElement('button');
    btn.id = 'offlineDownloadBtn';
    btn.type = 'button';
    btn.className = 'sr-topbar-icon-btn offline-download-btn';
    btn.setAttribute('aria-label', incognito ? 'Offline not available in private browsing' : 'Download for offline use (in this browser)');
    btn.title = incognito ? 'Offline not available in private browsing' : 'Download for offline use (in this browser)';
    btn.innerHTML = incognito
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v-6"/><path d="M9 11l3 3 3-3"/><path d="M5 17a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2"/><line x1="2" y1="2" x2="22" y2="22"/></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17V3"/><path d="M7 12l5 5 5-5"/><path d="M3 17a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2"/></svg>';
    btn.style.position = 'relative';
    if (topbarRight) {
      // Insert before the AI toggle button if present, else append
      var aiBtn = byId('srAiToggleBtn');
      if (aiBtn && aiBtn.parentNode === topbarRight) topbarRight.insertBefore(btn, aiBtn);
      else topbarRight.appendChild(btn);
    }

    var statusEl = document.createElement('div');
    statusEl.id = 'offlineDownloadStatus';
    statusEl.setAttribute('role', 'status');
    statusEl.setAttribute('aria-live', 'polite');
    statusEl.style.cssText = 'font-size:11px;color:var(--text-muted);max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    // Place status under topbar title area if available
    var titleRow = document.querySelector('.sr-topbar-left');
    if (titleRow) titleRow.appendChild(statusEl);

    if (incognito) {
      btn.disabled = true;
      btn.style.opacity = '0.45';
      return;
    }

    // Reflect current download state
    window.MotownOfflineDB.getPack(pid).then(function (pack) {
      if (pack && pack.downloadState === 'ready') {
        btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>';
        btn.title = 'Downloaded for offline use — in this browser';
        if (statusEl) {
          var age = pack.downloadedAt ? new Date(pack.downloadedAt).toLocaleDateString() : '';
          statusEl.textContent = 'Downloaded' + (age ? ' · ' + age : '') + ' · In this browser';
        }
        // Footnote shown once
        showOnceFootnote(statusEl);
      } else {
        if (statusEl) statusEl.textContent = '';
      }
      // If not downloaded yet, wire click
      if (!pack || pack.downloadState !== 'ready') {
        window.MotownOfflineDownload.wireDownloadButton('offlineDownloadBtn', pid, {
          statusId: 'offlineDownloadStatus',
          onDone: function () {
            btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>';
            btn.title = 'Downloaded for offline use — in this browser';
            showOnceFootnote(statusEl);
          }
        });
      } else {
        // Already downloaded — click offers manage / re-check
        btn.addEventListener('click', function () {
          if (!confirm('This pack is downloaded for offline use in this browser. Go to Manage downloads to remove or re-download?')) return;
          window.location.href = '/library/downloads';
        });
      }
    }).catch(function () {
      // DB not ready yet — wire download anyway
      window.MotownOfflineDownload.wireDownloadButton('offlineDownloadBtn', pid, { statusId: 'offlineDownloadStatus' });
    });

    // If offline on load and pack is downloaded, inject cached data so the room renders without network
    if (!navigator.onLine) {
      hydrateFromOffline(pid);
    } else {
      // Still hydrate if offline bundle is fresher than network empty state? Don't block; only use when network bundle is empty.
      // We do a lazy check after the room's network data has had a moment to inject.
      setTimeout(function () { maybeHydrateIfEmpty(pid); }, 900);
    }
  }

  function showOnceFootnote(statusEl) {
    if (!statusEl) return;
    try {
      if (localStorage.getItem('motown-offline-footnote-shown')) return;
      localStorage.setItem('motown-offline-footnote-shown', '1');
    } catch (_) { return; }
    var note = document.createElement('div');
    note.style.cssText = 'font-size:11px;color:var(--text-muted);margin-top:4px;max-width:420px;line-height:1.4';
    note.textContent = 'Downloads live inside this browser — clearing site data for motownai.com will remove them.';
    statusEl.parentNode && statusEl.parentNode.appendChild(note);
  }

  function hydrateFromOffline(pid) {
    if (!window.MotownOfflineDownload) return;
    window.MotownOfflineDownload.getCachedBundle(pid).then(function (bundle) {
      if (!bundle || !bundle.ok) {
        showNotDownloaded(pid);
        return;
      }
      injectBundle(bundle);
    }).catch(function () { showNotDownloaded(pid); });
  }

  function maybeHydrateIfEmpty(pid) {
    // If the room injected zero cards but we have a cached bundle, use it.
    var hasCards = Array.isArray(window.FC_CARDS_RAW) && window.FC_CARDS_RAW.length > 0;
    var hasQuiz = Array.isArray(window.QZ_RAW) && window.QZ_RAW.length > 0;
    if (hasCards || hasQuiz) return;
    // No network data — try offline
    window.MotownOfflineDownload.getCachedBundle(pid).then(function (bundle) {
      if (!bundle || !bundle.ok) return;
      // Don't overwrite if server actually returned empty due to no generation yet
      var offCards = 0, offQuiz = 0;
      bundle.resources.forEach(function (r) {
        if (r.resourceType === 'flashcards' && r.content) {
          var inner = r.content.flashcards || r.content.cards || r.content;
          if (Array.isArray(inner)) offCards += inner.length;
          else if (inner && Array.isArray(inner.flashcards)) offCards += inner.flashcards.length;
        }
        if (r.resourceType === 'micro_quiz' && r.content) {
          var q = r.content.quiz || r.content.questions || r.content;
          if (Array.isArray(q)) offQuiz += q.length;
        }
      });
      if (offCards || offQuiz) injectBundle(bundle);
    }).catch(function () {});
  }

  function injectBundle(bundle) {
    // Map offline bundle resources back into the globals the study-room engines expect,
    // then re-init the engines. Keep shape compatible with PackResource.get_content().
    try {
      var flashcards = null, quiz = null, fillin = null, notes = null;
      bundle.resources.forEach(function (r) {
        if (r.resourceType === 'flashcards' && r.content) {
          var c = r.content.flashcards || r.content.cards || (Array.isArray(r.content) ? r.content : null);
          if (Array.isArray(c)) flashcards = c;
        }
        if (r.resourceType === 'micro_quiz' && r.content) {
          var q = r.content.quiz || r.content.questions || (Array.isArray(r.content) ? r.content : null);
          if (Array.isArray(q)) quiz = q;
        }
        if (r.resourceType === 'fill_in' && r.content) {
          var f = r.content.fill_in || r.content.fillIn || (Array.isArray(r.content) ? r.content : null);
          if (Array.isArray(f)) fillin = f;
        }
        if (r.resourceType === 'notes' && r.content) notes = r.content;
      });
      if (flashcards && flashcards.length) {
        window.FC_CARDS_RAW = flashcards;
        window._fcCards = flashcards;
        if (typeof window._fcInitDeck === 'function') window._fcInitDeck(flashcards);
        else if (typeof window.renderFlashcards === 'function') window.renderFlashcards(flashcards);
      }
      if (quiz && quiz.length) {
        window.QZ_RAW = quiz;
        window._qzData = quiz;
        if (typeof window.renderQuiz === 'function') window.renderQuiz(quiz);
      }
      if (fillin && fillin.length) {
        window.FI_RAW = fillin;
        window._fiData = fillin;
        // fill_in_engine re-renders on tab mount; nothing to force here
      }
      // Surface a subtle offline badge
      var statusEl = byId('offlineDownloadStatus');
      if (statusEl && navigator.onLine === false) statusEl.textContent = 'Offline — showing downloaded copy';
    } catch (e) { console.warn('[offline-bootstrap] inject failed', e); }
  }

  function showNotDownloaded(pid) {
    // Replace the usual empty-state gate with an explicit offline CTA
    var statusEl = byId('offlineDownloadStatus');
    if (statusEl) statusEl.textContent = 'Not downloaded yet — connect to download (est. ' + estimateForEmpty() + ')';
    // Inject into fcEmpty gate if present
    var fcGate = byId('fcGate');
    if (fcGate) {
      fcGate.innerHTML = '<div style="text-align:center;padding:12px"><div style="font-size:14px;font-weight:600;margin-bottom:6px">Offline pack not downloaded</div><div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">Connect to download this pack for offline study.</div><a href="/library/downloads" style="color:var(--primary)">Go to downloads</a></div>';
    }
    void pid;
  }

  function estimateForEmpty() { return 'a few MB'; }

  // ── downloads page ────────────────────────────────────────
  async function renderDownloadsPage() {
    var root = byId('offlineDownloadsRoot');
    if (!root) return;
    var DB = window.MotownOfflineDB;
    var Quota = window.MotownOfflineQuota;
    if (!DB) { root.innerHTML = '<p style="color:var(--text-muted)">Offline storage not available in this browser.</p>'; return; }

    async function refresh() {
      var packs = [];
      try { packs = await DB.getAllPacks(); } catch (_) { packs = []; }
      packs.sort(function (a, b) { return (b.downloadedAt || '').localeCompare(a.downloadedAt || ''); });
      var est = Quota ? await Quota.estimate() : { quota: null, usage: null };
      var quotaLine = '';
      if (est && est.quota) quotaLine = 'Using ' + Quota.formatBytes(est.usage) + ' of ' + Quota.formatBytes(est.quota) + ' (estimated)';
      else if (est && est.usage != null) quotaLine = 'Using ' + Quota.formatBytes(est.usage) + ' (estimated)';
      else quotaLine = '';

      if (!packs.length) {
        root.innerHTML = '<div style="text-align:center;padding:32px 16px;color:var(--text-muted)"><div style="font-size:20px;margin-bottom:8px">📚</div><div style="font-weight:600;margin-bottom:6px;color:var(--text-primary)">No packs downloaded</div><div>Open any pack and tap Download to study offline.</div><div style="margin-top:12px;font-size:12px">' + esc(quotaLine) + '</div><div style="margin-top:8px;font-size:11px;opacity:.75">Downloads live inside this browser — clearing site data for motownai.com will remove them.</div></div>';
        return;
      }

      var html = '<div style="margin-bottom:12px;font-size:12px;color:var(--text-muted)">' + esc(quotaLine) + '</div>';
      html += '<div style="display:grid;gap:10px">';
      packs.forEach(function (p) {
        var ver = p.packVersion ? esc(p.packVersion.slice(0, 12)) : '—';
        var age = p.downloadedAt ? new Date(p.downloadedAt).toLocaleDateString() : '—';
        var bytes = p.storageBytesEstimate ? Quota.formatBytes(p.storageBytesEstimate) : '—';
        html += '<div class="offline-pack-row" data-pack-id="' + p.packId + '" style="display:flex;gap:12px;align-items:center;padding:12px;border:1px solid var(--border, #e2e8f0);border-radius:12px;background:var(--bg-surface, #fff)">'
          + '<img src="' + escAttr(p.thumbnailUrl || '/static/images/new-logo.png') + '" alt="" style="width:56px;height:56px;object-fit:cover;border-radius:10px;flex-shrink:0"/>'
          + '<div style="flex:1;min-width:0"><div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(p.title || 'Pack ' + p.packId) + '</div>'
          + '<div style="font-size:12px;color:var(--text-muted)">' + esc(bytes) + ' · Downloaded ' + esc(age) + ' · ' + ver + '</div>'
          + '<div style="font-size:11px;color:var(--text-muted)">In this browser</div></div>'
          + '<div style="display:flex;gap:8px;flex-shrink:0"><a href="/library/pack/' + p.packId + '" class="gen-confirm-btn" style="padding:6px 10px;font-size:12px">Play offline</a>'
          + '<button type="button" class="gen-confirm-btn gen-confirm-btn--secondary offline-remove-btn" data-pack-id="' + p.packId + '" style="padding:6px 10px;font-size:12px">Remove</button></div>'
          + '</div>';
      });
      html += '</div>';
      html += '<div style="margin-top:10px;display:flex;gap:8px"><button type="button" id="offlineRemoveAllBtn" class="gen-confirm-btn gen-confirm-btn--secondary" style="font-size:12px">Remove all</button></div>';
      html += '<div style="margin-top:8px;font-size:11px;color:var(--text-muted)">Tip: For most reliable offline on iPhone, add Motown AI to your Home Screen.</div>';
      root.innerHTML = html;

      root.querySelectorAll('.offline-remove-btn').forEach(function (btn) {
        btn.addEventListener('click', async function () {
          var id = parseInt(btn.getAttribute('data-pack-id'), 10);
          if (!confirm('Remove offline copy of this pack? The server pack stays; already-synced progress is kept.')) return;
          if (window.MotownOfflineDownload) await window.MotownOfflineDownload.removePack(id);
          else await DB.deletePack(id);
          refresh();
        });
      });
      var allBtn = byId('offlineRemoveAllBtn');
      if (allBtn) allBtn.addEventListener('click', async function () {
        if (!confirm('Remove all offline packs?')) return;
        var all = await DB.getAllPacks();
        for (var i = 0; i < all.length; i++) {
          if (window.MotownOfflineDownload) await window.MotownOfflineDownload.removePack(all[i].packId);
          else await DB.deletePack(all[i].packId);
        }
        refresh();
      });
    }

    function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
    function escAttr(s) { return esc(s).replace(/"/g, '&quot;'); }

    refresh();
  }
})();
