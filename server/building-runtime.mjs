import { defaultOffice } from './default-office.mjs'
import { readBuilding, validOfficeId as validId } from './registry.mjs'
import { canonicalCwd } from './canonicalCwd.mjs'

// BUILDING: explicit live attachments only; persistence is owned by the registry.
const offices = new Map([['default', defaultOffice]])

/** Lookups never consult disk, including malformed and unknown identifiers. */
export function getOffice(id) { return validId(id) ? offices.get(id) : undefined }

export function liveOffices() { return [...offices.values()] }

export function attachOffice(id, office) {
  if (!validId(id)) throw new Error('Invalid office id')
  if (offices.has(id)) throw new Error('Office is already live')
  if ([...offices.values()].includes(office)) throw new Error('Office instance is already live')
  const entry = readBuilding().offices.find(candidate => candidate.id === id)
  if (!entry) throw new Error('Office is not registered')
  if (!office?.context || !office.state || !office.chat || typeof office.close !== 'function') throw new Error('Invalid office instance')
  if (canonicalCwd(entry.home) !== canonicalCwd(office.context.home) || canonicalCwd(entry.cwd) !== canonicalCwd(office.context.cwd)) throw new Error('Office instance does not match its registry entry')
  offices.set(id, office)
  return office
}

/** Detachment is bookkeeping only; its caller owns the office lifetime. */
export function detachOffice(id) {
  if (!validId(id)) throw new Error('Invalid office id')
  if (id === 'default') throw new Error('Cannot detach the default office')
  const office = offices.get(id)
  offices.delete(id)
  return office
}
