import React from 'react'
import { isHonoraryMember, type WeldMemberContext } from '@shared/api/memberContext'
import { daysUntilMemberDate } from '../date'

interface SmartAlertsProps {
  member: WeldMemberContext | null
  expiryWarningDays: number
  /**
   * Where the renewal alerts should send the member. Issue 34: these used to be
   * hard-coded to the `/membership/` marketing page, which is a tier-comparison
   * brochure with no way to pay - a dead end for someone who has just been told
   * their membership lapsed. Defaults to the join/renew handoff.
   */
  renewalUrl?: string
}

const DEFAULT_RENEWAL_URL = '/membership/join/'

interface Alert {
  key: string
  level: 'warning' | 'danger' | 'info'
  icon: string
  message: string
  actionLabel?: string
  actionUrl?: string
}

function buildAlerts(
  member: WeldMemberContext | null,
  expiryWarningDays: number,
  renewalUrl: string
): Alert[] {
  if (!member) return []
  const alerts: Alert[] = []
  const { membershipStatus, membershipExpiry } = member.contact
  const honorary = isHonoraryMember(member)

  // Membership expiry
  const memberDays = daysUntilMemberDate(membershipExpiry)
  if (!honorary && membershipStatus === 'lapsed') {
    alerts.push({
      key: 'membership-lapsed',
      level: 'danger',
      icon: '⚠',
      message: 'Your membership has lapsed. Renew now to maintain access to member benefits.',
      actionLabel: 'Renew membership',
      actionUrl: renewalUrl,
    })
  } else if (!honorary && memberDays !== null && memberDays <= expiryWarningDays && memberDays >= 0) {
    alerts.push({
      key: 'membership-expiring',
      level: 'warning',
      icon: '⏰',
      message: `Your membership expires in ${memberDays} day${memberDays === 1 ? '' : 's'}. Renew early to avoid interruption.`,
      actionLabel: 'Renew now',
      actionUrl: renewalUrl,
    })
  }

  // Certification expiry (30-day window)
  for (const cert of member.certifications) {
    const certDays = daysUntilMemberDate(cert.expiry)
    if (certDays !== null && certDays <= 30 && certDays >= 0) {
      const label = cert.type.toUpperCase().replace('_', ' ')
      alerts.push({
        key: `cert-expiring-${cert.type}`,
        level: 'warning',
        icon: '📋',
        message: `Your ${label} certification expires in ${certDays} day${certDays === 1 ? '' : 's'}. Contact the Q&C team to begin renewal.`,
        actionLabel: 'View certifications',
        actionUrl: `/portal/certifications/${cert.type}/`,
      })
    } else if (certDays !== null && certDays < 0) {
      const label = cert.type.toUpperCase().replace('_', ' ')
      alerts.push({
        key: `cert-expired-${cert.type}`,
        level: 'danger',
        icon: '❌',
        message: `Your ${label} certification has expired. Contact the Q&C team immediately to discuss reinstatement.`,
        actionLabel: 'Contact Q&C',
        actionUrl: 'mailto:qnc@weldaustralia.com.au',
      })
    }
  }

  return alerts
}

export function SmartAlerts({
  member,
  expiryWarningDays,
  renewalUrl,
}: SmartAlertsProps): React.ReactElement | null {
  const alerts = buildAlerts(member, expiryWarningDays, renewalUrl || DEFAULT_RENEWAL_URL)

  if (alerts.length === 0) return null

  return (
    <div className="wa-smart-alerts wa-dashboard__tile--full" role="region" aria-label="Alerts">
      {alerts.map((alert) => (
        <div key={alert.key} className={`wa-alert wa-alert--${alert.level}`} role="alert">
          <span className="wa-alert__icon" aria-hidden="true">{alert.icon}</span>
          <div className="wa-alert__body">
            <p className="wa-alert__message">{alert.message}</p>
            {alert.actionLabel && alert.actionUrl && (
              <a href={alert.actionUrl} className="wa-alert__action">
                {alert.actionLabel}
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
