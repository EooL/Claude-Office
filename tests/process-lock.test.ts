import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { acquireProcessLock, RECLAIM_STALE_MS } from '../server/process-lock.mjs'

const dirs: string[] = []
const children: ChildProcess[] = []
afterEach(() => {
  for (const child of children.splice(0)) child.kill()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'office-lock-')); dirs.push(dir)
  return join(dir, 'lock')
}
function worker(source: string) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], { stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(child)
  return child
}
async function ready(child: ChildProcess) {
  const [data] = await once(child.stdout!, 'data')
  expect(String(data)).toContain('ready')
}
async function deadOwner(file: string, reclaim: boolean) {
  const child = worker(`import {writeFileSync,mkdirSync} from 'node:fs';
    writeFileSync(${JSON.stringify(file)}, JSON.stringify({pid:process.pid,token:'crashed'}));
    ${reclaim ? `mkdirSync(${JSON.stringify(file + '.reclaim')}); mkdirSync(${JSON.stringify(file + '.reclaim/')} + process.pid + '-' + Date.now() + '-crashed');` : ''}
    console.log('ready'); setInterval(()=>{},1000);`)
  await ready(child)
  const exited = once(child, 'exit'); child.kill(); await exited
}
it('recovers a dead PID with a leftover legacy empty reclaim directory', async () => {
  const file = fixture(); await deadOwner(file, false)
  mkdirSync(file + '.reclaim')
  const old = new Date(Date.now() - RECLAIM_STALE_MS - 1000)
  utimesSync(file + '.reclaim', old, old)
  const release = acquireProcessLock(file)
  expect(release).toBeTypeOf('function'); release!()
  expect(existsSync(file)).toBe(false)
})
it('reclaims a killed reclaimer across competing processes with only one winner', async () => {
  const file = fixture(); await deadOwner(file, true)
  const module = pathToFileURL(join(process.cwd(), 'server/process-lock.mjs')).href
  const contenders = Array.from({ length: 8 }, () => worker(`import { acquireProcessLock } from ${JSON.stringify(module)};
    const release = acquireProcessLock(${JSON.stringify(file)});
    console.log(release ? 'winner' : 'busy'); if(release) setInterval(()=>{},1000);`))
  const results = await Promise.all(contenders.map(async c => String((await once(c.stdout!, 'data'))[0]).trim()))
  expect(results.filter(r => r === 'winner')).toHaveLength(1)
  expect(contenders.some(c => c.pid === JSON.parse(readFileSync(file, 'utf8')).pid)).toBe(true)
})
it('keeps fresh and old live reclaimers regardless of age', () => {
  const file = fixture()
  writeFileSync(file, JSON.stringify({ pid: process.pid, token: 'live' }))
  mkdirSync(file + '.reclaim')
  const record = `${file}.reclaim/${process.pid}-${Date.now()}-live`
  mkdirSync(record)
  expect(acquireProcessLock(file)).toBeNull()
  rmSync(record, { recursive: true })
  mkdirSync(`${file}.reclaim/${process.pid}-${Date.now() - RECLAIM_STALE_MS - 1}-old`)
  expect(acquireProcessLock(file)).toBeNull()
  expect(existsSync(file + '.reclaim')).toBe(true)
  expect(JSON.parse(readFileSync(file, 'utf8')).token).toBe('live')
})
