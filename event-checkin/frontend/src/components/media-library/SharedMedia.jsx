import { useEffect, useRef, useState } from 'react'
import { api } from '../../api'
import './MediaLibrary.css'

export function SharedMediaFiles({ eventId, imagesOnly = false, onSelect }) {
  const [data, setData] = useState(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState(''),
    [status, setStatus] = useState(''),
    [editing, setEditing] = useState(''),
    [title, setTitle] = useState('')
  const input = useRef(null),
    generation = useRef(0)
  async function load() {
    const version = ++generation.current
    setError('')
    try {
      const result = await api.listSharedMedia(eventId)
      if (version === generation.current) setData(result)
    } catch (e) {
      if (version === generation.current) setError(e.message)
    }
  }
  useEffect(() => {
    setData(null)
    load()
    return () => {
      generation.current++
    }
  }, [eventId])
  async function upload(file) {
    if (!file) return
    setBusy(true)
    setStatus('')
    setError('')
    const version = generation.current
    try {
      await api.uploadSharedMedia(eventId, file)
      if (version !== generation.current) return
      await load()
      setStatus(
        'File added to the organization library. It is now available to its other events.',
      )
    } catch (e) {
      if (version === generation.current) setError(e.message)
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }
  async function rename(event, asset) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api.renameSharedMedia(eventId, asset.id, title.trim())
      setEditing('')
      await load()
      setStatus('File name updated. Existing links stay the same.')
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }
  async function remove(asset) {
    if (
      !window.confirm(
        `Remove “${asset.title}” from the library? Existing event links will keep working.`,
      )
    )
      return
    setBusy(true)
    setError('')
    try {
      await api.removeSharedMedia(eventId, asset.id)
      await load()
      setStatus('Removed from the library. Existing event links are preserved.')
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }
  async function copy(asset) {
    try {
      await navigator.clipboard.writeText(
        new URL(asset.url, window.location.origin).href,
      )
      setStatus(
        'File link copied. Paste it into an event’s image or resource URL field.',
      )
    } catch {
      setError(
        'Clipboard access was blocked. Open the file and copy its address instead.',
      )
    }
  }
  const assets = (data?.assets || []).filter(
    (asset) =>
      (!imagesOnly || asset.content_type.startsWith('image/')) &&
      `${asset.title} ${asset.filename}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  )
  return (
    <section className="ml-shared" aria-label="Shared organization files">
      <div className="ml-shared-head">
        <div>
          <p className="ml-eyebrow">
            {data?.organization?.name || 'ORGANIZATION MEDIA'}
          </p>
          <h3>Upload once. Use it again.</h3>
          <p>
            Available across this organization’s events. Files are accessible to
            anyone with their link; use public event materials only.
          </p>
        </div>
        <div>
          <button type="button" className="ml-button primary" disabled={busy} onClick={()=>input.current?.click()}>{busy ? 'Working…' : 'Upload file +'}</button>
          <input
            className="sr-only"
            ref={input}
            type="file"
            aria-label="Upload shared media file"
            accept={
              imagesOnly
                ? 'image/jpeg,image/png,image/webp'
                : 'image/jpeg,image/png,image/webp,application/pdf'
            }
            disabled={busy}
            onChange={(e) => upload(e.target.files?.[0])}
          />
          <small>{imagesOnly ? "JPG, PNG, WebP · 5 MB" : "JPG, PNG, WebP · 5 MB · PDF · 20 MB"}</small>
        </div>
      </div>
      <label className="ml-search">
        <span className="sr-only">Search shared files</span>
        <input
          type="search"
          placeholder="Find an uploaded file…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {status && (
        <p role="status" className="ml-notice">
          {status}
        </p>
      )}
      {error && (
        <div role="alert" className="ml-notice">
          {error}{' '}
          <button className="ml-button" disabled={busy} onClick={load}>
            Retry loading
          </button>
        </div>
      )}
      {!data && !error ? (
        <p role="status">Loading shared files…</p>
      ) : (
        <>
          <div className="ml-file-grid">
            {assets.map((asset) => (
              <article className="ml-file" key={asset.id}>
                <a
                  className="ml-shared-art"
                  href={asset.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {asset.content_type.startsWith('image/') ? (
                    <img src={asset.url} alt={asset.title} loading="lazy" />
                  ) : (
                    <span>
                      PDF
                      <br />
                      <i>Ready to share.</i>
                    </span>
                  )}
                </a>
                <div className="ml-file-body">
                  <span className="ml-eyebrow">
                    {asset.content_type === 'application/pdf' ? 'PDF' : 'IMAGE'}{' '}
                    ·{' '}
                    {Math.max(
                      1,
                      Math.round(asset.byte_size / 1024),
                    ).toLocaleString()}{' '}
                    KB{asset.width ? ` · ${asset.width} × ${asset.height}` : ''}
                  </span>
                  {editing === asset.id ? (
                    <form onSubmit={(e) => rename(e, asset)}>
                      <label>
                        File name
                        <input
                          value={title}
                          maxLength={255}
                          required
                          onChange={(e) => setTitle(e.target.value)}
                        />
                      </label>
                      <div className="ml-actions">
                        <button
                          className="ml-button primary"
                          disabled={busy || !title.trim()}
                        >
                          Save name
                        </button>
                        <button
                          type="button"
                          className="ml-button"
                          onClick={() => setEditing('')}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <h3>{asset.title}</h3>
                  )}
                  <div className="ml-actions">
                    {onSelect && (
                      <button
                        type="button"
                        className="ml-button primary"
                        disabled={busy}
                        onClick={() => onSelect(asset)}
                      >
                        Use this image
                      </button>
                    )}
                    <button
                      type="button"
                      className="ml-button"
                      onClick={() => copy(asset)}
                    >
                      Copy file link
                    </button>
                    <a
                      className="ml-text-link"
                      href={asset.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open ↗
                    </a>
                    {!onSelect && (
                      <>
                        <button
                          className="ml-text-link"
                          disabled={busy}
                          onClick={() => {
                            setEditing(asset.id)
                            setTitle(asset.title)
                          }}
                        >
                          Rename
                        </button>
                        <button
                          className="ml-text-link"
                          disabled={busy}
                          onClick={() => remove(asset)}
                        >
                          Remove
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
          {!assets.length && data && (
            <div className="ml-empty">
              <h3>
                {query ? 'No files match.' : 'A shared collection starts here.'}
              </h3>
              <p>
                {query
                  ? 'Try another file name.'
                  : 'Upload a logo, photograph, venue image or PDF to reuse across events.'}
              </p>
            </div>
          )}
        </>
      )}
    </section>
  )
}
export function SharedMediaCollection() {
  const [events, setEvents] = useState(null),
    [eventId, setEventId] = useState(''),
    [error, setError] = useState('')
  async function load() {
    setError('')
    try {
      const rows = await api.listEvents()
      setEvents(rows)
      setEventId((previous) =>
        rows.some((e) => e.id === previous) ? previous : rows[0]?.id || '',
      )
    } catch (e) {
      setError(e.message)
    }
  }
  useEffect(() => {
    load()
  }, [])
  return (
    <>
      {error && (
        <p role="alert" className="ml-notice">
          {error}{' '}
          <button className="ml-button" onClick={load}>
            Retry
          </button>
        </p>
      )}
      {!events && !error && <p role="status">Loading event access…</p>}
      {events && (
        <>
          <label className="ml-shared-event">
            Choose an event to open its organization library
            <select
              value={eventId}
              onChange={(e) => setEventId(e.target.value)}
            >
              <option value="">Select an event</option>
              {events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.name}
                </option>
              ))}
            </select>
          </label>
          {!events.length && (
            <p className="ml-notice">
              Create an event first to use shared organization media.
            </p>
          )}
          {eventId && <SharedMediaFiles key={eventId} eventId={eventId} />}
        </>
      )}
    </>
  )
}
export function SharedMediaPicker({
  eventId,
  onSelect,
  label = 'Choose from shared media',
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="ml-button" onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && (
        <SharedMediaDialog onClose={() => setOpen(false)}>
          <SharedMediaFiles
            key={eventId}
            eventId={eventId}
            imagesOnly
            onSelect={(asset) => {
              onSelect(asset)
              setOpen(false)
            }}
          />
        </SharedMediaDialog>
      )}
    </>
  )
}
function SharedMediaDialog({ children, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    const previous = document.activeElement
    ref.current.showModal()
    return () => previous?.focus()
  }, [])
  return (
    <dialog
      className="ml-dialog"
      ref={ref}
      aria-label="Choose a shared image"
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <header>
        <h2>Your organization’s images</h2>
        <button
          className="ml-icon"
          type="button"
          aria-label="Close shared media"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <div className="ml-shared-dialog-body">{children}</div>
    </dialog>
  )
}
