import { useEffect, useState } from 'react';
import { api } from '../../api';
import { SpeakerGrid } from '../SpeakerShowcase';

export default function GuestSpeakers({ token, enabled = true, previewMock = false }) {
  const [state, setState] = useState({ loading: true, speakers: [], error: '' });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    if (!enabled || !token || previewMock) return;
    setState({ loading: true, speakers: [], error: '' });
    api.getSpeakerPage(token).then(data => {
      if (!cancelled) setState({ loading: false, speakers: data.speakers || [], error: '' });
    }).catch(() => {
      if (!cancelled) setState({ loading: false, speakers: [], error: 'Speakers could not load. Please try again.' });
    });
    return () => { cancelled = true; };
  }, [token, enabled, previewMock, retry]);
  if (!enabled || !token) return <p>Speakers are not enabled for this event.</p>;
  if (previewMock) return <p>Published speaker profiles appear here in GuestHub.</p>;
  if (state.loading) return <p role="status">Loading speakers…</p>;
  if (state.error) return <p role="status">{state.error} <button type="button" onClick={() => setRetry(n => n + 1)}>Try again</button></p>;
  return state.speakers.length ? <SpeakerGrid speakers={state.speakers} /> : <p>Speakers will appear here once announced.</p>;
}
