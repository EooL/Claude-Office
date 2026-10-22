import React from 'react'
import { renderToString } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import WebSocket from 'ws'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { CHAT_MESSAGE_LIMIT, DELEGATION_CHAT_LIMIT, clipDelegationChat } from '../server/chat-limits.mjs'
import { listen, loadOffice, officeProtocols, removeOffice, spawnAgent } from './helpers'
import ExpandableChatContent from '../src/components/ExpandableChatContent'
import { ActionMessage } from '../src/components/ChatActions'
import { chatPreview } from '../src/chatPreview'

describe('long chat storage and transport', () => {
  it('uses the shared bound for user, slash, goal, agent, inbox and direct database writes', async () => {
    const office = await loadOffice()
    const chat = await import('../server/chat-db.js')
    const port = await listen(office.server.httpServer)
    spawnAgent(office.server, { id: 'debugger', name: 'Debugger', role: 'debugger' })
    const f = {
      server: office.server, port,
      request: (path: string, method = 'GET', headers: Record<string, string> = {}, body?: object) =>
        method === 'POST' ? request(office.server.app).post(path).set(headers).send(body) : request(office.server.app).get(path).set(headers),
    }
    const ws = new WebSocket(`ws://127.0.0.1:${f.port}/ws`, officeProtocols(f.server))
    const events: any[] = []
    ws.on('message', data => events.push(JSON.parse(data.toString())))
    const headers = { Authorization: `Bearer ${f.server.AUTH_TOKEN}` }
    try {
      await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) })
      for (const length of [15_000, 20_001]) {
        const text = 'x'.repeat(length - 4) + 'TAIL'
        const expected = text.slice(0, CHAT_MESSAGE_LIMIT)
        expect((await f.request('/chat', 'POST', {}, { sender: 'Boss', text })).status).toBe(200)
        expect(chat.getMessages().at(-1).text).toBe(expected)
        expect((await f.request('/chat')).body.messages.at(-1).text).toBe(expected)
        await expect.poll(() => events.filter(event => event.type === 'chat_message').at(-1)?.text).toBe(expected)
        expect(JSON.parse(readFileSync(join(office.dir, 'last-chat'), 'utf8')).text).toBe(expected)
        for (const prefix of ['/status ', '/goal ']) {
          const input = prefix + text
          expect((await f.request('/chat', 'POST', headers, { sender: 'Boss', text: input })).status).toBe(200)
          expect(chat.getMessages().findLast(row => row.sender === 'Boss').text).toBe(input.slice(0, CHAT_MESSAGE_LIMIT))
        }
        expect((await f.request('/chat/reply', 'POST', headers, { sender: 'Reviewer', role: 'assistant', recipient: 'Debugger', text })).status).toBe(200)
        expect((await f.request('/chat?recipient=Debugger')).body.messages.at(-1).text).toBe(expected)
        expect(JSON.parse(readFileSync(join(office.dir, 'inbox/debugger.json'), 'utf8')).text).toBe(expected)
        const rpc = await f.request('/a2a', 'POST', headers, { jsonrpc: '2.0', id: 1, method: 'message/send', params: { message: {
          kind: 'message', role: 'agent', messageId: 'fixture', parts: [{ kind: 'text', text }], metadata: { from: 'Reviewer', to: 'Debugger' },
        } } })
        expect(rpc.body.result.parts[0].text).toBe(expected)
        for (const extra of [{}, { isSystem: true }, { msgType: 'decision' }]) {
          expect(chat.addMessage({ sender: 'system', text, ...extra }).text).toBe(expected)
        }
      }
      expect(CHAT_MESSAGE_LIMIT).toBe(20_000)
      expect((await f.request('/chat', 'POST', {}, { sender: 'Boss', text: 'x'.repeat(CHAT_MESSAGE_LIMIT * 6 + 8192) })).status).toBe(413)
    } finally {
      ws.terminate()
      await new Promise<void>(resolve => office.server.httpServer.close(() => resolve()))
      chat.default.close()
      removeOffice(office)
    }
  })
  it('clips delegation only past 8000, with one ellipsis inside the bound', () => {
    expect(DELEGATION_CHAT_LIMIT).toBe(8000)
    for (const length of [1799, 1801, 7999, 8000]) expect(clipDelegationChat('x'.repeat(length))).toBe('x'.repeat(length))
    expect(clipDelegationChat('x'.repeat(8001))).toBe('x'.repeat(7999) + '…')
  })
})

describe('expandable rendered chat', () => {
  const render = (text: string, initiallyExpanded = false) => renderToString(React.createElement(ExpandableChatContent, { text, messageId: 8, initiallyExpanded }))
  it('leaves short messages and exactly twelve logical lines unchanged', () => {
    expect(render('A short reply.')).not.toContain('Show more')
    expect(render(Array(12).fill('line').join('\n'))).not.toContain('Show more')
    expect(chatPreview('`' + 'x'.repeat(900) + '`').long).toBe(false)
    expect(chatPreview('[small](https://example.com/' + 'x'.repeat(1000) + ')').long).toBe(false)
    expect(chatPreview('short<!--' + 'x'.repeat(1000) + '-->').long).toBe(false)
  })
  it('collapses by logical lines or rendered characters, with accessible controls', () => {
    for (const text of [Array(25).fill('line').join('\n'), 'x'.repeat(15_000)]) {
      const html = render(text)
      expect(html).toContain('aria-expanded="false"')
      expect(html).toMatch(/aria-controls="[^"]+"/)
      expect(html).toContain('is-collapsed')
      expect(html).toContain('>Show more</button>')
      expect(html.length).toBeLessThan(2000)
    }
  })
  it('renders the entire expanded text and keeps hostile markup inert', () => {
    const html = render('x'.repeat(15_000) + '<script>alert(1)</script><!-- HIDDEN -->TAIL', true)
    expect(html).toContain('x'.repeat(15_000))
    expect(html).toContain('TAIL')
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('>Show less</button>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('HIDDEN')
  })
  it('keeps suggestion controls outside the collapsed content', () => {
    const html = renderToString(React.createElement(ActionMessage, {
      text: 'x'.repeat(1500) + '\nNEXT_ACTION: Inspect the failing test.', messageId: 8,
      actions: [{ id: 'next:8', messageId: 8, kind: 'plan', label: 'Plan recommended step', request: 'Inspect the failing test.' }],
    }))
    expect(html).toContain('>Show more</button>')
    expect(html).toContain('>Start</button>')
    expect(html).toContain('>Ignore</button>')
    expect(html.indexOf('>Show more</button>')).toBeLessThan(html.indexOf('>Start</button>'))
    expect(html).not.toContain('NEXT_ACTION:')
  })
})
