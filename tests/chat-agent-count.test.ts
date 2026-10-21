import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import SlackChat, { type ChatMessage } from '../src/components/SlackChat'

describe('chat office occupancy', () => {
  const messages = ['Departed reviewer', 'Departed debugger', 'Old assistant'].map((sender, id) => ({
    id, sender, senderSprite: 'assistant', senderColor: '#fff', text: 'Earlier reply', channel: 'office-general', timestamp: '10:00',
  })) satisfies ChatMessage[]
  const render = (activeAgentCount: number, history = messages) => renderToStaticMarkup(React.createElement(SlackChat, {
    messages: history, activeAgentCount, muted: true, volume: 0, onToggleMute: () => {}, onVolumeChange: () => {}, dayPhase: 'day', readOnly: true,
  }))
  it('uses current occupancy even when departed agents remain in chat history', () => {
    expect(render(1)).toContain('aria-label="1 active agents in the office"')
    expect(render(0)).toContain('aria-label="0 active agents in the office"')
  })
  it('counts present agents who have not spoken', () => {
    expect(render(4, [])).toContain('aria-label="4 active agents in the office"')
  })
})
