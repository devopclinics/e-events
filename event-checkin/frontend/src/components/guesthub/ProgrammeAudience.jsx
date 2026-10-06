export default function ProgrammeAudience({ program, value, onChange }) {
  if (!program?.viewer_id) return null;
  const self = program.audiences?.find(p => p.is_self);
  return <div className="programme-audience" style={{ margin: '12px 0', fontSize: 13 }}>
    <label style={{ display: 'block', fontWeight: 700 }}>Show programme for
      <select aria-label="Show programme for" value={value} onChange={e => onChange(e.target.value)}
        style={{ display: 'block', width: '100%', minHeight: 44, marginTop: 6, padding: '10px 12px', border: '1px solid #c5d5cc', borderRadius: 10, background: '#fff', color: '#18372f', fontSize: 14 }}>
        <option value="self">My programme{self?.age_group ? ` · ${self.age_group}` : ''}</option>
        {(program.audiences || []).filter(p => !p.is_self).map(p => <option key={p.guest_id} value={p.guest_id}>{p.name}{p.age_group ? ` · ${p.age_group}` : ''}</option>)}
        <option value="all">All programmes</option>
      </select>
    </label>
    <p style={{ margin: '7px 0 0', fontSize: 13 }}>{value === 'all' ? 'Showing every group. Session entry still follows your pass eligibility.' : 'Sessions for the selected attendee, including shared events. Choose All programmes to explore other groups.'}</p>
  </div>;
}
