function initPageReveal() {
    document.body.style.opacity = '1';
}
initPageReveal();


    
/* ── DARK MODE ── */

/* The RESOLVED theme on <html> is the single source of truth. Reading
   localStorage directly is wrong when the preference is "system" (it holds
   "system", not "light"/"dark"), and its fallback contradicted the app's
   dark-by-default. */
function currentTheme() {
    return document.documentElement.getAttribute('data-theme')
        || localStorage.getItem('motown-theme-mode')
        || 'dark';
}

function updateDarkToggleUI(theme) {
    const isDark = (theme || currentTheme()) === 'dark';
    const icon   = document.getElementById('darkToggleIcon');
    if (icon)  icon.className  = isDark ? 'ti ti-sun toggle-icon' : 'ti ti-moon toggle-icon';
    const mIcon  = document.getElementById('darkToggleIconMobile');
    const mPill  = document.getElementById('darkTogglePill');
    const mLabel = document.getElementById('darkToggleLabelMobile');
    if (mIcon)  mIcon.className   = isDark ? 'ti ti-sun' : 'ti ti-moon';
    // The label names the theme you are IN; the pill names the one you'd switch TO.
    if (mLabel) mLabel.textContent = isDark ? 'Dark mode' : 'Light mode';
    // Show the theme that will be activated when clicked
    if (mPill)  mPill.textContent  = isDark ? 'Light' : 'Dark';

    const sIcon  = document.getElementById('darkToggleIconSidebar');
    const sPill  = document.getElementById('darkTogglePillSidebar');
    const sLabel = document.getElementById('darkToggleLabelSidebar');
    if (sIcon)  sIcon.className   = isDark ? 'ti ti-sun' : 'ti ti-moon';
    if (sPill)  sPill.textContent  = isDark ? 'Light' : 'Dark';
    if (sLabel) sLabel.textContent = isDark ? 'Dark mode' : 'Light mode';
}

function toggleDarkMode() {
    const isDark = currentTheme() === 'dark';
    const next   = isDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('motown-theme-mode', next);
    updateDarkToggleUI(next);
}

/* ── SUGGESTIONS ── */
function closeSuggestions() {
    const el = document.getElementById('suggestionOverlay');
    if (el) el.style.display = 'none';
}
function switchSugTab(tab, btn) {
    document.querySelectorAll('.sug-list').forEach(function(el) { el.classList.add('hidden'); });
    document.querySelectorAll('.ob-tab').forEach(function(el) { el.classList.remove('active'); });
    document.getElementById('sug-' + tab).classList.remove('hidden');
    btn.classList.add('active');
}

/* ── PROFILE DROPDOWN (desktop only) ── */
function initProfileDropdown() {
    const trigger  = document.getElementById('profileTrigger');
    const dropdown = document.getElementById('profileDropdown');
    if (!trigger || !dropdown) return;

    if (trigger._profileDropdownBound) return;
    trigger._profileDropdownBound = true;

    trigger.addEventListener('click', function(e) {
        e.stopPropagation();
        const open = dropdown.classList.toggle('open');
        trigger.setAttribute('aria-expanded', String(open));
    });

    document.addEventListener('click', function() {
        if (dropdown.classList.contains('open')) {
            dropdown.classList.remove('open');
            trigger.setAttribute('aria-expanded', 'false');
        }
    });

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && dropdown.classList.contains('open')) {
            dropdown.classList.remove('open');
            trigger.setAttribute('aria-expanded', 'false');
        }
    });
}
initProfileDropdown();
document.addEventListener('motown:page-ready', function () {
    initPageReveal();
    initProfileDropdown();
    initScrollShadow();
    initNotifications();
});

/* ── SCROLL SHADOW ── */
function initScrollShadow() {
    const nav = document.getElementById('topNav');
    if (nav) {
        if (nav._scrollBound) return;
        nav._scrollBound = true;
        window.addEventListener('scroll', function() {
            nav.classList.toggle('scrolled', window.scrollY > 8);
        }, { passive: true });
    }
}
initScrollShadow();

/* ── AUTOCOMPLETE (onboarding) ── */
function setupObDropdown(searchId, dropdownId, valueId, items) {
    const search   = document.getElementById(searchId);
    const dropdown = document.getElementById(dropdownId);
    const value    = document.getElementById(valueId);
    if (!search) return;

    search.addEventListener('input', function() {
        const q = this.value.toLowerCase();
        if (!this.value.trim()) {
            value.value = '';
            dropdown.classList.remove('open');
            dropdown.innerHTML = '';
            return;
        }
        value.value = this.value;
        const filtered = items.filter(function(i) { return i.toLowerCase().includes(q); });
        dropdown.innerHTML = '';
        if (filtered.length) {
            filtered.forEach(function(item) {
                const div = document.createElement('div');
                div.className = 'ob-dropdown-item';
                div.textContent = item;
                div.addEventListener('click', function() {
                    search.value = item;
                    value.value  = item;
                    dropdown.classList.remove('open');
                    dropdown.innerHTML = '';
});


                dropdown.appendChild(div);
            });
            dropdown.classList.add('open');
        } else {
            dropdown.classList.remove('open');
        }
    });

    document.addEventListener('click', function(e) {
        if (!e.target.closest('#' + searchId) && !e.target.closest('#' + dropdownId))
            dropdown.classList.remove('open');
    });
}

updateDarkToggleUI(localStorage.getItem('motown-theme-mode') || 'light');

var GHANA_UNIVERSITIES = [
    "University of Ghana","KNUST","University of Cape Coast",
    "University for Development Studies","GIMPA","Ashesi University",
    "Central University","Valley View University","Methodist University Ghana",
    "UPSA","GCTU","Accra Technical University","Ho Technical University",
    "Kumasi Technical University","Takoradi Technical University",
    "Koforidua Technical University","Sunyani Technical University",
    "Cape Coast Technical University","Wa Technical University",
    "Bolgatanga Technical University","University of Health and Allied Sciences",
    "Ghana Institute of Journalism","NAFTI","Regent University College",
    "C.K. Tedam University","SD Dombo University","Other"
];
var GHANA_PROGRAMMES = [
    "BSc Computer Science","BSc Information Technology","BSc Computer Engineering",
    "BSc Electrical Engineering","BSc Mechanical Engineering","BSc Civil Engineering",
    "BSc Chemical Engineering","BA Economics","BSc Business Administration",
    "Bsc Packaging Technology",
    "BSc Accounting","BSc Marketing","BA English","BA History",
    "BSc Mathematics","BSc Statistics","BSc Physics","BSc Chemistry",
    "BSc Biology","BSc Biochemistry","BSc Nursing","BSc Pharmacy",
    "MBChB Medicine and Surgery","LLB Law","BSc Agriculture",
    "BSc Education","BA Communication Studies","BSc Psychology",
    "BSc Sociology","BSc Political Science","BSc Architecture",
    "BSc Quantity Surveying","BSc Land Economy","MBA",
    "MSc Computer Science","MSc Engineering","Other"
];

setupObDropdown('ob-school-search',    'ob-school-dropdown',    'ob-school-value',    GHANA_UNIVERSITIES);
setupObDropdown('ob-programme-search', 'ob-programme-dropdown', 'ob-programme-value', GHANA_PROGRAMMES);
(function () {
    const trigger = document.getElementById('mobileDrawerTrigger');
    const drawer   = document.getElementById('mobileDrawer');
    const drawerOverlay = document.getElementById('mobileDrawerOverlay');
    if (!trigger || !drawer) return;

    function openDrawer() {
        drawer.classList.add('open');
        drawerOverlay.classList.add('open');
        trigger.setAttribute('aria-expanded', 'true');
        document.body.style.overflow = 'hidden';
    }
    function closeDrawer() {
        drawer.classList.remove('open');
        drawerOverlay.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
    }
    if (!window.closeMobileDrawer) window.closeMobileDrawer = closeDrawer;

    trigger.addEventListener('click', function(e) {
        e.stopPropagation();
        drawer.classList.contains('open') ? closeDrawer() : openDrawer();
    });
    drawer.querySelectorAll('a').forEach(function(a) {
        a.addEventListener('click', closeDrawer);
    });
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') closeDrawer();
    });
})();
/* ── NEW FOLDER SHEET (mobile) ── */
(function () {
    const overlay = document.getElementById('newFolderOverlay');
    const sheet   = document.getElementById('newFolderSheet');
    const input   = document.getElementById('newFolderNameInput');
    const error   = document.getElementById('newFolderError');
    const createBtn = document.getElementById('newFolderCreateBtn');
    if (!overlay || !sheet) return;

    function debounce(fn, ms) {
        let timer;
        return function () {
            clearTimeout(timer);
            timer = setTimeout(fn, ms);
        };
    }

    function open() {
        sheet.classList.add('open');
        overlay.classList.add('open');
        document.body.style.overflow = 'hidden';
        if (input) {
            input.value = '';
            input.classList.remove('shake');
            if (error) error.textContent = '';
            if (createBtn) createBtn.disabled = false;
            debounce(function () { input.focus(); }, 350)();
        }
    }
    window.openNewFolderSheet = open;

    function close() {
        sheet.classList.remove('open');
        overlay.classList.remove('open');
        document.body.style.overflow = '';
        if (input) {
            input.value = '';
            input.classList.remove('shake');
            if (error) error.textContent = '';
            if (createBtn) createBtn.disabled = false;
        }
    }
    window.closeNewFolderSheet = close;

    function submit() {
        if (!input || !error || !createBtn) return;
        const name = input.value.trim();
        if (!name) {
            input.classList.add('shake');
            error.textContent = 'Please enter a folder name';
            input.focus();
            return;
        }
        if (name.length > 40) {
            input.classList.add('shake');
            error.textContent = 'Folder name must be 40 characters or fewer';
            input.focus();
            return;
        }
        createBtn.disabled = true;
        error.textContent = '';

        if (typeof postCreateFolder !== 'function') {
            window.location.reload();
            return;
        }

        postCreateFolder(name)
        .then(function (data) {
            if (!data.id) {
                error.textContent = data.error || 'Failed to create folder';
                input.classList.add('shake');
                createBtn.disabled = false;
                input.focus();
                return;
            }
            close();
            if (typeof syncFolderCreate === 'function') {
                syncFolderCreate(data);
            }
        })
        .catch(function () {
            error.textContent = 'Network error. Please try again.';
            createBtn.disabled = false;
            input.focus();
        });
    }
    window.submitNewFolder = submit;

    if (input) {
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                submit();
            }
            if (e.key === 'Escape') close();
        });
        input.addEventListener('input', function () {
            input.classList.remove('shake');
            error.textContent = '';
        });
    }
})();
/* ── SETTINGS MODAL ── */
if (typeof window.openSettingsModal !== 'function') {
  window.openSettingsModal = function(tab = null) {
    const modal = document.getElementById('settingsModal');
    if (!modal) return;
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  };
}

if (typeof window.closeSettingsModal !== 'function') {
  window.closeSettingsModal = function() {
    const modal = document.getElementById('settingsModal');
    if (!modal) return;
    modal.style.display = 'none';
    document.body.style.overflow = '';
  };
}



function initNotifications() {
  if (window._notifsInitialized) return;
  window._notifsInitialized = true;

  // Collect desktop + mobile bell elements (mobile bell may not exist if logged out)
  const bells = [
    {
      toggle:   document.getElementById('notifToggle'),
      dropdown: document.getElementById('notifDropdown'),
      badge:    document.getElementById('notifBadge'),
      list:     document.getElementById('notifList'),
      markBtn:  document.getElementById('notifMarkRead'),
    },
    {
      toggle:   document.getElementById('notifToggleMobile'),
      dropdown: document.getElementById('notifDropdownMobile'),
      badge:    document.getElementById('notifBadgeMobile'),
      list:     document.getElementById('notifListMobile'),
      markBtn:  document.getElementById('notifMarkReadMobile'),
    },
  ].filter(b => b.toggle); // only keep entries where the element exists

  if (!bells.length) return;

  const ICONS = {
    like:          'fa-heart',
    comment:       'fa-comment',
    follow:        'fa-user-plus',
    post_approved: 'fa-check-circle',
    post_rejected: 'fa-times-circle',
  };

  function timeAgo(iso) {
    const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
    if (diff < 60)    return 'just now';
    if (diff < 3600)  return Math.floor(diff / 60)   + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600)  + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  }

  function notifHTML(notifs) {
    if (!notifs.length) {
      return '<div class="notif-empty"><i class="fas fa-bell-slash" style="font-size:1.5rem;margin-bottom:.5rem;display:block;"></i>No notifications yet</div>';
    }
    return notifs.map(n => `
      <a class="notif-item ${n.is_read ? '' : 'unread'}" href="${n.link || '#'}" data-id="${n.id}">
        <div class="notif-icon ${n.type || 'default'}">
          <i class="fas ${ICONS[n.type] || 'fa-bell'}"></i>
        </div>
        <div>
          <div class="notif-text">${n.message}</div>
          <div class="notif-time">${timeAgo(n.created_at)}</div>
        </div>
      </a>`).join('');
  }

  function updateBadge(count) {
    const label = count > 99 ? '99+' : String(count);
    const bottomBadge = document.getElementById('bottomNavBadge');
    bells.forEach(b => {
      if (!b.badge) return;
      if (count > 0) { b.badge.textContent = label; b.badge.classList.add('visible'); }
      else           { b.badge.classList.remove('visible'); }
    });
    if (bottomBadge) {
      if (count > 0) { bottomBadge.textContent = label; bottomBadge.classList.add('visible'); }
      else           { bottomBadge.classList.remove('visible'); }
    }
  }

  function closeAll(except) {
    bells.forEach(b => {
      if (b.dropdown === except) return;
      b.dropdown.classList.remove('open');
      if (b.toggle) b.toggle.setAttribute('aria-expanded', 'false');
    });
  }

  async function loadNotifs(listEl) {
    try {
      const r    = await fetch('/notifications');
      const data = await r.json();
      const html = notifHTML(data);
      // Render into all open lists simultaneously so both stay in sync
      bells.forEach(b => { if (b.list) b.list.innerHTML = html; });
      updateBadge(data.filter(n => !n.is_read).length);
    } catch(e) {
      if (listEl) listEl.innerHTML = '<div class="notif-empty">Could not load notifications.</div>';
    }
  }

  async function pollUnread() {
    try {
      const r    = await fetch('/notifications/unread-count');
      const data = await r.json();
      updateBadge(data.count);
    } catch(e) {}
  }

  // Wire each bell toggle
  bells.forEach(b => {
    b.toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      closeAll(b.dropdown);
      const isOpen = b.dropdown.classList.toggle('open');
      b.toggle.setAttribute('aria-expanded', String(isOpen));
      if (isOpen) loadNotifs(b.list);
    });

    if (b.markBtn) {
      b.markBtn.addEventListener('click', async function (e) {
        e.stopPropagation();
        await fetch('/notifications/mark-read', {
          method: 'POST',
          headers: { 'X-CSRFToken': document.querySelector('meta[name="csrf-token"]')?.content || '' }
        });
        updateBadge(0);
        bells.forEach(bell => {
          if (bell.list) bell.list.querySelectorAll('.notif-item.unread').forEach(el => el.classList.remove('unread'));
        });
      });
    }
  });

  // Bottom nav bell — opens the desktop dropdown repositioned above the bottom bar
  const bottomBell = document.getElementById('bottomNavNotif');
  if (bottomBell && bells[0]) {
    bottomBell.addEventListener('click', function (e) {
      e.stopPropagation();
      closeAll(bells[0].dropdown);
      const isOpen = bells[0].dropdown.classList.toggle('open');
      bells[0].toggle.setAttribute('aria-expanded', String(isOpen));
      if (isOpen) {
        loadNotifs(bells[0].list);
        bells[0].dropdown.style.cssText += ';bottom:4.5rem;top:auto;right:0.5rem;left:auto;';
      }
    });
  }

  // Close on outside click
  document.addEventListener('click', function (e) {
    bells.forEach(b => {
      if (!b.dropdown.contains(e.target) && e.target !== b.toggle) {
        b.dropdown.classList.remove('open');
        if (b.toggle) b.toggle.setAttribute('aria-expanded', 'false');
      }
    });
  });

  pollUnread();
  setInterval(pollUnread, 60000);
}
initNotifications();