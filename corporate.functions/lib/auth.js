/**
 * Membership-session auth for corporate team writes.
 *
 * Identity comes from HubSpot `context.contact` (membership cookies), never from
 * the JSON body. Admin gate matches the HubL guard: USER_DEFINED typeId 7 ("Admin").
 */

const { getContactCompanyAssociations } = require('./hubspot')

/** Portal association: Contact → Company, USER_DEFINED / typeId 7 / "Admin". */
const ADMIN_ASSOCIATION_TYPE_ID = 7

function jsonResponse(sendResponse, statusCode, body) {
  sendResponse({
    statusCode,
    body,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

function readBody(context) {
  const raw = context && context.body
  if (!raw) return {}
  if (typeof raw === 'object') return raw
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw)
    } catch {
      return {}
    }
  }
  return {}
}

function requireLoggedInContact(context) {
  const contact = context && context.contact
  if (!contact || !contact.isLoggedIn || !contact.vid) {
    const err = new Error('Sign in to manage your team.')
    err.statusCode = 401
    throw err
  }
  return {
    contactId: String(contact.vid),
    email: contact.email ? String(contact.email) : '',
  }
}

function normalizeCompanyId(value) {
  const id = String(value || '').trim()
  if (!/^\d+$/.test(id)) {
    const err = new Error('A valid companyId is required.')
    err.statusCode = 400
    throw err
  }
  return id
}

/**
 * Confirm the logged-in contact is an Admin for the requested company.
 * Returns the actor contact id on success.
 */
async function requireCompanyAdmin(context, companyId) {
  const actor = requireLoggedInContact(context)
  const associations = await getContactCompanyAssociations(actor.contactId)

  const isAdminForCompany = associations.some((row) => {
    const toId = String(row.toObjectId || row.id || '')
    if (toId !== companyId) return false
    const types = Array.isArray(row.associationTypes) ? row.associationTypes : []
    return types.some(
      (t) =>
        Number(t.typeId) === ADMIN_ASSOCIATION_TYPE_ID ||
        String(t.label || '')
          .toLowerCase()
          .trim() === 'admin' ||
        String(t.label || '')
          .toLowerCase()
          .trim() === 'primary admin'
    )
  })

  if (!isAdminForCompany) {
    const err = new Error('Only corporate admins can manage this team.')
    err.statusCode = 403
    throw err
  }

  return actor
}

/** True when the contact holds the Admin association for the company. */
async function isCompanyAdmin(contactId, companyId) {
  const associations = await getContactCompanyAssociations(contactId)
  return associations.some((row) => {
    const toId = String(row.toObjectId || row.id || '')
    if (toId !== companyId) return false
    const types = Array.isArray(row.associationTypes) ? row.associationTypes : []
    return types.some(
      (t) =>
        Number(t.typeId) === ADMIN_ASSOCIATION_TYPE_ID ||
        String(t.label || '')
          .toLowerCase()
          .trim() === 'admin' ||
        String(t.label || '')
          .toLowerCase()
          .trim() === 'primary admin'
    )
  })
}

module.exports = {
  ADMIN_ASSOCIATION_TYPE_ID,
  jsonResponse,
  readBody,
  requireLoggedInContact,
  normalizeCompanyId,
  requireCompanyAdmin,
  isCompanyAdmin,
}
