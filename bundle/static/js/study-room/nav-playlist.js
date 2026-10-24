// Study Room Navigation — delegated tab listener, syllabus switcher, playlist navigator

// ── Delegated study room nav listener ────────────────────────────────────────
// Delegated listener so study-room nav buttons anywhere (base template etc.) trigger panes

// Guard: attach only once, survive Turbo navigations
(function attachStudyRoomDelegate() {
  if (window._srDelegateAttached) return;
  window._srDelegateAttached = true;
  document.addEventListener('click', function (e) {
    const btn = e.target.closest('.room-tab-btn, .dsn-link');
    if (!btn) return;

    // Only act when study room panes exist on the page
    if (!document.getElementById('paneMain') && !document.getElementById('tab-video')) return;

    // Determine target pane id
    let targetId = btn.dataset && btn.dataset.target;

    if (!targetId) {
      const onclick = btn.getAttribute && btn.getAttribute('onclick');
      if (onclick) {
        const m = onclick.match(/switchRoomTab\s*\(\s*this\s*,\s*'([^']+)'\s*\)/);
        if (m) targetId = m[1];
      }
    }

    if (!targetId) {
      const dr = btn.getAttribute('data-resource') || '';
      if (dr.startsWith('notes')) targetId = 'tab-notes';
      else if (dr.startsWith('flashcards')) targetId = 'tab-flashcards';
      else if (dr.startsWith('micro_quiz') || dr.startsWith('quiz')) targetId = 'tab-quiz';
      else if (dr.startsWith('fill_in')) targetId = 'tab-more';
      else if (dr.startsWith('voice')) targetId = 'tab-voice';
    }

    if (!targetId) {
      const al = btn.getAttribute('aria-label') || btn.textContent || '';
      const key = al.trim().toLowerCase().split(/\s+/).join('-');
      if (key) targetId = 'tab-' + key;
    }

    if (targetId) {
      console.debug('study-room: resolved targetId=', targetId, 'from element', btn);
      e.preventDefault();
      if (window.switchRoomTab) window.switchRoomTab(btn, targetId);
      else {
        document.querySelectorAll('.room-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.room-vp').forEach(p => p.classList.remove('room-vp--active'));
        const t = document.getElementById(targetId);
        if (t) t.classList.add('room-vp--active');
      }
    } else {
      console.debug('study-room: no targetId resolved for element', btn);
    }
  });            // end document click handler
})();           // end attachStudyRoomDelegate

// ── Syllabus video switcher ──────────────────────────────────────────────────
;(function () {
  // Switch to the video tab and swap the iframe src without a full page reload
  document.addEventListener('click', function (e) {
    var link = e.target.closest('.sb-item[data-embed-url]');
    if (!link) return;

    e.preventDefault();

    var embedUrl = link.dataset.embedUrl;
    var title    = link.dataset.title || '';

    // ── 1. Swap iframe ──────────────────────────────────────────────
    var wrap = document.getElementById('videoWrap');
    if (wrap) {
      // Reuse existing iframe if present, otherwise create one
      var iframe = wrap.querySelector('iframe');
      if (!iframe) {
        wrap.innerHTML = '';
        iframe = document.createElement('iframe');
        iframe.frameBorder = '0';
        iframe.allowFullscreen = true;
        iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
        iframe.style.cssText = 'width:100%;height:100%;position:absolute;inset:0;';
        wrap.appendChild(iframe);
      }
      iframe.src = embedUrl + '?rel=0&modestbranding=1&enablejsapi=1';
    }

    // ── 2. Swap title ────────────────────────────────────────────────
    var titleEl = document.querySelector('#tab-video .vid-title');
    if (titleEl) titleEl.textContent = title;

    // ── 3. Switch to Video tab ───────────────────────────────────────
    var videoBtn = document.querySelector('.room-tab-btn[data-target="tab-video"]');
    if (window.switchRoomTab && videoBtn) window.switchRoomTab(videoBtn, 'tab-video');

    // ── 4. Update active state in syllabus ──────────────────────────
    document.querySelectorAll('.sb-item').forEach(function (el) {
      el.classList.remove('sb-active');
    });
    link.classList.add('sb-active');
  });
})();

// ── Playlist navigator ───────────────────────────────────────────────────────

window.navigatePlaylist = function(direction) {
  var playlist = document.getElementById('vtPlaylist');
  if (!playlist) return;
  var items = Array.from(playlist.querySelectorAll('li'));
  if (!items.length) return;

  // Find current active item
  var activeIdx = items.findIndex(function(li) { return li.dataset.active === '1'; });
  if (activeIdx === -1) activeIdx = 0;

  var targetIdx = activeIdx + direction;
  if (targetIdx < 0) targetIdx = items.length - 1;
  if (targetIdx >= items.length) targetIdx = 0;

  var target = items[targetIdx];

  // Swap iframe
  var wrap = document.getElementById('videoWrap');
  if (wrap) {
    var iframe = wrap.querySelector('iframe');
    if (!iframe) {
      wrap.innerHTML = '';
      iframe = document.createElement('iframe');
      iframe.frameBorder = '0';
      iframe.allowFullscreen = true;
      iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
      iframe.style.cssText = 'width:100%;height:100%;position:absolute;inset:0;';
      wrap.appendChild(iframe);
    }
    iframe.src = target.dataset.embedUrl + '?rel=0&modestbranding=1&enablejsapi=1&autoplay=1';
  }

  // Update active state in playlist
  items.forEach(function(li) { delete li.dataset.active; });
  target.dataset.active = '1';

  var prevBtn = document.getElementById('vidPrevBtn');
  var nextBtn = document.getElementById('vidNextBtn');
  // Update counter
  var counter = document.getElementById('vidCounter');
  if (counter) counter.textContent = (targetIdx + 1) + '/' + items.length;
  // Update mobile nav count
  var navCount = document.getElementById('vtNavCount');
  if (navCount) navCount.textContent = (targetIdx + 1) + ' of ' + items.length;
  // Update video title under the iframe
  var titleEl = document.getElementById('vtTitle');
  if (titleEl) titleEl.textContent = target.dataset.title || '';

  // Sync active state in the sb-item list if it still exists in DOM
  document.querySelectorAll('.sb-item').forEach(function(el) { el.classList.remove('sb-active'); });
  var matchingSbItem = document.querySelector('.sb-item[data-video-id="' + target.dataset.videoId + '"]');
  if (matchingSbItem) matchingSbItem.classList.add('sb-active');
};
