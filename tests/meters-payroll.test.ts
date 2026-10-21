import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it } from 'vitest'
import Meters from '../src/components/Meters'
import { dispatchMeters, resetMeters, type SessionStatus } from '../src/meters'

afterEach(resetMeters)
function session(id: string, measured: boolean, cost = 2): SessionStatus {
  return { sessionId: id, cost, usageReported: measured ? ['costUsd'] : ['inputTokens'], durationMs: 1, linesAdded: 0, linesRemoved: 0,
    context: { used: 0, size: 100, input: 0, output: 0 }, burn: { dollarsPerMin: cost, tokensPerMin: 0 } }
}
function payroll(sessions: SessionStatus[]) {
  dispatchMeters({ type: 'session_status', statuses: sessions })
  return renderToStaticMarkup(React.createElement(Meters)).split('data-testid="meter-payroll"')[1].split('data-testid="meter-electricity"')[0]
}
it('shows not reported when no service measures cost', () => {
  const html = payroll([session('a', false)])
  expect(html).toContain('not reported'); expect(html).not.toContain('$0.00')
})
it('marks mixed totals and burn partial and excludes unmeasured numbers', () => {
  const html = payroll([session('a', true), session('b', false, 99)])
  expect(html).toContain('≥$2.00'); expect(html).toContain('≥$2.00/min'); expect(html).not.toContain('$101')
})
it('keeps complete measured totals, including a measured zero', () => {
  const measured = payroll([session('a', true, 2), session('b', true, 3)])
  expect(measured).toContain('$5.00'); expect(measured).toContain('$5.00/min'); expect(measured).not.toContain('partial')
  const html = payroll([session('a', true, 0), session('b', true, 0)])
  expect(html).toContain('$0.00'); expect(html).not.toContain('partial'); expect(html).not.toContain('not reported')
})
it('preserves the status-line guidance for estimated-only sessions', () => {
  const html = payroll([{ ...session('estimated', false), source: 'transcript' }])
  expect(html).toContain('needs the status line')
  expect(html).not.toContain('not reported')
})
it('marks estimated plus measured sessions as partial', () => {
  const html = payroll([session('measured', true), { ...session('estimated', false, 99), source: 'transcript' }])
  expect(html).toContain('≥$2.00')
  expect(html).toContain('≥$2.00/min')
})
