import { afterEach, describe, expect, it, vi } from 'vitest'
import { postCorporateAction } from './corporateApi'

describe('postCorporateAction', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('posts to the same-origin membership proxy with credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, status: 'registered' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await postCorporateAction(
      'add-employee',
      {
        companyId: '123',
        actorContactId: 'spoofed-admin',
        actor_contact_id: 'also-spoofed',
        email: 'new@abc.com.au',
        firstName: 'New',
      },
      { portalId: '441838610' }
    )

    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/_hcms/api/corporate/add-employee')
    expect(init.credentials).toBe('same-origin')
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' })
    expect(init.headers).not.toHaveProperty('Authorization')

    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body).toEqual({
      companyId: '123',
      email: 'new@abc.com.au',
      firstName: 'New',
      portalId: '441838610',
    })
    // A caller-supplied identity must never survive into the request — the
    // authenticated handler derives the actor from the membership session.
    expect(body).not.toHaveProperty('actorContactId')
    expect(body).not.toHaveProperty('actor_contact_id')
  })

  it('uses a signed Worker token when minted for the logged-in admin', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await postCorporateAction(
      'remove-employee',
      { companyId: '123', employeeId: '222', actorContactId: 'spoofed' },
      {
        portalId: '441838610',
        actionToken: 'signed.admin.token',
        workerBaseUrl: 'https://event-engine.example.workers.dev/',
      }
    )

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://event-engine.example.workers.dev/api/v1/corporate/remove-employee')
    expect(init.credentials).toBe('omit')
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer signed.admin.token',
      'X-Portal-Id': '441838610',
    })

    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body).not.toHaveProperty('actorContactId')
    expect(body.employeeId).toBe('222')
  })

  it('falls back to Event Engine when HubSpot serverless is not configured', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: 'No function configured for this endpoint.' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, status: 'removed' }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const result = await postCorporateAction(
      'remove-employee',
      { companyId: '123', employeeId: '222', actorContactId: 'spoofed' },
      {
        portalId: '441838610',
        actorContactId: '999',
        workerBaseUrl: 'https://event-engine.example.workers.dev/',
      }
    )

    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const [firstUrl, firstInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(firstUrl).toBe('/_hcms/api/corporate/remove-employee')
    expect(firstInit.credentials).toBe('same-origin')

    const [fallbackUrl, fallbackInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(fallbackUrl).toBe('https://event-engine.example.workers.dev/api/v1/corporate/remove-employee')
    expect(fallbackInit.credentials).toBe('omit')
    expect(fallbackInit.headers).toMatchObject({
      'X-Portal-Id': '441838610',
      'Content-Type': 'application/json',
    })
    expect(fallbackInit.headers).not.toHaveProperty('Authorization')

    const body = JSON.parse(String(fallbackInit.body)) as Record<string, unknown>
    expect(body).toEqual({
      companyId: '123',
      employeeId: '222',
      portalId: '441838610',
      actorContactId: '999',
    })
  })
})
