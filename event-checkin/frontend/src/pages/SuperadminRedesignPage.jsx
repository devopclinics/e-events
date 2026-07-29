import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import RedesignShell, { Icon, Modal, ConfirmDialog } from './redesign/RedesignShell'
import { INTERNAL_DOCS, PDFS, HTML_ASSETS, SCREENSHOTS } from './MediaPage'
import ConsolePage from './ConsolePage'
import './SuperadminRedesignPage.css'

const CONSOLE_TABS = [
  'Overview', 'Accounts', 'Usage', 'Trial requests', 'QA checklist', 'Support chat',
  'Referrals', 'Pricing', 'Org Plans', 'Affiliate stores', 'Operators',
]

const OVERVIEW = { orgs: 214, mrr: '$18,420', activeEvents: 62, trials: 9 }

const OVERVIEW_ORGS = [
  { org: 'DevOps Clinics', plan: 'Growth', events: 4, credits: 1240 },
  { org: 'Rashid Family Events', plan: 'Starter', events: 1, credits: 300 },
]

const ACCOUNTS = [
  { org: 'DevOps Clinics', plan: 'Growth', events: 4, mrr: '$149', status: 'active' },
  { org: 'Rashid Family Events', plan: 'Starter', events: 1, mrr: '$49', status: 'active' },
  { org: 'Masjid Al-Noor', plan: 'Community', events: 2, mrr: '$0', status: 'active' },
  { org: 'Iftar Collective', plan: 'Growth', events: 3, mrr: '$149', status: 'suspended' },
]

const USAGE = [
  { org: 'DevOps Clinics', email: 812, sms: 340, whatsapp: 190, mms: 22, credits: 936, cost: '$28.10' },
  { org: 'Rashid Family Events', email: 120, sms: 40, whatsapp: 0, mms: 0, credits: 80, cost: '$2.40' },
  { org: 'Iftar Collective', email: 640, sms: 210, whatsapp: 88, mms: 6, credits: 610, cost: '$18.30' },
]

const TRIAL_REQUESTS = [
  { org: 'New Beginnings Ministry', requestedAt: 'Jul 26', note: 'Needs Growth tier for a 400-guest gala', status: 'pending' },
  { org: 'Riverside Youth Org', requestedAt: 'Jul 20', note: 'Approved: Starter + 500 credits', status: 'approved' },
]

const QA_SUBMISSIONS = [
  { version: '2.2.98', submittedBy: 'Karim Haddad', passed: 42, failed: 1, when: 'Jul 27' },
  { version: '2.2.95', submittedBy: 'Amina Yusuf', passed: 40, failed: 0, when: 'Jul 24' },
]

const REFERRALS = [
  { referrer: 'DevOps Clinics', referred: 'Iftar Collective', status: 'converted', reward: '$25 credit' },
  { referrer: 'DevOps Clinics', referred: 'New Beginnings Ministry', status: 'pending', reward: '—' },
]

const PRICING_TIERS = [
  { name: 'Starter', usd: 49, ngn: 78000, cap: 150, credits: 300, active: true },
  { name: 'Growth', usd: 149, ngn: 238000, cap: 800, credits: 1500, active: true },
  { name: 'Pro', usd: 349, ngn: 558000, cap: 3000, credits: 6000, active: true },
]

const ORG_PLANS = [
  { name: 'API Basic', usd: 19, features: 'Read-write keys, 5k req/mo', active: true },
  { name: 'API Pro', usd: 59, features: 'Unlimited requests, delivery logs', active: true },
]

const AFFILIATE_STORES = [
  { domain: 'amazon.com', label: 'Amazon registry links', param: 'tag=festio-20', active: true },
  { domain: 'crateandbarrel.com', label: 'Crate & Barrel registry', param: 'ref=festio', active: false },
]

const OPERATORS = [
  { name: 'Amina Yusuf', email: 'amina@festio.events', addedAt: 'Jan 2026' },
  { name: 'Karim Haddad', email: 'karim@festio.events', addedAt: 'Mar 2026' },
]

// Real content — same source MediaPage.jsx (the real /media-library route) uses.
const DOCS = INTERNAL_DOCS

const COMMENTS = [
  { from: 'Amina Yusuf', text: 'Can we add the new SignalHouse gotcha here?', time: '2 days ago' },
  { from: 'Karim Haddad', text: 'Updated the runbook link, please re-check.', time: '1 day ago' },
]

const EVENTS_FOR_COMMENTS = ["Women's Convention 2026", "Ahmed & Layla's Wedding"]

export default function SuperadminRedesignPage() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'media' ? 'media' : 'console'
  const [consoleTab, setConsoleTab] = useState('Overview')
  const [selectedDoc, setSelectedDoc] = useState(DOCS[0])
  const [docSourceOpen, setDocSourceOpen] = useState(false)
  const [commentEvent, setCommentEvent] = useState(EVENTS_FOR_COMMENTS[0])
  const [mediaSection, setMediaSection] = useState('docs')
  const [toast, setToast] = useState('')
  const [confirmAction, setConfirmAction] = useState(null)
  const [editTier, setEditTier] = useState(null)
  const [editPlan, setEditPlan] = useState(null)

  function notify(msg) {
    setToast(msg)
    window.setTimeout(() => setToast(''), 2600)
  }

  // ConsolePage is the production superadmin implementation and already owns
  // the real API contracts for every console section. Embed that single source
  // of truth in the redesign shell; retaining a second mock console here would
  // allow privileged controls and displayed platform state to diverge.
  if (tab === 'console') {
    return (
      <RedesignShell topActive="console" withEventSidebar={false}>
        <div className="rr-pagehead">
          <div>
            <div className="rr-title-row"><h1>Superadmin</h1><span className="rr-pill locked">Platform staff only</span></div>
            <div className="rr-meta">Live platform console</div>
          </div>
        </div>
        <div className="rr-tabs">
          <button className="active" onClick={() => setParams({ tab: 'console' })}>Console</button>
          <button onClick={() => setParams({ tab: 'media' })}>Media Library</button>
        </div>
        <ConsolePage />
      </RedesignShell>
    )
  }

  // The media prototype below is intentionally not exposed during Stage C:
  // it still uses static research data and has no privileged mutation contract.
  // Showing its controls would let a superadmin believe platform state changed.
  if (tab === 'media') {
    return (
      <RedesignShell topActive="media" withEventSidebar={false}>
        <div className="rr-pagehead"><div><div className="rr-title-row"><h1>Media Library</h1></div><div className="rr-meta">Not available in the redesign rollout</div></div></div>
        <div className="rr-panel rd-panel-body">
          <p>The media-library prototype is view-only and is not connected to platform APIs. Use the live Console for supported superadmin operations.</p>
          <button className="rr-btn primary" onClick={() => setParams({ tab: 'console' })}>Open live Console</button>
        </div>
      </RedesignShell>
    )
  }

  return (
    <RedesignShell topActive={tab === 'media' ? 'media' : 'console'} withEventSidebar={false}>
      <div className="rr-pagehead">
        <div>
          <div className="rr-title-row"><h1>Superadmin</h1><span className="rr-pill locked">Platform staff only</span></div>
          <div className="rr-meta">Console and internal knowledge base</div>
        </div>
      </div>

      <div className="rr-tabs">
        <button className={tab === 'console' ? 'active' : ''} onClick={() => setParams({ tab: 'console' })}>Console</button>
        <button className={tab === 'media' ? 'active' : ''} onClick={() => setParams({ tab: 'media' })}>Media Library</button>
      </div>

      {tab === 'console' && (
        <>
          <div className="sa-console-tabs">
            {CONSOLE_TABS.map((t) => <button key={t} className={consoleTab === t ? 'on' : ''} onClick={() => setConsoleTab(t)}>{t}</button>)}
          </div>

          {consoleTab === 'Overview' && (
            <>
              <div className="rr-grid4">
                <div className="rr-panel sa-stat"><span>Organizations</span><strong>{OVERVIEW.orgs}</strong></div>
                <div className="rr-panel sa-stat teal"><span>MRR</span><strong>{OVERVIEW.mrr}</strong></div>
                <div className="rr-panel sa-stat"><span>Active events</span><strong>{OVERVIEW.activeEvents}</strong></div>
                <div className="rr-panel sa-stat amber"><span>Trial requests</span><strong>{OVERVIEW.trials}</strong></div>
              </div>
              <div className="rr-section-title"><div><h2>Grant &amp; comp</h2><p>Comp a plan tier or add message credits for an org's event</p></div></div>
              <div className="rd-panel">
                <div className="rd-panel-body">
                  <table className="rr-table">
                    <thead><tr><th>Org</th><th>Plan</th><th>Events</th><th>Credits</th><th /></tr></thead>
                    <tbody>
                      {OVERVIEW_ORGS.map((o) => (
                        <tr key={o.org}>
                          <td>{o.org}</td><td>{o.plan}</td><td>{o.events}</td><td>{o.credits}</td>
                          <td className="gr-actions">
                            <button className="rr-link-btn" onClick={() => notify(`Comped a plan tier for ${o.org}`)}>Comp plan</button>
                            <button className="rr-link-btn" onClick={() => notify(`Added 500 credits to ${o.org}`)}>Add credits</button>
                            <button className="rr-link-btn gr-danger-link" onClick={() => notify(`Messaging channels hard-blocked for ${o.org}`)}>Block channels</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <button className="rr-btn secondary" style={{ marginTop: 12 }} onClick={() => notify('Readiness report generated and ready to send')}>Generate readiness report</button>
            </>
          )}

          {consoleTab === 'Accounts' && (
            <div className="rd-panel">
              <div className="rd-panel-body">
                <table className="rr-table">
                  <thead><tr><th>Organization</th><th>Plan</th><th>Events</th><th>MRR</th><th>Status</th><th /></tr></thead>
                  <tbody>
                    {ACCOUNTS.map((a) => (
                      <tr key={a.org}>
                        <td>{a.org}</td><td>{a.plan}</td><td>{a.events}</td><td>{a.mrr}</td>
                        <td><span className={`rd-status-chip ${a.status === 'active' ? 'ok' : 'fail'}`}>{a.status === 'active' ? 'Active' : 'Suspended'}</span></td>
                        <td className="gr-actions">
                          <button className="rr-link-btn" onClick={() => notify(`Managing members for ${a.org}`)}>Members</button>
                          <button className="rr-link-btn gr-danger-link" onClick={() => setConfirmAction({ title: `${a.status === 'active' ? 'Suspend' : 'Reactivate'} account`, message: `${a.status === 'active' ? `Suspend ${a.org}? They will lose access until reactivated.` : `Reactivate ${a.org}? They will regain full access.`}`, label: a.status === 'active' ? 'Suspend' : 'Reactivate', result: `${a.org} ${a.status === 'active' ? 'suspended' : 'reactivated'}` })}>{a.status === 'active' ? 'Suspend' : 'Reactivate'}</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {consoleTab === 'Usage' && (
            <div className="rd-panel">
              <div className="rd-panel-body">
                <table className="rr-table">
                  <thead><tr><th>Organization</th><th>Email</th><th>SMS</th><th>WhatsApp</th><th>MMS</th><th>Credits spent</th><th>Provider cost</th></tr></thead>
                  <tbody>
                    {USAGE.map((u) => (
                      <tr key={u.org}>
                        <td>{u.org}</td><td>{u.email}</td><td>{u.sms}</td><td>{u.whatsapp}</td><td>{u.mms}</td><td>{u.credits}</td><td>{u.cost}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {consoleTab === 'Trial requests' && (
            <div className="rd-panel">
              <div className="rd-panel-body">
                {TRIAL_REQUESTS.map((t) => (
                  <div className="sa-trial-row" key={t.org}>
                    <div><strong>{t.org}</strong><span className="rd-rowlink"> · requested {t.requestedAt}</span><p>{t.note}</p></div>
                    {t.status === 'pending' ? (
                      <div className="gr-actions">
                        <button className="rr-link-btn" onClick={() => notify(`Approved trial for ${t.org} with a plan/credit grant`)}>Approve</button>
                        <button className="rr-link-btn gr-danger-link" onClick={() => notify(`Declined trial for ${t.org}`)}>Decline</button>
                      </div>
                    ) : <span className="rd-status-chip ok">Approved</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {consoleTab === 'QA checklist' && (
            <div className="rd-panel">
              <div className="rd-panel-body">
                <table className="rr-table">
                  <thead><tr><th>Version</th><th>Submitted by</th><th>Passed</th><th>Failed</th><th>When</th><th /></tr></thead>
                  <tbody>
                    {QA_SUBMISSIONS.map((q) => (
                      <tr key={q.version}>
                        <td>{q.version}</td><td>{q.submittedBy}</td>
                        <td><span className="rd-status-chip ok">{q.passed}</span></td>
                        <td>{q.failed > 0 ? <span className="rd-status-chip fail">{q.failed}</span> : '—'}</td>
                        <td className="rd-rowlink">{q.when}</td>
                        <td className="rd-rowlink"><button className="rr-link-btn" onClick={() => notify(`Opened QA detail for ${q.version} by section/case`)}>View detail</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {consoleTab === 'Support chat' && (
            <div className="rd-panel" style={{ maxWidth: 420 }}>
              <div className="rd-panel-head"><h3>Support widget</h3><p>Toggle the Chatwoot support widget platform-wide</p></div>
              <div className="rd-panel-body">
                <div className="rd-toggle-row">
                  <span style={{ fontSize: 12, fontWeight: 600 }}>Support chat widget visible to all users</span>
                  <label className="rd-switch"><input type="checkbox" defaultChecked onChange={(e) => notify(`Support widget ${e.target.checked ? 'enabled' : 'disabled'} platform-wide`)} /><span className="track" /><span className="knob" /></label>
                </div>
              </div>
            </div>
          )}

          {consoleTab === 'Referrals' && (
            <div className="rd-panel">
              <div className="rd-panel-body">
                <table className="rr-table">
                  <thead><tr><th>Referrer</th><th>Referred org</th><th>Status</th><th>Reward</th></tr></thead>
                  <tbody>
                    {REFERRALS.map((r, i) => (
                      <tr key={i}>
                        <td>{r.referrer}</td><td>{r.referred}</td>
                        <td><span className={`rd-status-chip ${r.status === 'converted' ? 'ok' : 'warn'}`}>{r.status === 'converted' ? 'Converted' : 'Pending'}</span></td>
                        <td>{r.reward}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {consoleTab === 'Pricing' && (
            <div className="rd-panel">
              <div className="rd-panel-body">
                <table className="rr-table">
                  <thead><tr><th>Tier</th><th>USD</th><th>NGN</th><th>Guest cap</th><th>Credits</th><th>Active</th><th /></tr></thead>
                  <tbody>
                    {PRICING_TIERS.map((t) => (
                      <tr key={t.name}>
                        <td>{t.name}</td><td>${t.usd}</td><td>₦{t.ngn.toLocaleString()}</td><td>{t.cap.toLocaleString()}</td><td>{t.credits.toLocaleString()}</td>
                        <td><span className={`rd-status-chip ${t.active ? 'ok' : 'bl-chip-neutral'}`}>{t.active ? 'Active' : 'Hidden'}</span></td>
                        <td className="rd-rowlink"><button className="rr-link-btn" onClick={() => setEditTier(t)}>Edit</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="rr-section-title" style={{ margin: '16px 0 8px' }}><div><h2 style={{ fontSize: 12 }}>Messaging credit rates</h2></div></div>
                <p className="rd-rowlink">Global rate: 1 credit = $0.03. Per-org overrides can be set from Accounts.</p>
              </div>
            </div>
          )}

          {consoleTab === 'Org Plans' && (
            <div className="rd-panel">
              <div className="rd-panel-head"><h3>Org-level subscription catalog</h3></div>
              <div className="rd-panel-body">
                <table className="rr-table">
                  <thead><tr><th>Plan</th><th>USD/mo</th><th>Features</th><th>Active</th><th /></tr></thead>
                  <tbody>
                    {ORG_PLANS.map((p) => (
                      <tr key={p.name}>
                        <td>{p.name}</td><td>${p.usd}</td><td className="rd-rowlink">{p.features}</td>
                        <td><span className={`rd-status-chip ${p.active ? 'ok' : 'bl-chip-neutral'}`}>{p.active ? 'Active' : 'Hidden'}</span></td>
                        <td className="rd-rowlink"><button className="rr-link-btn" onClick={() => setEditPlan(p)}>Edit</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button className="rr-btn secondary" style={{ marginTop: 10 }} onClick={() => notify('New org plan form opened')}><Icon name="plus" size={13} /> Add plan</button>
              </div>
            </div>
          )}

          {consoleTab === 'Affiliate stores' && (
            <div className="rd-panel">
              <div className="rd-panel-body">
                <table className="rr-table">
                  <thead><tr><th>Domain</th><th>Label</th><th>Param</th><th>Active</th><th /></tr></thead>
                  <tbody>
                    {AFFILIATE_STORES.map((s) => (
                      <tr key={s.domain}>
                        <td>{s.domain}</td><td>{s.label}</td><td className="rd-rowlink">{s.param}</td>
                        <td><span className={`rd-status-chip ${s.active ? 'ok' : 'bl-chip-neutral'}`}>{s.active ? 'Active' : 'Hidden'}</span></td>
                        <td className="gr-actions">
                          <button className="rr-link-btn" onClick={() => notify(`Editing ${s.domain}`)}>Edit</button>
                          <button className="rr-link-btn gr-danger-link" onClick={() => notify(`${s.domain} deleted`)}>Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button className="rr-btn secondary" style={{ marginTop: 10 }} onClick={() => notify('New affiliate store form opened')}><Icon name="plus" size={13} /> Add store</button>
              </div>
            </div>
          )}

          {consoleTab === 'Operators' && (
            <div className="rd-panel">
              <div className="rd-panel-head"><h3>Platform operators</h3><p>Superadmin accounts with Console access</p></div>
              <div className="rd-panel-body">
                <table className="rr-table">
                  <thead><tr><th>Name</th><th>Email</th><th>Added</th><th /></tr></thead>
                  <tbody>
                    {OPERATORS.map((o) => (
                      <tr key={o.email}>
                        <td>{o.name}</td><td className="rd-rowlink">{o.email}</td><td className="rd-rowlink">{o.addedAt}</td>
                        <td className="rd-rowlink"><button className="rr-link-btn gr-danger-link" onClick={() => setConfirmAction({ title: 'Revoke operator', message: `Revoke operator access for ${o.name}? This cannot be undone.`, label: 'Revoke', result: `${o.name} revoked as operator` })}>Revoke</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="rd-row2" style={{ marginTop: 10 }}>
                  <input className="rd-field" placeholder="Email to add as operator" style={{ marginBottom: 0 }} />
                  <button className="rr-btn primary" onClick={() => notify('Operator added')}>Add operator</button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'media' && (
        <>
          <div className="rd-seg" style={{ marginBottom: 14 }}>
            <button className={mediaSection === 'docs' ? 'on' : ''} onClick={() => setMediaSection('docs')}>Internal docs</button>
            <button className={mediaSection === 'pdf' ? 'on' : ''} onClick={() => setMediaSection('pdf')}>PDF downloads</button>
            <button className={mediaSection === 'html' ? 'on' : ''} onClick={() => setMediaSection('html')}>HTML media</button>
            <button className={mediaSection === 'shots' ? 'on' : ''} onClick={() => setMediaSection('shots')}>Product screenshots</button>
          </div>

          {mediaSection === 'docs' && (
            <div className="rr-grid2">
              <div className="rd-panel">
                <div className="rd-panel-head"><h3>Internal docs</h3><p>Customer help source, support KB, runbooks</p></div>
                <div className="rd-panel-body sa-doclist">
                  {DOCS.map((d) => (
                    <button key={d.title} className={`sa-doc-row ${selectedDoc.title === d.title ? 'active' : ''}`} onClick={() => setSelectedDoc(d)}>
                      <Icon name="file" size={14} />
                      <span><strong>{d.title}</strong><small>{d.filename} · {d.type}</small></span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="rd-panel">
                <div className="rd-panel-head"><h3>{selectedDoc.title}</h3><p>{selectedDoc.filename} · {selectedDoc.type}</p></div>
                <div className="rd-panel-body">
                  <div className="sa-doc-body">{selectedDoc.description}</div>
                  <div className="rd-row2" style={{ marginBottom: 10 }}>
                    <button className="rr-btn secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setDocSourceOpen((v) => !v)}>{docSourceOpen ? 'Hide source' : 'View source'}</button>
                  </div>
                  {docSourceOpen && <pre className="sa-doc-source">{selectedDoc.content}</pre>}
                  <label className="rd-field-label">Comment thread for event</label>
                  <select className="rr-select gr-inline-select" value={commentEvent} onChange={(e) => setCommentEvent(e.target.value)}>
                    {EVENTS_FOR_COMMENTS.map((e) => <option key={e}>{e}</option>)}
                  </select>
                  <div className="sa-comments-head" style={{ marginTop: 10 }}>Comments</div>
                  {COMMENTS.map((c, i) => (
                    <div className="sa-comment" key={i}>
                      <strong>{c.from}</strong><span>{c.time}</span>
                      <p>{c.text}</p>
                    </div>
                  ))}
                  <div className="rd-row2" style={{ marginTop: 10 }}>
                    <input className="rr-input" style={{ marginBottom: 0 }} placeholder="Add a comment…" />
                    <button className="rr-btn primary" onClick={() => notify('Comment added')}>Post</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {mediaSection === 'pdf' && (
            <div className="rd-panel"><div className="rd-panel-body sa-doclist">
              {PDFS.map((f) => (
                <div className="sa-file-row" key={f.filename}><Icon name="file" size={14} /><span>{f.title}</span>
                  <div className="gr-actions">
                    <a className="rr-link-btn" href={f.href} target="_blank" rel="noreferrer">Open</a>
                    <a className="rr-link-btn" href={f.href} download={f.filename}>Download</a>
                  </div>
                </div>
              ))}
            </div></div>
          )}

          {mediaSection === 'html' && (
            <div className="rd-panel"><div className="rd-panel-body sa-doclist">
              {HTML_ASSETS.map((f) => (
                <div className="sa-file-row" key={f.filename}><Icon name="file" size={14} /><span>{f.title}</span>
                  <div className="gr-actions">
                    <a className="rr-link-btn" href={f.href} target="_blank" rel="noreferrer">Open</a>
                    <a className="rr-link-btn" href={f.href} download={f.filename}>Download</a>
                  </div>
                </div>
              ))}
            </div></div>
          )}

          {mediaSection === 'shots' && (
            <div className="sa-shots-grid">
              {SCREENSHOTS.map((s) => (
                <a className="rr-panel sa-shot-card" key={s.filename} href={s.href} target="_blank" rel="noreferrer">
                  <div className="sa-shot-thumb"><img src={s.href} alt={s.title} loading="lazy" /></div>
                  <span>{s.title}</span>
                </a>
              ))}
            </div>
          )}
        </>
      )}

      {toast && <div className="rd-toast"><Icon name="check" />{toast}</div>}
      {confirmAction && (
        <ConfirmDialog
          title={confirmAction.title}
          message={confirmAction.message}
          confirmLabel={confirmAction.label}
          onConfirm={() => { notify(confirmAction.result); setConfirmAction(null) }}
          onCancel={() => setConfirmAction(null)}
        />
      )}
      {editTier && (
        <Modal title={`Edit pricing tier: ${editTier.name}`} onClose={() => setEditTier(null)} width={420}>
          <div style={{ marginBottom: 10 }}>
            <label className="rd-field-label">Tier name</label>
            <input className="rd-field" defaultValue={editTier.name} />
            <label className="rd-field-label">USD price</label>
            <input className="rd-field" type="number" defaultValue={editTier.usd || 0} />
            <label className="rd-field-label">NGN price</label>
            <input className="rd-field" type="number" defaultValue={editTier.ngn || 0} />
            <label className="rd-field-label">Guest cap</label>
            <input className="rd-field" type="number" defaultValue={editTier.cap || 0} />
            <label className="rd-field-label">Credits included</label>
            <input className="rd-field" type="number" defaultValue={editTier.credits || 0} />
          </div>
          <div className="rd-row2">
            <button className="rr-btn secondary" onClick={() => setEditTier(null)}>Cancel</button>
            <button className="rr-btn primary" onClick={() => { notify(`${editTier.name} pricing saved`); setEditTier(null) }}>Save</button>
          </div>
        </Modal>
      )}
      {editPlan && (
        <Modal title={`Edit org plan: ${editPlan.name}`} onClose={() => setEditPlan(null)} width={420}>
          <div style={{ marginBottom: 10 }}>
            <label className="rd-field-label">Plan name</label>
            <input className="rd-field" defaultValue={editPlan.name} />
            <label className="rd-field-label">USD price</label>
            <input className="rd-field" type="number" defaultValue={editPlan.usd || 0} />
            <label className="rd-field-label">Features</label>
            <input className="rd-field" defaultValue={editPlan.features || ''} />
          </div>
          <div className="rd-row2">
            <button className="rr-btn secondary" onClick={() => setEditPlan(null)}>Cancel</button>
            <button className="rr-btn primary" onClick={() => { notify(`${editPlan.name} plan saved`); setEditPlan(null) }}>Save</button>
          </div>
        </Modal>
      )}
    </RedesignShell>
  )
}
