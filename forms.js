// Shared handler for every email-capture form on the site (Wait List,
// Membership, toolbox optional signup, About). One endpoint, one pattern.
//
// Usage: <form class="js-subscribe-form" data-list="waitlist|membership" data-source="waitlist-index">
//   - needs an <input type="email" name="email">
//   - optional <select name="reason"> ("what brought you here")
//   - needs a honeypot <input type="text" name="website" class="hp-field" tabindex="-1" autocomplete="off">
//   - add data-optional="true" if submitting with a blank email should just no-op (e.g. toolbox download)

(function () {
  function attach(form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      submitForm(form);
    });
  }

  function submitForm(form) {
    var list = form.dataset.list;
    var source = form.dataset.source || list;
    var emailInput = form.querySelector('input[type="email"]');
    var reasonInput = form.querySelector('select[name="reason"]');
    var honeypot = form.querySelector('input[name="website"]');
    var email = emailInput ? emailInput.value.trim() : '';
    var optional = form.dataset.optional === 'true';

    clearError(form);

    if (!email) {
      if (optional) return;
      showError(form, 'Enter your email.');
      if (emailInput) emailInput.focus();
      return;
    }

    var btn = form.querySelector('button[type="submit"]');
    var originalText = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Submitting…';
    }

    fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: email,
        list: list,
        source: source,
        reason: reasonInput ? reasonInput.value : undefined,
        website: honeypot ? honeypot.value : '',
      }),
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok || !data || !data.ok) {
            throw new Error((data && data.error) || 'Something went wrong.');
          }
          return data;
        });
      })
      .then(function () {
        showSuccess(form);
      })
      .catch(function () {
        if (btn) {
          btn.disabled = false;
          btn.textContent = originalText;
        }
        showError(form, "Something went wrong. Please try again.");
      });
  }

  function showSuccess(form) {
    var msg = form.dataset.successMessage || "You're on the list — check your inbox for a confirmation.";
    form.innerHTML = '<p class="form-success-msg">' + msg + '</p>';
  }

  function showError(form, msg) {
    clearError(form);
    var p = document.createElement('p');
    p.className = 'form-error-msg';
    p.textContent = msg;
    form.appendChild(p);
  }

  function clearError(form) {
    var existing = form.querySelector('.form-error-msg');
    if (existing) existing.remove();
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.js-subscribe-form').forEach(attach);
  });
})();
