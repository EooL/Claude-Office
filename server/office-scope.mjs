import { AsyncLocalStorage } from 'node:async_hooks'
import { defaultOffice } from './default-office.mjs'
import { liveOffices } from './building-runtime.mjs'

// BUILDING: request-local ownership, shared by the one HTTP/WebSocket server.
const scope = new AsyncLocalStorage()

export function currentOffice() {
  const office = scope.getStore()
  if (office) {
    if (!liveOffices().includes(office)) throw new Error('Office is not live')
    return office
  }
  if (liveOffices().length === 1) return defaultOffice
  throw new Error('Office scope required')
}

export function runInOffice(office, fn, ...args) {
  if (!liveOffices().includes(office)) throw new Error('Office is not live')
  return scope.run(office, fn, ...args)
}

/**
 * setTimeout bound to the office in scope now. A detached office's timer is dropped instead of
 * throwing 'Office is not live' from a timer callback (an uncaught exception kills every office).
 */
export function officeTimeout(fn, ms) {
  const office = currentOffice()
  return setTimeout(() => {
    if (!liveOffices().includes(office)) return
    try { runInOffice(office, fn) } catch (err) {
      // Only the detach race is swallowed; fn's own errors surface like any timer error.
      if (err?.message !== 'Office is not live' || liveOffices().includes(office)) throw err
    }
  }, ms)
}

/** Keep closure aliases stable while invoking native methods on their real receiver. */
export function scopedObject(resolve, target) {
  return new Proxy(target, {
    get(_target, key) {
      const current = resolve()
      const value = Reflect.get(current, key, current)
      return typeof value === 'function' ? value.bind(current) : value
    },
    set(_target, key, value) {
      const current = resolve()
      return Reflect.set(current, key, value, current)
    },
    has(_target, key) { return Reflect.has(resolve(), key) },
    ownKeys() { return Reflect.ownKeys(resolve()) },
    getOwnPropertyDescriptor(_target, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(resolve(), key)
      if (!descriptor) return undefined
      // Array length is the only non-configurable own property in our targets.
      const fixed = Reflect.getOwnPropertyDescriptor(target, key)
      return { ...descriptor, configurable: fixed?.configurable === false ? false : true }
    },
    deleteProperty(_target, key) { return Reflect.deleteProperty(resolve(), key) },
    defineProperty(_target, key, descriptor) {
      // A non-configurable property cannot safely be forwarded across offices.
      if (descriptor.configurable !== true && !Reflect.getOwnPropertyDescriptor(target, key)) return false
      return Reflect.defineProperty(resolve(), key, descriptor)
    },
    getPrototypeOf() { return Reflect.getPrototypeOf(resolve()) },
    // Freezing a facade would freeze only one office and violate proxy invariants.
    preventExtensions() { return false },
    setPrototypeOf() { return false },
  })
}

export function scopedState(name) {
  return scopedObject(() => currentOffice().state[name], defaultOffice.state[name])
}
