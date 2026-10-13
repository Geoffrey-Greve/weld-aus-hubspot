/**
 * membership-join.module/module.js
 *
 * Theme-styled free-tier application forms that POST to the HubSpot Forms API.
 * New-editor embeds render inside a cross-origin iframe (js-*.hsforms.net), so
 * parent CSS cannot theme them — same reason contact-form owns its own markup.
 *
 * Markup contract (module.html):
 *   [data-wa-membership-application]
 *     data-portal-id, data-form-id, data-tier-slug, data-tier-label,
 *     data-success-message, data-error-message, data-submit-label
 *   .wa-membership-join__form  — fields: firstname, lastname, email, company,
 *                                phone, mobilephone (match the portal forms)
 *   .wa-membership-join__success
 *   .wa-mj-error
 */
(function () {
  'use strict';

  var SUBMIT_ENDPOINT = 'https://api.hsforms.com/submissions/v3/integration/submit/';

  function cookieValue(name) {
    try {
      var match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
      return match ? decodeURIComponent(match[1]) : '';
    } catch (e) {
      return '';
    }
  }

  function fieldValue(form, name) {
    var el = form.querySelector('[name="' + name + '"]');
    return el && typeof el.value === 'string' ? el.value.trim() : '';
  }

  function setInvalid(el, invalid) {
    if (!el) return;
    if (invalid) el.classList.add('is-invalid');
    else el.classList.remove('is-invalid');
  }

  function validate(form) {
    var ok = true;
    var required = ['firstname', 'lastname', 'email'];
    var mount = form.closest('[data-wa-membership-application]');
    var tierSlug = mount ? mount.getAttribute('data-tier-slug') || '' : '';
    if (tierSlug === 'student-apprentice') {
      required.push('school', 'student_course_completion_date', 'student_id_number');
    }
    for (var i = 0; i < required.length; i++) {
      var el = form.querySelector('[name="' + required[i] + '"]');
      var empty = !el || !String(el.value || '').trim();
      var badEmail = required[i] === 'email' && el && el.value && !el.checkValidity();
      setInvalid(el, empty || badEmail);
      if (empty || badEmail) ok = false;
    }
    return ok;
  }

  function init(mount) {
    if (mount.getAttribute('data-wa-initialised')) return;
    mount.setAttribute('data-wa-initialised', '1');

    var form = mount.querySelector('.wa-membership-join__form');
    var success = mount.querySelector('.wa-membership-join__success');
    var errorEl = mount.querySelector('.wa-mj-error');
    var submitBtn = form && form.querySelector('[type="submit"]');
    if (!form) return;

    var portalId = mount.getAttribute('data-portal-id') || '';
    var formId = mount.getAttribute('data-form-id') || '';
    var tierSlug = mount.getAttribute('data-tier-slug') || '';
    var tierLabel = mount.getAttribute('data-tier-label') || '';
    var successHtml =
      mount.getAttribute('data-success-message') ||
      '<p>Thanks — your membership application has been received.</p>';
    var errorMessage =
      mount.getAttribute('data-error-message') ||
      'Something went wrong. Please try again.';
    var submitLabel = mount.getAttribute('data-submit-label') || 'Submit application';

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (errorEl) {
        errorEl.hidden = true;
        errorEl.textContent = '';
      }
      if (!validate(form)) {
        var firstInvalid = form.querySelector('.is-invalid');
        if (firstInvalid) firstInvalid.focus();
        return;
      }
      if (!portalId || !formId) {
        if (errorEl) {
          errorEl.hidden = false;
          errorEl.textContent = errorMessage;
        }
        return;
      }

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting…';
      }

      var fields = [
        { name: 'firstname', value: fieldValue(form, 'firstname') },
        { name: 'lastname', value: fieldValue(form, 'lastname') },
        { name: 'email', value: fieldValue(form, 'email') }
      ];
      var company = fieldValue(form, 'company');
      var phone = fieldValue(form, 'phone');
      var mobile = fieldValue(form, 'mobilephone');
      var school = fieldValue(form, 'school');
      var completionDate = fieldValue(form, 'student_course_completion_date');
      var studentId = fieldValue(form, 'student_id_number');
      if (company) fields.push({ name: 'company', value: company });
      if (phone) fields.push({ name: 'phone', value: phone });
      if (mobile) fields.push({ name: 'mobilephone', value: mobile });
      if (tierSlug === 'student-apprentice') {
        if (school) fields.push({ name: 'school', value: school });
        fields.push({
          name: 'message',
          value: [
            'Student / Apprentice membership details:',
            school ? 'Name of Training Organisation: ' + school : '',
            completionDate ? 'Expected Apprenticeship Completion Date: ' + completionDate : '',
            studentId ? 'Student Identification Number: ' + studentId : ''
          ]
            .filter(Boolean)
            .join('\n')
        });
      }
      /* Do not send membership_tier* unless those fields exist on the HubSpot
         form — the Forms API 400s on unknown field names. Tier is identified
         by which form GUID was submitted (student / reciprocal / tafe). */

      var hutk = cookieValue('hubspotutk');
      var pageName = document.title;
      if (tierLabel) pageName = tierLabel + ' — ' + pageName;
      else if (tierSlug) pageName = tierSlug + ' — ' + pageName;
      var payload = {
        fields: fields,
        context: {
          pageUri: window.location.href,
          pageName: pageName
        }
      };
      if (hutk) payload.context.hutk = hutk;

      fetch(SUBMIT_ENDPOINT + portalId + '/' + formId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
        .then(function (response) {
          return response.text().then(function (text) {
            var body = null;
            try {
              body = text ? JSON.parse(text) : null;
            } catch (e) {
              body = null;
            }
            if (!response.ok) {
              var err = new Error('HTTP ' + response.status);
              err.status = response.status;
              err.body = body;
              throw err;
            }
            return body;
          });
        })
        .then(function () {
          form.hidden = true;
          if (success) {
            success.innerHTML = successHtml;
            success.hidden = false;
            try {
              success.focus();
            } catch (e) {}
          }
        })
        .catch(function (err) {
          var msg = errorMessage;
          var type =
            err &&
            err.body &&
            err.body.errors &&
            err.body.errors[0] &&
            err.body.errors[0].errorType;
          /* Theme-owned forms use the Forms API; HubSpot blocks that when the
             selected form still has CAPTCHA enabled (same constraint as contact-form). */
          if (type === 'FORM_HAS_RECAPTCHA_ENABLED') {
            msg =
              'This application form is temporarily unavailable (CAPTCHA is enabled on the HubSpot form). Please email membership@weldaustralia.com.au, or try again shortly.';
          } else if (type === 'FIELD_NOT_IN_FORM_DEFINITION') {
            msg =
              'This application form needs its HubSpot backend fields updated before it can accept student details. Please email membership@weldaustralia.com.au, or try again shortly.';
          }
          if (errorEl) {
            errorEl.hidden = false;
            errorEl.textContent = msg;
          }
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = submitLabel;
          }
        });
    });
  }

  function initAll() {
    var mounts = document.querySelectorAll('[data-wa-membership-application]');
    for (var i = 0; i < mounts.length; i++) init(mounts[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }
})();
