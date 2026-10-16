import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import { chatWidgetConfig, selectChatSession, widgetUrl, validSupportIdentity, connectChatFrame } from '../lib/chatWidget.mjs'
import './SupportWidget.css'

const config = chatWidgetConfig(import.meta.env, window.location.origin)

function ChatSession({ session }) {
  const [available, setAvailable] = useState(session.mode === 'sales')
  const [identity, setIdentity] = useState(null)
  const [open, setOpen] = useState(false)
  const [started, setStarted] = useState(false)
  const [ready, setReady] = useState(false)
  const [delayed, setDelayed] = useState(false)
  const frame = useRef(null)
  const launcher = useRef(null)
  const closeButton = useRef(null)

  useEffect(() => {
    if (session.mode !== 'support') return
    let cancelled = false
    // The existing server-side switch and signed organizer identity remain
    // mandatory. Anonymous sales never calls either authenticated endpoint.
    api.platformSettings().then(async ({ support_chat_enabled }) => {
      if (cancelled || support_chat_enabled !== true) return
      const signedIdentity = await api.supportIdentify()
      if (cancelled || !validSupportIdentity(signedIdentity)) return
      setIdentity(signedIdentity)
      setAvailable(true)
    }).catch(() => {}) // Chat being unavailable must never block the app.
    return () => { cancelled = true }
  }, [session])

  function close() {
    setOpen(false)
    launcher.current?.focus()
  }

  useLayoutEffect(() => {
    if (!started || !frame.current) return
    const disconnect = connectChatFrame({ frame: frame.current, session, identity, onReady: () => setReady(true), onClose: close })
    const timer = window.setTimeout(() => setDelayed(true), 15000)
    return () => {
      disconnect()
      window.clearTimeout(timer)
    }
  }, [started, session, identity])

  useEffect(() => {
    if (!open) return
    closeButton.current?.focus()
    const onKey = (event) => { if (event.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!available) return null
  const title = session.mode === 'sales' ? 'Chat with Festio sales' : 'Festio support'
  return (
    <div className="festio-chat">
      <button ref={launcher} type="button" className="festio-chat-launcher" aria-expanded={open} aria-controls="festio-chat-panel" onClick={() => { setStarted(true); setOpen((value) => !value) }}>
        {title}
      </button>
      {started && (
        <section id="festio-chat-panel" className="festio-chat-panel" role="dialog" aria-label={title} hidden={!open}>
          <header><strong>{title}</strong><button ref={closeButton} type="button" aria-label="Close chat" onClick={close}>×</button></header>
          {!ready && <p role="status">{delayed ? 'Chat is taking longer than expected. You can close it and try again later.' : 'Connecting to chat…'}</p>}
          <iframe
            ref={frame}
            src={widgetUrl(session)}
            title={title}
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-same-origin allow-forms"
          />
        </section>
      )}
    </div>
  )
}

export default function SupportWidget() {
  const { user, loading } = useAuth()
  const { pathname } = useLocation()
  const session = useMemo(() => selectChatSession({ user, loading, pathname, config }), [user, loading, pathname])
  if (!session) return null
  // Unmounting destroys the iframe and its bridge on route, login/logout, or
  // account changes. No Chatwoot SDK global or cookie is shared between modes.
  const key = `${session.mode}:${user?.id || 'anonymous'}:${user?.org_id || user?.organization_id || ''}:${pathname}`
  return <ChatSession key={key} session={session} />
}
