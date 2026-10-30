import { useEffect, useRef, useState } from 'react';

export default function MeetingInvitationDocument({ html }) {
  const [height, setHeight] = useState(900);
  const cleanup = useRef(() => {});
  useEffect(() => () => cleanup.current(), [html]);
  return <iframe title="Meeting invitation" className="mt-invitation-document" srcDoc={html}
    sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
    style={{ height }} onLoad={event => {
      cleanup.current();
      const doc = event.currentTarget.contentDocument;
      if (!doc?.body) return;
      const resize = () => setHeight(Math.ceil(doc.body.getBoundingClientRect().height) + 2);
      const observer = new ResizeObserver(resize);
      observer.observe(doc.body);
      const click = e => {
        const anchor = e.target.closest?.('a');
        if (anchor?.getAttribute('href') === '#meeting-reply') {
          e.preventDefault();
          const reply = document.getElementById('meeting-reply');
          reply?.focus({ preventScroll: true });
          reply?.scrollIntoView({ block: 'start', behavior: 'auto' });
        }
      };
      doc.addEventListener('click', click);
      resize();
      cleanup.current = () => { observer.disconnect(); doc.removeEventListener('click', click); };
    }} />;
}
