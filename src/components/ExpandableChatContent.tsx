import React, { useId, useState } from 'react'
import ChatContent from './ChatContent'
import { chatPreview } from '../chatPreview'

export default function ExpandableChatContent({ text, messageId, readOnly = false, onResize, initiallyExpanded = false }: {
  text: string; messageId: number; readOnly?: boolean; onResize?: () => void; initiallyExpanded?: boolean
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded)
  const id = useId()
  const preview = chatPreview(text)
  return <div className="chat-expandable">
    <div id={id} className={preview.long && !expanded ? 'chat-message-preview is-collapsed' : 'chat-message-preview'}>
      <ChatContent text={text} messageId={messageId} readOnly={readOnly} previewCharacters={preview.long && !expanded ? preview.characters : undefined} />
    </div>
    {preview.long && <button type="button" className="chat-expand-toggle" aria-expanded={expanded} aria-controls={id} onClick={() => {
      setExpanded(!expanded)
      // React commits the new height before the parent's scroll adjustment.
      requestAnimationFrame(() => onResize?.())
    }}>{expanded ? 'Show less' : 'Show more'}</button>}
  </div>
}
