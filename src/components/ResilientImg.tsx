import React, { useEffect, useRef, useState } from 'react'

const RETRY_MS = 3000
const MAX_TRIES = 5

/**
 * An <img> that survives the office server being away for a moment.
 *
 * A sprite for a new direction, a new effect or a new piece of furniture is fetched the first time it is needed; if the
 * server is not reachable just then the browser shows a broken picture with its alt text. This keeps showing the last
 * picture that loaded and asks for the missing one again every few seconds (at most MAX_TRIES times), switching to it
 * as soon as it can be loaded.
 */
const ResilientImg: React.FC<React.ImgHTMLAttributes<HTMLImageElement> & { src: string }> = ({ src, onLoad, onError, alt = '', ...rest }) => {
  const good = useRef<string | null>(null)
  const [failed, setFailed] = useState<{ src: string, tries: number } | null>(null)
  const tries = failed?.src === src ? failed.tries : 0
  const shown = tries > 0 && good.current && good.current !== src ? good.current : src

  useEffect(() => {
    if (!failed || failed.src !== src || failed.tries > MAX_TRIES) return
    let probe: HTMLImageElement | null = null
    const timer = setTimeout(() => {
      probe = new Image()
      probe.onload = () => setFailed(null) // reachable again: ask for the real picture
      probe.onerror = () => setFailed({ src, tries: failed.tries + 1 })
      probe.src = `${src}${src.includes('?') ? '&' : '?'}retry=${failed.tries}`
    }, RETRY_MS)
    return () => { clearTimeout(timer); if (probe) { probe.onload = null; probe.onerror = null } }
  }, [failed, src])

  return (
    <img
      {...rest}
      src={shown}
      alt={alt}
      onLoad={(event) => { if (shown === src) good.current = src; onLoad?.(event) }}
      onError={(event) => { if (shown === src) setFailed({ src, tries: tries + 1 }); onError?.(event) }}
    />
  )
}

export default ResilientImg
