/**
 * LoadingSkeleton - placeholder shimmer elements for async content.
 *
 * Used in React islands to fill space while HubDB or member-context data loads.
 * `SkeletonCard` renders a card-shaped placeholder (image placeholder + lines).
 */

import React from 'react'

const LINE_WIDTHS = ['100%', '75%', '50%'] as const

export interface LoadingSkeletonProps {
  lines?: number
  className?: string
}

export function LoadingSkeleton({
  lines = 3,
  className
}: LoadingSkeletonProps): React.ReactElement {
  return (
    <div className={['wa-skeleton', className].filter(Boolean).join(' ')}>
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          className="wa-skeleton__line"
          style={{ width: LINE_WIDTHS[i % LINE_WIDTHS.length] }}
        />
      ))}
    </div>
  )
}

export function SkeletonCard(): React.ReactElement {
  return (
    <div className="wa-skeleton wa-skeleton--card">
      <div className="wa-skeleton__image" />
      <div className="wa-skeleton__line" style={{ width: '100%' }} />
      <div className="wa-skeleton__line" style={{ width: '75%' }} />
      <div className="wa-skeleton__line" style={{ width: '50%' }} />
    </div>
  )
}

export default LoadingSkeleton
