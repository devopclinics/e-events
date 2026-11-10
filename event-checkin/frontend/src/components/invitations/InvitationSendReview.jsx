import { Icon } from '../../pages/redesign/RedesignShell'
const CHANNELS = { email: ['Email', 'mail'], whatsapp: ['WhatsApp', 'whatsapp'], sms: ['SMS', 'message'], mms: ['MMS', 'image'] }
const number = value => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })

export default function InvitationSendReview({ count, preview, error }) {
  return <div className="gr-invite-review">
    <div className="gr-invite-review-audience"><span className="gr-invite-review-icon"><Icon name="users" size={22} /></span><div><strong>{number(count)}</strong><span>{count === 1 ? 'guest selected' : 'guests selected'}</span></div><span className="gr-invite-review-tag">INVITATIONS</span></div>
    {error ? <div role="alert" className="gr-invite-review-error">{error}</div> : !preview ? <p role="status">Checking recipients and credits…</p> : <>
      <div className="gr-invite-review-table-wrap"><table className="gr-invite-review-table"><thead><tr><th>Channel</th><th>Ready</th><th>Recipient checks</th></tr></thead><tbody>
        {Object.entries(CHANNELS).filter(([key]) => key in preview.channels || key in (preview.breakdown || {})).map(([key, [label, icon]]) => {
          const eligible = Number(preview.channels[key] || 0)
          const checks = Object.entries(preview.breakdown?.[key] || {})
          return <tr key={key}><th scope="row"><span className={`gr-invite-review-channel gr-invite-review-channel-${key}`}><span><Icon name={icon} size={17} /></span>{label}</span></th><td><strong className={eligible ? 'gr-invite-review-count' : 'gr-invite-review-zero'}>{number(eligible)}</strong></td><td>{checks.length ? checks.map(([reason, total]) => <div className="gr-invite-review-check" key={reason}><span className={`gr-invite-review-pill${reason.toLowerCase() === 'eligible' ? ' ready' : ' muted'}`}>{reason.toLowerCase() === 'eligible' ? 'Eligible' : reason}</span>{checks.length > 1 && <small>{number(total)}</small>}</div>) : <span className={`gr-invite-review-pill${eligible ? ' ready' : ' muted'}`}>{eligible ? 'Eligible' : 'Not eligible'}</span>}</td></tr>
        })}
      </tbody></table></div>
      <p className="gr-invite-review-caption">A guest may receive an invitation on more than one eligible channel.</p>
      <div className={`gr-invite-review-reach${preview.unreachable || preview.blocked ? ' warning' : ''}`}><Icon name={preview.unreachable || preview.blocked ? 'warning' : 'check'} size={16} /><span>{preview.unreachable || preview.blocked ? `${number(preview.unreachable)} unreachable · ${number(preview.blocked)} blocked` : 'All selected guests have an eligible contact channel.'}</span></div>
      <div className="gr-invite-review-wallet"><div><span>Estimated credits</span><strong>{number(preview.estimated_credits)}</strong><small>For this send</small></div><div><span>{preview.balance_scope === 'organization' ? 'Organization balance' : 'Available balance'}</span><strong>{number(preview.balance)}</strong><small>Credits available</small></div></div>
      <details className="gr-invite-review-details"><summary>How sending is checked</summary><p>{preview.note}</p><p>Event channel settings, consent, recipient safety, provider readiness and credits are checked again when sending.</p><p>MMS uses the generated pass card where supported. SMS and MMS follow the current SMS consent setting; a phone number alone does not establish permission.</p></details>
    </>}
    <div className="gr-invite-review-resend"><Icon name="warning" size={16} /><p><strong>Sending again?</strong><span>Review Delivery &amp; results first. Resending may create duplicate invitations.</span></p></div>
  </div>
}
