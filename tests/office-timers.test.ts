import { afterEach, beforeEach, expect, it } from 'vitest'
import { inprocessBuilding } from './helpers/inprocess-building'

let building: Awaited<ReturnType<typeof inprocessBuilding>>
let scope: typeof import('../server/office-scope.mjs')
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** Capture uncaught exceptions; vitest's own listeners are parked so a deliberate throw is not a test failure. */
async function captureUncaught(run: () => Promise<void>) {
  const saved = process.listeners('uncaughtException')
  const seen: Error[] = []
  const mine = (error: Error) => { seen.push(error) }
  process.removeAllListeners('uncaughtException')
  process.on('uncaughtException', mine)
  try { await run() } finally {
    process.off('uncaughtException', mine)
    for (const listener of saved) process.on('uncaughtException', listener)
  }
  return seen
}

beforeEach(async () => {
  building = await inprocessBuilding()
  scope = await import('../server/office-scope.mjs')
})
afterEach(async () => { await building.close() })

it('fires a timer in its own office scope while the office is live', async () => {
  building.attach()
  let seen: unknown
  building.runInOffice(building.b, () => { scope.officeTimeout(() => { seen = scope.currentOffice() }, 10) })
  await wait(60)
  expect(seen).toBe(building.b)
})

it('drops a timer whose office was detached, without throwing', async () => {
  building.attach()
  let ran = false
  const uncaught = await captureUncaught(async () => {
    building.runInOffice(building.b, () => { scope.officeTimeout(() => { ran = true; scope.currentOffice() }, 20) })
    ;(await import('../server/building-runtime.mjs')).detachOffice('off_abc123')
    await wait(80)
  })
  expect(ran).toBe(false)
  expect(uncaught).toEqual([])
})

it('keeps the default office timer working with one office live', async () => {
  let seen: unknown
  building.runInOffice(building.a, () => { scope.officeTimeout(() => { seen = scope.currentOffice() }, 10) })
  await wait(60)
  expect(seen).toBe(building.a)
})

it('can be cancelled with clearTimeout', async () => {
  let ran = false
  const timer = building.runInOffice(building.a, () => scope.officeTimeout(() => { ran = true }, 20))
  clearTimeout(timer)
  await wait(60)
  expect(ran).toBe(false)
})

it('does not swallow an unrelated error from the callback', async () => {
  const uncaught = await captureUncaught(async () => {
    building.runInOffice(building.a, () => { scope.officeTimeout(() => { throw new Error('boom') }, 10) })
    await wait(60)
  })
  expect(uncaught.map(error => error.message)).toEqual(['boom'])
})
