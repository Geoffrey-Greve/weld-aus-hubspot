import { describe, expect, it } from 'vitest'
import { tableUpdatePayload } from './hubdb-table-payload'

describe('tableUpdatePayload', () => {
  const courses = {
    id: '123',
    name: 'courses',
    label: 'Courses',
    useForPages: true,
    allowPublicApiAccess: true,
    allowChildTables: false,
    enableChildTablePages: false,
    dynamicMetaTags: { PAGE_TITLE: 7, META_DESCRIPTION: 8 },
    columns: [{ name: 'status', type: 'SELECT', options: [] }],
  }
  const nextColumns = [{ name: 'status', type: 'SELECT', options: [{ name: 'Closed', type: 'option' }] }]

  it('carries the settings a publish would otherwise reset', () => {
    const body = tableUpdatePayload(courses, nextColumns)
    expect(body).toMatchObject({
      name: 'courses',
      label: 'Courses',
      useForPages: true,
      allowPublicApiAccess: true,
      dynamicMetaTags: { PAGE_TITLE: 7, META_DESCRIPTION: 8 },
    })
  })

  it('sends the NEW columns, not the ones it read', () => {
    expect(tableUpdatePayload(courses, nextColumns).columns).toBe(nextColumns)
  })

  it('never widens access on a table that did not say', () => {
    // A missing flag must not come back as public: jobs holds employer emails.
    const body = tableUpdatePayload({ name: 'jobs', label: 'Jobs' }, [])
    expect(body.allowPublicApiAccess).toBe(false)
    expect(body.useForPages).toBe(false)
    expect(body).not.toHaveProperty('dynamicMetaTags')
  })

  it('does not send the table id or other read-only fields', () => {
    expect(tableUpdatePayload(courses, nextColumns)).not.toHaveProperty('id')
  })
})
