import { useEffect, useRef, useState } from 'react'
import RedesignShell, { Icon, Modal } from './redesign/RedesignShell'
import { useCurrentEvent } from '../hooks/useCurrentEvent'
import { useEventDetails } from '../hooks/useEventDetails'
import { api } from '../api'
import './DesignStudioRedesignPage.css'

const TABS = ['Templates', 'GuestHub', 'Flyer', 'Event Page', 'Festio Pass', 'FestioHub', 'Email Preview', 'Publish']

// FestioHub layout + visual themes. Each entry combines a layout type
// (tabbed vs stacked, mirrored in InvitePage.jsx's HUB_TABBED_STYLES) with
// an optional colorPreset applied when the organizer clicks "Apply palette".
// Saved as theme_config.hubStyle; InvitePage reads designTheme.hub_style and
// applies the fh-hub-style-{id} CSS class. No backend change needed.
const HUB_STYLES = [
  // ── 5 original layout styles (no color preset) ──
  { id: 'wallet-pass',    name: 'Wallet Pass',    category: 'Layout',    tagline: 'Pass-first, native-app feel',     bestFor: 'Best when guests need their QR fast, at the door.', colorPreset: null, fontSuggestion: null },
  { id: 'card-dashboard', name: 'Card Dashboard', category: 'Layout',    tagline: 'Everything visible at once',      bestFor: 'No tabs to learn — every module as its own card.', colorPreset: null, fontSuggestion: null },
  { id: 'story-feed',     name: 'Story Feed',     category: 'Layout',    tagline: 'Community-first',                 bestFor: 'Best for events leaning on FestioMe engagement.', colorPreset: null, fontSuggestion: null },
  { id: 'timeline',       name: 'Timeline',       category: 'Layout',    tagline: 'Guided, chronological',           bestFor: 'Reassuring for first-time or formal-event guests.', colorPreset: null, fontSuggestion: null },
  { id: 'minimal-list',   name: 'Minimal List',   category: 'Layout',    tagline: 'Utility-first, fastest to scan', bestFor: 'For guests who just want in and out.', colorPreset: null, fontSuggestion: null },
  // ── 10 new visual themes ──
  {
    id: 'noir-couture', name: 'Noir Couture', category: 'Luxury',
    tagline: 'Gold on black — editorial luxury',
    bestFor: 'Galas, fashion events, award nights, black-tie dinners.',
    fontSuggestion: 'elegant-serif',
    colorPreset: { background: '#0a0a0a', surface: '#111111', accent: '#c9a84c', primary: '#8b7355', text: '#e8e0d0' },
  },
  {
    id: 'bloom-editorial', name: 'Bloom Editorial', category: 'Warm',
    tagline: 'Rose and blush — soft romantic',
    bestFor: 'Weddings, bridal showers, engagement parties, anniversaries.',
    fontSuggestion: 'classic-serif',
    colorPreset: { background: '#faf7f4', surface: '#ffffff', accent: '#c2696a', primary: '#9b7f7f', text: '#2e1f1f' },
  },
  {
    id: 'electric-rave', name: 'Electric Rave', category: 'Vibrant',
    tagline: 'Neon on dark — high-energy club',
    bestFor: 'Concerts, club nights, music festivals, launch parties.',
    fontSuggestion: 'bold-sans',
    colorPreset: { background: '#07070f', surface: '#0f0f1a', accent: '#7c3aed', primary: '#22d3ee', text: '#e2e0f0' },
  },
  {
    id: 'linen-gold', name: 'Linen & Gold', category: 'Warm',
    tagline: 'Earth tones — warm, organic luxury',
    bestFor: 'Weddings, rustic celebrations, outdoor summer events.',
    fontSuggestion: 'elegant-serif',
    colorPreset: { background: '#f7f3ee', surface: '#ffffff', accent: '#c4a47c', primary: '#8b6f47', text: '#2c2218' },
  },
  {
    id: 'celestial-midnight', name: 'Celestial', category: 'Dark',
    tagline: 'Midnight blue — cosmic elegance',
    bestFor: 'Formal galas, space-themed events, winter celebrations.',
    fontSuggestion: 'modern-sans',
    colorPreset: { background: '#030816', surface: '#080f28', accent: '#3b82f6', primary: '#818cf8', text: '#e2e8f8' },
  },
  {
    id: 'soleil', name: 'Soleil', category: 'Vibrant',
    tagline: 'Amber and coral — joyful summer',
    bestFor: 'Garden parties, outdoor festivals, birthday celebrations.',
    fontSuggestion: 'display-rounded',
    colorPreset: { background: '#fffbf5', surface: '#ffffff', accent: '#f59e0b', primary: '#fb923c', text: '#1c0a00' },
  },
  {
    id: 'mono-print', name: 'Mono Print', category: 'Editorial',
    tagline: 'Bold ink on paper — brutalist editorial',
    bestFor: 'Art exhibitions, design conferences, zine launches.',
    fontSuggestion: 'bold-sans',
    colorPreset: { background: '#f5f0eb', surface: '#ffffff', accent: '#e63329', primary: '#0a0a0a', text: '#0a0a0a' },
  },
  {
    id: 'verdant', name: 'Verdant', category: 'Nature',
    tagline: 'Forest green — nature & wellness',
    bestFor: 'Wellness retreats, eco events, outdoor ceremonies, garden parties.',
    fontSuggestion: 'modern-sans',
    colorPreset: { background: '#f0f7f0', surface: '#ffffff', accent: '#52b788', primary: '#2d6a4f', text: '#1a3320' },
  },
  {
    id: 'coastal-club', name: 'Coastal Club', category: 'Luxury',
    tagline: 'Navy & brass — nautical luxury',
    bestFor: 'Yacht clubs, coastal weddings, sailing events, maritime galas.',
    fontSuggestion: 'modern-sans',
    colorPreset: { background: '#f8f4ec', surface: '#ffffff', accent: '#b8912a', primary: '#0f2040', text: '#0f2040' },
  },
  {
    id: 'haze', name: 'Haze', category: 'Dark',
    tagline: 'Purple glass — moody glassmorphism',
    bestFor: 'Late-night events, festival after-parties, intimate lounge experiences.',
    fontSuggestion: 'modern-sans',
    colorPreset: { background: '#1a0533', surface: '#0d1b4b', accent: '#a855f7', primary: '#ec4899', text: '#ffffff' },
  },
]
const HUB_STYLE_CATEGORIES = ['All', 'Layout', 'Luxury', 'Warm', 'Vibrant', 'Dark', 'Nature', 'Editorial']

// GuestHub tab: same 10 visual themes as FestioHub's "Apply palette" (still
// reachable there for fine-tuning just the card), presented as whole-
// experience templates instead. Each swatch below reproduces its own
// mockup's actual composition — topbar/cover shape, hero-row layout (side-
// by-side vs. overlapping vs. 3-column split), and body content pattern —
// straight from guesthub-mockups.html / guesthub-mockups-2.html, not a
// single shared frame with a decorative sticker swapped per style.
const GUESTHUB_FONT_CSS = {
  'elegant-serif': "'Cormorant Garamond', Georgia, serif",
  'classic-serif': "Georgia, 'Times New Roman', serif",
  'bold-sans': "'Space Grotesk', -apple-system, sans-serif",
  'modern-sans': "'Inter', -apple-system, sans-serif",
  'display-rounded': "'Nunito', -apple-system, sans-serif",
}

function GhMiniQR({ color, size = 26 }) {
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} className="gh-qr-svg">
      <rect x="2" y="2" width="14" height="14" rx="1" stroke={color} strokeWidth="1.5" fill="none" />
      <rect x="5" y="5" width="8" height="8" fill={color} rx="0.5" />
      <rect x="24" y="2" width="14" height="14" rx="1" stroke={color} strokeWidth="1.5" fill="none" />
      <rect x="27" y="5" width="8" height="8" fill={color} rx="0.5" />
      <rect x="2" y="24" width="14" height="14" rx="1" stroke={color} strokeWidth="1.5" fill="none" />
      <rect x="5" y="27" width="8" height="8" fill={color} rx="0.5" />
      <rect x="24" y="24" width="4" height="4" fill={color} rx="0.3" />
      <rect x="30" y="24" width="4" height="4" fill={color} rx="0.3" />
      <rect x="24" y="30" width="4" height="4" fill={color} rx="0.3" />
      <rect x="30" y="30" width="4" height="4" fill={color} rx="0.3" />
    </svg>
  )
}

function GhTabs({ items, accent }) {
  return (
    <div className="gh-tabs">
      {items.map((t, i) => (
        <span key={t} className={i === 0 ? 'active' : ''} style={i === 0 ? { color: accent, borderColor: accent } : undefined}>{t}</span>
      ))}
    </div>
  )
}

// One case per template id — each mirrors that specific mockup's real DOM
// shape and sample copy (guest name, event name, programme items), scaled
// down for a card-sized preview.
function GuestHubSwatch({ s, font }) {
  const p = s.colorPreset
  const vars = { '--p-bg': p.background, '--p-surface': p.surface, '--p-accent': p.accent, '--p-primary': p.primary, '--p-text': p.text, fontFamily: font }
  switch (s.id) {
    case 'noir-couture':
      return (
        <div className="ds-gh-tpl ds-gh-tpl-noir-couture" style={vars}>
          <div className="gh-topbar">
            <span className="gh-brand">Festio GuestHub</span>
            <span className="gh-pill">✓ Confirmed</span>
          </div>
          <div className="gh-hero">
            <span className="gh-qr"><GhMiniQR color={p.accent} /></span>
            <div className="gh-hero-text">
              <strong className="gh-guest">Isabelle Fontaine</strong>
              <span className="gh-event">The Maison Gala</span>
              <span className="gh-status"><i />Ready for entry</span>
            </div>
          </div>
          <GhTabs items={['Pass', 'Activity', 'Program', 'Message']} accent={p.accent} />
          <div className="gh-body">
            <div className="gh-tl-item"><span className="gh-tl-time">7:30</span><span className="gh-tl-dot" /><span className="gh-tl-text">Welcome Reception</span></div>
            <div className="gh-tl-item"><span className="gh-tl-time">8:15</span><span className="gh-tl-dot" /><span className="gh-tl-text">Dinner Service</span></div>
          </div>
        </div>
      )
    case 'bloom-editorial':
      return (
        <div className="ds-gh-tpl ds-gh-tpl-bloom-editorial" style={vars}>
          <div className="gh-topbar">
            <span className="gh-brand">GuestHub by Festio</span>
            <strong className="gh-event">The Garden Soirée</strong>
            <span className="gh-date">Sat, 9 Aug · 6 PM</span>
          </div>
          <div className="gh-pass-card">
            <span className="gh-qr round"><GhMiniQR color={p.accent} /></span>
            <div className="gh-hero-text">
              <strong className="gh-guest">Amélie Rousseau</strong>
              <span className="gh-tag">Ready for entry</span>
            </div>
          </div>
          <GhTabs items={['Pass', 'Program', 'Messages', 'More']} accent={p.accent} />
          <div className="gh-body">
            <div className="gh-prog-item"><span className="gh-dot live" /><span className="gh-prog-name">Welcome &amp; Cocktails</span><span className="gh-prog-time">6:00</span></div>
            <div className="gh-prog-item"><span className="gh-dot" /><span className="gh-prog-name">Dinner Seated</span><span className="gh-prog-time">7:30</span></div>
          </div>
        </div>
      )
    case 'electric-rave':
      return (
        <div className="ds-gh-tpl ds-gh-tpl-electric-rave" style={vars}>
          <div className="gh-topbar">
            <span className="gh-brand">GuestHub</span>
            <span className="gh-live"><i />Live tonight</span>
          </div>
          <div className="gh-pass-zone">
            <span className="gh-qr"><GhMiniQR color={p.primary} /></span>
            <div className="gh-hero-text">
              <strong className="gh-guest">Zara Knox</strong>
              <span className="gh-event">Noir Frequency</span>
              <span className="gh-chip">Ready for Entry</span>
            </div>
          </div>
          <GhTabs items={['Pass', 'Activity', 'Program', 'Chat']} accent={p.primary} />
          <div className="gh-body gh-activity-grid">
            <div className="gh-stat"><span className="gh-stat-label">Status</span><span className="gh-stat-val">VIP</span></div>
            <div className="gh-stat"><span className="gh-stat-label">Attending</span><span className="gh-stat-val">347</span></div>
          </div>
        </div>
      )
    case 'linen-gold':
      return (
        <div className="ds-gh-tpl ds-gh-tpl-linen-gold" style={vars}>
          <div className="gh-cover"><span className="gh-cover-event">La Belle Époque</span></div>
          <div className="gh-pass-card overlap">
            <span className="gh-qr"><GhMiniQR color={p.accent} /></span>
            <div className="gh-hero-text">
              <strong className="gh-guest">Madeleine Lefèvre</strong>
              <span className="gh-chip">Table Lumière · Seat 4</span>
            </div>
          </div>
          <div className="gh-ornament">— ✦ —</div>
          <GhTabs items={['Pass', 'Menu', 'Program', 'Message']} accent={p.accent} />
          <div className="gh-body gh-menu-grid">
            <div className="gh-menu-item"><span className="course">Entrée</span><span className="dish">Velouté</span></div>
            <div className="gh-menu-item"><span className="course">Main</span><span className="dish">Magret de Canard</span></div>
          </div>
        </div>
      )
    case 'celestial-midnight':
      return (
        <div className="ds-gh-tpl ds-gh-tpl-celestial-midnight" style={vars}>
          <div className="gh-skyline"><span className="gh-moon" /><span className="gh-stars" /><span className="gh-title">Constellation Gala</span></div>
          <div className="gh-pass-card">
            <span className="gh-qr"><GhMiniQR color={p.primary} /></span>
            <div className="gh-hero-text">
              <strong className="gh-guest">Selene Moreau</strong>
              <span className="gh-stars-row">★★★★★ Constellation Tier</span>
            </div>
          </div>
          <GhTabs items={['Pass', 'Updates', 'Program', 'Chat']} accent={p.primary} />
          <div className="gh-body">
            <div className="gh-prog-row"><span>🌙</span><span className="gh-prog-time">20:00</span><span className="gh-prog-name">Grand Arrival</span></div>
            <div className="gh-prog-row"><span>🥂</span><span className="gh-prog-time">21:00</span><span className="gh-prog-name">Dinner Under Stars</span></div>
          </div>
        </div>
      )
    case 'soleil':
      return (
        <div className="ds-gh-tpl ds-gh-tpl-soleil" style={vars}>
          <div className="gh-banner">
            <span className="gh-brand-tag">GuestHub</span>
            <strong className="gh-event">Riviera Sunset Gala</strong>
            <span className="gh-date">Cannes Beach Club</span>
          </div>
          <div className="gh-pass-row">
            <span className="gh-qr"><GhMiniQR color={p.accent} /></span>
            <div className="gh-hero-text">
              <strong className="gh-guest">Sofia Marchetti</strong>
              <div className="gh-chips"><span className="gh-chip">✓ Confirmed</span><span className="gh-chip alt">Plage · 12</span></div>
            </div>
          </div>
          <GhTabs items={['Pass', 'Activity', 'Program', 'Chat']} accent={p.accent} />
          <div className="gh-body">
            <div className="gh-act-row"><span>🌊</span><span className="gh-act-name">Beach Arrival</span><span className="gh-act-time">18:00</span></div>
            <div className="gh-act-row"><span>🍽️</span><span className="gh-act-name">Dîner en Blanc</span><span className="gh-act-time">20:00</span></div>
          </div>
        </div>
      )
    case 'mono-print':
      return (
        <div className="ds-gh-tpl ds-gh-tpl-mono-print" style={vars}>
          <div className="gh-header">
            <div className="gh-header-left"><span className="gh-issue">GuestHub Pass</span><strong className="gh-event">The Industry Summit</strong></div>
            <div className="gh-header-right"><span className="gh-big-date">09</span><span className="gh-big-month">Aug</span></div>
          </div>
          <div className="gh-pass-block">
            <span className="gh-qr"><GhMiniQR color={p.primary} /></span>
            <div className="gh-hero-text"><strong className="gh-guest">Dara Okonkwo</strong><span className="gh-meta">Table 12</span></div>
            <div className="gh-status-block">✓<span>Entry</span></div>
          </div>
          <GhTabs items={['Pass', 'Agenda', 'Speakers', 'Contact']} accent={p.accent} />
          <div className="gh-body">
            <div className="gh-prog-row bordered"><span className="gh-prog-time">9:00</span><span className="gh-prog-name">Opening Keynote</span><span className="gh-tag red">Live</span></div>
            <div className="gh-prog-row bordered"><span className="gh-prog-time">11:00</span><span className="gh-prog-name">Track A</span><span className="gh-tag">Your Track</span></div>
          </div>
        </div>
      )
    case 'verdant':
      return (
        <div className="ds-gh-tpl ds-gh-tpl-verdant" style={vars}>
          <div className="gh-canopy"><span className="gh-badge">Festio GuestHub</span><strong className="gh-event">Forest Wellness Retreat</strong><span className="gh-sub">Springwater Lodge</span></div>
          <div className="gh-pass-card">
            <span className="gh-qr"><GhMiniQR color={p.primary} /></span>
            <div className="gh-hero-text"><strong className="gh-guest">Priya Nair</strong><div className="gh-chips"><span className="gh-chip live">🌿 Checked In</span><span className="gh-chip">Cabin Maple</span></div></div>
          </div>
          <GhTabs items={['Pass', 'Wellness', 'Schedule', 'Message']} accent={p.primary} />
          <div className="gh-body gh-wellness-grid">
            <div className="gh-stat"><span>🧘</span><span className="gh-stat-val">3 of 5</span></div>
            <div className="gh-stat"><span>🍵</span><span className="gh-stat-val">Plant-based</span></div>
          </div>
        </div>
      )
    case 'coastal-club':
      return (
        <div className="ds-gh-tpl ds-gh-tpl-coastal-club" style={vars}>
          <div className="gh-hull">
            <div className="gh-rope" />
            <div className="gh-hull-body">
              <div><span className="gh-club">Royal Harbour Yacht Club</span><strong className="gh-event">Summer Regatta</strong></div>
              <div className="gh-emblem">⚓<span>RHYC</span></div>
            </div>
          </div>
          <div className="gh-pass-strip">
            <span className="gh-qr"><GhMiniQR color={p.text} /></span>
            <div className="gh-hero-text"><strong className="gh-guest">Charles Whitfield III</strong><span className="gh-meta">Commodore's Table</span></div>
            <div className="gh-status-col">⚓<span>On Board</span></div>
          </div>
          <GhTabs items={['Pass', 'Races', 'Dinner', 'Message']} accent={p.accent} />
          <div className="gh-body">
            <div className="gh-leg"><span className="gh-leg-num">LEG 1</span><span className="gh-leg-name">Harbour Start</span><span className="gh-tag red">Live</span></div>
            <div className="gh-leg"><span className="gh-leg-num">GALA</span><span className="gh-leg-name">Prizegiving Dinner</span><span className="gh-leg-time">19:00</span></div>
          </div>
        </div>
      )
    case 'haze':
      return (
        <div className="ds-gh-tpl ds-gh-tpl-haze" style={vars}>
          <div className="gh-top">
            <div><span className="gh-brand">GuestHub · Festio</span><strong className="gh-event">Aurora Experience Night</strong></div>
            <span className="gh-invite-badge">✦ VIP</span>
          </div>
          <div className="gh-pass-glass">
            <span className="gh-qr"><GhMiniQR color={p.primary} /></span>
            <div className="gh-hero-text"><strong className="gh-guest">Yuki Tanaka</strong><span className="gh-gradient-tag">Backstage + All Areas</span></div>
          </div>
          <GhTabs items={['Pass', 'Lineup', 'Updates', 'Chat']} accent="#ffffff" />
          <div className="gh-body">
            <div className="gh-prog-row glow"><span className="gh-prog-time">21:00</span><span className="gh-prog-name">ZARA ft. HALO</span><span className="gh-tag live">Live</span></div>
            <div className="gh-prog-row"><span className="gh-prog-time">22:30</span><span className="gh-prog-name">DJ Nocturne</span></div>
          </div>
        </div>
      )
    default:
      return null
  }
}

const TEMPLATE_CATEGORIES = ['All', 'Wedding', 'Community', 'Conference', 'Celebration']
const TEMPLATE_STYLES = ['All styles', 'Warm', 'Minimal', 'Dark', 'Playful']

// Maps a surface label (from the API or mock data, case-insensitive) to the
// Design Studio tab that previews it. Clicking a chip on a template card
// selects that template and jumps straight to its surface preview.
const SURFACE_TAB = {
  'rsvp page': 'Event Page',
  'event page': 'Event Page',
  'rsvp_page': 'Event Page',
  'event_page': 'Event Page',
  'flyer': 'Flyer',
  'festiohub': 'FestioHub',
  'festio hub': 'FestioHub',
  'festio_hub': 'FestioHub',
  'festio pass': 'Festio Pass',
  'festio_pass': 'Festio Pass',
  'pass': 'Festio Pass',
  'email': 'Email Preview',
}

const TEMPLATES = [
  { name: 'Botanical Gold', category: 'Wedding', style: 'Warm', tier: 'premium', tone: 'Warm, floral', selected: true, surfaces: ['Event Page', 'Flyer', 'Pass', 'Email'] },
  { name: 'Modern Mono', category: 'Conference', style: 'Minimal', tier: 'free', tone: 'Minimal, high-contrast', selected: false, surfaces: ['Event Page', 'Flyer', 'Email'] },
  { name: 'Midnight Celebration', category: 'Celebration', style: 'Dark', tier: 'premium', tone: 'Dark, elegant', selected: false, surfaces: ['Event Page', 'Flyer', 'Pass', 'Email'] },
  { name: 'Community Classic', category: 'Community', style: 'Warm', tier: 'free', tone: 'Friendly, accessible', selected: false, surfaces: ['Event Page', 'Flyer'] },
]

// Real design-service contract (confirmed against DesignStudioPage.jsx, the
// already-shipped legacy page these records are shared live with — getting
// these keys wrong would write malformed data into real event-design rows).
const WORDING_FIELDS = [
  ['inviteLabel', 'Invite label', "You're invited"],
  ['eventTitle', 'Event title', ''],
  ['eventSubtitle', 'Subtitle', ''],
  ['hostName', 'Host name', ''],
  ['hostWebsite', 'Host website', ''],
  ['date', 'Date', ''],
  ['time', 'Time', ''],
  ['venue', 'Venue', ''],
  ['address', 'Address', ''],
  ['rsvpBy', 'RSVP by', ''],
  ['rsvpNote', 'RSVP note', ''],
  ['phone', 'Phone', ''],
  ['email', 'Email', ''],
  ['dressCode', 'Dress code', ''],
  ['admissionNote', 'Admission note', 'Present this pass at the door for entry.'],
  ['parkingNote', 'Parking note', ''],
  ['customMessage', 'Custom message', ''],
  ['aboutWebsite', 'About / website', ''],
  ['footerMessage', 'Footer message', ''],
  ['footerNote', 'Footer note', ''],
]
const DEFAULT_WORDING = Object.fromEntries(WORDING_FIELDS.map(([key, , fallback]) => [key, fallback]))

const COLOR_FIELDS = [
  { key: 'primary', label: 'Primary' },
  { key: 'accent', label: 'Accent' },
  { key: 'background', label: 'Background' },
  { key: 'surface', label: 'Surface' },
  { key: 'text', label: 'Text' },
]
const DEFAULT_COLORS = { primary: '#0f766e', accent: '#b6672f', background: '#faf6ee', surface: '#ffffff', text: '#211a13' }

const FONT_OPTIONS = [
  { id: 'modern-sans', label: 'Modern Sans' },
  { id: 'classic-serif', label: 'Classic Serif' },
  { id: 'elegant-serif', label: 'Elegant Serif' },
  { id: 'display-rounded', label: 'Display Rounded' },
  { id: 'bold-sans', label: 'Bold Sans' },
]

const FLYER_TEXT_SCALES = [
  { value: 0.9, label: 'Small' },
  { value: 1, label: 'Medium' },
  { value: 1.15, label: 'Large' },
  { value: 1.3, label: 'X-Large' },
  { value: 1.45, label: 'XX-Large' },
]

const FLYER_SIZES = [
  { id: 'square', label: 'Square (social)' },
  { id: 'story', label: 'Story (9:16)' },
  { id: 'portrait', label: 'Portrait' },
  { id: 'a5', label: 'A5 (print)' },
  { id: 'a4', label: 'A4 (print)' },
]

const QR_POSITIONS = [
  { id: 'bottom-right', label: 'Bottom right' },
  { id: 'bottom-left', label: 'Bottom left' },
  { id: 'center-bottom', label: 'Bottom center' },
]

const DEFAULT_IMAGE_POSITION = { x: 50, y: 50, zoom: 115, rotate: 0, zoneScale: 100, boxX: 0, boxY: 0 }
const DEFAULT_FLYER_SETTINGS = { size: 'portrait', qr: true, rsvpLink: true, qrPosition: 'bottom-right' }
const DEFAULT_PASS_OPTIONS = { showTable: true, showSeat: true, showHubButton: true }

const CROP_SLIDERS = [
  { key: 'x', label: 'Horizontal position', min: 0, max: 100 },
  { key: 'y', label: 'Vertical position', min: 0, max: 100 },
  { key: 'zoom', label: 'Zoom', min: 100, max: 180 },
  { key: 'rotate', label: 'Rotate', min: -180, max: 180 },
]

// Matches the real `page_config` contract read by the guest-facing InvitePage
// (see legacy DesignStudioPage.jsx's DEFAULT_PUBLIC_PAGE / publicPageSettings()).
// There is no "seating preview" or "FestioHub live feed" section in that contract —
// those never had a real effect and are not offered here.
const DEFAULT_PAGE_SECTIONS = {
  hero: { showWelcomeLabel: true, showTitle: true, showHost: true, overlayOpacity: 55, focusX: 50, focusY: 20 },
  organizer: { show: true, label: 'Organized by' },
  details: { showVenue: true, showHotel: true, showHost: true, showAdmission: true },
  about: { show: true, ctaLabel: '', ctaUrl: '' },
}

const EMAIL_TYPES = ['Invitation', 'RSVP confirmation', 'Festio Pass email', 'Reminder', 'Broadcast', 'Check-in confirmation']

// A representative-looking 7x7 QR pattern for the illustrative pass preview —
// each real guest's actual pass carries their own unique token, this is only
// here so the preview reads as "a QR code" at a glance.
const QR_ON_INDEXES = new Set([0, 1, 2, 3, 6, 7, 9, 11, 13, 14, 16, 18, 20, 21, 24, 27, 28, 30, 32, 34, 36, 39, 41, 42, 43, 45, 48])
const QR_SAMPLE_PATTERN = Array.from({ length: 49 }, (_, i) => QR_ON_INDEXES.has(i))

const PUBLISH_CHECKLIST = [
  { label: 'Template selected', done: true },
  { label: 'Cover image added', done: true },
  { label: 'Title, date & venue set', done: true },
  { label: 'Colors selected', done: true },
  { label: 'Flyer size confirmed', done: true },
  { label: 'Festio Pass preview reviewed', done: false },
  { label: 'Invite email preview reviewed', done: false },
]

function Swatch({ hex }) {
  return <span className="ds-swatch-dot" style={{ background: hex }} />
}

function humanizeKey(value) {
  if (!value) return '—'
  return String(value).replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export default function DesignStudioRedesignPage() {
  const [eventId] = useCurrentEvent()
  const { event } = useEventDetails(eventId)
  const [tab, setTab] = useState('Templates')
  const [templates, setTemplates] = useState([])
  const [tplCategory, setTplCategory] = useState('All')
  const [tplStyle, setTplStyle] = useState('All styles')
  const [tplQuery, setTplQuery] = useState('')
  const [previewTpl, setPreviewTpl] = useState(null)
  const [toast, setToast] = useState('')
  const [passHasPass, setPassHasPass] = useState(true)
  const [emailType, setEmailType] = useState(EMAIL_TYPES[0])
  const [pageSections, setPageSections] = useState(DEFAULT_PAGE_SECTIONS)
  const [mobilePreview, setMobilePreview] = useState(false)
  const [publishState, setPublishState] = useState('idle') // idle | confirm | publishing | success | error
  const [publishError, setPublishError] = useState('')
  const [design, setDesign] = useState(null)
  const [outputs, setOutputs] = useState([])
  const [designBusy, setDesignBusy] = useState(false)

  // Flyer / Festio Pass — real design-service fields, hydrated from `design`
  // in loadDesignStudio() below and saved back via saveFlyerSettings()/renderFlyer().
  const [wording, setWording] = useState(DEFAULT_WORDING)
  const [colors, setColors] = useState(DEFAULT_COLORS)
  const [fontPairing, setFontPairing] = useState(FONT_OPTIONS[0].id)
  const [flyerTextScale, setFlyerTextScale] = useState(1)
  const [flyerSettings, setFlyerSettings] = useState(DEFAULT_FLYER_SETTINGS)
  const [imagePosition, setImagePosition] = useState(DEFAULT_IMAGE_POSITION)
  const [passOptions, setPassOptions] = useState(DEFAULT_PASS_OPTIONS)
  const [selectedFlyerTplId, setSelectedFlyerTplId] = useState('')
  const [coverBusy, setCoverBusy] = useState(false)
  const [renderBusy, setRenderBusy] = useState(false)
  const [hubStyle, setHubStyle] = useState(HUB_STYLES[0].id)
  const [hubStyleBusy, setHubStyleBusy] = useState(false)
  const [hubCategory, setHubCategory] = useState('All')
  const coverFileRef = useRef(null)

  // Live flyer preview: a real server render (same engine the download
  // buttons use), debounced on every edit, with preview:true so the
  // design-service skips persisting a file — a live preview shouldn't
  // clutter "Recent rendered files" with a new row per keystroke.
  const [flyerPreviewUrl, setFlyerPreviewUrl] = useState('')
  const [flyerPreviewLoading, setFlyerPreviewLoading] = useState(false)
  const [flyerPreviewError, setFlyerPreviewError] = useState('')
  const flyerPreviewTimerRef = useRef(null)
  const flyerPreviewObjectUrlRef = useRef('')

  async function loadDesignStudio() {
    if (!eventId) return
    setDesignBusy(true)
    try {
      const [catalog, saved, rendered] = await Promise.all([
        api.designTemplates(),
        api.getEventDesign(eventId),
        api.designOutputs(eventId).catch(() => []),
      ])
      const items = (catalog.templates || catalog || []).map((item) => ({
        ...item,
        name: item.name,
        category: item.category,
        style: item.style,
        tier: item.isFree ? 'free' : 'premium',
        tone: item.description || item.style || '',
        surfaces: item.surfaces || [],
        selected: item.id === saved.selected_template_id,
      }))
      setTemplates(items)
      setDesign(saved)
      setOutputs(rendered.outputs || rendered || [])
      setPreviewTpl(items.find((item) => item.selected) || items[0] || null)
      setPageSections({
        hero: { ...DEFAULT_PAGE_SECTIONS.hero, ...(saved.page_config?.hero || {}) },
        organizer: { ...DEFAULT_PAGE_SECTIONS.organizer, ...(saved.page_config?.organizer || {}) },
        details: { ...DEFAULT_PAGE_SECTIONS.details, ...(saved.page_config?.details || {}) },
        about: { ...DEFAULT_PAGE_SECTIONS.about, ...(saved.page_config?.about || {}) },
      })
      setWording({ ...DEFAULT_WORDING, ...(saved.wording_config || {}) })
      setColors({ ...DEFAULT_COLORS, ...(saved.theme_config?.colors || {}) })
      setFontPairing(saved.theme_config?.fontPairing || FONT_OPTIONS[0].id)
      setPassOptions({ ...DEFAULT_PASS_OPTIONS, ...(saved.theme_config?.passOptions || {}) })
      setHubStyle(saved.theme_config?.hubStyle || HUB_STYLES[0].id)
      setFlyerTextScale(saved.asset_config?.flyer_text_scale ?? 1)
      setFlyerSettings({ ...DEFAULT_FLYER_SETTINGS, ...(saved.asset_config?.flyer_settings || {}) })
      setImagePosition({ ...DEFAULT_IMAGE_POSITION, ...(saved.asset_config?.image_position || {}) })
      setSelectedFlyerTplId(saved.selected_flyer_template_id || '')
    } catch (e) {
      notify(e.message || 'Design Studio could not be loaded')
    } finally {
      setDesignBusy(false)
    }
  }

  useEffect(() => { loadDesignStudio() }, [eventId])

  // a5/a4 are print-only sizes (design-service serves them as PDF, never
  // PNG) — there's no honest way to show those inline, so the live preview
  // only covers the three PNG-native sizes and says so for the other two.
  const flyerPreviewSupported = ['square', 'story', 'portrait'].includes(flyerSettings.size)

  useEffect(() => {
    if (tab !== 'Flyer' || !eventId || !flyerPreviewSupported) return undefined
    clearTimeout(flyerPreviewTimerRef.current)
    flyerPreviewTimerRef.current = setTimeout(async () => {
      setFlyerPreviewLoading(true)
      setFlyerPreviewError('')
      try {
        const { blob } = await api.renderFlyer(eventId, {
          size: flyerSettings.size,
          format: 'png',
          template_id: selectedFlyerTplId || undefined,
          colors,
          wording,
          cover_image_url: design?.asset_config?.cover_image_url || undefined,
          image_position: imagePosition,
          text_scale: flyerTextScale,
          qr_enabled: flyerSettings.qr,
          qr_position: flyerSettings.qrPosition,
          qr_data: flyerSettings.qr && flyerSettings.rsvpLink ? `https://festio.events/invite/${eventId}` : null,
          preview: true,
        }, { download: false })
        if (flyerPreviewObjectUrlRef.current) URL.revokeObjectURL(flyerPreviewObjectUrlRef.current)
        const url = URL.createObjectURL(blob)
        flyerPreviewObjectUrlRef.current = url
        setFlyerPreviewUrl(url)
      } catch (e) {
        setFlyerPreviewError(e.message || 'Live preview is temporarily unavailable — the download buttons still render the real file.')
      } finally {
        setFlyerPreviewLoading(false)
      }
    }, 900)
    return () => clearTimeout(flyerPreviewTimerRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, eventId, flyerPreviewSupported, flyerSettings.size, flyerSettings.qr, flyerSettings.qrPosition, flyerSettings.rsvpLink,
      selectedFlyerTplId, colors, wording, imagePosition, flyerTextScale, design?.asset_config?.cover_image_url])

  useEffect(() => () => { if (flyerPreviewObjectUrlRef.current) URL.revokeObjectURL(flyerPreviewObjectUrlRef.current) }, [])

  function notify(msg) {
    setToast(msg)
    window.setTimeout(() => setToast(''), 2600)
  }

  async function selectTemplate(template) {
    if (!eventId || designBusy) return
    setDesignBusy(true)
    try {
      const saved = await api.saveEventDesign(eventId, {
        selected_template_id: template.id,
        selected_flyer_template_id: design?.selected_flyer_template_id || null,
        theme_config: design?.theme_config || {},
        wording_config: design?.wording_config || {},
        asset_config: design?.asset_config || {},
        page_config: design?.page_config || {},
      })
      setDesign(saved)
      setTemplates((prev) => prev.map((item) => ({ ...item, selected: item.id === saved.selected_template_id })))
      setPreviewTpl(template)
      notify(`${template.name} saved as the active template`)
    } catch (e) {
      notify(e.message || 'Template selection could not be saved')
    } finally {
      setDesignBusy(false)
    }
  }

  async function savePageSettings(nextSections = pageSections) {
    if (!eventId || designBusy) return
    setDesignBusy(true)
    try {
      const saved = await api.saveEventDesign(eventId, {
        selected_template_id: design?.selected_template_id || activeTemplate?.id || null,
        selected_flyer_template_id: design?.selected_flyer_template_id || null,
        theme_config: design?.theme_config || {},
        wording_config: design?.wording_config || {},
        asset_config: design?.asset_config || {},
        page_config: nextSections,
      })
      setDesign(saved)
      notify('Page settings saved')
    } catch (e) {
      notify(e.message || 'Page settings could not be saved')
    } finally {
      setDesignBusy(false)
    }
  }

  async function resetPageSettings() {
    const next = {
      hero: { ...DEFAULT_PAGE_SECTIONS.hero },
      organizer: { ...DEFAULT_PAGE_SECTIONS.organizer },
      details: { ...DEFAULT_PAGE_SECTIONS.details },
      about: { ...DEFAULT_PAGE_SECTIONS.about },
    }
    setPageSections(next)
    await savePageSettings(next)
  }

  const activeTemplate = templates.find((t) => t.selected)

  function buildDraftTheme() {
    // template_id/layout/button_style only matter to the Event Page/Flyer/Pass
    // surfaces — FestioHub's preview needs none of them, so this stays valid
    // (falls back like design-service's own default_template() would) even
    // before an organizer has picked a template.
    return {
      event_id: eventId,
      template_id: activeTemplate?.id || null,
      is_default: !activeTemplate,
      colors,
      font_pairing: fontPairing,
      button_style: design?.theme_config?.buttonStyle || activeTemplate?.buttonStyle || 'square',
      layout: activeTemplate?.layout || {},
      cover_image_url: design?.asset_config?.cover_image_url || '',
      flyer_image_url: design?.asset_config?.flyer_image_url || '',
      wording,
      pass_options: passOptions,
      page_config: pageSections,
      hub_style: hubStyle,
    }
  }

  function syncDraftPreviewStorage() {
    if (!eventId) return false
    try {
      sessionStorage.setItem(`festio:design-preview:${eventId}`, JSON.stringify({ event_id: eventId, theme: buildDraftTheme(), saved_at: Date.now() }))
      return true
    } catch {
      return false
    }
  }

  function openDraftPreview(anchor = '') {
    if (!eventId) {
      notify('Select a supported design first')
      return
    }
    if (syncDraftPreviewStorage()) {
      window.open(`/invite/${eventId}?studio-preview=1${anchor}`, '_blank', 'noopener')
    } else {
      notify('Could not open the draft preview. Allow pop-ups and try again.')
    }
  }

  // Inline "Live preview" iframe (Event Page tab): reuses the same
  // sessionStorage handoff as openDraftPreview() above, but keeps it synced
  // as you edit instead of requiring a manual "open in new tab" click each
  // time. First sync per event/template is immediate so the iframe never
  // flashes the published page before the draft; edits after that are
  // debounced so typing doesn't reload the iframe on every keystroke.
  const [eventPagePreviewNonce, setEventPagePreviewNonce] = useState(0)
  const eventPageSyncedRef = useRef(false)
  const eventPagePreviewTimerRef = useRef(null)

  useEffect(() => { eventPageSyncedRef.current = false }, [eventId])

  useEffect(() => {
    if (tab !== 'Event Page' && tab !== 'FestioHub' && tab !== 'GuestHub') return undefined
    if (!eventId) return undefined
    const delay = eventPageSyncedRef.current ? 700 : 0
    clearTimeout(eventPagePreviewTimerRef.current)
    eventPagePreviewTimerRef.current = setTimeout(() => {
      if (syncDraftPreviewStorage()) {
        eventPageSyncedRef.current = true
        setEventPagePreviewNonce((n) => n + 1)
      }
    }, delay)
    return () => clearTimeout(eventPagePreviewTimerRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, eventId, activeTemplate?.id, colors, fontPairing, wording, passOptions, pageSections, hubStyle,
      design?.asset_config?.cover_image_url, design?.asset_config?.flyer_image_url])

  async function saveFlyerAndPassSettings() {
    if (!eventId || designBusy) return
    setDesignBusy(true)
    try {
      const saved = await api.saveEventDesign(eventId, {
        selected_template_id: design?.selected_template_id || null,
        selected_flyer_template_id: selectedFlyerTplId || null,
        theme_config: { ...(design?.theme_config || {}), colors, fontPairing, passOptions },
        wording_config: wording,
        asset_config: { ...(design?.asset_config || {}), flyer_text_scale: flyerTextScale, flyer_settings: flyerSettings, image_position: imagePosition },
        page_config: design?.page_config || {},
      })
      setDesign(saved)
      notify('Design settings saved')
    } catch (e) {
      notify(e.message || 'Design settings could not be saved')
    } finally {
      setDesignBusy(false)
    }
  }

  async function selectFlyerTemplate(templateId) {
    setSelectedFlyerTplId(templateId)
    if (!eventId) return
    try {
      const saved = await api.saveEventDesign(eventId, {
        selected_template_id: design?.selected_template_id || null,
        selected_flyer_template_id: templateId,
        theme_config: design?.theme_config || {},
        wording_config: design?.wording_config || {},
        asset_config: design?.asset_config || {},
        page_config: design?.page_config || {},
      })
      setDesign(saved)
      notify('Flyer template saved')
    } catch (e) { notify(e.message || 'Flyer template could not be saved') }
  }

  async function selectHubStyle(styleId) {
    setHubStyle(styleId)
    if (!eventId) return
    setHubStyleBusy(true)
    try {
      const saved = await api.saveEventDesign(eventId, {
        selected_template_id: design?.selected_template_id || null,
        selected_flyer_template_id: design?.selected_flyer_template_id || null,
        theme_config: { ...(design?.theme_config || {}), hubStyle: styleId },
        wording_config: design?.wording_config || {},
        asset_config: design?.asset_config || {},
        page_config: design?.page_config || {},
      })
      setDesign(saved)
      notify(`${HUB_STYLES.find((s) => s.id === styleId)?.name || 'FestioHub style'} saved`)
    } catch (e) { notify(e.message || 'FestioHub style could not be saved') }
    finally { setHubStyleBusy(false) }
  }

  async function applyHubColorPreset(styleId) {
    const style = HUB_STYLES.find((s) => s.id === styleId)
    if (!style?.colorPreset) return
    const nextColors = { ...DEFAULT_COLORS, ...style.colorPreset }
    const nextFont = style.fontSuggestion || fontPairing
    setColors(nextColors)
    setFontPairing(nextFont)
    if (!eventId) return
    setHubStyleBusy(true)
    try {
      const saved = await api.saveEventDesign(eventId, {
        selected_template_id: design?.selected_template_id || null,
        selected_flyer_template_id: design?.selected_flyer_template_id || null,
        theme_config: { ...(design?.theme_config || {}), hubStyle: styleId, colors: nextColors, fontPairing: nextFont },
        wording_config: design?.wording_config || {},
        asset_config: design?.asset_config || {},
        page_config: design?.page_config || {},
      })
      setDesign(saved)
      notify(`${style.name} palette applied`)
    } catch (e) { notify(e.message || 'Palette could not be applied') }
    finally { setHubStyleBusy(false) }
  }

  async function uploadFlyerPhoto(file) {
    if (!file || !eventId) return
    setCoverBusy(true)
    try {
      const meta = await api.uploadDesignAsset(eventId, file)
      const saved = await api.saveEventDesign(eventId, {
        asset_config: { ...(design?.asset_config || {}), cover_image_url: meta.public_url },
      })
      setDesign(saved)
      notify('Photo uploaded')
    } catch (e) { notify(e.message || 'Photo could not be uploaded') }
    finally { setCoverBusy(false); if (coverFileRef.current) coverFileRef.current.value = '' }
  }

  // Mirrors DesignStudioPage.jsx's renderFlyer() exactly: save the current
  // wording/photo-position first, render server-side, and — only when the
  // organizer explicitly asks — promote the rendered output to the event's
  // real RSVP cover image (never automatic, so a hand-uploaded cover photo
  // is never silently replaced by a generated flyer).
  async function renderFlyer(fmt, useAsCover) {
    if (!eventId || renderBusy) return
    setRenderBusy(true)
    try {
      await api.saveEventDesign(eventId, {
        wording_config: wording,
        asset_config: { ...(design?.asset_config || {}), image_position: imagePosition, flyer_text_scale: flyerTextScale },
      })
      const result = await api.renderFlyer(eventId, {
        size: flyerSettings.size,
        format: fmt || (['a5', 'a4'].includes(flyerSettings.size) ? 'pdf' : 'png'),
        template_id: selectedFlyerTplId || undefined,
        colors,
        wording,
        cover_image_url: design?.asset_config?.cover_image_url || undefined,
        image_position: imagePosition,
        text_scale: flyerTextScale,
        qr_enabled: flyerSettings.qr,
        qr_position: flyerSettings.qrPosition,
        qr_data: flyerSettings.qr && flyerSettings.rsvpLink ? `https://festio.events/invite/${eventId}` : null,
      })
      if (useAsCover && result?.outputUrl) {
        const saved = await api.saveEventDesign(eventId, {
          asset_config: { ...(design?.asset_config || {}), image_position: imagePosition, cover_image_url: result.outputUrl, flyer_image_url: result.outputUrl },
        })
        setDesign(saved)
        await api.updateInviteSettings(eventId, { invite_cover_image: result.outputUrl })
      }
      api.designOutputs(eventId).then((r) => setOutputs(r.outputs || [])).catch(() => {})
      notify(useAsCover ? 'Flyer rendered, downloaded, and applied as the RSVP cover' : 'Flyer rendered and downloaded')
    } catch (e) {
      notify(e.message || 'Render failed')
    } finally {
      setRenderBusy(false)
    }
  }

  async function publishDesign() {
    if (!eventId || publishState === 'publishing') return
    setPublishState('publishing')
    setPublishError('')
    try {
      const result = await api.publishEventDesign(eventId)
      setDesign((current) => ({ ...current, ...result }))
      setPublishState('success')
      setOutputs(await api.designOutputs(eventId).catch(() => outputs))
    } catch (e) {
      setPublishError(e.message || 'Design could not be published')
      setPublishState('error')
    }
  }

  function setPageSection(section, key, value) {
    setPageSections((prev) => ({ ...prev, [section]: { ...prev[section], [key]: value } }))
  }

  const filteredTemplates = templates.filter((t) =>
    (tplCategory === 'All' || t.category === tplCategory) &&
    (tplStyle === 'All styles' || t.style === tplStyle) &&
    (!tplQuery.trim() || t.name.toLowerCase().includes(tplQuery.trim().toLowerCase()))
  )

  const publishChecklist = [
    { label: 'Template selected', done: !!design?.selected_template_id },
    { label: 'Flyer template selected', done: !!design?.selected_flyer_template_id },
    { label: 'Colors customized', done: Object.keys(design?.theme_config || {}).length > 0 },
    { label: 'Event page customized', done: Object.keys(design?.page_config || {}).length > 0 },
  ]
  const publishDone = publishChecklist.filter((c) => c.done).length

  return (
    <RedesignShell topActive="design" withEventSidebar={false} eventScoped>
      <div className="rr-pagehead">
        <div>
          <div className="rr-title-row"><h1>Design Studio</h1></div>
          <div className="rr-meta"><Icon name="calendar" size={13} /> {event?.name || (eventId ? 'Loading…' : 'No event selected')} <span className="rr-dot">·</span> Template: {activeTemplate?.name || 'None'}</div>
        </div>
      </div>

      <div className="rr-tabs">
        {TABS.map((t) => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>)}
      </div>

      {tab === 'Templates' && (
        <>
          <div className="ds-stat-row">
            <div><strong>{templates.length}</strong><span>Templates</span></div>
            <div><strong>5</strong><span>Collections</span></div>
            <div><strong>4</strong><span>Surfaces per template</span></div>
          </div>
          <div className="ds-filter-row">
            <div className="rd-search" style={{ flex: 1, minWidth: 180 }}>
              <Icon name="search" size={14} />
              <input placeholder="Search templates…" value={tplQuery} onChange={(e) => setTplQuery(e.target.value)} />
            </div>
            <select className="rr-select" style={{ flex: '0 0 auto' }} value={tplCategory} onChange={(e) => setTplCategory(e.target.value)}>
              {TEMPLATE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
            <select className="rr-select" style={{ flex: '0 0 auto' }} value={tplStyle} onChange={(e) => setTplStyle(e.target.value)}>
              {TEMPLATE_STYLES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>

          <div className="ds-templates-layout">
            <div className="ds-tpl-grid">
              {filteredTemplates.map((t) => (
                <div className={`rr-panel ds-template-card ${t.selected ? 'selected' : ''}`} key={t.name} onClick={() => setPreviewTpl(t)}>
                  {t.thumbnailUrl ? (
                    <div className="ds-template-swatch ds-template-swatch-image" style={{ backgroundImage: `url(${t.thumbnailUrl})` }} />
                  ) : (
                    <div
                      className="ds-template-swatch"
                      style={t.defaultColors ? { background: `linear-gradient(145deg, ${t.defaultColors.background}, ${t.defaultColors.surface})`, color: t.defaultColors.accent || t.defaultColors.primary } : undefined}
                    >
                      <Icon name="palette" size={22} />
                    </div>
                  )}
                  <div className="ds-template-badges">
                    <span className={`ds-tier-badge ${t.tier}`}>{t.tier === 'premium' ? 'Premium' : 'Free'}</span>
                    {t.selected && <span className="rr-pill live"><i /> Active</span>}
                  </div>
                  <strong>{t.name}</strong>
                  <span>{t.tone}</span>
                  <div className="ds-surface-chips">
                    {t.surfaces.map((s) => {
                      const targetTab = SURFACE_TAB[s.toLowerCase()]
                      return (
                        <button
                          key={s}
                          className="rd-chip ds-surface-chip"
                          title={`Preview ${s}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            setPreviewTpl(t)
                            if (targetTab) setTab(targetTab)
                          }}
                        >{s}</button>
                      )
                    })}
                  </div>
                  <div className="rd-row2">
                    <button className="rr-btn secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={(e) => { e.stopPropagation(); setPreviewTpl(t) }}>Preview</button>
                    {!t.selected && <button disabled={designBusy} className="rr-btn primary" style={{ flex: 1, justifyContent: 'center' }} onClick={(e) => { e.stopPropagation(); selectTemplate(t) }}>{designBusy ? 'Saving…' : 'Select'}</button>}
                  </div>
                </div>
              ))}
            </div>

            <div className="rd-panel ds-side-preview">
              <div className="rd-panel-head"><h3>Preview</h3><p>{previewTpl?.name || 'Choose a template'}</p></div>
              {previewTpl ? (
                <div className="rd-panel-body">
                  <div
                    className="ds-template-hero"
                    style={{ background: `linear-gradient(145deg, ${previewTpl.defaultColors?.background || '#e2e8f0'}, ${previewTpl.defaultColors?.surface || '#f8fafc'})` }}
                  >
                    {previewTpl.thumbnailUrl && <img src={previewTpl.thumbnailUrl} alt="" className="ds-template-hero-image" loading="lazy" />}
                    <div className="ds-template-hero-caption">
                      <strong style={{ color: previewTpl.thumbnailUrl ? '#fff' : (previewTpl.defaultColors?.primary || '#0f172a') }}>{previewTpl.name}</strong>
                      <span style={{ color: previewTpl.thumbnailUrl ? '#fff' : (previewTpl.defaultColors?.accent || '#14b8a6') }}>{previewTpl.style}</span>
                    </div>
                  </div>
                  {previewTpl.defaultColors && (
                    <div className="ds-color-row" style={{ marginTop: 10 }}>
                      {['primary', 'accent', 'background', 'surface', 'text'].map((k) => <Swatch key={k} hex={previewTpl.defaultColors[k]} />)}
                    </div>
                  )}
                  <div className="ds-layout-grid">
                    <div><strong>Event page</strong><span>{humanizeKey(previewTpl.layout?.eventPage)}</span></div>
                    <div><strong>Flyer</strong><span>{humanizeKey(previewTpl.layout?.flyer)}</span></div>
                    <div><strong>Festio Pass</strong><span>{humanizeKey(previewTpl.layout?.pass)}</span></div>
                    <div><strong>Email</strong><span>{humanizeKey(previewTpl.layout?.email)}</span></div>
                  </div>
                  {!previewTpl.selected && (
                    <button disabled={designBusy} className="rr-btn primary" style={{ width: '100%', justifyContent: 'center', marginTop: 12 }} onClick={() => selectTemplate(previewTpl)}>
                      {designBusy ? 'Saving…' : 'Use this family'}
                    </button>
                  )}
                </div>
              ) : (
                <div className="rd-panel-body"><p className="rd-rowlink">Preview a card to see its surfaces, colors, and layout rules.</p></div>
              )}
            </div>
          </div>
        </>
      )}

      {tab === 'Flyer' && (
        <div className="ds-flyer-layout">
          <div className="ds-flyer-col">
            <div className="rd-panel">
              <div className="rd-panel-head"><h3>Flyer template</h3></div>
              <div className="rd-panel-body ds-flyer-tpl-row">
                {templates.filter((t) => (t.surfaces || []).includes('Flyer')).map((t) => (
                  <button key={t.id} className={`ds-flyer-tpl-chip ${selectedFlyerTplId === t.id ? 'active' : ''}`} onClick={() => selectFlyerTemplate(t.id)}>{t.name}</button>
                ))}
                {!templates.some((t) => (t.surfaces || []).includes('Flyer')) && <p className="rd-rowlink">No flyer-capable templates in the catalog yet.</p>}
              </div>
            </div>

            <div className="rd-panel">
              <div className="rd-panel-head"><h3>Wording</h3></div>
              <div className="rd-panel-body">
                {WORDING_FIELDS.map(([key, label]) => (
                  <div key={key} style={{ marginBottom: 9 }}>
                    <label className="rd-field-label">{label}</label>
                    <input className="rd-field" style={{ marginBottom: 0 }} value={wording[key] || ''} onChange={(e) => setWording((w) => ({ ...w, [key]: e.target.value }))} />
                  </div>
                ))}
              </div>
            </div>

            <div className="rd-panel">
              <div className="rd-panel-head"><h3>Colors &amp; type</h3></div>
              <div className="rd-panel-body">
                <div className="ds-color-row">
                  {COLOR_FIELDS.map((c) => (
                    <label key={c.key} className="ds-color-swatch-label">
                      <input type="color" value={colors[c.key] || '#000000'} onChange={(e) => setColors((v) => ({ ...v, [c.key]: e.target.value }))} />
                      <span>{c.label}</span>
                    </label>
                  ))}
                </div>
                <label className="rd-field-label" style={{ marginTop: 10 }}>Font pairing</label>
                <select className="rr-select" value={fontPairing} onChange={(e) => setFontPairing(e.target.value)}>
                  {FONT_OPTIONS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                </select>
                <label className="rd-field-label" style={{ marginTop: 8 }}>Flyer text size</label>
                <select className="rr-select" value={flyerTextScale} onChange={(e) => setFlyerTextScale(Number(e.target.value))}>
                  {FLYER_TEXT_SCALES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
            </div>

            <div className="rd-panel">
              <div className="rd-panel-head"><h3>QR &amp; RSVP link</h3></div>
              <div className="rd-panel-body">
                <label className="rd-field-label">Flyer size</label>
                <select className="rr-select" value={flyerSettings.size} onChange={(e) => setFlyerSettings((v) => ({ ...v, size: e.target.value }))}>
                  {FLYER_SIZES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
                <div className="rd-toggle-row" style={{ marginTop: 8 }}><span style={{ fontSize: 12, fontWeight: 600 }}>Show QR code</span>
                  <label className="rd-switch"><input type="checkbox" checked={flyerSettings.qr} onChange={(e) => setFlyerSettings((v) => ({ ...v, qr: e.target.checked }))} /><span className="track" /><span className="knob" /></label>
                </div>
                <div className="rd-toggle-row"><span style={{ fontSize: 12, fontWeight: 600 }}>Show RSVP link text</span>
                  <label className="rd-switch"><input type="checkbox" checked={flyerSettings.rsvpLink} onChange={(e) => setFlyerSettings((v) => ({ ...v, rsvpLink: e.target.checked }))} /><span className="track" /><span className="knob" /></label>
                </div>
                <label className="rd-field-label" style={{ marginTop: 6 }}>QR placement</label>
                <select className="rr-select" value={flyerSettings.qrPosition} onChange={(e) => setFlyerSettings((v) => ({ ...v, qrPosition: e.target.value }))}>
                  {QR_POSITIONS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </div>
            </div>

            <div className="rd-panel">
              <div className="rd-panel-head"><h3>Photo</h3><p>Upload and position your cover photo</p></div>
              <div className="rd-panel-body">
                <input ref={coverFileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(e) => uploadFlyerPhoto(e.target.files?.[0])} />
                <button className="rr-btn secondary" disabled={coverBusy} onClick={() => coverFileRef.current?.click()}><Icon name="upload" size={13} /> {coverBusy ? 'Uploading…' : 'Upload photo'}</button>
                {CROP_SLIDERS.map((s) => (
                  <div key={s.key} style={{ marginTop: 10 }}>
                    <label className="rd-field-label">{s.label}</label>
                    <input type="range" min={s.min} max={s.max} value={imagePosition[s.key]} className="ds-slider" onChange={(e) => setImagePosition((v) => ({ ...v, [s.key]: Number(e.target.value) }))} />
                  </div>
                ))}
              </div>
            </div>

            <button className="rr-btn primary" disabled={designBusy} style={{ width: '100%', justifyContent: 'center' }} onClick={saveFlyerAndPassSettings}>{designBusy ? 'Saving…' : 'Save flyer settings'}</button>
            {/* Also lives in the Preview panel's own copy of this button
                below — duplicated here because on narrower windows the two
                columns stack and the Preview panel (with the only other
                "apply this" action) ends up below the entire settings list,
                easy to miss after a long scroll past 15+ wording fields. */}
            <button className="rr-btn secondary" disabled={renderBusy} style={{ width: '100%', justifyContent: 'center' }} onClick={() => renderFlyer(null, true)}>
              {renderBusy ? 'Rendering…' : 'Render & use as cover'}
            </button>
          </div>

          <div className="ds-flyer-col">
            <div className="rd-panel">
              <div className="rd-panel-head"><h3>Preview</h3><p>{flyerPreviewSupported ? 'Live — the exact file the download buttons produce' : 'Print sizes render as PDF only — download to check'}</p></div>
              <div className="rd-panel-body">
                <div className="ds-flyer-preview">
                  {!flyerPreviewSupported ? (
                    <><Icon name="file" size={26} /><span>No inline preview for {FLYER_SIZES.find((s) => s.id === flyerSettings.size)?.label || flyerSettings.size} — it's a print PDF.</span></>
                  ) : flyerPreviewUrl ? (
                    <img src={flyerPreviewUrl} alt="Live flyer preview" className={`ds-flyer-preview-img${flyerPreviewLoading ? ' loading' : ''}`} />
                  ) : flyerPreviewLoading ? (
                    <span>Rendering preview…</span>
                  ) : flyerPreviewError ? (
                    <span className="ds-flyer-preview-error">{flyerPreviewError}</span>
                  ) : (
                    <><Icon name="image" size={26} /><span>Preview renders after your first edit</span></>
                  )}
                  {flyerPreviewUrl && flyerPreviewLoading && <div className="ds-flyer-preview-spinner">Updating…</div>}
                </div>
                {flyerPreviewUrl && flyerPreviewError && <p className="rd-hint" style={{ marginTop: 6 }}>{flyerPreviewError}</p>}
                <div className="rd-row2" style={{ marginTop: 10 }}>
                  <button className="rr-btn secondary" disabled={renderBusy} style={{ flex: 1, justifyContent: 'center' }} onClick={() => renderFlyer('png', false)}>{renderBusy ? 'Rendering…' : 'Download PNG'}</button>
                  <button className="rr-btn secondary" disabled={renderBusy} style={{ flex: 1, justifyContent: 'center' }} onClick={() => renderFlyer('pdf', false)}>{renderBusy ? 'Rendering…' : 'Download PDF'}</button>
                </div>
                <button className="rr-btn primary" disabled={renderBusy} style={{ width: '100%', justifyContent: 'center', marginTop: 8 }} onClick={() => renderFlyer(null, true)}>{renderBusy ? 'Rendering…' : 'Render & use as cover'}</button>
              </div>
            </div>

            <div className="rd-panel">
              <div className="rd-panel-head"><h3>Recent rendered files</h3></div>
              <div className="rd-panel-body">
                {outputs.map((f) => (
                  <div className="ds-recent-row" key={f.filename}>
                    <Icon name="file" size={13} /><span>{f.filename}</span><span className="rd-rowlink">{(f.format || '').toUpperCase()}</span>
                    <a className="rr-link-btn" href={f.url} target="_blank" rel="noreferrer">Download</a>
                  </div>
                ))}
                {!outputs.length && <p className="rd-rowlink">No files rendered yet.</p>}
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'Event Page' && (
        <div className="rd-wide-grid">
          <div className="rd-panel">
            <div className="rd-panel-head"><h3>Page sections</h3><p>What shows on the live guest-facing event page</p></div>
            <div className="rd-panel-body">
              <label className="rd-field-label">Hero</label>
              <div className="rd-toggle-row"><span style={{ fontSize: 12, fontWeight: 600 }}>Welcome label</span><label className="rd-switch"><input type="checkbox" checked={pageSections.hero.showWelcomeLabel} onChange={(e) => setPageSection('hero', 'showWelcomeLabel', e.target.checked)} /><span className="track" /><span className="knob" /></label></div>
              <div className="rd-toggle-row"><span style={{ fontSize: 12, fontWeight: 600 }}>Event title</span><label className="rd-switch"><input type="checkbox" checked={pageSections.hero.showTitle} onChange={(e) => setPageSection('hero', 'showTitle', e.target.checked)} /><span className="track" /><span className="knob" /></label></div>
              <div className="rd-toggle-row"><span style={{ fontSize: 12, fontWeight: 600 }}>Host name</span><label className="rd-switch"><input type="checkbox" checked={pageSections.hero.showHost} onChange={(e) => setPageSection('hero', 'showHost', e.target.checked)} /><span className="track" /><span className="knob" /></label></div>
              <div style={{ marginTop: 10 }}>
                <label className="rd-field-label">Photo overlay darkness ({pageSections.hero.overlayOpacity ?? 55}%)</label>
                <input type="range" min={0} max={90} value={pageSections.hero.overlayOpacity ?? 55} className="ds-slider" onChange={(e) => setPageSection('hero', 'overlayOpacity', Number(e.target.value))} />
                <p className="rd-hint" style={{ marginTop: 4 }}>The dark panel behind your hero title/RSVP button — lower it to show more of your cover photo, raise it if the text is hard to read.</p>
              </div>
              <div style={{ marginTop: 10 }}>
                <label className="rd-field-label">Photo horizontal position ({pageSections.hero.focusX ?? 50}%)</label>
                <input type="range" min={0} max={100} value={pageSections.hero.focusX ?? 50} className="ds-slider" onChange={(e) => setPageSection('hero', 'focusX', Number(e.target.value))} />
              </div>
              <div style={{ marginTop: 10 }}>
                <label className="rd-field-label">Photo vertical position ({pageSections.hero.focusY ?? 20}%)</label>
                <input type="range" min={0} max={100} value={pageSections.hero.focusY ?? 20} className="ds-slider" onChange={(e) => setPageSection('hero', 'focusY', Number(e.target.value))} />
                <p className="rd-hint" style={{ marginTop: 4 }}>Your cover photo fills the hero banner edge-to-edge and crops to fit — these move which part of the photo stays in frame (e.g. lower the vertical value to keep faces higher up in frame).</p>
              </div>

              <label className="rd-field-label" style={{ marginTop: 12 }}>Organizer</label>
              <div className="rd-toggle-row"><span style={{ fontSize: 12, fontWeight: 600 }}>Show organizer line</span><label className="rd-switch"><input type="checkbox" checked={pageSections.organizer.show} onChange={(e) => setPageSection('organizer', 'show', e.target.checked)} /><span className="track" /><span className="knob" /></label></div>
              <input className="rd-field" placeholder="Label, e.g. Organized by" value={pageSections.organizer.label} onChange={(e) => setPageSection('organizer', 'label', e.target.value)} />

              <label className="rd-field-label" style={{ marginTop: 12 }}>Event details</label>
              <div className="rd-toggle-row"><span style={{ fontSize: 12, fontWeight: 600 }}>Venue</span><label className="rd-switch"><input type="checkbox" checked={pageSections.details.showVenue} onChange={(e) => setPageSection('details', 'showVenue', e.target.checked)} /><span className="track" /><span className="knob" /></label></div>
              <div className="rd-toggle-row"><span style={{ fontSize: 12, fontWeight: 600 }}>Hotel info</span><label className="rd-switch"><input type="checkbox" checked={pageSections.details.showHotel} onChange={(e) => setPageSection('details', 'showHotel', e.target.checked)} /><span className="track" /><span className="knob" /></label></div>
              <div className="rd-toggle-row"><span style={{ fontSize: 12, fontWeight: 600 }}>Host</span><label className="rd-switch"><input type="checkbox" checked={pageSections.details.showHost} onChange={(e) => setPageSection('details', 'showHost', e.target.checked)} /><span className="track" /><span className="knob" /></label></div>
              <div className="rd-toggle-row"><span style={{ fontSize: 12, fontWeight: 600 }}>Admission note</span><label className="rd-switch"><input type="checkbox" checked={pageSections.details.showAdmission} onChange={(e) => setPageSection('details', 'showAdmission', e.target.checked)} /><span className="track" /><span className="knob" /></label></div>

              <label className="rd-field-label" style={{ marginTop: 12 }}>About / custom CTA</label>
              <div className="rd-toggle-row"><span style={{ fontSize: 12, fontWeight: 600 }}>Show About section</span><label className="rd-switch"><input type="checkbox" checked={pageSections.about.show} onChange={(e) => setPageSection('about', 'show', e.target.checked)} /><span className="track" /><span className="knob" /></label></div>
              <input className="rd-field" placeholder="CTA label, e.g. Learn more" value={pageSections.about.ctaLabel} onChange={(e) => setPageSection('about', 'ctaLabel', e.target.value)} />
              <input className="rd-field" placeholder="CTA URL" value={pageSections.about.ctaUrl} onChange={(e) => setPageSection('about', 'ctaUrl', e.target.value)} />

              <div className="rd-hint" style={{ marginTop: 10 }}>Seating preview and FestioHub live feed are not part of the live guest page yet — no controls here affect them.</div>

              <div className="rd-row2" style={{ marginTop: 8 }}>
                <button className="rr-btn secondary" disabled={designBusy} style={{ flex: 1, justifyContent: 'center' }} onClick={resetPageSettings}>Reset safe default</button>
                <button className="rr-btn primary" disabled={designBusy} style={{ flex: 1, justifyContent: 'center' }} onClick={() => savePageSettings()}>{designBusy ? 'Saving…' : 'Save page settings'}</button>
              </div>
              <button className="rr-link-btn" onClick={openDraftPreview} style={{ marginTop: 8 }}>Open in a full tab <Icon name="external" size={12} /></button>
            </div>
          </div>

          <div className="rd-panel">
            <div className="rd-panel-head ds-preview-head">
              <div><h3>Live preview</h3><p>The real event page, rendered with your unsaved edits</p></div>
              <div className="rd-seg"><button className={!mobilePreview ? 'on' : ''} onClick={() => setMobilePreview(false)}>Desktop</button><button className={mobilePreview ? 'on' : ''} onClick={() => setMobilePreview(true)}>Mobile</button></div>
            </div>
            <div className="rd-panel-body">
              {!eventId ? (
                <div className="ds-page-preview"><Icon name="calendar" size={20} /><span>Select an event to preview the live page.</span></div>
              ) : (
                <div className={`ds-page-preview-frame-wrap ${mobilePreview ? 'mobile' : ''}`}>
                  <iframe
                    key={eventId}
                    src={eventPagePreviewNonce > 0 ? `/invite/${eventId}?studio-preview=1&_p=${eventPagePreviewNonce}` : undefined}
                    title="Live event page preview"
                    className="ds-page-preview-frame"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'Festio Pass' && (
        <div className="rd-wide-grid">
          <div className="rd-panel">
            <div className="rd-panel-head"><h3>Pass wording</h3></div>
            <div className="rd-panel-body">
              <label className="rd-field-label">Admission wording</label>
              <textarea className="rr-textarea" rows={2} value={wording.admissionNote || ''} onChange={(e) => setWording((w) => ({ ...w, admissionNote: e.target.value }))} />
              <label className="rd-field-label" style={{ marginTop: 8 }}>Footer note</label>
              <input className="rd-field" value={wording.footerNote || ''} onChange={(e) => setWording((w) => ({ ...w, footerNote: e.target.value }))} />
              <label className="rd-field-label">FestioHub intro</label>
              <textarea className="rr-textarea" rows={2} value={wording.customMessage || ''} placeholder="Welcome! Tap below to see updates, your table, and more." onChange={(e) => setWording((value) => ({ ...value, customMessage: e.target.value }))} />
              <div className="rd-toggle-row" style={{ marginTop: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>Show table/seat</span>
                <label className="rd-switch"><input type="checkbox" checked={passOptions.showTable && passOptions.showSeat} onChange={(e) => setPassOptions((v) => ({ ...v, showTable: e.target.checked, showSeat: e.target.checked }))} /><span className="track" /><span className="knob" /></label>
              </div>
              <div className="rd-toggle-row">
                <span style={{ fontSize: 12, fontWeight: 600 }}>Show FestioHub button</span>
                <label className="rd-switch"><input type="checkbox" checked={passOptions.showHubButton} onChange={(e) => setPassOptions((v) => ({ ...v, showHubButton: e.target.checked }))} /><span className="track" /><span className="knob" /></label>
              </div>
              <button className="rr-btn primary" disabled={designBusy} style={{ width: '100%', justifyContent: 'center', marginTop: 12 }} onClick={saveFlyerAndPassSettings}>{designBusy ? 'Saving…' : 'Save pass settings'}</button>
            </div>
          </div>
          <div className="rd-panel">
            <div className="rd-panel-head"><h3>Preview</h3><p>Sample guest — your real colors, wording, and photo</p></div>
            <div className="rd-panel-body">
              <div className="ds-pass-card">
                <div className="ds-pass-card-cover" style={{ backgroundImage: design?.asset_config?.cover_image_url ? `url(${design.asset_config.cover_image_url})` : `linear-gradient(135deg, ${colors.background}, ${colors.accent})` }} />
                <div className="ds-pass-card-body">
                  <div className="ds-pass-card-kicker">Festio Pass</div>
                  <strong>{wording.eventTitle || 'Your event'}</strong>
                  <span>{[wording.date, wording.time].filter(Boolean).join(' · ') || 'Date and time not set yet'}</span>
                  {(passOptions.showTable || passOptions.showSeat) && (
                    <div className="ds-pass-card-pill">{[passOptions.showTable && 'Table VIP-2', passOptions.showSeat && 'Seat 4'].filter(Boolean).join(' · ')}</div>
                  )}
                  <div className="ds-pass-qr-block">
                    <div className="ds-pass-qr-grid">
                      {QR_SAMPLE_PATTERN.map((on, i) => <span key={i} className={on ? 'on' : ''} />)}
                    </div>
                  </div>
                  {wording.admissionNote && <p className="ds-pass-card-note">{wording.admissionNote}</p>}
                  {passOptions.showHubButton && <span className="ds-pass-card-cta" style={{ background: colors.accent }}>Open FestioHub</span>}
                  {wording.footerNote && <p className="ds-pass-card-footer">{wording.footerNote}</p>}
                </div>
              </div>
              <div className="rd-hint" style={{ marginTop: 12 }}>QR pattern shown is illustrative — each guest's real pass carries their own unique, unforgeable token. Everything else here is your actual saved wording, colors, and photo.</div>
            </div>
          </div>
        </div>
      )}

      {tab === 'GuestHub' && (
        <div className="rd-wide-grid">
          <div className="rd-panel">
            <div className="rd-panel-head"><h3>GuestHub templates</h3><p>One look for the whole guest experience — RSVP page and FestioHub together</p></div>
            <div className="rd-panel-body">
              <div className="ds-gh-grid">
                {HUB_STYLES.filter((s) => s.colorPreset).map((s) => {
                  const font = GUESTHUB_FONT_CSS[s.fontSuggestion] || GUESTHUB_FONT_CSS['modern-sans']
                  return (
                    <div key={s.id} className={`ds-gh-card ${hubStyle === s.id ? 'selected' : ''}`}>
                      <GuestHubSwatch s={s} font={font} />
                      <div className="ds-hub-card-meta">
                        <div className="ds-hub-card-top">
                          <strong>{s.name}</strong>
                          <span className={`ds-hub-cat-badge cat-${s.category.toLowerCase()}`}>{s.category}</span>
                        </div>
                        <span className="ds-hub-tagline">{s.tagline}</span>
                        <p className="ds-hub-bestfor">{s.bestFor}</p>
                      </div>
                      <button
                        className={`rr-btn ${hubStyle === s.id ? 'secondary' : 'primary'}`}
                        disabled={hubStyleBusy}
                        style={{ width: '100%', justifyContent: 'center' }}
                        onClick={async () => { await selectHubStyle(s.id); await applyHubColorPreset(s.id) }}
                      >
                        {hubStyle === s.id ? '✓ Applied' : 'Use this template'}
                      </button>
                    </div>
                  )
                })}
              </div>
              <div className="rd-hint" style={{ marginTop: 14 }}>
                Applies colors, font, and FestioHub's arrangement together across your RSVP page and FestioHub card. Fine-tune any one of them afterward in Flyer / Event Page / FestioHub without losing the others.
              </div>
            </div>
          </div>
          <div className="rd-panel">
            <div className="rd-panel-head ds-preview-head">
              <div><h3>Live preview</h3><p>The real guest page, top to bottom, with the selected template</p></div>
              <div className="rd-seg"><button className={!mobilePreview ? 'on' : ''} onClick={() => setMobilePreview(false)}>Desktop</button><button className={mobilePreview ? 'on' : ''} onClick={() => setMobilePreview(true)}>Mobile</button></div>
            </div>
            <div className="rd-panel-body">
              {!eventId ? (
                <div className="ds-page-preview"><Icon name="calendar" size={20} /><span>Select an event to preview GuestHub.</span></div>
              ) : (
                <div className={`ds-page-preview-frame-wrap ${mobilePreview ? 'mobile' : ''}`}>
                  <iframe
                    key={eventId}
                    src={eventPagePreviewNonce > 0 ? `/invite/${eventId}?studio-preview=1&_p=${eventPagePreviewNonce}` : undefined}
                    title="Live GuestHub preview"
                    className="ds-page-preview-frame"
                  />
                </div>
              )}
              <button className="rr-link-btn" onClick={() => openDraftPreview()} style={{ marginTop: 8 }}>Open in a full tab <Icon name="external" size={12} /></button>
            </div>
          </div>
        </div>
      )}

      {tab === 'FestioHub' && (
        <div className="rd-wide-grid">
          <div className="rd-panel">
            <div className="rd-panel-head"><h3>Hub style</h3><p>Choose a layout and visual theme — guests see this after they RSVP</p></div>
            <div className="rd-panel-body">
              <div className="ds-hub-cats">
                {HUB_STYLE_CATEGORIES.map((cat) => (
                  <button key={cat} className={`ds-hub-cat-pill ${hubCategory === cat ? 'active' : ''}`} onClick={() => setHubCategory(cat)}>{cat}</button>
                ))}
              </div>
              <div className="ds-hub-grid">
                {HUB_STYLES
                  .filter((s) => hubCategory === 'All' || s.category === hubCategory)
                  .map((s) => (
                  <div key={s.id} className={`ds-hub-card ${hubStyle === s.id ? 'selected' : ''} ${s.colorPreset ? 'themed' : ''}`}>
                    <div
                      className={`ds-hub-swatch ds-hub-swatch-${s.id}`}
                      style={s.colorPreset ? { background: `linear-gradient(135deg, ${s.colorPreset.background} 0%, ${s.colorPreset.surface} 55%, ${s.colorPreset.accent}66 100%)` } : undefined}
                    >
                      {s.id === 'wallet-pass' && (<><span className="hs-pass"/><span className="hs-tabs"><i/><i/><i/><i/></span></>)}
                      {s.id === 'card-dashboard' && (<><span className="hs-row"/><span className="hs-row"/><span className="hs-row"/></>)}
                      {s.id === 'story-feed' && (<><span className="hs-circles"><i/><i/><i/></span><span className="hs-row wide"/></>)}
                      {s.id === 'timeline' && (<><span className="hs-tl"><i/><i/><i/></span></>)}
                      {s.id === 'minimal-list' && (<><span className="hs-line"/><span className="hs-line"/><span className="hs-line"/><span className="hs-line"/></>)}
                      {s.colorPreset && (
                        <div className="ds-hub-swatches">
                          {Object.values(s.colorPreset).map((hex, i) => (
                            <span key={i} className="ds-hub-dot" style={{ background: hex }} />
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="ds-hub-card-meta">
                      <div className="ds-hub-card-top">
                        <strong>{s.name}</strong>
                        <span className={`ds-hub-cat-badge cat-${s.category.toLowerCase()}`}>{s.category}</span>
                      </div>
                      <span className="ds-hub-tagline">{s.tagline}</span>
                      <p className="ds-hub-bestfor">{s.bestFor}</p>
                    </div>
                    <div className="ds-hub-card-actions">
                      <button
                        className={`rr-btn ${hubStyle === s.id ? 'secondary' : 'primary'}`}
                        disabled={hubStyleBusy}
                        onClick={() => selectHubStyle(s.id)}
                        style={{ flex: 1, justifyContent: 'center' }}
                      >
                        {hubStyle === s.id ? '✓ Selected' : 'Select'}
                      </button>
                      {s.colorPreset && (
                        <button
                          className="rr-btn secondary ds-hub-palette-btn"
                          disabled={hubStyleBusy}
                          title={`Apply ${s.name} color palette and font`}
                          onClick={async () => { await selectHubStyle(s.id); await applyHubColorPreset(s.id) }}
                        >
                          Apply palette
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="rd-hint" style={{ marginTop: 14 }}>
                <strong>Select</strong> saves the layout and visual style. <strong>Apply palette</strong> also sets your event's colors and font to match — fine-tune them in Flyer / Event Page afterward.
              </div>
            </div>
          </div>
          <div className="rd-panel">
            <div className="rd-panel-head ds-preview-head">
              <div><h3>Live preview</h3><p>The real FestioHub, with sample guest data and the selected style</p></div>
              <div className="rd-seg"><button className={!mobilePreview ? 'on' : ''} onClick={() => setMobilePreview(false)}>Desktop</button><button className={mobilePreview ? 'on' : ''} onClick={() => setMobilePreview(true)}>Mobile</button></div>
            </div>
            <div className="rd-panel-body">
              {!eventId ? (
                <div className="ds-page-preview"><Icon name="calendar" size={20} /><span>Select an event to preview FestioHub.</span></div>
              ) : (
                <div className={`ds-page-preview-frame-wrap ${mobilePreview ? 'mobile' : ''}`}>
                  <iframe
                    key={eventId}
                    src={eventPagePreviewNonce > 0 ? `/invite/${eventId}?studio-preview=1&_p=${eventPagePreviewNonce}#guest-hub` : undefined}
                    title="Live FestioHub preview"
                    className="ds-page-preview-frame"
                  />
                </div>
              )}
              <button className="rr-link-btn" onClick={() => openDraftPreview('#guest-hub')} style={{ marginTop: 8 }}>Open in a full tab <Icon name="external" size={12} /></button>
            </div>
          </div>
        </div>
      )}

      {tab === 'Email Preview' && (
        <div className="rd-panel" style={{ maxWidth: 680 }}>
          <div className="rd-panel-head"><h3>Email preview</h3><p>Your real saved wording, colors, and photo — layout is representative, actual delivery uses your provider's rendering</p></div>
          <div className="rd-panel-body">
            <div className="rd-seg" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
              {EMAIL_TYPES.map((t) => <button key={t} className={emailType === t ? 'on' : ''} onClick={() => setEmailType(t)}>{t}</button>)}
            </div>
            <div className="ds-email-card">
              <div className="ds-email-card-banner" style={{ background: colors.primary, color: '#fff' }}>
                <div className="ds-email-card-brand"><strong>Festio</strong><span>Digital Invitation</span></div>
                <h3>{emailType === 'Invitation' ? `${wording.inviteLabel || "You're invited"}: ${wording.eventTitle || 'your event'}` : emailType === 'RSVP confirmation' ? "You're confirmed!" : emailType === 'Festio Pass email' ? 'Your Festio Pass is ready' : emailType === 'Reminder' ? `Don't forget — ${wording.eventTitle || 'your event'}` : emailType === 'Broadcast' ? 'An update from your organizer' : "You're checked in!"}</h3>
              </div>
              {design?.asset_config?.cover_image_url && <img src={design.asset_config.cover_image_url} alt="" className="ds-email-card-cover" />}
              <div className="ds-email-card-body">
                <p className="ds-email-card-greeting">Hi there,</p>
                {wording.customMessage && <p className="ds-email-card-message">{wording.customMessage}</p>}
                <div className="ds-email-card-details">
                  {wording.date && <div><strong>Date:</strong> {wording.date}</div>}
                  {wording.time && <div><strong>Time:</strong> {wording.time}</div>}
                  {wording.venue && <div><strong>Venue:</strong> {wording.venue}</div>}
                  {!wording.date && !wording.time && !wording.venue && <div className="rd-rowlink">Date, time, and venue not set yet</div>}
                </div>
                {/* Illustrative CTA, not a real button — a <span> styled to match so it never looks clickable when it isn't. */}
                <span className="ds-email-cta" style={{ background: colors.primary }}>{emailType === 'RSVP confirmation' || emailType === 'Check-in confirmation' ? 'View details' : emailType === 'Festio Pass email' ? 'View my Festio Pass' : 'RSVP now'}</span>
                <p className="ds-email-card-footer">This link is unique to each guest. Please don't share it.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'Publish' && (
        <div className="rd-wide-grid">
          <div className="rd-panel">
            <div className="rd-panel-head"><h3>Publish checklist</h3><p>{publishDone} of {publishChecklist.length} confirmed</p></div>
            <div className="rd-panel-body">
              <div className="ds-checklist">
                {publishChecklist.map((c) => (
                  <div className={`ds-check-row ${c.done ? 'done' : ''}`} key={c.label}>
                    <span className="ds-check-dot">{c.done && <Icon name="check" size={11} />}</span>
                    {c.label}
                  </div>
                ))}
              </div>
              <div className="ds-publish-status">
                <span className={`rd-status-chip ${design?.is_published ? 'ok' : 'warn'}`}>{design?.is_published ? 'Published' : 'Draft'}</span>
                {' '}{design?.updated_at ? `Saved ${new Date(design.updated_at).toLocaleString()}` : 'Not saved yet'}
                {design?.published_version ? ` · Published version ${design.published_version}` : ' · Never published'}
              </div>
              <button disabled={!eventId || designBusy || publishState === 'publishing'} className="rr-btn primary" style={{ width: '100%', justifyContent: 'center', marginTop: 14 }} onClick={() => setPublishState('confirm')}>
                {publishState === 'publishing' ? 'Publishing…' : design?.is_published ? 'Publish new version' : 'Publish design'}
              </button>
              {publishState === 'confirm' && (
                <Modal title="Publish this design?" onClose={() => setPublishState('idle')} width={400}>
                  <p style={{ marginBottom: 16 }}>This saves the current design as a new live version for guest-facing event pages and emails.</p>
                  <div className="rd-row2">
                    <button className="rr-btn secondary" onClick={() => setPublishState('idle')}>Cancel</button>
                    <button className="rr-btn primary" onClick={publishDesign}>Confirm publish</button>
                  </div>
                </Modal>
              )}
              {publishState === 'success' && (
                <div className="rd-banner-ok" style={{ marginTop: 10 }}>
                  <Icon name="check" /> Design published as version {design?.published_version}. <button className="rr-link-btn" style={{ marginLeft: 8 }} onClick={() => setPublishState('idle')}>Dismiss</button>
                </div>
              )}
              {publishState === 'error' && (
                <div className="rd-banner-err" style={{ marginTop: 10 }}>
                  <Icon name="warning" /> {publishError} <button className="rr-link-btn" style={{ marginLeft: 8 }} onClick={() => setPublishState('confirm')}>Retry</button>
                  <button className="rr-link-btn" style={{ marginLeft: 8 }} onClick={() => setPublishState('idle')}>Dismiss</button>
                </div>
              )}
              <p className="rd-hint" style={{ marginTop: 8 }}>Rollback is unavailable because the Design service has no rollback API. Publish a corrected version instead.</p>
              <p className="ds-gate-hint">Publishing requires an Event Pass. <a href="/billing-redesign">Upgrade to publish →</a></p>
            </div>
          </div>
          <div className="rd-panel">
            <div className="rd-panel-head"><h3>{activeTemplate?.name}</h3><p>{activeTemplate?.category} · {activeTemplate?.style}</p></div>
            <div className="rd-panel-body">
              <div className="ds-color-row" style={{ marginBottom: 12 }}>
                {COLOR_FIELDS.map((f) => <Swatch key={f.key} hex={colors[f.key]} />)}
              </div>
              <div className="ds-page-preview" style={{ marginBottom: 10 }}>
                <div className="ds-page-hero"><Icon name="calendar" size={18} /></div>
                <h3 style={{ fontSize: 13 }}>{wording.eventTitle || 'Your event'}</h3>
              </div>
              <div className="ds-pass-preview" style={{ padding: 12 }}>
                <div className="ds-pass-top"><span>FESTIO PASS</span></div>
                <strong style={{ fontSize: 12 }}>Preview</strong>
              </div>
              <div className="rd-hint" style={{ marginTop: 10 }}>{outputs.length} rendered output{outputs.length === 1 ? '' : 's'} available</div>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="rd-toast"><Icon name="check" />{toast}</div>}
    </RedesignShell>
  )
}
