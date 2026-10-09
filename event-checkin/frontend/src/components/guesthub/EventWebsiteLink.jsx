import { useEffect, useState } from 'react';

export function useEventWebsite(eventId, previewMock = false) {
  const [site, setSite] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    setSite(null);
    if (!eventId || previewMock) return;
    fetch(`/site/event/${encodeURIComponent(eventId)}`, { signal: controller.signal, cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .then(data => {
        if (!controller.signal.aborted && /^\/site\/[A-Za-z0-9_-]+$/.test(data?.url || ''))
          setSite({ eventId, url: data.url });
      }).catch(() => {});
    return () => controller.abort();
  }, [eventId, previewMock]);
  return site?.eventId === eventId ? site.url : '';
}

export default function EventWebsiteLink({ eventId, previewMock, className = '' }) {
  const url = useEventWebsite(eventId, previewMock);
  return url ? <a className={className} href={url} target="_blank" rel="noopener noreferrer">Event website ↗</a> : null;
}
