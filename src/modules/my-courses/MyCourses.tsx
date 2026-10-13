import React, { useState } from 'react'
import type { CourseItem, MyCoursesProps } from './types'

type Tab = 'upcoming' | 'past'

function formatDate(iso: string | null): string {
  if (!iso) return ''
  const ms = Date.parse(iso)
  if (isNaN(ms)) return iso
  return new Date(ms).toLocaleDateString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function downloadCalendar(course: CourseItem): void {
  const start = course.course_date ? new Date(course.course_date) : new Date()
  const end = course.course_end_date
    ? new Date(course.course_end_date)
    : new Date(start.getTime() + 8 * 60 * 60 * 1000)

  const pad = (n: number) => String(n).padStart(2, '0')
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Weld Australia//Member Portal//EN',
    'BEGIN:VEVENT',
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${course.course_name}`,
    course.location ? `LOCATION:${course.location}` : '',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .filter(Boolean)
    .join('\r\n')

  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${course.course_name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.ics`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function isUpcoming(course: CourseItem): boolean {
  if (!course.course_date) return true
  return Date.parse(course.course_date) >= Date.now()
}

function CourseCard({ course, tab }: { course: CourseItem; tab: Tab }): React.ReactElement {
  const startStr = formatDate(course.course_date)
  const endStr = formatDate(course.course_end_date)

  return (
    <div className="wa-my-courses__card">
      <div className="wa-my-courses__card-body">
        <h3 className="wa-my-courses__card-name">{course.course_name}</h3>
        {course.course_category && (
          <span className="wa-my-courses__badge">{course.course_category}</span>
        )}
        <p className="wa-my-courses__card-meta">
          {startStr && (
            <span>
              {startStr}
              {endStr && endStr !== startStr ? ` - ${endStr}` : ''}
            </span>
          )}
          {course.location && <span>{course.location}</span>}
        </p>
      </div>
      <div className="wa-my-courses__card-actions">
        {tab === 'upcoming' && (
          <button
            type="button"
            className="wa-btn wa-btn--sm wa-btn--secondary"
            onClick={() => downloadCalendar(course)}
            aria-label={`Add ${course.course_name} to calendar`}
          >
            Add to calendar
          </button>
        )}
        {tab === 'past' && course.completion_certificate_url && (
          <a
            href={course.completion_certificate_url}
            className="wa-btn wa-btn--sm wa-btn--primary"
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Download completion certificate for ${course.course_name}`}
          >
            Download certificate
          </a>
        )}
        {course.registration_url && tab === 'upcoming' && (
          <a
            href={course.registration_url}
            className="wa-btn wa-btn--sm wa-btn--primary"
            target="_blank"
            rel="noopener noreferrer"
          >
            View details
          </a>
        )}
      </div>
    </div>
  )
}

function CourseRow({ course, tab }: { course: CourseItem; tab: Tab }): React.ReactElement {
  const startStr = formatDate(course.course_date)
  const endStr = formatDate(course.course_end_date)

  return (
    <tr className="wa-my-courses__row">
      <td className="wa-my-courses__cell">
        <span className="wa-my-courses__name">{course.course_name}</span>
        {course.course_category && (
          <span className="wa-my-courses__badge wa-my-courses__badge--inline">
            {course.course_category}
          </span>
        )}
      </td>
      <td className="wa-my-courses__cell">
        {startStr}
        {endStr && endStr !== startStr ? ` - ${endStr}` : ''}
      </td>
      <td className="wa-my-courses__cell">{course.location || '-'}</td>
      <td className="wa-my-courses__cell wa-my-courses__cell--actions">
        {tab === 'upcoming' && (
          <button
            type="button"
            className="wa-btn wa-btn--sm wa-btn--secondary"
            onClick={() => downloadCalendar(course)}
            aria-label={`Add ${course.course_name} to calendar`}
          >
            Add to calendar
          </button>
        )}
        {tab === 'past' && course.completion_certificate_url && (
          <a
            href={course.completion_certificate_url}
            className="wa-btn wa-btn--sm wa-btn--primary"
            target="_blank"
            rel="noopener noreferrer"
          >
            Download certificate
          </a>
        )}
        {course.registration_url && tab === 'upcoming' && (
          <a
            href={course.registration_url}
            className="wa-btn wa-btn--sm wa-btn--primary"
            target="_blank"
            rel="noopener noreferrer"
          >
            View details
          </a>
        )}
      </td>
    </tr>
  )
}

function EmptyState({
  tab,
  browseUrl,
  message,
  supportEmail,
}: {
  tab: Tab
  browseUrl: string
  message: string
  supportEmail: string
}): React.ReactElement {
  if (tab === 'upcoming') {
    return (
      <div className="wa-my-courses__empty">
        <p className="wa-my-courses__empty-message">
          {message || 'No upcoming courses booked.'}{' '}
          <a href={browseUrl} className="wa-link">
            Browse the course timetable
          </a>{' '}
          to find your next session.
        </p>
      </div>
    )
  }
  return (
    <div className="wa-my-courses__empty">
      <p className="wa-my-courses__empty-message">
        No past courses on record yet. If you believe this is incorrect,{' '}
        <a href={`mailto:${supportEmail}`} className="wa-link">
          contact us
        </a>
        .
      </p>
    </div>
  )
}

export function MyCourses({
  courses,
  empty_state_message,
  browse_url,
  support_email,
}: MyCoursesProps): React.ReactElement {
  const [activeTab, setActiveTab] = useState<Tab>('upcoming')

  const upcoming = courses.filter(isUpcoming)
  const past = courses.filter((c) => !isUpcoming(c))
  const visible = activeTab === 'upcoming' ? upcoming : past

  return (
    <div className="wa-my-courses">
      <div className="wa-tab-switcher" role="tablist" aria-label="My Courses">
        <button
          role="tab"
          aria-selected={activeTab === 'upcoming'}
          className={`wa-tab-switcher__tab${activeTab === 'upcoming' ? ' wa-tab-switcher__tab--active' : ''}`}
          onClick={() => setActiveTab('upcoming')}
        >
          Upcoming
          {upcoming.length > 0 && (
            <span className="wa-tab-switcher__count" aria-label={`${upcoming.length} upcoming`}>
              {upcoming.length}
            </span>
          )}
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'past'}
          className={`wa-tab-switcher__tab${activeTab === 'past' ? ' wa-tab-switcher__tab--active' : ''}`}
          onClick={() => setActiveTab('past')}
        >
          Past
          {past.length > 0 && (
            <span className="wa-tab-switcher__count" aria-label={`${past.length} past`}>
              {past.length}
            </span>
          )}
        </button>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          tab={activeTab}
          browseUrl={browse_url}
          message={empty_state_message}
          supportEmail={support_email}
        />
      ) : (
        <>
          {/* Mobile: cards */}
          <div className="wa-my-courses__cards" aria-label={`${activeTab} courses`}>
            {visible.map((c) => (
              <CourseCard key={c.deal_id} course={c} tab={activeTab} />
            ))}
          </div>

          {/* Desktop: table */}
          <div className="wa-my-courses__table-wrap" aria-label={`${activeTab} courses`}>
            <table className="wa-my-courses__table">
              <thead>
                <tr>
                  <th scope="col" className="wa-my-courses__th">Course</th>
                  <th scope="col" className="wa-my-courses__th">Date</th>
                  <th scope="col" className="wa-my-courses__th">Location</th>
                  <th scope="col" className="wa-my-courses__th">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((c) => (
                  <CourseRow key={c.deal_id} course={c} tab={activeTab} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="wa-my-courses__footnote">
        Course history is synced from your training records.{' '}
        <a href={`mailto:${support_email}`} className="wa-link">
          Contact us
        </a>{' '}
        if something looks wrong.
      </p>
    </div>
  )
}
