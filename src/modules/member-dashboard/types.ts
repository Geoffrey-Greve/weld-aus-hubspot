/**
 * Shared types for the member-dashboard React island.
 * All data arrives synchronously via data-props (HubL-serialized) or
 * window.__WELD_MEMBER__ (injected by portal.html).
 */

import type { WeldMemberContext } from '@shared/api/memberContext'

export type TileType =
  | 'welcome_banner'
  | 'smart_alerts'
  | 'membership_status'
  | 'certifications'
  | 'upcoming_courses'
  | 'registered_events'
  | 'invoices'
  | 'geo_events'
  | 'corporate_admin'
  | 'resources_for_you'
  | 'profile_switcher'
  | 'custom_cta'

export interface TileConfig {
  tile_type: TileType
  tile_heading_override: string
  tile_visible: boolean
  custom_cta_label?: string
  custom_cta_url?: string
}

export interface GeoEvent {
  id: number | string
  event_name: string
  event_type: string
  event_date: string | number | null
  event_end_date: string | number | null
  event_state: string
  event_location: string
  registration_url: string
  is_members_only: boolean
}

export interface RegisteredEvent {
  deal_id: string
  event_name: string
  event_date: string | null
  event_location: string
  zoom_url: string | null
  ical_url: string | null
}

export interface Invoice {
  deal_id: string
  deal_name: string
  invoice_date: string | null
  amount_display: string
  pdf_url: string | null
}

export interface ResourceItem {
  id: number | string
  title: string
  category: string
  file_type: string
  file_url: string
  locked: boolean
}

export interface DashboardProps {
  welcome_message: string
  expiry_warning_days: number
  tiles: TileConfig[]
  renewal_url: string
  support_email: string
  member_state: string
  geo_events: GeoEvent[]
  registered_events: RegisteredEvent[]
  invoices: Invoice[]
  resources_for_you: ResourceItem[]
  preview_profiles?: WeldMemberContext[]
}
