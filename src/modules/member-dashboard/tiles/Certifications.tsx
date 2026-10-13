import React from 'react'
import type { MemberCertification } from '@shared/api/memberContext'

interface CertificationsProps {
  certifications: MemberCertification[]
}

const CERT_LABELS: Record<string, string> = {
  as1796: 'AS 1796 Welder Certification',
  iiw_inspector: 'IIW Welding Inspector',
  iso3834: 'ISO 3834 Certification',
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  current: 'Current',
  pending: 'Pending',
  in_progress: 'In Progress',
  expired: 'Expired',
  lapsed: 'Lapsed',
  suspended: 'Suspended',
}

function certLabel(type: string): string {
  return CERT_LABELS[type] ?? type.toUpperCase().replace(/_/g, ' ')
}

function statusLabel(status: string): string {
  return STATUS_LABELS[status.toLowerCase()] ?? status
}

function statusModifier(status: string): string {
  const s = status.toLowerCase()
  if (s === 'active' || s === 'current') return 'active'
  if (s === 'pending' || s === 'in_progress') return 'pending'
  return 'expired'
}

function formatDate(isoDate: string | null): string {
  if (!isoDate) return ''
  const ms = Date.parse(isoDate)
  if (isNaN(ms)) return ''
  return new Date(ms).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
}

function CertCard({ cert }: { cert: MemberCertification }): React.ReactElement {
  const expiryStr = formatDate(cert.expiry)
  const mod = statusModifier(cert.status)

  return (
    <article className="wa-cert-card" aria-label={certLabel(cert.type)}>
      <header className="wa-cert-card__header">
        <h3 className="wa-cert-card__name">{certLabel(cert.type)}</h3>
        <span className={`wa-cert-status-badge wa-cert-status-badge--${mod}`}>
          {statusLabel(cert.status)}
        </span>
      </header>

      {expiryStr && (
        <p className="wa-cert-card__expiry">
          {mod === 'expired' ? 'Expired' : 'Expires'}: {expiryStr}
        </p>
      )}

      {cert.currentStep && (
        <p className="wa-cert-card__step">
          Next step: {cert.currentStep}
        </p>
      )}

      <div className="wa-cert-card__actions">
        {cert.certificateUrl && (mod === 'active') && (
          <a
            href={cert.certificateUrl}
            className="wa-btn wa-btn--sm wa-btn--secondary"
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Download ${certLabel(cert.type)} certificate`}
          >
            Download certificate
          </a>
        )}
        <a
          href={`/portal/certifications/${cert.type}/`}
          className="wa-btn wa-btn--sm wa-btn--secondary"
        >
          View progress
        </a>
      </div>
    </article>
  )
}

export function Certifications({ certifications }: CertificationsProps): React.ReactElement {
  if (certifications.length === 0) {
    return (
      <div className="wa-tile-empty">
        <div className="wa-tile-empty__icon" aria-hidden="true">📋</div>
        <p className="wa-tile-empty__message">
          No certifications on file.{' '}
          <a href="/certification/" className="wa-link">
            Explore certification pathways
          </a>
        </p>
      </div>
    )
  }

  return (
    <div className="wa-certifications">
      {certifications.map((cert) => (
        <CertCard key={cert.type} cert={cert} />
      ))}
    </div>
  )
}
