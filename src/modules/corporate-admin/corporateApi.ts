/**
 * Authenticated corporate team-management writes.
 *
 * Browser callers must not hit the Event Engine Worker with a caller-controlled
 * `actorContactId` and `credentials: 'omit'` — that only asserts an identity, it
 * does not authenticate the HubSpot membership session (admin impersonation risk).
 *
 * Preferred path: same-origin `/_hcms/api/corporate/*` with
 * `credentials: 'same-origin'` so HubSpot membership cookies reach the Design
 * Manager serverless functions. Those handlers derive the actor from
 * `context.contact` and write CRM associations with a private-app secret.
 *
 * Alternate path: a short-lived Worker-verifiable `corporate_action_token` minted
 * server-side for the logged-in admin. When present, the island may call the
 * Worker directly with `Authorization: Bearer <token>` — still without treating
 * `actorContactId` as proof of identity.
 */

/**
 * Bulk registration is deliberately NOT here. It goes to Event Engine's
 * corporate bulk endpoint, which re-reads HubSpot server-side before using the
 * normal reservation/payment flow. Only CRM association writes (add/remove
 * employee) route through this client.
 */
export type CorporateAction = 'add-employee' | 'remove-employee'

export interface CorporateWriteConfig {
  /** HubSpot portal id (hint for the proxy / Worker tenant routing). */
  portalId: string
  /**
   * Logged-in admin contact id resolved server-side by HubL. Used only as a
   * compatibility fallback when HubSpot serverless is not configured on the
   * portal and the Event Engine Worker must verify actor/company membership.
   * Caller-supplied body identity is still stripped below.
   */
  actorContactId?: string
  /**
   * Optional short-lived token minted for the logged-in Primary Admin.
   * When set with `workerBaseUrl`, enables authenticated Worker-direct writes.
   */
  actionToken?: string
  /** Event Engine base URL — only used together with `actionToken`. */
  workerBaseUrl?: string
}

export interface CorporateWriteResult<T = Record<string, unknown>> {
  ok: boolean
  status: number
  data: T
}

const SAME_ORIGIN_PREFIX = '/_hcms/api/corporate'

const IDENTITY_KEYS = new Set(['actorContactId', 'actor_contact_id'])

function workerBase(url: string): string {
  return url.replace(/\/$/, '')
}

function withoutCallerIdentity(body: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body)) {
    if (IDENTITY_KEYS.has(key)) continue
    safe[key] = value
  }
  return safe
}

function isMissingServerlessEndpoint(status: number, data: unknown): boolean {
  if (status !== 404) return false
  const message =
    typeof data === 'object' && data
      ? String(
          (data as { error?: unknown; message?: unknown }).error ??
            (data as { error?: unknown; message?: unknown }).message ??
            ''
        )
      : ''
  return /no function configured|function configured for this endpoint/i.test(message)
}

async function postJson<T>(
  url: string,
  body: Record<string, unknown>,
  options: {
    credentials: RequestCredentials
    headers: Record<string, string>
  }
): Promise<CorporateWriteResult<T>> {
  const response = await fetch(url, {
    method: 'POST',
    credentials: options.credentials,
    headers: options.headers,
    body: JSON.stringify(body),
  })

  const data = (await response.json().catch(() => ({}))) as T
  return { ok: response.ok, status: response.status, data }
}

/**
 * POST a corporate write. Never sends `actorContactId` — the authenticated
 * handler / signed token is the identity source of truth.
 */
export async function postCorporateAction<T = Record<string, unknown>>(
  action: CorporateAction,
  body: Record<string, unknown>,
  config: CorporateWriteConfig
): Promise<CorporateWriteResult<T>> {
  const safeBody = withoutCallerIdentity(body)
  const token = (config.actionToken || '').trim()
  const workerUrl = (config.workerBaseUrl || '').trim()
  const actorContactId = (config.actorContactId || '').trim()
  const useSignedWorker = Boolean(token && workerUrl)
  const canFallbackToWorker = Boolean(workerUrl && actorContactId)

  const url = useSignedWorker
    ? `${workerBase(workerUrl)}/api/v1/corporate/${action}`
    : `${SAME_ORIGIN_PREFIX}/${action}`

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }

  if (useSignedWorker) {
    headers.Authorization = `Bearer ${token}`
    headers['X-Portal-Id'] = config.portalId
  }

  const result = await postJson<T>(
    url,
    {
      ...safeBody,
      portalId: config.portalId,
    },
    {
      credentials: useSignedWorker ? 'omit' : 'same-origin',
      headers,
    }
  )

  /**
   * Weld's current portal cannot host Design Manager serverless functions, so
   * the same-origin path can return HubSpot's "No function configured" 404 even
   * though the UI and Worker are correctly configured. In that very specific
   * case, retry through Event Engine. Other 404s/401s/403s are preserved so we
   * don't hide real auth or validation failures.
   */
  if (
    !useSignedWorker &&
    canFallbackToWorker &&
    isMissingServerlessEndpoint(result.status, result.data)
  ) {
    return postJson<T>(
      `${workerBase(workerUrl)}/api/v1/corporate/${action}`,
      {
        ...safeBody,
        portalId: config.portalId,
        actorContactId,
      },
      {
        credentials: 'omit',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Portal-Id': config.portalId,
        },
      }
    )
  }

  return result
}
