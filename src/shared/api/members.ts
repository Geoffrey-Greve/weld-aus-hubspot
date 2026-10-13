/**
 * Member company validation.
 *
 * Lets the checkout tunnel resolve a member discount for a buyer who is not a
 * logged-in member (a guest, or an employee of a corporate member) by looking
 * up a company ID against the public "Find a Member" HubDB table.
 *
 * The lookup key is the `hubspot_company_id` column (CLAUDE.md §7.2) - the
 * back-reference to the HubSpot Company record. Any active member company
 * (`is_active = true`, any tier) unlocks the member rate.
 *
 * SECURITY - accepted risk (Ryan, 2026-07). The unlock key is `hubspot_company_id`,
 * which is PUBLICLY ENUMERABLE: the "Find a Member" HubDB table is served with
 * `allowPublicApiAccess: true` and exposes `hubspot_company_id` in every row, so
 * anyone can list the directory, copy any active company's ID (including a Gold
 * member's), and unlock its rate here without belonging to that company. This is
 * a deliberate product decision to keep guest self-service (no login required),
 * NOT an oversight - the check below cannot be made tamper-proof on a public page
 * because any client-side lookup against public HubDB is enumerable by definition.
 *
 * The discount resolved here is therefore a NON-BINDING PREVIEW only. The
 * authoritative member price MUST be re-validated and charged server-side using
 * the forwarded company ID. That is why every paid path forwards `memberCompanyId`
 * for the backend to re-validate before charging:
 *   - Event Engine: `ReserveBody.memberCompanyId` + `expectedUnitCents` (see eventEngine.ts).
 *   - Stripe:       `member_company_id` in the /api/checkout/payment-intent body.
 *   - Redirect/hapily: `wa_member_company_id` + `wa_member_tier` query params (see registration.ts).
 * Without that server-side re-validation the preview discount is spoofable - by design.
 * See CheckoutTunnel Step 4.
 */

import { fetchHubDbRows } from './hubdb'
import type { MembershipTier } from './memberContext'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A validated, active member company resolved from the members HubDB table. */
export interface MemberCompany {
  /** The HubSpot Company record ID (the value the user typed). */
  companyId: string
  /** Display name, e.g. for the "applied via {company}" confirmation. */
  companyName: string
  /** Normalised membership tier token (see MembershipTier). */
  tier: MembershipTier
}

/** Shape of the members-table columns this lookup reads. */
interface MembersRow extends Record<string, unknown> {
  company_name?: string
  member_tier?: { name?: string } | string | null
  hubspot_company_id?: number | string
}

// ---------------------------------------------------------------------------
// Tier normalisation
// ---------------------------------------------------------------------------

/**
 * Map the members-table `member_tier` SELECT label (title case) to the same
 * MembershipTier tokens used across the app. These tokens also normalise
 * correctly through memberPricing.normaliseMemberPriceTier (substring match)
 * and are forwarded to hapily as `wa_member_tier`.
 *
 * Exact HubDB labels are "Gold" / "Silver" / …, but CRM company levels often
 * arrive as "Corporate Gold". Substring match keeps both working - a blind
 * fallback to `individual` was quoting the full rate for Gold companies
 * (defect 126).
 */
function normaliseTier(raw: MembersRow['member_tier']): MembershipTier {
  const label = (typeof raw === 'string' ? raw : (raw?.name ?? '')).trim().toLowerCase()
  if (!label) return 'individual'
  if (label.includes('gold')) return 'corporate_gold'
  if (label.includes('silver')) return 'corporate_silver'
  if (label.includes('bronze')) return 'corporate_bronze'
  if (label.includes('reciprocal')) return 'reciprocal'
  if (label.includes('industry supplier') || label.includes('industry_supplier')) {
    return 'industry_supplier'
  }
  if (label.includes('individual')) return 'individual'
  return 'individual'
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate a company ID against the active member companies in HubDB.
 *
 * @param portalId  HubSpot portal/hub ID - required for the public HubDB read.
 * @param companyId The company ID the user typed (matched against `hubspot_company_id`).
 * @returns The resolved MemberCompany, or `null` when the input is empty /
 *          non-numeric, or no matching active member company exists.
 * @throws  Propagates network/HubDB errors (5xx, timeout) so the caller can
 *          show a retryable message - a thrown error is distinct from `null`.
 */
export async function validateMemberCompany(
  portalId: string,
  companyId: string
): Promise<MemberCompany | null> {
  const trimmed = companyId.trim()
  // The hubspot_company_id column is numeric - reject anything that isn't a
  // plain integer without hitting the network.
  if (!/^\d+$/.test(trimmed)) return null

  const rows = await fetchHubDbRows<MembersRow>('members', {
    portalId,
    hubspot_company_id__eq: trimmed,
    is_active__eq: true,
    limit: 1
  })

  const row = rows[0]
  if (!row) return null

  return {
    companyId: trimmed,
    companyName: (row.values.company_name ?? '').trim() || 'your member company',
    tier: normaliseTier(row.values.member_tier)
  }
}
