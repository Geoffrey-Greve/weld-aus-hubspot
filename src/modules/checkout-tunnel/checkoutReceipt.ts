export interface CheckoutReceipt {
  registration_type?: 'course' | 'event'
  course_name: string
  city: string
  start_date: string
  end_date: string
  amount_paid: number
  is_member_price: boolean
  zoom_link: string
  purchaser_name: string
  purchaser_email: string
}

export const CHECKOUT_STORAGE_KEY = 'wa_checkout_session'

export function saveCheckoutReceipt(receipt: CheckoutReceipt): void {
  try {
    sessionStorage.setItem(CHECKOUT_STORAGE_KEY, JSON.stringify(receipt))
  } catch {
    // sessionStorage unavailable (private browsing modes) - non-fatal
  }
}
