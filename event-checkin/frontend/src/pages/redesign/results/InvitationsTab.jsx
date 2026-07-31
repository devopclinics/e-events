import { useEffect, useState } from 'react'
import { LoadingSkeleton } from '../RedesignPrimitives'
import { api } from '../../../api'

// Standalone build-out of the real Invitations tab (ResultsPage.jsx:1034-1053),
// fed by two endpoints fetched in parallel — GET /api/results/events/{id}/
// analytics/invitations (api.resultsInvitations, returns { rsvp_funnel,
// delivery, communication }) and GET /api/results/events/{id}/analytics/
// broadcasts (api.resultsBroadcasts, returns a BroadcastLog[] list) — exactly
// as the real page's refetchTab('invitations', ...) does. rsvp_funnel and
// communication share the same shape as the command-center payload already
// wired into this redesign's Overview tab, so those two panels mirror that
// tab's "RSVP funnel" / "Communication health" panels field-for-field.

const BROADCAST_TARGET_LABELS = {
  all: 'All guests', admitted: 'Checked in', not_admitted: 'Not yet checked in',
  confirmed: 'RSVP: Attending', declined: 'RSVP: Declined', no_reply: 'RSVP: No reply', none: 'Specific recipients',
}
const CHANNEL_ICONS = { email: '✉️', sms: '📱', whatsapp: '🟢', mms: '🖼️' }

function StatTile({ label, value, hint }) {
  return (
    <div className="rr-panel er-stat" title={hint}>
      <span>{label}</span><strong>{value ?? '—'}</strong>
    </div>
  )
}

function RsvpFunnelPanel({ funnel }) {
  return (
    <div className="rd-panel">
      <div className="rd-panel-head"><h3>RSVP funnel</h3></div>
      <div className="rd-panel-body">
        <div className="er-provider-row"><span>Guests</span><b>{funnel.guests}</b></div>
        <div className="er-provider-row"><span>Invited</span><b>{funnel.invited}</b></div>
        <div className="er-provider-row"><span>Responded</span><b>{funnel.responded}</b></div>
        <div className="er-provider-row"><span>Confirmed</span><b>{funnel.confirmed}</b></div>
        <div className="er-provider-row"><span>Checked in</span><b>{funnel.checked_in}</b></div>
      </div>
    </div>
  )
}

function DeliveryPanel({ delivery }) {
  return (
    <div className="rd-panel">
      <div className="rd-panel-head"><h3>Invite delivery</h3></div>
      <div className="rd-panel-body">
        <div className="rr-grid3">
          <StatTile label="Sent" value={delivery.sent} />
          <StatTile label="Failed" value={delivery.failed} hint="Invites that failed to send." />
          <StatTile label="Not sent yet" value={delivery.unsent} />
        </div>
      </div>
    </div>
  )
}

function CommHealthPanel({ comm }) {
  return (
    <div className="rd-panel">
      <div className="rd-panel-head"><h3>Communication health</h3></div>
      <div className="rd-panel-body">
        {['email', 'sms', 'whatsapp'].map((ch) => {
          const c = comm[ch]
          const label = ch === 'email' ? 'Email' : ch === 'sms' ? 'SMS' : 'WhatsApp'
          const deliv = ch === 'email' ? c.reached : c.delivered
          return (
            <div key={ch} className="er-chan-row">
              <span>{label}</span>
              <div className="rd-mini-bar" style={{ flex: 1, margin: '0 10px' }}><i style={{ width: `${c.rate ?? 0}%` }} /></div>
              <b>{c.rate ?? 0}%</b> <span className="rd-rowlink">({deliv}/{c.sent})</span>
            </div>
          )
        })}
        {comm.email?.breakdown?.tracked > 0 && (
          <p className="rd-rowlink" style={{ marginTop: 6 }}>
            Email: {comm.email.breakdown.delivered} delivered · {comm.email.breakdown.opened + comm.email.breakdown.clicked} engaged · {comm.email.breakdown.bounced + comm.email.breakdown.failed} failed
          </p>
        )}
        {comm.sms?.sent > 0 && <p className="rd-rowlink">SMS: {comm.sms.delivered} delivered · {comm.sms.failed} failed</p>}
        {comm.whatsapp?.sent > 0 && <p className="rd-rowlink">WhatsApp: {comm.whatsapp.delivered} delivered · {comm.whatsapp.failed} failed</p>}
        <div className="er-provider-row" style={{ marginTop: 8 }}><span>Credits remaining</span><b>{comm.credits_remaining?.toLocaleString?.() ?? comm.credits_remaining}</b></div>
      </div>
    </div>
  )
}

function BroadcastHistoryPanel({ broadcasts }) {
  return (
    <div className="rd-panel" style={{ marginTop: 14 }}>
      <div className="rd-panel-head"><h3>Broadcast history</h3></div>
      <div className="rd-panel-body">
        {broadcasts.length === 0 ? (
          <p className="rd-rowlink">No broadcasts sent yet.</p>
        ) : (
          <table className="rr-table">
            <thead>
              <tr>
                <th>Sent</th>
                <th>Message</th>
                <th>Target</th>
                <th>Channels</th>
                <th>Queued</th>
                <th>Skipped</th>
              </tr>
            </thead>
            <tbody>
              {broadcasts.map((b) => (
                <tr key={b.id}>
                  <td>{new Date(b.created_at).toLocaleString()}</td>
                  <td title={b.message}>{b.message}</td>
                  <td>{BROADCAST_TARGET_LABELS[b.target] || b.target}</td>
                  <td>
                    {(b.channels || []).map((c) => (
                      <span key={c} style={{ marginRight: 8 }}>{CHANNEL_ICONS[c] || c} {b.channel_counts?.[c]?.queued ?? 0}</span>
                    ))}
                  </td>
                  <td>{b.queued}</td>
                  <td className="rd-rowlink">
                    No contact {b.skipped_no_contact} · No consent {b.skipped_no_consent}
                    {b.skipped_no_credits ? ` · Out of credits ${b.skipped_no_credits}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

export default function InvitationsTab({ eventId }) {
  const [invitations, setInvitations] = useState(null)
  const [broadcasts, setBroadcasts] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!eventId) { setInvitations(null); setBroadcasts(null); return }
    let cancelled = false
    setLoading(true)
    setError('')
    Promise.all([api.resultsInvitations(eventId), api.resultsBroadcasts(eventId)])
      .then(([inv, bc]) => {
        if (cancelled) return
        setInvitations(inv)
        setBroadcasts(bc)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err.message || 'Invitations data is temporarily unavailable.')
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [eventId])

  if (loading) return <LoadingSkeleton rows={4} variant="card" />

  if (error) {
    return (
      <div className="rd-panel">
        <div className="rd-panel-body"><p className="rd-rowlink">{error}</p></div>
      </div>
    )
  }

  if (!invitations) return null

  return (
    <div>
      <RsvpFunnelPanel funnel={invitations.rsvp_funnel} />

      <div className="rr-grid2" style={{ marginTop: 14 }}>
        <DeliveryPanel delivery={invitations.delivery} />
        <CommHealthPanel comm={invitations.communication} />
      </div>

      <BroadcastHistoryPanel broadcasts={broadcasts || []} />
    </div>
  )
}
