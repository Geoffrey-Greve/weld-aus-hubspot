import React, { useEffect, useState } from 'react'
import { useMemberContext } from '@shared/api/memberContext'
import type { MemberCertification } from '@shared/api/memberContext'
import { fetchHubDbRows } from '@shared/api/hubdb'
import { LoadingSkeleton } from '@shared/components/LoadingSkeleton'
import './CertificationGuidance.css'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CertificationGuidanceProps {
  certType: string
  headingTemplate: string
  showEvidenceUpload: boolean
  evidenceFormId: string
  qcContactEmail: string
  qcContactPhone: string
}

interface GuidanceRow {
  guidance_text: string
  evidence_checklist: string
}

// ---------------------------------------------------------------------------
// Cert display metadata
// ---------------------------------------------------------------------------

const CERT_META: Record<string, { label: string; hubdbLabel: string; stages: string[] }> = {
  as1796: {
    label: 'AS 1796 Welder Certification',
    hubdbLabel: 'AS1796',
    stages: [
      'Application Submitted',
      'Eligibility Review',
      'Practical Assessment Scheduled',
      'Practical Assessment Complete',
      'Certification Issued',
      'Annual Renewal Due',
    ],
  },
  iiw_inspector: {
    label: 'IIW Welding Inspector',
    hubdbLabel: 'IIW Inspector',
    stages: [
      'Application Submitted',
      'Eligibility Review',
      'Training Enrolled',
      'Examination Booked',
      'Examination Complete',
      'Certification Issued',
      'Annual Renewal Due',
    ],
  },
  iso3834: {
    label: 'ISO 3834 Certification',
    hubdbLabel: 'ISO 3834',
    stages: [
      'Application Submitted',
      'Documentation Review',
      'On-Site Audit Scheduled',
      'Audit Complete',
      'Certification Issued',
      'Surveillance Audit Due',
    ],
  },
}

const FALLBACK_STAGES = ['Application Submitted', 'In Progress', 'Complete']

function getMeta(certType: string) {
  return CERT_META[certType] ?? { label: certType, hubdbLabel: certType, stages: FALLBACK_STAGES }
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  current: 'Current',
  in_progress: 'In Progress',
  pending: 'Pending',
  expired: 'Expired',
  lapsed: 'Lapsed',
  suspended: 'Suspended',
}

function statusLabel(status: string): string {
  return STATUS_LABELS[status.toLowerCase()] ?? status
}

function statusModifier(status: string): 'active' | 'pending' | 'expired' {
  const s = status.toLowerCase()
  if (s === 'active' || s === 'current') return 'active'
  if (s === 'pending' || s === 'in_progress') return 'pending'
  return 'expired'
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  const ms = Date.parse(iso)
  if (isNaN(ms)) return ''
  return new Date(ms).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

// ---------------------------------------------------------------------------
// Pipeline progress bar
// ---------------------------------------------------------------------------

interface ProgressBarProps {
  stages: string[]
  currentStep: string | null
}

function ProgressBar({ stages, currentStep }: ProgressBarProps): React.ReactElement {
  const currentIdx = currentStep ? stages.findIndex((s) => s === currentStep) : -1

  return (
    <div className="wa-cg-progress" role="list" aria-label="Certification progress">
      {stages.map((stage, idx) => {
        const isDone = idx < currentIdx
        const isCurrent = idx === currentIdx
        const modifier = isDone ? 'done' : isCurrent ? 'current' : 'upcoming'

        return (
          <div
            key={stage}
            className={`wa-cg-progress__step wa-cg-progress__step--${modifier}`}
            role="listitem"
            aria-current={isCurrent ? 'step' : undefined}
          >
            <div className="wa-cg-progress__dot" aria-hidden="true">
              {isDone ? '✓' : idx + 1}
            </div>
            <span className="wa-cg-progress__label">{stage}</span>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Evidence upload form (HubSpot Forms embed)
// ---------------------------------------------------------------------------

interface EvidenceFormProps {
  formId: string
  certLabel: string
}

function EvidenceForm({ formId, certLabel }: EvidenceFormProps): React.ReactElement {
  const containerId = `wa-evidence-form-${formId}`

  useEffect(() => {
    if (!formId) return

    const mount = () => {
      const win = window as Window & {
        hbspt?: {
          forms: {
            create: (opts: Record<string, unknown>) => void
          }
        }
      }
      if (!win.hbspt?.forms?.create) return
      win.hbspt.forms.create({
        region: 'ap1',
        portalId: '441838610',
        formId,
        target: `#${containerId}`,
      })
    }

    // HubSpot Forms JS may not be loaded yet - wait for it
    if ((window as Window & { hbspt?: unknown }).hbspt) {
      mount()
    } else {
      const interval = setInterval(() => {
        if ((window as Window & { hbspt?: unknown }).hbspt) {
          clearInterval(interval)
          mount()
        }
      }, 200)
      return () => clearInterval(interval)
    }
  }, [formId, containerId])

  if (!formId) return <></>

  return (
    <div className="wa-cg-upload">
      <h2 className="wa-cg-upload__heading">Submit evidence for {certLabel}</h2>
      <div id={containerId} className="wa-cg-upload__form" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Q&C contact footer
// ---------------------------------------------------------------------------

interface QcContactProps {
  email: string
  phone: string
}

function QcContact({ email, phone }: QcContactProps): React.ReactElement {
  return (
    <div className="wa-cg-contact">
      <p className="wa-cg-contact__intro">
        Questions about your certification? Contact the Q&amp;C team:
      </p>
      <div className="wa-cg-contact__details">
        {email && (
          <a href={`mailto:${email}`} className="wa-cg-contact__link">
            {email}
          </a>
        )}
        {phone && (
          <a href={`tel:${phone.replace(/\s/g, '')}`} className="wa-cg-contact__link">
            {phone}
          </a>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CertificationGuidance(props: CertificationGuidanceProps): React.ReactElement {
  const {
    certType,
    headingTemplate,
    showEvidenceUpload,
    evidenceFormId,
    qcContactEmail,
    qcContactPhone,
  } = props

  const ctx = useMemberContext()
  const meta = getMeta(certType)

  const cert: MemberCertification | undefined = ctx?.certifications.find(
    (c) => c.type === certType
  )

  const [guidance, setGuidance] = useState<GuidanceRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!cert?.currentStep) {
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    fetchHubDbRows<{ certification_type: { name: string }; step: string; guidance_text: string; evidence_checklist: string }>(
      'certification_guidance',
      {
        'certification_type__eq': meta.hubdbLabel,
        'step__eq': cert.currentStep,
      }
    )
      .then((rows) => {
        if (rows.length > 0 && rows[0]) {
          setGuidance({
            guidance_text: rows[0].values.guidance_text ?? '',
            evidence_checklist: rows[0].values.evidence_checklist ?? '',
          })
        } else {
          setGuidance(null)
        }
      })
      .catch(() => {
        setError('Could not load guidance content. Please try refreshing the page.')
      })
      .finally(() => {
        setLoading(false)
      })
  }, [certType, cert?.currentStep, meta.hubdbLabel])

  const heading = headingTemplate.replace('{certification_type}', meta.label)

  // Cert not found in member context
  if (!ctx) {
    return (
      <div className="wa-cg-error" role="alert">
        <p>Your member profile could not be loaded. Please <a href="." className="wa-link">refresh the page</a>.</p>
      </div>
    )
  }

  if (!cert) {
    return (
      <div className="wa-cg-empty">
        <h1 className="wa-cg-heading">{heading}</h1>
        <p className="wa-cg-empty__message">
          No {meta.label} certification is linked to your account.{' '}
          <a href="/certification/" className="wa-link">Explore certification pathways</a> or contact{' '}
          <a href={`mailto:${qcContactEmail}`} className="wa-link">{qcContactEmail}</a> for assistance.
        </p>
      </div>
    )
  }

  const mod = statusModifier(cert.status)
  const expiryStr = formatDate(cert.expiry)

  return (
    <div className="wa-cg">

      {/* Heading + status */}
      <div className="wa-cg__header">
        <h1 className="wa-cg-heading">{heading}</h1>
        <div className="wa-cg__status-row">
          <span className={`wa-cert-status-badge wa-cert-status-badge--${mod}`}>
            {statusLabel(cert.status)}
          </span>
          {expiryStr && (
            <span className="wa-cg__expiry">
              {mod === 'expired' ? 'Expired' : 'Expires'}: {expiryStr}
            </span>
          )}
          {cert.certificateUrl && mod === 'active' && (
            <a
              href={cert.certificateUrl}
              className="wa-btn wa-btn--sm wa-btn--secondary"
              target="_blank"
              rel="noopener noreferrer"
            >
              Download certificate
            </a>
          )}
        </div>
      </div>

      {/* Pipeline progress */}
      <ProgressBar stages={meta.stages} currentStep={cert.currentStep} />

      {/* Guidance content */}
      <div className="wa-cg__guidance">
        {loading && <LoadingSkeleton lines={5} />}

        {!loading && error && (
          <div className="wa-cg-error" role="alert">
            <p>{error}</p>
          </div>
        )}

        {!loading && !error && !cert.currentStep && (
          <div className="wa-cg-info">
            <p>No current step has been recorded for this certification yet. Contact the Q&amp;C team if you believe this is an error.</p>
          </div>
        )}

        {!loading && !error && cert.currentStep && !guidance && (
          <div className="wa-cg-info">
            <p>Guidance for your current step (<strong>{cert.currentStep}</strong>) has not been configured yet. Please contact the Q&amp;C team for assistance.</p>
          </div>
        )}

        {!loading && !error && guidance && (
          <>
            {guidance.guidance_text && (
              <div
                className="wa-cg__guidance-text wa-richtext"
                dangerouslySetInnerHTML={{ __html: guidance.guidance_text }}
              />
            )}
            {guidance.evidence_checklist && (
              <div className="wa-cg__checklist">
                <h2 className="wa-cg__checklist-heading">Evidence checklist</h2>
                <div
                  className="wa-cg__checklist-body wa-richtext"
                  dangerouslySetInnerHTML={{ __html: guidance.evidence_checklist }}
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* Evidence upload form */}
      {showEvidenceUpload && evidenceFormId && (
        <EvidenceForm formId={evidenceFormId} certLabel={meta.label} />
      )}

      {/* Q&C contact */}
      <QcContact email={qcContactEmail} phone={qcContactPhone} />
    </div>
  )
}

export default CertificationGuidance
