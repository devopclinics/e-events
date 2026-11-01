import './PassSchedule.css';

export function passScheduleItems(schedule) {
  return (Array.isArray(schedule?.items) ? schedule.items : []).filter(item =>
    item && typeof item.label === 'string' && item.label.trim() && typeof item.time === 'string' && item.time.trim()
  ).slice(0, 6);
}

export default function PassSchedule({ schedule }) {
  const items = passScheduleItems(schedule);
  if (!items.length) return null;
  return <section className="festio-pass-schedule" aria-label="Event schedule">
    <div className="pass-schedule-card">
      <h3>{typeof schedule.heading === 'string' ? schedule.heading : 'Your event schedule'}</h3>
      {items.map((item, index) => <div className="pass-schedule-row" key={index}>
        <span className={`pass-schedule-icon ${item.tone === 'gold' ? 'gold' : ''}`} aria-hidden="true">{item.tone === 'gold' ? '✦' : '☀'}</span>
        <div><span className="pass-schedule-label">{item.label}</span><strong>{item.time}</strong>{typeof item.note === 'string' && item.note && <p>{item.note}</p>}</div>
      </div>)}
    </div>
    {typeof schedule.timezoneLabel === 'string' && <p className="pass-schedule-zone">{schedule.timezoneLabel}</p>}
  </section>;
}
