import { useEffect, useState } from 'react';

export function externalWebsiteUrl(value) {
  if (typeof value !== 'string') return '';
  const address = value.trim();
  if (!/^https?:\/\//i.test(address) || /[\u0000-\u0020\u007f\\]/.test(address)) return '';
  try {
    const url = new URL(address);
    return url.hostname && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

export function useEventWebsite(eventId, previewMock = false, externalUrl = '') {
  const external = externalWebsiteUrl(externalUrl);
  const [site, setSite] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    setSite(null);
    if (!eventId || previewMock || external) return;
    fetch(`/site/event/${encodeURIComponent(eventId)}`, { signal: controller.signal, cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .then(data => {
        if (!controller.signal.aborted && /^\/site\/[A-Za-z0-9_-]+$/.test(data?.url || ''))
          setSite({ eventId, url: data.url });
      }).catch(() => {});
    return () => controller.abort();
  }, [eventId, previewMock, external]);
  return previewMock ? '' : external || (site?.eventId === eventId ? site.url : '');
}

export default function EventWebsiteLink({ eventId, externalWebsiteUrl, previewMock, className = '' }) {
  const url = useEventWebsite(eventId, previewMock, externalWebsiteUrl);
  return url ? <a className={className} href={url} target="_blank" rel="noopener noreferrer">Event website ↗</a> : null;
}
