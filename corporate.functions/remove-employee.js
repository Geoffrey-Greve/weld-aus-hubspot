/**
 * POST /_hcms/api/corporate/remove-employee
 *
 * Archive the company↔contact association. Does not delete the contact.
 * Actor identity is derived from the HubSpot membership session only.
 */

const {
  jsonResponse,
  readBody,
  normalizeCompanyId,
  requireCompanyAdmin,
  isCompanyAdmin,
} = require('./lib/auth')
const { archiveCompanyContactAssociation, getContact } = require('./lib/hubspot')

exports.main = (context, sendResponse) => {
  ;(async () => {
    try {
      const body = readBody(context)
      const companyId = normalizeCompanyId(body.companyId)
      const actor = await requireCompanyAdmin(context, companyId)

      const employeeId = String(body.employeeId || '').trim()
      if (!/^\d+$/.test(employeeId)) {
        return jsonResponse(sendResponse, 400, {
          ok: false,
          message: 'A valid employeeId is required.',
        })
      }

      if (employeeId === actor.contactId) {
        return jsonResponse(sendResponse, 400, {
          ok: false,
          message: 'You cannot remove yourself from the team.',
        })
      }

      if (await isCompanyAdmin(employeeId, companyId)) {
        return jsonResponse(sendResponse, 400, {
          ok: false,
          message: 'Corporate admins cannot be removed from this page.',
        })
      }

      // Confirm the contact exists (clearer 404 than a bare association miss).
      try {
        await getContact(employeeId)
      } catch (lookupErr) {
        if (lookupErr && lookupErr.statusCode === 404) {
          return jsonResponse(sendResponse, 404, {
            ok: false,
            message: 'That team member could not be found.',
          })
        }
        throw lookupErr
      }

      await archiveCompanyContactAssociation(companyId, employeeId)

      return jsonResponse(sendResponse, 200, { ok: true })
    } catch (err) {
      const statusCode = (err && err.statusCode) || 500
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'remove_employee_failed',
          statusCode,
          message: err && err.message,
        })
      )
      return jsonResponse(sendResponse, statusCode, {
        ok: false,
        message:
          (err && err.message) || 'Unable to remove this team member right now.',
      })
    }
  })()
}
