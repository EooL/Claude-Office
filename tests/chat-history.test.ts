import { describe, expect, it } from 'vitest'
import { mergeChatHistory } from '../src/chatHistory'

describe('persisted chat hydration', () => {
  it('restores file-bearing messages without losing or duplicating concurrent live messages', () => {
    const result = mergeChatHistory([{ id: 2, text: 'live version' }, { id: -1, text: 'local' }], [{ id: 1, text: '[Draft](C:/Temp/PR.md)' }, { id: 2, text: 'snapshot version' }])
    expect(result.map(m => m.id)).toEqual([1, 2, -1])
    expect(result[1].text).toBe('live version')
  })
})
