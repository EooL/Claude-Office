#!/usr/bin/env node
// Run a real local/CI command and report its actual exit status to Office.
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { office } from './office-client.mjs'

const KINDS = { test: ['test_start', 'test_ok', 'test_failed'], build: ['build_start', 'build_ok', 'build_failed'], deploy: ['deploy_start', 'deploy_success', 'deploy_fail'] }
export async function reportRun(family, target, command, args = [], report = office) {
  const kinds = KINDS[family]
  if (!kinds || !target || !command) throw new Error('Usage: node scripts/report-run.mjs test|build|deploy <target> -- <executable> [args...]')
  const emit = (kind, extra = {}) => report('/event', { type: 'signal', project: target, signals: [{ kind, target, ...extra }] })
  await emit(kinds[0])
  const outcome = await new Promise(resolve => {
    const child = spawn(command, args, { stdio: 'inherit', shell: false, windowsHide: true })
    child.once('error', () => resolve({ code: 1, interrupted: false, detail: 'Command could not start' }))
    child.once('exit', (code, signal) => resolve({ code: code ?? 1, interrupted: !!signal }))
  })
  await emit(outcome.code === 0 ? kinds[1] : kinds[2], { exitCode: Math.min(255, Math.max(0, outcome.code)), ...(outcome.interrupted ? { interrupted: true } : {}), ...(outcome.detail ? { detail: outcome.detail } : {}) })
  return outcome.code
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [family, target, separator, command, ...args] = process.argv.slice(2)
  try {
    if (separator !== '--') throw new Error('Expected -- before the executable')
    process.exitCode = await reportRun(family, target, command, args)
  } catch (error) { console.error(error.message); process.exitCode = 2 }
}
