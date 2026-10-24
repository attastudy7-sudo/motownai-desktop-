// Study Room Topic Picker — shared topic/section selector for assessment tabs
/* ── Topic Picker — shared across assessment tabs ── */
window._topicState = { selected: null, topics: [], cycleIndex: 0, cycleTotal: 0 };

window._initTopicPicker = function(packId, pairs, onSelect) {
  pairs = (pairs || []).filter(function(p) { return p.wrapEl && p.btnEl && p.labelEl; });
  if (!packId || !pairs.length) return;

  function setTopicStatus(p, ok) {
    if (!p.statusEl) return;
    p.statusEl.className = 'topic-picker-status ' + (ok ? 'topic-picker-status--ok' : 'topic-picker-status--fail');
    p.statusEl.title = ok ? 'Sections found in this document' : 'No sections found in this document';
    p.statusEl.innerHTML = ok
      ? '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
      : '';
  }

  function applyTopics(data) {
    window._topicState.topics     = data.topics;
    window._topicState.cycleIndex = data.cycle_index;
    window._topicState.cycleTotal = data.cycle_total;
    var labelEls = pairs.map(function(p) { return p.labelEl; });
    _updateAllTopicLabels(labelEls);
    pairs.forEach(function(p) {
      p.wrapEl.style.display = '';
      p.btnEl.disabled = false;
      p.btnEl.classList.remove('topic-picker-btn--empty');
      setTopicStatus(p, true);
      if (p._retryHandler) { p.btnEl.removeEventListener('click', p._retryHandler); p._retryHandler = null; }
      _buildTopicDropdown(p.btnEl, data.topics, function(topic) {
        window._topicState.selected = topic;
        _updateAllTopicLabels(labelEls);
        if (onSelect) onSelect(topic);
      });
    });
  }

  function attachRetryHandler(p) {
    if (p._retryHandler) return;
    p._retryHandler = function(e) {
      e.stopPropagation();
      if (p.btnEl.disabled) return;
      p.btnEl.disabled = true;
      p.labelEl.textContent = 'Searching…';
      fetch('/library/pack/' + packId + '/topics/retry', {
        method: 'POST',
        headers: { 'X-CSRFToken': (document.querySelector('meta[name="csrf-token"]') || {}).content || '' }
      })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.ok && data.topics && data.topics.length) {
            applyTopics(data);
          } else {
            p.btnEl.disabled = false;
            p.labelEl.textContent = 'No sections — Retry';
          }
        })
        .catch(function() {
          p.btnEl.disabled = false;
          p.labelEl.textContent = 'No sections — Retry';
        });
    };
    p.btnEl.addEventListener('click', p._retryHandler);
  }

  function handleNoTopics() {
    pairs.forEach(function(p) {
      if (p.statusEl) {
        p.wrapEl.style.display = '';
        p.btnEl.disabled = false;
        p.btnEl.classList.add('topic-picker-btn--empty');
        p.labelEl.textContent = 'No sections — Retry';
        setTopicStatus(p, false);
        attachRetryHandler(p);
      } else {
        p.wrapEl.style.display = 'none';
      }
    });
  }

  fetch('/library/pack/' + packId + '/topics')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data.ok || !data.topics || data.topics.length === 0) {
        handleNoTopics();
        return;
      }
      applyTopics(data);
    })
    .catch(handleNoTopics);
};

function _updateAllTopicLabels(labelEls) {
  labelEls.forEach(_updateTopicLabel);
  _updateJumpSectionLabel();
}

function _updateTopicLabel(labelEl) {
  if (!labelEl) return;
  var s = window._topicState;
  if (s.selected) {
    labelEl.textContent = s.selected.title;
  } else if (s.cycleTotal > 0) {
    labelEl.textContent = 'Auto: ' + (s.cycleIndex + 1) + ' of ' + s.cycleTotal;
  } else {
    labelEl.textContent = 'Topics';
  }
}

function _updateJumpSectionLabel() {
  var el = document.getElementById('srJumpSectionLabel');
  if (!el) return;
  var s = window._topicState;
  if (s.selected) {
    el.textContent = s.selected.title;
  } else {
    el.textContent = 'Jump to section';
  }
}

/* ── Topic Modal ──────────────────────────────────────────────────────────── */
window._openTopicModal = function() {
  var s = window._topicState;
  if (!s.topics || !s.topics.length) return;

  var overlay = document.createElement('div');
  overlay.className = 'sr-topic-modal-overlay';

  var modal = document.createElement('div');
  modal.className = 'sr-topic-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-label', 'Jump to section');

  /* Header */
  var header = document.createElement('div');
  header.className = 'sr-topic-modal__header';

  var title = document.createElement('h3');
  title.className = 'sr-topic-modal__title';
  title.textContent = 'Jump to section';

  var closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'sr-topic-modal__close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

  header.appendChild(title);
  header.appendChild(closeBtn);
  modal.appendChild(header);

  /* Body */
  var body = document.createElement('div');
  body.className = 'sr-topic-modal__body';

  /* Auto item */
  var autoItem = document.createElement('button');
  autoItem.type = 'button';
  autoItem.className = 'sr-topic-modal__item sr-topic-modal__auto';
  if (!s.selected) autoItem.classList.add('sr-topic-modal__item--active');
  var autoSpan = document.createElement('span');
  autoSpan.textContent = 'Auto (cycle all topics)';
  autoItem.appendChild(autoSpan);
  autoItem.addEventListener('click', function() {
    s.selected = null;
    _closeTopicModal(overlay);
    _updateAllTopicLabels([]);
    if (window._onTopicSelect) window._onTopicSelect(null);
  });
  body.appendChild(autoItem);

  /* Divider */
  var divider = document.createElement('div');
  divider.className = 'sr-topic-modal__divider';
  body.appendChild(divider);

  /* Topic items */
  s.topics.forEach(function(t) {
    var item = document.createElement('button');
    item.type = 'button';
    item.className = 'sr-topic-modal__item';
    var indent = ((t.level || 1) - 1) * 16;
    item.style.paddingLeft = (12 + indent) + 'px';
    var label = document.createElement('span');
    label.textContent = t.title;
    item.appendChild(label);
    if (s.selected && s.selected.title === t.title) {
      item.classList.add('sr-topic-modal__item--active');
    }
    item.addEventListener('click', function() {
      s.selected = t;
      _closeTopicModal(overlay);
      _updateAllTopicLabels([]);
      if (window._onTopicSelect) window._onTopicSelect(t);
    });
    body.appendChild(item);
  });

  modal.appendChild(body);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  /* Close handlers */
  closeBtn.addEventListener('click', function() { _closeTopicModal(overlay); });
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) _closeTopicModal(overlay);
  });

  /* Focus trap */
  var focusableEls = modal.querySelectorAll('button');
  if (focusableEls.length) focusableEls[0].focus();

  function handleKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      _closeTopicModal(overlay);
      return;
    }
    if (e.key === 'Tab') {
      var first = focusableEls[0];
      var last = focusableEls[focusableEls.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
  }
  overlay.addEventListener('keydown', handleKeydown);
  overlay._handleKeydown = handleKeydown;
};

function _closeTopicModal(overlay) {
  if (!overlay || !overlay.parentNode) return;
  if (overlay._handleKeydown) {
    overlay.removeEventListener('keydown', overlay._handleKeydown);
  }
  overlay.parentNode.removeChild(overlay);
}

/* ── Per-tab topic picker (dropdown, used inside tab panels) ──────────────── */
function _buildTopicDropdown(btnEl, topics, onPick) {
  var wrap = btnEl.closest('.topic-picker-wrap');
  if (!wrap) return;
  var drop = document.createElement('div');
  drop.className = 'topic-picker-dropdown';
  drop.hidden = true;

  var autoItem = document.createElement('button');
  autoItem.type = 'button';
  autoItem.className = 'topic-picker-item topic-picker-item--auto';
  autoItem.textContent = 'Auto (cycle all topics)';
  autoItem.addEventListener('click', function() {
    drop.hidden = true;
    onPick(null);
  });
  drop.appendChild(autoItem);

  var divider = document.createElement('div');
  divider.className = 'topic-picker-divider';
  drop.appendChild(divider);

  topics.forEach(function(t) {
    var item = document.createElement('button');
    item.type = 'button';
    item.className = 'topic-picker-item';
    item.style.paddingLeft = (12 + (((t.level || 1) - 1) * 12)) + 'px';
    item.textContent = t.title;
    item.addEventListener('click', function() {
      drop.hidden = true;
      onPick(t);
    });
    drop.appendChild(item);
  });

  wrap.appendChild(drop);

  btnEl.addEventListener('click', function(e) {
    e.stopPropagation();
    drop.hidden = !drop.hidden;
  });
  document.addEventListener('click', function() { drop.hidden = true; });
}

function _initTopicPickerIfReady(prefix, packId) {
  var pairs = [
    { wrapEl: document.getElementById(prefix + 'TopicWrap'), btnEl: document.getElementById(prefix + 'TopicBtn'), labelEl: document.getElementById(prefix + 'TopicLabel') }
  ];
  window._initTopicPicker(packId, pairs, function(topic) {
    window._topicState.selected = topic;
  });
}

/* ── Shared top-bar section indicator — binds to the menu item ──────────── */
window._initSharedTopicBar = function(packId) {
  if (window._topicState._barInitDone) return;
  window._topicState._barInitDone = true;

  window._onTopicSelect = function(topic) {
    window._topicState.selected = topic;
  };

  fetch('/library/pack/' + packId + '/topics')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data.ok || !data.topics || data.topics.length === 0) return;
      window._topicState.topics     = data.topics;
      window._topicState.cycleIndex = data.cycle_index;
      window._topicState.cycleTotal = data.cycle_total;
      _updateJumpSectionLabel();
    })
    .catch(function() {
      if (typeof window.showFatalErrorModal === 'function') {
        window.showFatalErrorModal('Failed to load topics. Please try again.', function () {
          if (window._topicState) window._topicState._barInitDone = false;
          window._initSharedTopicBar(packId);
        });
      }
    });
};
if (window.PACK_ID) window._initSharedTopicBar(window.PACK_ID);
