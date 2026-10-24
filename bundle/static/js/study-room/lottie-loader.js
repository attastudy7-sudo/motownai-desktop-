// Study Room Lottie loader — calm, on-brand generation loading animations.
// Maps each loading container to its animation file and plays/stoops based on
// the container's display state. Follows the pattern in tier-gating.js: a
// MutationObserver slips each loading card's `style` attribute; when the card
// becomes visible the animation starts, when hidden it stops. Safe to re-run:
// idempotent, and no-ops if the lottie library is unavailable offline.
(function () {
  'use strict';

  if (typeof window.lottie === 'undefined') return;

  // key -> { file: lottie json, containerId: loading card }
  var TABS = {
    fc: { file: 'notes-document', id: 'fcLoading' },
    qz: { file: 'purple-question-mark', id: 'qzLoading' },
    fi: { file: 'notes',          id: 'fiLoading' },
    podcast: { file: 'podcast',   id: 'podcastLoading' },
  };
  var BASE = '/static/lottie/';
  var anims = {};   // key -> animation instance

  window.SrLottie = {
    play: function (key) {
      if (!TABS[key]) return;
      var card = document.getElementById(TABS[key].id);
      if (!card) return;
      if (anims[key] && anims[key].el === card) {
        try { anims[key].inst.play(); } catch (e) {}
        return;
      }
      if (anims[key]) {
        try { anims[key].inst.destroy(); } catch (e) {}
        anims[key] = null;
      }
      var holder = card.querySelector('[data-sr-lottie]');
      if (!holder) return;
      var el = card.querySelector('[data-sr-lottie="' + key + '"]') || holder;
      if (!el) return;
      try {
        anims[key] = {
          el: card,
          inst: window.lottie.loadAnimation({
            container: el,
            renderer: 'svg',
            loop: true,
            autoplay: true,
            path: BASE + TABS[key].file + '.json',
          }),
        };
      } catch (e) {
        anims[key] = null;
      }
    },
    stop: function (key) {
      if (anims[key]) {
        try { anims[key].inst.stop(); } catch (e) {}
      }
    },
    // Tear down an animation cleanly so a remount can rebuild it fresh. The
    // loader's `play()` bakes the lottie `<svg>` into the `[data-sr-lottie]`
    // holder, and room-tab-lazy's unmountTab snapshots pane.innerHTML (with
    // that svg) into the tab cache; if an unmount left the instance alive the
    // remount + re-`play()` would render a second duplicate animation in the
    // same holder. destroy() drops the running instance and empties the holder
    // so the cached snapshot stays clean and exactly one animation ever mounts.
    destroy: function (key) {
      if (anims[key]) {
        try { anims[key].inst.destroy(); } catch (e) {}
        anims[key] = null;
      }
      var card = document.getElementById(TABS[key].id);
      if (!card) return;
      var holder = card.querySelector('[data-sr-lottie]');
      if (holder) holder.innerHTML = '';
    },
    destroyAll: function () {
      Object.keys(TABS).forEach(function (k) { window.SrLottie.destroy(k); });
    },
    stopAll: function () {
      Object.keys(anims).forEach(function (k) { window.SrLottie.stop(k); });
    },
  };

  function sync(key) {
    var card = document.getElementById(TABS[key].id);
    if (!card) return;
    var visible = card.style.display && card.style.display !== 'none';
    if (visible) window.SrLottie.play(key);
    else window.SrLottie.stop(key);
  }

  // Attach a style observer to each loading card if it exists. Cards live in
  // template clones mounted on tab open, so scan on every DOM addition.
  function attach(key) {
    var card = document.getElementById(TABS[key].id);
    if (!card) return;
    if (card._srLottieWired) return;
    card._srLottieWired = true;
    new MutationObserver(function () { sync(key); })
      .observe(card, { attributes: true, attributeFilter: ['style'] });
    sync(key);
  }

  function scan() {
    Object.keys(TABS).forEach(attach);
  }

  var observer = new MutationObserver(scan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scan);
  } else {
    scan();
  }
})();