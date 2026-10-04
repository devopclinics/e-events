import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EMOJI_CATEGORIES, EMOJIS } from '../lib/chatPresentation.mjs';
import './ChatEmojiPicker.css';

function position(anchor) {
  const rect = anchor?.getBoundingClientRect();
  const width = Math.min(344, window.innerWidth - 24);
  const maxHeight = Math.min(380, window.innerHeight - 24);
  const left = Math.min(Math.max(12, rect?.left || 12), window.innerWidth - width - 12);
  return rect && rect.top >= maxHeight + 12
    ? { left, width, maxHeight, bottom: window.innerHeight - rect.top + 8 }
    : { left, width, maxHeight, top: Math.max(12, Math.min((rect?.bottom || 12) + 8, window.innerHeight - maxHeight - 12)) };
}

export default function ChatEmojiPicker({ anchor, title = 'Choose an emoji', onSelect, onClose }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('popular');
  const [style, setStyle] = useState(() => position(anchor));
  const ref = useRef(null);
  const searchRef = useRef(null);
  const results = query.trim()
    ? EMOJIS.filter(({ name, emoji }) => name.includes(query.trim().toLowerCase()) || emoji.includes(query.trim()))
    : EMOJI_CATEGORIES.find((item) => item.id === category).emojis;

  useEffect(() => { searchRef.current?.focus(); }, []);
  useEffect(() => {
    const update = () => setStyle(position(anchor));
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); };
  }, [anchor]);
  useEffect(() => {
    const outside = (event) => {
      if (!ref.current?.contains(event.target) && !anchor?.contains(event.target)) onClose();
    };
    const escape = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); anchor?.focus(); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [anchor, onClose]);

  return createPortal(
    <div className="fm-emoji-picker" role="dialog" aria-label={title} ref={ref} style={style}>
      <header><strong>{title}</strong><button type="button" aria-label="Close emoji picker" onClick={() => { onClose(); anchor?.focus(); }}>×</button></header>
      <input ref={searchRef} aria-label="Search emojis" placeholder="Search emojis…" value={query} onChange={(event) => setQuery(event.target.value)} />
      <nav aria-label="Emoji categories">{EMOJI_CATEGORIES.map((item) => <button type="button" key={item.id} title={item.label} aria-label={item.label} aria-pressed={!query && category === item.id} onClick={() => { setCategory(item.id); setQuery(''); }}>{item.icon}</button>)}</nav>
      <div className="fm-emoji-results" key={query ? 'search' : category}>
        <span className="fm-emoji-category-label">{query ? `${results.length} results` : EMOJI_CATEGORIES.find((item) => item.id === category).label}</span>
        <div className="fm-emoji-grid">{results.map(({ emoji, name }) => <button key={emoji} type="button" title={name} aria-label={name} onClick={() => onSelect(emoji)}>{emoji}</button>)}</div>
        {!results.length && <p>No matching emojis. Try “heart”, “prayer”, or “happy”.</p>}
      </div>
    </div>, document.body,
  );
}
