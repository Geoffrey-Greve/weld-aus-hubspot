/*
 * Keeps the a11y fixtures' session dates in the future.
 *
 * These harness pages carry hard-coded ISO dates, and the site now treats a session whose
 * start date has passed as closed (CLAUDE.md § 7.6): the Register button becomes a disabled
 * "Registrations closed" label. So a fixture written with dates in August 2026 quietly
 * stopped being a fixture for an AVAILABLE session the moment August went by, and the
 * keyboard-focus suite started failing for a reason that had nothing to do with the code.
 *
 * Every `*_date` in every `data-props` blob is shifted forward by ONE constant number of
 * days, chosen to put the earliest of them 30 days from today. Constant, so the gaps
 * between sessions, their ordering and which one each assertion means are all preserved;
 * and a no-op once the fixture's own dates are already in the future, so this never fights
 * a fixture someone deliberately dated.
 *
 * Classic script, not a module: it has to finish before the deferred island bundle reads
 * `data-props`.
 */
;(function () {
  var DAY_MS = 86400000

  function isDateKey(key) {
    return /_date$/.test(key)
  }

  function parseDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? Date.UTC(+value.slice(0, 4), +value.slice(5, 7) - 1, +value.slice(8, 10))
      : null
  }

  function format(ms) {
    return new Date(ms).toISOString().slice(0, 10)
  }

  /** Visit every `*_date` string anywhere in the structure. */
  function walk(node, visit) {
    if (Array.isArray(node)) {
      node.forEach(function (item) {
        walk(item, visit)
      })
      return
    }
    if (!node || typeof node !== 'object') return
    Object.keys(node).forEach(function (key) {
      if (isDateKey(key) && parseDate(node[key]) !== null) {
        visit(node, key)
      } else {
        walk(node[key], visit)
      }
    })
  }

  var today = new Date()
  var todayMs = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())

  Array.prototype.forEach.call(document.querySelectorAll('[data-props]'), function (mount) {
    var props
    try {
      props = JSON.parse(mount.getAttribute('data-props'))
    } catch (error) {
      return
    }

    var earliest = null
    walk(props, function (owner, key) {
      var ms = parseDate(owner[key])
      if (earliest === null || ms < earliest) earliest = ms
    })
    if (earliest === null) return

    var shift = todayMs + 30 * DAY_MS - earliest
    if (shift <= 0) return

    walk(props, function (owner, key) {
      owner[key] = format(parseDate(owner[key]) + shift)
    })
    mount.setAttribute('data-props', JSON.stringify(props))
  })
})()
