// --- Auto-advance steps for normal generation ---
function npAdvanceToStep(step) {
    // Hide all panels
    var panels = ['step1Panel', 'step2Panel', 'step3Panel'];
    panels.forEach(function (id, idx) {
        var el = document.getElementById(id);
        if (el) el.style.display = (idx + 1 === step) ? '' : 'none';
    });
    // Update step pills
    for (var i = 1; i <= 3; i++) {
        var pill = document.getElementById('stepPill' + i);
        if (pill) {
            pill.classList.remove('step-active', 'step-waiting');
            if (i < step) pill.classList.add('step-waiting');
            else if (i === step) pill.classList.add('step-active');
            else pill.classList.add('step-waiting');
        }
    }
}

// Hook file upload to auto-advance
document.addEventListener('motown:page-ready', function reinitCreatePage() {
    var fileInput = document.getElementById('npFileInput');
    if (fileInput && !fileInput._npBound) {
        fileInput._npBound = true;
        fileInput.addEventListener('change', function (e) {
            if (fileInput.files && fileInput.files.length > 0) {
                npAdvanceToStep(2);
                var genBtn = document.getElementById('generateBtn');
                if (genBtn) setTimeout(function () { genBtn.click(); }, 400);
            }
        });
    }
    var desc = document.getElementById('npTextarea');
    if (desc && !desc._npBound) {
        desc._npBound = true;
        desc.addEventListener('input', function () {
            if (desc.value && desc.value.length > 30) {
                npAdvanceToStep(2);
            }
        });
    }
    var topic = document.getElementById('npTopicInput');
    if (topic && !topic._npBound) {
        topic._npBound = true;
        topic.addEventListener('input', function () {
            if (topic.value && topic.value.length > 10) {
                npAdvanceToStep(2);
            }
        });
    }
});

// After generation, auto-advance to preview (step 3)
// You should call this after generation completes in your generation logic:
window.npShowPreview = function () {
    npAdvanceToStep(3);
};
// Show the AI fail modal
function showAiFailModal(defaultQuery) {
    const modal = document.getElementById('aiFailModal');
    const input = document.getElementById('librarySearchInput');
    if (modal) {
        modal.style.display = 'flex';
        if (input) {
            input.value = defaultQuery || '';
            input.focus();
        }
    }
}

function closeAiFailModal() {
    const modal = document.getElementById('aiFailModal');
    if (modal) modal.style.display = 'none';
}

function handleLibrarySearch(e) {
    e.preventDefault();
    const input = document.getElementById('librarySearchInput');
    if (input && input.value.trim()) {
        // Redirect to library search page with query
        window.location.href = '/library?search=' + encodeURIComponent(input.value.trim());
    }
    return false;
}
/**
 * EduShare - Main JavaScript
 * Handles interactions and dynamic behaviors
 */

// Toggle post options menu
function toggleOptions(postId) {
    const menu = document.getElementById(`options-${postId}`);
    if (menu) {
        menu.classList.toggle('active');
    }

    // Close menu when clicking outside
    document.addEventListener('click', function closeMenu(e) {
        if (!e.target.closest('.post-options')) {
            menu.classList.remove('active');
            document.removeEventListener('click', closeMenu);
        }
    });
}

// Auto-hide flash messages handled by render_flashes in _macros.html

// Auto-trigger generation if from video
document.addEventListener('motown:page-ready', function () {
    if (window.MOTOWN_FROM_VIDEO && window.MOTOWN_VIDEO_CONTEXT && !window._motownAutoGenFired) {
        window._motownAutoGenFired = true;
        try {
            var step1 = document.getElementById('step1Panel');
            if (step1) step1.style.display = 'none';
            var pill1 = document.getElementById('stepPill1');
            if (pill1) pill1.classList.add('step-waiting');
            document.getElementById('step2Panel').style.display = '';
            var pill2 = document.getElementById('stepPill2');
            if (pill2) {
                pill2.classList.remove('step-waiting');
                pill2.classList.add('step-active');
            }
            if (window.MOTOWN_VIDEO_CONTEXT.transcript) {
                var desc = document.getElementById('npTextarea');
                if (desc) desc.value = window.MOTOWN_VIDEO_CONTEXT.transcript;
            }
            if (typeof startAnalysis === 'function') {
                setTimeout(function () { startAnalysis(); }, 400);
            } else {
                var genBtn = document.getElementById('generateBtn');
                if (genBtn) genBtn.click();
            }
        } catch (e) {
            console.warn('Auto-generation from video context failed:', e);
        }
    }
});

// Form validation helper
function validateForm(formId) {
    const form = document.getElementById(formId);
    if (!form) return true;

    const inputs = form.querySelectorAll('input[required], textarea[required]');
    let isValid = true;

    inputs.forEach(function (input) {
        if (!input.value.trim()) {
            isValid = false;
            input.classList.add('error-border');
        } else {
            input.classList.remove('error-border');
        }
    });

    return isValid;
}

// Image preview before upload
function previewImage(input, previewId) {
    if (input.files && input.files[0]) {
        const reader = new FileReader();

        reader.onload = function (e) {
            const preview = document.getElementById(previewId);
            if (preview) {
                preview.src = e.target.result;
            }
        };

        reader.readAsDataURL(input.files[0]);
    }
}

// Smooth scroll to top
function scrollToTop() {
    window.scrollTo({
        top: 0,
        behavior: 'smooth'
    });
}

// Show scroll to top button when scrolling down
window.addEventListener('scroll', function () {
    const scrollBtn = document.getElementById('scroll-top-btn');
    if (scrollBtn) {
        if (window.pageYOffset > 300) {
            scrollBtn.style.display = 'block';
        } else {
            scrollBtn.style.display = 'none';
        }
    }
});

// Character counter for textareas
document.querySelectorAll('textarea[maxlength]').forEach(function (textarea) {
    const maxLength = textarea.getAttribute('maxlength');
    const counter = document.createElement('small');
    counter.className = 'form-hint';
    counter.textContent = `0/${maxLength} characters`;

    textarea.addEventListener('input', function () {
        const length = this.value.length;
        counter.textContent = `${length}/${maxLength} characters`;
    });

    textarea.parentNode.appendChild(counter);
});

// Lazy loading for images
if ('IntersectionObserver' in window) {
    const imageObserver = new IntersectionObserver(function (entries, observer) {
        entries.forEach(function (entry) {
            if (entry.isIntersecting) {
                const img = entry.target;
                img.src = img.dataset.src;
                img.classList.remove('lazy');
                imageObserver.unobserve(img);
            }
        });
    });

    document.querySelectorAll('img.lazy').forEach(function (img) {
        imageObserver.observe(img);
    });
}

// Toggle mobile search
function toggleMobileSearch() {
    const searchContainer = document.querySelector('.search-container');
    if (searchContainer) {
        searchContainer.classList.toggle('mobile-active');
    }
}

// Handle network errors gracefully
window.addEventListener('online', function () {
    console.log('Connection restored');
    // You could show a notification here
});

window.addEventListener('offline', function () {
    console.log('Connection lost');
    // You could show a warning here
});

// Re-bind on every page load / HTMX navigation
document.addEventListener('motown:page-ready', function () {
    // Confirmation for delete actions
    document.querySelectorAll('form[data-confirm]').forEach(function (form) {
        if (form._confirmBound) return;
        form._confirmBound = true;
        form.addEventListener('submit', function (e) {
            const message = this.dataset.confirm || 'Are you sure?';
            if (!confirm(message)) {
                e.preventDefault();
            }
        });
    });

    // Auto-resize textareas
    document.querySelectorAll('textarea.auto-resize').forEach(function (textarea) {
        if (textarea._resizeBound) return;
        textarea._resizeBound = true;
        textarea.addEventListener('input', function () {
            this.style.height = 'auto';
            this.style.height = (this.scrollHeight) + 'px';
        });
    });

    // Prevent double-submit on forms
    document.querySelectorAll('form').forEach(function (form) {
        if (form._submitGuard) return;
        form._submitGuard = true;
        form.addEventListener('submit', function () {
            const submitBtn = this.querySelector('button[type="submit"]');
            if (!submitBtn || submitBtn.hasAttribute('data-no-spinner')) return;
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="ti ti-loader ti-spin"></i>';

            // Re-enable after 3 seconds in case of error
            var originalText = submitBtn.dataset.originalText || 'Submit';
            setTimeout(function () {
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalText;
            }, 3000);
        });
    });
});
