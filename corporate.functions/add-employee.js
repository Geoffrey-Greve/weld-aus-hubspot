/**
 * POST /_hcms/api/corporate/add-employee
 *
 * Create or match a contact by email and link them to the admin's company.
 * Actor identity is derived from the HubSpot membership session only.
 */

const {
  jsonResponse,
  readBody,
  normalizeCompanyId,
  requireCompanyAdmin,
} = require('./lib/auth')
const {
  searchContactByEmail,
  createContact,
  getContact,
  associateCompanyContactDefault,
  associateContactCompanyLabeled,
  resolveContactCompanyLabelTypeId,
  getContactCompanyAssociations,
  contactToEmployee,
} = require('./lib/hubspot')

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

async function contactAlreadyLinked(contactId, companyId) {
  const associations = await getContactCompanyAssociations(contactId)
  return associations.some((row) => String(row.toObjectId || row.id || '') === companyId)
}

exports.main = (context, sendResponse) => {
  ;(async () => {
    try {
      const body = readBody(context)
      const companyId = normalizeCompanyId(body.companyId)
      await requireCompanyAdmin(context, companyId)

      const firstName = String(body.firstName || '').trim()
      const lastName = String(body.lastName || '').trim()
      const email = String(body.email || '')
        .trim()
        .toLowerCase()
      const jobTitle = String(body.jobTitle || '').trim()

      if (!firstName || !lastName || !email) {
        return jsonResponse(sendResponse, 400, {
          ok: false,
          message: 'Please enter the employee name and email address.',
        })
      }
      if (!isValidEmail(email)) {
        return jsonResponse(sendResponse, 400, {
          ok: false,
          message: 'Please enter a valid email address.',
        })
      }

      let status = 'linked'
      let contact = await searchContactByEmail(email)

      if (!contact) {
        contact = await createContact({ firstName, lastName, email, jobTitle })
        status = 'created'
      } else if (await contactAlreadyLinked(String(contact.id), companyId)) {
        const fresh = await getContact(contact.id)
        return jsonResponse(sendResponse, 200, {
          ok: true,
          status: 'already_linked',
          employee: contactToEmployee(fresh),
        })
      }

      await associateCompanyContactDefault(companyId, String(contact.id))

      // Best-effort Employee label — list UI reads HUBSPOT_DEFINED company→contact,
      // so the default association is enough for visibility.
      try {
        const employeeTypeId = await resolveContactCompanyLabelTypeId('Employee')
        if (employeeTypeId) {
          await associateContactCompanyLabeled(String(contact.id), companyId, employeeTypeId)
        }
      } catch (labelErr) {
        console.warn(
          JSON.stringify({
            level: 'warn',
            event: 'employee_label_skipped',
            message: labelErr && labelErr.message,
          })
        )
      }

      const fresh = await getContact(contact.id)
      return jsonResponse(sendResponse, 200, {
        ok: true,
        status,
        employee: contactToEmployee(fresh),
      })
    } catch (err) {
      const statusCode = (err && err.statusCode) || 500
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'add_employee_failed',
          statusCode,
          message: err && err.message,
        })
      )
      return jsonResponse(sendResponse, statusCode, {
        ok: false,
        message:
          (err && err.message) || 'Unable to add this team member right now.',
      })
    }
  })()
}
