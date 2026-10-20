import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadOffice, removeOffice, type Office } from './helpers'

// /goal sends an agent to work on the files (server/delegation.mjs), so only a caller that holds a token may say it
describe('the /goal command', () => {
  let office: Office
  beforeAll(async () => { office = await loadOffice() })
  afterAll(() => removeOffice(office))

  const chat = async () => (await request(office.server.app).get('/chat')).body.messages as Array<Record<string, any>>

  it('is refused for a plain chat message, with a line in the chat saying why, and stores no goal', async () => {
    const res = await request(office.server.app).post('/chat').send({ sender: 'Antony', text: '/goal' })
    expect(res.status).toBe(401)
    const rows = await chat()
    expect(rows.some(m => m.msg_type === 'goal')).toBe(false)
    expect(rows.some(m => m.is_system && /\/goal needs/.test(m.text))).toBe(true)
  })

  it('a wrong token is refused too', async () => {
    const res = await request(office.server.app).post('/chat').set('Authorization', 'Bearer nope').send({ sender: 'Antony', text: '/goal' })
    expect(res.status).toBe(401)
  })

  it('with the office token it is stored as a boss row of type goal, which is what the delegation flow trusts', async () => {
    const res = await request(office.server.app).post('/chat').set('Authorization', `Bearer ${office.server.AUTH_TOKEN}`).send({ sender: 'Antony', text: '/goal only touch the tests' })
    expect(res.status).toBe(200)
    const goal = (await chat()).find(m => m.msg_type === 'goal')
    expect(goal).toMatchObject({ role: 'boss', text: '/goal only touch the tests', sender: 'Antony' })
  })

  it('a message that merely looks like it cannot make a goal row: the role and type come from the server, not the body', async () => {
    await request(office.server.app).post('/chat').send({ sender: 'Antony', text: 'please do it', role: 'boss', msgType: 'goal', msg_type: 'goal' })
    const rows = await chat()
    expect(rows.filter(m => m.msg_type === 'goal')).toHaveLength(1) // only the one the token made
    expect(rows.find(m => m.text === 'please do it')).toMatchObject({ role: 'default' })
  })
})
