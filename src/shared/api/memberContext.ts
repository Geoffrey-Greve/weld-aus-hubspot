/**
 * Member context reader.
 *
 * The HubSpot portal layout (`portal.html`) injects `window.__WELD_MEMBER__`
 * for logged-in members via a HubL snippet. This module provides typed access
 * to that data for React islands, plus a `useMemberContext()` hook for components.
 *
 * See CLAUDE.md § 8 for the CRM properties that back these fields.
 * See CLAUDE.md § 9 for the membership wall and authentication model.
 */

import { useState } from 'react'

// ---------------------------------------------------------------------------
// Scalar union types
// ---------------------------------------------------------------------------

export type MembershipTier =
  | 'individual'
  | 'apprentice'
  | 'reciprocal'
  | 'corporate_gold'
  | 'corporate_silver'
  | 'corporate_bronze'
  | 'industry_supplier'
  | 'honorary'

export type MembershipStatus = 'active' | 'grace_period' | 'lapsed' | 'never_member' | 'honorary'

// ---------------------------------------------------------------------------
// Shape interfaces - mirror the object injected by portal.html
// ---------------------------------------------------------------------------

export interface MemberContact {
  id: string
  firstName: string
  lastName: string
  email: string
  membershipTier: MembershipTier | null
  membershipStatus: MembershipStatus
  /** ISO date string, or null if no expiry is set. */
  membershipExpiry: string | null
  nextCourse: {
    name: string | null
    /** ISO date string, or null. */
    date: string | null
    location: string | null
  }
}

export interface MemberAssociation {
  companyId: string
  companyName: string
  /** e.g. 'Primary Admin', 'Employee', 'Apprentice', 'Reciprocal Member' */
  roleLabel: string
  tier: MembershipTier | null
}

export interface MemberCertification {
  /** e.g. 'as1796', 'iiw_inspector', 'iso3834' */
  type: string
  status: string
  /** ISO date string, or null. */
  expiry: string | null
  certificateUrl: string | null
  currentStep: string | null
}

export interface MemberEntitlements {
  /** True when membership status is active or grace_period. */
  canDownloadResources: boolean
  /** True when the contact holds a Primary Admin association label on a company. */
  isPrimaryAdmin: boolean
}

export interface WeldMemberContext {
  contact: MemberContact
  /**
   * All active company associations for this contact.
   * Phase 1: at most one entry (primary associated company).
   * Phase 2: full list for the ProfileSwitcher multi-company flow.
   */
  associations: MemberAssociation[]
  /**
   * The active profile context. Set by the ProfileSwitcher via the
   * `wa_active_context` cookie; defaults to 'personal'.
   */
  activeContext: string
  certifications: MemberCertification[]
  entitlements: MemberEntitlements
}

// ---------------------------------------------------------------------------
// Global augmentation
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    __WELD_MEMBER__?: WeldMemberContext
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read the logged-in member context injected by the HubSpot portal layout.
 *
 * Returns `null` on public pages (where `window.__WELD_MEMBER__` is absent)
 * or if the injected value fails a basic shape check.
 */
export function getMemberContext(): WeldMemberContext | null {
  const raw = window.__WELD_MEMBER__
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  // Minimal shape guard - ensures the contact sub-object is present.
  const typed = raw as WeldMemberContext
  if (!typed.contact || typeof typed.contact !== 'object') return null
  return typed
}

/**
 * React hook that returns the logged-in member context.
 *
 * Uses a lazy `useState` initialiser so `window.__WELD_MEMBER__` is read
 * once on mount (the value is server-injected before React hydrates and
 * does not change within a page session - context switches trigger a reload).
 *
 * Returns `null` on public pages where the context object is absent.
 */
export function useMemberContext(): WeldMemberContext | null {
  const [ctx] = useState<WeldMemberContext | null>(() => getMemberContext())
  return ctx
}

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

/**
 * Returns true if the member has an active or grace-period membership.
 * Lapsed and never-member contacts return false.
 */
export function isMember(ctx: WeldMemberContext | null): boolean {
  if (!ctx) return false
  const { membershipStatus } = ctx.contact
  return membershipStatus === 'active' || membershipStatus === 'grace_period' || membershipStatus === 'honorary'
}

/**
 * Returns true when the current member is an Honorary member.
 *
 * Honorary members do not lapse/expire, so dashboard renewal warnings and
 * expiry CTAs should be suppressed even if a legacy expiry field is empty.
 */
export function isHonoraryMember(ctx: WeldMemberContext | null): boolean {
  if (!ctx) return false
  if (ctx.contact.membershipStatus === 'honorary') return true
  if (ctx.contact.membershipTier === 'honorary') return true
  return ctx.associations.some((a) => a.tier === 'honorary')
}

/**
 * Returns true if the member holds the specified membership tier.
 *
 * Checks the contact's own tier AND all corporate associations, so an
 * Employee of a Corporate Gold company passes `hasTier(ctx, 'corporate_gold')`.
 */
export function hasTier(ctx: WeldMemberContext | null, tier: MembershipTier): boolean {
  if (!ctx) return false
  if (ctx.contact.membershipTier === tier) return true
  return ctx.associations.some((a) => a.tier === tier)
}
