/**
 * ProfileSwitcher - header utility dropdown for members with multiple contexts.
 *
 * Reads window.__WELD_MEMBER__.associations (injected by portal.html).
 * Builds a contexts array: one "Personal" entry + one per corporate association.
 * Renders nothing when total contexts < 2 (safe to mount on all portal pages).
 *
 * On context select:
 *   1. Writes wa_active_context cookie (path=/portal, SameSite=Lax)
 *   2. Mutates window.__WELD_MEMBER__.activeContext for same-session reads
 *   3. Dispatches "weld:context-changed" CustomEvent so dashboard tiles can refetch
 *
 * Resources Hub gating is evaluated server-side (portal.html unions ALL entitlements
 * regardless of active context), so no client-side gating change is needed here.
 * See CLAUDE.md §6.5.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { getMemberContext } from '@shared/api/memberContext'
import type { WeldMemberContext } from '@shared/api/memberContext'
import './ProfileSwitcher.css'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProfileContext {
  /** 'personal' | companyId string */
  key: string
  label: string
  sublabel: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildContexts(member: WeldMemberContext): ProfileContext[] {
  const contexts: ProfileContext[] = []

  const tier = member.contact.membershipTier
  contexts.push({
    key: 'personal',
    label: 'Personal',
    sublabel: tier ? formatTierLabel(tier) : 'Individual Account',
  })

  for (const assoc of member.associations) {
    contexts.push({
      key: assoc.companyId,
      label: assoc.companyName,
      sublabel: assoc.roleLabel,
    })
  }

  return contexts
}

function formatTierLabel(tier: string): string {
  return tier.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function writeCookie(contextKey: string): void {
  const maxAge = 60 * 60 * 24 * 30
  const secure = location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `wa_active_context=${encodeURIComponent(contextKey)}; path=/portal; SameSite=Lax; Max-Age=${maxAge}${secure}`
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

export interface ProfileSwitcherProps {
  /** Explicit member context - used when embedding inside the dashboard React tree. */
  member?: WeldMemberContext | null
}

export function ProfileSwitcher({ member: memberProp }: ProfileSwitcherProps = {}): React.ReactElement | null {
  const [memberCtx] = useState<WeldMemberContext | null>(() =>
    memberProp !== undefined ? memberProp : getMemberContext()
  )

  if (!memberCtx) return null

  const contexts = buildContexts(memberCtx)
  if (contexts.length < 2) return null

  return (
    <ProfileSwitcherDropdown
      contexts={contexts}
      initialActiveKey={memberCtx.activeContext}
    />
  )
}

// ---------------------------------------------------------------------------
// Dropdown UI
// ---------------------------------------------------------------------------

interface ProfileSwitcherDropdownProps {
  contexts: ProfileContext[]
  initialActiveKey: string
}

function ProfileSwitcherDropdown({
  contexts,
  initialActiveKey,
}: ProfileSwitcherDropdownProps): React.ReactElement {
  const validInitial = contexts.find((c) => c.key === initialActiveKey)
  const [activeKey, setActiveKey] = useState<string>(
    validInitial ? initialActiveKey : (contexts[0]?.key ?? 'personal')
  )
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const activeCtx = contexts.find((c) => c.key === activeKey) ?? contexts[0]!

  // Close on outside click or Escape
  useEffect(() => {
    function onOutsideClick(e: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onOutsideClick)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onOutsideClick)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [isOpen])

  const selectContext = useCallback(
    (key: string): void => {
      if (key === activeKey) {
        setIsOpen(false)
        return
      }
      setActiveKey(key)
      setIsOpen(false)
      writeCookie(key)

      if (window.__WELD_MEMBER__) {
        window.__WELD_MEMBER__.activeContext = key
      }

      document.dispatchEvent(
        new CustomEvent('weld:context-changed', { bubbles: true, detail: { context: key } })
      )

      triggerRef.current?.focus()
    },
    [activeKey]
  )

  return (
    <div className="wa-profile-switcher" ref={containerRef}>
      {/* Trigger button */}
      <button
        ref={triggerRef}
        type="button"
        className={`wa-profile-switcher__trigger${isOpen ? ' is-open' : ''}`}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={`Active profile: ${activeCtx.label} - ${activeCtx.sublabel}. Switch profile`}
        onClick={() => setIsOpen((v) => !v)}
      >
        {/* User icon */}
        <svg
          className="wa-profile-switcher__user-icon"
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
        </svg>

        {/* Label block */}
        <span className="wa-profile-switcher__trigger-text">
          <span className="wa-profile-switcher__trigger-name">{activeCtx.label}</span>
          <span className="wa-profile-switcher__trigger-role">{activeCtx.sublabel}</span>
        </span>

        {/* Chevron */}
        <svg
          className="wa-profile-switcher__chevron"
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <ul
          className="wa-profile-switcher__menu"
          role="listbox"
          aria-label="Switch profile context"
          aria-activedescendant={`wa-ctx-option-${activeKey}`}
        >
          {contexts.map((ctx) => {
            const isActive = ctx.key === activeKey
            return (
              <li
                key={ctx.key}
                id={`wa-ctx-option-${ctx.key}`}
                role="option"
                aria-selected={isActive}
              >
                <button
                  type="button"
                  className={`wa-profile-switcher__option${isActive ? ' is-active' : ''}`}
                  onClick={() => selectContext(ctx.key)}
                >
                  <span className="wa-profile-switcher__option-text">
                    <span className="wa-profile-switcher__option-name">{ctx.label}</span>
                    <span className="wa-profile-switcher__option-role">{ctx.sublabel}</span>
                  </span>
                  {isActive && (
                    <svg
                      className="wa-profile-switcher__option-check"
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                      focusable="false"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default ProfileSwitcher
