import React from 'react'

interface CustomCtaProps {
  label: string
  url: string
}

export function CustomCta({ label, url }: CustomCtaProps): React.ReactElement | null {
  if (!label || !url) return null

  return (
    <div className="wa-custom-cta">
      <a href={url} className="wa-btn wa-btn--primary">
        {label}
      </a>
    </div>
  )
}
