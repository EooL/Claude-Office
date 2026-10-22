import React from 'react'
import { renderToString } from 'react-dom/server'
import { expect, it } from 'vitest'
import DefaultModels, { saveDecision } from '../src/components/DefaultModels'

const svc = (name: string, over: object = {}) => ({ name, label: name.toUpperCase(), available: true, enabled: true, defaultModel: '', adapterDefaultModel: '', ...over })
const model = (service: string, id: string) => ({ service, id, label: id })
const render = (services: any[], models: any[] = [], readOnly = false) =>
  renderToString(React.createElement(DefaultModels, { services, models, readOnly, onSave: async () => null })).replaceAll('<!-- -->', '')

it('has a picker for each enabled installed service and none for the others', () => {
  const html = render([svc('claude'), svc('codex', { enabled: false }), svc('agy', { available: false })])
  expect(html).toContain('id="default-model-claude"')
  expect(html).not.toContain('default-model-codex')
  expect(html).not.toContain('default-model-agy')
  expect(html).toContain('Auto (service decides)')
})
it('renders nothing when no service is enabled', () => {
  expect(render([svc('claude', { enabled: false })])).toBe('')
})
it('shows the effective value: the choice, else the adapter default, else the CLI default', () => {
  expect(render([svc('claude', { defaultModel: 'm-1', adapterDefaultModel: 'a-1' })])).toContain('Used when a brain does not name a model: m-1')
  expect(render([svc('claude', { adapterDefaultModel: 'a-1' })])).toContain('Used when a brain does not name a model: a-1')
  expect(render([svc('claude')])).toContain('the CLI&#x27;s own default')
})
it('flags a model the catalogue does not list, but only when the catalogue has entries', () => {
  expect(render([svc('claude', { defaultModel: 'old' })], [model('claude', 'new')])).toContain('(unlisted)')
  expect(render([svc('claude', { defaultModel: 'new' })], [model('claude', 'new')])).not.toContain('unlisted')
  expect(render([svc('claude', { defaultModel: 'old' })], [])).not.toContain('unlisted')
})
it('saveDecision: no network call when the value equals the stored one (Auto on an empty store), trimmed otherwise', () => {
  expect(saveDecision('', undefined)).toEqual({ next: '', call: false })
  expect(saveDecision('  ', '')).toEqual({ next: '', call: false })
  expect(saveDecision(' m-1 ', 'm-1')).toEqual({ next: 'm-1', call: false })
  expect(saveDecision('', 'm-1')).toEqual({ next: '', call: true })
  expect(saveDecision('m-2', undefined)).toEqual({ next: 'm-2', call: true })
})
it('is read-only without the UI token', () => {
  const html = render([svc('claude', { defaultModel: 'm-1' })], [], true)
  expect(html).toMatch(/<input[^>]*disabled/)
  expect(html).toMatch(/<button[^>]*disabled[^>]*>Auto</)
})
it('escapes hostile text', () => {
  const html = render([svc('claude', { label: '<img src=x onerror=1>', defaultModel: '<script>alert(1)</script>' })], [model('claude', 'ok')])
  expect(html).not.toContain('<img src=x')
  expect(html).not.toContain('<script>alert')
})
