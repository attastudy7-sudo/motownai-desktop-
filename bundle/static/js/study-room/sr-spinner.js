// ──────────────────────────────────────────────────────────────────────────
//  Study Room Mount Spinner
//  ─────────────────────────
//  Lightweight per-pane loading indicator. Replaces the old .room-tab-overlay
//  system. Designed to avoid the bugs of the previous implementation:
//
//   • Built dynamically in JS — never lives in template HTML, so it can never
//     be cached into a tab snapshot and re-inserted as a phantom.
//   • Single show()/hide() API — no per-tab init forks, no early-return holes.
//   • 150ms delay before display — fast loads never flash a spinner.
//   • Synchronous DOM removal — no setTimeout race with tab unmount.
//   • 5s safety timeout that logs a console warning so genuine broken
//     readiness signals surface during development.
// ──────────────────────────────────────────────────────────────────────────
(function () {
  'use strict';

  var SHOW_DELAY_MS  = 150;
  var SAFETY_TIMEOUT = 5000;

  // Map: paneId -> { showTimer, safetyTimer, node }
  var active = Object.create(null);

  function _buildSpinnerNode(paneId) {
    var wrap = document.createElement('div');
    wrap.className = 'sr-mount-spinner';
    wrap.setAttribute('data-spinner-for', paneId);
    wrap.setAttribute('role', 'status');
    wrap.setAttribute('aria-label', 'Loading');
    var ring = document.createElement('div');
    ring.className = 'sr-mount-spinner__ring';
    wrap.appendChild(ring);
    return wrap;
  }

  function show(paneId) {
    if (!paneId) return;
    // If already pending or visible, do nothing — idempotent.
    if (active[paneId]) return;

    var pane = document.getElementById(paneId);
    if (!pane) return;

    var entry = { showTimer: null, safetyTimer: null, node: null };
    active[paneId] = entry;

    entry.showTimer = setTimeout(function () {
      // Re-check pane still exists at insertion time
      var p = document.getElementById(paneId);
      if (!p) { delete active[paneId]; return; }

      // Pane must be relatively/absolutely positioned for our absolute child.
      // The .room-vp parent is already positioned via existing CSS.
      var node = _buildSpinnerNode(paneId);
      p.appendChild(node);
      entry.node = node;

      // Trigger CSS fade-in on next frame
      requestAnimationFrame(function () {
        if (entry.node) entry.node.classList.add('sr-mount-spinner--visible');
      });
    }, SHOW_DELAY_MS);

    entry.safetyTimer = setTimeout(function () {
      if (active[paneId]) {
        console.warn('[SrSpinner] Safety timeout fired for', paneId,
                     '— content-ready signal never called hide().');
        hide(paneId);
      }
    }, SAFETY_TIMEOUT);
  }

  function hide(paneId) {
    if (!paneId) return;
    var entry = active[paneId];
    if (!entry) return;

    if (entry.showTimer)   clearTimeout(entry.showTimer);
    if (entry.safetyTimer) clearTimeout(entry.safetyTimer);

    // Synchronous removal — no setTimeout race with tab unmount
    if (entry.node && entry.node.parentNode) {
      entry.node.parentNode.removeChild(entry.node);
    }
    delete active[paneId];
  }

  // Clear all — used defensively if a tab unmounts mid-spinner
  function clearAll() {
    Object.keys(active).forEach(hide);
  }

  window.SrSpinner = {
    show: show,
    hide: hide,
    clearAll: clearAll,
  };
})();
