import { expect, it } from 'vitest'
import { fitScale } from '../src/fit'

it('never enlarges and keeps the full layout at 1056x682 or more', () => {
  expect(fitScale(1280, 800)).toBe(1)
  expect(fitScale(1056, 682)).toBe(1)
  expect(fitScale(1e9, 1e9)).toBe(1)
})

it('shrinks to fit small viewports', () => {
  expect(fitScale(768, 1024)).toBeCloseTo(0.727, 3)
  expect(fitScale(390, 844)).toBeCloseTo(0.369, 3)
})

it('stays visible for a zero or invalid viewport', () => {
  expect(fitScale(0, 0)).toBe(0.2)
  expect(fitScale(Number.NaN, 800)).toBe(1)
  expect(fitScale(800, Number.NaN)).toBe(1)
})
