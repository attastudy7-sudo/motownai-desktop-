/*
 * popup-gate.js — Global, calm pop‑up coordinator.
 *
 * Enforces one active popup at a time, FIFO ordering, and a single wait‑for‑clear
schedule so UI pop‑ups (onboarding tours, promos, modals, streak) never
overlap and a wedged overlay never blocks everything forever.
 *
 * Design:
 *   - open(id)  → claims the slot; returns true only if slot was free.
 *   - close(id) → releases the slot; if a waiter is queued, starts it.
 *   - whenClear(id, cb, maxWaitMs) → run cb if idle; else queue.
 *   - isOpen() → true if a popup is currently active.
 *
 * Usage:
 *   const gate = window.MotownPopup;
 *   // auto‑open
 *   gate.whenClear('feedback', () => openFeedbackModal(), 60000);
 *   // manual open (bypasses gate)
 *   window.openFeedbackModal = () => { gate.open('feedback'); openFeedbackModalReal(); }
 *   // close
 *   gate.close('feedback');
 */

(function () {
  'use strict';

  function PopupGate() {
    this._activeId = null;
    this._waiters = {}; // id -> [callbacks]
  }

  PopupGate.prototype.open = function (id) {
    if (this._activeId === id) return true; // already open; idempotent
    if (this._activeId !== null) return false; // blocked
    this._activeId = id;
    // Fire any queued waiters for this id (should not happen, but clean up)
    if (this._waiters[id]) {
      for (var i = 0; i < this._waiters[id].length; i++) {
        try { this._waiters[id][i](); } catch (e) {}
      }
      this._waiters[id] = [];
    }
    return true;
  };

  PopupGate.prototype.close = function (id) {
    if (this._activeId !== id) return; // not ours
    var nextId = null;
    for (var w in this._waiters) {
      if (this._waiters[w] && this._waiters[w].length) {
        nextId = w;
        break;
      }
    }
    this._activeId = nextId;
    if (nextId !== null && this._waiters[nextId]) {
      // Drain waiters for the new id (should be 0 or 1)
      for (var i = 0; i < this._waiters[nextId].length; i++) {
        try { this._waiters[nextId][i](); } catch (e) {}
      }
      this._waiters[nextId] = [];
    }
  };

  PopupGate.prototype.whenClear = function (id, cb, maxWaitMs) {
    var self = this;
    var max = typeof maxWaitMs === 'number' ? maxWaitMs : 60000;
    var start = Date.now();

    function tryRun() {
      if (self._activeId === null) {
        if (self.open(id)) {
          cb();
          return true;
        }
      }
      return false;
    }

    function queue() {
      if (!self._waiters[id]) self._waiters[id] = [];
      self._waiters[id].push(cb);
      var timer = setTimeout(function () {
        for (var j = 0; j < self._waiters[id].length; j++) {
          try { self._waiters[id][j](); } catch (e) {}
        }
        self._waiters[id] = [];
        clearTimeout(timer);
      }, max);
    }

    if (!tryRun()) queue();
  };

  PopupGate.prototype.isOpen = function () {
    return this._activeId !== null;
  };

  window.MotownPopup = new PopupGate();
})();