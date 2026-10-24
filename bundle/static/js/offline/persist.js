// navigator.storage.persist() helper — call once on first download or post-login boot.
// Shows a non-blocking banner if denied. Exported as MotownOfflinePersist.

(function (global) {
  var STORAGE_WARN_KEY = 'motown-offline-persist-warned';

  async function ensurePersisted() {
    try {
      if (!navigator.storage || !navigator.storage.persist) return { supported: false, persisted: false };
      if (await navigator.storage.persisted()) return { supported: true, persisted: true };
      var persisted = await navigator.storage.persist();
      return { supported: true, persisted: !!persisted };
    } catch (e) {
      console.warn('[offline-persist] persist() failed', e);
      return { supported: false, persisted: false, error: String(e) };
    }
  }

  function showPersistWarningIfNeeded(result) {
    if (result.persisted) return;
    try {
      if (localStorage.getItem(STORAGE_WARN_KEY)) return;
    } catch (_) { return; }
    // Defer DOM insert until body exists
    function insert() {
      var el = document.createElement('div');
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      el.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);max-width:520px;background:var(--bg-surface, #1e293b);color:var(--text-primary,#f8fafc);border:1px solid rgba(124,108,250,.25);border-radius:12px;padding:12px 16px;font-size:13px;line-height:1.5;z-index:9999;box-shadow:0 8px 24px rgba(0,0,0,.2)';
      el.innerHTML = '<strong style="color:var(--primary,#7c6cfa)">Offline tip:</strong> Your browser may clear downloads when storage is low. Keep this tab installed or re-download if needed. <a href="/library/downloads" style="color:var(--primary,#7c6cfa);text-decoration:underline;margin-left:8px">Manage downloads</a> <button type="button" aria-label="Dismiss" style="margin-left:12px;background:transparent;border:0;color:inherit;cursor:pointer;font-size:16px;line-height:1">×</button>';
      var btn = el.querySelector('button');
      if (btn) btn.addEventListener('click', function () { el.remove(); try { localStorage.setItem(STORAGE_WARN_KEY, '1'); } catch (_) {} });
      document.body.appendChild(el);
      // auto-dismiss after 10s
      setTimeout(function () { if (el.parentNode) el.remove(); }, 10000);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', insert);
    else insert();
  }

  async function ensurePersistedWithUI() {
    var res = await ensurePersisted();
    if (!res.persisted) showPersistWarningIfNeeded(res);
    return res;
  }

  global.MotownOfflinePersist = {
    ensurePersisted: ensurePersisted,
    ensurePersistedWithUI: ensurePersistedWithUI,
  };
})(typeof window !== 'undefined' ? window : globalThis);
