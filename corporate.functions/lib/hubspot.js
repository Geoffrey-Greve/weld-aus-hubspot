/**
 * Minimal HubSpot CRM helpers for Design Manager serverless functions.
 * Auth comes from the `hubspot_service_key` secret (HubSpot Service Key,
 * Development → Keys → Service Keys) — not a private app token.
 */

const API = 'https://api.hubapi.com'

async function hs(method, path, body) {
  const token = process.env.hubspot_service_key
  if (!token) {
    const err = new Error('Server misconfigured: missing hubspot_service_key secret.')
    err.statusCode = 500
    throw err
  }

  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  const text = await response.text()
  let data = {}
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = { message: text }
    }
  }

  if (!response.ok) {
    const message =
      (data && (data.message || data.error)) ||
      `HubSpot API ${response.status} on ${method} ${path}`
    const err = new Error(message)
    err.statusCode = response.status >= 500 ? 502 : response.status
    err.hubspot = data
    throw err
  }

  return data
}

/** Contact → company associations (includes labels / typeIds). */
async function getContactCompanyAssociations(contactId) {
  const data = await hs(
    'GET',
    `/crm/v4/objects/contacts/${encodeURIComponent(contactId)}/associations/companies`
  )
  return Array.isArray(data.results) ? data.results : []
}

/**
 * Resolve a USER_DEFINED association typeId by label for contact→company.
 * Returns null when the label is not defined in the portal.
 */
async function resolveContactCompanyLabelTypeId(label) {
  const wanted = String(label || '')
    .toLowerCase()
    .trim()
  if (!wanted) return null

  const data = await hs('GET', '/crm/v4/associations/contacts/companies/labels')
  const results = Array.isArray(data.results) ? data.results : []
  const match = results.find(
    (entry) =>
      entry &&
      entry.category === 'USER_DEFINED' &&
      String(entry.label || '')
        .toLowerCase()
        .trim() === wanted
  )
  return match ? Number(match.typeId) : null
}

async function searchContactByEmail(email) {
  const data = await hs('POST', '/crm/v3/objects/contacts/search', {
    filterGroups: [
      {
        filters: [
          {
            propertyName: 'email',
            operator: 'EQ',
            value: email,
          },
        ],
      },
    ],
    properties: ['email', 'firstname', 'lastname', 'jobtitle', 'individual_membership_type_2'],
    limit: 1,
  })
  const results = Array.isArray(data.results) ? data.results : []
  return results[0] || null
}

async function createContact({ firstName, lastName, email, jobTitle }) {
  const properties = {
    email,
    firstname: firstName,
    lastname: lastName,
  }
  if (jobTitle) properties.jobtitle = jobTitle

  return hs('POST', '/crm/v3/objects/contacts', { properties })
}

async function getContact(contactId) {
  return hs(
    'GET',
    `/crm/v3/objects/contacts/${encodeURIComponent(contactId)}` +
      `?properties=email,firstname,lastname,jobtitle,individual_membership_type_2`
  )
}

/** Create the default unlabeled Company ↔ Contact association. */
async function associateCompanyContactDefault(companyId, contactId) {
  return hs(
    'PUT',
    `/crm/v4/objects/companies/${encodeURIComponent(companyId)}` +
      `/associations/default/contacts/${encodeURIComponent(contactId)}`
  )
}

/**
 * Add a labeled contact→company association (append; does not strip existing labels).
 */
async function associateContactCompanyLabeled(contactId, companyId, typeId) {
  return hs(
    'PUT',
    `/crm/v4/objects/contacts/${encodeURIComponent(contactId)}` +
      `/associations/companies/${encodeURIComponent(companyId)}`,
    [
      {
        associationCategory: 'USER_DEFINED',
        associationTypeId: Number(typeId),
      },
    ]
  )
}

/** Remove all associations between a company and a contact (contact is kept). */
async function archiveCompanyContactAssociation(companyId, contactId) {
  return hs(
    'DELETE',
    `/crm/v4/objects/companies/${encodeURIComponent(companyId)}` +
      `/associations/contacts/${encodeURIComponent(contactId)}`
  )
}

function contactToEmployee(contact) {
  const props = (contact && contact.properties) || {}
  const first = String(props.firstname || '').trim()
  const last = String(props.lastname || '').trim()
  const name = `${first} ${last}`.trim()
  return {
    id: String(contact.id),
    name: name || String(props.email || ''),
    email: String(props.email || ''),
    membership_tier: String(props.individual_membership_type_2 || ''),
  }
}

module.exports = {
  hs,
  getContactCompanyAssociations,
  resolveContactCompanyLabelTypeId,
  searchContactByEmail,
  createContact,
  getContact,
  associateCompanyContactDefault,
  associateContactCompanyLabeled,
  archiveCompanyContactAssociation,
  contactToEmployee,
}
