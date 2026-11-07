import { useEffect, useState } from 'react'
export default function PassLabels({ token }) {
  const [labels, setLabels] = useState([])
  useEffect(() => {
    const controller = new AbortController()
    setLabels([])
    if (token) fetch(`/api/scan/${encodeURIComponent(token)}/labels`, { signal: controller.signal, cache: 'no-store' })
      .then(response => response.ok ? response.json() : { labels: [] })
      .then(value => { if (!controller.signal.aborted) setLabels(value.labels || []) }).catch(() => {})
    return () => controller.abort()
  }, [token])
  if (!labels.length) return null
  return <div aria-label="Pass role and access" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8, margin: '14px 0' }}>{labels.map(label => <span key={label} style={{ display: 'inline-block', maxWidth: '100%', overflowWrap: 'anywhere', padding: '8px 12px', borderRadius: 9, background: '#edf3e9', border: '1px solid #c9d9c8', color: '#173e32', fontSize: 13, lineHeight: 1.4, fontWeight: 800 }}>{label}</span>)}</div>
}
