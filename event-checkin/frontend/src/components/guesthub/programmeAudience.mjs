// Presentation preference only. Scanner/session admission checks are unchanged.
export function filterProgramme(program, selected = 'self') {
  if (!program?.viewer_id) return program;
  const audience = selected === 'all' ? 'all'
    : program.audiences?.some(p => p.guest_id === selected) ? selected : program.viewer_id;
  const matches = s => audience === 'all' || !Array.isArray(s.audience_guest_ids) || s.audience_guest_ids.includes(audience);
  const days = (program.days || []).map(day => ({ ...day, segments: (day.segments || []).filter(matches) }));
  const upcoming = [...new Map(days.flatMap(day => day.segments).filter(s => s.state === 'upcoming').map(s => [s.step_id, s])).values()]
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  return { ...program, days, current_segments: (program.current_segments || []).filter(matches),
    next_segments: days.length ? upcoming.slice(0, 3) : (program.next_segments || []).filter(matches) };
}
