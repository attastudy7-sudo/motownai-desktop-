// Download flow: fetch offline-bundle -> write IDB -> fetch audio manifests -> write OPFS/IDB.
// Exports MotownOfflineDownload

(function (global) {
  function csrf() {
    var el = document.querySelector('meta[name="csrf-token"]');
    return el ? el.content : '';
  }

  async function fetchBundle(packId, signal) {
    var r = await fetch('/api/packs/' + packId + '/offline-bundle', {
      headers: { 'X-CSRFToken': csrf() },
      credentials: 'same-origin',
      signal: signal,
    });
    if (!r.ok) throw new Error('bundle fetch failed: ' + r.status);
    return r.json();
  }

  async function downloadPack(packId, opts) {
    opts = opts || {};
    var onProgress = opts.onProgress || function () {};
    var signal = opts.signal || null;

    onProgress({ phase: 'fetch', pct: 5, msg: 'Fetching pack…' });
    var bundle = await fetchBundle(packId, signal);
    if (!bundle.ok) throw new Error(bundle.error || 'Bundle error');

    var pack = bundle.pack;
    var resources = bundle.resources || [];

    // Estimate bytes
    var totalBytes = resources.reduce(function (a, r) { return a + ((r.content ? JSON.stringify(r.content) : '').length || 0); }, 0);

    onProgress({ phase: 'store', pct: 30, msg: 'Saving study material…' });
    var DB = global.MotownOfflineDB;
    if (!DB) throw new Error('Offline DB not loaded');

    var now = new Date().toISOString();
    await DB.putPack({
      packId: pack.id,
      title: pack.title,
      topicSlug: pack.topicSlug,
      thumbnailUrl: pack.thumbnailUrl,
      subjectId: pack.subjectId,
      packVersion: pack.packVersion,
      updatedAt: pack.updatedAt,
      storageBytesEstimate: totalBytes,
      downloadState: 'ready',
      downloadedAt: now,
      lastCheckedAt: now,
      lastAccessedAt: now,
    });

    // Write resources — normalize groupIndex null -> -1 for key stability
    var rows = resources.map(function (r) {
      var gi = r.groupIndex == null ? -1 : r.groupIndex;
      return {
        packId: pack.id,
        resourceType: r.resourceType,
        groupIndex: gi,
        resourceId: r.id,
        packVersion: pack.packVersion,
        generationStatus: r.generationStatus,
        contentJson: r.content ? JSON.stringify(r.content) : null,
        contentHash: r.contentHash,
        updatedAt: r.updatedAt,
      };
    });
    await DB.putResources(rows);

    // Audio: if bundle.audioManifest has turns with audio URLs, fetch sequentially.
    // Phase-1 placeholder: audioManifest is empty (podcast via separate endpoint).
    // Keep hook for Phase-2: iterate bundle.audioManifest and call MotownOfflineAudio.put
    if (bundle.audioManifest && bundle.audioManifest.length && global.MotownOfflineAudio) {
      var Audio = global.MotownOfflineAudio;
      for (var i = 0; i < bundle.audioManifest.length; i++) {
        if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
        var turn = bundle.audioManifest[i];
        onProgress({ phase: 'audio', pct: 50 + Math.round((i / bundle.audioManifest.length) * 45), msg: 'Saving audio ' + (i + 1) + '/' + bundle.audioManifest.length });
        if (turn.url) {
          try {
            var ar = await fetch(turn.url, { signal: signal });
            if (ar.ok) {
              var blob = await ar.blob();
              await Audio.put(pack.id, i, blob);
            }
          } catch (e) { console.warn('[offline-download] audio turn failed', i, e); }
        } else if (turn.audioB64) {
          try {
            var bin = atob(turn.audioB64);
            var bytes = new Uint8Array(bin.length);
            for (var j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
            var b = new Blob([bytes], { type: 'audio/mpeg' });
            await Audio.put(pack.id, i, b);
          } catch (e) { console.warn('[offline-download] b64 turn failed', i, e); }
        }
      }
    }

    onProgress({ phase: 'done', pct: 100, msg: 'Ready for offline use' });

    // Persist hint (once)
    if (global.MotownOfflinePersist) {
      global.MotownOfflinePersist.ensurePersistedWithUI().catch(function () {});
    }

    return { pack: pack, resources: resources, totalBytes: totalBytes };
  }

  // Render cached resources back into the shape the study-room already injects
  async function getCachedBundle(packId) {
    var DB = global.MotownOfflineDB;
    if (!DB) return null;
    var pack = await DB.getPack(packId);
    if (!pack || pack.downloadState !== 'ready') return null;
    var resRows = await DB.getResourcesForPack(packId);
    // touch lastAccessed
    try { pack.lastAccessedAt = new Date().toISOString(); await DB.putPack(pack); } catch (_) {}
    var resources = resRows.map(function (r) {
      var content = null;
      try { content = r.contentJson ? JSON.parse(r.contentJson) : null; } catch (_) { content = null; }
      return { id: r.resourceId, resourceType: r.resourceType, groupIndex: r.groupIndex === -1 ? null : r.groupIndex, generationStatus: r.generationStatus, content: content, contentHash: r.contentHash, updatedAt: r.updatedAt };
    });
    return { ok: true, pack: { id: pack.packId, title: pack.title, topicSlug: pack.topicSlug, packVersion: pack.packVersion, updatedAt: pack.updatedAt, thumbnailUrl: pack.thumbnailUrl }, resources: resources, audioManifest: [], _offline: true };
  }

  async function removePack(packId) {
    var DB = global.MotownOfflineDB;
    if (DB) await DB.deletePack(packId);
    if (global.MotownOfflineAudio) {
      try { await global.MotownOfflineAudio.deletePack(packId); } catch (_) {}
    }
  }

  // Wire a download button by id: shows progress, handles quota + errors
  function wireDownloadButton(btnId, packId, opts) {
    var btn = document.getElementById(btnId);
    if (!btn || btn._offlineWired) return;
    btn._offlineWired = true;
    var statusEl = opts && opts.statusId ? document.getElementById(opts.statusId) : null;
    var onDone = opts && opts.onDone ? opts.onDone : null;
    btn.addEventListener('click', async function () {
      if (btn.disabled) return;
      // amber/red check via quota
      if (global.MotownOfflineQuota) {
        try {
          var est = await global.MotownOfflineQuota.estimate();
          var lvl = global.MotownOfflineQuota.level(est);
          if (lvl === 'red') {
            alert('Storage is full — remove a downloaded pack before downloading another.');
            window.location.href = '/library/downloads';
            return;
          }
          if (lvl === 'amber') {
            var ok = confirm('Storage is getting full. Download anyway? You can remove packs in Manage downloads.');
            if (!ok) return;
          }
        } catch (_) {}
      }
      btn.disabled = true;
      var orig = btn.textContent;
      btn.textContent = 'Downloading…';
      if (statusEl) statusEl.textContent = 'Fetching pack…';
      var ctrl = new AbortController();
      try {
        await downloadPack(packId, {
          signal: ctrl.signal,
          onProgress: function (p) {
            if (statusEl) statusEl.textContent = p.msg + ' ' + p.pct + '%';
            btn.textContent = p.msg;
          },
        });
        btn.textContent = '✓ Downloaded';
        if (statusEl) statusEl.textContent = 'Ready for offline use — in this browser';
        // First-download tip per plan
        try {
          if (!localStorage.getItem('motown-offline-first-download-tip')) {
            localStorage.setItem('motown-offline-first-download-tip', '1');
            // Persist banner is shown by downloadPack; this is the sandbox footnote
          }
        } catch (_) {}
        if (typeof onDone === 'function') onDone();
      } catch (e) {
        if (e && e.name === 'AbortError') {
          btn.textContent = orig;
          if (statusEl) statusEl.textContent = 'Cancelled';
        } else if (e && /QuotaExceeded/i.test(String(e.message || e))) {
          if (statusEl) statusEl.textContent = 'Storage full — remove a downloaded pack and try again.';
          btn.textContent = 'Storage full';
        } else {
          console.warn('[offline-download] failed', e);
          if (statusEl) statusEl.textContent = 'Download failed — check connection and try again.';
          btn.textContent = orig;
        }
        btn.disabled = false;
        return;
      }
      setTimeout(function () { btn.disabled = false; btn.textContent = 'Downloaded ✓'; }, 1200);
    });
  }

  global.MotownOfflineDownload = { downloadPack: downloadPack, getCachedBundle: getCachedBundle, removePack: removePack, fetchBundle: fetchBundle, wireDownloadButton: wireDownloadButton };
})(typeof window !== 'undefined' ? window : globalThis);
