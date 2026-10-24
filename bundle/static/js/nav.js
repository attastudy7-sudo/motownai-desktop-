// app/static/js/nav.js - Desktop Side Nav Controller
// Handles toggle, indicator, dropdown, HTMX sync, a11y

(function() {
    'use strict';

    // ── Pages where the desktop sidebar must NEVER appear ──────────────────
    // Matched against window.location.pathname using exact match or startsWith.
    // Add any new sidebar-free pages here — no other file needs to change.
    var NO_SIDEBAR_PATHS = [
        '/index',
    ];

// Also suppress on the true root '/' (the index page served at /)
var NO_SIDEBAR_EXACT = ['/'];

/**
 * getCSRFToken — reads the CSRF token from the meta tag.
 * @returns {string} token
 */
function getCSRFToken() {
  const meta = document.querySelector('meta[name="csrf-token"]');
  return meta ? meta.content : '';
}
window.getCSRFToken = getCSRFToken;

    /**
     * syncNavVisibility — called on EVERY motown:page-ready event.
     *
     * On a hard page load the server already stamps the correct classes via
     * Jinja (show_desktop_side_nav). But when HTMX swaps only #main-content
     * the shell never re-renders, so the sidebar would persist on pages that
     * should not have it. This function inspects the current pathname and
     * adds/removes the controlling classes on the live DOM elements so the
     * visual result matches what a hard load would produce.
     */
    function syncNavVisibility() {
        const path = window.location.pathname;

        const suppress =
            NO_SIDEBAR_EXACT.includes(path) ||
            NO_SIDEBAR_PATHS.some(function(p) {
                return path === p || path.startsWith(p + '/');
            });

        // Always handle mobileHeader — it exists on every page including
        // the landing page which has no appShell wrapper.
        const mobileHeader = document.getElementById('mobileHeader');
        if (mobileHeader) {
            mobileHeader.style.display = suppress ? 'none' : '';
        }

        // Shell-dependent logic — bail if shell is absent (e.g. landing page)
        const shell = document.getElementById('appShell');
        if (!shell) return;

        const sideNav = document.getElementById('sideNav');
        const mainContent = document.getElementById('main-content');

        if (suppress) {
            shell.classList.remove('with-desktop-side-nav');
            if (sideNav) sideNav.style.display = 'none';
            if (mainContent) {
                mainContent.style.marginLeft = '';
                mainContent.classList.remove('nav-expanded');
            }
            document.body.classList.remove('nav-is-expanded');
        } else {
            shell.classList.add('with-desktop-side-nav');
            if (sideNav) sideNav.style.display = '';
            if (mainContent) {
                const isExpanded = sideNav?.classList.contains('expanded');
                mainContent.classList.toggle('nav-expanded', !!isExpanded);
            }
        }
    }

    // Per-page init
    window.initNav = function() {
        const sideNav = document.getElementById('sideNav');
        const sideNavOverlayEl = document.getElementById('sideNavOverlay');
        const mainContent = document.getElementById('main-content');
        if (!sideNav) return;

        // ── Sidebar visibility for this page ──
        syncNavVisibility();

        // Indicator slide
        initIndicator();

        // Profile dropdown
        initProfileDropdown();

        // Toggle handlers
        initToggles(sideNavOverlayEl, mainContent);

        // Keyboard nav
        initKeyboardNav();

        // Theme sync (if present)
        window.applyThemeResolution?.();

        // Active link highlighting
        updateActiveLinks();

        // Reposition indicator for the now-active link
        if (typeof window.moveDsnIndicator === 'function') {
            requestAnimationFrame(function () {
                var active = document.querySelector('#dsnNav .dsn-link.active');
                window.moveDsnIndicator(active);
            });
        }

        // User stats refresh
        if (typeof window.refreshUserStats === 'function') window.refreshUserStats();
    };

    function syncLayoutState(frame) {
        const sideNav = document.getElementById('sideNav');
        const isExpanded = sideNav?.classList.contains('expanded');
        frame.classList.toggle('nav-expanded', isExpanded);
        document.body.classList.toggle('nav-is-expanded', isExpanded);
        document.documentElement.style.setProperty('--sidebar-w', isExpanded ? '220px' : '64px');
    }

    function initIndicator() {
        if (window._navIndicatorInitialized) return;
        window._navIndicatorInitialized = true;
        const nav = document.getElementById('dsnNav');
        const indicator = document.getElementById('dsnIndicator');
        if (!nav || !indicator) return;

        window.moveDsnIndicator = function(activeLink) {
            if (!activeLink) {
                indicator.style.opacity = '0';
                return;
            }
            const navRect = nav.getBoundingClientRect();
            const linkRect = activeLink.getBoundingClientRect();
            indicator.style.transition = 'top 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease';
            indicator.style.top = (linkRect.top - navRect.top + nav.scrollTop) + 'px';
            indicator.style.opacity = '1';
        };

        // Optimistic on click
        nav.querySelectorAll('.dsn-link').forEach(link => {
            link.addEventListener('click', () => {
                nav.querySelectorAll('.dsn-link').forEach(l => l.classList.remove('active'));
                link.classList.add('active');
                window.moveDsnIndicator(link);
            });
        });
    }

    function initProfileDropdown() {
        if (window._navProfileInitialized) return;
        window._navProfileInitialized = true;

        const trigger = document.getElementById('sideNavProfileTrigger');
        const dropdown = document.getElementById('sideNavProfileDropdown');
        const chevron = document.getElementById('sideNavProfileChevron');
        const sideNav = document.getElementById('sideNav');
        if (!trigger || !dropdown) return;

        const setChevron = (deg) => {
            if (chevron) chevron.style.transform = 'rotate(' + deg + 'deg)';
        };

        const closeDropdown = () => {
            if (sideNav) sideNav.style.overflow = '';
            trigger.setAttribute('aria-expanded', 'false');
            dropdown.style.display = 'none';
            setChevron(0);
        };

        const openDropdown = () => {
            const rect = trigger.getBoundingClientRect();
            const sideNavRect = sideNav?.getBoundingClientRect() || {left: 0};
            dropdown.style.position = 'fixed';
            dropdown.style.left = sideNavRect.left + 8 + 'px';
            dropdown.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
            dropdown.style.top = 'auto';
            if (sideNav) sideNav.style.overflow = 'visible';
            trigger.setAttribute('aria-expanded', 'true');
            dropdown.style.display = 'flex';
            dropdown.style.flexDirection = 'column';
            setChevron(180);
            window.syncThemeButtons?.();
        };

        trigger.addEventListener('click', (e) => {
            if (window.innerWidth <= 1023) {
                window.openMobileDrawer?.();
                return;
            }
            e.stopPropagation();
            trigger.getAttribute('aria-expanded') === 'true' ? closeDropdown() : openDropdown();
        });

        document.addEventListener('click', (e) => {
            if (!trigger.contains(e.target) && !dropdown.contains(e.target)) closeDropdown();
        });
    }

    function initToggles(overlay, mainContent) {
        // Always re-sync layout classes after an HTMX swap,
        // even if toggle handlers are already bound.
        const saved = document.cookie.split(';').some(function(c) {
            return c.trim() === 'motown-nav-expanded=true';
        });
        if (!window.innerWidth || window.innerWidth > 1023) {
            const sideNav = document.getElementById('sideNav');
            // Pages with a persistent right-hand artifact pane pin the nav collapsed
            if (document.body.classList.contains('chat-art-layout') && sideNav) {
                sideNav.classList.remove('expanded');
            } else if (sideNav && saved) {
                sideNav.classList.add('expanded');
            }
            const mc = document.getElementById('main-content');
            if (mc) syncLayoutState(mc);
            // Ensure toggle buttons reflect the restored state for accessibility
            const hb = document.getElementById('sideNavHamburger');
            const hbCollapsed = document.getElementById('sideNavHamburgerCollapsed') || null;
            const isExpanded = document.getElementById('sideNav')?.classList.contains('expanded');
            if (hb) hb.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
            if (hbCollapsed) hbCollapsed.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
        }

        if (window._navTogglesInitialized) return;
        window._navTogglesInitialized = true;
        const hamburger = document.getElementById('sideNavHamburger');
        const hamburgerCollapsed = document.getElementById('sideNavHamburgerCollapsed') || null;
        const mobileHamburger = document.getElementById('mobileHamburgerBtn');

        const isMobile = () => window.innerWidth <= 1023;
        let _trapHandler = null, _lastFocus = null;
        function _trapFocus(el) {
            const sel = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';
            const focusable = () => Array.from(el.querySelectorAll(sel));
            _trapHandler = (e) => {
                if (e.key !== 'Tab') return;
                const items = focusable();
                if (!items.length) return;
                const first = items[0], last = items[items.length - 1];
                if (e.shiftKey) { if (document.activeElement === first) { e.preventDefault(); last.focus(); } }
                else { if (document.activeElement === last) { e.preventDefault(); first.focus(); } }
            };
            el.addEventListener('keydown', _trapHandler);
            const items = focusable();
            if (items.length) setTimeout(() => items[0].focus(), 50);
        }
        function _releaseFocusTrap(el) {
            if (_trapHandler) { el.removeEventListener('keydown', _trapHandler); _trapHandler = null; }
            if (_lastFocus) { try { _lastFocus.focus(); } catch(e) {} _lastFocus = null; }
        }
        const closeMobile = () => {
            const sideNav = document.getElementById('sideNav');
            sideNav?.classList.remove('open');
            overlay?.classList.remove('open');
            document.body.classList.remove('modal-open', 'mobile-nav-active');
            if (sideNav) _releaseFocusTrap(sideNav);
        };

        const toggleDesktop = () => {
            const sideNav = document.getElementById('sideNav');
            sideNav.classList.add('is-toggling');
            const isExpanded = sideNav.classList.toggle('expanded');
            const mc = document.getElementById('main-content');
            if (mc) syncLayoutState(mc);
            /* Only persist if functional cookies consented */
            if (window.MotownCookieConsent) {
                var cc = window.MotownCookieConsent.getConsent();
                if (cc && cc.functional) {
                    document.cookie = 'motown-nav-expanded=' + isExpanded + ';path=/;max-age=' + (60*60*24*365) + ';SameSite=Lax;Secure';
                }
            } else {
                document.cookie = 'motown-nav-expanded=' + isExpanded + ';path=/;max-age=' + (60*60*24*365) + ';SameSite=Lax;Secure';
            }
            // Update aria attributes / labels for both desktop toggle buttons
            const hb = document.getElementById('sideNavHamburger');
            const hbCollapsed = document.getElementById('sideNavHamburgerCollapsed') || null;
            if (hb) hb.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
            if (hbCollapsed) {
                hbCollapsed.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
                hbCollapsed.setAttribute('aria-label', isExpanded ? 'Collapse Navigation' : 'Expand Navigation');
            }

            setTimeout(() => sideNav.classList.remove('is-toggling'), 360);
        };

        [hamburger, hamburgerCollapsed, mobileHamburger].forEach(btn => {
            if (!btn) return;
            btn.addEventListener('click', () => {
                if (isMobile()) {
                    if (document.getElementById('sideNav')?.classList.contains('open')) closeMobile();
                    else {
                        _lastFocus = document.activeElement;
                        const sideNav = document.getElementById('sideNav');
                        sideNav?.classList.add('open');
                        overlay?.classList.add('open');
                        document.body.classList.add('modal-open', 'mobile-nav-active');
                        if (sideNav) _trapFocus(sideNav);
                    }
                } else {
                    toggleDesktop();
                }
            });
        });

        if (overlay) overlay.addEventListener('click', closeMobile);
        window.addEventListener('resize', () => { if (!isMobile()) closeMobile(); });

        // Escape closes drawer
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && isMobile() && document.getElementById('sideNav')?.classList.contains('open')) closeMobile();
        });

        // Swipe left to dismiss + auto-close on nav link tap
        const sideNavEl = document.getElementById('sideNav');
        if (sideNavEl) {
            let _tx = 0, _ty = 0;
            sideNavEl.addEventListener('touchstart', (e) => { _tx = e.touches[0].clientX; _ty = e.touches[0].clientY; }, { passive: true });
            sideNavEl.addEventListener('touchend', (e) => {
                const dx = e.changedTouches[0].clientX - _tx;
                if (dx < -50 && Math.abs(e.changedTouches[0].clientY - _ty) < 80) closeMobile();
            }, { passive: true });
            sideNavEl.addEventListener('click', (e) => { if (isMobile() && e.target.closest('.dsn-link')) closeMobile(); });
        }
    }

    function initKeyboardNav() {
        const nav = document.getElementById('dsnNav');
        if (!nav) return;
        let focusedIndex = -1;
        const links = Array.from(nav.querySelectorAll('.dsn-link'));

        nav.addEventListener('keydown', (e) => {
            if (e.target.classList.contains('dsn-link')) {
                const idx = links.indexOf(e.target);
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    links[(idx + 1) % links.length].focus();
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    links[(idx - 1 + links.length) % links.length].focus();
                }
            }
        });
    }

    function updateActiveLinks() {
        const nav = document.getElementById('dsnNav');
        if (!nav) return;
        const path = window.location.pathname;
        nav.querySelectorAll('.dsn-link').forEach(link => {
            const href = link.getAttribute('href');
            const isActive = path === href || (href !== '/' && path.startsWith(href + '/'));
            link.classList.toggle('active', isActive);
        });
    }

    // Refresh user stats (Aura)
    window.refreshUserStats = function() {
        const xpEl = document.querySelector('.dsn-user-meta');
        if (!xpEl) return;
        fetch('/api/user-stats')
            .then(r => r.json())
            .then(data => { if (data.xp !== undefined) xpEl.textContent = `${data.xp} Aura`; })
            .catch(() => {});
    };

    // Theme management (reads auth state from <html data-is-authenticated>)
    window.setTheme = function(t) {
        localStorage.setItem('motown-theme-mode', t);
        applyThemeResolution();
    };

    window.applyThemeResolution = function() {
        const htmlEl = document.documentElement;
        const isAuth = htmlEl.getAttribute('data-is-authenticated') === 'true';
        const stored = localStorage.getItem('motown-theme-mode');
        const mode = stored || (isAuth ? 'system' : 'dark');
        let theme = mode;
        if (mode === 'system' || !['dark', 'light'].includes(mode)) {
            theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        if (htmlEl.getAttribute('data-theme') !== theme) {
            htmlEl.setAttribute('data-theme', theme);
        }
        if (htmlEl.getAttribute('data-user-preference') !== mode) {
            htmlEl.setAttribute('data-user-preference', mode);
        }
        if (typeof syncThemeButtons === 'function') syncThemeButtons();
        if (typeof syncDsnDarkIcon === 'function') syncDsnDarkIcon();
    };

    // Auto-init on page load + HTMX navigation
    document.addEventListener('motown:page-ready', window.initNav);
})();

// ── Toast helper ──
// Delegates to the unified toast system in base.html when present;
// keeps a minimal standalone pill fallback (rare script-order edge case).
// NOTE: deliberately NOT a top-level `function showToast` — a hoisted
// declaration binds window.showToast before any statement runs, silently
// replacing base.html's unified toast (timer bar + severity styling) and
// making the __motown delegation check below unreachable.
if (!(window.showToast && window.showToast.__motown)) {
  window.showToast = function (msg, type) {
    var el = document.getElementById('renameToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'renameToast';
      el.className = 'toast toast--info toast--visible';
      el.style.cssText = 'position:fixed;bottom:1.5rem;left:50%;transform:translateX(-50%);z-index:10002;max-width:calc(100vw - 1rem);';
      var icon = document.createElement('span');
      icon.className = 'toast__icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = '\u2139';
      el.appendChild(icon);
      var span = document.createElement('span');
      span.className = 'toast__msg';
      el.appendChild(span);
      document.body.appendChild(el);
    }
    el.querySelector('.toast__msg').textContent = msg;
    clearTimeout(el._t);
    el._t = setTimeout(function() {
      el.classList.add('toast--leave');
      setTimeout(function() { el.classList.remove('toast--visible'); el.classList.remove('toast--leave'); }, 200);
    }, 4000);
  };
}

// ── Folder nav ──

function selectFolder(folderId, btn) {
  btn = btn || document.querySelector('.dsn-folder-item[data-folder-id="' + folderId + '"]');
  document.querySelectorAll('.dsn-folder-item').forEach(function(el) {
    el.classList.remove('active');
    if (el.hasAttribute('aria-pressed')) el.setAttribute('aria-pressed', 'false');
  });
  if (btn) {
    btn.classList.add('active');
    if (btn.hasAttribute('aria-pressed')) btn.setAttribute('aria-pressed', 'true');
  }

  // Rails belong to the "All Packs" view only, and stay out of the way
  // entirely while a search is active.
  var showRails = folderId === 'all' && !packQuery;
  ['dbRailWeak', 'dbRailContinue'].forEach(function(id) {
    var rail = document.getElementById(id);
    if (rail) rail.style.display = showRails ? '' : 'none';
  });

  // "Other study packs" heading spacing applies only to the default (all) view
  var libSection = document.querySelector('.db-section--library');
  if (libSection) libSection.classList.toggle('db-section--library-default', folderId === 'all');

  // Quizzes and study packs live in separate grids, so switching folder is a
  // matter of showing one grid or the other. The Quizzes folder is not a
  // filter over the All Packs grid: those cards are never in it to begin with.
  var quizView = folderId === 'quizzes';
  var grid = document.getElementById('packGrid');
  var quizGrid = document.getElementById('quizGrid');
  if (grid) grid.style.display = quizView ? 'none' : '';
  if (quizGrid) quizGrid.style.display = quizView ? '' : 'none';

  if (grid && !quizView) {
    grid.querySelectorAll('.pack-card-real').forEach(function (w) {
      var card = w.querySelector('.pack-card[data-folder-id]');
      if (!card) { w.remove(); return; }
      var match = folderId === 'all' || card.dataset.folderId === String(folderId);
      w.classList.toggle('is-filtered-out', !match);
    });
  }

  // Re-apply an in-flight search so folder changes and folder deletions keep
  // the query applied to the newly visible set of packs. Visibility only — this
  // must not rewrite what the user has typed.
  if (packQuery) syncPackVisibility(folderId);
  else {
    refreshPackEmptyStates(folderId);
    updatePackSectionCount(folderId);
  }

  var heading = document.getElementById('packSectionHeading');
  var activeName = btn && btn.getAttribute('data-name');
  if (heading) {
    if (folderId === 'quizzes') heading.textContent = 'Quizzes';
    else if (activeName && folderId !== 'all') heading.textContent = activeName;
    else heading.textContent = 'Other study packs';
  }

  try { sessionStorage.setItem('activeFolder', folderId); } catch(_) {}
  if (typeof closeMobileDrawer === 'function') closeMobileDrawer();
}

function updatePackSectionCount(folderId) {
  var countEl = document.getElementById('packSectionCount');
  var quizView = folderId === 'quizzes';
  var grid = document.getElementById(quizView ? 'quizGrid' : 'packGrid');
  if (!countEl || !grid) return;
  var n = grid.querySelectorAll(
    '.pack-card-real:not(.is-filtered-out):not(.is-search-hidden)'
  ).length;
  // While searching, a rail can reappear holding matches of its own. Those packs
  // are part of the result set, so they count too - minus any id the grid already
  // counted, since the same pack can be rendered in both places.
  if (packQuery) {
    var seen = {};
    Array.prototype.forEach.call(
      grid.querySelectorAll('.pack-card-real:not(.is-filtered-out):not(.is-search-hidden)'),
      function (w) {
        var card = w.querySelector('.pack-card[data-pack-id]');
        if (card) seen[card.dataset.packId] = true;
      }
    );
    n += visibleRailMatchCount(seen);
  }
  var label = quizView ? (n === 1 ? 'quiz' : 'quizzes') : (n === 1 ? 'pack' : 'packs');
  countEl.textContent = n + ' ' + label;
  var head = document.getElementById('packSectionHead');
  if (head) head.style.display = n === 0 ? 'none' : '';
  return n;
}

/* ── In-folder pack search (desktop) ─────────────────────────────────────
   The greeting search writes only `is-search-hidden`, while the folder
   filter owns `is-filtered-out`. Keeping the two classes independent means
   changing folders (or moving a pack between folders) never wipes an active
   query, and clearing the search never resurrects a hidden pack. */
var packQuery = '';

/* Searchable text: pack title (data-title when available, else the visible
   tile title) plus the subject chip. Deliberately not the whole card — card
   chrome contains words like "Resume" and "resources" that would match
   almost any query. Recomputed per call (rather than cached) so a client-side
   rename takes effect immediately. */
function packSearchableText(w) {
  var card = w.querySelector('.pack-card[data-folder-id]');
  if (!card) return '';
  var parts = [];
  if (card.dataset.title) parts.push(card.dataset.title);
  var tileTitle = card.querySelector('.pack-tile__title');
  if (tileTitle) parts.push(tileTitle.textContent);
  var chip = card.querySelector('.pack-tile__chip, .pack-banner__chip');
  if (chip) parts.push(chip.textContent);
  return parts.join(' ').toLowerCase();
}

/* Every pack card on the page: the current folder's grid plus the two
   "all packs" rails, so nothing unfiltered is left on screen. */
function allPackCardWrappers() {
  return Array.prototype.slice.call(
    document.querySelectorAll(
      '#packGrid .pack-card-real,' +
      '#quizGrid .pack-card-real,' +
      '#weakPackGrid .pack-card-real,' +
      '#continuePackGrid .pack-card-real'
    )
  );
}

/* A rail that is on screen and still holds cards the query did not reject.
   While a search is active a rail only reappears if it holds a match, which is
   what makes a pack that lives *only* in a rail reachable instead of silently
   reporting "no results" for a pack the user can see. `seen` optionally carries
   the pack ids already counted in the grid so a card rendered in both places
   is not counted twice. */
function railMatches(id, seen) {
  var rail = document.getElementById(id);
  if (!rail || rail.style.display === 'none') return 0;
  var n = 0;
  Array.prototype.forEach.call(
    rail.querySelectorAll('.pack-card-real:not(.is-search-hidden)'),
    function (w) {
      if (seen) {
        var card = w.querySelector('.pack-card[data-pack-id]');
        var key = card && card.dataset.packId;
        if (key) {
          if (seen[key]) return;
          seen[key] = true;
        }
      }
      n++;
    }
  );
  return n;
}

function visibleRailMatchCount(seen) {
  return railMatches('dbRailWeak', seen) + railMatches('dbRailContinue', seen);
}

/* Applies the current query to card visibility, rails, count and empty states.
   Split out from applyPackQuery so that a folder switch can re-sync visibility
   without ever rewriting what the user has typed. */
function syncPackVisibility(folderId) {
  if (folderId === undefined) {
    folderId = 'all';
    try { folderId = sessionStorage.getItem('activeFolder') || 'all'; } catch (_) {}
  }

  allPackCardWrappers().forEach(function (w) {
    if (!packQuery || packSearchableText(w).indexOf(packQuery) !== -1) {
      w.classList.remove('is-search-hidden');
    } else {
      w.classList.add('is-search-hidden');
    }
  });

  // Rails belong to the "All Packs" view only. While a search is active a rail
  // steps aside unless it still holds a match, so results stay focused on the
  // grid without ever orphaning a pack that only exists in a rail.
  ['dbRailWeak', 'dbRailContinue'].forEach(function (id) {
    var rail = document.getElementById(id);
    if (!rail) return;
    if (folderId !== 'all') { rail.style.display = 'none'; return; }
    if (!packQuery) { rail.style.display = ''; return; }
    rail.style.display = railMatches(id) > 0 ? '' : 'none';
  });

  updatePackSectionCount(folderId);
  refreshPackEmptyStates(folderId);
}

function applyPackQuery(raw, folderId) {
  packQuery = (raw || '').trim().toLowerCase();

  var input = document.getElementById('dbDashSearchInput');
  if (input && input.value !== (raw || '')) input.value = raw || '';
  var clearBtn = document.getElementById('dbDashSearchClear');
  if (clearBtn) clearBtn.classList.toggle('is-visible', !!packQuery);

  syncPackVisibility(folderId);
}

function clearPackSearch() {
  var input = document.getElementById('dbDashSearchInput');
  if (input) input.value = '';
  applyPackQuery('');
  if (input) input.focus();
}

/* ── Mobile search: the FAB lends the field to the quick-action row ────────
   At ≤480px that row holds only New pack + Discover, so opening search puts
   the field in their slot and hides both cards; closing hands the field back
   to the greeting row and drops the filter so every pack returns. There is no
   search sheet - results always filter the grid in place. */
var dashSearchHome = null;
var mobileSearchMq = window.matchMedia('(max-width: 480px)');

function searchFieldInSlot() {
  var slot = document.getElementById('dbQaSearchSlot');
  var field = document.getElementById('dbDashSearch');
  return !!(slot && field && slot.contains(field));
}

function openDashSearch() {
  if (!mobileSearchMq.matches) return;
  var field = document.getElementById('dbDashSearch');
  var slot = document.getElementById('dbQaSearchSlot');
  var row = document.getElementById('dbQaRow');
  if (!field || !slot || !row) return;
  if (!dashSearchHome) dashSearchHome = field.parentNode;
  slot.appendChild(field);
  slot.hidden = false;
  row.classList.add('has-search');
  var input = document.getElementById('dbDashSearchInput');
  if (input) {
    input.focus();
    input.select();
  }
}

function closeDashSearch() {
  var field = document.getElementById('dbDashSearch');
  var slot = document.getElementById('dbQaSearchSlot');
  var row = document.getElementById('dbQaRow');
  if (!field || !slot || !row || !slot.contains(field)) return;
  applyPackQuery('');
  row.classList.remove('has-search');
  slot.hidden = true;
  if (dashSearchHome) dashSearchHome.appendChild(field);
  var fab = document.getElementById('dbSearchFab');
  if (fab) fab.focus();
}

function initDashSearch() {
  var input = document.getElementById('dbDashSearchInput');
  if (!input) return;

  input.addEventListener('input', function () { applyPackQuery(input.value); });

  // Escape leaves search mode first, and only falls through to clearing text
  // when the field is sitting in the greeting row on wider screens.
  input.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (searchFieldInSlot()) {
      e.preventDefault();
      closeDashSearch();
      return;
    }
    if (input.value) {
      e.preventDefault();
      clearPackSearch();
    }
  });

  // Slash focuses search from anywhere on the page (not while typing).
  document.addEventListener('keydown', function (e) {
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    var el = document.getElementById('dbDashSearchInput');
    if (!el || el.offsetParent === null) return;
    e.preventDefault();
    el.focus();
    el.select();
  });

  ['dbDashSearchClear', 'packSearchEmptyClear'].forEach(function (id) {
    var btn = document.getElementById(id);
    if (btn) btn.addEventListener('click', clearPackSearch);
  });

  var fab = document.getElementById('dbSearchFab');
  if (fab) fab.addEventListener('click', openDashSearch);

  var closeBtn = document.getElementById('dbDashSearchClose');
  if (closeBtn) closeBtn.addEventListener('click', closeDashSearch);

  // Rotating or resizing past the phone breakpoint hands the field home so it
  // never gets stranded in the action row.
  if (mobileSearchMq.addEventListener) {
    mobileSearchMq.addEventListener('change', function () {
      if (!mobileSearchMq.matches) closeDashSearch();
    });
  }
}

/* Empty states are mutually exclusive: an active search owns the message so
   "No packs yet" never shows up just because a query matched nothing. */
function refreshPackEmptyStates(folderId) {
  var quizView = folderId === 'quizzes';
  var grid = document.getElementById(quizView ? 'quizGrid' : 'packGrid');
  var searching = !!packQuery;
  // A match sitting in a rail counts as a result: the pack is on the dashboard,
  // so reporting "no results" while its rail card is visible would be a lie.
  var anyVisible = !!(grid && grid.querySelector(
    '.pack-card-real:not(.is-filtered-out):not(.is-search-hidden)'
  )) || (searching && visibleRailMatchCount() > 0);

  var searchEmpty = document.getElementById('packSearchEmptyState');
  var quizEmpty = document.getElementById('quizEmptyState');
  var folderEmpty = document.getElementById('folderEmptyState');

  if (searchEmpty) searchEmpty.classList.toggle('is-visible', searching && !anyVisible);
  if (quizEmpty) quizEmpty.classList.toggle('is-visible', quizView && !anyVisible);
  if (folderEmpty) folderEmpty.classList.toggle('is-visible', !quizView && !searching && !anyVisible);
  if (searching) return;

  if (folderEmpty) {
    var feTitle = document.getElementById('folderEmptyTitle');
    var feSub = document.getElementById('folderEmptySub');
    if (folderId === 'all') {
      if (feTitle) feTitle.textContent = 'No packs yet';
      if (feSub) feSub.textContent = 'Create your first pack from slides, a topic, or a video.';
    } else {
      if (feTitle) feTitle.textContent = 'This folder is empty';
      if (feSub) feSub.textContent = 'Create a pack and add it to this folder';
    }
  }
}

function showCreateFolderInput(btn) {
  // Hide non‑header + buttons while creating a folder
  document.querySelectorAll('.dsn-folders__add-btn').forEach(b => {
    if (!b.closest('.dsn-folders__header')) b.style.display = 'none';
  });

  const folderSection = btn.closest('.dsn-folders');
  if (!folderSection) return;
  const folderList = folderSection.querySelector('.dsn-folders__list');
  if (!folderList) return;

  const newItem = document.createElement('div');
  newItem.className = 'dsn-folder-item';
  newItem.innerHTML = `
    <svg class="dsn-folder-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
    </svg>
    <input type="text" class="dsn-folder-rename-input" placeholder="Folder name"/>
    <button class="dsn-folder-cancel-btn" onclick="cancelCreateFolder(this)" title="Cancel">✕</button>
  `;

  const lastFolder = folderList.querySelector('.dsn-folder-item:last-child');
  if (lastFolder) lastFolder.after(newItem);
  else folderList.appendChild(newItem);

  // Remove the empty‑state placeholder if it exists
  const emptyPlaceholder = folderList.querySelector('.dsn-folders__empty');
  if (emptyPlaceholder) emptyPlaceholder.remove();

  const input = newItem.querySelector('input');
  if (input) {
    input.focus();
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (this._createBlurTimer) clearTimeout(this._createBlurTimer);
        submitFolder(this);
      }
    });
    input.addEventListener('blur', function() {
      this._createBlurTimer = setTimeout(() => submitFolder(this), 150);
    });
  }
}



function cancelCreateFolder(btn) {
  const container = btn.closest('.dsn-folder-item') || btn.closest('.dsn-folder-create-input');
  if (!container) return;
  const input = container.querySelector('input');
  if (input) {
    if (input._createBlurTimer) clearTimeout(input._createBlurTimer);
    input._submitting = true;
  }
  const folderSection = container.closest('.dsn-folders');
  if (!folderSection) return;
  container.remove();

  // Restore all non‑header “+” buttons that were hidden while creating
  document.querySelectorAll('.dsn-folders__add-btn').forEach(b => {
    if (!b.closest('.dsn-folders__header')) b.style.display = '';
  });

  // If no folder items remain, put the empty‑state placeholder back
  const folderList = folderSection.querySelector('.dsn-folders__list');
  if (folderList && folderList.querySelectorAll('.dsn-folder-item').length === 0) {
    const empty = document.createElement('div');
    empty.className = 'dsn-folders__empty default_cursor_cs';
    empty.setAttribute('aria-label', 'No folders yet');
    empty.innerHTML = `<button onclick="showCreateFolderInput(this)" class="dsn-folders__add-btn" title="Create folder" aria-label="Create folder"><svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2Z"></path></svg></button>`;
    folderList.appendChild(empty);
  }
}

/* ── Sync helpers ── */
function allFolderEls(id) {
  return document.querySelectorAll('.dsn-folder-item[data-folder-id="' + id + '"]');
}

function sidebarFolderItemHTML(id, name, packCount, color) {
  var safeName = name.replace(/</g,'&lt;');
  var escName = name.replace(/'/g,"\\'");
  var count = packCount || 0;
  return '<svg class="dsn-folder-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: ' + (color || 'var(--accent)') + '"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>' +
    '<span class="dsn-folder-text">' +
      '<span class="dsn-folder-name">' + safeName + '</span>' +
      '<span class="dsn-folder-meta">' + count + ' pack' + (count !== 1 ? 's' : '') + '</span>' +
    '</span>' +
    '<div class="dsn-folder-menu-wrap">' +
      '<button class="dsn-folder-menu__btn" onclick="event.stopPropagation();toggleFolderMenu(this)" aria-label="Folder options"><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="3" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="8" cy="13" r="1.4"/></svg></button>' +
      '<div class="dsn-folder-menu">' +
        '<button class="dsn-folder-menu__item" onclick="event.stopPropagation(); renameFolder(' + id + ',\'' + escName + '\',this)">Rename</button>' +
        '<button class="dsn-folder-menu__item dsn-folder-menu__item--danger" onclick="event.stopPropagation(); deleteFolder(' + id + ',\'' + escName + '\')">Delete</button>' +
      '</div>' +
    '</div>';
}

function folderRowChipHTML(id, name) {
  var safeName = name.replace(/</g,'&lt;');
  return '<button class="dsn-folder-item dsn-folder-item--row" data-folder-id="' + id + '" data-name="' + safeName + '" onclick="selectFolder(' + id + ', this)">' +
    '<svg class="dsn-folder-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent)">' +
    '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>' +
    '<span class="dsn-folder-name">' + safeName + '</span>' +
    '<span class="dsn-folder-count">0</span></button>';
}

function syncFolderCreate(data) {
  // Row chip
  var row = document.getElementById('folderRow');
  var addBtn = row ? row.querySelector('.folder-row-add') : null;
  if (row && addBtn) {
    var temp = document.createElement('template');
    temp.innerHTML = folderRowChipHTML(data.id, data.name);
    row.insertBefore(temp.content.firstChild, addBtn);
  }
  setTimeout(updateFolderRowFade, 50);
  // Folders panel items
  document.querySelectorAll('.dsn-folders__list').forEach(function(list) {
    if (list.querySelector('.dsn-folder-item[data-folder-id="' + data.id + '"]')) return;
    var el = document.createElement('div');
    el.className = 'dsn-folder-item';
    el.dataset.folderId = data.id;
    el.dataset.name = data.name;
    el.title = data.name;
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('onclick', 'selectFolder(' + data.id + ', this)');
    el.setAttribute('onkeydown', "if(event.key==='Enter'||event.key===' ')selectFolder(" + data.id + ",this)");
    if (data.color) el.style.setProperty('--folder-accent', data.color);
    el.innerHTML = sidebarFolderItemHTML(data.id, data.name, data.pack_count, data.color);
    list.appendChild(el);
  });
}

function syncFolderRename(id, name) {
  var safeName = name.replace(/</g,'&lt;');
  var escName = name.replace(/'/g,"\\'");
  allFolderEls(id).forEach(function (el) {
    var n = el.querySelector('.dsn-folder-name');
    if (n) n.textContent = name;
    el.setAttribute('data-name', name);
    el.setAttribute('title', name);
    // Rebuild rename/delete menu button onclick args so subsequent renames pass the new name
    var menu = el.querySelector('.dsn-folder-menu');
    if (menu) {
      var btns = menu.querySelectorAll('button');
      if (btns[0]) btns[0].setAttribute('onclick', "renameFolder(" + id + ",'" + escName + "',this)");
      if (btns[1]) btns[1].setAttribute('onclick', "deleteFolder(" + id + ",'" + escName + "')");
    }
  });
}

function syncFolderDelete(id) {
  allFolderEls(id).forEach(function (el) { el.remove(); });
  setTimeout(updateFolderRowFade, 50);
}

/* ── Row overflow fade ── */
function updateFolderRowFade() {
  var row = document.getElementById('folderRow');
  if (!row) return;
  var more = row.scrollWidth - row.clientWidth - row.scrollLeft > 4;
  row.classList.toggle('has-overflow-right', more);
}

function postCreateFolder(name) {
  return fetch('/api/folders', {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'X-CSRFToken': getCSRFToken()},
    body: JSON.stringify({name: name})
  }).then(function(r) { return r.json(); });
}

function submitFolder(inputEl) {
  if (inputEl._submitting) return;
  const name = inputEl.value.trim();
  if (!name) {
    cancelCreateFolder(inputEl.closest('.dsn-folder-item') || inputEl.closest('.dsn-folder-create-input'));
    return;
  }
  inputEl._submitting = true;
  const folderList = inputEl.closest('.dsn-folders__list') || inputEl.closest('.dsn-folders')?.querySelector('.dsn-folders__list');
  const tempItem = inputEl.closest('.dsn-folder-item');
  postCreateFolder(name)
  .then(function(data) {
    if (!data.id) { if (tempItem) tempItem.remove(); return; }
    var realItem = document.createElement('div');
    realItem.className = 'dsn-folder-item';
    realItem.dataset.folderId = data.id;
    realItem.dataset.name = data.name;
    realItem.title = data.name;
    realItem.setAttribute('onclick', 'selectFolder(' + data.id + ', this)');
    realItem.innerHTML = sidebarFolderItemHTML(data.id, data.name);
    if (tempItem && tempItem.parentNode) tempItem.parentNode.replaceChild(realItem, tempItem);
    else if (folderList) folderList.appendChild(realItem);
    syncFolderCreate(data);
    document.querySelectorAll('.dsn-folders__add-btn').forEach(function(b) {
      if (!b.closest('.dsn-folders__header')) b.style.display = '';
    });
  })
  .catch(function(err) {
    console.error('Create folder failed', err);
    if (tempItem) tempItem.remove();
  });
}




function createFolderFromRow(btn) {
  var row = document.getElementById('folderRow');
  if (!row) return;
  var chip = document.createElement('div');
  chip.className = 'dsn-folder-item dsn-folder-item--row folder-row-create';
  chip.innerHTML = '<input type="text" class="dsn-folder-rename-input" placeholder="Folder name">';
  row.insertBefore(chip, btn);
  setTimeout(updateFolderRowFade, 50);
  function removeChip() { chip.remove(); setTimeout(updateFolderRowFade, 50); }
  var input = chip.querySelector('input');
  if (input) {
    input.focus();
    var _submitted = false;
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (_submitted) return;
        _submitted = true;
        if (this._rowBlurTimer) clearTimeout(this._rowBlurTimer);
        var name = input.value.trim();
        if (!name) { _submitted = false; removeChip(); return; }
        postCreateFolder(name).then(function(data) {
          if (!data.id) { removeChip(); return; }
          removeChip();
          syncFolderCreate(data);
        }).catch(function() { removeChip(); });
      } else if (e.key === 'Escape') {
        removeChip();
      }
    });
    input.addEventListener('blur', function() {
      if (_submitted) return;
      this._rowBlurTimer = setTimeout(function() {
        var name = input.value.trim();
        if (!name) { removeChip(); return; }
        postCreateFolder(name).then(function(data) {
          if (!data.id) { removeChip(); return; }
          removeChip();
          syncFolderCreate(data);
        }).catch(function() { removeChip(); });
      }, 200);
    });
  }
}

/* ── Rename folder via bottom sheet ── */
var _renameFolderId = null;

function renameFolder(folderId, currentName, btn) {
  var item = btn ? btn.closest('.dsn-folder-item') : null;
  if (item) {
    var menu = item.querySelector('.dsn-folder-menu');
    if (menu) closeAllFolderMenus();
  }
  _renameFolderId = folderId;

  var overlay = document.getElementById('renameFolderOverlay');
  var sheet = document.getElementById('renameFolderSheet');
  var input = document.getElementById('renameFolderNameInput');
  var error = document.getElementById('renameFolderError');
  var saveBtn = document.getElementById('renameFolderSaveBtn');
  if (!overlay || !sheet || !input) return;

  input.value = currentName;
  input.classList.remove('shake');
  if (error) error.textContent = '';
  if (saveBtn) saveBtn.disabled = false;

  sheet.classList.add('open');
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  setTimeout(function () { input.focus(); input.select(); }, 300);
}

function closeRenameFolderSheet() {
  var overlay = document.getElementById('renameFolderOverlay');
  var sheet = document.getElementById('renameFolderSheet');
  var input = document.getElementById('renameFolderNameInput');
  var error = document.getElementById('renameFolderError');
  if (sheet) sheet.classList.remove('open');
  if (overlay) overlay.classList.remove('open');
  document.body.style.overflow = '';
  if (input) { input.value = ''; input.classList.remove('shake'); }
  if (error) error.textContent = '';
  _renameFolderId = null;
}

function submitRenameFolder() {
  var input = document.getElementById('renameFolderNameInput');
  var error = document.getElementById('renameFolderError');
  var saveBtn = document.getElementById('renameFolderSaveBtn');
  if (!input || !error || !_renameFolderId) return;

  var val = input.value.trim();
  if (!val) {
    input.classList.add('shake');
    error.textContent = 'Please enter a folder name';
    input.focus();
    return;
  }
  if (val.length > 40) {
    input.classList.add('shake');
    error.textContent = 'Folder name must be 40 characters or fewer';
    input.focus();
    return;
  }

  saveBtn.disabled = true;
  error.textContent = '';

  fetch('/api/folders/' + _renameFolderId, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': document.querySelector('meta[name="csrf-token"]').content },
    body: JSON.stringify({ name: val })
  }).then(function (r) {
    if (r.ok) {
      syncFolderRename(_renameFolderId, val);
      closeRenameFolderSheet();
    } else {
      error.textContent = 'Failed to rename folder';
      input.classList.add('shake');
      saveBtn.disabled = false;
    }
  }).catch(function () {
    error.textContent = 'Network error. Please try again.';
    saveBtn.disabled = false;
  });
}

(function () {
  var input = document.getElementById('renameFolderNameInput');
  if (!input) return;
  input.addEventListener('keydown', function (e) {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); submitRenameFolder(); }
    if (e.key === 'Escape') { e.preventDefault(); closeRenameFolderSheet(); }
  });
  input.addEventListener('input', function () {
    input.classList.remove('shake');
    var error = document.getElementById('renameFolderError');
    if (error) error.textContent = '';
  });
})();

function deleteFolder(folderId, name) {
  if (!confirm('Delete "' + name + '"? Packs inside will become uncategorised.')) return;
  syncFolderDelete(folderId);
  document.querySelectorAll('.pack-card[data-folder-id="' + folderId + '"]').forEach(function(card) {
    card.dataset.folderId = '';
    var wrap = card.closest('.pack-card-wrap');
    if (wrap) wrap.style.display = '';
  });
  var wasActive = false;
  try {
    var active = sessionStorage.getItem('activeFolder');
    if (active === String(folderId)) { sessionStorage.removeItem('activeFolder'); wasActive = true; }
  } catch(_) {}
  if (wasActive) {
    var dsnHeading = document.getElementById('dsnPackHeading');
    if (dsnHeading) dsnHeading.textContent = 'All Packs';
    selectFolder('all');
  }
  document.querySelectorAll('.dsn-folders__list').forEach(function(list) {
    if (list.querySelectorAll('.dsn-folder-item').length === 0) {
      var empty = document.createElement('div');
      empty.className = 'dsn-folders__empty default_cursor_cs';
      empty.innerHTML = '<button onclick="showCreateFolderInput(this)" class="dsn-folders__add-btn" title="Create folder" aria-label="Create folder"><svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2Z"></path></svg></button>';
      list.appendChild(empty);
    }
  });
  fetch('/api/folders/' + folderId, {
    method: 'DELETE',
    headers: { 'X-CSRFToken': document.querySelector('meta[name="csrf-token"]').content }
  }).catch(function() {
    location.reload();
  });
}

/* ── Folder chip dropdown (⋯ menu) ── */
function toggleFolderMenu(ellipsisBtn) {
  var item = ellipsisBtn.closest('.dsn-folder-item');
  if (!item) return;

  /* Mobile → bottom sheet */
  if (window.matchMedia('(max-width: 640px)').matches) {
    openFolderMenuSheet(item);
    return;
  }

  var menu = item.querySelector('.dsn-folder-menu');
  if (!menu) return;
  var isOpen = menu.classList.contains('dsn-folder-menu--open');
  closeAllFolderMenus();
  if (!isOpen) {
    menu.classList.add('dsn-folder-menu--open');
    var rect = ellipsisBtn.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top = (rect.bottom + 4) + 'px';
    menu.style.right = (window.innerWidth - rect.right) + 'px';
    menu.style.left = 'auto';
    menu.style.zIndex = '9999';
  }
}

function closeAllFolderMenus() {
  document.querySelectorAll('.dsn-folder-menu--open').forEach(function(el) {
    el.classList.remove('dsn-folder-menu--open');
    el.style.position = '';
    el.style.top = '';
    el.style.left = '';
    el.style.right = '';
    el.style.zIndex = '';
  });
}

/* ── Folder menu bottom sheet (mobile) ── */
var _folderMenuFolderId = null;
var _folderMenuFolderName = '';
var _folderMenuFolderColor = '';

function openFolderMenuSheet(item) {
  closeAllFolderMenus();
  _folderMenuFolderId = item.dataset.folderId;
  _folderMenuFolderName = item.dataset.name || '';
  _folderMenuFolderColor = item.dataset.color || '';

  var sheet = document.getElementById('folderMenuSheet');
  var title = document.getElementById('folderMenuSheetTitle');
  if (!sheet || !title) return;

  title.textContent = _folderMenuFolderName;
  sheet.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeFolderMenuSheet() {
  var sheet = document.getElementById('folderMenuSheet');
  if (sheet) sheet.classList.remove('open');
  document.body.style.overflow = '';
  _folderMenuFolderId = null;
}

document.addEventListener('DOMContentLoaded', function() {
  var renameBtn = document.getElementById('folderMenuSheetRename');
  var colorBtn = document.getElementById('folderMenuSheetColor');
  var deleteBtn = document.getElementById('folderMenuSheetDelete');

  if (renameBtn) renameBtn.addEventListener('click', function() {
    var id = _folderMenuFolderId;
    var name = _folderMenuFolderName;
    if (!id) return;
    closeFolderMenuSheet();
    renameFolder(id, name, null);
  });

  if (colorBtn) colorBtn.addEventListener('click', function() {
    var id = _folderMenuFolderId;
    var color = _folderMenuFolderColor;
    if (!id) return;
    closeFolderMenuSheet();
    openFolderColorPicker(id, color, null);
  });

  if (deleteBtn) deleteBtn.addEventListener('click', function() {
    var id = _folderMenuFolderId;
    var name = _folderMenuFolderName;
    if (!id) return;
    closeFolderMenuSheet();
    deleteFolder(id, name);
  });
});

var FOLDER_COLORS = ['#6366f1','#8b5cf6','#ec4899','#ef4444','#f59e0b','#10b981','#06b6d4','#3b82f6','#6b7280'];

/* ── Folder color bottom sheet ── */
var _colorFolderId = null;
var _colorFolderItem = null;
var _colorSelected = '';

function openFolderColorPicker(folderId, currentColor, btn) {
  var item = btn ? btn.closest('.dsn-folder-item') : null;
  if (item) closeAllFolderMenus();
  _colorFolderId = folderId;
  _colorFolderItem = item;
  _colorSelected = currentColor || '';

  var overlay = document.getElementById('folderColorOverlay');
  var sheet = document.getElementById('folderColorSheet');
  var swatches = sheet.querySelectorAll('.folder-color-swatch');
  var defaultBtn = sheet.querySelector('.folder-color-default');
  if (!overlay || !sheet) return;

  swatches.forEach(function(s) {
    s.classList.toggle('selected', s.dataset.color === _colorSelected);
  });
  if (defaultBtn) defaultBtn.classList.toggle('selected', !_colorSelected);

  sheet.classList.add('open');
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeFolderColorSheet() {
  var overlay = document.getElementById('folderColorOverlay');
  var sheet = document.getElementById('folderColorSheet');
  if (sheet) sheet.classList.remove('open');
  if (overlay) overlay.classList.remove('open');
  document.body.style.overflow = '';
  _colorFolderId = null;
  _colorFolderItem = null;
  _colorSelected = '';
}

function selectFolderColor(el) {
  var sheet = document.getElementById('folderColorSheet');
  var swatches = sheet.querySelectorAll('.folder-color-swatch');
  var defaultBtn = sheet.querySelector('.folder-color-default');

  swatches.forEach(function(s) { s.classList.remove('selected'); });
  if (defaultBtn) defaultBtn.classList.remove('selected');

  if (el) {
    el.classList.add('selected');
    _colorSelected = el.dataset.color;
  } else {
    if (defaultBtn) defaultBtn.classList.add('selected');
    _colorSelected = '';
  }
}

function applyFolderColor() {
  if (!_colorFolderId) { closeFolderColorSheet(); return; }
  var item = _colorFolderItem;
  if (!item) {
    item = document.querySelector('.dsn-folder-item[data-folder-id="' + _colorFolderId + '"]');
  }
  if (!item) { closeFolderColorSheet(); return; }
  changeFolderColor(_colorFolderId, _colorSelected, item);
  closeFolderColorSheet();
}

function changeFolderColor(folderId, color, item) {
  var icon = item.querySelector('.dsn-folder-icon');
  if (icon) icon.style.color = color || 'var(--accent)';
  item.setAttribute('data-color', color);
  item.style.setProperty('--folder-accent', color || 'transparent');

  document.querySelectorAll('.pack-card[data-folder-id="' + folderId + '"] .pack-mobile__folder-icon').forEach(function(el) {
    el.style.setProperty('--folder-light', blendTowardWhite(color || '#6366f1', 0.4));
    el.style.setProperty('--folder-dark', color || 'var(--accent)');
  });

  fetch('/api/folders/' + folderId, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': document.querySelector('meta[name="csrf-token"]').content },
    body: JSON.stringify({ color: color })
  }).catch(function() {
    location.reload();
  });
}

function blendTowardWhite(hex, blend) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  var r = parseInt(hex.substring(0, 2), 16);
  var g = parseInt(hex.substring(2, 4), 16);
  var b = parseInt(hex.substring(4, 6), 16);
  r = Math.round(r + (255 - r) * blend);
  g = Math.round(g + (255 - g) * blend);
  b = Math.round(b + (255 - b) * blend);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape' && document.getElementById('folderColorSheet')?.classList.contains('open')) {
    e.preventDefault();
    closeFolderColorSheet();
  }
});

document.addEventListener('click', function() {
  closeAllFolderMenus();
}, { capture: true });

document.addEventListener('DOMContentLoaded', function() {
  try {
    var saved = sessionStorage.getItem('activeFolder');
    if (saved && saved !== 'all') {
      var btn = document.querySelector('.dsn-folder-item[data-folder-id="' + saved + '"]');
      if (btn) selectFolder(saved, btn);
    } else {
      // Default view is "All Packs": quizzes belong to the Quizzes folder only,
      // so keep them out of the grid until that folder is selected.
      selectFolder('all', null);
    }
  } catch(_) {}
  initDashSearch();
  updateFolderRowFade();
  var row = document.getElementById('folderRow');
  if (row) row.addEventListener('scroll', updateFolderRowFade, {passive: true});
  window.addEventListener('resize', updateFolderRowFade, {passive: true});
});

// ── Pack card menu: close any open dropdown on outside click ──
// Single delegated listener for all pack cards on the page (avoids
// registering one duplicate listener per card via _pack_card.html).
document.addEventListener('click', function() {
  document.querySelectorAll('.pack-menu__dropdown--open').forEach(function(el) {
    el.classList.remove('pack-menu__dropdown--open');
  });
}, { capture: true });

function openRenameSheet(packId, currentName) {
  var list = document.getElementById('packBottomSheetItems');
  if (!list) return;
  list.innerHTML = '';

  var form = document.createElement('div');
  form.style.cssText = 'padding:4px 4px 8px;';

  var label = document.createElement('label');
  label.style.cssText = 'font-size:0.8rem;font-weight:600;color:var(--text-muted);display:block;margin-bottom:6px;';
  label.textContent = 'Pack name';

  var input = document.createElement('input');
  input.id = 'packRenameInput';
  input.type = 'text';
  input.value = currentName;
  input.maxLength = 200;
  input.style.cssText = 'width:100%;padding:10px 12px;font-size:15px;font-weight:600;font-family:inherit;color:var(--text-primary);background:var(--bg-hover);border:1px solid var(--border);border-radius:10px;outline:none;box-sizing:border-box;';

  var btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;margin-top:14px;';

  var cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = 'flex:1;padding:10px;border-radius:10px;font-size:14px;font-weight:600;background:var(--bg-hover);color:var(--text-primary);border:1px solid var(--border);cursor:pointer;';

  var saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save';
  saveBtn.style.cssText = 'flex:1;padding:10px;border-radius:10px;font-size:14px;font-weight:600;background:var(--primary);color:#fff;border:none;cursor:pointer;';

  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(saveBtn);
  form.appendChild(label);
  form.appendChild(input);
  form.appendChild(btnRow);
  list.appendChild(form);

  saveBtn.addEventListener('click', function() { _doRename(packId, input.value.trim(), currentName); });
  cancelBtn.addEventListener('click', function() { closePackBottomSheet(); });
  input.addEventListener('keydown', function(e) {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); _doRename(packId, input.value.trim(), currentName); }
    if (e.key === 'Escape') { e.preventDefault(); closePackBottomSheet(); }
  });
  input.focus();
  input.select();

  document.getElementById('packBottomSheetOverlay').classList.add('pack-bs-overlay--open');
  document.getElementById('packBottomSheet').classList.add('pack-bs--open');
  document.body.style.overflow = 'hidden';
}

function _doRename(packId, newName, oldName) {
  if (!newName || newName === oldName) { closePackBottomSheet(); return; }
  fetch('/api/packs/' + packId + '/rename', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': document.querySelector('meta[name="csrf-token"]').content },
    body: JSON.stringify({ name: newName })
  }).then(function(r) {
    if (r.ok) {
      var card = document.querySelector('.pack-card[data-pack-id="' + packId + '"]');
      if (card) {
        var link = card.querySelector('.pack-title a');
        var mobileName = card.querySelector('.pack-mobile__name');
        if (link) link.textContent = newName;
        if (mobileName) mobileName.textContent = newName;
      }
      closePackBottomSheet();
    } else {
      r.json().then(function(d) { showToast(d.error || 'Failed to rename.'); }).catch(function() { showToast('Failed to rename.'); });
    }
  }).catch(function() { showToast('Failed to rename.'); });
}

function deletePack(packId, title, btn) {
  var card = (btn && btn.closest('.pack-card')) ||
    document.querySelector('.pack-card[data-pack-id="' + packId + '"]');
  var menu = card ? card.querySelector('.pack-menu__dropdown') : null;
  if (menu) menu.classList.remove('pack-menu__dropdown--open');

  var list = document.getElementById('packBottomSheetItems');
  if (!list) return;
  list.innerHTML = '';

  var wrap = document.createElement('div');
  wrap.style.cssText = 'padding:4px 4px 8px;';

  var icon = document.createElement('div');
  icon.style.cssText = 'width:44px;height:44px;border-radius:12px;background:rgba(239,68,68,0.12);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;';
  icon.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>';

  var heading = document.createElement('div');
  heading.style.cssText = 'font-size:16px;font-weight:600;color:var(--text-primary);text-align:center;margin-bottom:6px;';
  heading.textContent = 'Delete pack?';

  var desc = document.createElement('div');
  desc.style.cssText = 'font-size:14px;color:var(--text-secondary);text-align:center;margin-bottom:20px;line-height:1.4;';
  desc.textContent = '"' + (title || 'This pack') + '" will be permanently deleted. This cannot be undone.';

  var btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;';

  var cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = 'flex:1;padding:10px;border-radius:10px;font-size:14px;font-weight:600;background:var(--bg-hover);color:var(--text-primary);border:1px solid var(--border);cursor:pointer;';

  var deleteBtn = document.createElement('button');
  deleteBtn.textContent = 'Delete';
  deleteBtn.style.cssText = 'flex:1;padding:10px;border-radius:10px;font-size:14px;font-weight:600;background:#ef4444;color:#fff;border:none;cursor:pointer;';

  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(deleteBtn);
  wrap.appendChild(icon);
  wrap.appendChild(heading);
  wrap.appendChild(desc);
  wrap.appendChild(btnRow);
  list.appendChild(wrap);

  cancelBtn.addEventListener('click', function() { closePackBottomSheet(); });
  deleteBtn.addEventListener('click', function() {
    closePackBottomSheet();
    _doDeletePack(packId);
  });

  document.getElementById('packBottomSheetOverlay').classList.add('pack-bs-overlay--open');
  document.getElementById('packBottomSheet').classList.add('pack-bs--open');
  document.body.style.overflow = 'hidden';
}

function _doDeletePack(packId) {
  fetch('/api/packs/' + packId, {
    method: 'DELETE',
    headers: { 'X-CSRFToken': document.querySelector('meta[name="csrf-token"]').content }
  }).then(function(r) {
    if (r.ok) {
      document.querySelectorAll('.pack-card[data-pack-id="' + packId + '"]').forEach(function (el) {
        var w = el.closest('.pack-card-real');
        (w || el).remove();
      });
      var cur = 'all';
      try { cur = sessionStorage.getItem('activeFolder') || 'all'; } catch(_) {}
      selectFolder(cur, null);
    }
    else { r.json().then(function(d) { showToast(d.error || 'Failed to delete pack.'); }).catch(function() { showToast('Failed to delete pack.'); }); }
  }).catch(function() { showToast('Failed to delete pack.'); });
}

function addToFolder(packId, title, btn, packType) {
  packType = packType || 'study';
  var card = (btn && btn.closest('.pack-card')) ||
    document.querySelector('.pack-card[data-pack-id="' + packId + '"]');
  var menu = card ? card.querySelector('.pack-menu__dropdown') : null;
  if (menu) menu.classList.remove('pack-menu__dropdown--open');

  var existing = document.querySelector('.dsn-folder-picker-overlay');
  if (existing) existing.parentNode.removeChild(existing);

  var overlay = document.createElement('div');
  overlay.className = 'dsn-folder-picker-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.innerHTML =
    '<div class="dsn-folder-picker">' +
      '<div class="dsn-folder-picker__head">' +
        '<span class="dsn-folder-picker__title">Move to folder</span>' +
        '<button class="dsn-folder-picker__close">&times;</button>' +
      '</div>' +
      '<div class="dsn-folder-picker__list"></div>' +
    '</div>';

  document.body.appendChild(overlay);

  var list = overlay.querySelector('.dsn-folder-picker__list');

  function moveTo(folderId) {
    var url = '/api/pack/' + packId + '/move';
    console.log('Attempting to move pack to folder:', url, 'folder_id:', folderId);
    fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCSRFToken() },
      body: JSON.stringify({ folder_id: folderId, type: packType })
    }).then(function(r) {
      console.log('Move response:', r.status, r.ok);
      overlay.parentNode.removeChild(overlay);
      if (r.ok) {
        if (card) {
          card.dataset.folderId = folderId ? String(folderId) : '';
          try {
            var activeFolder = sessionStorage.getItem('activeFolder');
            if (activeFolder && activeFolder !== 'all' && activeFolder !== String(folderId)) {
              var wrap = card.closest('.pack-card-real');
              if (wrap) wrap.classList.add('is-filtered-out');
            }
          } catch(_) {}
        }
      } else {
        if (r.status === 404) {
          alert('Error: The move-to-folder endpoint is not available. Please contact support.');
        } else {
          alert('Failed to move pack to folder.');
        }
      }
    }).catch(function(err) {
      console.error('Move fetch error:', err);
      overlay.parentNode.removeChild(overlay);
      alert('Network error while moving pack.');
    });
  }

  fetch('/api/folders', {
    headers: { 'X-CSRFToken': getCSRFToken() }
  }).then(function(r) { return r.json(); })
    .then(function(folders) {
      if (folders.length) {
        folders.forEach(function(folder) {
          var btn = document.createElement('button');
          btn.className = 'dsn-folder-picker__item';
          btn.textContent = folder.name;
          btn.addEventListener('click', function() { moveTo(folder.id); });
          list.appendChild(btn);
        });
      } else {
        var hint = document.createElement('div');
        hint.className = 'dsn-folder-picker__empty';
        hint.textContent = 'No folders yet. Create one from the sidebar.';
        list.appendChild(hint);
      }
    })
    .catch(function() {
      var hint = document.createElement('div');
      hint.className = 'dsn-folder-picker__empty';
      hint.textContent = 'Could not load folders.';
      list.appendChild(hint);
    });

  overlay.querySelector('.dsn-folder-picker__close').addEventListener('click', function() {
    overlay.parentNode.removeChild(overlay);
  });
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) overlay.parentNode.removeChild(overlay);
  });
}

function clonePack(packId, btn) {
  var card = (btn && btn.closest('.pack-card')) ||
    document.querySelector('.pack-card[data-pack-id="' + packId + '"]');
  var menu = card ? card.querySelector('.pack-menu__dropdown') : null;
  if (menu) menu.classList.remove('pack-menu__dropdown--open');
  if (btn) { btn.disabled = true; btn.textContent = 'Adding...'; }
  fetch('/api/packs/' + packId + '/clone', {
    method: 'POST',
    headers: {
      'X-CSRFToken': document.querySelector('meta[name="csrf-token"]').content,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ folder_id: (function () {
      var f = null;
      try { f = sessionStorage.getItem('activeFolder'); } catch (_) {}
      if (f === 'all') f = null;
      return f;
    })() })
  }).then(function(r) {
    if (r.ok) {
      return r.json().then(function(data) {
        if (btn) btn.textContent = 'Added!';
        if (data && data.id) {
          var grid = document.querySelector('.packs-grid, .pack-list, [data-pack-grid]');
          if (grid) {
            var skeleton = document.createElement('div');
            skeleton.className = 'pack-card-wrap';
            skeleton.innerHTML =
              '<div class="pack-card" data-pack-id="' + data.id + '">' +
                '<div class="pack-card__body">' +
                  '<a class="pack-title" href="/library/pack/' + data.id + '/study">' +
                    '<span>' + (data.title || 'New Pack') + '</span>' +
                  '</a>' +
                  '<p class="pack-card__meta">Added to your library</p>' +
                '</div>' +
              '</div>';
            grid.prepend(skeleton);
          }
        }
      });
    } else {
      if (btn) { btn.disabled = false; btn.textContent = 'Add to my library'; }
      alert('Could not add this pack. Please try again.');
    }
  }).catch(function() {
    if (btn) { btn.disabled = false; btn.textContent = 'Add to my library'; }
    alert('Could not add this pack. Please try again.');
  });
}

function resetPack(packId, title, btn) {
  var card = (btn && btn.closest('.pack-card')) ||
    document.querySelector('.pack-card[data-pack-id="' + packId + '"]');
  var menu = card ? card.querySelector('.pack-menu__dropdown') : null;
  if (menu) menu.classList.remove('pack-menu__dropdown--open');
  if (!confirm('Reset all progress for "' + (title || 'this pack') + '"? This cannot be undone.')) return;
  fetch('/api/packs/' + packId + '/reset', {
    method: 'POST',
    headers: { 'X-CSRFToken': getCSRFToken() }
  }).then(function(r) {
    if (r.ok) {
      if (card) {
        var bar = card.querySelector('.pack-mastery-bar, .mastery-bar, [class*="progress"]');
        if (bar) bar.style.width = '0%';
        card.querySelectorAll('.mastery-seg, [class*="mastery-seg"]').forEach(function(seg) {
          seg.style.width = '0%';
        });
        var pct = card.querySelector('.pack-pct, [class*="pct"]');
        if (pct) pct.textContent = '0%';
      }
    } else {
      alert('Failed to reset pack. Please try again.');
    }
  }).catch(function() { alert('Failed to reset pack. Please try again.'); });
}

// Students' own packs are private: their numeric /library/pack/<id> links
// only open for the owner. Ask the server for the link to hand out (it turns
// on "anyone with the link" for your own pack), then show the share options.
function _sharePackId(url) {
  var m = /\/library\/pack\/(\d+)/.exec(url || '') || /[?&]pack_id=(\d+)/.exec(url || '');
  return m ? m[1] : null;
}

function sharePack(title, url, message) {
  var packId = _sharePackId(url);
  var csrf = document.querySelector('meta[name="csrf-token"]');
  var fallback = window.location.origin + url;
  if (!packId || !csrf) { _openPackShare(title, fallback, message); return; }
  fetch('/library/pack/' + packId + '/share-link', {
    method: 'POST',
    headers: { 'X-CSRFToken': csrf.content, 'X-Requested-With': 'XMLHttpRequest' }
  }).then(function(r) { return r.ok ? r.json() : null; })
    .then(function(d) { _openPackShare(title, (d && d.url) || fallback, message); })
    .catch(function() { _openPackShare(title, fallback, message); });
}

function _openPackShare(title, fullUrl, message) {
  var overlay = document.getElementById('shareModalOverlay');
  var linkInput = document.getElementById('shareLinkInput');
  if (overlay && linkInput) {
    var shareMsg = message || "Come study " + title + " on Motown AI — the AI-powered study platform! ";
    linkInput.value = fullUrl;
    linkInput.dataset.fullText = shareMsg + fullUrl;
    var encodedUrl = encodeURIComponent(fullUrl);
    var encodedMsg = encodeURIComponent(shareMsg);
    document.getElementById('shareWA').href = 'https://wa.me/?text=' + encodedMsg + encodedUrl;
    document.getElementById('shareTW').href = 'https://twitter.com/intent/tweet?text=' + encodedMsg + '&url=' + encodedUrl;
    document.getElementById('shareLN').href = 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodedUrl;
    document.getElementById('shareFB').href = 'https://www.facebook.com/sharer/sharer.php?u=' + encodedUrl;
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  } else if (navigator.share) {
    // The link arrives after a request, which can cost the tap's permission
    // to open the share sheet; fall back to a copyable prompt.
    navigator.share({ title: title, url: fullUrl }).catch(function() { prompt('Copy this link:', fullUrl); });
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(fullUrl).then(function() {}).catch(function() { prompt('Copy this link:', fullUrl); });
  } else {
    prompt('Copy this link:', fullUrl);
  }
}

var _packBottomSheetPackId = null;
var _packBottomSheetTitle = null;
var _packBottomSheetUrl = null;
var _packBottomSheetIsOwner = false;

function openPackBottomSheet(packId, title, url, isOwner) {
  _packBottomSheetPackId = packId;
  _packBottomSheetTitle = title;
  _packBottomSheetUrl = url;
  _packBottomSheetIsOwner = isOwner;

  var list = document.getElementById('packBottomSheetItems');
  list.innerHTML = '';

  var isAnonymous = document.documentElement.getAttribute('data-is-authenticated') !== 'true';
  var items = [];
  if (isOwner) {
    items.push({ label: 'Rename', icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>', action: function() { closePackBottomSheet(); openRenameSheet(packId, title); } });
    items.push({ label: 'Add to folder', icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>', action: function() { closePackBottomSheet(); addToFolder(packId, title, null); } });
    items.push({ label: 'Reset progress', icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>', action: function() { closePackBottomSheet(); resetPack(packId, title, null); } });
    items.push({ label: 'Share', icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>', action: function() { closePackBottomSheet(); sharePack(title, url); } });
    items.push({ label: 'Delete', icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>', danger: true, action: function() { closePackBottomSheet(); deletePack(packId, title, null); } });
  } else if (isAnonymous) {
    items.push({ label: 'Sign up to save', icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>', action: function() { closePackBottomSheet(); openAuthModal('signup'); } });
    items.push({ label: 'Share', icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>', action: function() { closePackBottomSheet(); sharePack(title, url); } });
  } else {
    items.push({ label: 'Add to my library', icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>', action: function() { closePackBottomSheet(); clonePack(packId, null); } });
    items.push({ label: 'Share', icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>', action: function() { closePackBottomSheet(); sharePack(title, url); } });
  }

  items.forEach(function(item) {
    var btn = document.createElement('button');
    btn.className = 'pack-menu__item' + (item.danger ? ' pack-menu__item--danger' : '');
    btn.style.cssText = 'font-size:15px;padding:14px 12px;gap:12px;';
    btn.innerHTML = item.icon + '<span>' + item.label + '</span>';
    btn.addEventListener('click', item.action);
    list.appendChild(btn);
  });

  document.getElementById('packBottomSheetOverlay').classList.add('pack-bs-overlay--open');
  document.getElementById('packBottomSheet').classList.add('pack-bs--open');
}

function closePackBottomSheet() {
  var sheet = document.getElementById('packBottomSheet');
  var overlay = document.getElementById('packBottomSheetOverlay');
  if (sheet) sheet.classList.remove('pack-bs--open');
  if (overlay) overlay.classList.remove('pack-bs-overlay--open');
  document.body.style.overflow = '';
}

/* ── Solve pack bottom sheet ── */
function openSolveBottomSheet(packId, title, url) {
  var list = document.getElementById('packBottomSheetItems');
  list.innerHTML = '';

  var card = document.querySelector('[data-pack-id="' + packId + '"]');
  var isOwner = card && card.getAttribute('data-is-owner') === 'true';
  var isAnonymous = document.documentElement.getAttribute('data-is-authenticated') !== 'true';
  var items = [];

  if (isOwner) {
    items.push({ label: 'Rename', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>', action: function() { closePackBottomSheet(); renameSolvePack(packId, title); } });
    items.push({ label: 'Add to folder', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>', action: function() { closePackBottomSheet(); addToFolder(packId, title, null, 'solve'); } });
    items.push({ label: 'Share', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>', action: function() { closePackBottomSheet(); sharePack(title, url); } });
    items.push({ label: 'Delete', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>', danger: true, action: function() { closePackBottomSheet(); deleteSolvePack(packId, title); } });
  } else if (isAnonymous) {
    items.push({ label: 'Sign up to save', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>', action: function() { closePackBottomSheet(); openAuthModal('signup'); } });
    items.push({ label: 'Share', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>', action: function() { closePackBottomSheet(); sharePack(title, url); } });
  } else {
    items.push({ label: 'Share', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>', action: function() { closePackBottomSheet(); sharePack(title, url); } });
  }

  items.forEach(function(item) {
    var btn = document.createElement('button');
    btn.className = 'pack-menu__item' + (item.danger ? ' pack-menu__item--danger' : '');
    btn.style.cssText = 'font-size:15px;padding:14px 12px;gap:12px;';
    btn.innerHTML = item.icon + '<span>' + item.label + '</span>';
    btn.addEventListener('click', item.action);
    list.appendChild(btn);
  });

  document.getElementById('packBottomSheetOverlay').classList.add('pack-bs-overlay--open');
  document.getElementById('packBottomSheet').classList.add('pack-bs--open');
}

// Shown once a quiz/fill-in/flashcard round (the full current set) is
// finished, displaying the total Aura earned across that round instead of
// a per-item floating popup.
window.showRoundSummary = function (rootId, auraTotal, score, onStartOver, onMoreQuestions) {
  var root = document.getElementById(rootId);
  if (!root) { if (onStartOver) onStartOver(); return; }
  var scoreEl = root.querySelector('.fc-round-summary__score-value');
  if (scoreEl && score) {
    var pct = score.total > 0 ? Math.round(score.correct / score.total * 100) : 0;
    scoreEl.textContent = pct + '%';
    scoreEl.setAttribute('data-grade', pct >= 80 ? 'A' : pct >= 70 ? 'B' : pct >= 60 ? 'C' : pct >= 50 ? 'D' : 'F');
    if (pct > 80) window.srFireConfetti();
  }
  var labelEl = root.querySelector('.fc-round-summary__score-label');
  if (labelEl && score) labelEl.textContent = score.correct + '/' + score.total + ' correct';
  var amountEl = root.querySelector('.fc-round-summary__aura-amount');
  if (amountEl) amountEl.textContent = '+' + (auraTotal || 0);
  root._onStartOver = onStartOver;
  root._onMoreQuestions = onMoreQuestions;
  if (!root._backdropWired) {
    root._backdropWired = true;
    root.addEventListener('click', function (e) {
      if (e.target === root) {
        root.style.display = 'none';
      }
    });
    var card = root.querySelector('.fc-round-summary__card');
    if (card) card.addEventListener('click', function (e) { e.stopPropagation(); });
  }
  var startOverBtn = root.querySelector('.fc-round-summary__start-over');
  if (startOverBtn && !startOverBtn._wired) {
    startOverBtn._wired = true;
    startOverBtn.addEventListener('click', function () {
      root.style.display = 'none';
      if (typeof root._onStartOver === 'function') root._onStartOver();
    });
  }
  var moreBtn = root.querySelector('.fc-round-summary__more');
  if (moreBtn && !moreBtn._wired) {
    moreBtn._wired = true;
    moreBtn.addEventListener('click', function () {
      root.style.display = 'none';
      if (typeof root._onMoreQuestions === 'function') root._onMoreQuestions();
    });
  }
  root.style.display = 'flex';
};

/* ── Confetti burst for round summaries at 80%+ ──
   Reuses the app's existing lottie confetti (same animation the guide
   completion screen plays). Non-interactive, self-cleaning, honours
   prefers-reduced-motion. */
window.srFireConfetti = function () {
  if (typeof window.lottie === 'undefined') return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var old = document.getElementById('srRoundConfetti');
  if (old && old.parentNode) old.parentNode.removeChild(old);
  var wrap = document.createElement('div');
  wrap.id = 'srRoundConfetti';
  wrap.setAttribute('aria-hidden', 'true');
  document.body.appendChild(wrap);
  var anim = null;
  try {
    anim = window.lottie.loadAnimation({
      container: wrap,
      renderer: 'svg',
      loop: false,
      autoplay: true,
      rendererSettings: { preserveAspectRatio: 'xMidYMid slice' },
      path: '/static/lottie/confetti.json'
    });
  } catch (e) { anim = null; }
  var cleanup = function () {
    try { if (anim) anim.destroy(); } catch (e) {}
    try { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); } catch (e) {}
  };
  if (anim) {
    anim.addEventListener('complete', cleanup);
    anim.addEventListener('error', cleanup);
  } else {
    setTimeout(cleanup, 100);
  }
};

/* ── Solve pack delete (global, shared by dashboard + discover) ── */
window.deleteSolvePack = function (id, title) {
  var list = document.getElementById('packBottomSheetItems');
  if (!list) return;
  list.innerHTML = '';

  var wrap = document.createElement('div');
  wrap.style.cssText = 'padding:4px 4px 8px;';

  var icon = document.createElement('div');
  icon.style.cssText = 'width:44px;height:44px;border-radius:12px;background:rgba(239,68,68,0.12);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;';
  icon.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>';

  var heading = document.createElement('div');
  heading.style.cssText = 'font-size:16px;font-weight:600;color:var(--text-primary);text-align:center;margin-bottom:6px;';
  heading.textContent = 'Delete quiz?';

  var desc = document.createElement('div');
  desc.style.cssText = 'font-size:14px;color:var(--text-secondary);text-align:center;margin-bottom:20px;line-height:1.4;';
  desc.textContent = '"' + (title || 'This quiz') + '" will be permanently deleted. This cannot be undone.';

  var btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;';

  var cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = 'flex:1;padding:10px;border-radius:10px;font-size:14px;font-weight:600;background:var(--bg-hover);color:var(--text-primary);border:1px solid var(--border);cursor:pointer;';

  var deleteBtn = document.createElement('button');
  deleteBtn.textContent = 'Delete';
  deleteBtn.style.cssText = 'flex:1;padding:10px;border-radius:10px;font-size:14px;font-weight:600;background:#ef4444;color:#fff;border:none;cursor:pointer;';

  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(deleteBtn);
  wrap.appendChild(icon);
  wrap.appendChild(heading);
  wrap.appendChild(desc);
  wrap.appendChild(btnRow);
  list.appendChild(wrap);

  cancelBtn.addEventListener('click', function() { closePackBottomSheet(); });
  deleteBtn.addEventListener('click', function() {
    closePackBottomSheet();
    _doDeleteSolvePack(id);
  });

  document.getElementById('packBottomSheetOverlay').classList.add('pack-bs-overlay--open');
  document.getElementById('packBottomSheet').classList.add('pack-bs--open');
  document.body.style.overflow = 'hidden';
};

function _doDeleteSolvePack(id) {
  var csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
  fetch('/api/solve/packs/' + id, { method: 'DELETE', headers: { 'X-CSRFToken': csrf } })
    .then(function (r) {
      if (!r.ok) return r.json().then(function (d) { throw new Error(d.error || 'Delete failed'); }).catch(function (e) { if (e.message !== 'Delete failed') throw e; throw new Error('Delete failed'); });
      return r.json();
    })
    .then(function () {
      document.querySelectorAll('[data-pack-id="' + id + '"]').forEach(function (el) {
        var w = el.closest('.pack-card-real') || el;
        w.style.transition = 'opacity 0.2s, transform 0.2s';
        w.style.opacity = '0';
        w.style.transform = 'scale(0.95)';
        setTimeout(function () { w.remove(); }, 200);
      });
    })
    .catch(function (e) { showToast(e.message || 'Could not delete quiz.'); });
}

/* ── Solve pack rename (inline, like renamePack) ── */
window.renameSolvePack = function (packId, currentName) {
  var card = document.querySelector('[data-pack-id="' + packId + '"]');
  if (!card) return;
  var link = card.querySelector('.pack-title a');
  var mobileName = card.querySelector('.pack-mobile__name');
  if (card.querySelector('.pack-rename-input')) return;

    var isListView = !!card.closest('#packGrid, #quizGrid, #anonPackGrid');
  var targetEl = isListView ? mobileName : link;
  if (!targetEl) return;

  targetEl.style.display = 'none';
  var input = document.createElement('input');
  input.className = 'pack-rename-input';
  input.type = 'text';
  input.value = currentName;
  targetEl.parentNode.insertBefore(input, targetEl.nextSibling);
  input.focus();
  input.select();

  function cleanup() {
    targetEl.style.display = '';
    if (input.parentNode) input.parentNode.removeChild(input);
  }

  function save() {
    var val = input.value.trim();
    if (!val || val === currentName) { cleanup(); return; }
    fetch('/api/solve/packs/' + packId + '/rename', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': document.querySelector('meta[name="csrf-token"]').content },
      body: JSON.stringify({ name: val })
    }).then(function(r) {
      if (r.ok) {
        if (link) link.textContent = val;
        if (mobileName) mobileName.textContent = val;
        cleanup();
      } else {
        r.json().then(function(data) { showToast(data.error || 'Failed to rename pack.'); }).catch(function() { showToast('Failed to rename pack.'); });
        cleanup();
      }
    }).catch(function() { cleanup(); });
  }

  input.addEventListener('keydown', function(e) {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); save(); }
    else if (e.key === 'Escape') { e.preventDefault(); cleanup(); }
  });
  input.addEventListener('blur', function() { save(); });
  input.addEventListener('click', function(e) { e.stopPropagation(); });
};

/* ── bfcache: force fresh render, strip auth-trigger params first ── */
window.addEventListener('pageshow', function(e) {
  if (!e.persisted) return;
  var p = new URL(location.href);
  var changed = false;
  if (p.searchParams.has('login')) { p.searchParams.delete('login'); changed = true; }
  if (p.searchParams.has('signup')) { p.searchParams.delete('signup'); changed = true; }
  if (changed) { history.replaceState(null, '', p.toString()); }
  location.reload();
});