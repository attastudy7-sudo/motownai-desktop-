/* ── Early Theme Resolution (Prevent FOUC) ── */
(function () {
    const isAuth = document.documentElement.getAttribute('data-is-authenticated') === 'true';
    const stored = localStorage.getItem('motown-theme-mode');
    const mode = stored || (isAuth ? 'system' : 'dark');
    let theme = mode;
    if (mode === 'system' || !['dark', 'light'].includes(mode)) {
        theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-user-preference', mode);
})();