(function () {
  'use strict';

  /**
   * Theme-styled contact form that submits to HubSpot Forms API.
   * Form GUID(s) come from the module pickers; field UI stays in-theme so
   * styling and deep-link preselect work reliably (unlike new-form iframes).
   */

  var CATEGORY_ALIASES = {
    'new-business': 'New business',
    'newbusiness': 'New business',
    'training': 'Training & courses',
    'training-courses': 'Training & courses',
    'training-and-courses': 'Training & courses',
    'courses': 'Training & courses',
    'machine-repair': 'Machine repair & servicing',
    'machine-repair-servicing': 'Machine repair & servicing',
    'machine-repair-and-servicing': 'Machine repair & servicing',
    'repair': 'Machine repair & servicing',
    'servicing': 'Machine repair & servicing',
    'qualification': 'Qualification, certification & exams',
    'qualification-certification-exams': 'Qualification, certification & exams',
    'qualification-certification-and-exams': 'Qualification, certification & exams',
    'certification': 'Qualification, certification & exams',
    'exams': 'Qualification, certification & exams',
    'engineering': 'Engineering services',
    'engineering-services': 'Engineering services',
    'membership': 'Membership',
    'marketing': 'Marketing, communications & events',
    'marketing-communications-events': 'Marketing, communications & events',
    'marketing-communications-and-events': 'Marketing, communications & events',
    'communications': 'Marketing, communications & events',
    'events': 'Marketing, communications & events',
    'finance': 'Finance',
    'general': 'General enquiry',
    'general-enquiry': 'General enquiry',
    'job-board': 'General enquiry',
    'advertise-a-job': 'New business'
  };

  function decodeEntities(value) {
    return String(value || '')
      .replace(/&amp;/gi, '&')
      .replace(/&#38;/g, '&')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&#160;/g, ' ');
  }

  function normalise(value) {
    return decodeEntities(value)
      .replace(/\+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function slugify(value) {
    return normalise(value)
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function resolveRequestedCategory(requested) {
    var raw = decodeEntities(requested || '').replace(/\+/g, ' ').trim();
    if (!raw) return '';
    var slug = slugify(raw);
    if (CATEGORY_ALIASES[slug]) return CATEGORY_ALIASES[slug];
    return raw;
  }

  function optionMatches(optionValue, optionLabel, requested) {
    var resolved = resolveRequestedCategory(requested);
    var targets = [requested, resolved];
    var candidates = [optionValue, optionLabel];
    for (var i = 0; i < targets.length; i++) {
      var tNorm = normalise(targets[i]);
      var tSlug = slugify(targets[i]);
      if (!tNorm) continue;
      for (var j = 0; j < candidates.length; j++) {
        var c = candidates[j] || '';
        if (!c) continue;
        if (normalise(c) === tNorm) return true;
        if (slugify(c) === tSlug) return true;
      }
    }
    return false;
  }

  function getQuery() {
    try {
      var params = new URLSearchParams(window.location.search || '');
      return {
        enquiry: params.get('enquiry') || params.get('enquiry_type') || params.get('topic') || params.get('category') || '',
        form: params.get('form') || params.get('mode') || '',
        resource: params.get('resource') || ''
      };
    } catch (e) {
      return { enquiry: '', form: '', resource: '' };
    }
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function findCategorySelect(root) {
    return root.querySelector('[name="hs_ticket_category"]') ||
      root.querySelector('[name="enquiry_type"]');
  }

  function headerOffset() {
    var raw = getComputedStyle(document.documentElement)
      .getPropertyValue('--wa-site-header-offset')
      .trim();
    var parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : 110;
  }

  function scrollToSection(section) {
    if (!section || typeof window === 'undefined') return;
    function alignSection(behavior) {
      if (typeof window === 'undefined' || !section.isConnected) return;
      var top = section.getBoundingClientRect().top + window.pageYOffset - headerOffset() - 24;
      window.scrollTo({ top: Math.max(top, 0), behavior: behavior });
    }

    window.setTimeout(function () {
      alignSection('smooth');
    }, 50);

    // Android can complete the native hash jump before the offices map and
    // embedded form have settled into their mobile layout. Re-align once that
    // layout has finished so #enquiry lands at the visible form heading, not
    // the map above it or the section's built-in top padding.
    if (window.matchMedia && window.matchMedia('(max-width: 767px)').matches) {
      function alignMobileHeading() {
        var heading = section.querySelector('.wa-section-head') || section;
        if (!heading.isConnected) return;
        var top = heading.getBoundingClientRect().top + window.pageYOffset - headerOffset() - 16;
        window.scrollTo(0, Math.max(top, 0));
      }

      window.setTimeout(alignMobileHeading, 450);
      window.addEventListener('load', function () {
        window.setTimeout(alignMobileHeading, 100);
      }, { once: true });
    }
  }

  function loadHubSpotForms(callback, onError) {
    if (window.hbspt && window.hbspt.forms && window.hbspt.forms.create) {
      callback();
      return;
    }

    var existing = document.querySelector('script[data-wa-hubspot-forms]');
    if (existing) {
      existing.addEventListener('load', callback, { once: true });
      existing.addEventListener('error', onError, { once: true });
      return;
    }

    var script = document.createElement('script');
    script.src = 'https://js.hsforms.net/forms/embed/v2.js';
    script.async = true;
    script.charset = 'utf-8';
    script.setAttribute('data-wa-hubspot-forms', '');
    script.onload = callback;
    script.onerror = onError;
    document.head.appendChild(script);
  }

  function initHubSpotContactForm(section, mount) {
    var portalId = section.dataset.portalId || '';
    var generalFormId = section.dataset.formId || '';
    var soldamaticFormId = section.dataset.soldamaticFormId || '';
    var query = getQuery();
    var tabs = mount.querySelectorAll('[data-wa-hs-form-mode]');
    var panels = mount.querySelectorAll('[data-wa-hs-form-panel]');
    var error = mount.querySelector('[data-wa-hs-form-error]');
    var loaded = {};

    function showError() {
      if (!error) return;
      error.hidden = false;
      error.textContent = 'The enquiry form could not load. Please refresh the page or call us directly.';
    }

    function mountForm(mode) {
      var formId = mode === 'soldamatic' ? soldamaticFormId : generalFormId;
      var panel = mount.querySelector('[data-wa-hs-form-panel="' + mode + '"]');
      if (!panel || !formId || loaded[mode]) return;
      loaded[mode] = true;
      loadHubSpotForms(function () {
        if (!(window.hbspt && window.hbspt.forms && window.hbspt.forms.create)) {
          showError();
          return;
        }
        window.hbspt.forms.create({
          region: 'ap1',
          portalId: portalId,
          formId: formId,
          target: '#' + panel.id,
          onFormSubmitted: function () {
            /* The HubSpot success message replaces the fields inside the
               embed. Remove only the surrounding card chrome at that point. */
            section.classList.add('wa-contact-form--submitted');
          }
        });
      }, showError);
    }

    function setMode(mode) {
      var active = mode === 'soldamatic' && soldamaticFormId ? 'soldamatic' : 'general';
      section.classList.remove('wa-contact-form--submitted');
      panels.forEach(function (panel) {
        panel.hidden = panel.dataset.waHsFormPanel !== active;
      });
      tabs.forEach(function (tab) {
        var selected = tab.dataset.waHsFormMode === active;
        tab.classList.toggle('is-active', selected);
        tab.setAttribute('aria-selected', selected ? 'true' : 'false');
      });
      mountForm(active);
    }

    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        setMode(tab.dataset.waHsFormMode);
      });
    });
    setMode(/soldamatic/i.test(query.form) || /soldamatic/i.test(query.enquiry) ? 'soldamatic' : 'general');
  }

  function initContactForm(section) {
    var hubSpotMount = section.querySelector('[data-wa-hubspot-contact]');
    if (hubSpotMount) {
      initHubSpotContactForm(section, hubSpotMount);
      return;
    }
    var portalId = section.dataset.portalId || '';
    var generalFormId = section.dataset.formId || '';
    var soldamaticFormId = section.dataset.soldamaticFormId || '';
    var showPhone = section.dataset.showPhone !== 'false';
    var showCo = section.dataset.showCompany !== 'false';
    var defSuccessTitle = section.dataset.successTitle || 'Enquiry received';
    var defSuccessBody = section.dataset.successBody || '';
    var query = getQuery();
    var hashId = (window.location.hash || '').replace(/^#/, '');

    // Live DnD pages sometimes clear the template section_id — keep #enquiry working.
    if (!section.id) section.id = 'enquiry';

    var condCfg = null;
    try { if (section.dataset.conditional) condCfg = JSON.parse(section.dataset.conditional); } catch (e) {}

    var soldCfg = null;
    try { if (section.dataset.soldamatic) soldCfg = JSON.parse(section.dataset.soldamatic); } catch (e) {}

    if (!soldCfg && (section.id === 'enquiry' || section.dataset.soldamaticFallback === 'true')) {
      soldCfg = {
        generalLabel: 'General enquiry',
        soldamaticLabel: 'Soldamatic support',
        submitLabel: 'Submit support request',
        successTitle: 'Support request received',
        successBody: '<p>A member of our Soldamatic team will be in touch as soon as possible.</p>',
        resetLabel: 'Submit another request',
        machineLabel: 'Soldamatic machine number',
        machineHint: 'Found on the label on the back of your simulator unit.',
        machinePlaceholder: 'e.g. SM-2024-XXXX',
        messageLabel: 'Brief description of the issue',
        messagePlaceholder: 'Describe the issue with your Soldamatic simulator…',
        showCompanyOnGeneral: false
      };
    }

    function ensureSoldamaticMarkup() {
      if (!soldCfg) return;
      var liveForm = section.querySelector('.wa-contact-form__form');
      if (!liveForm) return;

      if (!liveForm.querySelector('[data-wa-form-mode]')) {
        var tabs = document.createElement('div');
        tabs.className = 'wa-cf-mode-tabs';
        tabs.setAttribute('role', 'tablist');
        tabs.setAttribute('aria-label', 'Select enquiry form');
        tabs.innerHTML =
          '<button type="button" class="wa-cf-mode-tab is-active" data-wa-form-mode="general" role="tab" aria-selected="true">' +
          escapeHtml(soldCfg.generalLabel || 'General enquiry') +
          '</button>' +
          '<button type="button" class="wa-cf-mode-tab" data-wa-form-mode="soldamatic" role="tab" aria-selected="false">' +
          escapeHtml(soldCfg.soldamaticLabel || 'Soldamatic support') +
          '</button>';
        liveForm.insertBefore(tabs, liveForm.firstElementChild || null);
      }

      if (!liveForm.querySelector('[name="form_mode"]')) {
        var mode = document.createElement('input');
        mode.type = 'hidden';
        mode.name = 'form_mode';
        mode.value = 'general';
        var modeTab = liveForm.querySelector('[data-wa-form-mode]');
        var modeInsertBefore = modeTab && modeTab.parentElement ? modeTab.parentElement.nextSibling : liveForm.firstElementChild;
        liveForm.insertBefore(mode, modeInsertBefore || null);
      }

      var liveType = findCategorySelect(liveForm);
      if (liveType) {
        var typeField = liveType.closest('.wa-cf-field');
        if (typeField) typeField.setAttribute('data-wa-general-only', '');
        Array.prototype.slice.call(liveType.options).forEach(function (opt) {
          if (/soldamatic/i.test(opt.textContent || opt.value || '')) opt.remove();
        });
      }

      var company = liveForm.querySelector('[name="company"]');
      if (company) {
        var companyField = company.closest('.wa-cf-field');
        var contactRow = company.closest('.wa-cf-row');
        if (companyField) companyField.setAttribute('data-wa-company-field', '');
        if (contactRow) contactRow.setAttribute('data-wa-contact-row', '');
      }

      var liveMessage = liveForm.querySelector('[name="message"]');
      var messageField = liveMessage ? liveMessage.closest('.wa-cf-field') : null;
      if (liveMessage && !liveMessage.dataset.waGeneralPlaceholder) {
        liveMessage.dataset.waGeneralPlaceholder = liveMessage.getAttribute('placeholder') || 'How can we help you?';
      }

      if (!liveForm.querySelector('[name="soldamatic_machine_number"]')) {
        var machineField = document.createElement('div');
        machineField.className = 'wa-cf-field';
        machineField.setAttribute('data-wa-soldamatic-only', '');
        machineField.hidden = true;
        machineField.innerHTML =
          '<label class="wa-cf-label" for="wa-cf-soldamatic-machine">' +
          escapeHtml(soldCfg.machineLabel || 'Soldamatic machine number') +
          '<span class="wa-cf-required" aria-hidden="true">*</span></label>' +
          (soldCfg.machineHint ? '<span class="wa-cf-hint">' + escapeHtml(soldCfg.machineHint) + '</span>' : '') +
          '<input type="text" id="wa-cf-soldamatic-machine" name="soldamatic_machine_number" class="wa-cf-input" placeholder="' +
          escapeHtml(soldCfg.machinePlaceholder || 'e.g. SM-2024-XXXX') +
          '" data-wa-soldamatic-required>';
        liveForm.insertBefore(machineField, messageField || liveForm.querySelector('.wa-cf-submit-wrap'));
      }

      var sidebar = section.querySelector('.wa-contact-form__sidebar');
      var defaultSide = section.querySelector('[data-wa-default-sidebar]');
      if (sidebar && !section.querySelector('[data-wa-soldamatic-sidebar]')) {
        var soldSide = document.createElement('div');
        soldSide.className = 'wa-cf-sidebar-card wa-cf-sidebar-card--soldamatic';
        soldSide.setAttribute('aria-hidden', 'true');
        soldSide.setAttribute('data-wa-soldamatic-sidebar', '');
        soldSide.hidden = true;
        soldSide.innerHTML =
          '<p class="wa-cf-sidebar-overline">About Soldamatic support</p>' +
          '<div class="wa-cf-sidebar-body"><p>Need assistance with your Soldamatic augmented reality welding simulator? Complete the form and our dedicated team will respond as soon as possible.</p></div>';
        sidebar.insertBefore(soldSide, defaultSide || sidebar.firstElementChild || null);
      }
    }

    ensureSoldamaticMarkup();

    var form = section.querySelector('.wa-contact-form__form');
    var successPanel = section.querySelector('.wa-contact-form__success');
    var successTitle = section.querySelector('.wa-contact-form__success-title');
    var successBody = section.querySelector('.wa-contact-form__success-body');
    var resetBtn = section.querySelector('.wa-contact-form__reset');
    var errorMsg = section.querySelector('.wa-cf-error-msg');
    var submitBtn = section.querySelector('.wa-cf-submit');
    var submitLabel = section.querySelector('.wa-cf-submit-label');
    var defaultSubmitLabel = submitLabel ? submitLabel.textContent : 'Send enquiry';

    var typeSelect = findCategorySelect(section);
    var condBlock = section.querySelector('[data-wa-conditional]');
    var condSidebar = section.querySelector('[data-wa-cond-sidebar]');
    var defaultSidebar = section.querySelector('[data-wa-default-sidebar]');
    var extraField = section.querySelector('[data-wa-extra-field]');
    var extraInput = section.querySelector('[name="conditional_extra"]');
    var radioInputs = condBlock ? condBlock.querySelectorAll('.wa-cf-choice-radio') : [];
    var modeInput = section.querySelector('[name="form_mode"]');
    var modeTabs = section.querySelectorAll('[data-wa-form-mode]');
    var generalOnly = section.querySelectorAll('[data-wa-general-only]');
    var soldamaticOnly = section.querySelectorAll('[data-wa-soldamatic-only]');
    var soldSidebar = section.querySelector('[data-wa-soldamatic-sidebar]');
    var soldMachine = section.querySelector('[name="soldamatic_machine_number"]');
    var companyField = section.querySelector('[data-wa-company-field]');
    var contactRow = section.querySelector('[data-wa-contact-row]');
    var messageLabel = section.querySelector('[data-wa-message-label]');
    var messageInput = section.querySelector('[name="message"]');
    var activeMode = 'general';

    function setHidden(el, hidden) {
      if (!el) return;
      el.hidden = !!hidden;
      el.setAttribute('aria-hidden', hidden ? 'true' : 'false');
    }

    function setRequired(el, required) {
      if (!el) return;
      el.required = !!required;
      el.setAttribute('aria-required', required ? 'true' : 'false');
      if (!required) el.classList.remove('is-invalid');
    }

    function isSoldamaticMode() {
      return !!soldCfg && activeMode === 'soldamatic';
    }

    function activeFormId() {
      if (isSoldamaticMode() && soldamaticFormId) return soldamaticFormId;
      return generalFormId;
    }

    function setCompanyVisibility() {
      if (!soldCfg || !companyField) return;
      var hideCompany = activeMode === 'general' && soldCfg.showCompanyOnGeneral === false;
      setHidden(companyField, hideCompany);
      if (contactRow) contactRow.classList.toggle('wa-cf-row--single', hideCompany);
    }

    function currentSubmitText() {
      return isSoldamaticMode() ? (soldCfg.submitLabel || 'Submit support request') : defaultSubmitLabel;
    }

    function setConditionalVisible(on) {
      if (!condBlock) return;
      condBlock.classList.toggle('is-visible', on);
      condBlock.setAttribute('aria-hidden', on ? 'false' : 'true');
      if (!on) {
        radioInputs.forEach(function (r) { r.checked = false; });
        setExtraVisible(false);
      }
      if (condSidebar) {
        condSidebar.classList.toggle('is-visible', on);
        condSidebar.setAttribute('aria-hidden', on ? 'false' : 'true');
      }
      if (defaultSidebar) defaultSidebar.style.display = on ? 'none' : '';
    }

    function setExtraVisible(on) {
      if (!extraField) return;
      extraField.classList.toggle('is-visible', on);
      extraField.setAttribute('aria-hidden', on ? 'false' : 'true');
      if (extraInput) extraInput.required = on;
    }

    function setMode(mode) {
      if (!soldCfg) return;
      activeMode = mode === 'soldamatic' ? 'soldamatic' : 'general';
      if (modeInput) modeInput.value = activeMode;
      section.dataset.activeForm = activeMode;

      modeTabs.forEach(function (tab) {
        var isActive = tab.dataset.waFormMode === activeMode;
        tab.classList.toggle('is-active', isActive);
        tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });

      generalOnly.forEach(function (el) { setHidden(el, activeMode === 'soldamatic'); });
      soldamaticOnly.forEach(function (el) { setHidden(el, activeMode !== 'soldamatic'); });
      setRequired(typeSelect, activeMode !== 'soldamatic');
      setRequired(soldMachine, activeMode === 'soldamatic');

      if (activeMode === 'soldamatic') {
        if (typeSelect) typeSelect.value = '';
        setConditionalVisible(false);
      } else if (typeSelect && condCfg) {
        setConditionalVisible(typeSelect.value === condCfg.triggerType);
      }

      if (messageLabel) {
        messageLabel.textContent = activeMode === 'soldamatic'
          ? (soldCfg.messageLabel || 'Brief description of the issue')
          : 'Message';
      }
      if (messageInput) {
        messageInput.placeholder = activeMode === 'soldamatic'
          ? (soldCfg.messagePlaceholder || 'Describe the issue with your Soldamatic simulator…')
          : (messageInput.dataset.waGeneralPlaceholder || 'How can we help you?');
      }
      if (submitLabel) submitLabel.textContent = currentSubmitText();
      if (soldSidebar) setHidden(soldSidebar, activeMode !== 'soldamatic');
      if (defaultSidebar && activeMode === 'soldamatic') {
        defaultSidebar.style.display = 'none';
      } else if (defaultSidebar && !(condCfg && typeSelect && typeSelect.value === condCfg.triggerType)) {
        defaultSidebar.style.display = '';
      }
      if (condSidebar && activeMode === 'soldamatic') {
        condSidebar.classList.remove('is-visible');
        condSidebar.setAttribute('aria-hidden', 'true');
      }
      setCompanyVisibility();
    }

    if (typeSelect && condCfg) {
      typeSelect.addEventListener('change', function () {
        if (isSoldamaticMode()) return;
        setConditionalVisible(typeSelect.value === condCfg.triggerType);
      });
    }

    radioInputs.forEach(function (radio) {
      radio.addEventListener('change', function () {
        if (condCfg) setExtraVisible(radio.value === condCfg.revealOn);
      });
    });

    modeTabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        setMode(tab.dataset.waFormMode);
      });
    });

    if (soldCfg) {
      var startSoldamatic = /soldamatic/i.test(query.form) || /soldamatic/i.test(query.enquiry);
      setMode(startSoldamatic ? 'soldamatic' : 'general');
    }

    function preselectEnquiryFromQuery() {
      if (!typeSelect || isSoldamaticMode()) return false;
      var requested = query.enquiry;
      if (!requested) return false;

      var options = Array.prototype.slice.call(typeSelect.options || []);
      var match = options.find(function (option) {
        if (!option.value) return false;
        return optionMatches(
          decodeEntities(option.value),
          decodeEntities(option.textContent),
          requested
        );
      });
      if (!match || !match.value) return false;
      typeSelect.value = match.value;
      typeSelect.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    function prefillResourceMessage() {
      if (!messageInput || !query.resource || messageInput.value) return;
      messageInput.value = 'Enquiry about resource: ' + query.resource;
    }

    var didPreselect = preselectEnquiryFromQuery();
    prefillResourceMessage();

    var wantsDeepLink =
      hashId === 'enquiry' ||
      (section.id && hashId === section.id) ||
      !!query.enquiry ||
      !!query.form ||
      !!query.resource ||
      didPreselect;
    if (wantsDeepLink) {
      if (!section.id) section.id = 'enquiry';
      scrollToSection(section);
    }

    if (!form) return;

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      var invalid = [];
      form.querySelectorAll('[required]').forEach(function (el) {
        if (!el.value.trim()) {
          el.classList.add('is-invalid');
          invalid.push(el);
        } else {
          el.classList.remove('is-invalid');
        }
      });

      if (invalid.length) {
        invalid[0].focus();
        if (errorMsg) errorMsg.textContent = 'Please complete all required fields.';
        return;
      }

      if (errorMsg) errorMsg.textContent = '';
      if (submitBtn) { submitBtn.disabled = true; if (submitLabel) submitLabel.textContent = 'Sending…'; }

      var fields = [];
      var formMode = modeInput ? modeInput.value : 'general';
      var isSoldamatic = !!soldCfg && formMode === 'soldamatic';
      var enquiryType = isSoldamatic
        ? (soldCfg.soldamaticLabel || 'Soldamatic support')
        : (typeSelect ? typeSelect.value : '');
      var firstName = (form.querySelector('[name="firstname"]') || {}).value || '';
      var lastName = (form.querySelector('[name="lastname"]') || {}).value || '';
      var email = (form.querySelector('[name="email"]') || {}).value || '';
      var phone = (form.querySelector('[name="phone"]') || {}).value || '';
      var company = (form.querySelector('[name="company"]') || {}).value || '';
      var rawMessage = (form.querySelector('[name="message"]') || {}).value || '';

      /*
       * This form creates both Contact and Ticket data. The Forms API needs an
       * explicit object type for fields that belong to a ticket; without it,
       * HubSpot rejects the whole submission rather than creating the ticket.
       */
      fields.push({ objectTypeId: '0-1', name: 'firstname', value: firstName });
      fields.push({ objectTypeId: '0-1', name: 'lastname', value: lastName });
      fields.push({ objectTypeId: '0-1', name: 'email', value: email });
      if (showPhone && phone) fields.push({ objectTypeId: '0-1', name: 'phone', value: phone });
      if (showCo && company) fields.push({ objectTypeId: '0-1', name: 'company', value: company });

      if (!isSoldamatic && enquiryType) {
        fields.push({ objectTypeId: '0-5', name: 'hs_ticket_category', value: enquiryType });
      }

      if (isSoldamatic) {
        var machineNumber = (soldMachine || {}).value || '';
        if (machineNumber) fields.push({ objectTypeId: '0-5', name: 'soldamatic_machine_number', value: machineNumber });
        fields.push({ objectTypeId: '0-5', name: 'content', value: rawMessage });
      } else {
        var messageParts = [];
        if (enquiryType) messageParts.push('Enquiry type: ' + enquiryType);
        if (condCfg && enquiryType === condCfg.triggerType) {
          var checkedRadio = condBlock ? condBlock.querySelector('.wa-cf-choice-radio:checked') : null;
          if (checkedRadio) messageParts.push('Selected option: ' + checkedRadio.value);
          if (extraInput && extraInput.value) {
            messageParts.push((condCfg.extraLabel || 'Additional detail') + ': ' + extraInput.value);
          }
        }
        if (rawMessage) {
          if (messageParts.length) messageParts.push('');
          messageParts.push(rawMessage);
        }
        fields.push({ objectTypeId: '0-5', name: 'content', value: messageParts.join('\n') || rawMessage });
      }

      var formId = activeFormId();
      var payload = {
        fields: fields,
        context: { pageUri: window.location.href, pageName: document.title }
      };

      var isCond = !isSoldamatic && condCfg && enquiryType === condCfg.triggerType;
      var finalSuccessTitle = isSoldamatic ? (soldCfg.successTitle || 'Support request received') : defSuccessTitle;
      var finalSuccessBody = isSoldamatic
        ? (soldCfg.successBody || 'A member of our Soldamatic team will be in touch as soon as possible.')
        : ((isCond && condCfg.condSuccessBody) ? condCfg.condSuccessBody : defSuccessBody);
      var finalResetLabel = isSoldamatic ? (soldCfg.resetLabel || 'Submit another request') : 'Send another enquiry';

      function showSuccess() {
        form.classList.add('is-hidden');
        successPanel.classList.add('is-visible');
        successPanel.removeAttribute('aria-hidden');
        if (successTitle) successTitle.textContent = finalSuccessTitle;
        if (successBody) successBody.innerHTML = finalSuccessBody;
        if (resetBtn) resetBtn.textContent = finalResetLabel;
        try { successPanel.focus(); } catch (err) {}
      }

      function onError(msg) {
        if (submitBtn) { submitBtn.disabled = false; if (submitLabel) submitLabel.textContent = currentSubmitText(); }
        if (errorMsg) errorMsg.textContent = msg || 'Something went wrong. Please try again or call us directly.';
      }

      if (!portalId || !formId) {
        showSuccess();
        return;
      }

      fetch(
        'https://api.hsforms.com/submissions/v3/integration/submit/' + portalId + '/' + formId,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }
      )
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          showSuccess();
        })
        .catch(function () {
          onError();
        });
    });

    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        var modeToRestore = activeMode;
        form.reset();
        form.classList.remove('is-hidden');
        successPanel.classList.remove('is-visible');
        successPanel.setAttribute('aria-hidden', 'true');
        setConditionalVisible(false);
        if (soldCfg) setMode(modeToRestore);
        if (submitBtn) submitBtn.disabled = false;
        if (submitLabel) submitLabel.textContent = currentSubmitText();
        if (errorMsg) errorMsg.textContent = '';
        form.querySelectorAll('.is-invalid').forEach(function (el) { el.classList.remove('is-invalid'); });
        if (modeToRestore === 'soldamatic') {
          var firstName = form.querySelector('[name="firstname"]');
          firstName && firstName.focus();
        } else {
          typeSelect && typeSelect.focus();
        }
      });
    }
  }

  function initAll() {
    document.querySelectorAll('.wa-contact-form').forEach(initContactForm);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }
}());
