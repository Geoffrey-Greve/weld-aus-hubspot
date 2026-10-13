/**
 * The event's custom registration questions (Event Engine Phase 2.3), rendered.
 *
 * Dietary requirements is a CASE of this, not a feature of its own: the worker holds the
 * definitions and the CMS renders whatever they turn out to be, so the next thing the
 * tenant asks for — a coffee order, a shirt size, a purchase order number — is a row in
 * their admin, not a change here.
 *
 * Two rules this has to keep:
 *
 *   `required` IS NOT ENFORCED HERE, it is enforced in the worker. The brief is explicit,
 *   and the reason is structural: this is a module a marketer can edit, and the staff and
 *   corporate booking paths never render it at all. What happens below is a courtesy that
 *   saves a round trip, not the gate.
 *
 *   PREFILL IS THE CMS'S JOB. The worker hands an unauthenticated caller definitions only
 *   — an endpoint that answered `?email=` with someone's dietary requirements would be a
 *   data leak wearing a convenience feature's name. `hsProperty` names the contact property
 *   and HubL passes the logged-in visitor's own value in; a guest gets an empty field.
 */

import React from 'react'
import type { QuestionAnswers, RegistrationQuestion } from '../api/eventEngine'

/** HubSpot's own encoding for a multiple-checkbox property, so the write-back is a copy. */
const MULTISELECT_SEPARATOR = ';'

export interface RegistrationQuestionsProps {
  questions: RegistrationQuestion[]
  values: QuestionAnswers
  onChange: (key: string, value: string) => void
  /** Keys the buyer has left blank on a required question, highlighted after a submit. */
  missing?: string[]
  /** Prefix for input ids, so two instances on one page do not collide. */
  idPrefix?: string
  disabled?: boolean
}

export function RegistrationQuestions({
  questions,
  values,
  onChange,
  missing = [],
  idPrefix = 'wa-rq',
  disabled = false
}: RegistrationQuestionsProps): React.ReactElement | null {
  if (questions.length === 0) return null

  return (
    <div className="wa-registration-questions">
      {questions.map((question) => {
        const id = `${idPrefix}-${question.key}`
        const describedBy = question.helpText ? `${id}-help` : undefined
        const isMissing = missing.includes(question.key)
        const value = values[question.key] ?? ''

        return (
          <div
            key={question.id}
            className={`wa-field wa-registration-questions__field${isMissing ? ' wa-field--error' : ''}`}
          >
            <label id={`${id}-label`} htmlFor={id}>
              {question.label}
              {question.required && (
                <span className="wa-registration-questions__required" aria-hidden="true">
                  {' '}
                  *
                </span>
              )}
            </label>

            {question.helpText && (
              <p className="wa-registration-questions__help" id={`${id}-help`}>
                {question.helpText}
              </p>
            )}

            <QuestionField
              question={question}
              id={id}
              value={value}
              describedBy={describedBy}
              disabled={disabled}
              onChange={(next) => onChange(question.key, next)}
            />

            {isMissing && (
              <p className="wa-registration-questions__error" role="alert">
                {question.label} is required.
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

function QuestionField({
  question,
  id,
  value,
  describedBy,
  disabled,
  onChange
}: {
  question: RegistrationQuestion
  id: string
  value: string
  describedBy?: string
  disabled: boolean
  onChange: (value: string) => void
}): React.ReactElement {
  const shared = {
    id,
    name: question.key,
    disabled,
    'aria-describedby': describedBy,
    // `required` is advisory markup for the browser and for assistive tech. The worker is
    // the gate, so this never decides whether a booking is allowed through.
    required: question.required
  }

  switch (question.fieldType) {
    case 'textarea':
      return (
        <textarea
          {...shared}
          rows={3}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )

    case 'select':
      return (
        <select {...shared} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Please choose…</option>
          {(question.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )

    case 'multiselect': {
      // Rendered as checkboxes rather than a multi-select listbox: on a phone a native
      // multi-select is close to unusable, and this form is mobile-first by rule.
      const selected = value === '' ? [] : value.split(MULTISELECT_SEPARATOR)
      return (
        // Labelled by the question's own label element. It used to point at this div's own
        // id, which says nothing to a screen reader.
        <div className="wa-registration-questions__options" role="group" aria-labelledby={`${id}-label`}>
          {(question.options ?? []).map((option) => {
            const checked = selected.includes(option.value)
            return (
              <label
                key={option.value}
                className="wa-registration-questions__option"
                htmlFor={`${id}-${option.value}`}
              >
                <input
                  id={`${id}-${option.value}`}
                  type="checkbox"
                  name={question.key}
                  value={option.value}
                  checked={checked}
                  disabled={disabled}
                  onChange={() =>
                    onChange(
                      (checked
                        ? selected.filter((v) => v !== option.value)
                        : // Kept in the definition's own order rather than click order, so
                          // the stored string is stable however the buyer ticked them.
                          (question.options ?? [])
                            .map((o) => o.value)
                            .filter((v) => v === option.value || selected.includes(v))
                      ).join(MULTISELECT_SEPARATOR)
                    )
                  }
                />
                <span>{option.label}</span>
              </label>
            )
          })}
        </div>
      )
    }

    case 'checkbox':
      // Wrapped and class-marked rather than bare, because the theme's `.wa-field input`
      // rule sets `width: 100%` and `appearance: none` — which on a checkbox strips the
      // native tick and leaves a full-width empty box that never looks checked. The
      // multiselect branch above already carries its own box styles; this one needs the
      // same, and the wrapper is also what gives it a 44px touch target.
      return (
        <div className="wa-registration-questions__option">
          <input
            {...shared}
            type="checkbox"
            checked={value === 'true'}
            onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
          />
        </div>
      )

    case 'phone':
      return (
        <input
          {...shared}
          type="tel"
          autoComplete="tel"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )

    default:
      return (
        <input {...shared} type="text" value={value} onChange={(e) => onChange(e.target.value)} />
      )
  }
}
