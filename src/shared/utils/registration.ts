/**
 * Appends member context to an Event Engine registration/checkout URL so the
 * engine can resolve member pricing server-side and pre-select the correct
 * ticket/tier:
 *   - `wa_member_tier`       - the effective membership tier.
 *   - `wa_member_company_id` - the validated member company ID, when the
 *     discount was unlocked by entering a company ID at checkout. This lets
 *     the backend re-validate the discount (the client price is a preview).
 *
 * Returns the URL unchanged when memberTier is empty (guest/non-member).
 */
export function buildRegistrationUrl(
  registrationUrl: string,
  memberTier: string,
  memberCompanyId?: string
): string {
  if (!registrationUrl || !memberTier) return registrationUrl

  const params: Array<[string, string]> = [['wa_member_tier', memberTier]]
  if (memberCompanyId) params.push(['wa_member_company_id', memberCompanyId])

  try {
    const url = new URL(registrationUrl)
    for (const [key, value] of params) url.searchParams.set(key, value)
    return url.toString()
  } catch {
    // Fallback for relative URLs (should not occur in production)
    let result = registrationUrl
    for (const [key, value] of params) {
      const sep = result.includes('?') ? '&' : '?'
      result += `${sep}${key}=${encodeURIComponent(value)}`
    }
    return result
  }
}
