/**
 * Pagination - prev/next + page number controls.
 *
 * Hidden when `totalPages <= 1` to avoid cluttering single-page lists.
 *
 * Pass `scrollTargetRef` to scroll the top of that element into view whenever
 * the page changes - prevents mobile users from being stranded at the controls.
 */

import React from 'react'

export interface PaginationProps {
  page: number
  totalPages: number
  onChange: (page: number) => void
  /** Ref to the element that should scroll into view on page change (e.g. the results list). */
  scrollTargetRef?: React.RefObject<HTMLElement | null>
  className?: string
}

export function Pagination({
  page,
  totalPages,
  onChange,
  scrollTargetRef,
  className
}: PaginationProps): React.ReactElement | null {
  if (totalPages <= 1) return null

  const pages: number[] = []
  for (let i = 1; i <= totalPages; i++) {
    pages.push(i)
  }

  function goTo(p: number) {
    onChange(p)
    scrollTargetRef?.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <nav
      className={['wa-pagination', className].filter(Boolean).join(' ')}
      aria-label="Pagination"
    >
      <button
        type="button"
        className="wa-pagination__btn"
        onClick={() => goTo(page - 1)}
        disabled={page <= 1}
        aria-label="Previous page"
      >
        &lsaquo;
      </button>

      {pages.map((p) => (
        <button
          key={p}
          type="button"
          className={['wa-pagination__btn', p === page ? 'wa-pagination__btn--active' : '']
            .filter(Boolean)
            .join(' ')}
          onClick={() => goTo(p)}
          aria-label={`Page ${p}`}
          aria-current={p === page ? 'page' : undefined}
        >
          {p}
        </button>
      ))}

      <button
        type="button"
        className="wa-pagination__btn"
        onClick={() => goTo(page + 1)}
        disabled={page >= totalPages}
        aria-label="Next page"
      >
        &rsaquo;
      </button>
    </nav>
  )
}

export default Pagination
