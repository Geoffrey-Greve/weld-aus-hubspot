/**
 * Button - core interactive element for the Weld Australia theme.
 *
 * Renders as an `<a>` when `href` is provided (and not disabled/loading),
 * otherwise as a `<button>`. Uses BEM-style CSS classes so styling stays
 * in the theme's CSS layer without runtime style injection.
 */

import React from 'react'

export interface ButtonProps {
  children: React.ReactNode
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  loading?: boolean
  href?: string
  onClick?: React.MouseEventHandler
  type?: 'button' | 'submit' | 'reset'
  className?: string
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  href,
  onClick,
  type = 'button',
  className
}: ButtonProps): React.ReactElement {
  const classes = [
    'wa-btn',
    `wa-btn--${variant}`,
    `wa-btn--${size}`,
    loading ? 'wa-btn--loading' : '',
    className ?? ''
  ]
    .filter(Boolean)
    .join(' ')

  if (href && !disabled && !loading) {
    return (
      <a href={href} className={classes} onClick={onClick}>
        {children}
      </a>
    )
  }

  return (
    <button
      type={type}
      className={classes}
      disabled={disabled || loading}
      onClick={onClick}
      aria-busy={loading || undefined}
    >
      {children}
    </button>
  )
}

export default Button
