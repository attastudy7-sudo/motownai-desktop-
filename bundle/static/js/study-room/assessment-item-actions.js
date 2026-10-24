/**
 * assessment-item-actions.js — Regenerate / Delete floating actions shared by
 * the Quiz, Flashcards and Fill-in tabs.
 *
 * One adapter per tab resolves the assessment item currently on screen plus a
 * refresh() that re-fetches and re-renders the deck after a successful
 * mutation. mount() injects two buttons directly before each module's existing
 * Filter button, so the FAB reads in every tab:
 *
 *   [Regenerate] [Delete] [Filter]
 *
 * The buttons dispatch the per-item server routes:
 *   POST /library/pack/<id>/assessment-item/regenerate   {resource_type, resource_id, item_index, fingerprint, topic}
 *   POST /library/pack/<id>/assessment-item/delete       {resource_type, resource_id, item_index, fingerprint}
 *
 * Both are owned by the shared helper so the pill modules never need to know
 * about each other's action buttons.
 */
(function () {
  'use strict';

  var registry = {};   // tabId -> adapter
  var busy = {};       // tabId -> bool (request in flight)

  var ICONS = {
    regen: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-rotate-cw h-4 w-4"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path></svg>',
    del: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash2 h-4 w-4"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path><line x1="10" x2="10" y1="11" y2="17"></line><line x1="14" x2="14" y1="11" y2="17"></line></svg>'
  };
  var DEFAULT_LABELS = {
    regen: 'Regenerate',
    del: 'Delete',
    confirmTitle: 'Delete this item?',
    confirmBody: 'This item will be permanently removed from the deck.'
  };

  function packId() { return window.PACK_ID || window.__PACK_ID__ || null; }
  function csrf() { return (document.querySelector('meta[name="csrf-token"]') || {}).content || ''; }
  function toast(msg) { if (typeof window.showToast === 'function') window.showToast(msg); }

  function post(url, body) {
    return fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch', 'X-CSRFToken': csrf() },
      body: JSON.stringify(body || {})
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { return { status: r.status, data: d }; });
    });
  }

  function register(tabId, adapter) { registry[tabId] = adapter; }
  function isBusy(tabId) { return !!busy[tabId]; }

  function setBusy(tabId, val) {
    busy[tabId] = !!val;
    refreshButtons(tabId);
  }

  function adapterReady(adapter) {
    if (typeof adapter.resolveItem !== 'function') return false;
    if (typeof adapter.getFilterButton !== 'function') return false;
    return true;
  }

  function findButtons(tabId, adapter) {
    var anchor = adapter.getFilterButton();
    if (!anchor || !anchor.parentNode) return null;
    return anchor.parentNode.querySelectorAll('[data-aa-action]');
  }

  function refreshButtons(tabId) {
    var adapter = registry[tabId];
    if (!adapter || !adapterReady(adapter)) return;
    var btns = findButtons(tabId, adapter);
    if (!btns) return;
    var item = adapter.resolveItem();
    var disabled = busy[tabId] || !item || (typeof adapter.isDisabled === 'function' && adapter.isDisabled());
    for (var i = 0; i < btns.length; i++) btns[i].disabled = !!disabled;
  }

  function makeButton(tabId, action, adapter) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = adapter.buttonClass + ' assessment-item-actions__btn';
    if (action === 'delete') b.classList.add('assessment-item-actions__btn--danger');
    b.setAttribute('data-aa-action', action);
    var label = action === 'delete' ? adapter.labels.del : adapter.labels.regen;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.innerHTML = action === 'delete' ? ICONS.del : ICONS.regen;
    b.disabled = true;
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      if (b.disabled) return;
      if (action === 'delete') {
        openConfirm(adapter.labels, function (ok) {
          if (ok) runAction(tabId, 'delete', adapter);
        });
      } else {
        var overlay = showRegenModal(adapter);
        runAction(tabId, 'regenerate', adapter, function () { dismissModal(overlay); });
      }
    });
    return b;
  }

  /**
   * Inject the Regenerate + Delete buttons ahead of the module's Filter
   * button. Idempotent by presence check so it survives pill rebuilds on
   * tab remounts (the pane wipes the pill node each mount).
   */
  function mount(tabId) {
    var adapter = registry[tabId];
    if (!adapter || !adapterReady(adapter)) return;
    var anchor = adapter.getFilterButton();
    if (!anchor || !anchor.parentNode) return;
    if (anchor.parentNode.querySelector('[data-aa-action]')) return;

    var del = makeButton(tabId, 'delete', adapter);
    anchor.parentNode.insertBefore(del, anchor);
    var regen = makeButton(tabId, 'regenerate', adapter);
    anchor.parentNode.insertBefore(regen, del);
    refreshButtons(tabId);
  }

  function runAction(tabId, action, adapter, onDone) {
    var item = adapter.resolveItem();
    if (!item) return;
    var pid = packId();
    if (!pid) return;

    setBusy(tabId, true);
    post('/library/pack/' + pid + '/assessment-item/' + action, {
      resource_type: item.resource_type || null,
      resource_id: item.resource_id != null ? item.resource_id : null,
      item_index: item.item_index,
      fingerprint: item.fingerprint || '',
      topic: item.topic || null
    }).then(function (res) {
      setBusy(tabId, false);
      if (res.status === 200 && res.data && res.data.ok) {
        if (res.data.credits_remaining !== undefined && typeof window.updateCreditsBar === 'function') {
          window.updateCreditsBar(res.data.credits_remaining);
        }
        if (typeof adapter.refresh === 'function') adapter.refresh();
        if (typeof onDone === 'function') onDone();
        return;
      }
      var msg = (res.data && res.data.error) || 'Something went wrong. Please try again.';
      if (res.status === 404) msg = 'This item no longer exists. Refreshing...';
      toast(msg);
      if (res.data && res.data.quota_exceeded) {
        if (window.maybeShowCreditsExhausted && window.maybeShowCreditsExhausted(res.data, 'assessment items')) {
          // credits recharge prompt shown instead
        } else if (typeof window.showQuotaModal === 'function') {
          window.showQuotaModal(res.data);
        }
      } else if (res.status === 404 && typeof adapter.refresh === 'function') {
        adapter.refresh();
      }
      if (typeof onDone === 'function') onDone();
    }).catch(function () {
      setBusy(tabId, false);
      toast('Network error. Please try again.');
      if (typeof onDone === 'function') onDone();
    });
  }

  /* ── Regeneration progress modal ────────────────────────────────────── */
  // Shown while the AI regenerates an item. Non-dismissible so the action
  // doesn't read as "cancelable" mid-flight; auto-closes when the request
  // resolves (reused for quizzes, cards and fill-in exercises alike).
  function showRegenModal(adapter) {
    var noun = 'item';
    if (adapter && adapter.labels && typeof adapter.labels.regen === 'string') {
      var stripped = adapter.labels.regen.replace(/^Regenerate\s+/i, '').trim().toLowerCase();
      if (stripped) noun = stripped;
    }

    var overlay = document.createElement('div');
    overlay.className = 'sr-topic-modal-overlay';

    var modal = document.createElement('div');
    modal.className = 'sr-topic-modal aa-regen';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Regenerating ' + noun);

    var body = document.createElement('div');
    body.className = 'sr-topic-modal__body';

    var spinner = document.createElement('div');
    spinner.className = 'sr-spinner-mini';
    spinner.setAttribute('aria-hidden', 'true');

    var text = document.createElement('p');
    text.className = 'aa-regen__text';
    text.textContent = 'Regenerating ' + noun + '...';

    body.appendChild(spinner);
    body.appendChild(text);
    modal.appendChild(body);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    document.body.classList.add('sr-modal-open');
    return overlay;
  }

  function dismissModal(overlay) {
    if (!overlay || !overlay.parentNode) return;
    document.body.classList.remove('sr-modal-open');
    overlay.parentNode.removeChild(overlay);
  }

  /* ── Delete-confirm modal (mirrors the sr-topic-modal pattern) ──────── */
  function openConfirm(labels, cb) {
    var dispLabels = {};
    ['regen', 'del', 'confirmTitle', 'confirmBody'].forEach(function (k) { dispLabels[k] = (labels && labels[k]) ? labels[k] : DEFAULT_LABELS[k]; });

    var overlay = document.createElement('div');
    overlay.className = 'sr-topic-modal-overlay';

    var modal = document.createElement('div');
    modal.className = 'sr-topic-modal aa-confirm';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', dispLabels.confirmTitle);

    var header = document.createElement('div');
    header.className = 'sr-topic-modal__header';
    var title = document.createElement('h3');
    title.className = 'sr-topic-modal__title';
    title.textContent = dispLabels.confirmTitle;
    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'sr-topic-modal__close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
    header.appendChild(title);
    header.appendChild(closeBtn);
    modal.appendChild(header);

    var body = document.createElement('div');
    body.className = 'sr-topic-modal__body';
    var text = document.createElement('p');
    text.className = 'aa-confirm__text';
    text.textContent = dispLabels.confirmBody;
    body.appendChild(text);

    var actions = document.createElement('div');
    actions.className = 'aa-confirm__actions';
    var cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'aa-confirm__btn aa-confirm__btn--cancel';
    cancel.textContent = 'Keep item';
    var confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'aa-confirm__btn aa-confirm__btn--danger';
    confirm.textContent = 'Delete';
    actions.appendChild(cancel);
    actions.appendChild(confirm);
    body.appendChild(actions);
    modal.appendChild(body);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    document.body.classList.add('sr-modal-open');

    function close(finalResult) {
      document.body.classList.remove('sr-modal-open');
      if (overlay._onKey) overlay.removeEventListener('keydown', overlay._onKey);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      cb(!!finalResult);
    }
    overlay._onKey = null;
    overlay.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); close(false); return; }
      if (e.key !== 'Tab') return;
      var els = modal.querySelectorAll('button');
      if (!els.length) return;
      var first = els[0];
      var last = els[els.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });

    closeBtn.addEventListener('click', function () { close(false); });
    cancel.addEventListener('click', function () { close(false); });
    confirm.addEventListener('click', function () { close(true); });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(false); });
    cancel.focus();
  }

  window._assessmentItemActions = {
    register: register,
    mount: mount,
    isBusy: isBusy,
    setBusy: setBusy
  };
})();