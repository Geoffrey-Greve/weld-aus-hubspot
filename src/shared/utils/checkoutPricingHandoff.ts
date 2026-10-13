export const CHECKOUT_PRICING_HANDOFF_KEY = 'wa_checkout_pricing_handoff'

const HANDOFF_TTL_MS = 15 * 60 * 1000

export interface CheckoutPricingHandoff {
  sessionId: string
  isMember: boolean
  memberTier: string
  expiresAt: number
}

export interface ResolvedCheckoutPricingHandoff {
  isMember: boolean
  memberTier: string
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null
  } catch {
    return null
  }
}

export function saveCheckoutPricingHandoff({
  sessionId,
  isMember,
  memberTier,
}: {
  sessionId: string | number
  isMember: boolean
  memberTier: string
}): void {
  const store = storage()
  if (!store) return

  const payload: CheckoutPricingHandoff = {
    sessionId: String(sessionId),
    isMember,
    memberTier,
    expiresAt: Date.now() + HANDOFF_TTL_MS,
  }

  try {
    store.setItem(CHECKOUT_PRICING_HANDOFF_KEY, JSON.stringify(payload))
  } catch {
    // Session storage is a convenience handoff only; checkout still works
    // without it and Event Engine remains authoritative for final pricing.
  }
}

export function readCheckoutPricingHandoff(
  sessionId: string | number | null | undefined
): ResolvedCheckoutPricingHandoff | null {
  if (sessionId == null) return null
  const store = storage()
  if (!store) return null

  try {
    const raw = store.getItem(CHECKOUT_PRICING_HANDOFF_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CheckoutPricingHandoff>
    if (String(parsed.sessionId || '') !== String(sessionId)) return null
    if (!parsed.expiresAt || parsed.expiresAt < Date.now()) {
      store.removeItem(CHECKOUT_PRICING_HANDOFF_KEY)
      return null
    }
    if (!parsed.isMember) return null
    return {
      isMember: true,
      memberTier: typeof parsed.memberTier === 'string' ? parsed.memberTier : '',
    }
  } catch {
    return null
  }
}
