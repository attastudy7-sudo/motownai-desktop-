// Version check against /api/packs/versions — lightweight staleness probe.
// Exports MotownOfflineVersion

(function (global) {
  function csrf() {
    var el = document.querySelector('meta[name="csrf-token"]');
    return el ? el.content : '';
  }

  // Check versions for a set of packIds. Pass clientVersions map to omit up-to-date.
  async function checkVersions(packIds, clientVersions) {
    var ids = Array.isArray(packIds) ? packIds.join(',') : String(packIds || '');
    if (!ids) return { ok: true, packs: [] };
    var url = '/api/packs/versions?ids=' + encodeURIComponent(ids);
    if (clientVersions && typeof clientVersions === 'object') {
      var vParts = packIds.map(function (id) { return clientVersions[id] || ''; });
      url += '&v=' + encodeURIComponent(vParts.join(','));
    }
    var r = await fetch(url, { headers: { 'X-CSRFToken': csrf() }, credentials: 'same-origin' });
    if (!r.ok) throw new Error('versions check failed: ' + r.status);
    return r.json();
  }

  async function isPackCurrent(packId, localPackVersion) {
    var data = await checkVersions([packId], localPackVersion ? (function () { var m = {}; m[packId] = localPackVersion; return m; }()) : null);
    // Empty packs array means server says current (omitted). Deleted => stale => false.
    var packs = data.packs || [];
    if (!packs.length) return true;
    var hit = packs.find(function (p) { return p.packId === packId; });
    if (!hit) return true;
    if (hit.deleted) return false;
    return false;
  }

  global.MotownOfflineVersion = { checkVersions: checkVersions, isPackCurrent: isPackCurrent };
})(typeof window !== 'undefined' ? window : globalThis);
