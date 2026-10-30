import { useRef, useState } from 'react';

function CopyLink({ url, label }) {
  const [status, setStatus] = useState('');
  return <div className="mt-share-link">
    <label>{label}<input readOnly value={url} onFocus={e => e.target.select()} /></label>
    <button type="button" onClick={async () => {
      try {
        await navigator.clipboard.writeText(url);
        setStatus('Link copied.');
      } catch {
        setStatus('Copy was unavailable. Select the link above and copy it manually.');
      }
    }}>Copy link</button>
    {status && <p role="status">{status}</p>}
  </div>;
}

export default function MeetingSharePanel({ meeting, client }) {
  const [recipient, setRecipient] = useState('');
  const [link, setLink] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const request = useRef(0);
  const attendees = meeting.attendees.filter(a => a.active);
  const cancelled = meeting.status === 'cancelled';
  return <section className="mt-card mt-share" aria-label="Share meeting">
    <div className="mt-step">↗ <span>Share meeting</span></div>
    <h2>Your meeting links</h2>
    {cancelled ? <p>This meeting is cancelled. Its response links are closed.</p> : <>
      {meeting.draft.video_url ? <>
        <CopyLink key={meeting.draft.video_url} url={meeting.draft.video_url} label="Saved meeting join link" />
        <p className="mt-muted">Share this link to join the online meeting. It does not record an attendee’s RSVP. Save any link changes before sharing.</p>
      </> : <p className="mt-muted">This meeting has no online join link. Add one in Meeting details and save to share it here.</p>}
      {meeting.status === 'scheduled' && attendees.length > 0 ? <div className="mt-share-responses">
        <h3>Share a personal invitation</h3>
        <p className="mt-muted">Choose an attendee for their private Accept, Maybe or Decline link. Share it only with that person.</p>
        <label>Attendee<select value={recipient} onChange={e => { ++request.current; setRecipient(e.target.value); setLink(null); setError(''); setLoading(false); }}>
          <option value="">Choose an attendee</option>
          {attendees.map(a => <option key={a.id} value={a.id}>{a.name}{a.email || a.phone ? ` · ${a.email || a.phone}` : ''}</option>)}
        </select></label>
        <button type="button" disabled={!recipient || loading} onClick={async () => {
          const generation = ++request.current;
          setLoading(true); setLink(null); setError('');
          try {
            const result = await client.meetingAttendeeLink(meeting.id, recipient);
            if (generation === request.current) setLink({ url: result.url, name: attendees.find(a => a.id === recipient)?.name });
          } catch (e) { if (generation === request.current) setError(e.message || 'Could not load this invitation. Try again.'); }
          finally { if (generation === request.current) setLoading(false); }
        }}>{loading ? 'Getting link…' : 'Get invitation link'}</button>
        {error && <p role="alert" className="mt-error">{error}</p>}
        {link && <CopyLink key={link.url} url={link.url} label={`Personal response link for ${link.name}`} />}
      </div> : meeting.status !== 'scheduled' && <p className="mt-notice">Personal RSVP links become available after invitations are published. Use Preview invitation, then send now or schedule a send. Saving a draft does not send invitations; a scheduled send publishes them when it runs.</p>}
    </>}
  </section>;
}
