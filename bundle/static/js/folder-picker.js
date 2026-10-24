/* Shared "save to folder" widget for pack-creation surfaces.
 *
 * window.MotownFolderPicker:
 *   init(opts)     — bind to a <select> + inline "new folder" input.
 *                    opts: { selectId, inputId, errorId, onBusy }
 *   getFolderId(q) — Promise<folder_id|number|null>. If the user picked
 *                    "+ New folder…", creates it first (dupe-safe server
 *                    side) and returns the new id. When the user hasn't
 *                    touched the selector and q is provided, applies a
 *                    fresh folder suggestion before resolving.
 *   reset(opts)    — restore default (session activeFolder or None).
 *   suggest(q)     — debounced live suggestion (ignored once the user
 *                    hand-picks a folder).
 */
window.MotownFolderPicker = (function () {
  'use strict';

  function csrf() {
    var m = document.querySelector('meta[name="csrf-token"]');
    return m ? m.content : '';
  }

  return {
    postCreate: function (name) {
      return fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() },
        body: JSON.stringify({ name: name })
      }).then(function (r) { return r.json(); });
    },

    init: function (opts) {
      var select = document.getElementById(opts.selectId);
      if (!select) return null;
      var input = opts.inputId ? document.getElementById(opts.inputId) : null;
      var errorEl = opts.errorId ? document.getElementById(opts.errorId) : null;

      var state = { userSet: false, creating: false };
      var suggestTimer = null;

      function setError(msg) {
        if (errorEl) errorEl.textContent = msg || '';
      }

      function setCreating(v) {
        state.creating = v;
        if (typeof opts.onBusy === 'function') opts.onBusy(v);
      }

      function hasOption(val) {
        for (var i = 0; i < select.options.length; i++) {
          if (select.options[i].value === String(val)) return true;
        }
        return false;
      }

      var root = input ? input.closest('.db-folder-picker') : null;

      function showNewInput() {
        var isNew = select.value === '__new__';
        if (root) {
          root.classList.toggle('db-folder-picker--new', isNew);
        } else if (input) {
          input.style.display = isNew ? '' : 'none';
        }
        if (isNew && input) input.focus();
      }

      select.addEventListener('change', function () {
        state.userSet = true;
        setError('');
        showNewInput();
      });

      var backBtn = root ? root.querySelector('.db-folder-picker__back') : null;
      if (backBtn) {
        backBtn.addEventListener('click', function () {
          select.value = '';
          state.userSet = true;
          setError('');
          showNewInput();
        });
      }

      if (input) {
        input.addEventListener('input', function () {
          state.userSet = true;
          setError('');
        });
      }

      function applySuggestion(d) {
        if (state.userSet || !d || !d.folder_id) return;
        if (hasOption(d.folder_id)) {
          select.value = String(d.folder_id);
          showNewInput();
        }
      }

      function suggestOnce(q) {
        if (state.userSet || !q || !String(q).trim()) return Promise.resolve();
        return fetch('/api/folders/suggest?q=' + encodeURIComponent(String(q).trim()), {
          headers: { 'X-CSRFToken': csrf() }
        })
          .then(function (r) { return r.json(); })
          .then(applySuggestion)
          .catch(function () {});
      }

      function queueSuggest(q) {
        if (suggestTimer) clearTimeout(suggestTimer);
        suggestTimer = setTimeout(function () { suggestOnce(q); }, 350);
      }

      function getFolderId(q) {
        var run = function () {
          if (select.value === '__new__') {
            var name = (input ? input.value : '').trim();
            if (!name) {
              setError('Enter a folder name or choose None.');
              throw new Error('folder-name-required');
            }
            setCreating(true);
            return window.MotownFolderPicker.postCreate(name)
              .then(function (data) {
                if (!data || !data.id) throw new Error('create-folder failed');
                if (hasOption(data.id)) select.value = String(data.id);
                state.userSet = true;
                if (typeof window.syncFolderCreate === 'function' && data.name) {
                  window.syncFolderCreate(data);
                }
                return data.id;
              })
              .catch(function () {
                setError('Could not create that folder. Please try again.');
                throw new Error('create-folder-failed');
              })
              .finally(function () { setCreating(false); });
          }
          var v = select.value;
          return Promise.resolve(v ? v : null);
        };
        if (q && !state.userSet) return suggestOnce(q).then(run);
        return Promise.resolve().then(run);
      }

      return {
        getFolderId: getFolderId,
        suggest: queueSuggest,
        loadFolders: function () {
          return fetch('/api/folders', { headers: { 'X-CSRFToken': csrf() } })
            .then(function (r) { return r.json(); })
            .then(function (folders) {
              (folders || []).forEach(function (f) {
                if (!f || hasOption(f.id)) return;
                var opt = document.createElement('option');
                opt.value = String(f.id);
                opt.textContent = f.name;
                select.insertBefore(opt, select.querySelector('option[value="__new__"]'));
              });
            })
            .catch(function () {});
        },
        reset: function () {
          state.userSet = false;
          setError('');
          var active = null;
          try { active = sessionStorage.getItem('activeFolder'); } catch (_) {}
          if (active === 'all') active = null;
          if (active && hasOption(active)) {
            select.value = String(active);
          } else {
            select.value = (opts.defaultValue !== undefined) ? String(opts.defaultValue) : '';
          }
          if (input) { input.value = ''; }
          showNewInput();
        }
      };
    }
  };
})();