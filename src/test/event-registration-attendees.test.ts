/**
 * Who each seat in an events-widget booking belongs to.
 *
 * The attendee rows shipped as `type="hidden"` inputs inside a `hidden aria-hidden`
 * fieldset, so nobody could ever fill one and `buildBody` fell every row back to the
 * BUYER's own name and email. Choosing two tickets therefore sent the Worker one
 * booking listing the same address twice, and the Worker refuses that: a buyer using a
 * brand-new address, on the module's default settings, was told "this attendee email is
 * already registered for this event". True of nothing, and nothing they could act on.
 *
 * The buyer now takes seat one and every further seat is asked for by name. These tests
 * run the SHIPPED module.js against the SHIPPED module.html row template, because this
 * module is a second implementation of the checkout tunnel's booking contract and the
 * whole class of bug here is the two drifting.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

const MODULE_DIR = resolve(__dirname, '../../theme/modules/event-registration.module')
const JS = readFileSync(resolve(MODULE_DIR, 'module.js'), 'utf8')
const HTML = readFileSync(resolve(MODULE_DIR, 'module.html'), 'utf8')

/** The attendee row markup exactly as the module ships it (no HubL inside it). */
function shippedRowTemplate(): string {
  const match = HTML.match(
    /<template data-evt-attendee-template>([\s\S]*?)<\/template>/
  )
  if (!match?.[1]) throw new Error('attendee row template not found in module.html')
  return match[1]
}

function lift(name: string): string {
  const source = JS.match(
    new RegExp(`EventRegistration\\.prototype\\.${name} = function \\([^)]*\\) \\{[\\s\\S]*?\\n {2}\\}`)
  )?.[0]
  if (!source) throw new Error(`${name} not found in module.js — did the shape change?`)
  return source.replace(`EventRegistration.prototype.${name} = `, '')
}

interface Ticket {
  id: string
  name: string
}

interface Attendee {
  name?: string
  email?: string
  ticketTypeId?: string
}

interface Body {
  buyer: { name: string; email: string; abn?: string }
  ticketTypeId?: string
  attendees?: Attendee[]
}

interface Host {
  form: HTMLFormElement
  cfg: { allowGroup: boolean; maxAttendees: number | null; ticketTypes: Ticket[] }
  seatTicketIds(): string[]
  totalsByTicket(): { byTicket: Record<string, number>; total: number }
  syncAttendees(): void
  buildBody(): Body
  validate(body: Body): string | null
}

const TICKETS: Ticket[] = [
  { id: 'tt-member', name: 'Member' },
  { id: 'tt-public', name: 'Non-member' },
]

function mount(options: { allowGroup?: boolean; maxAttendees?: number | null } = {}): Host {
  const allowGroup = options.allowGroup ?? true
  document.body.innerHTML = `
    <form>
      ${TICKETS.map(
        (t) => `
        <label data-ticket-id="${t.id}">
          <input type="number" name="qty_${t.id}" value="0"
                 max="${allowGroup ? 10 : 1}" data-evt-qty />
        </label>`
      ).join('')}
      <input name="buyer_name" value="" />
      <input name="buyer_email" value="" />
      ${
        allowGroup
          ? `<fieldset data-evt-attendees hidden>
               <div data-evt-attendee-list></div>
               <template data-evt-attendee-template>${shippedRowTemplate()}</template>
             </fieldset>`
          : ''
      }
    </form>`

  const form = document.querySelector('form') as HTMLFormElement
  const host = {
    form,
    cfg: {
      allowGroup,
      maxAttendees: options.maxAttendees ?? (allowGroup ? 10 : 1),
      ticketTypes: TICKETS,
    },
  } as Host

  const factory = new Function(
    'host',
    `host.totalsByTicket = ${lift('totalsByTicket')};
     host.seatTicketIds = ${lift('seatTicketIds')};
     host.syncAttendees = ${lift('syncAttendees')};
     host.buildBody = ${lift('buildBody')};
     host.validate = ${lift('validate')};`
  ) as (h: Host) => void
  factory(host)
  return host
}

function setQty(host: Host, ticketId: string, qty: number) {
  const input = host.form.querySelector<HTMLInputElement>(`[name=qty_${ticketId}]`)!
  input.value = String(qty)
  host.syncAttendees()
}

function setBuyer(host: Host, name: string, email: string) {
  host.form.querySelector<HTMLInputElement>('[name=buyer_name]')!.value = name
  host.form.querySelector<HTMLInputElement>('[name=buyer_email]')!.value = email
}

function fillRow(host: Host, index: number, name: string, email: string) {
  const row = host.form.querySelectorAll<HTMLElement>('[data-evt-attendee]')[index]
  if (!row) throw new Error(`no attendee row at index ${index}`)
  row.querySelector<HTMLInputElement>('[name=attendee_name]')!.value = name
  row.querySelector<HTMLInputElement>('[name=attendee_email]')!.value = email
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('the shipped attendee row markup', () => {
  it('is fillable — the fields are real inputs, not hidden ones', () => {
    const template = shippedRowTemplate()
    expect(template).toMatch(/name="attendee_name"/)
    expect(template).toMatch(/name="attendee_email"/)
    // The whole bug: a hidden input can only ever submit what the page put in it, and
    // the page put the buyer in it.
    expect(template).not.toMatch(/type="hidden"/)
  })

  it('requires both fields, so a nameless second seat cannot be submitted', () => {
    const template = shippedRowTemplate()
    expect(template.match(/required/g)?.length).toBe(2)
  })
})

describe('seat → person mapping', () => {
  it('asks for nobody when the buyer takes the only seat', () => {
    const host = mount()
    setQty(host, 'tt-member', 1)
    expect(host.form.querySelectorAll('[data-evt-attendee]')).toHaveLength(0)
    expect(host.form.querySelector<HTMLElement>('[data-evt-attendees]')!.hidden).toBe(true)
  })

  it('uses the single-seat shorthand for one seat, not a one-entry attendees array', () => {
    const host = mount()
    setBuyer(host, 'Ryan Jones', 'ryan@example.com')
    setQty(host, 'tt-member', 1)
    const body = host.buildBody()
    expect(body.ticketTypeId).toBe('tt-member')
    expect(body.attendees).toBeUndefined()
  })

  it('asks for one person per seat BEYOND the first', () => {
    const host = mount()
    setQty(host, 'tt-member', 3)
    expect(host.form.querySelectorAll('[data-evt-attendee]')).toHaveLength(2)
    expect(host.form.querySelector<HTMLElement>('[data-evt-attendees]')!.hidden).toBe(false)
  })

  it('numbers the rows from place two, because the buyer holds place one', () => {
    const host = mount()
    setQty(host, 'tt-member', 3)
    const headings = [...host.form.querySelectorAll('[data-evt-attendee-heading]')].map(
      (el) => el.textContent
    )
    expect(headings).toEqual(['Place 2 of 3', 'Place 3 of 3'])
  })

  it('gives the buyer seat one and the typed people the rest', () => {
    const host = mount()
    setBuyer(host, 'Ryan Jones', 'ryan@example.com')
    setQty(host, 'tt-member', 2)
    fillRow(host, 0, 'Sam Lee', 'sam@example.com')
    const body = host.buildBody()
    expect(body.attendees).toEqual([
      { name: 'Ryan Jones', email: 'ryan@example.com', ticketTypeId: 'tt-member' },
      { name: 'Sam Lee', email: 'sam@example.com', ticketTypeId: 'tt-member' },
    ])
  })

  it('never expands a quantity into N copies of the buyer', () => {
    const host = mount()
    setBuyer(host, 'Ryan Jones', 'ryan@example.com')
    setQty(host, 'tt-member', 2)
    const emails = host.buildBody().attendees!.map((a) => a.email)
    // Leaving the row blank must not silently resend the buyer: that is the 409.
    expect(emails.filter((e) => e === 'ryan@example.com')).toHaveLength(1)
  })

  it('carries each seat its own ticket type across two ticket types', () => {
    const host = mount()
    setBuyer(host, 'Ryan Jones', 'ryan@example.com')
    setQty(host, 'tt-member', 1)
    setQty(host, 'tt-public', 1)
    fillRow(host, 0, 'Sam Lee', 'sam@example.com')
    const body = host.buildBody()
    expect(body.attendees!.map((a) => a.ticketTypeId)).toEqual(['tt-member', 'tt-public'])
  })

  it('drops rows again when the quantity comes back down', () => {
    const host = mount()
    setQty(host, 'tt-member', 3)
    setQty(host, 'tt-member', 1)
    expect(host.form.querySelectorAll('[data-evt-attendee]')).toHaveLength(0)
    expect(host.form.querySelector<HTMLElement>('[data-evt-attendees]')!.hidden).toBe(true)
  })

  it('caps the seats it asks about at maxAttendees', () => {
    const host = mount({ maxAttendees: 2 })
    setQty(host, 'tt-member', 5)
    expect(host.seatTicketIds()).toHaveLength(2)
    expect(host.form.querySelectorAll('[data-evt-attendee]')).toHaveLength(1)
  })
})

describe('validation', () => {
  it('refuses a booking with nothing chosen', () => {
    const host = mount()
    setBuyer(host, 'Ryan Jones', 'ryan@example.com')
    expect(host.validate(host.buildBody())).toMatch(/at least one ticket/i)
  })

  it('names the missing person rather than letting the Worker refuse a duplicate', () => {
    const host = mount()
    setBuyer(host, 'Ryan Jones', 'ryan@example.com')
    setQty(host, 'tt-member', 2)
    expect(host.validate(host.buildBody())).toMatch(/name and email for every place/i)
  })

  it('refuses the same address twice, and says which one', () => {
    const host = mount()
    setBuyer(host, 'Ryan Jones', 'ryan@example.com')
    setQty(host, 'tt-member', 2)
    fillRow(host, 0, 'Ryan Jones', 'RYAN@example.com')
    const message = host.validate(host.buildBody())
    expect(message).toMatch(/its own email address/i)
    expect(message).toContain('RYAN@example.com')
  })

  it('passes a properly named group booking', () => {
    const host = mount()
    setBuyer(host, 'Ryan Jones', 'ryan@example.com')
    setQty(host, 'tt-member', 2)
    fillRow(host, 0, 'Sam Lee', 'sam@example.com')
    expect(host.validate(host.buildBody())).toBeNull()
  })

  it('with group booking off, refuses more than one seat instead of duplicating the buyer', () => {
    const host = mount({ allowGroup: false })
    setBuyer(host, 'Ryan Jones', 'ryan@example.com')
    setQty(host, 'tt-member', 1)
    setQty(host, 'tt-public', 1)
    const body = host.buildBody()
    expect(body.attendees).toBeUndefined()
    expect(host.validate(body)).toMatch(/one place per booking/i)
  })

  it('with group booking off, a single seat still books', () => {
    const host = mount({ allowGroup: false })
    setBuyer(host, 'Ryan Jones', 'ryan@example.com')
    setQty(host, 'tt-public', 1)
    const body = host.buildBody()
    expect(body.ticketTypeId).toBe('tt-public')
    expect(host.validate(body)).toBeNull()
  })
})

describe('the quantity input the template renders', () => {
  it('caps at one per ticket type when group booking is off', () => {
    // The HubL that decides it, read off the shipped template: with no attendee rows
    // there is nowhere to name a second person.
    expect(HTML).toMatch(
      /_evt_qty_max = module\.registration\.allow_group \? \(t\.max_per_order \| default\(10, true\)\) : 1/
    )
    expect(HTML).toMatch(/max="\{\{ _evt_qty_max \}\}"/)
  })
})
