/**
 * HubDB v2 read client.
 *
 * Provides typed access to HubDB tables with retry, timeout, and
 * request deduplication. Read-only - mutations go through workflows.
 *
 * See CLAUDE.md § 7 for the table schemas this client serves.
 */

const BASE_URL = 'https://api.hubapi.com/cms/v3/hubdb/tables'
const TIMEOUT_MS = 10_000
const MAX_RETRIES = 3
const BACKOFF_MS = [500, 1000, 2000] as const

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single row returned by the HubDB v2 API. */
export type HubDbRow<T extends Record<string, unknown> = Record<string, unknown>> = {
  id: number
  createdAt: string
  updatedAt: string
  path: string | null
  name: string | null
  values: T
}

/** The envelope returned by HubDB list/query endpoints. */
export type HubDbResponse<T extends Record<string, unknown> = Record<string, unknown>> = {
  total: number
  results: HubDbRow<T>[]
}

/** Query parameters accepted by HubDB v2 row endpoints. */
export type HubDbQueryParams = {
  limit?: number
  offset?: number
  sort?: string[]
  properties?: string[]
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Request deduplication
// ---------------------------------------------------------------------------

/** In-flight requests keyed by the full request URL (including serialised params). */
const inFlight = new Map<string, Promise<HubDbRow[]>>()

function buildUrl(tableId: string, params: HubDbQueryParams): string {
  const url = new URL(`${BASE_URL}/${tableId}/rows`)
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      value.forEach((v) => url.searchParams.append(key, String(v)))
    } else {
      url.searchParams.set(key, String(value))
    }
  }
  return url.toString()
}

// ---------------------------------------------------------------------------
// Core fetch with retry + timeout
// ---------------------------------------------------------------------------

async function fetchWithRetry(url: string): Promise<Response> {
  let lastError: unknown

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      const response = await fetch(url, { signal: controller.signal })
      clearTimeout(timer)

      if (response.ok) return response

      // Only retry on 5xx errors
      if (response.status >= 500) {
        lastError = new Error(
          `HubDB request failed with status ${response.status} ${response.statusText}`
        )
        if (attempt < MAX_RETRIES - 1) {
          const delay = BACKOFF_MS[attempt] ?? BACKOFF_MS[BACKOFF_MS.length - 1]!
          await new Promise((res) => setTimeout(res, delay))
          continue
        }
        throw lastError
      }

      // 4xx - don't retry
      throw new Error(
        `HubDB request failed with status ${response.status} ${response.statusText} for URL: ${url}`
      )
    } catch (err) {
      clearTimeout(timer)

      // AbortError = timeout
      if (err instanceof DOMException && err.name === 'AbortError') {
        lastError = new Error(`HubDB request timed out after ${TIMEOUT_MS}ms for URL: ${url}`)
      } else if (err instanceof Error && err.message.includes('HubDB request failed')) {
        throw err // Already a formatted error from above
      } else {
        // Network error - retry
        lastError = err
      }

      if (attempt < MAX_RETRIES - 1) {
        const delay = BACKOFF_MS[attempt] ?? BACKOFF_MS[BACKOFF_MS.length - 1]!
        await new Promise((res) => setTimeout(res, delay))
      }
    }
  }

  throw lastError ?? new Error(`HubDB request failed after ${MAX_RETRIES} attempts: ${url}`)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch all rows from a HubDB table, with optional filtering/sorting params.
 *
 * Identical concurrent calls share a single in-flight Promise (deduplication).
 *
 * @param tableId  The HubDB table name or numeric ID.
 * @param params   Optional query parameters (limit, offset, sort, etc.).
 */
export async function fetchHubDbRows<T extends Record<string, unknown>>(
  tableId: string,
  params: HubDbQueryParams = {}
): Promise<HubDbRow<T>[]> {
  const url = buildUrl(tableId, params)

  // Deduplication: return the existing promise if one is in-flight for this URL
  const existing = inFlight.get(url)
  if (existing) {
    return existing as Promise<HubDbRow<T>[]>
  }

  const request = fetchWithRetry(url)
    .then((response) => response.json() as Promise<HubDbResponse<T>>)
    .then((data) => data.results)
    .finally(() => {
      inFlight.delete(url)
    })

  inFlight.set(url, request as Promise<HubDbRow[]>)
  return request
}
