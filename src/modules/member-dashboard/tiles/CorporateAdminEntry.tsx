import React from 'react'
import type { WeldMemberContext } from '@shared/api/memberContext'

interface CorporateAdminEntryProps {
  member: WeldMemberContext
}

export function CorporateAdminEntry({ member }: CorporateAdminEntryProps): React.ReactElement {
  const company = member.associations.find((a) => ['Primary Admin', 'Admin'].includes(a.roleLabel))
  const companyName = company?.companyName ?? 'your organisation'

  return (
    <div className="wa-corporate-admin-entry">
      <p className="wa-corporate-admin-entry__intro">
        You are the primary administrator for <strong>{companyName}</strong>.
        Manage your team, register employees for courses, and track voucher usage.
      </p>
      <div className="wa-corporate-admin-entry__actions">
        <a href="/portal/#portal-team" className="wa-btn wa-btn--primary">
          Manage my team
        </a>
        <a href="/courses/" className="wa-btn wa-btn--secondary">
          Register employees
        </a>
      </div>
    </div>
  )
}
