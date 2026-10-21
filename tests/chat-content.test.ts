import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ChatContent from '../src/components/ChatContent'

describe('chat content rendering', () => {
  it('renders safe external links, local preview controls, and image previews', () => {
    const html = renderToStaticMarkup(React.createElement(ChatContent, { messageId: 1, text: '[PR](https://example.com/pr/1) [Draft](C:/Temp/PR.md) ![Team](C:/Temp/team.jpg)' }))
    expect(html).toContain('href="https://example.com/pr/1"')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).toContain('class="chat-text-link"')
    expect(html).toContain('>Draft</button>')
    expect(html).toContain('class="chat-image-link"')
    expect(html).not.toContain('href="C:')
  })
  it('keeps HTML and unsafe protocols inert and makes local previews read-only without authentication', () => {
    const html = renderToStaticMarkup(React.createElement(ChatContent, { messageId: 1, readOnly: true, text: '<script>alert(1)</script> [unsafe](javascript:alert(1)) [Draft](C:/Temp/PR.md)' }))
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('href="javascript:')
    expect(html).toContain('disabled=""')
  })
})
