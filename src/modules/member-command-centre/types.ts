export type MembershipStatus = 'Active' | 'Grace period' | 'Lapsed'

export type CertStepStatus = 'done' | 'current' | 'pending' | 'locked'

export interface CertStep {
  label: string
  note: string
  status: CertStepStatus
}

export interface PreviewProfile {
  profile_key: string
  first_name: string
  last_name: string
  initials: string
  role_title: string
  company_name: string
  /** Display label for the tier. Falls back to "Member"/"Support needed", so it is
   *  presentation only - never feed it to pricing (see pricing_member_tier). */
  member_tier: string
  /** Tier to price with. Empty when no real tier resolved, matching what
   *  course-filter.module sends, so the portal and /courses/ agree (defect 213). */
  pricing_member_tier?: string
  /** Whether this visitor is entitled to member pricing at all. */
  is_pricing_member?: boolean
  membership_status: MembershipStatus
  is_linked_member: boolean
  is_primary_admin: boolean
  member_since: string | number | null
  member_id: string
  renewal_date: string | number | null
  linked_seats: string | number | null
  linked_individual_label: string
  state: unknown
  state_raw?: unknown
  accent: 'gold' | 'silver' | 'bronze' | 'member' | 'magenta'
  banner_type: 'cert' | 'invoice' | 'event' | 'none'
  banner_title: string
  banner_body: string
  banner_cta_label: string
  banner_cta_url: string
  certification_name: string
  certification_meta: string
  cert_progress_percent: number
  cert_steps_json: string
  next_step_body: string
  next_step_cta_label: string
  next_step_cta_url: string
  invoice_number: string
  invoice_amount: number
  invoice_status: 'Paid' | 'Due' | 'Overdue'
  invoice_date: string | number | null
  invoice_pdf_url: string
  /** HubSpot hosted payable invoice page (`hs_invoice_link`). */
  invoice_pay_url?: string
  /** Outstanding balance on the latest payable invoice. */
  invoice_balance_due?: number | null
  financial_items: FinancialItem[]
  team_linked_employees: number
  team_active_members: number
  training_vouchers_used: number
  training_vouchers_total: number
  summit_tickets_used: number
  summit_tickets_total: number
}

export interface FinancialItem {
  id: string
  name: string
  type: string
  amount: string | number | null
  status: string
  date: string | number | null
  pdf_url: string
  source: string
  /** HubSpot hosted payable invoice page (`hs_invoice_link`). */
  pay_url?: string
  /** Outstanding balance; null/0 when settled. */
  balance_due?: number | null
}

export interface CourseItem {
  id: number | string
  name: string
  city: string
  state: string
  start_date: string | number | null
  end_date: string | number | null
  price_member: number
  price_individual?: number
  price_student?: number
  price_bronze?: number
  price_silver?: number
  price_gold?: number
  price_non_member: number
  status: string
  url: string
  category: string
  delivery_mode: string
}

export interface EventItem {
  id: number | string
  name: string
  type: string
  state: string
  location: string
  date: string | number | null
  end_date: string | number | null
  url: string
  members_only: boolean
}

export interface ResourceItem {
  id: number | string
  title: string
  category: string
  file_type: string
  file_url: string
  required_tier: string
  member_label: string
}

export type DashboardLayoutVariant = 'two_column' | 'wide_main' | 'balanced' | 'single_column'
export type DashboardCardStyle = 'elevated' | 'bordered' | 'flat'
export type DashboardDensity = 'comfortable' | 'compact'
export type DashboardHeroStyle = 'standard' | 'compact'

export interface DashboardTileVisibility {
  certification: boolean
  coursesEvents: boolean
  membership: boolean
  financials: boolean
  team: boolean
  resources: boolean
}

export interface DashboardSettings {
  layoutVariant: DashboardLayoutVariant
  cardStyle: DashboardCardStyle
  density: DashboardDensity
  heroStyle: DashboardHeroStyle
  showPreviewBar: boolean
  showProfileSelector: boolean
  showHeaderActions: boolean
  showAlertBanner: boolean
  showDataNote: boolean
  tiles: DashboardTileVisibility
}

export interface MemberCommandCentreProps {
  profiles: PreviewProfile[]
  courses: CourseItem[]
  events: EventItem[]
  resources: ResourceItem[]
  settings?: Partial<DashboardSettings> & {
    tiles?: Partial<DashboardTileVisibility>
  }
  labels: {
    trainingUrl: string
    profileUrl: string
    membershipUrl: string
    resourcesUrl: string
    teamUrl: string
    supportPhone: string
    supportUrl: string
  }
}
