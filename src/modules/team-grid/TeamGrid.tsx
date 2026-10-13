import React, { useState, useMemo, useCallback } from 'react'
import { Modal } from '@shared/components/Modal'
import { EmptyState } from '@shared/components/EmptyState'
import './TeamGrid.css'

// ---------------------------------------------------------------------------
// Types (mirrors HubDB Table 3 - team_and_board, per CLAUDE.md §7.3)
// ---------------------------------------------------------------------------

export interface TeamMemberRow {
  id: number | string
  name: string
  role: string
  category: string  // 'Executive' | 'Board' | 'Engineering' | 'Training' | 'Q&C'
  headshot_url: string
  headshot_alt: string
  bio: string       // rich text HTML
  display_order: number
}

export interface TeamGridProps {
  rows: TeamMemberRow[]
  section_heading: string
  intro: string             // rich text HTML
  show_category_tabs: boolean
  show_bio_modal: boolean
  category_filter: string   // editor's default filter key ('any' | 'executive' | 'board' | etc.)
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Canonical category display order. */
const CATEGORY_ORDER: string[] = ['Executive', 'Board', 'Engineering', 'Training', 'Q&C']

/** Derive initials from a full name (up to 2 letters). */
function getInitials(name: string): string {
  const words = name.trim().split(/\s+/)
  return words
    .map((w) => w[0] ?? '')
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

// ---------------------------------------------------------------------------
// MemberCard sub-component
// ---------------------------------------------------------------------------

interface MemberCardProps {
  member: TeamMemberRow
  showBioModal: boolean
  onSelect: (member: TeamMemberRow) => void
}

function MemberCard({ member, showBioModal, onSelect }: MemberCardProps): React.ReactElement {
  const isClickable = showBioModal && Boolean(member.bio)

  const handleClick = () => {
    if (isClickable) onSelect(member)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isClickable && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault()
      onSelect(member)
    }
  }

  return (
    <article
      className={[
        'wa-tg__card',
        isClickable ? 'wa-tg__card--clickable' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={isClickable ? handleClick : undefined}
      onKeyDown={isClickable ? handleKeyDown : undefined}
      tabIndex={isClickable ? 0 : undefined}
      role={isClickable ? 'button' : undefined}
      aria-label={isClickable ? `View bio for ${member.name}` : undefined}
    >
      {/* Headshot */}
      <div className="wa-tg__card-photo">
        {member.headshot_url ? (
          <img
            src={member.headshot_url}
            alt={member.headshot_alt || member.name}
            className="wa-tg__photo-img"
            loading="lazy"
            width={160}
            height={160}
          />
        ) : (
          <div className="wa-tg__photo-initials" aria-hidden="true">
            {getInitials(member.name)}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="wa-tg__card-info">
        <h3 className="wa-tg__card-name">{member.name}</h3>
        <p className="wa-tg__card-role">{member.role}</p>
        {member.category && (
          <span className="wa-tg__card-category">{member.category}</span>
        )}
        {isClickable && (
          <span className="wa-tg__card-bio-hint" aria-hidden="true">
            View bio →
          </span>
        )}
      </div>
    </article>
  )
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export function TeamGrid({
  rows,
  section_heading,
  intro,
  show_category_tabs,
  show_bio_modal,
}: TeamGridProps): React.ReactElement {
  // Derive unique categories from rows in canonical order
  const categoriesPresent = useMemo<string[]>(() => {
    const cats = new Set(rows.map((r) => r.category).filter(Boolean))
    const ordered = CATEGORY_ORDER.filter((c) => cats.has(c))
    // Append any categories not in the canonical list
    for (const c of cats) {
      if (!ordered.includes(c)) ordered.push(c)
    }
    return ordered
  }, [rows])

  const [activeCategory, setActiveCategory] = useState<string>('All')
  const [selectedMember, setSelectedMember] = useState<TeamMemberRow | null>(null)

  // Filtered rows based on active category tab
  const filteredRows = useMemo<TeamMemberRow[]>(() => {
    if (activeCategory === 'All') return rows
    return rows.filter((r) => r.category === activeCategory)
  }, [rows, activeCategory])

  const handleTabClick = useCallback((cat: string) => {
    setActiveCategory(cat)
  }, [])

  const handleCardSelect = useCallback((member: TeamMemberRow) => {
    setSelectedMember(member)
  }, [])

  const handleModalClose = useCallback(() => {
    setSelectedMember(null)
  }, [])

  return (
    <div className="wa-tg">
      {/* Header */}
      {(section_heading || intro) && (
        <div className="wa-tg__header">
          {section_heading && <h2 className="wa-tg__heading">{section_heading}</h2>}
          {intro && (
            <div
              className="wa-tg__intro"
              dangerouslySetInnerHTML={{ __html: intro }}
            />
          )}
        </div>
      )}

      {/* Category tabs */}
      {show_category_tabs && categoriesPresent.length > 1 && (
        <div className="wa-tg__tabs" role="tablist" aria-label="Filter by category">
          <button
            type="button"
            role="tab"
            className={['wa-tg__tab', activeCategory === 'All' ? 'wa-tg__tab--active' : '']
              .filter(Boolean)
              .join(' ')}
            aria-selected={activeCategory === 'All'}
            onClick={() => handleTabClick('All')}
          >
            All
          </button>
          {categoriesPresent.map((cat) => (
            <button
              key={cat}
              type="button"
              role="tab"
              className={['wa-tg__tab', activeCategory === cat ? 'wa-tg__tab--active' : '']
                .filter(Boolean)
                .join(' ')}
              aria-selected={activeCategory === cat}
              onClick={() => handleTabClick(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* Grid or empty state */}
      {filteredRows.length > 0 ? (
        <ul className="wa-tg__grid" role="list">
          {filteredRows.map((member) => (
            <li key={member.id} className="wa-tg__grid-item">
              <MemberCard
                member={member}
                showBioModal={show_bio_modal}
                onSelect={handleCardSelect}
              />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          heading="No team members to display."
          body={activeCategory !== 'All' ? 'Try selecting a different category.' : undefined}
          action={
            activeCategory !== 'All' ? (
              <button
                type="button"
                className="wa-btn wa-btn--secondary"
                onClick={() => handleTabClick('All')}
              >
                Show all
              </button>
            ) : undefined
          }
        />
      )}

      {/* Bio modal */}
      {show_bio_modal && (
        <Modal
          open={selectedMember !== null}
          onClose={handleModalClose}
          title={selectedMember ? selectedMember.name : undefined}
          size="md"
        >
          {selectedMember && (
            <div className="wa-tg__modal-body">
              <p className="wa-tg__modal-role">{selectedMember.role}</p>
              {selectedMember.category && (
                <span className="wa-tg__card-category">{selectedMember.category}</span>
              )}
              <div
                className="wa-tg__modal-bio"
                dangerouslySetInnerHTML={{ __html: selectedMember.bio }}
              />
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}

export default TeamGrid
