import React from 'react'
import { isHonoraryMember, type WeldMemberContext, type MembershipTier, type MembershipStatus } from '@shared/api/memberContext'
import { LoadingSkeleton } from '@shared/components/LoadingSkeleton'
import { daysUntilMemberDate, formatMemberDate } from '../date'

interface MembershipStatusProps {
  member: WeldMemberContext | null
  renewalUrl: string
  expiryWarningDays: number
  supportEmail: string
}

const TIER_LABELS: Record<MembershipTier, string> = {
  individual: 'Individual',
  apprentice: 'Apprentice',
  reciprocal: 'Reciprocal',
  corporate_gold: 'Corporate Gold',
  corporate_silver: 'Corporate Silver',
  corporate_bronze: 'Corporate Bronze',
  industry_supplier: 'Industry Supplier',
  honorary: 'Honorary',
}

const STATUS_LABELS: Record<MembershipStatus, string> = {
  active: 'Active',
  grace_period: 'Grace period',
  lapsed: 'Lapsed',
  never_member: 'Not a member',
  honorary: 'Honorary',
}

function statusModifier(status: MembershipStatus): string {
  if (status === 'active') return 'active'
  if (status === 'grace_period') return 'grace'
  if (status === 'lapsed') return 'lapsed'
  if (status === 'honorary') return 'honorary'
  return 'never'
}

export function MembershipStatus({
  member,
  renewalUrl,
  expiryWarningDays,
  supportEmail,
}: MembershipStatusProps): React.ReactElement {
  if (!member) {
    return <LoadingSkeleton lines={4} />
  }

  const { membershipStatus, membershipTier, membershipExpiry } = member.contact
  const honorary = isHonoraryMember(member)
  const days = daysUntilMemberDate(membershipExpiry)
  const validUntil = honorary ? 'Does not expire' : formatMemberDate(membershipExpiry)
  const validityHint = !honorary && days !== null
    ? days < 0
      ? 'Expired'
      : days === 0
        ? 'Expires today'
        : `${days} day${days === 1 ? '' : 's'} remaining`
    : ''
  const showRenewalCta =
    !honorary &&
    (membershipStatus === 'lapsed' ||
      (days !== null && days <= expiryWarningDays && days >= 0))

  // Company association context
  const company = member.associations[0]

  return (
    <div className="wa-membership-status">
      <dl>
        <div className="wa-membership-status__row">
          <dt className="wa-membership-status__label">Status</dt>
          <dd
            className={
              'wa-membership-status__value wa-membership-status__value--' +
              statusModifier(membershipStatus)
            }
          >
            {STATUS_LABELS[membershipStatus] ?? membershipStatus}
          </dd>
        </div>

        {membershipTier && (
          <div className="wa-membership-status__row">
            <dt className="wa-membership-status__label">Tier</dt>
            <dd className="wa-membership-status__value">
              {TIER_LABELS[membershipTier] ?? membershipTier}
            </dd>
          </div>
        )}

        {company && (
          <div className="wa-membership-status__row">
            <dt className="wa-membership-status__label">Organisation</dt>
            <dd className="wa-membership-status__value">{company.companyName}</dd>
          </div>
        )}

        <div className="wa-membership-status__row">
          <dt className="wa-membership-status__label">Membership valid until</dt>
          <dd className="wa-membership-status__value wa-membership-status__value--stacked">
            <span>{validUntil}</span>
            {validityHint && (
              <span
                className={
                  'wa-membership-status__hint' +
                  (days !== null && days <= expiryWarningDays
                    ? ' wa-membership-status__hint--attention'
                    : '')
                }
              >
                {validityHint}
              </span>
            )}
          </dd>
        </div>
      </dl>

      {showRenewalCta && renewalUrl && (
        <div className="wa-membership-status__cta">
          <a href={renewalUrl} className="wa-btn wa-btn--primary">
            Renew membership
          </a>
        </div>
      )}

      {membershipStatus === 'never_member' && (
        <div className="wa-membership-status__cta">
          <a href="/membership/" className="wa-btn wa-btn--primary">
            Join Weld Australia
          </a>
        </div>
      )}

      <p style={{ fontSize: '0.8125rem', color: 'var(--wa-color-text-muted, #6b7280)', margin: 0 }}>
        Questions? <a href={'mailto:' + supportEmail} className="wa-link">{supportEmail}</a>
      </p>
    </div>
  )
}
