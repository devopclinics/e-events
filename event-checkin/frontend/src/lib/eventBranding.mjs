// Per-event branding stays separate from admission and guest feature settings.
// Published Design Studio colors remain editable; other events keep their styles.
const NCNMO_EVENT_ID = 'cefc5699-da7e-4610-9598-74a9423f0ea0'

export function eventBrandingKey(event) {
  return event?.id === NCNMO_EVENT_ID ? 'ncnmo' : undefined
}

export function eventBrandingStyle(event, theme) {
  if (!eventBrandingKey(event)) return {}
  const colors = theme?.colors || {}
  const hex = (value, fallback) => /^#[\da-f]{6}$/i.test(value || '') ? value : fallback
  return {
    '--event-primary': hex(colors.primary, '#1A4731'),
    '--event-secondary': hex(colors.secondary, '#256045'),
    '--event-accent': hex(colors.accent, '#C9A84C'),
    '--event-background': hex(colors.background, '#F5F3EE'),
    '--event-surface': hex(colors.surface, '#FFFFFF'),
    '--event-ink': hex(colors.text, '#1A4731'),
  }
}
