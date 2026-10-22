import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { chatTokens, targetKind } from '../../server/chat-markup.mjs'
import { getUiToken } from '../permissions'
import { officeHttpBase } from '../serverUrl'
import '../styles/chat-content.css'
import { displayChatText } from '../chatText'

interface FileLink { target: string; label: string }
interface Props { text: string; messageId: number; readOnly?: boolean; basePath?: string; onOpen?: (file: FileLink) => void; previewCharacters?: number }
const resolveTarget = (target: string, base?: string) => base && targetKind(target) === 'local' && !/^(?:[a-z]:[\\/]|\/)/i.test(target)
  ? `${base.replace(/\\/g, '/').replace(/[^/]*$/, '')}${target}` : target

async function artifact(messageId: number, target: string, signal: AbortSignal) {
  const token = getUiToken()
  if (!token) throw new Error('Open the authenticated Office page to preview local files.')
  const res = await fetch(`${officeHttpBase()}/chat/artifact?${new URLSearchParams({ messageId: String(messageId), path: target })}`, { headers: { Authorization: `Bearer ${token}` }, signal })
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'File could not be opened.')
  return res
}

function LocalImage({ messageId, file, readOnly, open }: { messageId: number; file: FileLink; readOnly: boolean; open: (file: FileLink) => void }) {
  const [src, setSrc] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    let url = ''
    setSrc(''); setError('')
    if (!readOnly) void artifact(messageId, file.target, controller.signal).then(r => {
      if (!r.headers.get('content-type')?.startsWith('image/')) throw new Error('This file is not a supported image.')
      return r.blob()
    }).then(blob => {
      if (controller.signal.aborted) return
      url = URL.createObjectURL(blob); setSrc(url)
    }).catch(e => { if (!controller.signal.aborted) setError(e.message) })
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url) }
  }, [messageId, file.target, readOnly])
  return <button type="button" className="chat-image-link" disabled={readOnly} onClick={() => open(file)} title={error || file.label}>
    {src ? <img src={src} alt={file.label} loading="lazy" /> : <span>{error || (readOnly ? 'Sign in to preview: ' : 'Loading image: ')}{file.label}</span>}
  </button>
}

function FilePreview({ file, messageId, close, navigate }: { file: FileLink; messageId: number; close: () => void; navigate: (file: FileLink) => void }) {
  const panel = useRef<HTMLElement>(null)
  const [text, setText] = useState<string | null>(null)
  const [src, setSrc] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    let url = ''
    setText(null); setSrc(''); setError('')
    void artifact(messageId, file.target, controller.signal).then(async r => {
      if (r.headers.get('content-type')?.startsWith('image/')) {
        const blob = await r.blob()
        if (!controller.signal.aborted) { url = URL.createObjectURL(blob); setSrc(url) }
      } else {
        const body = await r.text()
        if (!controller.signal.aborted) setText(body)
      }
    }).catch(e => { if (!controller.signal.aborted) setError(e.message) })
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url) }
  }, [messageId, file.target])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); close() }
      if (event.key === 'Tab') {
        const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]') ?? [])
        const first = controls[0], last = controls[controls.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [close])
  return createPortal(<div className="chat-file-backdrop" onClick={close}>
    <section ref={panel} className="chat-file-preview" role="dialog" aria-modal="true" aria-label={`File preview: ${file.label}`} onClick={e => e.stopPropagation()}>
      <header><strong>{file.label}</strong><button type="button" onClick={close} autoFocus>Close preview</button></header>
      <div className="chat-file-path">{file.target}</div>
      <div className="chat-file-body">
        {error ? <p role="alert">{error}</p> : src ? <img className="chat-file-image" src={src} alt={file.label} /> : text !== null
          ? /\.md$/i.test(file.target) ? <ChatContent text={text} messageId={messageId} basePath={file.target} onOpen={navigate} /> : <pre>{text}</pre>
          : <p role="status">Loading file…</p>}
      </div>
    </section>
  </div>, document.body)
}

export default function ChatContent({ text, messageId, readOnly = false, basePath, onOpen, previewCharacters }: Props) {
  const [selected, setSelected] = useState<FileLink | null>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const open = onOpen ?? ((file: FileLink) => { trigger.current = document.activeElement as HTMLElement; setSelected(file) })
  let remaining = previewCharacters ?? Infinity
  const tokens = chatTokens(displayChatText(text)).flatMap(token => {
    if (remaining <= 0) return []
    const label = token.label.slice(0, remaining)
    remaining -= token.label.length
    return [{ ...token, label }]
  })
  return <>
    <span className="chat-rich-text">{tokens.map((token, index) => {
      if (token.kind === 'text') return <React.Fragment key={index}>{token.label}</React.Fragment>
      if (token.kind === 'code') return <code key={index}>{token.label}</code>
      const target = resolveTarget(token.target ?? '', basePath)
      const kind = targetKind(target)
      if (!kind) return <React.Fragment key={index}>{token.label}</React.Fragment>
      const file = { target, label: token.label || target }
      if (kind === 'web') return <a key={index} href={target} target="_blank" rel="noopener noreferrer" className={token.kind === 'image' ? 'chat-image-link' : 'chat-text-link'}>
        {token.kind === 'image' ? <img src={target} alt={file.label} loading="lazy" referrerPolicy="no-referrer" /> : file.label}
      </a>
      return token.kind === 'image'
        ? <LocalImage key={index} messageId={messageId} file={file} readOnly={readOnly} open={open} />
        : <button key={index} type="button" className="chat-text-link" disabled={readOnly || messageId <= 0} onClick={() => open(file)} title={readOnly ? 'Open the authenticated Office page to read local files.' : target}>{file.label}</button>
    })}</span>
    {!onOpen && selected && <FilePreview file={selected} messageId={messageId} close={() => { setSelected(null); trigger.current?.focus() }} navigate={setSelected} />}
  </>
}
