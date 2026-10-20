import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'
import request from 'supertest'
import { afterAll, describe, expect, it } from 'vitest'
import { mountArtifacts } from '../server/artifacts.js'
import { chatTokens, targetKind } from '../server/chat-markup.mjs'

const dir = mkdtempSync(join(tmpdir(), 'office-artifact-test-'))
const workspace = join(dir, 'workspace')
mkdirSync(workspace)
const doc = join(workspace, 'PR draft.md')
const image = join(workspace, 'team.jpg')
const other = join(workspace, 'unlinked.txt')
writeFileSync(doc, '# Review\n![Team](team.jpg)\n')
writeFileSync(image, Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
writeFileSync(other, 'not published')
const app = express()
mountArtifacts(app, {
  workspace, temp: dir,
  requireUi: (req, res, next) => req.headers.authorization === 'Bearer fixture' ? next() : res.sendStatus(401),
  getMessage: id => id === 1 ? { text: `[English PR draft](<${doc}>)\n![Team](${image})` } : id === 2 ? { text: `[code](${other})`, msg_type: 'prompt' } : id === 3 ? { text: `[Draft](<${doc}>)` } : null,
})
const get = (path: string, id = 1) => request(app).get('/chat/artifact').query({ messageId: id, path }).set('Authorization', 'Bearer fixture')
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('chat links and published local artifacts', () => {
  it('parses links, images, code and bare URLs without treating code or HTML as links', () => {
    const parsed = chatTokens('Read [draft](C:/Temp/PR-DRAFT.md)\n![Team](C:/Temp/team.jpg) `https://example.com/code` https://example.com. <script>x</script>')
    expect(parsed.filter(t => t.kind === 'link').map(t => t.target)).toEqual(['C:/Temp/PR-DRAFT.md', 'https://example.com'])
    expect(parsed.find(t => t.kind === 'image')).toMatchObject({ target: 'C:/Temp/team.jpg', label: 'Team' })
    expect(parsed.find(t => t.kind === 'code')?.label).toBe('https://example.com/code')
    expect(targetKind('javascript:alert(1)')).toBeNull()
    expect(targetKind('data:text/html,evil')).toBeNull()
    expect(targetKind('file:///C:/secret.txt')).toBeNull()
    expect(targetKind('https://user:password@example.com')).toBeNull()
  })
  it('requires authentication and only serves the files actually published by that message', async () => {
    expect((await request(app).get('/chat/artifact').query({ messageId: 1, path: doc })).status).toBe(401)
    const result = await get(doc)
    expect(result.status).toBe(200)
    expect(result.headers['content-type']).toContain('text/plain')
    expect(result.text).toContain('# Review')
    expect((await get(other)).status).toBe(403)
    expect((await get(other, 2)).status).toBe(404)
    expect((await get(doc, 99)).status).toBe(404)
  })
  it('serves raster images and permits the document’s adjacent screenshots', async () => {
    const result = await get(image)
    expect(result.status).toBe(200)
    expect(result.headers['content-type']).toBe('image/jpeg')
    expect(result.headers['cache-control']).toBe('no-store')
    expect(result.headers['x-content-type-options']).toBe('nosniff')
    expect((await get(image, 3)).status).toBe(200)
  })
  it('rejects credential files, unsupported active formats, traversal and non-files', async () => {
    const secret = join(workspace, '.env.local')
    writeFileSync(secret, 'secret')
    expect((await get(secret)).status).toBe(403)
    expect((await get('https://example.com/a.png')).status).toBe(400)
    expect((await get(join(workspace, '..', 'outside.txt'))).status).toBe(404)
    expect((await get(workspace)).status).toBe(403)
  })
})
