/*
 * event-registration - module.js
 *
 * Ported from events-engine (packages/hubspot) for the Weld Australia theme.
 * Tenant-agnostic and config-driven - all connection details come from the
 * [data-evt-config] JSON block emitted by module.html. Nothing here is portal-
 * or event-specific.
 *
 * Behaviour:
 *   1. Read live availability from the WORKER (never HubDB counts).
 *   2. Build a reserve request and POST it with a stable Idempotency-Key.
 *   3. Branch on the worker's response: waitlisted | confirmed | reserved.
 *   4. For `reserved`, poll GET /api/v1/orders/:id until a paymentUrl appears, then
 *      redirect to the HubSpot-hosted invoice.
 */
;(function () {
  'use strict'

  // The worker holds a reserved ticket for ~15 minutes. When that hold lapses
  // (or the order is gone) the buyer sees this instead of a raw worker error.
  var RESERVATION_EXPIRED_MESSAGE =
    'Your reservation has expired. We hold your place for about 15 minutes - you haven’t been charged. Please start again to book.'

  // Defensive, case-insensitive check for a lapsed reservation/hold or a gone
  // order. Mirrors isReservationExpired() in src/shared/api/eventEngine.ts.
  // Note: waitlist-offer statuses (offer_expired/offer_not_open/offer_seat_taken)
  // are intentionally NOT treated here - they have their own copy.
  function isExpiredStatus(status) {
    if (!status) return false
    var key = String(status)
      .toLowerCase()
      .replace(/[\s-]+/g, '_')
    return (
      [
        'expired',
        'cancelled',
        'canceled',
        'reservation_expired',
        'session_expired',
        'hold_expired',
        'order_expired',
        'not_found',
        'order_not_found',
        'session_not_found',
        'reservation_not_found'
      ].indexOf(key) !== -1
    )
  }

  var TURNSTILE_SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
  var turnstileScriptPromise = null

  function ensureTurnstileScript() {
    if (window.turnstile) return Promise.resolve()
    if (turnstileScriptPromise) return turnstileScriptPromise

    turnstileScriptPromise = new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-wa-turnstile]')
      if (existing) {
        existing.addEventListener(
          'load',
          function () {
            resolve()
          },
          { once: true }
        )
        existing.addEventListener(
          'error',
          function () {
            reject(new Error('turnstile_script_failed'))
          },
          { once: true }
        )
        return
      }

      var script = document.createElement('script')
      script.src = TURNSTILE_SCRIPT_SRC
      script.async = true
      script.defer = true
      script.setAttribute('data-wa-turnstile', 'true')
      script.onload = function () {
        resolve()
      }
      script.onerror = function () {
        reject(new Error('turnstile_script_failed'))
      }
      document.head.appendChild(script)
    })

    return turnstileScriptPromise
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID()
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0
      var v = c === 'x' ? r : (r & 0x3) | 0x8
      return v.toString(16)
    })
  }

  function EventRegistration(form) {
    var cfgEl = form.querySelector('[data-evt-config]')
    if (!cfgEl) return
    var cfg
    try {
      cfg = JSON.parse(cfgEl.textContent)
    } catch (e) {
      return
    }

    this.form = form
    this.cfg = cfg
    this.statusEl = form.querySelector('[data-evt-status]')
    this.submitBtn = form.querySelector('[data-evt-submit]')
    this.turnstileEl = form.querySelector('[data-evt-turnstile]')
    this.turnstileWidgetEl = form.querySelector('[data-evt-turnstile-widget]')
    this.turnstileWidgetId = null
    this.turnstileToken = ''
    this.ticketById = {}
    ;(cfg.ticketTypes || []).forEach(function (t) {
      this.ticketById[t.id] = t
    }, this)

    // Reuse one Idempotency-Key for retries of the SAME logical submission. Cleared on a
    // terminal outcome so the next genuine attempt gets a fresh key.
    // The Idempotency-Key's storage scope is computed per SUBMISSION, not here: see
    // scopeKeyFor() below. It used to be 'evt-idem:' + workerEventId, i.e. the event
    // alone, which is the Ref 40 item 5 defect.
    this.idemScopeKey = null
    this.idempotencyKey = null
    this.submitting = false

    if (!cfg.workerBaseUrl || !cfg.workerEventId) {
      // Misconfigured - leave the server-rendered notice in place, disable submit.
      if (this.submitBtn) this.submitBtn.disabled = true
      return
    }

    this.bind()
    this.loadAvailability()
    this.syncAttendees()
    this.syncTurnstile()
  }

  EventRegistration.prototype.url = function (key, params) {
    var path = this.cfg.endpoints[key]
    Object.keys(params || {}).forEach(function (k) {
      path = path.replace('{' + k + '}', encodeURIComponent(params[k]))
    })
    return this.cfg.workerBaseUrl.replace(/\/$/, '') + path
  }

  EventRegistration.prototype.headers = function (extra) {
    var h = { 'X-Portal-Id': this.cfg.portalId }
    Object.keys(extra || {}).forEach(function (k) {
      h[k] = extra[k]
    })
    return h
  }

  EventRegistration.prototype.setStatus = function (msg, kind) {
    if (!this.statusEl) return
    this.statusEl.hidden = !msg
    this.statusEl.textContent = msg || ''
    this.statusEl.dataset.kind = kind || ''
  }

  EventRegistration.prototype.bind = function () {
    var self = this
    this.form.addEventListener('submit', function (e) {
      e.preventDefault()
      self.submit()
    })
    this.form.querySelectorAll('[data-evt-qty]').forEach(function (input) {
      input.addEventListener('change', function () {
        self.syncAttendees()
        self.syncTurnstile()
      })
      input.addEventListener('input', function () {
        self.syncAttendees()
        self.syncTurnstile()
      })
    })
  }

  // --- 1. Live availability from the worker --------------------------------
  EventRegistration.prototype.loadAvailability = function () {
    var self = this
    fetch(this.url('availability', { slug: this.cfg.workerEventId }), {
      method: 'GET',
      headers: this.headers(),
      credentials: 'omit'
    })
      .then(function (r) {
        return r.ok ? r.json() : Promise.reject(r)
      })
      .then(function (data) {
        self.applyAvailability(data)
      })
      .catch(function () {
        // Availability is advisory for the UI; the worker is still authoritative at
        // reserve time. Let the buyer try rather than blocking on a transient read error.
        self.form.querySelectorAll('[data-evt-avail]').forEach(function (el) {
          el.textContent = ''
        })
      })
  }

  EventRegistration.prototype.applyAvailability = function (data) {
    var byId = {}
    ;((data && data.ticketTypes) || []).forEach(function (t) {
      byId[t.ticketTypeId] = t
    })
    this.availability = byId

    this.form.querySelectorAll('[data-ticket-id]').forEach(function (row) {
      var id = row.getAttribute('data-ticket-id')
      var a = byId[id]
      var availEl = row.querySelector('[data-evt-avail]')
      var qty = row.querySelector('[data-evt-qty]')
      if (!a) {
        if (availEl) availEl.textContent = ''
        return
      }

      if (a.soldOut) {
        if (availEl) {
          availEl.textContent = a.waitlistAvailable ? 'Sold out - join the waitlist' : 'Sold out'
          availEl.dataset.state = 'soldout'
        }
        if (qty && !a.waitlistAvailable) {
          qty.value = '0'
          qty.disabled = true
        }
      } else if (typeof a.available === 'number' && a.available <= 5) {
        if (availEl) {
          availEl.textContent = 'Limited places remaining'
          availEl.dataset.state = 'limited'
        }
      } else if (availEl) {
        availEl.textContent = 'Places available'
        availEl.dataset.state = 'available'
      }
    })
    this.syncAttendees()
  }

  // --- Group registration: keep attendee rows in step with chosen quantities ----
  EventRegistration.prototype.totalsByTicket = function () {
    var totals = {}
    var total = 0
    this.form.querySelectorAll('[data-evt-qty]').forEach(function (input) {
      var id = input.closest('[data-ticket-id]').getAttribute('data-ticket-id')
      var n = parseInt(input.value, 10) || 0
      if (n > 0) {
        totals[id] = n
        total += n
      }
    })
    return { byTicket: totals, total: total }
  }

  EventRegistration.prototype.requiresTurnstile = function () {
    // Challenge every public registration, paid or free. This used to fire only when a
    // paid event had a zero-cost selection, so paid registrations posted no token at all.
    // The Worker now requires one for every public reservation (a paid booking holds its
    // seat to the invoice due date, not for 15 minutes), and this module posts straight to
    // the same /reserve endpoint as the checkout tunnel — so without this it would take
    // 403 turnstile_required on every paid registration from an event detail page.
    return Boolean(this.cfg.turnstileSiteKey)
  }

  EventRegistration.prototype.resetTurnstile = function () {
    this.turnstileToken = ''
    if (this.turnstileWidgetId !== null && window.turnstile && window.turnstile.reset) {
      try {
        window.turnstile.reset(this.turnstileWidgetId)
      } catch (e) {}
    }
  }

  EventRegistration.prototype.syncTurnstile = function () {
    var self = this
    var required = this.requiresTurnstile()
    if (!this.turnstileEl) return

    this.turnstileEl.hidden = !required
    if (!required) {
      this.resetTurnstile()
      return
    }
    if (this.turnstileWidgetId !== null || !this.turnstileWidgetEl) return

    ensureTurnstileScript()
      .then(function () {
        if (!window.turnstile || self.turnstileWidgetId !== null || !self.turnstileWidgetEl) return
        self.turnstileWidgetId = window.turnstile.render(self.turnstileWidgetEl, {
          sitekey: self.cfg.turnstileSiteKey,
          callback: function (token) {
            self.turnstileToken = token || ''
            if (self.statusEl && self.statusEl.dataset.kind === 'error') self.setStatus('', '')
          },
          'expired-callback': function () {
            self.turnstileToken = ''
            self.setStatus('Security check expired. Please verify again.', 'error')
          },
          'error-callback': function () {
            self.turnstileToken = ''
            self.setStatus('Security check could not be completed. Please try again.', 'error')
          }
        })
      })
      .catch(function () {
        self.setStatus('Security check could not load. Please refresh and try again.', 'error')
      })
  }

  /**
   * The chosen quantities, flattened into one ticket type id per seat and capped at
   * `maxAttendees`.
   *
   * Shared by the form rendering and the request builder deliberately: the two used to
   * flatten the same quantities separately, which is how the number of attendee rows on
   * screen could stop matching the number of seats in the body.
   */
  EventRegistration.prototype.seatTicketIds = function () {
    var totals = this.totalsByTicket()
    var seats = []
    Object.keys(totals.byTicket).forEach(function (id) {
      for (var i = 0; i < totals.byTicket[id]; i++) seats.push(id)
    })
    if (this.cfg.maxAttendees) seats = seats.slice(0, this.cfg.maxAttendees)
    return seats
  }

  /**
   * Render one attendee row per seat BEYOND the first. The buyer takes seat one.
   *
   * The rows used to be hidden inputs nobody could fill, so every seat went to the
   * Worker carrying the buyer's own email and a two-ticket booking was refused as a
   * duplicate attendee. A second seat is a second person, so it gets asked for.
   */
  EventRegistration.prototype.syncAttendees = function () {
    var list = this.form.querySelector('[data-evt-attendee-list]')
    var tpl = this.form.querySelector('[data-evt-attendee-template]')
    var wrap = this.form.querySelector('[data-evt-attendees]')
    if (!list || !tpl || !this.cfg.allowGroup) return

    var seats = this.seatTicketIds()
    var extra = seats.slice(1)

    var rows = list.querySelectorAll('[data-evt-attendee]')
    // Add missing rows.
    for (var i = rows.length; i < extra.length; i++) {
      var frag = tpl.content.cloneNode(true)
      var select = frag.querySelector('[data-evt-attendee-ticket]')
      this.cfg.ticketTypes.forEach(function (t) {
        var opt = document.createElement('option')
        opt.value = t.id
        opt.textContent = t.name
        select.appendChild(opt)
      })
      list.appendChild(frag)
    }
    // Remove surplus rows.
    rows = list.querySelectorAll('[data-evt-attendee]')
    for (var j = rows.length - 1; j >= extra.length; j--) rows[j].remove()
    // Label each row and default its ticket select to the seat's ticket type.
    rows = list.querySelectorAll('[data-evt-attendee]')
    extra.forEach(function (ticketId, idx) {
      var row = rows[idx]
      if (!row) return
      var heading = row.querySelector('[data-evt-attendee-heading]')
      if (heading) heading.textContent = 'Place ' + (idx + 2) + ' of ' + seats.length
      var sel = row.querySelector('[data-evt-attendee-ticket]')
      if (sel && !sel.dataset.touched) {
        sel.value = ticketId
        sel.addEventListener('change', function () {
          sel.dataset.touched = '1'
        })
      }
    })
    // A single-seat booking has no extra people to name, and a second set of name/email
    // fields there is only a way to disagree with yourself.
    if (wrap) wrap.hidden = extra.length === 0
  }

  // --- 2/3. Build + send the reserve request -------------------------------
  EventRegistration.prototype.buildBody = function () {
    var self = this
    var buyerName = (this.form.querySelector('[name=buyer_name]') || {}).value || ''
    var buyerEmail = (this.form.querySelector('[name=buyer_email]') || {}).value || ''
    var abnEl = this.form.querySelector('[name=buyer_abn]')
    var buyer = { name: buyerName.trim(), email: buyerEmail.trim() }
    if (abnEl && abnEl.value.trim()) buyer.abn = abnEl.value.replace(/\s+/g, '')

    var body = { buyer: buyer }

    // The buyer takes seat one; each further seat is the person named in its row.
    // Never expand a quantity into N copies of the buyer: the Worker refuses an email
    // listed twice in one booking, so that turned a two-ticket order into "this
    // attendee email is already registered for this event" on a brand-new address.
    var seats = self.seatTicketIds()
    var attendeeRows = this.form.querySelectorAll('[data-evt-attendee]')
    if (this.cfg.allowGroup && attendeeRows.length > 0) {
      body.attendees = [{ name: buyer.name, email: buyer.email, ticketTypeId: seats[0] }]
      attendeeRows.forEach(function (row, idx) {
        var name = (row.querySelector('[name=attendee_name]') || {}).value || ''
        var email = (row.querySelector('[name=attendee_email]') || {}).value || ''
        var ticket = (row.querySelector('[data-evt-attendee-ticket]') || {}).value || ''
        body.attendees.push({
          name: name.trim(),
          email: email.trim(),
          ticketTypeId: ticket || seats[idx + 1]
        })
      })
    } else {
      // One seat, or group booking switched off entirely. `validate` refuses more than
      // one seat on the non-group path rather than guessing at a second person.
      body.ticketTypeId = seats[0]
    }
    return body
  }

  EventRegistration.prototype.validate = function (body) {
    if (!body.buyer.name || !body.buyer.email) return 'Please enter your name and email.'
    var totals = this.totalsByTicket()
    if (totals.total === 0) return 'Please choose at least one ticket.'
    if (!this.cfg.allowGroup && totals.total > 1) {
      // With group booking off there is nowhere to name the other people, and every
      // extra seat would carry the buyer's own email into a booking the Worker refuses.
      return 'This form takes one place per booking. Please book the other places separately.'
    }
    if (body.attendees) {
      // Every place needs its own person. Checked here to save the buyer a round trip;
      // the Worker is the gate and refuses a repeated email by name either way.
      var seen = {}
      for (var i = 0; i < body.attendees.length; i++) {
        var a = body.attendees[i]
        if (!a.ticketTypeId) return 'Please choose a ticket for every place.'
        if (!a.name || !a.email) return 'Please enter a name and email for every place.'
        var key = a.email.trim().toLowerCase()
        if (seen[key]) {
          return 'Each place needs its own email address. "' + a.email.trim() + '" is listed more than once.'
        }
        seen[key] = true
      }
    } else if (!body.ticketTypeId) {
      return 'Please choose a ticket.'
    }
    return null
  }

  // FNV-1a, hex. Mirrors fingerprint() in src/shared/api/eventEngine.ts; nothing here
  // is a security boundary, it just has to be short and stable.
  function fingerprint(value) {
    var hash = 0x811c9dc5
    for (var i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i)
      hash = Math.imul(hash, 0x01000193)
    }
    return (hash >>> 0).toString(16)
  }

  /**
   * The sessionStorage scope for one submission's Idempotency-Key.
   *
   * The worker REPLAYS a stored response verbatim for a repeated key, so the scope is
   * the whole question. Scoped to the event alone - which this module still was - a
   * buyer who timed out on "your place is held", went back, typed a different email
   * and submitted again was handed the FIRST booking's response, with their new
   * details discarded. That is Ref 40 item 5, fixed in the React checkout tunnel
   * (reservationScope in src/shared/api/eventEngine.ts) and never ported here. Two
   * implementations of one booking contract, and the fix reached one of them.
   *
   * So the scope carries what makes a booking a DIFFERENT booking rather than a retry
   * of this one: who is buying, and what. Deliberately NOT the buyer's name or their
   * ABN - correcting a typo there and resubmitting is the same booking, and a fresh
   * key would take a second seat.
   *
   * Attendee emails ARE included on the group path, for the same reason the buyer's is:
   * they decide who holds a seat and whose name goes on a ticket. The cost is that
   * correcting an attendee's address takes a second hold rather than replacing the
   * first, which lapses on its own TTL; being handed someone else's booking does not
   * lapse.
   */
  EventRegistration.prototype.scopeKeyFor = function (body) {
    var parts = [
      this.cfg.workerEventId || '',
      ((body.buyer && body.buyer.email) || '').trim().toLowerCase(),
      body.ticketTypeId || ''
    ]
    if (body.attendees) {
      parts.push(
        body.attendees
          .map(function (attendee) {
            return (attendee.email || '').trim().toLowerCase() + ':' + (attendee.ticketTypeId || '')
          })
          .join(',')
      )
    }
    return 'evt-idem:' + this.cfg.workerEventId + ':' + fingerprint(parts.join('|'))
  }

  EventRegistration.prototype.getIdempotencyKey = function (body) {
    // Recompute the scope on every submission: the buyer can edit the form between
    // attempts, and that edit is exactly what has to produce a different key.
    var scopeKey = this.scopeKeyFor(body)
    if (scopeKey !== this.idemScopeKey) {
      this.idemScopeKey = scopeKey
      this.idempotencyKey = null
    }
    if (this.idempotencyKey) return this.idempotencyKey

    var stored = null
    try {
      stored = sessionStorage.getItem(scopeKey)
    } catch (e) {}
    this.idempotencyKey = stored || uuid()
    try {
      sessionStorage.setItem(scopeKey, this.idempotencyKey)
    } catch (e) {}
    return this.idempotencyKey
  }

  EventRegistration.prototype.clearIdempotencyKey = function () {
    this.idempotencyKey = null
    if (this.idemScopeKey) {
      try {
        sessionStorage.removeItem(this.idemScopeKey)
      } catch (e) {}
    }
    this.idemScopeKey = null
  }

  EventRegistration.prototype.submit = function () {
    if (this.submitting) return
    var self = this
    var body = this.buildBody()
    var err = this.validate(body)
    if (err) {
      this.setStatus(err, 'error')
      return
    }

    if (this.requiresTurnstile()) {
      this.syncTurnstile()
      if (!this.turnstileToken) {
        this.setStatus('Please complete the security check before registering.', 'error')
        return
      }
      body.turnstileToken = this.turnstileToken
    }

    this.submitting = true
    this.form.setAttribute('aria-busy', 'true')
    if (this.submitBtn) this.submitBtn.disabled = true
    this.setStatus('Reserving your place…', 'pending')

    fetch(this.url('reserve', { slug: this.cfg.workerEventId }), {
      method: 'POST',
      headers: this.headers({
        'Content-Type': 'application/json',
        'Idempotency-Key': this.getIdempotencyKey(body)
      }),
      credentials: 'omit',
      body: JSON.stringify(body)
    })
      // Ref 217: `r.json()` used to run unconditionally, so a Worker 5xx with a
      // plain-text body (what an unhandled Worker exception returns) rejected here
      // and surfaced as one generic sentence. Parse defensively and classify
      // instead, so the buyer is told which failure happened. Mirrors
      // reserveSeat() in src/shared/api/eventEngine.ts.
      .then(function (r) {
        return r.text().then(function (text) {
          var json
          try {
            json = JSON.parse(text)
          } catch (e) {
            json = {
              status: 'server_error',
              httpStatus: r.status,
              rawBody: String(text).slice(0, 500)
            }
          }
          return { ok: r.ok, status: r.status, json: json }
        })
      })
      .then(function (res) {
        return self.handleReserveResponse(res)
      })
      .catch(function (err) {
        // fetch itself rejected: offline, DNS, TLS, or a CORS rejection (the
        // browser never says which). The cause reaches the console either way.
        if (window.console && console.error) {
          console.error('[event-registration] reserve failed', {
            reason: 'transport_error',
            workerBaseUrl: self.cfg && self.cfg.workerBaseUrl,
            workerEventId: self.cfg && self.cfg.workerEventId,
            error: err
          })
        }
        self.finishAttempt()
        self.setStatus(
          'We couldn’t reach the booking service. Check your internet connection and try again.',
          'error'
        )
      })
  }

  EventRegistration.prototype.handleReserveResponse = function (res) {
    var j = res.json || {}
    switch (j.status) {
      case 'waitlisted':
        this.clearIdempotencyKey()
        this.resetTurnstile()
        this.finishAttempt(true)
        this.setStatus(this.cfg.copy.waitlisted, 'waitlisted')
        return

      case 'confirmed':
        this.clearIdempotencyKey()
        this.finishAttempt(true)
        this.setStatus(this.cfg.copy.confirmed, 'confirmed')
        return

      case 'reserved':
        // Paid: a deal + HubSpot invoice are being created asynchronously. Poll the order
        // until the payment link is ready, then hand off to the HubSpot-hosted invoice.
        this.setStatus('Place held - preparing your invoice…', 'pending')
        this.pollOrder(j.orderId || (j.pollUrl || '').split('/').pop())
        return

      default:
        // ReserveError shapes: members_only, membership_unverified, offer_expired, etc.
        // 'server_error' is different: the response body wasn't JSON, so the POST may
        // have committed server-side and we simply lost the answer. Keep the
        // idempotency key in that case so a retry replays the worker's stored
        // response instead of creating a second hold/order/invoice. Mirrors the
        // ambiguous-outcome rule in CheckoutTunnel.tsx.
        if (j.status === 'server_error') {
          if (window.console && console.error) {
            console.error('[event-registration] reserve failed', {
              reason: 'server_error',
              httpStatus: j.httpStatus,
              rawBody: j.rawBody,
              workerBaseUrl: this.cfg && this.cfg.workerBaseUrl,
              workerEventId: this.cfg && this.cfg.workerEventId
            })
          }
        } else {
          this.clearIdempotencyKey()
          this.resetTurnstile()
        }
        this.finishAttempt()
        this.setStatus(this.friendlyError(j), 'error')
    }
  }

  EventRegistration.prototype.friendlyError = function (j) {
    // Classify a lapsed reservation/hold first so an expiry/not-found status
    // never leaks the raw worker message (e.g. "session not found").
    if (j && isExpiredStatus(j.status)) {
      return (this.cfg.copy && this.cfg.copy.expired) || RESERVATION_EXPIRED_MESSAGE
    }
    switch (j && j.status) {
      case 'server_error':
        return (
          'The booking service couldn’t complete your registration' +
          (j.httpStatus ? ' (error ' + j.httpStatus + ')' : '') +
          '. Please try again in a moment.'
        )
      case 'members_only':
        return 'This ticket is for members only.'
      case 'membership_unverified':
        return 'We couldn’t verify your membership. Please contact support.'
      case 'turnstile_required':
      case 'turnstile_failed':
        return 'Please complete the security check and try again.'
      case 'ticket_not_available':
        return 'This ticket type is not available for public registration.'
      case 'offer_expired':
      case 'offer_not_open':
      case 'offer_seat_taken':
        return 'That waitlist offer is no longer available.'
      default:
        return (j && j.message) || 'We couldn’t complete your registration. Please try again.'
    }
  }

  // --- 4. Poll the order until the invoice payment link is ready -----------
  EventRegistration.prototype.pollOrder = function (orderId) {
    if (!orderId) {
      this.finishAttempt()
      this.setStatus('Reserved, but we lost track of your order. Please contact support.', 'error')
      return
    }
    var self = this
    var attempts = 0
    var maxAttempts = 40 // ~2 minutes at 3s
    var intervalMs = 3000

    ;(function tick() {
      attempts++
      fetch(self.url('order', { id: orderId }), {
        method: 'GET',
        headers: self.headers(),
        credentials: 'omit'
      })
        // A non-OK read (incl. a transient 404 while a fresh order settles) is
        // tolerated: reject → retry. Expiry is concluded only from an explicit
        // terminal status in the body, never from a bare 404.
        .then(function (r) {
          return r.ok ? r.json() : Promise.reject(r)
        })
        .then(function (order) {
          if (order.paymentUrl) {
            // Terminal success - the seat hold is consumed by payment, not here.
            self.clearIdempotencyKey()
            self.setStatus('Redirecting you to payment…', 'confirmed')
            window.location.assign(order.paymentUrl)
            return
          }
          if (isExpiredStatus(order.status)) {
            self.clearIdempotencyKey()
            self.finishAttempt()
            self.setStatus(self.friendlyError({ status: 'expired' }), 'error')
            return
          }
          if (attempts >= maxAttempts) {
            self.finishAttempt()
            self.setStatus('Your place is held. We’ll email your invoice shortly.', 'pending')
            return
          }
          setTimeout(tick, intervalMs)
        })
        .catch(function () {
          if (attempts >= maxAttempts) {
            self.finishAttempt()
            self.setStatus('Your place is held. We’ll email your invoice shortly.', 'pending')
            return
          }
          setTimeout(tick, intervalMs)
        })
    })()
  }

  EventRegistration.prototype.finishAttempt = function (lock) {
    this.submitting = false
    this.form.removeAttribute('aria-busy')
    if (this.submitBtn) this.submitBtn.disabled = !!lock
  }

  function init() {
    document.querySelectorAll('[data-evt-reg]').forEach(function (form) {
      if (form.dataset.evtInit) return
      form.dataset.evtInit = '1'
      new EventRegistration(form)
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
