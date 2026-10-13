import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Deep-link + Soldamatic-only field behaviour for contact-form.module.
 * Defect 62: ?enquiry= / ?topic= must preselect hs_ticket_category and land on #enquiry.
 * Soldamatic machine number must stay hidden on the General enquiry tab.
 */

const MODULE_JS = readFileSync(
  resolve(__dirname, '../../theme/modules/contact-form.module/module.js'),
  'utf8'
)

const CATEGORY_OPTIONS = [
  'New business',
  'Training & courses',
  'Machine repair & servicing',
  'Qualification, certification & exams',
  'Engineering services',
  'Membership',
  'Marketing, communications & events',
  'Finance',
  'General enquiry'
]

function renderForm(): string {
  const options = CATEGORY_OPTIONS.map(
    (label) => `<option value="${label}">${label}</option>`
  ).join('')

  return `
    <section class="wa-contact-form" id="enquiry" data-portal-id="1" data-form-id="abc"
      data-soldamatic='{"generalLabel":"General enquiry","soldamaticLabel":"Soldamatic support","showCompanyOnGeneral":false}'>
      <form class="wa-contact-form__form">
        <div class="wa-cf-mode-tabs" role="tablist">
          <button type="button" class="wa-cf-mode-tab is-active" data-wa-form-mode="general" role="tab" aria-selected="true">General enquiry</button>
          <button type="button" class="wa-cf-mode-tab" data-wa-form-mode="soldamatic" role="tab" aria-selected="false">Soldamatic support</button>
        </div>
        <input type="hidden" name="form_mode" value="general">
        <div class="wa-cf-field" data-wa-general-only>
          <select name="hs_ticket_category" required>
            <option value="">Select a topic…</option>
            ${options}
          </select>
        </div>
        <div class="wa-cf-field" data-wa-soldamatic-only hidden>
          <input type="text" name="soldamatic_machine_number" data-wa-soldamatic-required>
        </div>
        <textarea name="message" required></textarea>
        <button type="submit"><span class="wa-cf-submit-label">Send enquiry</span></button>
        <div class="wa-cf-error-msg"></div>
      </form>
      <div class="wa-contact-form__success" aria-hidden="true">
        <h3 class="wa-contact-form__success-title"></h3>
        <div class="wa-contact-form__success-body"></div>
        <button type="button" class="wa-contact-form__reset">Send another enquiry</button>
      </div>
    </section>
  `
}

function loadModule(): void {
  // eslint-disable-next-line no-new-func
  new Function(MODULE_JS)()
  // Flush scrollToSection's setTimeout(…, 50) before the jsdom env is torn down.
  vi.advanceTimersByTime(100)
}

describe('contact-form deep links', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    document.body.innerHTML = ''
    window.scrollTo = vi.fn()
    vi.stubGlobal(
      'getComputedStyle',
      () => ({ getPropertyValue: () => '110px' }) as unknown as CSSStyleDeclaration
    )
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    document.body.innerHTML = ''
    window.history.replaceState(null, '', '/contact-us')
    vi.restoreAllMocks()
  })

  it('preselects Membership from ?enquiry=Membership#enquiry', () => {
    window.history.replaceState(null, '', '/contact-us?enquiry=Membership#enquiry')
    document.body.innerHTML = renderForm()
    loadModule()

    const select = document.querySelector('[name="hs_ticket_category"]') as HTMLSelectElement
    expect(select.value).toBe('Membership')
  })

  it('resolves short aliases like ?topic=certification', () => {
    window.history.replaceState(null, '', '/contact-us?topic=certification#enquiry')
    document.body.innerHTML = renderForm()
    loadModule()

    const select = document.querySelector('[name="hs_ticket_category"]') as HTMLSelectElement
    expect(select.value).toBe('Qualification, certification & exams')
  })

  it('matches Training & courses when the URL encodes the ampersand', () => {
    window.history.replaceState(
      null,
      '',
      '/contact-us?enquiry=Training%20%26%20courses#enquiry'
    )
    document.body.innerHTML = renderForm()
    loadModule()

    const select = document.querySelector('[name="hs_ticket_category"]') as HTMLSelectElement
    expect(select.value).toBe('Training & courses')
  })

  it('opens Soldamatic mode for ?form=soldamatic and keeps machine field visible only then', () => {
    window.history.replaceState(null, '', '/contact-us?form=soldamatic#enquiry')
    document.body.innerHTML = renderForm()
    loadModule()

    const machineField = document.querySelector('[data-wa-soldamatic-only]') as HTMLElement
    const machineInput = document.querySelector(
      '[name="soldamatic_machine_number"]'
    ) as HTMLInputElement
    const typeField = document.querySelector('[data-wa-general-only]') as HTMLElement

    expect(machineField.hidden).toBe(false)
    expect(machineInput.required).toBe(true)
    expect(typeField.hidden).toBe(true)
  })

  it('keeps Soldamatic machine number hidden on the general enquiry tab', () => {
    window.history.replaceState(null, '', '/contact-us')
    document.body.innerHTML = renderForm()
    loadModule()

    const machineField = document.querySelector('[data-wa-soldamatic-only]') as HTMLElement
    const machineInput = document.querySelector(
      '[name="soldamatic_machine_number"]'
    ) as HTMLInputElement

    expect(machineField.hidden).toBe(true)
    expect(machineInput.required).toBe(false)
  })
})
