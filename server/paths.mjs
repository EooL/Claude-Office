import { createOfficeContext, defaultOfficeContext } from './office-context.mjs'
import { readBuilding, validOfficeId } from './registry.mjs'

/** Shared provider state stays in its legacy location, including after adding offices. */
export function g0Dir() {
  return readBuilding().g0Home ?? defaultOfficeContext.home
}

/** Office paths are explicit registry data; ids are never filesystem components. */
export function officeHome(id = 'default') {
  if (!validOfficeId(id)) {
    throw new TypeError(`Invalid office id: ${String(id)}`)
  }
  const office = readBuilding().offices.find(entry => entry.id === id)
  if (!office) throw new Error(`Unknown office id: ${id}`)
  return office.home
}

export function officeTmp(id = 'default') {
  const home = officeHome(id)
  return createOfficeContext({ home, cwd: defaultOfficeContext.cwd }).tmp
}
