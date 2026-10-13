/**
 * news-publications.module/module.js
 *
 * Embeds the HubSpot form selected in the Weld Connect card's "Subscription
 * form" field. Ported from footer.module/module.js, which solves the same
 * problem for the global footer newsletter.
 *
 * Two things this does that a bare hbspt.forms.create() does not:
 *   - `css: ''` + `cssRequired: ''` stop HubSpot's own stylesheets loading, and
 *     `cssClass: 'wa-hs-form'` gives the theme rules in assets/css/blog.css
 *     something to hook, so the form matches the navy card instead of shipping
 *     HubSpot's default chrome.
 *   - `submitText` (plus an onFormReady DOM rewrite, because some form versions
 *     ignore the option) applies the module's "Submit button label" field rather
 *     than leaving the button on the form's own "Submit".
 *
 * Markup contract (module.html):
 *   .wa-mini-subscribe-form--hubspot[data-wa-weld-connect-form]
 *     data-region, data-portal-id, data-form-id,
 *     data-submit-text, data-inline-message, data-redirect-url
 *   .wa-weld-connect-card__fallback - hidden note, revealed only if the embed
 *                                     cannot load.
 */
(function () {
  'use strict';

  var EMBED_SRC = 'https://js.hsforms.net/forms/embed/v2.js';
  var EMBED_TIMEOUT_MS = 8000;
  var EMBED_POLL_MS = 150;
  var RENDER_TIMEOUT_MS = 8000;

  function embedReady() {
    return !!(window.hbspt && window.hbspt.forms && window.hbspt.forms.create);
  }

  /* Loads the HubSpot forms embed once per page, even if another module
     (e.g. footer) already injected its own copy.
     `done` is always called exactly once, with an error if the embed does not
     become usable inside EMBED_TIMEOUT_MS - a script another module injected
     may already have failed before this module ran, in which case no further
     load/error event will ever fire and only the poll can settle it. */
  function loadEmbed(done) {
    if (embedReady()) {
      done(null);
      return;
    }

    var settled = false;
    function settle(err) {
      if (settled) return;
      settled = true;
      done(err);
    }

    var deadline = Date.now() + EMBED_TIMEOUT_MS;
    (function poll() {
      if (settled) return;
      if (embedReady()) {
        settle(null);
        return;
      }
      if (Date.now() >= deadline) {
        settle(new Error('hsforms embed did not become ready'));
        return;
      }
      window.setTimeout(poll, EMBED_POLL_MS);
    }());

    var existing = document.querySelector('script[src*="js.hsforms.net/forms/embed/v2.js"]');
    if (existing) {
      /* Fast-path a failure we can still observe; the poll covers the rest. */
      existing.addEventListener('error', function () {
        settle(new Error('hsforms embed failed to load'));
      });
      return;
    }

    var script = document.createElement('script');
    script.src = EMBED_SRC;
    script.async = true;
    script.charset = 'utf-8';
    script.onload = function () {
      if (embedReady()) settle(null);
    };
    script.onerror = function () {
      settle(new Error('hsforms embed failed to load'));
    };
    document.head.appendChild(script);
  }

  function showFallback(mount) {
    var card = mount.closest ? mount.closest('.wa-weld-connect-card') : null;
    var fallback = (card || document).querySelector('.wa-weld-connect-card__fallback');
    if (fallback) fallback.hidden = false;
    mount.style.display = 'none';
  }

  function hasRendered(mount) {
    return !!mount.querySelector('form, .submitted-message, iframe');
  }

  function applySubmitText(formEl, text) {
    if (!formEl || !text) return;
    var button = formEl.querySelector('.hs-button, input[type="submit"], button[type="submit"]');
    if (!button) return;
    if (button.tagName === 'INPUT') button.value = text;
    else button.textContent = text;
  }

  function init(mount, index) {
    if (mount.getAttribute('data-wa-initialised')) return;
    mount.setAttribute('data-wa-initialised', '1');

    /* hbspt.forms.create targets by selector, so every mount needs an id even
       when the card is placed more than once on a page. */
    if (!mount.id) mount.id = 'wa-weld-connect-form-' + index;

    var portalId = mount.getAttribute('data-portal-id') || '';
    var formId = mount.getAttribute('data-form-id') || '';
    if (!portalId || !formId) {
      showFallback(mount);
      return;
    }

    var submitText = mount.getAttribute('data-submit-text') || '';
    var inlineMessage = mount.getAttribute('data-inline-message') || '';
    var redirectUrl = mount.getAttribute('data-redirect-url') || '';

    loadEmbed(function (err) {
      if (err) {
        showFallback(mount);
        return;
      }

      var options = {
        region: mount.getAttribute('data-region') || 'ap1',
        portalId: portalId,
        formId: formId,
        target: '#' + mount.id,
        css: '',
        cssRequired: '',
        cssClass: 'wa-hs-form',
        onFormReady: function (form) {
          /* v2 hands back a jQuery-like collection on some versions, a node on others. */
          applySubmitText(form && form[0] ? form[0] : form, submitText);
        }
      };

      if (submitText) options.submitText = submitText;
      if (redirectUrl) options.redirectUrl = redirectUrl;
      else if (inlineMessage) options.inlineMessage = inlineMessage;

      try {
        window.hbspt.forms.create(options);
      } catch (e) {
        showFallback(mount);
        return;
      }

      /* If the embed never paints (blocked request, bad GUID), don't leave a
         dead gap in the middle of the card. */
      window.setTimeout(function () {
        if (!hasRendered(mount)) showFallback(mount);
      }, RENDER_TIMEOUT_MS);
    });
  }

  function initAll() {
    var mounts = document.querySelectorAll('[data-wa-weld-connect-form]');
    for (var i = 0; i < mounts.length; i++) init(mounts[i], i);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }
}());
