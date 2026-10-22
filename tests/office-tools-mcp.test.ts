import { execFileSync, spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

const SCRIPT = resolve('scripts/office-tools-mcp.mjs')
const tmp = mkdtempSync(join(tmpdir(), 'office-tools-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

function mk(name: string) { const d = join(tmp, name); mkdirSync(d, { recursive: true }); return d }
function put(root: string, rel: string, data: string | Buffer) {
  const f = join(root, rel); mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, data)
}

class Client {
  proc: ChildProcessWithoutNullStreams
  buf = ''
  waiters = new Map<unknown, (m: any) => void>()
  lines: string[] = []
  nextId = 1
  constructor(root: string, env: Record<string, string> = {}) {
    this.proc = spawn(process.execPath, [SCRIPT, '--root', root], { env: { ...process.env, ...env }, windowsHide: true })
    this.proc.stdout.on('data', d => {
      this.buf += d
      let i
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i); this.buf = this.buf.slice(i + 1)
        this.lines.push(line)
        const m = JSON.parse(line)
        this.waiters.get(m.id)?.(m)
      }
    })
  }
  raw(line: string, id: unknown) {
    return new Promise<any>((ok, bad) => {
      const t = setTimeout(() => bad(new Error('timeout')), 15_000)
      this.waiters.set(id, m => { clearTimeout(t); ok(m) })
      this.proc.stdin.write(line + '\n')
    })
  }
  rpc(method: string, params?: unknown) {
    const id = this.nextId++
    return this.raw(JSON.stringify({ jsonrpc: '2.0', id, method, params }), id)
  }
  async call(name: string, args: Record<string, unknown> = {}) {
    const r = await this.rpc('tools/call', { name, arguments: args })
    return { err: !!r.result.isError, text: r.result.content[0].text as string }
  }
  close() { this.proc.kill() }
}

const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.t', ...a], { cwd, encoding: 'utf8' })

const clients: Client[] = []
const open = (root: string, env?: Record<string, string>) => { const c = new Client(root, env); clients.push(c); return c }
afterAll(() => clients.forEach(c => c.close()))

describe('office tools MCP', () => {
  it('hardening: search rechecks git-listed junctions and secret aliases', async () => {
    const d = mk('hostile-search'), outside = mk('hostile-outside')
    git(d, 'init', '-q')
    put(d, 'linked/x.txt', 'placeholder')
    git(d, 'add', 'linked/x.txt')
    rmSync(join(d, 'linked'), { recursive: true })
    put(outside, 'x.txt', 'OUTSIDE_MARKER')
    try { symlinkSync(outside, join(d, 'linked'), 'junction') } catch (e: any) {
      if (['EPERM', 'EACCES'].includes(e.code)) return
      throw e
    }
    expect((await open(d).call('search_text', { pattern: 'OUTSIDE_MARKER' })).text).not.toContain('OUTSIDE_MARKER')
  })

  it('hardening: secret policy applies to reads, search and case-insensitive git history', async () => {
    const d = mk('secret-variants'); git(d, 'init', '-q')
    const names = ['.ENV.local', '.env~', 'credentials.json', '.git-credentials', '.netrc', '.pypirc', 'vault.kdbx', '.AWS/credentials', '.SSH/config']
    for (const name of names) put(d, name, 'PRIVATE_MARKER')
    git(d, 'add', '-f', '.'); git(d, 'commit', '-qm', 'secrets fixture')
    const sc = open(d)
    for (const path of names) expect((await sc.call('read_file_range', { path })).err, path).toBe(true)
    expect((await sc.call('search_text', { pattern: 'PRIVATE_MARKER' })).text).not.toContain('PRIVATE_MARKER')
    expect((await sc.call('git_show', { rev: 'HEAD' })).text).not.toContain('PRIVATE_MARKER')
  })

  it('hardening: git show accepts commits only, never secret blobs or trees', async () => {
    const d = mk('git-objects'); git(d, 'init', '-q')
    put(d, '.env', 'BLOB_SECRET_MARKER'); git(d, 'add', '-f', '.env'); git(d, 'commit', '-qm', 'fixture')
    const blob = git(d, 'rev-parse', 'HEAD:.env').trim(), gc = open(d)
    for (const rev of [blob, 'HEAD^{tree}']) {
      const result = await gc.call('git_show', { rev })
      expect(result.err, rev).toBe(true)
      expect(result.text).not.toContain('BLOB_SECRET_MARKER')
    }
    expect((await gc.call('git_show', { rev: 'HEAD' })).err).toBe(false)
  })

  it('hardening: rejects native alternate data streams', async () => {
    if (process.platform !== 'win32') return
    const d = mk('native-ads'); put(d, 'public.txt', 'public'); put(d, 'public.txt:private', 'STREAM_MARKER')
    expect((await open(d).call('read_file_range', { path: 'public.txt:private' })).err).toBe(true)
  })

  it('hardening: rejects a file swapped for an outside link between check and open', async () => {
    const d = mk('race-root'), outside = mk('race-outside')
    put(d, 'public.txt', 'public'); put(outside, 'private.txt', 'RACE_SECRET_MARKER')
    // Verify symlink capability without silently losing the race coverage.
    try { symlinkSync(join(outside, 'private.txt'), join(d, 'probe'), 'file'); rmSync(join(d, 'probe')) } catch (e: any) {
      if (['EPERM', 'EACCES'].includes(e.code)) { console.warn('SKIPPED file-symlink race:', e.code); return }
      throw e
    }
    const preload = join(tmp, 'race-preload.mjs')
    writeFileSync(preload, `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
const target=process.env.RACE_FILE; let switched=false;
const swap=p=>{if(String(p)===target&&!switched){switched=true;fs.unlinkSync(target);fs.symlinkSync(process.env.RACE_OUTSIDE,target,'file')}};
for(const name of ['readFileSync','openSync']){const original=fs[name];fs[name]=function(p,...args){swap(p);return original.call(this,p,...args)}}
syncBuiltinESMExports();`)
    const rc = open(d, { NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`, RACE_FILE: join(d, 'public.txt'), RACE_OUTSIDE: join(outside, 'private.txt') })
    const result = await rc.call('read_file_range', { path: 'public.txt' })
    expect(result.err).toBe(true)
    expect(result.text).not.toContain('RACE_SECRET_MARKER')
  })

  it('hardening: rejects Windows ambiguous path syntax even on other hosts', async () => {
    for (const path of ['C:foo', '\\\\?\\C:\\file', '\\\\server\\share', 'ok.txt:stream', 'NUL', 'COM1.txt', 'ok.txt.', 'ok.txt ', '.GIT/config', 'NODE_MODULES/x']) {
      expect((await open(mk('ambiguous-' + clients.length)).call('read_file_range', { path })).err, path).toBe(true)
    }
  })

  it('hardening: ignores inherited Git repository/config redirection', async () => {
    const d = mk('safe-git'), outside = mk('git-redirect')
    for (const dir of [d, outside]) { git(dir, 'init', '-q'); put(dir, 'x.txt', dir === d ? 'SAFE_MARKER' : 'OUTSIDE_MARKER'); git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'fixture') }
    const gc = open(d, { GIT_DIR: join(outside, '.git'), GIT_WORK_TREE: outside })
    expect((await gc.call('git_show', { rev: 'HEAD' })).text).not.toContain('OUTSIDE_MARKER')
    expect((await gc.call('git_show', { rev: 'HEAD' })).text).toContain('SAFE_MARKER')
  })

  it('hardening: bounded JSON lines/depth, invalid IDs and prototype arguments leave RPC alive', async () => {
    const pc = open(mk('rpc-bounds'))
    expect((await pc.raw('x'.repeat(270000), null)).error.message).toContain('too large')
    expect((await pc.raw('{"id":9,"method":"ping","params":' + '['.repeat(100) + '0' + ']'.repeat(100) + '}', null)).error.message).toContain('nesting')
    expect((await pc.raw('{"id":{},"method":"ping"}', null)).error.code).toBe(-32600)
    expect((await pc.raw('{"id":10,"method":"tools/call","params":{"name":"__proto__","arguments":{"__proto__":{"polluted":true}}}}', 10)).result.isError).toBe(true)
    expect((await pc.rpc('ping')).result).toEqual({})
    expect(({} as any).polluted).toBeUndefined()
  })

  it('prototype-looking tool names/arguments and invalid requests never pollute or crash RPC', async () => {
    const pc = open(mk('rpc-prototype'))
    expect((await pc.raw('{"id":10,"method":"tools/call","params":{"name":"__proto__","arguments":{"__proto__":{"polluted":true}}}}', 10)).result.isError).toBe(true)
    for (const raw of ['null', '[]', '42']) expect((await pc.raw(raw, null)).error.code).toBe(-32600)
    expect(({} as any).polluted).toBeUndefined()
    expect((await pc.rpc('ping')).result).toEqual({})
  })

  it('hardening: audit redacts secrets and controls before writing one JSON line', async () => {
    const log = join(tmp, 'hostile-audit.jsonl'), ac = open(mk('audit-root'), { OFFICE_TOOLS_LOG: log })
    await ac.call('search_text', { pattern: 'token="two words"\n\u001b[31m SK-ABCDEFGHIJK' })
    const raw = readFileSync(log, 'utf8')
    expect(raw.trim().split('\n')).toHaveLength(1)
    expect(raw).not.toMatch(/two words|ABCDEFGHIJK|\\u001b/)
  })

  it('hardening: blocks config-driven fsmonitor, pager, diff and textconv execution', async () => {
    const d = mk('git-programs'), marker = join(d, 'EXECUTED')
    git(d, 'init', '-q'); put(d, 'a.txt', 'before'); git(d, 'add', '.'); git(d, 'commit', '-qm', 'fixture'); put(d, 'a.txt', 'after')
    const command = `echo EXECUTED > '${marker.replaceAll('\\', '/')}'`
    for (const key of ['core.fsmonitor', 'core.pager', 'diff.external', 'diff.evil.textconv', 'core.sshCommand']) git(d, 'config', key, command)
    put(d, '.gitattributes', '*.txt diff=evil\n')
    const gc = open(d)
    for (const [name, args] of [['list_files', {}], ['git_log', {}], ['git_show', { rev: 'HEAD' }], ['git_diff', {}]] as const) expect((await gc.call(name, args)).err).toBe(false)
    expect(existsSync(marker)).toBe(false)
  })

  it('hardening: pathological glob matching is covered by the worker deadline', async () => {
    const d = mk('glob-patho'); put(d, 'a'.repeat(100) + '.txt', 'needle')
    const started = Date.now()
    const result = await open(d).call('search_text', { pattern: 'needle', glob: '*a'.repeat(30) + 'b' })
    expect(Date.now() - started).toBeLessThan(8000)
    expect(result.text).toContain('stopped early')
  }, 12000)

  it('hardening: uppercase secret history is excluded without relying on read policy', async () => {
    const d = mk('history-case'); git(d, 'init', '-q')
    for (const path of ['.ENV.local', '.AWS/config', '.SSH/config', 'VAULT.KDBX']) put(d, path, 'CASE_SECRET_MARKER')
    git(d, 'add', '-f', '.'); git(d, 'commit', '-qm', 'fixture')
    expect((await open(d).call('git_show', { rev: 'HEAD' })).text).not.toContain('CASE_SECRET_MARKER')
  })
  const g = mk('repo')
  git(g, 'init', '-q')
  put(g, 'src/a.ts', 'const needle = 1\nline2\n')
  put(g, 'src/b.txt', 'Hello NEEDLE\n')
  put(g, 'README.md', '# hi\n')
  put(g, '.env', 'TOKEN=supersecretvalue needle\n')
  put(g, 'auth-token', 'needle-token\n')
  put(g, 'node_modules/x/index.js', 'needle\n')
  put(g, 'bin.dat', Buffer.from([1, 0, 2, 110, 101, 101, 100, 108, 101]))
  put(g, 'big.txt', 'needle ' + 'x'.repeat(1_100_000))
  put(g, '.gitignore', 'ignored.txt\n')
  put(g, 'ignored.txt', 'needle\n')
  git(g, 'add', '-A', '-f', 'src', 'README.md', '.gitignore', '.env', 'bin.dat', 'big.txt')
  git(g, 'commit', '-q', '-m', 'first commit')
  put(g, 'src/a.ts', 'const needle = 2\nline2\nline3\n')
  const log = join(tmp, 'audit.jsonl')
  const c = open(g, { OFFICE_TOOLS_LOG: log })

  it('handshake, tools list, ping, errors', async () => {
    const init = await c.rpc('initialize', { protocolVersion: '2025-03-26' })
    expect(init.result).toMatchObject({ protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'claude-office-tools' } })
    c.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
    const list = await c.rpc('tools/list')
    expect(list.result.tools.map((t: any) => t.name).sort()).toEqual(['git_diff', 'git_log', 'git_show', 'list_files', 'read_file_range', 'search_text'])
    expect(list.result.tools.every((t: any) => t.inputSchema.type === 'object')).toBe(true)
    expect((await c.rpc('ping')).result).toEqual({})
    expect((await c.rpc('nope')).error.code).toBe(-32601)
    expect((await c.raw('{not json', null)).error.code).toBe(-32700)
    expect((await c.rpc('ping')).result).toEqual({}) // still alive
    const other = open(g)
    expect((await other.rpc('initialize', {})).result.protocolVersion).toBe('2024-11-05')
  })

  it('list_files from git is sorted, hides secrets and ignored files, marks directories', async () => {
    const r = await c.call('list_files', { depth: 1 })
    const lines = r.text.split('\n')
    expect(lines).toEqual([...lines].sort())
    expect(lines).toContain('src/')
    expect(lines).toContain('README.md')
    expect(r.text).not.toMatch(/\.env|auth-token|node_modules|ignored\.txt/)
    expect((await c.call('list_files', { depth: 2 })).text).toContain('src/a.ts')
    expect((await c.call('list_files', { limit: 2 })).text).toContain('[truncated')
  })

  it('list_files walks a non-git folder', async () => {
    const d = mk('plain')
    put(d, 'z.txt', 'z'); put(d, 'a/b/c/deep.txt', 'd'); put(d, 'node_modules/n.js', ''); put(d, '.hidden/h.txt', ''); put(d, '.env', 'x'); put(d, 'big.bin', 'x'.repeat(1_100_000))
    const r = await open(d).call('list_files', { depth: 2 })
    expect(r.text.split('\n')).toEqual(['a/', 'a/b/', 'z.txt'])
  })

  it('search_text: literal, regex, glob, path, skip counts', async () => {
    const lit = await c.call('search_text', { pattern: 'needle', literal: true })
    expect(lit.text).toContain('src/a.ts:1: const needle = 2')
    expect(lit.text).not.toContain('NEEDLE')
    expect(lit.text).not.toMatch(/supersecret|auth-token|node_modules|ignored/)
    expect(lit.text).toMatch(/[1-9]\d* secret-looking and [1-9]\d* binary\/large/)
    expect((await c.call('search_text', { pattern: 'needle', ignore_case: true })).text).toContain('src/b.txt:1: Hello NEEDLE')
    expect((await c.call('search_text', { pattern: 'const \\w+ = \\d', glob: '*.ts' })).text).toContain('src/a.ts:1')
    expect((await c.call('search_text', { pattern: 'needle', ignore_case: true, glob: '*.txt' })).text).not.toContain('a.ts')
    expect((await c.call('search_text', { pattern: 'line', path: 'src', context: 1 })).text).toContain('src/a.ts-1- ')
    expect((await c.call('search_text', { pattern: 'x'.repeat(201) })).err).toBe(true)
    expect((await c.call('search_text', { pattern: '(' })).err).toBe(true)
  })

  it('search_text stops on a pathological pattern within the time cap', async () => {
    const d = mk('patho')
    put(d, 'p.txt', 'a'.repeat(40) + '!')
    const t0 = Date.now()
    const r = await open(d).call('search_text', { pattern: '^(a+)+$' })
    expect(Date.now() - t0).toBeLessThan(8000)
    expect(r.text).toContain('stopped early')
  })

  it('read_file_range numbers lines, caps at 800, refuses binary and big files', async () => {
    const d = mk('range')
    put(d, 'n.txt', Array.from({ length: 1000 }, (_, i) => `row${i + 1}`).join('\n') + '\n')
    put(d, 'b.bin', Buffer.from([0, 1, 2]))
    put(d, 'huge.txt', 'x'.repeat(2_100_000))
    const rc = open(d)
    const r = await rc.call('read_file_range', { path: 'n.txt', start_line: 5, end_line: 7 })
    expect(r.text).toContain('of 1000')
    expect(r.text).toMatch(/\n\s+5\| row5\n\s+6\| row6\n\s+7\| row7$/)
    const big = await rc.call('read_file_range', { path: 'n.txt', start_line: 1, end_line: 1000 })
    expect(big.text).toContain('capped at 800')
    expect(big.text).toContain('row800')
    expect(big.text).not.toContain('row801')
    expect((await rc.call('read_file_range', { path: 'n.txt' })).text).toContain('row200')
    expect((await rc.call('read_file_range', { path: 'b.bin' })).err).toBe(true)
    expect((await rc.call('read_file_range', { path: 'huge.txt' })).err).toBe(true)
  })

  it('jail refuses escapes and secret/internal paths', async () => {
    const outside = mk('outside'); put(outside, 'o.txt', 'outside data')
    const jroot = mk('jroot'); put(jroot, 'ok.txt', 'ok'); put(jroot, '.git/config', 'x'); put(jroot, 'auth-token', 't'); put(jroot, 'node_modules/m.js', 'm')
    put(jroot, '.ssh/id', 'k'); put(jroot, 'my-Secret.txt', 's'); put(jroot, 'cert.pem', 'p'); put(jroot, '.npmrc', 'n'); put(jroot, 'credentials.json', '{}')
    const jc = open(jroot)
    const bad = ['../outside/o.txt', join(outside, 'o.txt'), '.git/config', '.env', 'auth-token', 'node_modules/m.js', '.ssh/id', 'my-Secret.txt', 'cert.pem', '.npmrc', 'credentials.json']
    for (const p of bad) {
      const r = await jc.call('read_file_range', { path: p })
      expect(r.err, p).toBe(true)
      expect(r.text).not.toContain('outside data')
    }
    expect((await jc.call('read_file_range', { path: 'ok.txt' })).err).toBe(false)
    expect((await jc.call('list_files', { path: '..' })).err).toBe(true)
    expect((await jc.call('search_text', { pattern: 'x', path: '../outside' })).err).toBe(true)
    try {
      symlinkSync(outside, join(jroot, 'link'), 'junction')
      const r = await jc.call('read_file_range', { path: 'link/o.txt' })
      expect(r.err).toBe(true)
      expect(r.text).not.toContain('outside data')
      expect((await jc.call('list_files', { path: 'link' })).err).toBe(true)
    } catch (e: any) {
      if (e?.code === 'EPERM' || e?.code === 'EACCES') console.warn('SKIPPED symlink/junction case: OS refused', e.code)
      else throw e
    }
  })

  it('git tools: log, show, diff, and injection attempts', async () => {
    expect((await c.call('git_log')).text).toContain('first commit')
    expect((await c.call('git_log', { path: 'src/a.ts', max_count: 1, author: 't' })).text).toContain('first commit')
    expect((await c.call('git_show', { rev: 'HEAD' })).text).toContain('src/a.ts')
    expect((await c.call('git_show', { rev: 'HEAD' })).text).not.toContain('supersecret')
    const diff = await c.call('git_diff')
    expect(diff.text).toContain('+const needle = 2')
    expect((await c.call('git_diff', { stat_only: true })).text).toContain('src/a.ts')
    expect((await c.call('git_diff', { base: 'HEAD', head: 'HEAD' })).text).toContain('no differences')
    for (const rev of ['--output=x', '-p', 'HEAD; rm -rf x', 'HEAD\n--output=y', 'HEAD:.env', 'HEAD:../outside', '']) {
      expect((await c.call('git_show', { rev })).err, rev).toBe(true)
      expect((await c.call('git_diff', { base: rev || '-', head: 'HEAD' })).err).toBe(true)
    }
    expect((await c.call('git_log', { author: '--output=z' })).err).toBe(false) // value stays inside --author=
    await c.call('git_log', { path: '--output=q' }) // after `--` it is only a pathspec
    expect(existsSync(join(g, 'x')) || existsSync(join(g, 'y')) || existsSync(join(g, 'z')) || existsSync(join(g, 'q'))).toBe(false)
    const nogit = open(mk('nogit'))
    expect((await nogit.call('git_log')).err).toBe(true)
  })

  it('audit log has one line per call and no file contents', async () => {
    await c.call('read_file_range', { path: 'src/a.ts' })
    const lines = readFileSync(log, 'utf8').trim().split('\n').map(l => JSON.parse(l))
    expect(lines.length).toBeGreaterThan(10)
    expect(lines.at(-1)).toMatchObject({ tool: 'read_file_range', ok: true, args: { path: 'src/a.ts' } })
    expect(typeof lines[0].ms).toBe('number')
    expect(readFileSync(log, 'utf8')).not.toContain('const needle')
  })

  it('--print-config only prints', () => {
    const home = mk('home')
    for (const cli of ['codex', 'agy', 'claude', 'opencode', 'qoder']) {
      const r = spawnSync(process.execPath, [SCRIPT, '--print-config', cli, '--root', g], { encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: home } })
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('claude-office-tools')
      if (cli !== 'claude') expect(r.stdout).toContain('UNVERIFIED')
      expect(r.stdout).not.toContain('\\')
    }
    expect(readdirSync(home)).toEqual([])
  })
})
