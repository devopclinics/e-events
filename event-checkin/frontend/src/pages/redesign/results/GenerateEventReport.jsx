import { useState } from 'react'
import { api } from '../../../api'
import { buildEventReport } from './eventReport.mjs'
import reportCss from './eventReport.css?raw'

export default function GenerateEventReport({ eventId, event }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function generate() {
    const preview = window.open('', '_blank')
    if (!preview) { setError('Allow pop-ups for Festio, then generate the report again.'); return }
    preview.opener = null
    preview.document.title = 'Preparing event report…'
    preview.document.body.textContent = 'Preparing your event report…'
    setBusy(true); setError('')
    try {
      const results = await Promise.allSettled([
        api.resultsCommandCenter(eventId), api.resultsProgram(eventId),
        api.resultsOperations(eventId), api.certificateReport(eventId),
      ])
      if (results[0].status !== 'fulfilled') throw new Error('Event totals could not be loaded. Please try again.')
      const optional = index => results[index].status === 'fulfilled' ? results[index].value : null
      const unavailable = results.flatMap((r,i)=>r.status==='rejected' ? [['Event totals','Programme','Operations','Certificates'][i]] : [])
      const html = buildEventReport({ event, command: results[0].value, programme: optional(1), operations: optional(2), certificates: optional(3), unavailable }, reportCss)
      if (preview.closed) return
      preview.document.open(); preview.document.write(html); preview.document.close()
      const toolbar = preview.document.createElement('nav')
      toolbar.setAttribute('aria-label','Report actions')
      toolbar.style.cssText = 'position:sticky;top:0;z-index:10;display:flex;flex-wrap:wrap;gap:12px;align-items:center;padding:14px 20px;background:#43134f;color:white;font:14px Arial'
      const print = preview.document.createElement('button'); print.textContent = 'Print / Save as PDF'; print.onclick = () => preview.print()
      const download = preview.document.createElement('button'); download.textContent = 'Download editable report'
      download.onclick = () => {
        const url = URL.createObjectURL(new Blob([html], {type:'text/html;charset=utf-8'}))
        const link = preview.document.createElement('a'); link.href = url; link.download = `event-report-${eventId}.html`; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000)
      }
      const label = preview.document.createElement('span'); label.textContent = 'PAMCON report design · Entire event · Fresh snapshot'
      toolbar.append(print,download,label); preview.document.body.prepend(toolbar)
      const style = preview.document.createElement('style'); style.textContent = 'nav button{border:1px solid #f3d2a2;border-radius:8px;background:#fff7ed;color:#43134f;padding:10px 16px;cursor:pointer;font-weight:bold}@media print{nav{display:none!important}}'; preview.document.head.append(style)
    } catch (err) {
      if (!preview.closed) preview.close()
      setError(err.message || 'Report generation failed. Please try again.')
    } finally { setBusy(false) }
  }
  return <div className="er-generate-report">
    <button className="rr-btn" disabled={busy || !event?.id} onClick={generate}>{busy ? 'Generating report…' : 'Generate event report'}</button>
    <span>PAMCON design · Preview, print or save as PDF · Entire event</span>
    {error && <p role="alert">{error}</p>}
  </div>
}
