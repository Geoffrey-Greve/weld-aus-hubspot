/**
 * HubSpot Forms API v3 submit helper.
 *
 * Used by React islands to submit form data to HubSpot without a page reload.
 * No retry is implemented - form submits are not idempotent.
 *
 * See: https://legacydocs.hubspot.com/docs/methods/forms/submit_form
 */

const FORMS_API_BASE = 'https://api.hsforms.com/submissions/v3/integration/submit'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FormSubmission {
  fields: Array<{
    name: string
    value: string
  }>
  context?: {
    pageUri?: string
    pageName?: string
    /** HubSpot tracking cookie value (_hsq) */
    hutk?: string
  }
  legalConsentOptions?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Submit a HubSpot form via the Forms API v3.
 *
 * @param portalId   The HubSpot portal ID (e.g. "4538263").
 * @param formGuid   The form's GUID from HubSpot.
 * @param submission The form fields and optional context.
 * @throws Error if the response status is not 2xx.
 */
export async function submitHubSpotForm(
  portalId: string,
  formGuid: string,
  submission: FormSubmission
): Promise<void> {
  const url = `${FORMS_API_BASE}/${portalId}/${formGuid}`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(submission)
  })

  if (!response.ok) {
    throw new Error(
      `HubSpot form submission failed with status ${response.status} ${response.statusText}`
    )
  }
}
