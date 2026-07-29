import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import RedesignShell, { Icon } from './redesign/RedesignShell'
import './ApiExplorerRedesignPage.css'

const ENDPOINTS = [
  {
    id: 'list-guests',
    method: 'GET',
    path: '/api/v1/events/{event_id}/guests',
    summary: 'List guests',
    category: 'Guests',
    params: [
      { name: 'event_id', in: 'path', required: true, type: 'integer', desc: 'Event ID' },
      { name: 'page', in: 'query', required: false, type: 'integer', desc: 'Page number' },
      { name: 'search', in: 'query', required: false, type: 'string', desc: 'Filter by name or email' },
    ],
    sampleResponse: JSON.stringify({
      count: 612,
      next: '/api/v1/events/42/guests?page=2',
      results: [
        { id: 1, first_name: 'Aaliyah', last_name: 'Hassan', email: 'a@example.com', is_vip: false, checked_in: false },
        { id: 2, first_name: 'Bilal', last_name: 'Okafor', email: 'b@example.com', is_vip: true, checked_in: true },
      ]
    }, null, 2),
  },
  {
    id: 'create-guest',
    method: 'POST',
    path: '/api/v1/events/{event_id}/guests',
    summary: 'Create guest',
    category: 'Guests',
    params: [
      { name: 'event_id', in: 'path', required: true, type: 'integer', desc: 'Event ID' },
    ],
    sampleResponse: JSON.stringify({ id: 613, first_name: 'New', last_name: 'Guest', email: 'new@example.com', is_vip: false }, null, 2),
  },
  {
    id: 'list-events',
    method: 'GET',
    path: '/api/v1/events',
    summary: 'List events',
    category: 'Events',
    params: [],
    sampleResponse: JSON.stringify({ count: 3, results: [{ id: 42, name: "Women's Convention 2026", status: 'active' }] }, null, 2),
  },
  {
    id: 'checkin-guest',
    method: 'POST',
    path: '/api/v1/events/{event_id}/guests/{guest_id}/checkin',
    summary: 'Check in guest',
    category: 'Check-in',
    params: [
      { name: 'event_id', in: 'path', required: true, type: 'integer', desc: 'Event ID' },
      { name: 'guest_id', in: 'path', required: true, type: 'integer', desc: 'Guest ID' },
    ],
    sampleResponse: JSON.stringify({ status: 'admitted', guest_id: 1, checked_in_at: '2026-07-19T10:30:00Z' }, null, 2),
  },
  {
    id: 'send-invite',
    method: 'POST',
    path: '/api/v1/events/{event_id}/guests/{guest_id}/send-invite',
    summary: 'Send invite',
    category: 'Communication',
    params: [
      { name: 'event_id', in: 'path', required: true, type: 'integer', desc: 'Event ID' },
      { name: 'guest_id', in: 'path', required: true, type: 'integer', desc: 'Guest ID' },
      { name: 'channel', in: 'body', required: false, type: 'string', desc: 'email | sms | whatsapp' },
    ],
    sampleResponse: JSON.stringify({ queued: true, channel: 'whatsapp', message_id: 'msg_abc123' }, null, 2),
  },
  {
    id: 'list-seats',
    method: 'GET',
    path: '/api/v1/events/{event_id}/seats',
    summary: 'List seats',
    category: 'Seating',
    params: [
      { name: 'event_id', in: 'path', required: true, type: 'integer', desc: 'Event ID' },
    ],
    sampleResponse: JSON.stringify({ count: 80, results: [{ id: 1, table: 'T1', seat: 'S1', guest_id: 1 }] }, null, 2),
  },
]

const CATEGORIES = ['All', ...new Set(ENDPOINTS.map((e) => e.category))]

const METHOD_COLORS = {
  GET: 'blue',
  POST: 'green',
  PUT: 'amber',
  PATCH: 'amber',
  DELETE: 'red',
}

function EndpointPanel({ endpoint, apiKey }) {
  const [paramVals, setParamVals] = useState({})

  return (
    <div className="ae-endpoint-panel">
      <div className="ae-endpoint-meta">
        <span className={`ae-method ae-method-${METHOD_COLORS[endpoint.method]}`}>{endpoint.method}</span>
        <code className="ae-path">{endpoint.path}</code>
      </div>
      <p className="ae-summary-text">{endpoint.summary}</p>

      {endpoint.params.length > 0 && (
        <div className="ae-params-section">
          <strong className="ae-section-head">Parameters</strong>
          <table className="ae-params-table">
            <thead><tr><th>Name</th><th>In</th><th>Type</th><th>Required</th><th>Value</th><th>Description</th></tr></thead>
            <tbody>
              {endpoint.params.map((p) => (
                <tr key={p.name}>
                  <td><code>{p.name}</code></td>
                  <td><span className="ae-in-badge">{p.in}</span></td>
                  <td>{p.type}</td>
                  <td>{p.required ? <span className="ae-required-dot">●</span> : '—'}</td>
                  <td>
                    <input
                      className="ae-param-input"
                      placeholder={`${p.type}…`}
                      value={paramVals[p.name] || ''}
                      onChange={(e) => setParamVals((v) => ({ ...v, [p.name]: e.target.value }))}
                    />
                  </td>
                  <td className="ae-param-desc">{p.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="ae-auth-section">
        <Icon name="lock" size={13} />
        <code className="ae-apikey-display">
          Authorization: Bearer {apiKey || 'no active API key — create one in Organization Settings'}
        </code>
      </div>

      <button className="rr-btn primary ae-try-btn" disabled title="Raw API keys are shown only once when created and are never stored in the browser.">
        Execute with your external API client
      </button>
    </div>
  )
}

export default function ApiExplorerRedesignPage() {
  // loading | needs-subscription | error | ready — driven by a real call to
  // the public API schema endpoint, mirroring ApiExplorerPage.jsx: a 402
  // means no active subscription, any other failure is a genuine error.
  const [uiState, setUiState] = useState('loading')
  const [errMsg, setErrMsg] = useState('')
  const [reloadToken, setReloadToken] = useState(0)
  const [endpoints, setEndpoints] = useState([])
  const [selectedEndpoint, setSelectedEndpoint] = useState(null)
  const [catFilter, setCatFilter] = useState('All')
  const [apiKeys, setApiKeys] = useState([])

  useEffect(() => {
    let cancelled = false
    async function run() {
      setUiState('loading')
      setErrMsg('')
      try {
        const schema = await api.getPublicApiSchema()
        const parsed = Object.entries(schema.paths || {}).flatMap(([path, operations]) =>
          Object.entries(operations || {}).filter(([method]) => METHOD_COLORS[method.toUpperCase()]).map(([method, operation]) => ({
            id: `${method}-${path}`,
            method: method.toUpperCase(),
            path,
            summary: operation.summary || operation.operationId || path,
            category: operation.tags?.[0] || 'Other',
            params: (operation.parameters || []).map((param) => ({
              name: param.name, in: param.in, required: !!param.required,
              type: param.schema?.type || 'string', desc: param.description || '',
            })),
          }))
        )
        setEndpoints(parsed)
        setSelectedEndpoint(parsed[0] || null)
      } catch (e) {
        if (cancelled) return
        if (e.status === 402) { setUiState('needs-subscription'); return }
        setErrMsg(e.message); setUiState('error'); return
      }
      if (!cancelled) setUiState('ready')
    }
    run()
    return () => { cancelled = true }
  }, [reloadToken])

  useEffect(() => {
    if (uiState !== 'ready') return
    let cancelled = false
    api.listApiKeys()
      .then((ks) => { if (!cancelled) setApiKeys(ks || []) })
      .catch(() => { if (!cancelled) setApiKeys([]) })
    return () => { cancelled = true }
  }, [uiState])

  const activeKey = apiKeys.find((k) => !k.revoked_at)
  const apiKeyDisplay = activeKey ? `${activeKey.key_prefix}••••••••` : null

  const categories = ['All', ...new Set(endpoints.map((e) => e.category))]
  const filtered = catFilter === 'All'
    ? endpoints
    : endpoints.filter((e) => e.category === catFilter)

  return (
    <RedesignShell topActive="org">
      <div className="ae-page">
        <div className="ae-header">
          <div>
            <h2>API Explorer</h2>
            <p className="ae-subtitle">Festio REST API · v1</p>
          </div>
        </div>

        {uiState === 'loading' && <p className="ae-subtitle">Loading…</p>}

        {uiState === 'needs-subscription' && (
          <div className="ae-gate">
            <div className="ae-gate-icon"><Icon name="lock" size={40} /></div>
            <h3>API access requires a paid plan</h3>
            <p>Upgrade to Festio Business or higher to get your API key and start integrating.</p>
            <Link to="/org-settings" className="rr-btn primary">Upgrade now</Link>
          </div>
        )}

        {uiState === 'error' && (
          <div className="ae-gate ae-error">
            <div className="ae-gate-icon"><Icon name="info" size={40} /></div>
            <h3>Could not load API schema</h3>
            <p>{errMsg || 'There was a problem fetching the API specification. Check your connection and try again.'}</p>
            <button className="rr-btn secondary" onClick={() => setReloadToken((t) => t + 1)}>Retry</button>
          </div>
        )}

        {uiState === 'ready' && (
          <div className="ae-explorer">
            {/* Left: endpoint list */}
            <div className="ae-sidebar">
              <div className="ae-cat-filters">
                {categories.map((c) => (
                  <button key={c} className={`ae-cat-btn${catFilter === c ? ' active' : ''}`} onClick={() => setCatFilter(c)}>{c}</button>
                ))}
              </div>
              <div className="ae-endpoint-list">
                {filtered.map((ep) => (
                  <button
                    key={ep.id}
                    className={`ae-endpoint-row${selectedEndpoint?.id === ep.id ? ' active' : ''}`}
                    onClick={() => setSelectedEndpoint(ep)}
                  >
                    <span className={`ae-method ae-method-${METHOD_COLORS[ep.method]}`}>{ep.method}</span>
                    <div className="ae-endpoint-row-info">
                      <span className="ae-endpoint-summary">{ep.summary}</span>
                      <code className="ae-endpoint-path">{ep.path}</code>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Right: details panel */}
            <div className="ae-detail">
              {selectedEndpoint
                ? <EndpointPanel key={selectedEndpoint.id} endpoint={selectedEndpoint} apiKey={apiKeyDisplay} />
                : <div className="ae-detail-empty">Select an endpoint to explore</div>
              }
            </div>
          </div>
        )}
      </div>
    </RedesignShell>
  )
}
