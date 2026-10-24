// Quota helpers — navigator.storage.estimate() wrapper + threshold UI.
// Exports MotownOfflineQuota

(function (global) {
  async function estimate() {
    try {
      if (navigator.storage && navigator.storage.estimate) return await navigator.storage.estimate();
    } catch (e) { console.warn('[offline-quota] estimate failed', e); }
    return { quota: null, usage: null, usageDetails: null };
  }

  function pct(est) {
    if (!est || !est.quota || !est.usage) return null;
    return (est.usage / est.quota) * 100;
  }

  function level(est) {
    var p = pct(est);
    if (p == null) return 'unknown';
    if (p >= 90) return 'red';
    if (p >= 75) return 'amber';
    return 'green';
  }

  function formatBytes(n) {
    if (n == null) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
    return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  global.MotownOfflineQuota = { estimate: estimate, pct: pct, level: level, formatBytes: formatBytes };
})(typeof window !== 'undefined' ? window : globalThis);
