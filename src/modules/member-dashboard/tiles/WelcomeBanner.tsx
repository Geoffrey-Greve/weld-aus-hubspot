import React from 'react'
import { isHonoraryMember, type WeldMemberContext, type MembershipTier } from '@shared/api/memberContext'
import { daysUntilMemberDate, formatMemberDate } from '../date'

interface WelcomeBannerProps {
  member: WeldMemberContext | null
  welcomeMessage: string
  expiryWarningDays: number
}

const TIER_LABELS: Record<MembershipTier, string> = {
  individual: 'Individual Member',
  apprentice: 'Apprentice Member',
  reciprocal: 'Reciprocal Member',
  corporate_gold: 'Corporate Gold',
  corporate_silver: 'Corporate Silver',
  corporate_bronze: 'Corporate Bronze',
  industry_supplier: 'Industry Supplier',
  honorary: 'Honorary Member',
}

export function WelcomeBanner({
  member,
  welcomeMessage,
  expiryWarningDays,
}: WelcomeBannerProps): React.ReactElement {
  if (!member) {
    return (
      <div className="wa-welcome-banner">
        <h1 className="wa-welcome-banner__greeting">Welcome back</h1>
      </div>
    )
  }

  const { firstName, membershipTier, membershipExpiry } = member.contact
  const greeting = welcomeMessage.replace('{firstname}', firstName || 'Member')
  const honorary = isHonoraryMember(member)
  const days = daysUntilMemberDate(membershipExpiry)
  const expiryStr = formatMemberDate(membershipExpiry, '')

  let expiryClass = 'wa-expiry-badge'
  let expiryText = ''
  if (honorary) {
    expiryText = 'Honorary member - no expiry'
  } else if (days !== null && expiryStr) {
    if (days < 0) {
      expiryClass += ' wa-expiry-badge--danger'
      expiryText = `Membership expired on ${expiryStr}`
    } else if (days <= expiryWarningDays) {
      expiryClass += ' wa-expiry-badge--warning'
      expiryText = `Membership expires ${days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`} - ${expiryStr}`
    } else {
      expiryText = `Member until ${expiryStr}`
    }
  }

  return (
    <div className="wa-welcome-banner wa-dashboard__tile--full">
      <h1 className="wa-welcome-banner__greeting">{greeting}</h1>
      <div className="wa-welcome-banner__meta">
        {membershipTier && (
          <span className={`wa-tier-badge wa-tier-badge--${membershipTier}`}>
            {TIER_LABELS[membershipTier] ?? membershipTier}
          </span>
        )}
        {expiryText && (
          <span className={expiryClass} aria-live="polite">
            {expiryText}
          </span>
        )}
      </div>
    </div>
  )
}
