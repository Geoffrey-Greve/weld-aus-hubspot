import React from 'react'

interface NextCourse {
  name: string | null
  date: string | null
  location: string | null
}

interface UpcomingCoursesProps {
  nextCourse: NextCourse | null
}

function formatDate(isoDate: string | null): string {
  if (!isoDate) return ''
  const ms = Date.parse(isoDate)
  if (isNaN(ms)) return isoDate
  return new Date(ms).toLocaleDateString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

export function UpcomingCourses({ nextCourse }: UpcomingCoursesProps): React.ReactElement {
  if (!nextCourse?.name) {
    return (
      <div className="wa-tile-empty">
        <div className="wa-tile-empty__icon" aria-hidden="true">📚</div>
        <p className="wa-tile-empty__message">
          No registered courses are synced to your portal yet.{' '}
          <a href="/courses/" className="wa-link">
            Browse the course timetable
          </a>
        </p>
        <p className="wa-tile-empty__hint">
          Course bookings will appear here once the HubSpot enrolment sync is active.
        </p>
      </div>
    )
  }

  const dateStr = formatDate(nextCourse.date)

  return (
    <div className="wa-upcoming-courses">
      <p className="wa-dashboard__tile-kicker">Next registered course</p>
      <div className="wa-course-row">
        <h3 className="wa-course-row__name">{nextCourse.name}</h3>
        <p className="wa-course-row__meta">
          {dateStr && <span>{dateStr}</span>}
          {nextCourse.location && <span>{nextCourse.location}</span>}
        </p>
        <div className="wa-dash-card__actions">
          <a href="/courses/" className="wa-dash-card__action wa-dash-card__action--primary">
            View course timetable
          </a>
        </div>
      </div>

      <a href="/courses/" className="wa-link" style={{ fontSize: '0.875rem' }}>
        View all courses →
      </a>
    </div>
  )
}
