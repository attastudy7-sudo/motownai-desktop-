// Offline progress queue — IndexedDB sync_queue + hybrid flush (online/visibilitychange + Background Sync).
// Exports MotownOfflineSync. Depends on MotownOfflineDB being loaded.

(function (global) {
  var BATCH = 25;
  var RETRY_MS = [1000, 5000, 30000];
  var FLUSH_INTERVAL_MS = 30000;

  function csrf() {
    var el = document.querySelector('meta[name="csrf-token"]');
    return el ? el.content : '';
  }

  function dedupeKey(packId, itemType, itemIndex, ts) {
    var rnd = Math.random().toString(36).slice(2, 8);
    var raw = packId + ':' + (itemType || 'x') + ':' + (itemIndex != null ? itemIndex : 'c') + ':' + (ts || Date.now()) + ':' + rnd;
    // small hash to keep key <=128 — use djb2
    var h = 5381;
    for (var i = 0; i < raw.length; i++) h = ((h << 5) + h) ^ raw.charCodeAt(i);
    return 'dk_' + (h >>> 0).toString(36) + '_' + raw.replace(/[^a-zA-Z0-9:_-]/g, '_').slice(0, 80);
  }

  async function enqueue(entry) {
    var DB = global.MotownOfflineDB;
    if (!DB) throw new Error('Offline DB not ready');
    var row = {
      packId: entry.packId,
      itemType: entry.itemType || null,
      itemIndex: entry.itemIndex != null ? entry.itemIndex : null,
      resourceId: entry.resourceId != null ? entry.resourceId : null,
      kind: entry.kind, // 'answer' | 'completion' | 'fsrs'
      payload: entry.payload || {},
      attemptCount: 0,
      createdAt: new Date().toISOString(),
      lastAttemptAt: null,
      status: 'pending',
      dedupeKey: entry.dedupeKey || dedupeKey(entry.packId, entry.itemType, entry.itemIndex, Date.now()),
    };
    var id = await DB.syncQueueAdd(row);
    row.id = id;
    // Best-effort: flush if online
    if (navigator.onLine) scheduleFlush(300);
    // Register Background Sync as enhancement (Chromium)
    try {
      if ('serviceWorker' in navigator && 'SyncManager' in window) {
        var reg = await navigator.serviceWorker.ready;
        if (reg.sync) await reg.sync.register('offline-progress');
      }
    } catch (_) {}
    return row;
  }

  async function flushOnce() {
    var DB = global.MotownOfflineDB;
    if (!DB || !navigator.onLine) return { flushed: 0 };
    var all = await DB.syncQueueGetAll();
    var pending = all.filter(function (r) { return r.status === 'pending' || r.status === 'failed'; });
    // Sort oldest first
    pending.sort(function (a, b) { return a.id - b.id; });
    if (!pending.length) return { flushed: 0 };

    var batch = pending.slice(0, BATCH);
    // Mark inflight optimistically
    for (var i = 0; i < batch.length; i++) {
      batch[i].status = 'inflight';
      batch[i].lastAttemptAt = new Date().toISOString();
      await DB.syncQueuePut(batch[i]);
    }

    var payload = {
      items: batch.map(function (b) {
        return {
          dedupeKey: b.dedupeKey,
          packId: b.packId,
          itemType: b.itemType,
          itemIndex: b.itemIndex,
          resourceId: b.resourceId,
          kind: b.kind,
          payload: b.payload,
          clientTs: b.createdAt,
        };
      }),
    };

    var r;
    try {
      r = await fetch('/api/sync/progress-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      });
    } catch (e) {
      // network failure — mark failed for retry
      for (var k = 0; k < batch.length; k++) {
        batch[k].status = 'failed';
        batch[k].attemptCount = (batch[k].attemptCount || 0) + 1;
        try { await DB.syncQueuePut(batch[k]); } catch (_) {}
      }
      throw e;
    }

    var data;
    try { data = await r.json(); } catch (_) { data = null; }
    if (!r.ok || !data || !data.ok) {
      for (var k2 = 0; k2 < batch.length; k2++) {
        batch[k2].status = 'failed';
        batch[k2].attemptCount = (batch[k2].attemptCount || 0) + 1;
        try { await DB.syncQueuePut(batch[k2]); } catch (_) {}
      }
      var msg = (data && data.error) || ('HTTP ' + r.status);
      throw new Error('sync batch failed: ' + msg);
    }

    var results = data.results || [];
    var byKey = {};
    results.forEach(function (res) { byKey[res.dedupeKey] = res; });

    var applied = 0;
    for (var j = 0; j < batch.length; j++) {
      var b = batch[j];
      var res = byKey[b.dedupeKey];
      if (!res) {
        b.status = 'failed';
        b.attemptCount = (b.attemptCount || 0) + 1;
        await DB.syncQueuePut(b);
        continue;
      }
      if (res.status === 'applied' || res.status === 'duplicate') {
        await DB.syncQueueDelete(b.id);
        applied++;
      } else if (res.status === 'error') {
        // Non-retriable 400s are dropped to avoid poison queue; mark failed and surface.
        var code = res.errorCode || '';
        var nonRetriable = code === 'pack_not_owned' || code === 'bad_request' || code === 'bad_item_type' || code === 'unknown_kind';
        if (nonRetriable) {
          console.warn('[offline-sync] dropping non-retriable item', b.dedupeKey, code);
          await DB.syncQueueDelete(b.id);
        } else {
          b.status = 'failed';
          b.attemptCount = (b.attemptCount || 0) + 1;
          b.lastErrorCode = code;
          await DB.syncQueuePut(b);
        }
      }
    }
    return { flushed: applied, total: batch.length };
  }

  var _timer = null;
  var _scheduled = null;
  function scheduleFlush(delayMs) {
    if (_scheduled) clearTimeout(_scheduled);
    _scheduled = setTimeout(function () { _scheduled = null; flushLoop().catch(function () {}); }, delayMs || 500);
  }

  async function flushLoop() {
    if (!navigator.onLine) return;
    try {
      var res = await flushOnce();
      if (res.flushed > 0 || res.total > 0) {
        // More pending — schedule another pass
        var DB2 = global.MotownOfflineDB;
        if (DB2) {
          var rest = await DB2.syncQueueGetAll();
          var more = rest.some(function (r) { return r.status === 'pending' || r.status === 'failed'; });
          if (more) scheduleFlush(800);
        }
      }
    } catch (e) {
      console.warn('[offline-sync] flush failed, will retry', e);
      scheduleFlush(RETRY_MS[0]);
    }
  }

  function bindEvents() {
    window.addEventListener('online', function () { scheduleFlush(300); });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && navigator.onLine) scheduleFlush(400);
    });
    // periodic poll while online and queue non-empty
    if (_timer) clearInterval(_timer);
    _timer = setInterval(function () {
      if (!navigator.onLine) return;
      var DB = global.MotownOfflineDB;
      if (!DB) return;
      DB.syncQueueGetAll().then(function (all) {
        var has = all.some(function (r) { return r.status === 'pending' || r.status === 'failed'; });
        if (has) scheduleFlush(200);
      }).catch(function () {});
    }, FLUSH_INTERVAL_MS);
  }

  // Wire offline-progress shim into existing study-room answer flows.
  // Call from study-room after IDB is ready: MotownOfflineSync.wireStudyRoom()
  function wireStudyRoom() {
    bindEvents();
    // Monkey-patch fetch for /api/question-answer and /api/item-answer to fall back to queue when offline.
    // We keep original fetch for online path; when navigator.onLine === false or fetch fails with TypeError,
    // we enqueue instead and resolve with a synthetic { ok: true, offline: true } so UI stays optimistic.
    var origFetch = window.fetch;
    if (window._offlineFetchPatched) return;
    window._offlineFetchPatched = true;
    window.fetch = function (url, init) {
      var s = typeof url === 'string' ? url : (url && url.url) || '';
      var isProgress = s.indexOf('/api/question-answer') !== -1 || s.indexOf('/api/item-answer') !== -1 || s.indexOf('/api/sync/progress-batch') !== -1;
      if (!isProgress) return origFetch.apply(this, arguments);
      // If offline, enqueue directly without hitting network
      if (!navigator.onLine) {
        try {
          var body = init && init.body ? JSON.parse(init.body) : {};
          var packId = body.pack_id || body.packId;
          var itemType = body.item_type || body.itemType || 'quiz';
          var qIdx = body.question_idx != null ? body.question_idx : (body.itemIndex != null ? body.itemIndex : body.question_idx);
          if (qIdx == null) qIdx = body.question_idx;
          enqueue({
            packId: packId,
            itemType: itemType,
            itemIndex: qIdx != null ? parseInt(qIdx, 10) : null,
            resourceId: body.resource_id || body.resourceId || null,
            kind: 'answer',
            payload: body,
          }).catch(function () {});
        } catch (_) {}
        return Promise.resolve(new Response(JSON.stringify({ ok: true, offline: true, queued: true, tier: 'queued', badges: null }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      // Online — try network, but on network failure fall back to queue
      return origFetch.apply(this, arguments).catch(function (err) {
        // TypeError network failure => queue
        var isNet = err && (err.name === 'TypeError' || /Failed to fetch|NetworkError/i.test(String(err.message || err)));
        if (!isNet) throw err;
        try {
          var b2 = init && init.body ? JSON.parse(init.body) : {};
          var pid2 = b2.pack_id || b2.packId;
          var it2 = b2.item_type || b2.itemType || 'quiz';
          var qi2 = b2.question_idx != null ? b2.question_idx : (b2.itemIndex != null ? b2.itemIndex : null);
          enqueue({ packId: pid2, itemType: it2, itemIndex: qi2 != null ? parseInt(qi2, 10) : null, resourceId: b2.resource_id || b2.resourceId || null, kind: 'answer', payload: b2 }).catch(function () {});
        } catch (_) {}
        return new Response(JSON.stringify({ ok: true, offline: true, queued: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      });
    };
  }

  global.MotownOfflineSync = {
    enqueue: enqueue,
    flushOnce: flushOnce,
    flushLoop: flushLoop,
    scheduleFlush: scheduleFlush,
    wireStudyRoom: wireStudyRoom,
    bindEvents: bindEvents,
    _dedupeKey: dedupeKey,
  };
})(typeof window !== 'undefined' ? window : globalThis);
