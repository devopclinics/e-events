import { useEffect, useRef, useState, useCallback } from 'react'
import { api } from '../api'

function fmtTime(iso) {
  try { return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }
  catch { return '' }
}

export default function CommunityPage() {
  const [groups, setGroups] = useState([])
  const [activeId, setActiveId] = useState('')
  const [messages, setMessages] = useState([])
  const [members, setMembers] = useState([])
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const esRef = useRef(null)
  const bottomRef = useRef(null)

  const active = groups.find((g) => g.id === activeId)

  const loadGroups = useCallback(async () => {
    try { const g = await api.festiomeGroups(); setGroups(g); if (!g.some((x) => x.id === activeId)) setActiveId(g[0]?.id || '') }
    catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }, [activeId])

  useEffect(() => { loadGroups() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const upsert = useCallback((m) => {
    setMessages((prev) => prev.some((x) => x.id === m.id) ? prev.map((x) => x.id === m.id ? m : x) : [...prev, m])
  }, [])

  useEffect(() => {
    if (!activeId) { setMessages([]); setMembers([]); return }
    let closed = false
    ;(async () => {
      try {
        const [msgs, mem] = await Promise.all([api.festiomeMessages(activeId), api.festiomeMembers(activeId)])
        if (closed) return
        setMessages(msgs); setMembers(mem)
        api.festiomeRead(activeId).catch(() => {})
      } catch (e) { setErr(e.message) }
    })()
    // Live updates — mint a single-use stream ticket (no credential in the URL).
    ;(async () => {
      let ticket
      try { ({ ticket } = await api.festiomeStreamTicket(activeId)) } catch { return }
      if (closed || !ticket) return
      if (esRef.current) esRef.current.close()
      const es = new EventSource(api.festiomeStreamUrl(activeId, ticket))
      esRef.current = es
      es.onmessage = (e) => {
        const d = JSON.parse(e.data)
        if (d.type === 'message.created') upsert(d.message)
        else if (d.type === 'message.liked') setMessages((p) => p.map((m) => m.id === d.message_id ? { ...m, like_count: d.like_count } : m))
        else if (d.type === 'message.deleted') setMessages((p) => p.map((m) => m.id === d.message_id ? { ...m, deleted: true, body: '' } : m))
      }
    })()
    return () => { closed = true; if (esRef.current) { esRef.current.close(); esRef.current = null } }
  }, [activeId, upsert])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function send(e) {
    e?.preventDefault()
    const body = text.trim()
    if (!body || !activeId) return
    setText('')
    try { upsert(await api.festiomeSend(activeId, { body })) }
    catch (err) { setErr(err.message); setText(body) }
  }

  async function toggleLike(m) {
    const liked = !m.liked_by_me
    setMessages((p) => p.map((x) => x.id === m.id ? { ...x, liked_by_me: liked, like_count: x.like_count + (liked ? 1 : -1) } : x))
    try { liked ? await api.festiomeLike(m.id) : await api.festiomeUnlike(m.id) } catch { loadGroups() }
  }

  async function createGroup() {
    const name = window.prompt('Name your group')
    if (!name?.trim()) return
    try { const g = await api.festiomeCreateGroup({ name: name.trim() }); await loadGroups(); setActiveId(g.id) }
    catch (e) { setErr(e.message) }
  }

  return (
    <div className="max-w-6xl mx-auto h-[calc(100vh-8rem)] flex gap-4">
      {/* Groups sidebar */}
      <aside className="w-64 shrink-0 flex flex-col border border-slate-200 dark:border-slate-700 rounded-2xl bg-white dark:bg-slate-800 overflow-hidden">
        <div className="px-4 py-3 border-b dark:border-slate-700 flex items-center justify-between">
          <h2 className="font-bold text-slate-900 dark:text-white">Community</h2>
          <button onClick={createGroup} title="New group"
            className="w-7 h-7 rounded-lg bg-teal-600 text-white text-lg leading-none hover:bg-teal-700">+</button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading && <div className="p-4 text-sm text-slate-400">Loading…</div>}
          {!loading && groups.length === 0 && <div className="p-4 text-sm text-slate-400">No groups yet. Create one, or open a group from your event pass.</div>}
          {groups.map((g) => (
            <button key={g.id} onClick={() => setActiveId(g.id)}
              className={`w-full text-left px-4 py-3 border-b dark:border-slate-700/60 flex items-center gap-3 hover:bg-slate-50 dark:hover:bg-slate-700/40 ${g.id === activeId ? 'bg-teal-50 dark:bg-teal-900/20' : ''}`}>
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-teal-500 to-teal-700 text-white grid place-items-center font-bold text-sm shrink-0">
                {(g.name || '?').slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-sm text-slate-800 dark:text-slate-100 truncate">{g.name}</div>
                <div className="text-xs text-slate-400">{g.member_count} member{g.member_count === 1 ? '' : 's'}</div>
              </div>
              {g.unread > 0 && <span className="text-[11px] font-bold bg-teal-600 text-white rounded-full px-2 py-0.5">{g.unread}</span>}
            </button>
          ))}
        </div>
      </aside>

      {/* Chat */}
      <section className="flex-1 flex flex-col border border-slate-200 dark:border-slate-700 rounded-2xl bg-white dark:bg-slate-800 overflow-hidden">
        {!active ? (
          <div className="flex-1 grid place-items-center text-slate-400 text-sm">Select a group to start chatting.</div>
        ) : (
          <>
            <header className="px-5 py-3 border-b dark:border-slate-700 flex items-center justify-between">
              <div>
                <div className="font-bold text-slate-900 dark:text-white">{active.name}</div>
                <div className="text-xs text-slate-400">{members.length} member{members.length === 1 ? '' : 's'}{active.announce_only ? ' · announcements' : ''}</div>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {messages.map((m) => m.system ? (
                <div key={m.id} className="text-center text-xs text-slate-400 py-1">{m.body}</div>
              ) : (
                <div key={m.id} className="group flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-600 grid place-items-center text-xs font-bold text-slate-600 dark:text-slate-200 shrink-0">
                    {(m.sender_name || '?').slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="font-semibold text-sm text-slate-800 dark:text-slate-100">{m.sender_name}</span>
                      <span className="text-[11px] text-slate-400">{fmtTime(m.created_at)}</span>
                    </div>
                    <div className={`text-sm ${m.deleted ? 'italic text-slate-400' : 'text-slate-700 dark:text-slate-200'} whitespace-pre-wrap break-words`}>
                      {m.deleted ? 'Message deleted' : m.body}
                    </div>
                  </div>
                  {!m.deleted && (
                    <button onClick={() => toggleLike(m)}
                      className={`self-center text-xs flex items-center gap-1 px-2 py-1 rounded-full transition ${m.liked_by_me ? 'text-rose-500' : 'text-slate-300 dark:text-slate-500 hover:text-rose-400 opacity-0 group-hover:opacity-100'} ${m.like_count ? 'opacity-100' : ''}`}>
                      <span>{m.liked_by_me ? '♥' : '♡'}</span>{m.like_count > 0 && <span>{m.like_count}</span>}
                    </button>
                  )}
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {active.announce_only && active.my_role === 'member' ? (
              <div className="px-5 py-3 border-t dark:border-slate-700 text-xs text-slate-400 text-center">Only admins can post in this announcement group.</div>
            ) : (
              <form onSubmit={send} className="px-4 py-3 border-t dark:border-slate-700 flex gap-2">
                <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message"
                  className="flex-1 border dark:border-slate-600 rounded-full px-4 py-2 text-sm bg-white dark:bg-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500" />
                <button type="submit" disabled={!text.trim()}
                  className="bg-teal-600 text-white px-4 py-2 rounded-full text-sm font-semibold hover:bg-teal-700 disabled:opacity-40">Send</button>
              </form>
            )}
          </>
        )}
      </section>
      {err && <div className="fixed bottom-4 right-4 bg-red-600 text-white text-sm px-4 py-2 rounded-lg shadow-lg" onClick={() => setErr('')}>{err}</div>}
    </div>
  )
}
