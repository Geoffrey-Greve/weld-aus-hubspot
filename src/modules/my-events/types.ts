export interface EventItem {
  deal_id: string
  event_name: string
  event_date: string | null
  event_end_date: string | null
  event_location: string
  zoom_url: string | null
  registration_url: string | null
}

export interface MyEventsProps {
  events: EventItem[]
  empty_state_message: string
  browse_url: string
}
