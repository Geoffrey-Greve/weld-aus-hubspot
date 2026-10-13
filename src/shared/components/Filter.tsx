/**
 * Filter - multi-select chip group for faceted filtering UIs.
 *
 * Each chip is a toggle button with aria-pressed. Minimum touch target
 * height is enforced via the `wa-filter-chip` CSS class (44px per CLAUDE.md § 5.4).
 */

import React from 'react'

export interface FilterOption {
  value: string
  label: string
}

export interface FilterProps {
  options: FilterOption[]
  value: string[]
  onChange: (value: string[]) => void
  label?: string
  className?: string
}

export function Filter({
  options,
  value,
  onChange,
  label,
  className
}: FilterProps): React.ReactElement {
  const toggle = (optionValue: string) => {
    if (value.includes(optionValue)) {
      onChange(value.filter((v) => v !== optionValue))
    } else {
      onChange([...value, optionValue])
    }
  }

  return (
    <div className={['wa-filter-group', className].filter(Boolean).join(' ')}>
      <fieldset>
        {label && <legend className="wa-filter-group__label">{label}</legend>}
        <div className="wa-filter-group__chips">
          {options.map((option) => {
            const isActive = value.includes(option.value)
            return (
              <button
                key={option.value}
                type="button"
                className={['wa-filter-chip', isActive ? 'wa-filter-chip--active' : '']
                  .filter(Boolean)
                  .join(' ')}
                aria-pressed={isActive}
                onClick={() => toggle(option.value)}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </fieldset>
    </div>
  )
}

export default Filter
