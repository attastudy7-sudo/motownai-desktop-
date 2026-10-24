/**
 * session-guard.js
 * ================
 * Global same-origin `fetch` wrapper that recovers gracefully when a
 * server-side session dies mid-interaction (e.g. a deploy wiped the old
 * ephemeral sessions store) and CSRF validation starts failing.
 *
 * Load this BEFORE any other script so it wraps `window.fetch` first.
 *
 * Behavior:
 *   - 401            -> redirect to /login?next=<current path>
 *   - 400 + code=csrf -> reload the page ONCE (guarded by sessionStorage so
 *                        it can't loop). If the reloaded page still gets a
 *                        CSRF failure, fall through to the login redirect.
 */
(function () {
    if (window.__sessionGuardInstalled) return;
    window.__sessionGuardInstalled = true;

    var RELOAD_FLAG = 'motown-csrf-reloaded';
    var AUTH_PATHS = ['/login', '/join', '/auth/login', '/auth/signup', '/api/csrf-token'];

    function isAuthPath(path) {
        return AUTH_PATHS.some(function (p) {
            return path === p || path.indexOf(p + '/') === 0 || path.indexOf(p + '?') === 0;
        });
    }

    function redirectToLogin() {
        try { sessionStorage.removeItem(RELOAD_FLAG); } catch (e) { /* private mode */ }
        if (isAuthPath(location.pathname)) return;
        var next = encodeURIComponent(location.pathname + location.search);
        location.assign('/login?next=' + next);
    }

    function tryRecoverFromCsrf() {
        try {
            if (sessionStorage.getItem(RELOAD_FLAG)) {
                // We already reloaded once and it still fails -> real auth loss.
                redirectToLogin();
                return;
            }
            sessionStorage.setItem(RELOAD_FLAG, '1');
            location.reload();
        } catch (e) {
            redirectToLogin();
        }
    }

    function shouldIntercept(url) {
        try {
            var target = new URL(url, location.origin);
            return target.origin === location.origin;
        } catch (e) {
            return false;
        }
    }

    var nativeFetch = window.fetch;
    window.fetch = function (input, init) {
        var promise = nativeFetch.apply(this, arguments);

        if (!shouldIntercept(typeof input === 'string' ? input : input.url)) {
            return promise;
        }

        return promise.then(function (response) {
            if (response.status === 401) {
                if (!isAuthPath(response.url ? new URL(response.url, location.origin).pathname : '')) {
                    redirectToLogin();
                }
                return response;
            }

            if (response.status === 400) {
                var clone = response.clone();
                clone.json().then(function (body) {
                    if (body && body.code === 'csrf') {
                        tryRecoverFromCsrf();
                    }
                }).catch(function () { /* not JSON — let callers handle it */ });
            }

            return response;
        });
    };
})();
