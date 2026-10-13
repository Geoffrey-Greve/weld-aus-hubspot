/**
 * EmptyState - zero-results placeholder for filtered lists and loading failures.
 *
 * Used in every HubDB-driven listing module when the filtered result set is empty.
 * Accepts an optional icon, action (e.g. a Button to clear filters), and descriptive body.
 */

import React from 'react'

export interface EmptyStateProps {
  heading: string
  body?: string
  icon?: React.ReactNode
  action?: React.ReactNode
  className?: string
}

export function EmptyState({
  heading,
  body,
  icon,
  action,
  className
}: EmptyStateProps): React.ReactElement {
  return (
    <div className={['wa-empty-state', className].filter(Boolean).join(' ')}>
      {icon && <div className="wa-empty-state__icon">{icon}</div>}
      <h3 className="wa-empty-state__heading">{heading}</h3>
      {body && <p className="wa-empty-state__body">{body}</p>}
      {action && <div className="wa-empty-state__action">{action}</div>}
    </div>
  )
}

export default EmptyState
