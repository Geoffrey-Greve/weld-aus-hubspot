import React from 'react'
import type { ResourceItem } from '../types'

interface ResourcesForYouProps {
  resources: ResourceItem[]
}

const FILE_TYPE_ICONS: Record<string, string> = {
  pdf: '📄',
  video: '🎥',
  link: '🔗',
}

const CATEGORY_LABELS: Record<string, string> = {
  technical: 'Technical',
  standards: 'Standards',
  case_study: 'Case Study',
  report: 'Report',
  webinar: 'Webinar',
  template: 'Template',
  advocacy: 'Advocacy',
}

export function ResourcesForYou({ resources }: ResourcesForYouProps): React.ReactElement {
  if (resources.length === 0) {
    return (
      <div className="wa-tile-empty">
        <div className="wa-tile-empty__icon" aria-hidden="true">📚</div>
        <p className="wa-tile-empty__message">
          <a href="/resources/" className="wa-link">
            Browse the resource library
          </a>
        </p>
      </div>
    )
  }

  return (
    <div className="wa-resources-for-you">
      {resources.map((res) => {
        const icon = FILE_TYPE_ICONS[res.file_type] ?? '📄'
        const catLabel = CATEGORY_LABELS[res.category] ?? res.category
        const isLocked = res.locked

        if (isLocked) {
          return (
            <div
              key={res.id}
              className="wa-resource-row wa-resource-row--locked"
              title="Upgrade your membership to access this resource"
              aria-label={`${res.title} - members only`}
            >
              <div className="wa-resource-row__icon" aria-hidden="true">🔒</div>
              <div className="wa-resource-row__info">
                <p className="wa-resource-row__title">{res.title}</p>
                <p className="wa-resource-row__meta">{catLabel} · Members only</p>
              </div>
            </div>
          )
        }

        return (
          <a
            key={res.id}
            href={res.file_url || '/resources/'}
            className="wa-resource-row"
            target={res.file_url ? '_blank' : undefined}
            rel={res.file_url ? 'noopener noreferrer' : undefined}
            aria-label={`${res.title} - ${catLabel} (${res.file_type})`}
          >
            <div className="wa-resource-row__icon" aria-hidden="true">{icon}</div>
            <div className="wa-resource-row__info">
              <p className="wa-resource-row__title">{res.title}</p>
              <p className="wa-resource-row__meta">{catLabel} · {res.file_type?.toUpperCase()}</p>
            </div>
          </a>
        )
      })}

      <a href="/resources/" className="wa-link" style={{ fontSize: '0.875rem' }}>
        Browse all resources →
      </a>
    </div>
  )
}
