import { APP_THEMES, appearanceTokens } from './appearance.mjs';
import './AppearanceChoices.css';
export default function AppearanceChoices({ value, onChange, guest = false, eventDefault = 'event', colors = {} }) {
  const choices = guest ? [{id:'default',name:'Event default',description:'Follow the organizer’s appearance.'}, ...APP_THEMES.filter(t => t.id !== 'event')] : APP_THEMES;
  return <div className="app-theme-options" role="group" aria-label={guest ? 'GuestHub appearance' : 'Event App default appearance'}>{choices.map(t => {
    const palette = appearanceTokens(t.id === 'default' ? eventDefault : t.id, colors);
    return <button type="button" key={t.id} className="app-theme-choice" aria-pressed={value === t.id} onClick={() => onChange(t.id)}>
      <span className="app-theme-sample" aria-hidden="true" style={{background:palette['--bg'],borderColor:palette['--line']}}><i style={{background:palette['--deep']}}/><span><b style={{background:palette['--green']}}/><em style={{background:palette['--white'],borderColor:palette['--line']}}/><em style={{background:palette['--mint'],borderColor:palette['--line']}}/></span></span>
      <strong>{t.name}{value === t.id && <span aria-hidden="true"> ✓</span>}</strong><small>{t.description}</small>
    </button>;
  })}</div>;
}
