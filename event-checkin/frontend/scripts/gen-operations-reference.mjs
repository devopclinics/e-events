// Public, role-safe operating reference. No operator topics or event/pass data.
import { writeFileSync } from 'node:fs'
import { CONTENT } from '../src/guideContent.mjs'

const ids = ['org-checkin', 'staff-offline', 'staff-attendance', 'org-junior', 'org-programme', 'org-qna', 'org-live', 'org-community', 'org-broadcast', 'guest-programme', 'guest-community']
const topics = ['organizer', 'staff', 'guest'].flatMap(role => CONTENT[role].topics)
const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const sections = ids.map(id => {
  const t = topics.find(topic => topic.id === id)
  if (!t) throw new Error(`Missing operating topic ${id}`)
  return `<section id="${id}"><h2>${esc(t.title)}</h2>${t.intro ? `<p>${esc(t.intro)}</p>` : ''}<ol>${t.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>${t.tip ? `<p class="note">${esc(t.tip)}</p>` : ''}${t.warn ? `<p class="warning"><strong>Important:</strong> ${esc(t.warn)}</p>` : ''}</section>`
}).join('\n')
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Festio current operating reference — October 2026</title><style>
*{box-sizing:border-box}body{font:16px/1.6 system-ui,sans-serif;margin:0;background:#f1f6f4;color:#133c34}main{max-width:980px;margin:auto;padding:32px 22px}header,section{background:#fff;padding:24px;margin:18px 0;border:1px solid #d8e6e0;border-radius:14px}h1,h2{line-height:1.25}li{margin:12px 0}a{color:#00695c}.note,.warning{padding:15px;border-left:4px solid #bd9023;background:#fff8e4}img{max-width:100%;height:auto}nav{display:flex;flex-wrap:wrap;gap:12px}@media print{body{background:white;font-size:11pt}main{max-width:none;padding:0}section{break-before:page;border:0;padding:0}header{border:0}nav{display:none}h2{break-after:avoid}li{break-inside:avoid}@page{size:A4;margin:16mm}
</style></head><body><main><header><p>REVIEWED AGAINST IMPLEMENTED WORKFLOWS · OCTOBER 6, 2026</p><h1>Festio current operating reference</h1><p>Use this reference alongside Help and Academy. Screenshots and older decks are illustrations; current written procedures govern the workflow. Availability depends on event configuration, permissions and entitlements.</p><nav><a href="/guide.html">Full product guide</a><a href="/help-redesign">Help Centre</a><a href="/training">Academy</a></nav><p><strong>Rehearsal boundary:</strong> software checks do not replace a physical camera, venue-network and approved-message-delivery rehearsal. RFID is not a delivered capability in this update.</p><img src="/media/festio-operating-flow-2026-10.svg" alt="Online preparation, eligible offline admission, reconnect and review; protected handoffs remain online"></header>${sections}</main></body></html>`
writeFileSync(new URL('../public/media/festio-current-operations.html', import.meta.url), html)
console.log(`Generated current operating reference: ${ids.length} procedures`)
