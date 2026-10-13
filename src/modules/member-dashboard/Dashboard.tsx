import React, { lazy, Suspense, useEffect, useState } from 'react'
import ErrorBoundary from '@shared/components/ErrorBoundary'
import { LoadingSkeleton } from '@shared/components/LoadingSkeleton'
import { useMemberContext, getMemberContext } from '@shared/api/memberContext'
import type { WeldMemberContext } from '@shared/api/memberContext'
import type { DashboardProps, TileConfig } from './types'

// Above-fold tiles - eagerly imported so they paint on first render.
import { WelcomeBanner } from './tiles/WelcomeBanner'
import { SmartAlerts } from './tiles/SmartAlerts'

// Below-fold tiles - lazy-loaded to keep the initial JS parse budget low.
// Each tile is a separate dynamic import; the shared chunk (vendor-react, shared)
// is already cached, so the incremental cost per tile is tiny.
const MembershipStatus = lazy(() =>
  import('./tiles/MembershipStatus').then((m) => ({ default: m.MembershipStatus }))
)
const Certifications = lazy(() =>
  import('./tiles/Certifications').then((m) => ({ default: m.Certifications }))
)
const UpcomingCourses = lazy(() =>
  import('./tiles/UpcomingCourses').then((m) => ({ default: m.UpcomingCourses }))
)
const RegisteredEvents = lazy(() =>
  import('./tiles/RegisteredEvents').then((m) => ({ default: m.RegisteredEvents }))
)
const InvoicesAndReceipts = lazy(() =>
  import('./tiles/InvoicesAndReceipts').then((m) => ({ default: m.InvoicesAndReceipts }))
)
const GeoLocalisedEvents = lazy(() =>
  import('./tiles/GeoLocalisedEvents').then((m) => ({ default: m.GeoLocalisedEvents }))
)
const CorporateAdminEntry = lazy(() =>
  import('./tiles/CorporateAdminEntry').then((m) => ({ default: m.CorporateAdminEntry }))
)
const ResourcesForYou = lazy(() =>
  import('./tiles/ResourcesForYou').then((m) => ({ default: m.ResourcesForYou }))
)
const CustomCta = lazy(() =>
  import('./tiles/CustomCta').then((m) => ({ default: m.CustomCta }))
)
// ProfileSwitcher lives in a sibling module - lazy-import avoids bundling it
// into the member-dashboard chunk AND the profile-switcher chunk.
const ProfileSwitcher = lazy(() =>
  import('@modules/profile-switcher/ProfileSwitcher').then((m) => ({
    default: m.ProfileSwitcher,
  }))
)

import './Dashboard.css'

// ---------------------------------------------------------------------------
// TileWrapper - heading + error boundary + suspense shell for each tile
// ---------------------------------------------------------------------------

interface TileWrapperProps {
  id: string
  heading?: string
  fullWidth?: boolean
  children: React.ReactNode
}

function TileWrapper({ id, heading, fullWidth = false, children }: TileWrapperProps): React.ReactElement {
  return (
    <section
      className={`wa-dashboard__tile${fullWidth ? ' wa-dashboard__tile--full' : ''}`}
      id={id}
      aria-labelledby={heading ? `${id}-heading` : undefined}
    >
      {heading && (
        <h2 className="wa-dashboard__tile-heading" id={`${id}-heading`}>
          {heading}
        </h2>
      )}
      <ErrorBoundary
        fallback={
          <div className="wa-dashboard__tile-error" role="alert">
            <p>This section couldn't load. <a href="." className="wa-link">Refresh the page</a> or contact <a href="mailto:office@weldaustralia.com.au" className="wa-link">support</a>.</p>
          </div>
        }
      >
        <Suspense fallback={<LoadingSkeleton lines={3} />}>
          {children}
        </Suspense>
      </ErrorBoundary>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Tile renderer - maps tile_type to the right component
// ---------------------------------------------------------------------------

function renderTile(
  tile: TileConfig,
  member: WeldMemberContext | null,
  props: DashboardProps
): React.ReactElement | null {
  switch (tile.tile_type) {
    case 'welcome_banner':
      return (
        <WelcomeBanner
          member={member}
          welcomeMessage={props.welcome_message}
          expiryWarningDays={props.expiry_warning_days}
        />
      )
    case 'smart_alerts':
      return (
        <SmartAlerts
          member={member}
          expiryWarningDays={props.expiry_warning_days}
          renewalUrl={props.renewal_url}
        />
      )
    case 'membership_status':
      return (
        <MembershipStatus
          member={member}
          renewalUrl={props.renewal_url}
          expiryWarningDays={props.expiry_warning_days}
          supportEmail={props.support_email}
        />
      )
    case 'certifications':
      return <Certifications certifications={member?.certifications ?? []} />
    case 'upcoming_courses':
      return <UpcomingCourses nextCourse={member?.contact.nextCourse ?? null} />
    case 'registered_events':
      return <RegisteredEvents events={props.registered_events} />
    case 'invoices':
      return <InvoicesAndReceipts invoices={props.invoices} supportEmail={props.support_email} />
    case 'geo_events':
      return (
        <GeoLocalisedEvents
          events={props.geo_events}
          memberState={props.member_state}
        />
      )
    case 'corporate_admin':
      if (!member?.entitlements.isPrimaryAdmin) return null
      return <CorporateAdminEntry member={member} />
    case 'resources_for_you':
      return <ResourcesForYou resources={props.resources_for_you} />
    case 'profile_switcher':
      return <ProfileSwitcher member={member} />
    case 'custom_cta':
      return (
        <CustomCta
          label={tile.custom_cta_label ?? ''}
          url={tile.custom_cta_url ?? ''}
        />
      )
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Default tile headings
// ---------------------------------------------------------------------------

const DEFAULT_HEADINGS: Record<string, string> = {
  welcome_banner: '',
  smart_alerts: '',
  membership_status: 'Membership',
  certifications: 'My Certifications',
  upcoming_courses: 'Upcoming Courses',
  registered_events: 'Registered Events',
  invoices: 'Invoices & Receipts',
  geo_events: 'Events Near You',
  corporate_admin: 'Manage My Team',
  resources_for_you: 'Resources for You',
  profile_switcher: 'Active Profile',
  custom_cta: '',
}

function getPreviewProfileLabel(profile: WeldMemberContext): string {
  const name = `${profile.contact.firstName} ${profile.contact.lastName}`.trim()
  const tier = profile.associations[0]?.tier ?? profile.contact.membershipTier ?? 'no tier'
  const role = profile.associations[0]?.roleLabel
  const tierLabel = tier.replace(/_/g, ' ')
  return role ? `${name} - ${tierLabel}, ${role}` : `${name} - ${tierLabel}`
}

// ---------------------------------------------------------------------------
// Dashboard - orchestrator
// ---------------------------------------------------------------------------

export function Dashboard(props: DashboardProps): React.ReactElement {
  const realMember = useMemberContext()
  const previewProfiles = props.preview_profiles ?? []
  const isPreviewMode = previewProfiles.length > 0
  const [selectedPreviewId, setSelectedPreviewId] = useState<string>(
    () => previewProfiles[0]?.contact.id ?? ''
  )
  const selectedPreviewMember =
    previewProfiles.find((profile) => profile.contact.id === selectedPreviewId) ??
    previewProfiles[0] ??
    null
  const member = selectedPreviewMember ?? realMember

  useEffect(() => {
    if (!isPreviewMode) return
    const hasSelectedProfile = previewProfiles.some((profile) => profile.contact.id === selectedPreviewId)
    if (!hasSelectedProfile) {
      setSelectedPreviewId(previewProfiles[0]?.contact.id ?? '')
    }
  }, [isPreviewMode, previewProfiles, selectedPreviewId])

  // Brief mounted guard so we can show a skeleton during React's initial paint.
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])

  // Track the active context key so tiles can re-render when the
  // ProfileSwitcher fires "weld:context-changed" (CLAUDE.md §6.5).
  const [activeContext, setActiveContext] = useState<string>(
    () => selectedPreviewMember?.activeContext ?? getMemberContext()?.activeContext ?? 'personal'
  )
  useEffect(() => {
    function onContextChanged(e: Event): void {
      const key = (e as CustomEvent<{ context: string }>).detail?.context
      if (key) setActiveContext(key)
    }
    document.addEventListener('weld:context-changed', onContextChanged)
    return () => document.removeEventListener('weld:context-changed', onContextChanged)
  }, [])
  useEffect(() => {
    if (selectedPreviewMember?.activeContext) {
      setActiveContext(selectedPreviewMember.activeContext)
    }
  }, [selectedPreviewMember?.activeContext, selectedPreviewMember?.contact.id])

  const visibleTiles = (props.tiles ?? []).filter((t) => t.tile_visible)

  return (
    <>
      {isPreviewMode && (
        <section className="wa-dashboard-preview" aria-label="Member preview controls">
          <div className="wa-dashboard-preview__content">
            <p className="wa-dashboard-preview__eyebrow">Staging preview</p>
            <h2 className="wa-dashboard-preview__heading">Test member portal profiles</h2>
            <p className="wa-dashboard-preview__text">
              These are mock member profiles for layout testing only. They do not read from or write to HubSpot CRM contacts.
            </p>
          </div>
          <label className="wa-dashboard-preview__control">
            <span>Preview as</span>
            <select
              value={selectedPreviewMember?.contact.id ?? selectedPreviewId}
              onChange={(event) => setSelectedPreviewId(event.currentTarget.value)}
            >
              {previewProfiles.map((profile) => (
                <option key={profile.contact.id} value={profile.contact.id}>
                  {getPreviewProfileLabel(profile)}
                </option>
              ))}
            </select>
          </label>
        </section>
      )}

      <div
        className="wa-dashboard"
        data-member-status={member?.contact.membershipStatus ?? 'unknown'}
        data-active-context={activeContext}
      >
        {visibleTiles.map((tile, idx) => {
          const heading =
            tile.tile_heading_override || DEFAULT_HEADINGS[tile.tile_type] || undefined
          const tileId = `wa-tile-${tile.tile_type}-${idx}`
          const isFullWidth = tile.tile_type === 'welcome_banner' || tile.tile_type === 'smart_alerts'
          const tileContent = !mounted ? (
            <LoadingSkeleton lines={3} />
          ) : (
            renderTile(tile, member, props)
          )

          if (tileContent === null) return null

          return (
            <TileWrapper key={tileId} id={tileId} heading={heading} fullWidth={isFullWidth}>
              {tileContent}
            </TileWrapper>
          )
        })}
      </div>
    </>
  )
}

export default Dashboard
