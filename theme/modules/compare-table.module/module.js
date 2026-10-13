/* compare-table.module/module.js
   Collapsible row groups for the comparison table.
   Toggles aria-expanded on the group button and hides/shows
   all feature rows belonging to that group.
*/

(function () {
  'use strict';

  var tabToComparisonKey = {
    corporate: 'corporate',
    supplier: 'supplier',
    'industry-supplier': 'supplier',
    individual: 'individual',
    reciprocal: 'individual',
    free: 'free',
    'free-memberships': 'free',
    'student-apprentice': 'free',
    'tafe-rto': 'free'
  };

  function initCompareTables() {
    var tables = document.querySelectorAll('.wa-compare-table--collapsible');

    tables.forEach(function (table) {
      var groupBtns = table.querySelectorAll('.wa-compare-table__group-btn');

      groupBtns.forEach(function (btn) {
        // Determine which group index this button controls
        var groupRow = btn.closest('tr.wa-compare-table__group-row');
        if (!groupRow) return;

        var groupIndex = groupRow.getAttribute('data-group-index');

        // Rows belonging to this group, matched by data-group. If that lookup
        // comes back empty (e.g. a stale template deploy emitting mismatched
        // group keys), fall back to walking the sibling rows up to the next
        // group header, so the toggle still works.
        function getGroupRows() {
          var matched = groupIndex
            ? table.querySelectorAll('tr.wa-compare-table__row[data-group="' + groupIndex + '"]')
            : [];

          if (matched.length) return matched;

          var siblings = [];
          var node = groupRow.nextElementSibling;

          while (node && !node.classList.contains('wa-compare-table__group-row')) {
            if (node.classList.contains('wa-compare-table__row')) siblings.push(node);
            node = node.nextElementSibling;
          }

          return siblings;
        }

        btn.addEventListener('click', function () {
          var isExpanded = btn.getAttribute('aria-expanded') === 'true';
          var nextState  = !isExpanded;

          btn.setAttribute('aria-expanded', String(nextState));

          getGroupRows().forEach(function (row) {
            row.hidden = !nextState;
          });
        });
      });
    });
  }

  function getActiveMembershipTabKey() {
    var activeTab = document.querySelector(
      '.wa-membership-options [data-membership-tab][aria-selected="true"], ' +
      '.wa-membership-options [data-membership-tab].is-active'
    );

    if (activeTab) {
      return activeTab.getAttribute('data-membership-tab');
    }

    var hashKey = window.location.hash
      ? decodeURIComponent(window.location.hash.slice(1)).replace(/^membership-/, '')
      : '';

    return hashKey || 'corporate';
  }

  function getComparisonKey(tabKey) {
    return tabToComparisonKey[tabKey] || tabKey || 'corporate';
  }

  function syncMembershipComparisonSections() {
    var comparisonKey = getComparisonKey(getActiveMembershipTabKey());
    var sections = document.querySelectorAll('[data-membership-compare-section="true"]');

    sections.forEach(function (section) {
      var panels = section.querySelectorAll('[data-membership-compare-panel]');
      var matched = false;

      panels.forEach(function (panel) {
        if (panel.getAttribute('data-membership-compare-panel') === comparisonKey) {
          matched = true;
        }
      });

      panels.forEach(function (panel, index) {
        var panelKey = panel.getAttribute('data-membership-compare-panel');
        var isActive = matched ? panelKey === comparisonKey : index === 0;

        panel.hidden = !isActive;
        panel.setAttribute('aria-hidden', String(!isActive));
      });
    });
  }

  function initMembershipComparisonSync() {
    if (!document.querySelector('[data-membership-compare-section="true"]')) return;

    syncMembershipComparisonSections();

    document.addEventListener('click', function (event) {
      if (!event.target.closest('[data-membership-tab]')) return;
      window.requestAnimationFrame(syncMembershipComparisonSections);
    });

    document.addEventListener('keydown', function (event) {
      if (!event.target.closest('[data-membership-tab]')) return;
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', ' '].includes(event.key)) return;
      window.requestAnimationFrame(syncMembershipComparisonSections);
    });

    window.addEventListener('hashchange', function () {
      window.requestAnimationFrame(syncMembershipComparisonSections);
    });

    var tabList = document.querySelector('.wa-membership-options__tabs');
    if (tabList && 'MutationObserver' in window) {
      var observer = new MutationObserver(syncMembershipComparisonSections);
      observer.observe(tabList, {
        attributes: true,
        subtree: true,
        attributeFilter: ['aria-selected', 'class']
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      initCompareTables();
      initMembershipComparisonSync();
    });
  } else {
    initCompareTables();
    initMembershipComparisonSync();
  }
})();
