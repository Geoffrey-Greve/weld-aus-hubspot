/**
 * footer.module/module.js
 *
 * Submits the footer newsletter signup straight to the HubSpot Forms API so the
 * signup is a real form submission - contact created/updated, submission recorded
 * against the form, workflows fire - while keeping the theme's own accessible
 * markup. Same approach as news-subscribe.module, plus the analytics cookie.
 *
 * The form has no `action`/`method`, so a failure here can never navigate the
 * visitor away (the earlier embed-with-GET-fallback arrangement sent people to
 * /subscribe?email=... whenever the embed misbehaved). Without JS the module's
 * <noscript> link to /subscribe is the path instead.
 *
 * Markup contract (module.html):
 *   form.wa-footer__newsletter-form[data-wa-footer-newsletter]
 *     data-portal-id, data-form-id, data-redirect-url,
 *     data-success-message, data-error-message, data-subscribe-url
 *   p.wa-footer__newsletter-feedback[role=status] - sibling status line
 */
(function () {
  'use strict';

  var SUBMIT_ENDPOINT = 'https://api.hsforms.com/submissions/v3/integration/submit/';

  /* HubSpot's analytics cookie. Passing it as context.hutk ties the submission to
     the visitor's session so it lands on the right contact rather than creating a
     bare email-only record. */
  function getHubspotUtk() {
    var match = document.cookie.match(/(?:^|;\s*)hubspotutk=([^;]*)/);
    return match ? decodeURIComponent(match[1]) : '';
  }

  function feedbackFor(form) {
    var newsletter = form.closest ? form.closest('.wa-footer__newsletter') : null;
    return (newsletter || document).querySelector('.wa-footer__newsletter-feedback');
  }

  function setFeedback(form, message, isError) {
    var feedback = feedbackFor(form);
    if (!feedback) return;

    feedback.textContent = message;
    feedback.classList.toggle('is-error', !!isError);

    if (isError) {
      var subscribeUrl = form.getAttribute('data-subscribe-url') || '/subscribe';
      var link = document.createElement('a');
      link.className = 'wa-footer__newsletter-feedback-link';
      link.href = subscribeUrl;
      link.textContent = 'Subscribe here instead';
      feedback.appendChild(document.createTextNode(' '));
      feedback.appendChild(link);
    }

    feedback.hidden = false;
    /* Screen readers get the live region; keyboard users get focus on it. */
    if (feedback.focus) feedback.focus();
  }

  function onSuccess(form) {
    var redirectUrl = form.getAttribute('data-redirect-url') || '';
    if (redirectUrl) {
      window.location.href = redirectUrl;
      return;
    }

    var message = form.getAttribute('data-success-message') || 'Thanks for subscribing.';
    form.reset();
    form.hidden = true;
    form.style.display = 'none';
    setFeedback(form, message, false);
  }

  function onFailure(form, button, originalLabel) {
    var message = form.getAttribute('data-error-message') ||
      'Something went wrong. Please try again, or subscribe from our subscribe page.';
    setFeedback(form, message, true);
    if (button) {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }

  function submit(form, event) {
    event.preventDefault();

    var input = form.querySelector('input[name="email"]');
    var button = form.querySelector('button[type="submit"]');
    var email = input && input.value ? input.value.trim() : '';

    if (!email) {
      if (form.reportValidity) form.reportValidity();
      return;
    }

    var portalId = form.getAttribute('data-portal-id') || '';
    var formId = form.getAttribute('data-form-id') || '';
    if (!portalId || !formId) {
      onFailure(form, button, button ? button.textContent : '');
      return;
    }

    var originalLabel = button ? button.textContent : '';
    if (button) {
      button.disabled = true;
      button.textContent = 'Subscribing…';
    }

    var payload = {
      fields: [{ objectTypeId: '0-1', name: 'email', value: email }],
      context: {
        pageUri: window.location.href,
        pageName: document.title
      }
    };

    var hutk = getHubspotUtk();
    if (hutk) payload.context.hutk = hutk;

    window.fetch(SUBMIT_ENDPOINT + encodeURIComponent(portalId) + '/' + encodeURIComponent(formId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (response) {
        if (!response.ok) {
          /* A 400 here usually means the selected form asks for more than an email
             (extra required fields, or a GDPR consent checkbox). The footer only
             collects an address, so send the visitor to /subscribe rather than
             failing silently. */
          throw new Error('HTTP ' + response.status);
        }
        onSuccess(form);
      })
      .catch(function () {
        onFailure(form, button, originalLabel);
      });
  }

  function init(form) {
    if (form.getAttribute('data-wa-initialised')) return;
    form.setAttribute('data-wa-initialised', '1');

    form.addEventListener('submit', function (event) {
      submit(form, event);
    });
  }

  function initAll() {
    var forms = document.querySelectorAll('form[data-wa-footer-newsletter]');
    for (var i = 0; i < forms.length; i++) init(forms[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }
}());
