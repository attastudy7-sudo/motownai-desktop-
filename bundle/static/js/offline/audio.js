// Audio backend: OPFS primary, IDB Blob fallback.
// Detection at boot, persisted in meta store. Exports MotownOfflineAudio.

(function (global) {
  var BACKEND_KEY = 'audioBackend'; // 'opfs' | 'idb'

  async function detectBackend() {
    try {
      if (navigator.storage && typeof navigator.storage.getDirectory === 'function') {
        // Probe OPFS availability (Safari <16.4 throws)
        var dir = await navigator.storage.getDirectory();
        void dir;
        return 'opfs';
      }
    } catch (e) {
      console.warn('[offline-audio] OPFS not available, falling back to IDB', e);
    }
    return 'idb';
  }

  async function getBackend() {
    try {
      var DB = global.MotownOfflineDB;
      if (DB) {
        var v = await DB.metaGet(BACKEND_KEY);
        if (v === 'opfs' || v === 'idb') return v;
        var detected = await detectBackend();
        await DB.metaPut(BACKEND_KEY, detected);
        return detected;
      }
    } catch (_) {}
    return await detectBackend();
  }

  // OPFS helpers
  async function opfsPacksDir() {
    var root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle('packs', { create: true });
  }
  async function opfsPackDir(packId) {
    var packs = await opfsPacksDir();
    return await packs.getDirectoryHandle(String(packId), { create: true });
  }

  async function opfsPut(packId, turnIndex, blob) {
    var dir = await opfsPackDir(packId);
    var fh = await dir.getFileHandle('turn-' + turnIndex + '.bin', { create: true });
    var w = await fh.createWritable();
    await w.write(blob);
    await w.close();
  }

  async function opfsGet(packId, turnIndex) {
    var packs = await opfsPacksDir();
    var dir = await packs.getDirectoryHandle(String(packId));
    var fh = await dir.getFileHandle('turn-' + turnIndex + '.bin');
    var file = await fh.getFile();
    return file; // Blob
  }

  async function opfsDeletePack(packId) {
    var packs = await opfsPacksDir();
    try { await packs.removeEntry(String(packId), { recursive: true }); } catch (_) {}
  }

  async function opfsListPack(packId) {
    try {
      var packs = await opfsPacksDir();
      var dir = await packs.getDirectoryHandle(String(packId));
      var out = [];
      for await (var entry of dir.values()) out.push(entry.name);
      return out;
    } catch (_) { return []; }
  }

  // Public API
  var api = {
    getBackend: getBackend,
    detectBackend: detectBackend,
    // write a blob for a turn
    put: async function (packId, turnIndex, blob) {
      var be = await getBackend();
      if (be === 'opfs') return opfsPut(packId, turnIndex, blob);
      // idb fallback
      var DB = global.MotownOfflineDB;
      var db = await DB.openDB();
      // use shared low-level tx helper if available
      return new Promise(function (resolve, reject) {
        var t = db.transaction(['audio_files'], 'readwrite');
        t.oncomplete = function () { resolve(); };
        t.onerror = function () { reject(t.error); };
        t.objectStore('audio_files').put({ packId: packId, turnIndex: turnIndex, blob: blob, mime: blob.type || 'audio/mpeg' });
      });
    },
    get: async function (packId, turnIndex) {
      var be = await getBackend();
      if (be === 'opfs') return opfsGet(packId, turnIndex);
      var DB = global.MotownOfflineDB;
      var db = await DB.openDB();
      return new Promise(function (resolve, reject) {
        var t = db.transaction(['audio_files'], 'readonly');
        var req = t.objectStore('audio_files').get([packId, turnIndex]);
        req.onsuccess = function () { var row = req.result; resolve(row ? row.blob : null); };
        req.onerror = function () { reject(req.error); };
      });
    },
    deletePack: async function (packId) {
      var be = await getBackend();
      if (be === 'opfs') return opfsDeletePack(packId);
      var DB = global.MotownOfflineDB;
      var db = await DB.openDB();
      return new Promise(function (resolve, reject) {
        var t = db.transaction(['audio_files'], 'readwrite');
        t.oncomplete = function () { resolve(); };
        t.onerror = function () { reject(t.error); };
        var idx = t.objectStore('audio_files').index('byPack');
        var req = idx.openCursor(IDBKeyRange.only(packId));
        req.onsuccess = function () { var c = req.result; if (c) { c.delete(); c.continue(); } };
      });
    },
    objectURLForBlob: function (blob) { return URL.createObjectURL(blob); },
    listPack: opfsListPack,
  };

  global.MotownOfflineAudio = api;
})(typeof window !== 'undefined' ? window : globalThis);
