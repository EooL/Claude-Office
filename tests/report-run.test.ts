import { describe, expect, it } from 'vitest'
import { reportRun } from '../scripts/report-run.mjs'

describe('real operation reporting', () => {
  it('reports the actual failing and successful command exit codes without shell interpretation', async () => {
    const events: any[] = []
    const report = async (_path: string, event: any) => { events.push(event.signals[0]) }
    expect(await reportRun('test', 'fixture', process.execPath, ['-e', 'process.exit(7)'], report)).toBe(7)
    expect(events.map(e => e.kind)).toEqual(['test_start', 'test_failed'])
    expect(events[1].exitCode).toBe(7)
    events.length = 0
    expect(await reportRun('build', 'fixture', process.execPath, ['-e', 'process.exit(0)'], report)).toBe(0)
    expect(events.map(e => e.kind)).toEqual(['build_start', 'build_ok'])
  })
  it('reports launch failure rather than success', async () => {
    const events: any[] = []
    expect(await reportRun('test', 'fixture', 'office-no-such-executable-fixture', [], async (_p: string, e: any) => { events.push(e.signals[0]) })).toBe(1)
    expect(events[1]).toMatchObject({ kind: 'test_failed', exitCode: 1, detail: 'Command could not start' })
  })
})
