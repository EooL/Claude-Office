/**
 * ThemedSelect — a dropdown in the office's own style. The browser's native list ignores the theme,
 * so this draws it: a button that shows the choice and a listbox under it. Keyboard: Arrow keys move,
 * Enter or Space picks, Escape closes, Home and End jump. A disabled option is shown but cannot be picked.
 */

import React, { useEffect, useRef, useState } from 'react'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

interface Props {
  id: string
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  disabled?: boolean
}

export default function ThemedSelect({ id, value, options, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const selectedIndex = Math.max(0, options.findIndex(o => o.value === value))
  const selected = options[selectedIndex]

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Keep the list, and the option the keyboard is on, in view of the panel that scrolls
  useEffect(() => {
    if (open) list.current?.scrollIntoView?.({ block: 'nearest' })
  }, [open])
  useEffect(() => {
    if (open) list.current?.children[active]?.scrollIntoView?.({ block: 'nearest' })
  }, [open, active])

  const openList = () => { setActive(selectedIndex); setOpen(true) }
  const pick = (i: number) => {
    const option = options[i]
    if (!option || option.disabled) return
    setOpen(false)
    if (option.value !== value) onChange(option.value)
  }
  // The next option the keyboard can land on, skipping disabled ones
  const step = (from: number, dir: 1 | -1) => {
    for (let i = from + dir; i >= 0 && i < options.length; i += dir) if (!options[i].disabled) return i
    return from
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); if (open) setActive(a => step(a, 1)); else openList(); break
      case 'ArrowUp': e.preventDefault(); if (open) setActive(a => step(a, -1)); else openList(); break
      case 'Home': if (open) { e.preventDefault(); setActive(step(-1, 1)) } break
      case 'End': if (open) { e.preventDefault(); setActive(step(options.length, -1)) } break
      case 'Enter':
      case ' ': e.preventDefault(); if (open) pick(active); else openList(); break
      case 'Escape': if (open) { e.preventDefault(); e.stopPropagation(); setOpen(false) } break
      case 'Tab': setOpen(false); break
    }
  }

  return (
    <div className="ts" ref={root}>
      <button
        type="button"
        id={id}
        className="ts-button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-activedescendant={open ? `${id}-opt-${active}` : undefined}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
      >
        <span className="ts-label">{selected?.label}</span>
        <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <ul className="ts-list" id={`${id}-list`} role="listbox" ref={list}>
          {options.map((o, i) => (
            <li
              key={o.value}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={o.value === value}
              aria-disabled={o.disabled || undefined}
              className={`ts-option${i === active ? ' is-active' : ''}`}
              onMouseEnter={() => { if (!o.disabled) setActive(i) }}
              onMouseDown={e => e.preventDefault()}
              onClick={() => pick(i)}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
