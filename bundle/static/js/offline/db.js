// Offline IDB layer — motown-offline DB, schema v1
// No external deps; thin Promise wrapper around indexedDB API.
// Exposes: openDB(), getPack, putPack, deletePack, getAllPacks, etc.

(function (global) {
  var DB_NAME = 'motown-offline';
  var DB_VERSION = 1;

  // Store names
  var STORES = {
    packs: 'packs',                    // pk packId
    resources: 'resources',            // pk [packId, resourceType, groupIndex]
    itemProgress: 'item_progress',     // pk [packId, itemType, itemIndex]
    cardReviews: 'card_reviews',       // pk [userId, cardId]
    resourceCompletions: 'resource_completions',
    audioFiles: 'audio_files',         // IDB-Blob fallback only
    syncQueue: 'sync_queue',           // autoIncrement id
    meta: 'meta',                      // pk key
  };

  var _dbp = null;

  function openDB() {
    if (_dbp) return _dbp;
    _dbp = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        var oldV = e.oldVersion;

        if (!db.objectStoreNames.contains(STORES.packs)) {
          db.createObjectStore(STORES.packs, { keyPath: 'packId' });
        }
        if (!db.objectStoreNames.contains(STORES.resources)) {
          var rs = db.createObjectStore(STORES.resources, { keyPath: ['packId', 'resourceType', 'groupIndex'] });
          rs.createIndex('byPack', 'packId', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORES.itemProgress)) {
          var ip = db.createObjectStore(STORES.itemProgress, { keyPath: ['packId', 'itemType', 'itemIndex'] });
          ip.createIndex('byPack', 'packId', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORES.cardReviews)) {
          var cr = db.createObjectStore(STORES.cardReviews, { keyPath: ['userId', 'cardId'] });
          cr.createIndex('byPack', 'packId', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORES.resourceCompletions)) {
          var rc = db.createObjectStore(STORES.resourceCompletions, { keyPath: 'resourceId' });
          rc.createIndex('byPack', 'packId', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORES.audioFiles)) {
          var af = db.createObjectStore(STORES.audioFiles, { keyPath: ['packId', 'turnIndex'] });
          af.createIndex('byPack', 'packId', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORES.syncQueue)) {
          var sq = db.createObjectStore(STORES.syncQueue, { keyPath: 'id', autoIncrement: true });
          sq.createIndex('byPack', 'packId', { unique: false });
          sq.createIndex('byStatus', 'status', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORES.meta)) {
          db.createObjectStore(STORES.meta, { keyPath: 'key' });
        }
        // future migrations: if (oldV < 2) { ... }
        void oldV;
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
      req.onblocked = function () { console.warn('[offline-db] open blocked'); };
    });
    return _dbp;
  }

  function tx(db, storeNames, mode, fn) {
    return new Promise(function (resolve, reject) {
      var t = db.transaction(storeNames, mode || 'readonly');
      var result;
      t.oncomplete = function () { resolve(result); };
      t.onerror = function () { reject(t.error); };
      t.onabort = function () { reject(t.error || new Error('tx aborted')); };
      try {
        result = fn(t);
        // If fn returned a promise, chain it; otherwise rely on oncomplete
        if (result && typeof result.then === 'function') {
          result.then(function (v) { result = v; }, function (e) { try { t.abort(); } catch (_) {} reject(e); });
        }
      } catch (e) { try { t.abort(); } catch (_) {} reject(e); }
    });
  }

  function reqToPromise(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  // ── pack ops ─────────────────────────────────────────────
  function putPack(packRow) {
    return openDB().then(function (db) {
      return tx(db, [STORES.packs], 'readwrite', function (t) {
        return reqToPromise(t.objectStore(STORES.packs).put(packRow));
      });
    });
  }
  function getPack(packId) {
    return openDB().then(function (db) {
      return tx(db, [STORES.packs], 'readonly', function (t) {
        return reqToPromise(t.objectStore(STORES.packs).get(packId));
      });
    });
  }
  function deletePack(packId) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction([STORES.packs, STORES.resources, STORES.itemProgress, STORES.resourceCompletions, STORES.audioFiles], 'readwrite');
        t.oncomplete = function () { resolve(); };
        t.onerror = function () { reject(t.error); };
        t.objectStore(STORES.packs).delete(packId);
        // delete resources by pack
        var idx = t.objectStore(STORES.resources).index('byPack');
        var rReq = idx.openCursor(IDBKeyRange.only(packId));
        rReq.onsuccess = function () { var c = rReq.result; if (c) { c.delete(); c.continue(); } };
        // delete item_progress by pack
        var ipIdx = t.objectStore(STORES.itemProgress).index('byPack');
        var ipReq = ipIdx.openCursor(IDBKeyRange.only(packId));
        ipReq.onsuccess = function () { var c = ipReq.result; if (c) { c.delete(); c.continue(); } };
        // delete completions by pack
        var rcIdx = t.objectStore(STORES.resourceCompletions).index('byPack');
        var rcReq = rcIdx.openCursor(IDBKeyRange.only(packId));
        rcReq.onsuccess = function () { var c = rcReq.result; if (c) { c.delete(); c.continue(); } };
        // delete audioFiles by pack (IDB fallback)
        try {
          var afIdx = t.objectStore(STORES.audioFiles).index('byPack');
          var afReq = afIdx.openCursor(IDBKeyRange.only(packId));
          afReq.onsuccess = function () { var c = afReq.result; if (c) { c.delete(); c.continue(); } };
        } catch (_) {}
      });
    });
  }
  function getAllPacks() {
    return openDB().then(function (db) {
      return tx(db, [STORES.packs], 'readonly', function (t) {
        return reqToPromise(t.objectStore(STORES.packs).getAll());
      });
    });
  }

  function putResources(rows) {
    return openDB().then(function (db) {
      return tx(db, [STORES.resources], 'readwrite', function (t) {
        var store = t.objectStore(STORES.resources);
        rows.forEach(function (r) { store.put(r); });
      });
    });
  }
  function getResourcesForPack(packId) {
    return openDB().then(function (db) {
      return tx(db, [STORES.resources], 'readonly', function (t) {
        var idx = t.objectStore(STORES.resources).index('byPack');
        return reqToPromise(idx.getAll(IDBKeyRange.only(packId)));
      });
    });
  }

  // meta helpers
  function metaGet(key) {
    return openDB().then(function (db) {
      return tx(db, [STORES.meta], 'readonly', function (t) {
        return reqToPromise(t.objectStore(STORES.meta).get(key)).then(function (row) { return row ? row.value : null; });
      });
    });
  }
  function metaPut(key, value) {
    return openDB().then(function (db) {
      return tx(db, [STORES.meta], 'readwrite', function (t) {
        return reqToPromise(t.objectStore(STORES.meta).put({ key: key, value: value }));
      });
    });
  }

  // syncQueue helpers (used by sync-queue.js but exposed for testability)
  function syncQueueAdd(entry) {
    return openDB().then(function (db) {
      return tx(db, [STORES.syncQueue], 'readwrite', function (t) {
        return reqToPromise(t.objectStore(STORES.syncQueue).add(entry));
      });
    });
  }
  function syncQueueGetAll() {
    return openDB().then(function (db) {
      return tx(db, [STORES.syncQueue], 'readonly', function (t) {
        return reqToPromise(t.objectStore(STORES.syncQueue).getAll());
      });
    });
  }
  function syncQueueDelete(id) {
    return openDB().then(function (db) {
      return tx(db, [STORES.syncQueue], 'readwrite', function (t) {
        return reqToPromise(t.objectStore(STORES.syncQueue).delete(id));
      });
    });
  }
  function syncQueuePut(entry) {
    return openDB().then(function (db) {
      return tx(db, [STORES.syncQueue], 'readwrite', function (t) {
        return reqToPromise(t.objectStore(STORES.syncQueue).put(entry));
      });
    });
  }

  // export
  var api = {
    DB_NAME: DB_NAME,
    DB_VERSION: DB_VERSION,
    STORES: STORES,
    openDB: openDB,
    putPack: putPack,
    getPack: getPack,
    deletePack: deletePack,
    getAllPacks: getAllPacks,
    putResources: putResources,
    getResourcesForPack: getResourcesForPack,
    metaGet: metaGet,
    metaPut: metaPut,
    syncQueueAdd: syncQueueAdd,
    syncQueueGetAll: syncQueueGetAll,
    syncQueueDelete: syncQueueDelete,
    syncQueuePut: syncQueuePut,
    // low-level tx escape hatch for advanced callers
    _tx: tx,
    _reqToPromise: reqToPromise,
  };
  global.MotownOfflineDB = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
