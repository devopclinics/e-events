export const RSVP_FORMATS = ['editorial', 'spotlight', 'invitation', 'briefing', 'festival', 'infographic', 'tiles', 'circular', 'hexagonal', 'modern-unique'];
export function rsvpFormat(theme) {
  const value = theme?.layout?.rsvpFormat;
  return RSVP_FORMATS.includes(value) ? value : 'compact';
}
