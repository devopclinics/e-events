export default function OrganizerContacts({phones = []}) {
  const numbers = [...new Set((Array.isArray(phones) ? phones : []).filter(value => typeof value === 'string' && /^\+[1-9]\d{7,14}$/.test(value)))].slice(0,5);
  if (!numbers.length) return null;
  return <section className="mt-4 rounded-xl border p-4" aria-label="Organizer phone numbers">
    <h3 className="font-bold">Contact the event team</h3>
    <p className="mt-1 text-sm">For registration confirmation and event enquiries.</p>
    <ul className="mt-3 space-y-4">{numbers.map(phone => <li key={phone}>
      <p className="font-semibold">{phone}</p>
      <div className="mt-2 flex flex-wrap gap-3">
        <a className="inline-flex min-h-11 items-center rounded-lg border px-4 font-semibold" href={`tel:${phone}`} aria-label={`Call organizer ${phone}`}>Call</a>
        <a className="inline-flex min-h-11 items-center rounded-lg border px-4 font-semibold" href={`https://wa.me/${phone.slice(1)}`} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp organizer ${phone}`}>WhatsApp ↗</a>
      </div>
    </li>)}</ul>
  </section>;
}
