import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'

const SWAGGER_JS_URL = 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js'
const SWAGGER_CSS_URL = 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css'

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve()
    const el = document.createElement('script')
    el.src = src
    el.onload = () => resolve()
    el.onerror = () => reject(new Error(`Failed to load ${src}`))
    document.body.appendChild(el)
  })
}

function loadStylesheetOnce(href) {
  if (document.querySelector(`link[href="${href}"]`)) return
  const el = document.createElement('link')
  el.rel = 'stylesheet'
  el.href = href
  document.head.appendChild(el)
}

export default function ApiExplorerPage() {
  const [status, setStatus] = useState('loading')   // loading | needs-subscription | error | ready
  const [err, setErr] = useState('')

  useEffect(() => {
    let cancelled = false
    async function run() {
      let schema
      try {
        schema = await api.getPublicApiSchema()
      } catch (e) {
        if (cancelled) return
        if (e.status === 402) { setStatus('needs-subscription'); return }
        setErr(e.message); setStatus('error'); return
      }
      try {
        loadStylesheetOnce(SWAGGER_CSS_URL)
        await loadScriptOnce(SWAGGER_JS_URL)
        if (cancelled) return
        // Spec is passed directly (not `url`) — no further unauthenticated
        // fetch happens; only this static UI bundle comes from the CDN.
        window.SwaggerUIBundle({
          spec: schema,
          dom_id: '#swagger-ui-root',
          presets: [window.SwaggerUIBundle.presets.apis],
          layout: 'BaseLayout',
        })
        setStatus('ready')
      } catch (e) {
        if (!cancelled) { setErr(e.message); setStatus('error') }
      }
    }
    run()
    return () => { cancelled = true }
  }, [])

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">API Explorer</h1>
        <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
          Interactive, try-it-out documentation for your organization's Public API.
        </p>
      </div>

      {status === 'needs-subscription' && (
        <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6 space-y-3">
          <p className="text-sm text-gray-700 dark:text-slate-300">
            The interactive explorer requires an active API Access subscription.
          </p>
          <Link to="/org-settings" className="text-indigo-600 dark:text-indigo-400 underline text-sm">
            Subscribe in Organization Settings
          </Link>
        </div>
      )}

      {status === 'error' && (
        <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6">
          <p className="text-sm text-red-500">{err}</p>
        </div>
      )}

      {status === 'loading' && <p className="text-sm text-gray-400 dark:text-slate-500">Loading…</p>}

      {/* Always mounted (not conditionally rendered) so #swagger-ui-root
          exists in the DOM once the bundle script resolves and calls
          SwaggerUIBundle() — a dom_id selector, not a React ref. */}
      <div id="swagger-ui-root" className={status === 'ready' ? '' : 'hidden'} />
    </div>
  )
}
