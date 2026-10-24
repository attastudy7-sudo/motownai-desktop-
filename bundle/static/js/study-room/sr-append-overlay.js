// ──────────────────────────────────────────────────────────────────────────
//  Study Room Append Generation Overlay
//  ─────────────────────────
//  Prominent, interaction-blocking overlay shown while additional content is
//  being generated (the "+ more" buttons and the guided-path "Want more
//  practice?" buttons). Distinct from SrSpinner, which is a non-blocking
//  short-lived mount indicator:
//
//   • Blocks the assessment flow — full-pane scrim with pointer-events:auto
//     so the student cannot answer the old set while new items stream in.
//   • Stays up until generation resolves (append applied, generation failed,
//     poller timeout, or the student cancels) — no 5s auto-dismiss.
//   • Registry-driven: pending state lives here (keyed by tabId), so it
//     survives tab unmount/remount. mountTab re-shows it from the registry.
//   • Built dynamically in JS — never lives in template HTML, so it can never
//     be cached into a tab snapshot and re-inserted as a phantom.
//   • Quiet "Cancel" escape hatch that aborts the generation poller.
// ──────────────────────────────────────────────────────────────────────────
(function () {
  'use strict';

  var SAFETY_TIMEOUT = 5 * 60 * 1000;

  // tabId -> { hint, sub, showCancel, onCancel, timer, node, phaseTimers }
  var pending = Object.create(null);

  function _startPhases(info) {
    if (!info.phases || !info.phaseDelays) return;
    var node = info.node;
    if (!node) return;
    var hintEl = node.querySelector('.sr-append-overlay__hint');
    if (!hintEl) return;
    info.phaseTimers = info.phaseDelays.map(function (delay, i) {
      return setTimeout(function () {
        if (info.node && info.phases[i]) {
          hintEl.textContent = info.phases[i];
        }
      }, delay);
    });
  }

  function _stopPhases(info) {
    if (info.phaseTimers) {
      info.phaseTimers.forEach(clearTimeout);
      info.phaseTimers = null;
    }
  }

  function _buildNode(tabId, info) {
    var wrap = document.createElement('div');
    wrap.className = 'sr-append-overlay';
    wrap.setAttribute('data-overlay-for', tabId);
    wrap.setAttribute('role', 'status');
    wrap.setAttribute('aria-live', 'polite');

    var inner = document.createElement('div');
    inner.className = 'sr-append-overlay__inner';

    var ring = document.createElement('div');
    ring.className = 'sr-mount-spinner__ring sr-append-overlay__ring';

    var hint = document.createElement('div');
    hint.className = 'sr-append-overlay__hint';
    hint.textContent = info.hint || 'Adding more content\u2026';

    inner.appendChild(ring);
    inner.appendChild(hint);

    if (info.sub) {
      var sub = document.createElement('div');
      sub.className = 'sr-append-overlay__sub';
      sub.textContent = info.sub;
      inner.appendChild(sub);
    }

    if (info.showCancel !== false) {
      var cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'sr-append-overlay__cancel';
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', function () {
        if (window.SrAppendOverlay) window.SrAppendOverlay.cancel(tabId);
      });
      inner.appendChild(cancel);
    }

    wrap.appendChild(inner);
    return wrap;
  }

  function _attach(tabId) {
    var info = pending[tabId];
    if (!info) return;
    if (info.node && info.node.parentNode) info.node.parentNode.removeChild(info.node);
    info.node = _buildNode(tabId, info);
    var paneMain = document.querySelector('.pane-main');
    if (!paneMain) return;
    paneMain.appendChild(info.node);
    requestAnimationFrame(function () {
      if (info.node) info.node.classList.add('sr-append-overlay--visible');
    });
  }

  function show(tabId, opts) {
    if (!tabId) return;
    opts = opts || {};
    var info = pending[tabId];
    if (!info) {
      info = pending[tabId] = {
        hint: opts.hint || '',
        sub: opts.sub || '',
        showCancel: opts.showCancel !== false,
        onCancel: typeof opts.onCancel === 'function' ? opts.onCancel : null,
        timer: null,
        node: null,
        phases: Array.isArray(opts.phases) ? opts.phases : null,
        phaseDelays: Array.isArray(opts.phaseDelays) ? opts.phaseDelays : null,
        phaseTimers: null,
      };
    } else {
      _stopPhases(info);
      if (opts.hint) info.hint = opts.hint;
      if (opts.sub) info.sub = opts.sub;
      if (opts.phases) info.phases = opts.phases;
      if (opts.phaseDelays) info.phaseDelays = opts.phaseDelays;
      if (typeof opts.onCancel === 'function') info.onCancel = opts.onCancel;
      if (info.node) {
        var h = info.node.querySelector('.sr-append-overlay__hint');
        if (h) h.textContent = info.hint;
        var s = info.node.querySelector('.sr-append-overlay__sub');
        if (s) s.textContent = info.sub || '';
      }
    }

    // (Re)arm the safety timer so a stuck poller can never trap the student
    // silently. Logs a warning so broken resolution paths surface in dev.
    if (info.timer) clearTimeout(info.timer);
    info.timer = setTimeout(function () {
      console.warn('[SrAppendOverlay] Safety timeout fired for', tabId,
                   '— generation never resolved. Hiding overlay.');
      if (window.SrAppendOverlay) window.SrAppendOverlay.hide(tabId);
    }, SAFETY_TIMEOUT);

    _attach(tabId);
    _startPhases(info);
  }

  function hide(tabId) {
    if (!tabId) return;
    var info = pending[tabId];
    if (!info) return;
    if (info.timer) { clearTimeout(info.timer); info.timer = null; }
    _stopPhases(info);
    if (info.node && info.node.parentNode) {
      info.node.parentNode.removeChild(info.node);
    }
    delete pending[tabId];
  }

  function isPending(tabId) {
    return !!pending[tabId];
  }

  // Re-show payload for mountTab: hint/sub only (cancel is re-registered by
  // the append helper when it calls show again).
  function pendingInfo(tabId) {
    var info = pending[tabId];
    if (!info) return null;
    return { hint: info.hint, sub: info.sub };
  }

  function cancel(tabId) {
    var info = pending[tabId];
    if (info && typeof info.onCancel === 'function') {
      try {
        info.onCancel(tabId);
      } catch (e) {
        console.error('[SrAppendOverlay] cancel handler failed', e);
      }
    }
    hide(tabId);
    if (typeof showToast === 'function') showToast('Skipped \u2014 nothing was added');
  }

  function clearAll() {
    Object.keys(pending).forEach(hide);
  }

  window.SrAppendOverlay = {
    show: show,
    hide: hide,
    cancel: cancel,
    isPending: isPending,
    pendingInfo: pendingInfo,
    clearAll: clearAll,
  };
})();
