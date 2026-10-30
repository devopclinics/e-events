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
  const [sharedLink, setSharedLink] = useState('');
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState('');
  const [link, setLink] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const request = useRef(0);
  const attendees = meeting.attendees.filter(a => a.active);
  const cancelled = meeting.status === 'cancelled';
  return <section id="meeting-share" tabIndex={-1} className="mt-card mt-share" aria-label="Share meeting">
    <div className="mt-step">↗ <span>Share meeting</span></div>
    <h2>Your meeting links</h2>
    {cancelled ? <p>This meeting is cancelled. Its response links are closed.</p> : <>
      <div className="mt-share-option"><h3>Reusable invitation</h3>
        <p className="mt-muted">Anyone with this link can view your invitation design and join the meeting using the button inside. It does not record a personal RSVP.</p>
        <button type="button" disabled={sharing} onClick={async () => {
          setSharing(true); setShareError('');
          try { const result = await client.meetingSharedLink(meeting.id); setSharedLink(result.url); }
          catch (e) { setShareError(e.message || 'Could not create the invitation link. Try again.'); }
          finally { setSharing(false); }
        }}>{sharing ? 'Creating link…' : 'Create reusable invitation link'}</button>
        {shareError && <p role="alert" className="mt-error">{shareError}</p>}
        {sharedLink && <CopyLink key={sharedLink} url={sharedLink} label="Reusable invitation link" />}
        <p className="mt-muted">Uses the saved meeting details. After saving changes, create a new link. Older shared links stop working. Creating a link does not send emails.</p>
      </div>
      {meeting.status === 'scheduled' && attendees.length > 0 ? <div className="mt-share-responses">
        <h3>Share a personal invitation</h3>
        <p className="mt-muted">Choose an attendee to open the same invitation design, personalized with their name and RSVP controls. Share it only with that person.</p>
        <label>Attendee<select aria-label="Attendee" value={recipient} onChange={e => { ++request.current; setRecipient(e.target.value); setLink(null); setError(''); setLoading(false); }}>
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
