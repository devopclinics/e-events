import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const PDFS = [
  {
    title: 'Festio Introductory Guide',
    description: 'Short product introduction covering setup, invites, RSVP, check-in, results, and paid operations.',
    href: '/media/eventqr-intro-target-audience.pdf',
    filename: 'eventqr-intro-target-audience.pdf',
    type: 'PDF',
  },
  {
    title: 'Festio One-Pager',
    description: 'Compact sales handout for quick sharing. ⚠ Stale: no source file in the repo to regenerate — needs an external redesign pass to reflect current branding and features.',
    href: '/media/eventqr-onepager.pdf',
    filename: 'eventqr-onepager.pdf',
    type: 'PDF',
  },
  {
    title: 'Festio Pitch Deck',
    description: 'Longer investor/product pitch deck. ⚠ Stale: no source file in the repo to regenerate — needs an external redesign pass to reflect current branding and features.',
    href: '/media/eventqr-pitch.pdf',
    filename: 'eventqr-pitch.pdf',
    type: 'PDF',
  },
]

const HTML_ASSETS = [
  {
    title: 'Getting Started Tour',
    description: 'Interactive browser-based tour for prospects and new organizers.',
    href: '/media/getting-started.html',
    filename: 'getting-started.html',
    type: 'HTML',
  },
  {
    title: 'Pitch Deck HTML',
    description: 'Editable HTML source for the target-audience pitch deck. ⚠ Stale: still says "EventQR" and links the old domain throughout — deliberately deferred during the June 2026 rebrand pending a content review (investor-facing, not just a brand string).',
    href: '/media/eventqr-pitch-v3-target-audience.html',
    filename: 'eventqr-pitch-v3-target-audience.html',
    type: 'HTML',
  },
  {
    title: "Women's Convention Experience Proposal",
    description: "Organizer-facing proposal deck for using Festio Experience at Masjid Mumineen Women's Convention 2026.",
    href: '/media/womens-convention-experience-proposal.html',
    filename: 'womens-convention-experience-proposal.html',
    type: 'HTML',
  },
]

// Refreshed 2026-07-15 against the live 2.0.69 app — includes features that
// shipped after the July-14 set (per-field RSVP requirements, invitation
// categories & auto-seating, multi-day display-only menus, FestioHub).
// SAME filenames as guideContent.mjs (Help guide) reuse this exact set, so
// keeping this list current keeps the in-app guide current too.
const SCREENSHOTS = [
  ['Event setup', '/media/help2-event-setup.png'],
  ['Guests', '/media/help2-guests.png'],
  ['Invites and RSVP', '/media/help2-invites-rsvp.png'],
  ['RSVP form fields (per-field required/optional)', '/media/help2-rsvp-fields.png'],
  ['Invitation categories & auto-seating', '/media/help2-categories.png'],
  ['Seating', '/media/help2-seating.png'],
  ['Orders: multi-day menu (day + display-only)', '/media/help2-menu-fields.png'],
  ['Orders', '/media/help2-orders.png'],
  ['Entry areas', '/media/help2-entry-areas.png'],
  ['Team', '/media/help2-team.png'],
  ['Check-in', '/media/help2-checkin.png'],
  ['Results', '/media/help2-results.png'],
  ['Event Pass', '/media/help2-event-pass.png'],
  ['Guest invite (RSVP page)', '/media/help2-guest-invite.png'],
  ['Festio Pass — ticket with day-tabbed menu', '/media/help2-festio-pass.png'],
  ['FestioHub — Live Program, activity, food menu', '/media/help2-festiohub.png'],
  ['Deliveries', '/media/help2-deliveries.png'],
  ['Gift list', '/media/help2-gift-list.png'],
].map(([title, href]) => ({
  title,
  href,
  filename: href.split('/').pop(),
  type: 'PNG',
}))

function DownloadIcon({ className = '' }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" />
    </svg>
  )
}

function ExternalIcon({ className = '' }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M7 17L17 7m0 0H9m8 0v8" />
    </svg>
  )
}

function AssetCard({ asset }) {
  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-teal-700 dark:text-teal-300">{asset.type}</div>
          <h3 className="mt-1 font-semibold text-slate-950 dark:text-white">{asset.title}</h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{asset.description}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <a href={asset.href} target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700">
          <ExternalIcon className="h-4 w-4" />
          Open
        </a>
        <a href={asset.href} download={asset.filename}
          className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-700">
          <DownloadIcon className="h-4 w-4" />
          Download
        </a>
      </div>
    </div>
  )
}

function ScreenshotCard({ asset }) {
  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden shadow-sm">
      <a href={asset.href} target="_blank" rel="noreferrer" className="block bg-slate-100 dark:bg-slate-900">
        <img src={asset.href} alt={asset.title} loading="lazy" className="h-40 w-full object-cover object-top" />
      </a>
      <div className="p-3">
        <div className="font-semibold text-sm text-slate-950 dark:text-white">{asset.title}</div>
        <div className="mt-3 flex gap-2">
          <a href={asset.href} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 dark:border-slate-600 px-2.5 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700">
            <ExternalIcon className="h-3.5 w-3.5" />
            Open
          </a>
          <a href={asset.href} download={asset.filename}
            className="inline-flex items-center gap-1 rounded-md bg-teal-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-teal-700">
            <DownloadIcon className="h-3.5 w-3.5" />
            Download
          </a>
        </div>
      </div>
    </div>
  )
}

export default function MediaPage() {
  const { user } = useAuth()
  if (user === undefined) return null
  if (!user?.is_platform_superadmin) return <Navigate to="/" replace />

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-950 dark:text-white">Media Library</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Operator-only links for viewing and downloading Festio PDFs, HTML tours, and product screenshots.
        </p>
        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
          Screenshots and the Introductory Guide PDF last refreshed 2026-07-15 against live 2.0.69.
          The pitch deck and one-pager below still reflect an earlier feature set — see their cards.
        </p>
      </div>

      <section>
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-3">PDF downloads</h2>
        <div className="grid md:grid-cols-3 gap-4">
          {PDFS.map((asset) => <AssetCard key={asset.href} asset={asset} />)}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-3">HTML media</h2>
        <div className="grid md:grid-cols-2 gap-4">
          {HTML_ASSETS.map((asset) => <AssetCard key={asset.href} asset={asset} />)}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-3">Product screenshots</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {SCREENSHOTS.map((asset) => <ScreenshotCard key={asset.href} asset={asset} />)}
        </div>
      </section>
    </div>
  )
}
