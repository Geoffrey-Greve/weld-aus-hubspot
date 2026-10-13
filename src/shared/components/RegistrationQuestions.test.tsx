import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { RegistrationQuestions } from './RegistrationQuestions'
import type { RegistrationQuestion } from '@shared/api/eventEngine'

/**
 * The generic mechanism, not a dietary-requirements field. Every case below is about a
 * definition the tenant could add tomorrow without a code change.
 */

function question(over: Partial<RegistrationQuestion> = {}): RegistrationQuestion {
  return {
    id: 'q1',
    key: 'dietary_requirements',
    label: 'Dietary requirements',
    fieldType: 'textarea',
    options: null,
    required: false,
    scope: 'attendee',
    helpText: null,
    sortOrder: 0,
    hsProperty: 'dietary_requirements',
    prefill: true,
    ...over
  }
}

describe('RegistrationQuestions', () => {
  it('renders nothing at all when the event asks nothing', () => {
    const { container } = render(
      <RegistrationQuestions questions={[]} values={{}} onChange={vi.fn()} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders a textarea and reports what was typed under the question key', () => {
    const onChange = vi.fn()
    render(
      <RegistrationQuestions questions={[question()]} values={{}} onChange={onChange} />
    )

    fireEvent.change(screen.getByLabelText(/dietary requirements/i), {
      target: { value: 'Coeliac' }
    })
    expect(onChange).toHaveBeenCalledWith('dietary_requirements', 'Coeliac')
  })

  it('renders a select from the definition options', () => {
    render(
      <RegistrationQuestions
        questions={[
          question({
            key: 'workshop_stream',
            label: 'Workshop stream',
            fieldType: 'select',
            options: [
              { value: 'structural', label: 'Structural' },
              { value: 'pipe', label: 'Pipe' }
            ]
          })
        ]}
        values={{}}
        onChange={vi.fn()}
      />
    )

    expect(screen.getByRole('option', { name: 'Structural' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Pipe' })).toBeTruthy()
  })

  it('joins a multiselect with ";" — HubSpot\'s own encoding, so the write-back is a copy', () => {
    const onChange = vi.fn()
    render(
      <RegistrationQuestions
        questions={[
          question({
            key: 'access_needs',
            label: 'Access needs',
            fieldType: 'multiselect',
            options: [
              { value: 'wheelchair', label: 'Wheelchair access' },
              { value: 'hearing', label: 'Hearing loop' },
              { value: 'parking', label: 'Accessible parking' }
            ]
          })
        ]}
        values={{ access_needs: 'wheelchair' }}
        onChange={onChange}
      />
    )

    fireEvent.click(screen.getByLabelText('Accessible parking'))
    expect(onChange).toHaveBeenCalledWith('access_needs', 'wheelchair;parking')
  })

  it('keeps a multiselect in the definition order however the buyer ticked them', () => {
    const onChange = vi.fn()
    render(
      <RegistrationQuestions
        questions={[
          question({
            key: 'access_needs',
            fieldType: 'multiselect',
            options: [
              { value: 'a', label: 'A' },
              { value: 'b', label: 'B' },
              { value: 'c', label: 'C' }
            ]
          })
        ]}
        values={{ access_needs: 'c' }}
        onChange={onChange}
      />
    )

    fireEvent.click(screen.getByLabelText('A'))
    expect(onChange).toHaveBeenCalledWith('access_needs', 'a;c')
  })

  it('unticks a multiselect value', () => {
    const onChange = vi.fn()
    render(
      <RegistrationQuestions
        questions={[
          question({
            key: 'access_needs',
            fieldType: 'multiselect',
            options: [
              { value: 'a', label: 'A' },
              { value: 'b', label: 'B' }
            ]
          })
        ]}
        values={{ access_needs: 'a;b' }}
        onChange={onChange}
      />
    )

    fireEvent.click(screen.getByLabelText('A'))
    expect(onChange).toHaveBeenCalledWith('access_needs', 'b')
  })

  it('stores a checkbox as true/false, the strings the worker normalises', () => {
    const onChange = vi.fn()
    render(
      <RegistrationQuestions
        questions={[question({ key: 'first_aid', label: 'First aid trained', fieldType: 'checkbox' })]}
        values={{}}
        onChange={onChange}
      />
    )

    fireEvent.click(screen.getByLabelText(/first aid trained/i))
    expect(onChange).toHaveBeenCalledWith('first_aid', 'true')
  })

  it('renders a phone question as a tel input so a mobile keypad appears', () => {
    render(
      <RegistrationQuestions
        questions={[question({ key: 'emergency_contact', label: 'Emergency contact', fieldType: 'phone' })]}
        values={{}}
        onChange={vi.fn()}
      />
    )
    expect(screen.getByLabelText(/emergency contact/i).getAttribute('type')).toBe('tel')
  })

  it('shows the help text and links it to the field for screen readers', () => {
    render(
      <RegistrationQuestions
        questions={[question({ helpText: 'So catering can be arranged.' })]}
        values={{}}
        onChange={vi.fn()}
      />
    )

    const field = screen.getByLabelText(/dietary requirements/i)
    expect(screen.getByText('So catering can be arranged.')).toBeTruthy()
    expect(field.getAttribute('aria-describedby')).toBe('wa-rq-dietary_requirements-help')
  })

  it('flags a required question the buyer left blank', () => {
    render(
      <RegistrationQuestions
        questions={[question({ required: true })]}
        values={{}}
        missing={['dietary_requirements']}
        onChange={vi.fn()}
      />
    )
    expect(screen.getByRole('alert').textContent).toContain('is required')
  })

  it('keeps two instances on one page from sharing input ids', () => {
    const { container } = render(
      <>
        <RegistrationQuestions
          questions={[question()]}
          values={{}}
          onChange={vi.fn()}
          idPrefix="first"
        />
        <RegistrationQuestions
          questions={[question()]}
          values={{}}
          onChange={vi.fn()}
          idPrefix="second"
        />
      </>
    )
    expect(container.querySelector('#first-dietary_requirements')).toBeTruthy()
    expect(container.querySelector('#second-dietary_requirements')).toBeTruthy()
  })
})
