import { mkdtempSync, rmSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi } from 'vitest'
import { listen, loadOffice } from '../helpers'

/** One listener, two explicitly attached offices; every writable path is disposable. */
export async function inprocessBuilding() {
  const root = mkdtempSync(join(tmpdir(), 'office-router-test-'))
  const oldHome = process.env.AGENT_OFFICE_HOME
  const oldRoot = process.env.AGENT_OFFICE_ROOT
  const buildingRoot = join(root, 'building')
  process.env.AGENT_OFFICE_ROOT = buildingRoot
  const intervals = vi.spyOn(globalThis, 'setInterval')
  let office: Awaited<ReturnType<typeof loadOffice>> | undefined
  let second: any
  let runtime: typeof import('../../server/building-runtime.mjs') | undefined
  const close = async () => {
    runtime?.detachOffice('off_abc123')
    for (const result of intervals.mock.results) if (result.type === 'return') clearInterval(result.value)
    intervals.mockRestore()
    if (office) {
      for (const client of office.server.wss.clients) client.terminate()
      await new Promise<void>(resolve => office!.server.wss.close(() => resolve()))
      if (office.server.httpServer.listening) await new Promise<void>(resolve => office!.server.httpServer.close(() => resolve()))
      const { defaultOffice } = await import('../../server/default-office.mjs')
      defaultOffice.close()
    }
    second?.close()
    if (oldHome === undefined) delete process.env.AGENT_OFFICE_HOME
    else process.env.AGENT_OFFICE_HOME = oldHome
    if (oldRoot === undefined) delete process.env.AGENT_OFFICE_ROOT
    else process.env.AGENT_OFFICE_ROOT = oldRoot
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
  try {
    office = await loadOffice({ dir: join(root, 'default-home') })
    const port = await listen(office.server.httpServer)
    const { defaultOffice } = await import('../../server/default-office.mjs')
    const { createOffice } = await import('../../server/office.mjs')
    const { addOffice } = await import('../../server/registry.mjs')
    runtime = await import('../../server/building-runtime.mjs')
    const { runInOffice } = await import('../../server/office-scope.mjs')
    const home = join(root, 'second-home')
    const cwd = join(root, 'second-project')
    second = createOffice({ home, cwd })
    return {
      root, port, server: office.server, a: defaultOffice, b: second, runInOffice,
      attach: () => { addOffice({ id: 'off_abc123', home, cwd }); runtime!.attachOffice('off_abc123', second) },
      close,
      request: (path: string, method = 'GET', headers: Record<string, string> = {}, body?: object | string) => new Promise<{ status: number, body: any, text: string }>((resolve, reject) => {
        const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
        if (payload !== undefined) headers = { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(payload)), ...headers }
        // Raw paths preserve encoded traversal spellings that fetch normalizes.
        const req = request({ hostname: '127.0.0.1', port, path, method, headers }, res => {
          let text = ''
          res.setEncoding('utf8')
          res.on('data', chunk => { text += chunk })
          res.on('end', () => {
            let body: any
            try { body = JSON.parse(text) } catch { body = text }
            resolve({ status: res.statusCode!, body, text })
          })
        })
        req.on('error', reject)
        req.end(payload)
      }),
    }
  } catch (error) { await close(); throw error }
}
