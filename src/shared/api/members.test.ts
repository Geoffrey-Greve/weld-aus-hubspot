import { describe, it, expect, vi, beforeEach } from 'vitest'
import { validateMemberCompany } from './members'
import { fetchHubDbRows } from './hubdb'

// Mock the HubDB client so no real network calls are made.
vi.mock('./hubdb', () => ({
  fetchHubDbRows: vi.fn()
}))

const mockFetch = vi.mocked(fetchHubDbRows)

function activeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    createdAt: '',
    updatedAt: '',
    path: null,
    name: null,
    values: {
      company_name: 'ACME Welding Pty Ltd',
      member_tier: { name: 'Gold' },
      hubspot_company_id: 1024,
      ...overrides
    }
  }
}

describe('validateMemberCompany', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('returns null for empty / whitespace input without hitting the network', async () => {
    expect(await validateMemberCompany('4538263', '   ')).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns null for non-numeric input without hitting the network', async () => {
    expect(await validateMemberCompany('4538263', 'ACME-1024')).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('queries the members table by hubspot_company_id and is_active, scoped to the portal', async () => {
    mockFetch.mockResolvedValueOnce([activeRow()])
    await validateMemberCompany('4538263', '1024')

    expect(mockFetch).toHaveBeenCalledWith('members', {
      portalId: '4538263',
      hubspot_company_id__eq: '1024',
      is_active__eq: true,
      limit: 1
    })
  })

  it('maps an active member row to a MemberCompany', async () => {
    mockFetch.mockResolvedValueOnce([activeRow()])
    const result = await validateMemberCompany('4538263', ' 1024 ')

    expect(result).toEqual({
      companyId: '1024',
      companyName: 'ACME Welding Pty Ltd',
      tier: 'corporate_gold'
    })
  })

  it('returns null when no active member company matches', async () => {
    mockFetch.mockResolvedValueOnce([])
    expect(await validateMemberCompany('4538263', '9999')).toBeNull()
  })

  it('normalises every member_tier label to a MembershipTier token', async () => {
    const cases: Array<[string, string]> = [
      ['Gold', 'corporate_gold'],
      ['Silver', 'corporate_silver'],
      ['Bronze', 'corporate_bronze'],
      ['Corporate Gold', 'corporate_gold'],
      ['corporate_silver', 'corporate_silver'],
      ['Reciprocal', 'reciprocal'],
      ['Industry Supplier', 'industry_supplier'],
      ['Individual', 'individual']
    ]
    for (const [label, expected] of cases) {
      mockFetch.mockResolvedValueOnce([activeRow({ member_tier: { name: label } })])
      const result = await validateMemberCompany('4538263', '1024')
      expect(result?.tier).toBe(expected)
    }
  })

  it('falls back to individual tier and a generic name for unexpected values', async () => {
    mockFetch.mockResolvedValueOnce([activeRow({ member_tier: null, company_name: '' })])
    const result = await validateMemberCompany('4538263', '1024')
    expect(result?.tier).toBe('individual')
    expect(result?.companyName).toBe('your member company')
  })

  it('propagates network errors so the caller can show a retryable message', async () => {
    mockFetch.mockRejectedValueOnce(new Error('HubDB request timed out'))
    await expect(validateMemberCompany('4538263', '1024')).rejects.toThrow('timed out')
  })
})
