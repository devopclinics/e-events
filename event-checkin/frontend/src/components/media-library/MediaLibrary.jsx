import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import {
  INTERNAL_DOCS,
  PDFS,
  HTML_ASSETS,
  SCREENSHOTS,
} from '../../pages/MediaPage'
import {
  MEDIA_TEMPLATES,
  DEFAULT_BRIEF,
  buildMediaDocument,
  mediaPlainText,
  mediaLink,
} from './templates.mjs'
import './MediaLibrary.css'
import { SharedMediaCollection } from './SharedMedia'
import { MEDIA_COVERS } from './covers.mjs'

const COLLECTIONS = [
  ['templates', 'Create & reuse', 'A fresh version for every audience.'],
  ['uploads', 'Shared uploads', 'Images and files for every event in your organization.'],
  [
    'presentations',
    'Presentations',
    'Client-specific materials, kept together.',
  ],
  ['screenshots', 'Product images', 'Reference images from the product guide.'],
  ['internal', 'Team resources', 'Guides and operational reference.'],
  [
    'archive',
    'Needs review',
    'Earlier drafts and materials to verify before sharing.',
  ],
]
const historical = (href) =>
  /festio-onepager|festio-pitch|getting-started|partnership-proposal|competitor-pricing|paman-partnership|paman-live/.test(
    href,
  )
// Keep source files intact. Outdated materials are excluded from the main collections.
export const MEDIA_ASSETS = [...PDFS, ...HTML_ASSETS].map((asset) => ({
  ...asset,
  collection: /qa-checklist|qa-modules/.test(asset.href)
    ? 'internal'
    : historical(asset.href)
      ? 'archive'
      : 'presentations',
}))
function groupFiles(assets) {
  const groups = new Map()
  for (const asset of assets) {
    const key = asset.href.replace(/\.(pdf|html|pptx)$/, '')
    if (!groups.has(key)) groups.set(key, { ...asset, formats: [] })
    groups.get(key).formats.push(asset)
  }
  return [...groups.values()]
}
function downloadFile(content, filename, type = 'text/html;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}
function MediaDialog({ title, onClose, children }) {
  const ref = useRef(null)
  useEffect(() => {
    const previous = document.activeElement
    const dialog = ref.current
    dialog.showModal()
    return () => {
      dialog.close()
      previous?.focus()
    }
  }, [])
  return (
    <dialog
      ref={ref}
      className="ml-dialog"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose()
      }}
      aria-label={title}
    >
      <header>
        <div>
          <span className="ml-eyebrow">FESTIO / MEDIA STUDIO</span>
          <h2>{title}</h2>
        </div>
        <button
          className="ml-icon"
          onClick={onClose}
          aria-label="Close media preview"
        >
          ×
        </button>
      </header>
      {children}
    </dialog>
  )
}
function MediaStudio({ template, onClose }) {
  const [brief, setBrief] = useState({ ...DEFAULT_BRIEF })
  const [status, setStatus] = useState('')
  const html = useMemo(
    () => buildMediaDocument(template.id, brief),
    [template.id, brief],
  )
  const invalidUrl = brief.url && !mediaLink(brief.url)
  function update(key, value) {
    setBrief((prev) => ({ ...prev, [key]: value }))
    setStatus('')
  }
  function download() {
    downloadFile(
      html,
      `${(brief.client || 'festio').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${template.id}.html`,
    )
    setStatus(
      'Your reusable HTML file has been downloaded. Open it in a browser to present, print or save as PDF.',
    )
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(mediaPlainText(brief))
      setStatus(
        'Text copied. You can paste it into your own document or message.',
      )
    } catch {
      setStatus(
        'Clipboard access was blocked. Download the file to keep your version.',
      )
    }
  }
  return (
    <MediaDialog
      title={`Customize ${template.kind.toLowerCase()}`}
      onClose={onClose}
    >
      <div className="ml-studio">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            download()
          }}
          className="ml-studio-fields"
        >
          <p>
            A separate version for your audience. The original template stays
            unchanged.
          </p>
          <label>
            Client or organization
            <input
              value={brief.client}
              maxLength={100}
              placeholder="e.g. Mumineen Academy"
              onChange={(e) => update('client', e.target.value)}
            />
          </label>
          <label>
            Headline
            <input
              value={brief.title}
              required
              maxLength={160}
              onChange={(e) => update('title', e.target.value)}
            />
          </label>
          {[
            ['subtitle', 'Introduction'],
            ['goal', 'Purpose & opportunity'],
            ['audience', 'Who it is for'],
            ['experience', 'Guest experience'],
            ['operations', 'Team & preparation'],
            ['next', 'Next step'],
          ].map(([key, label]) => (
            <label key={key}>
              {label}
              <textarea
                rows={2}
                maxLength={700}
                value={brief[key]}
                onChange={(e) => update(key, e.target.value)}
              />
            </label>
          ))}
          <label>
            Contact
            <input
              value={brief.contact}
              maxLength={150}
              onChange={(e) => update('contact', e.target.value)}
            />
          </label>
          <label>
            Website link
            <input
              type="url"
              value={brief.url}
              maxLength={500}
              aria-invalid={!!invalidUrl}
              onChange={(e) => update('url', e.target.value)}
            />
            {invalidUrl && (
              <small>Use a full HTTPS address, or leave it blank.</small>
            )}
          </label>
          <label>
            Color palette
            <select
              value={brief.palette}
              onChange={(e) => update('palette', e.target.value)}
            >
              <option value="midnight">Midnight, lavender & mint</option>
              <option value="emerald">Emerald & gold</option>
              <option value="terracotta">Terracotta & cream</option>
            </select>
          </label>
          <div className="ml-actions">
            <button
              className="ml-button primary"
              type="submit"
              disabled={!!invalidUrl}
            >
              Download your version
            </button>
            <button className="ml-button" type="button" onClick={copy}>
              Copy text
            </button>
          </div>
          <p className="ml-small">
            Edits stay in this window until you close it. Download to keep your
            version. No public link is created.
          </p>
          <p role="status" className="ml-feedback">
            {status}
          </p>
        </form>
        <div className="ml-studio-preview">
          <div className="ml-preview-label">
            <span>LIVE PREVIEW</span>
            <span>{template.pages}</span>
          </div>
          <iframe title="Customized media preview" srcDoc={html} sandbox="" />
        </div>
      </div>
    </MediaDialog>
  )
}
function FileCard({ asset, onPreview, onCopy, archived = false }) {
  const stem = asset.filename.replace(/\.(pdf|html|pptx)$/, '')
  const formats = asset.formats || [asset]
  const previewAsset =
    formats.find((item) => item.type === 'HTML') ||
    formats.find((item) => item.type === 'PDF') ||
    asset
  return (
    <article className="ml-file">
      <button
        className="ml-file-cover"
        onClick={() => onPreview(previewAsset)}
        aria-label={`Preview ${asset.title}`}
      >
        {MEDIA_COVERS.has(stem) ? (
          <img
            src={`/media/library-covers/${stem}.jpg`}
            alt=""
            loading="lazy"
          />
        ) : (
          <span>{asset.title}</span>
        )}
        <span className="ml-cover-format">
          {formats.map((item) => item.type).join(' / ')}
        </span>
      </button>
      <div className="ml-file-body">
        <div className="ml-file-meta">
          <span>{formats.map((item) => item.type).join(' · ')}</span>
          <span>
            {archived
              ? 'Review before sharing'
              : asset.collection === 'internal'
                ? 'Team use'
                : 'Client-specific'}
          </span>
        </div>
        <h3>
          {asset.title.replace(/ — (Editable HTML|HTML|PowerPoint|PDF)$/, '')}
        </h3>
        <p>
          {asset.description
            .split(/Rebranded|Refreshed|Re-audited|Created 2026/)[0]
            .trim()}
        </p>
        <div className="ml-actions">
          <button className="ml-button" onClick={() => onPreview(previewAsset)}>
            Preview
          </button>
          {formats.map((item) => (
            <a
              key={item.href}
              className="ml-text-link"
              href={item.href}
              download={item.filename}
            >
              {item.type} ↓
            </a>
          ))}
          <button className="ml-text-link" onClick={() => onCopy(asset)}>
            Copy link
          </button>
        </div>
      </div>
    </article>
  )
}
export default function MediaLibrary() {
  const { user } = useAuth()
  const [collection, setCollection] = useState('templates')
  const [query, setQuery] = useState('')
  const [format, setFormat] = useState('all')
  const [preview, setPreview] = useState(null)
  const [template, setTemplate] = useState(null)
  const [status, setStatus] = useState('')
  const [previewFailed, setPreviewFailed] = useState(false)
  const [discard, setDiscard] = useState(false)
  const searchRef = useRef(null)
  const active = COLLECTIONS.find(([id]) => id === collection)
  const matches = (asset) =>
    `${asset.title} ${asset.description || ''} ${asset.type || ''}`
      .toLowerCase()
      .includes(query.toLowerCase()) &&
    (format === 'all' || asset.type === format)
  const files = groupFiles(
    MEDIA_ASSETS.filter(
      (asset) => asset.collection === collection && matches(asset),
    ),
  )
  const screenshots = SCREENSHOTS.filter(matches)
  const templates = MEDIA_TEMPLATES.filter((item) =>
    `${item.title} ${item.kind} ${item.description}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  )
  if (!user?.is_platform_superadmin)
    return <Navigate to="/admin-redesign" replace />
  function choose(id) {
    setCollection(id)
    setQuery('')
    setFormat('all')
    setStatus('')
  }
  function openPreview(asset) {
    setPreviewFailed(false)
    setPreview(asset)
  }
  async function copy(asset) {
    try {
      await navigator.clipboard.writeText(
        new URL(asset.href, window.location.origin).href,
      )
      setStatus(
        `Link copied: ${asset.title}. Anyone with this static file link may be able to open it.`,
      )
    } catch {
      setStatus(
        'Could not copy the link. Open the preview and copy its address instead.',
      )
    }
  }
  function openDocument(asset) {
    downloadFile(asset.content, asset.filename, 'text/plain;charset=utf-8')
  }
  return (
    <main className="ml-library">
      <header className="ml-hero">
        <div>
          <p className="ml-eyebrow">FESTIO / THE MEDIA COLLECTION</p>
          <h1>
            Good stories.
            <br />
            <em>Ready for their next chapter.</em>
          </h1>
          <p className="ml-lede">
            Create a fresh presentation, find a product image, or bring the
            right story to your next conversation.
          </p>
        </div>
        <div className="ml-hero-note">
          <span className="ml-badge">Platform team</span>
          <p>
            A considered collection.
            <br />
            Less searching. More creating.
          </p>
        </div>
      </header>
      <nav className="ml-collections" aria-label="Media collections">
        {COLLECTIONS.map(([id, label]) => (
          <button
            key={id}
            onClick={() => choose(id)}
            aria-current={collection === id ? 'page' : undefined}
          >
            {label}
            {id === 'archive' && <span>↗</span>}
          </button>
        ))}
      </nav>
      <section className="ml-collection-head">
        <div>
          <p className="ml-eyebrow">
            {collection === 'templates'
              ? 'START WITH A TEMPLATE'
              : 'EXPLORE THE COLLECTION'}
          </p>
          <h2>{active[1]}</h2>
          <p>{active[2]}</p>
        </div>
        <div className="ml-tools" hidden={collection === "uploads"}>
          <label className="ml-search">
            <span className="sr-only">Search media</span>
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find something useful…"
            />
          </label>
          {['presentations', 'archive'].includes(collection) && (
            <label>
              <span className="sr-only">File format</span>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value)}
              >
                <option value="all">All formats</option>
                <option>HTML</option>
                <option>PDF</option>
                <option>PPTX</option>
              </select>
            </label>
          )}
        </div>
      </section>
      {status && (
        <p className="ml-notice" role="status">
          {status}
        </p>
      )}
      {collection === 'uploads' && <SharedMediaCollection />}
      {collection === 'templates' && (
        <>
          <div className="ml-template-grid">
            {templates.map((item, index) => (
              <article className="ml-template" key={item.id}>
                <button
                  className={`ml-template-art ${item.tone}`}
                  onClick={() => setTemplate(item)}
                  aria-label={`Customize ${item.kind.toLowerCase()}`}
                >
                  <span>F / FESTIO</span>
                  <i>
                    {item.title}
                    <br />
                    <em>begins here.</em>
                  </i>
                  <div>
                    <span>
                      0{index + 1} / {item.kind}
                    </span>
                    <b>↗</b>
                  </div>
                  <div className="ml-orbit" />
                </button>
                <div className="ml-template-body">
                  <div className="ml-file-meta">
                    <span>{item.kind}</span>
                    <span>{item.pages}</span>
                  </div>
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                  <button
                    className="ml-button primary"
                    onClick={() => setTemplate(item)}
                  >
                    Make it yours ↗
                  </button>
                </div>
              </article>
            ))}
          </div>
          {!templates.length && <Empty onClear={() => setQuery('')} />}
          <aside className="ml-reuse-note">
            <span>01 / Choose a format</span>
            <span>02 / Add your client & story</span>
            <span>03 / Download & use again</span>
            <p>
              Your download is a standalone HTML file. Present it in a browser,
              or use your browser’s Print command to save a PDF. These templates
              contain no client pricing or promised outcomes.
            </p>
          </aside>
        </>
      )}
      {['presentations', 'archive'].includes(collection) && (
        <>
          {collection === 'archive' && (
            <div className="ml-notice">
              These files include earlier commercial drafts, historical product
              claims or client-specific terms. They are retained for reference
              and have not been approved for current external use.
            </div>
          )}
          {collection === 'presentations' && (
            <p className="ml-small">
              These files were made for named clients. For another audience,
              start with Create & reuse. Review client details and commercial
              terms before sharing.
            </p>
          )}
          <div className="ml-file-grid">
            {files.map((asset) => (
              <FileCard
                key={asset.href}
                asset={asset}
                archived={collection === 'archive'}
                onPreview={openPreview}
                onCopy={copy}
              />
            ))}
          </div>
          {!files.length && (
            <Empty
              onClear={() => {
                setQuery('')
                setFormat('all')
              }}
            />
          )}
        </>
      )}
      {collection === 'screenshots' && (
        <>
          <p className="ml-small">
            Guide reference images; interfaces may have changed. Preview at full
            size and check accuracy before using them externally.
          </p>
          <div className="ml-image-grid">
            {screenshots.map((asset) => (
              <article className="ml-image" key={asset.href}>
                <button
                  onClick={() => openPreview(asset)}
                  aria-label={`Preview ${asset.title}`}
                >
                  <img
                    src={asset.href}
                    alt={asset.title}
                    loading="lazy"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none'
                    }}
                  />
                  <span>View full image ↗</span>
                </button>
                <div>
                  <h3>{asset.title}</h3>
                  <div className="ml-actions">
                    <a
                      className="ml-text-link"
                      href={asset.href}
                      download={asset.filename}
                    >
                      Download PNG ↓
                    </a>
                    <button
                      className="ml-text-link"
                      onClick={() => copy(asset)}
                    >
                      Copy image link
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
          {!screenshots.length && <Empty onClear={() => setQuery('')} />}
        </>
      )}
      {collection === 'internal' && (
        <>
          <div className="ml-guide-row">
            <a href="/help-redesign" target="_blank" rel="noreferrer">
              <span>THE PRODUCT GUIDE</span>
              <h3>Find your way around Festio.</h3>
              <p>Open the live help guide ↗</p>
            </a>
            <a href="/knowledge-transfer/" target="_blank" rel="noreferrer">
              <span>TEAM KNOWLEDGE</span>
              <h3>The thinking behind the platform.</h3>
              <p>Open knowledge transfer · Password required ↗</p>
            </a>
          </div>
          <div className="ml-internal-grid">
            {INTERNAL_DOCS.filter(matches).map((asset) => (
              <article key={asset.filename} className="ml-resource">
                <span className="ml-eyebrow">
                  {asset.type} / INTERNAL REFERENCE
                </span>
                <h3>{asset.title}</h3>
                <p>{asset.description}</p>
                <button
                  className="ml-button"
                  onClick={() => openDocument(asset)}
                >
                  Download source ↓
                </button>
              </article>
            ))}
          </div>
          <div className="ml-file-grid">
            {files.map((asset) => (
              <FileCard
                key={asset.href}
                asset={asset}
                onPreview={openPreview}
                onCopy={copy}
              />
            ))}
          </div>
          <p className="ml-small">
            Pricing discussions belong with the review document and event tasks.
            Opening this library does not create tasks or discussion threads.
          </p>
        </>
      )}
      {template && (
        <>
          <MediaStudio template={template} onClose={() => setDiscard(true)} />
          {discard && (
            <MediaDialog
              title="Close this version?"
              onClose={() => setDiscard(false)}
            >
              <div className="ml-confirm">
                <p>
                  Download your version before closing if you want to keep it.
                  Edits are not saved to the library.
                </p>
                <div className="ml-actions">
                  <button
                    className="ml-button primary"
                    onClick={() => setDiscard(false)}
                  >
                    Keep editing
                  </button>
                  <button
                    className="ml-button"
                    onClick={() => {
                      setDiscard(false)
                      setTemplate(null)
                    }}
                  >
                    Close version
                  </button>
                </div>
              </div>
            </MediaDialog>
          )}
        </>
      )}
      {preview && (
        <MediaDialog title={preview.title} onClose={() => setPreview(null)}>
          <div className="ml-preview-actions">
            <a
              className="ml-button primary"
              href={preview.href}
              target="_blank"
              rel="noreferrer"
            >
              Open original ↗
            </a>
            <a
              className="ml-button"
              href={preview.href}
              download={preview.filename}
            >
              Download {preview.type}
            </a>
            <button className="ml-button" onClick={() => copy(preview)}>
              Copy link
            </button>
          </div>
          <p className="ml-small ml-preview-caption">
            {preview.type === 'PNG'
              ? 'Reference image. Check that the screen is current before sharing.'
              : 'Source material. Review all client details and terms before sharing.'}
          </p>
          {previewFailed ? (
            <p className="ml-notice">
              This preview could not load. Try opening the original file above.
            </p>
          ) : preview.type === 'PNG' ? (
            <img
              className="ml-full-image"
              src={preview.href}
              alt={preview.title}
              onError={() => setPreviewFailed(true)}
            />
          ) : preview.type === 'PPTX' ? (
            <div className="ml-confirm">
              Download this presentation to open it in PowerPoint or another
              compatible presentation app.
            </div>
          ) : (
            <iframe
              className="ml-original-frame"
              title={`Preview: ${preview.title}`}
              src={preview.href}
              sandbox="allow-scripts"
              onError={() => setPreviewFailed(true)}
            />
          )}
        </MediaDialog>
      )}
    </main>
  )
}
function Empty({ onClear }) {
  return (
    <div className="ml-empty">
      <h3>Nothing here matches yet.</h3>
      <p>Try another name or clear the filters to explore this collection.</p>
      <button className="ml-button" onClick={onClear}>
        Clear filters
      </button>
    </div>
  )
}
