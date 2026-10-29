import './StudioNavigation.css'

export const STUDIO_TABS = ['Templates', 'Envelope', 'GuestHub', 'Flyer', 'Event Page', 'Festio Pass', 'FestioHub', 'Certificates', 'Email Preview', 'Publish']
export const studioTabHref = tab => `/design-studio-redesign?advanced=1&tab=${encodeURIComponent(tab)}`

export default function StudioNavigation({ active, onSelectTab, onNavigate, disabled = false }) {
  const destinations = [
    { label: 'Guided design', href: '/design-studio-redesign' },
    { label: 'Event website', href: '/design-studio-redesign/website' },
    ...STUDIO_TABS.map(label => ({ label, href: studioTabHref(label), tab: true })),
  ]
  function follow(event, destination) {
    if (disabled) { event.preventDefault(); return }
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
    if (destination.tab && onSelectTab) { event.preventDefault(); onSelectTab(destination.label) }
    else if (onNavigate) { event.preventDefault(); onNavigate(destination.href) }
  }
  return <nav className="studio-navigation" aria-label="Design Studio tools">
    {destinations.map(destination => <a key={destination.label} href={destination.href}
      aria-current={active === destination.label ? 'page' : undefined}
      aria-disabled={disabled || undefined} onClick={event => follow(event, destination)}>{destination.label}</a>)}
  </nav>
}
