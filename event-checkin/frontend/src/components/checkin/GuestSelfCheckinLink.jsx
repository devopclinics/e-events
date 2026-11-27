export default function GuestSelfCheckinLink({ event, token, preview = false }) {
  if (preview || !event?.self_checkin_enabled || !event?.event_code || !token) return null
  return <a href={`/e/${encodeURIComponent(event.event_code)}#token=${encodeURIComponent(token)}`} className="primary full" style={{ display: 'block', margin: '12px 0', padding: '14px 18px', borderRadius: 12, background: 'var(--event-primary, #0f766e)', color: '#fff', textAlign: 'center', textDecoration: 'none', fontWeight: 700 }}>
    Check in at the venue
  </a>
}
