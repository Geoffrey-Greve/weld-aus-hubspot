/**
 * subscription-form.module/module.js
 *
 * Wires the compact events-updates email card to the HubSpot Forms API.
 * Full HubSpot embeds (non-events) are initialised inline in module.html.
 */
(function () {
  'use strict';

  function closestForm(el) {
    return el && el.closest ? el.closest('form.wa-subscription-form__fallback') : null;
  }

  function setBusy(form, busy) {
    var btn = form.querySelector('[type="submit"]');
    var label = form.querySelector('.wa-subscription-form__fallback-button-label');
    if (btn) btn.disabled = !!busy;
    if (label) {
      if (busy) {
        if (!label.dataset.orig) label.dataset.orig = label.textContent;
        label.textContent = 'Subscribing…';
      } else if (label.dataset.orig) {
        label.textContent = label.dataset.orig;
      }
    }
  }

  function showState(form, state, message) {
    var note = form.querySelector('[data-role="note"]');
    var error = form.querySelector('[data-role="error"]');
    var success = form.querySelector('[data-role="success"]');
    var row = form.querySelector('.wa-subscription-form__fallback-row');

    if (note) note.hidden = state !== 'idle';
    if (error) {
      error.hidden = state !== 'error';
      if (message) error.textContent = message;
    }
    if (success) success.hidden = state !== 'success';
    if (row) row.hidden = state === 'success';
  }

  function buildPayload(form) {
    var fields = [];
    var seen = {};

    form.querySelectorAll('input[name], select[name], textarea[name]').forEach(function (el) {
      var name = (el.name || '').trim();
      if (!name || el.type === 'submit' || el.type === 'button') return;
      if (seen[name]) return;
      seen[name] = true;
      fields.push({ name: name, value: (el.value || '').trim() });
    });

    return {
      fields: fields,
      context: {
        pageUri: window.location.href,
        pageName: document.title || ''
      }
    };
  }

  function onSubmit(event) {
    var form = closestForm(event.target);
    if (!form) return;

    event.preventDefault();

    var section = form.closest('.wa-subscription-form');
    var portalId = (section && section.getAttribute('data-portal-id')) || '';
    var formId = (section && section.getAttribute('data-form-id')) || '';
    var emailInput = form.querySelector('input[name="email"]');
    var email = emailInput ? emailInput.value.trim() : '';

    showState(form, 'idle');

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      if (emailInput) {
        emailInput.classList.add('is-invalid');
        emailInput.focus();
      }
      showState(form, 'error', 'Please enter a valid email address.');
      return;
    }

    if (emailInput) emailInput.classList.remove('is-invalid');

    if (!portalId || !formId) {
      showState(form, 'error', 'Subscription form is not configured. Please try again later.');
      return;
    }

    setBusy(form, true);

    fetch(
      'https://api.hsforms.com/submissions/v3/integration/submit/' + portalId + '/' + formId,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload(form))
      }
    )
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        showState(form, 'success');
        form.reset();
      })
      .catch(function () {
        showState(
          form,
          'error',
          'Something went wrong sending your subscription. Please try again, or email office@weldaustralia.com.au.'
        );
      })
      .finally(function () {
        setBusy(form, false);
      });
  }

  document.addEventListener('submit', onSubmit, false);
}());
