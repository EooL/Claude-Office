import { defaultOffice } from './default-office.mjs'
import { getOffice, liveOffices } from './building-runtime.mjs'
import { runInOffice } from './office-scope.mjs'

const readPaths = Object.freeze(['/chat', '/agents', '/sessions', '/settings', '/signals'])
export const unknownOffice = (_req, res) => res.status(404).json({ error: 'Unknown office' })

/** Inspect the raw segment before Express decodes params (including bad escapes). */
export function validateOfficePath(req, res, next) {
  const id = req.url.split(/[/?]/)[1]
  if (!getOffice(id)) return unknownOffice(req, res)
  next()
}

export function resolveOffice(req, res, next) {
  const office = getOffice(req.params.officeId)
  if (!office) return unknownOffice(req, res)
  req.office = office
  return runInOffice(office, () => {
    if (office !== defaultOffice) {
      // Mounted stores are not office-aware yet. A bearer token is fine: it is checked against the token of the
      // office in scope (server/office-auth.mjs), so another office's token only ever sees the read-only view.
      // Cookies and signed requests stay refused until the routes that use them are scoped.
      const credentials = ['cookie', 'x-office-timestamp', 'x-office-signature']
      if (!['GET', 'HEAD'].includes(req.method) || !readPaths.includes(req.path) || credentials.some(key => req.headers[key] !== undefined)) {
        return res.status(501).json({ error: 'not scoped yet' })
      }
    }
    next()
  })
}

export function legacyOffice(req, res, next) {
  if (liveOffices().length !== 1) {
    // Ingest cannot dispatch by cwd until the hook/routing phase. Refuse it too.
    if (['/event', '/status', '/usage'].includes(req.path)) return res.status(501).json({ error: 'not scoped yet' })
    return res.status(400).json({ error: 'OFFICE_ID required' })
  }
  req.office = defaultOffice
  return runInOffice(defaultOffice, next)
}

/** Resolve upgrades without involving Express or touching disk. */
export function upgradeOffice(path) {
  if (path === '/ws') return { office: defaultOffice }
  const match = /^\/o\/([^/]+)\/ws$/.exec(path)
  const office = match && getOffice(match[1])
  if (!office) return { status: 404, error: 'Unknown office' }
  return { office }
}
