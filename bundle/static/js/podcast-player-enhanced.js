// podcast-player-enhanced.js
// Enhances the podcast player with smooth progress, time display, and precise seeking

function initPodcastTransport() {
    // Elements
    const audio = document.getElementById('podcastAudio');
    const progressTrack = document.getElementById('podcastProgressTrack');
    const progressFill = document.getElementById('podcastProgressFill');
    const timeCur = document.getElementById('podcastTimeCur');
    const timeTotal = document.getElementById('podcastTimeTotal');
    const playBtn = document.getElementById('podcastPlayBtn');
    const playIcon = document.getElementById('podcastPlayIcon');
    const pauseIcon = document.getElementById('podcastPauseIcon');
    const bufferIcon = document.getElementById('podcastBufferIcon');
    const skipBackBtn = document.getElementById('podcastSkipBack');
    const skipFwdBtn = document.getElementById('podcastSkipFwd');
    const SKIP_SECONDS = 10;

    if (!audio || !progressTrack || !progressFill || !timeCur || !timeTotal || !playBtn || !playIcon || !pauseIcon || !bufferIcon || !skipBackBtn || !skipFwdBtn) return false;
    if (audio.dataset.podcastTransportBound === '1') return true;
    audio.dataset.podcastTransportBound = '1';

    function formatTime(sec) {
        sec = Math.floor(sec);
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    function updateProgress() {
        const cur = audio.currentTime;
        const total = audio.duration || 0;
        const pct = total ? (cur / total) : 0;
        progressFill.style.width = (pct * 100) + '%';
        timeCur.textContent = formatTime(cur);
        timeTotal.textContent = formatTime(total);
    }

    // Play/Pause toggle
    playBtn.addEventListener('click', function () {
        if (audio.paused) {
            audio.play();
        } else {
            audio.pause();
        }
    });

    // Update play/pause/buffer icons
    audio.addEventListener('play', function () {
        playIcon.style.display = 'none';
        pauseIcon.style.display = '';
        bufferIcon.style.display = 'none';
    });
    audio.addEventListener('pause', function () {
        playIcon.style.display = '';
        pauseIcon.style.display = 'none';
        bufferIcon.style.display = 'none';
    });
    audio.addEventListener('waiting', function () {
        if (audio.dataset.chunkLoading === '1') return;  // Bug 3: suppress buffer icon during chunk poll
        bufferIcon.style.display = '';
    });
    audio.addEventListener('playing', function () {
        bufferIcon.style.display = 'none';
    });

    // Skip back
    skipBackBtn.addEventListener('click', function () {
        audio.currentTime = Math.max(0, audio.currentTime - SKIP_SECONDS);
    });

    // Skip forward
    skipFwdBtn.addEventListener('click', function () {
        if (audio.duration) {
            audio.currentTime = Math.min(audio.duration, audio.currentTime + SKIP_SECONDS);
        }
    });

    // Seek on progress bar click
    progressTrack.addEventListener('click', function (e) {
        const rect = progressTrack.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;
        if (audio.duration) {
            audio.currentTime = pct * audio.duration;
        }
    });

    // Update progress bar and time
    audio.addEventListener('timeupdate', updateProgress);
    audio.addEventListener('loadedmetadata', updateProgress);

    // Initial update
    updateProgress();
    return true;
}

window._initPodcastTransport = initPodcastTransport;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
        initPodcastTransport();
    });
} else {
    initPodcastTransport();
}
