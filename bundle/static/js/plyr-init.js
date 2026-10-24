(function () {
  var _poll = null;
  var _lastProg = 0;

  function initPlyr() {
    var playerEl = document.getElementById('motown-player');
    if (!playerEl) return;
    if (playerEl.classList.contains('plyr--setup')) return;

    // Destroy existing player instance cleanly
    if (window.motownPlayer) {
      try { window.motownPlayer.destroy(); } catch (e) {}
      window.motownPlayer = null;
    }

    // If the element somehow still has Plyr markup, bail
    if (playerEl.querySelector('.plyr')) return;

    window.motownPlayer = new Plyr('#motown-player', {
      controls: [
        'play-large', 'play', 'progress', 'current-time',
        'duration', 'mute', 'volume', 'speed', 'fullscreen'
      ],
      speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] },
      youtube: {
        noCookie: true, rel: 0, showinfo: 0,
        iv_load_policy: 3, modestbranding: 1,
        playsinline: 1,
      },
      ratio: '16:9',
      resetOnEnd: false,
      keyboard: { focused: true, global: false },
      tooltips: { controls: true, seek: true },
    });

    window.motownPlayer.on('ready', function () {
      startPoll();
    });

    window.motownPlayer.on('ended', function () {
      stopPoll();
      if (typeof window.claimAura === 'function') {
        window.claimAura('player_finished');
      }
      if (typeof window.fireNudge === 'function') {
        window.fireNudge();
      }
    });

    window.motownPlayer.on('timeupdate', function () {
      checkProgress();
    });

    // Always start polling as fallback
    startPoll();

    window.seekTo = function (seconds) {
      if (window.motownPlayer) window.motownPlayer.currentTime = seconds;
    };
    window.pauseVideo = function () {
      if (window.motownPlayer) window.motownPlayer.pause();
    };
    window.playVideo = function () {
      if (window.motownPlayer) window.motownPlayer.play();
    };
  }

  function startPoll() {
    stopPoll();
    _poll = setInterval(checkProgress, 500);
  }

  function stopPoll() {
    if (_poll) { clearInterval(_poll); _poll = null; }
  }

  function checkProgress() {
    var p = window.motownPlayer;
    if (!p || !p.duration || p.duration <= 0) return;
    var prog = p.currentTime / p.duration;
    if (prog < 0.01) return;
    if (prog - _lastProg < 0.005) return;
    _lastProg = prog;

    if (prog >= 0.98) {
      var b = document.getElementById('auraStatus');
      if (b) {
        b.style.cursor = 'pointer';
        b.onclick = function () {
          if (typeof window.claimAura === 'function') {
            window.claimAura('manual_finish');
          }
        };
        b.innerHTML = '<i class="ti ti-star"></i> Finish Lesson';
      }
      if (prog >= 0.999 && typeof window.claimAura === 'function') {
        window.claimAura('end_reached');
      }
    }
  }

  function destroyPlyr() {
    stopPoll();
    if (window.motownPlayer) {
      try { window.motownPlayer.destroy(); } catch (e) {}
      window.motownPlayer = null;
    }
  }

  // Clean up on page hide (bfcache freeze)
  window.addEventListener('pagehide', destroyPlyr);

  document.addEventListener('motown:page-ready', initPlyr);
})();
