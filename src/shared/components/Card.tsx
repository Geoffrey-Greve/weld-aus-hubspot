/**
 * Card - surface container for content blocks throughout the Weld Australia theme.
 *
 * Polymorphic via the `as` prop - defaults to `<div>` but can be an `<article>`,
 * `<li>`, etc. to maintain semantic HTML in listing contexts.
 */

import React from 'react'

export interface CardProps {
  children: React.ReactNode
  className?: string
  as?: keyof React.JSX.IntrinsicElements
  padding?: 'none' | 'sm' | 'md' | 'lg'
  shadow?: boolean
  border?: boolean
}

export function Card({
  children,
  className,
  as: Tag = 'div',
  padding = 'md',
  shadow = true,
  border = false
}: CardProps): React.ReactElement {
  const classes = [
    'wa-card',
    `wa-card--pad-${padding}`,
    shadow ? 'wa-card--shadow' : '',
    border ? 'wa-card--border' : '',
    className ?? ''
  ]
    .filter(Boolean)
    .join(' ')

  return <Tag className={classes}>{children}</Tag>
}

export default Card
