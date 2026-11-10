const LABELS = { email: 'Email', sms: 'SMS', whatsapp: 'WhatsApp', mms: 'MMS' }
export default function DeliveryReportBreakdown({ comm, compact = false }) {
  const overall = comm?.overall
  if (!overall) return null
  const excluded = Object.values(comm.excluded_tests || {}).reduce((a, b) => a + b, 0)
  return <div className="er-delivery-report">
    {!compact && <>
      <div className="er-delivery-summary"><div><span>Confirmed delivery rate</span><strong>{overall.rate == null ? '—' : `${overall.rate}%`}</strong><small>{overall.delivered} delivered / {overall.sent} tracked messages</small></div><dl>{[['Pending', overall.pending], ['Failed', overall.failed], ['Unknown', overall.unknown]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></div>
      <div className="er-delivery-table-wrap"><table className="rr-table"><thead><tr><th>Channel</th><th>Tracked</th><th>Delivered</th><th>Pending</th><th>Failed</th><th>Unknown</th><th>Rate</th></tr></thead><tbody>{Object.entries(LABELS).filter(([key]) => comm[key]?.sent > 0).map(([key,label]) => <tr key={key}><th>{label}</th><td>{comm[key].sent}</td><td>{comm[key].delivered}</td><td>{comm[key].pending}</td><td>{comm[key].failed}</td><td>{comm[key].unknown}</td><td>{comm[key].rate == null ? '—' : `${comm[key].rate}%`}</td></tr>)}</tbody></table></div>
    </>}
    {!!comm.by_type?.length && <><h4>Delivery by message type</h4><div className="er-delivery-table-wrap"><table className="rr-table"><thead><tr><th>Message type</th><th>Tracked</th><th>Delivered</th><th>Pending</th><th>Failed</th><th>Unknown</th><th>Rate</th></tr></thead><tbody>{comm.by_type.map(group => <tr key={group.key}><th>{group.label}<small>{Object.entries(group.channels).filter(([,item])=>item.sent>0).map(([key,item])=>`${LABELS[key]}: ${item.sent}`).join(' · ')}</small></th><td>{group.overall.sent}</td><td>{group.overall.delivered}</td><td>{group.overall.pending}</td><td>{group.overall.failed}</td><td>{group.overall.unknown}</td><td>{group.overall.rate == null ? '—' : `${group.overall.rate}%`}</td></tr>)}</tbody></table></div></>}
    <p className="er-delivery-report-note">Sent, accepted and queued messages remain pending until delivery is confirmed. Rates use message counts, not an average of channel percentages. {excluded} identified test/preview messages excluded. Historical messages without a recognisable type appear under Other messages.</p>
  </div>
}
