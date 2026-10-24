(function () {
  var overlay = document.getElementById('feedbackOverlay');
  if (!overlay) return;

  var form = document.getElementById('feedbackForm');
  var stars = document.querySelectorAll('#fbStars .fb-star');
  var label = document.getElementById('fbRatingLabel');
  var comment = document.getElementById('fbComment');
  var charCount = document.getElementById('fbCharCount');
  var shareGroup = document.getElementById('fbShareGroup');
  var consentCheck = document.getElementById('fbConsent');
  var skipBtn = document.getElementById('fbSkipBtn');
  var submitBtn = document.getElementById('fbSubmitBtn');
  var backdrop = document.getElementById('feedbackBackdrop');

  var selectedRating = 0;
  var RATING_LABELS = ['', 'Poor', 'Not great', 'It\'s okay', 'Great', 'Loved it'];
  var csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';

  function highlightStars(val) {
    stars.forEach(function (s) {
      var starVal = parseInt(s.getAttribute('data-val'), 10);
      if (starVal <= val) {
        s.classList.add('is-selected');
        s.setAttribute('aria-checked', 'true');
      } else {
        s.classList.remove('is-selected');
        s.setAttribute('aria-checked', 'false');
      }
    });
  }

  function updateSubmitState() {
    submitBtn.disabled = selectedRating === 0;
  }

  function updateShareGroup() {
    if (selectedRating >= 4) {
      shareGroup.hidden = false;
    } else {
      shareGroup.hidden = true;
      consentCheck.checked = false;
    }
  }

  function open() {
    var gate = window.MotownPopup;
    if (gate && !gate.open('feedback')) return; // another popup has the slot
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    stars[0].focus();
  }

  function close() {
    overlay.classList.remove('active');
    document.body.style.overflow = '';
    var gate = window.MotownPopup;
    if (gate) gate.close('feedback');
  }

  function submit(rating, commentText) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending\u2026';

    var payload = {
      rating: rating,
      comment: commentText,
      context: 'dashboard',
    };
    if (rating >= 4) {
      payload.consent = consentCheck.checked;
    }

    fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
      body: JSON.stringify(payload),
    })
    .then(function (r) { return r.json(); })
    .then(function () {
      form.innerHTML = '<div class="fb-success"><p class="fb-success-title">Thank you!</p><p class="fb-success-sub">Your feedback helps us make Motown AI better for everyone.</p></div>';
      setTimeout(close, 2200);
    })
    .catch(function () {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send feedback';
    });
  }

  // Star interaction
  stars.forEach(function (s) {
    s.addEventListener('click', function () {
      selectedRating = parseInt(s.getAttribute('data-val'), 10);
      highlightStars(selectedRating);
      label.textContent = RATING_LABELS[selectedRating];
      updateSubmitState();
      updateShareGroup();
    });

    s.addEventListener('mouseenter', function () {
      if (selectedRating > 0) return;
      var val = parseInt(s.getAttribute('data-val'), 10);
      highlightStars(val);
      label.textContent = RATING_LABELS[val];
    });

    s.addEventListener('mouseleave', function () {
      if (selectedRating > 0) return;
      highlightStars(0);
      label.textContent = '';
    });

    s.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        s.click();
      }
    });
  });

  // Character counter
  comment.addEventListener('input', function () {
    charCount.textContent = comment.value.length + ' / 1000';
  });

  // Submit
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (selectedRating === 0) return;
    submit(selectedRating, comment.value.trim());
  });

  // Skip
  skipBtn.addEventListener('click', function () {
    fetch('/api/feedback/dismiss', {
      method: 'POST',
      headers: { 'X-CSRFToken': csrf },
    }).catch(function () {});
    close();
  });

  // Close on backdrop click
  backdrop.addEventListener('click', function () {
    skipBtn.click();
  });

  // Close on Escape
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && overlay.classList.contains('active')) {
      skipBtn.click();
    }
  });

  // Expose open for external triggers
  window.openFeedbackModal = open;

  // Auto-open on load — only after the conversational onboarding is dismissed
  // (onboarding completion navigates away and the prompt re-evaluates on the
  // next landing). Serialized through the popup gate so it never overlaps
  // another auto-open surface.
  if (!window.MOTOWN_ONBOARDING_PENDING) {
    var gate = window.MotownPopup;
    if (gate) gate.whenClear('feedback', open, 60000);
    else open();
  }
})();
