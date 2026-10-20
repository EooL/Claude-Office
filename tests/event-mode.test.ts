import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadOffice, removeOffice, type Office } from './helpers'
import { getEventMode, setEventMode } from '../src/eventMode'
import { themedDone, themedWork } from '../src/theme'

describe('real and emulated event selection', () => {
  let office: Office
  beforeAll(async () => { office = await loadOffice() })
  afterAll(() => { removeOffice(office); setEventMode('real') })
  it('defaults to real events and persists an authenticated choice without changing other settings', async () => {
    const get = () => request(office.server.app).get('/settings')
    expect((await get()).body.eventMode).toBe('real')
    expect((await request(office.server.app).post('/settings').send({ eventMode: 'emulated' })).status).toBe(401)
    const change = (eventMode: string) => request(office.server.app).post('/settings').set('Authorization', `Bearer ${office.server.AUTH_TOKEN}`).send({ eventMode })
    expect((await change('fake')).status).toBe(400)
    expect((await change('emulated')).status).toBe(200)
    expect((await get()).body).toMatchObject({ eventMode: 'emulated', logPrompts: 'summary', answerPermissions: true })
    expect(JSON.parse(readFileSync(join(office.dir, 'settings.json'), 'utf8')).eventMode).toBe('emulated')
    await change('real')
  })
  it('does not generate fictional work outcomes in real mode', () => {
    expect(getEventMode()).toBe('real')
    for (let i = 0; i < 20; i++) {
      expect(themedDone()).toBe('agent finished; check reported results')
      expect(themedWork()).toBe('working')
    }
  })
})
