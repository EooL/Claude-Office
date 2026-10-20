import { useEffect, useSyncExternalStore } from 'react'
import { officeHttpBase } from './serverUrl'

export type EventMode = 'real' | 'emulated'
let mode: EventMode = 'real'
const listeners = new Set<() => void>()
export const getEventMode = () => mode
export function setEventMode(next: EventMode) {
  if (mode === next) return
  mode = next
  listeners.forEach(fn => fn())
}
export function useEventMode(sync = false) {
  const value = useSyncExternalStore(fn => { listeners.add(fn); return () => { listeners.delete(fn) } }, getEventMode)
  useEffect(() => {
    if (!sync) return
    const controller = new AbortController()
    const load = () => { void fetch(`${officeHttpBase()}/settings`, { signal: controller.signal }).then(r => r.ok ? r.json() : null).then(d => {
      if (d?.eventMode === 'real' || d?.eventMode === 'emulated') setEventMode(d.eventMode)
    }).catch(() => {}) }
    load()
    const timer = setInterval(load, 5000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [sync])
  return value
}
