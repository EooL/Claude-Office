/**
 * ModelCombo — the model field of an agent: type a name, or search and pick from what the service
 * can run (593 for OpenCode, so the list narrows as you type and shows the first matches). A name that
 * is not listed is accepted too. onCommit fires when a choice is made: a pick, Enter, or leaving the field.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'

export interface ModelOption {
  id: string
  label: string
  note?: string
}

interface Props {
  id: string
  value: string
  options: ModelOption[]
  placeholder: string
  disabled?: boolean
  onChange: (value: string) => void
  onCommit: (value: string) => void
}

const MAX_SHOWN = 60

export default function ModelCombo({ id, value, options, placeholder, disabled, onChange, onCommit }: Props) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState(false) // narrow the list only once the person has typed
  const [active, setActive] = useState(-1)
  const list = useRef<HTMLUListElement>(null)

  const shown = useMemo(() => {
    const q = typed ? value.trim().toLowerCase() : ''
    const hits = q ? options.filter(o => o.id.toLowerCase().includes(q) || o.label.toLowerCase().includes(q)) : options
    return hits.slice(0, MAX_SHOWN)
  }, [options, value, typed])

  useEffect(() => {
    if (open && active >= 0) list.current?.children[active]?.scrollIntoView?.({ block: 'nearest' })
  }, [open, active])
  useEffect(() => {
    if (open) list.current?.scrollIntoView?.({ block: 'nearest' })
  }, [open])

  const pick = (o: ModelOption) => {
    setOpen(false)
    setTyped(false)
    onChange(o.id)
    onCommit(o.id)
  }
  const finish = () => { setOpen(false); setTyped(false); setActive(-1); onCommit(value) }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(a => Math.min(shown.length - 1, a + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(-1, a - 1)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      if (open && active >= 0 && shown[active]) pick(shown[active])
      else finish()
    } else if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); setOpen(false) }
  }

  return (
    <div className="ts">
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? `${id}-opt-${active}` : undefined}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={100}
        autoComplete="off"
        spellCheck={false}
        onChange={e => { onChange(e.target.value); setTyped(true); setActive(-1); setOpen(true) }}
        onFocus={() => { if (options.length) setOpen(true) }}
        onBlur={finish}
        onKeyDown={onKeyDown}
      />
      {options.length > 0 && !disabled && (
        <button
          type="button"
          className="ts-chevron"
          tabIndex={-1}
          aria-label={open ? 'Hide the models' : 'Show the models'}
          onMouseDown={e => e.preventDefault()}
          onClick={() => { setTyped(false); setOpen(o => !o) }}
        >
          <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      )}
      {open && shown.length > 0 && (
        <ul className="ts-list" id={`${id}-list`} role="listbox" ref={list}>
          {shown.map((o, i) => (
            <li
              key={o.id}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={o.id === value}
              className={`ts-option ts-model${i === active ? ' is-active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={e => e.preventDefault()}
              onClick={() => pick(o)}
            >
              <span className="ts-model-id">{o.id}</span>
              {o.label !== o.id && <span className="ts-model-label">{o.label}</span>}
              {o.note && <span className="ts-model-note">{o.note}</span>}
            </li>
          ))}
          {typed && value.trim() && shown.length === MAX_SHOWN && <li className="ts-more" aria-hidden="true">Keep typing to narrow the list…</li>}
        </ul>
      )}
    </div>
  )
}
