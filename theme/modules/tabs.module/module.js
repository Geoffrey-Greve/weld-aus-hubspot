(function () {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-tabs]').forEach(function (widget) {
      var tabs = Array.from(widget.querySelectorAll('[role="tab"]'));
      var panels = Array.from(widget.querySelectorAll('[role="tabpanel"]'));

      function activate(tab) {
        tabs.forEach(function (t) {
          t.setAttribute('aria-selected', 'false');
          t.setAttribute('tabindex', '-1');
        });
        panels.forEach(function (p) { p.setAttribute('hidden', ''); });
        tab.setAttribute('aria-selected', 'true');
        tab.setAttribute('tabindex', '0');
        var panel = widget.querySelector('#' + tab.getAttribute('aria-controls'));
        if (panel) panel.removeAttribute('hidden');
        tab.focus();
      }

      tabs.forEach(function (tab) {
        tab.addEventListener('click', function () { activate(tab); });
        tab.addEventListener('keydown', function (e) {
          var idx = tabs.indexOf(tab);
          if (e.key === 'ArrowRight' || e.keyCode === 39) { e.preventDefault(); activate(tabs[(idx + 1) % tabs.length]); }
          else if (e.key === 'ArrowLeft' || e.keyCode === 37) { e.preventDefault(); activate(tabs[(idx - 1 + tabs.length) % tabs.length]); }
          else if (e.key === 'Home' || e.keyCode === 36) { e.preventDefault(); activate(tabs[0]); }
          else if (e.key === 'End' || e.keyCode === 35) { e.preventDefault(); activate(tabs[tabs.length - 1]); }
        });
      });
    });
  });
}());
