import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

function Section({ title, children }) {
  return (
    <section className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border dark:border-slate-700 p-6 space-y-3">
      <h2 className="text-lg font-bold text-slate-900 dark:text-white">{title}</h2>
      <div className="text-sm text-slate-700 dark:text-slate-300 space-y-2 leading-relaxed">{children}</div>
    </section>
  )
}

const Step = ({ children }) => <li className="ml-1">{children}</li>
const Steps = ({ children }) => <ol className="list-decimal list-inside space-y-1.5">{children}</ol>
const Shot = ({ src, alt }) => (
  <img src={src} alt={alt} className="mt-2 rounded-lg border dark:border-slate-700 w-full max-w-2xl" loading="lazy" />
)

export default function HelpPage() {
  const { user } = useAuth()
  const isSuper = !!user?.is_platform_superadmin
  const isAdmin = user?.role === 'admin'
  const isStaff = !!user && !isAdmin && !isSuper
  const loggedOut = !user

  const showOrganizer = loggedOut || isAdmin || isSuper
  const showStaff = loggedOut || isStaff || isAdmin || isSuper
  const showOperator = isSuper

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Help &amp; How-To</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Quick instructions for your role. {loggedOut && <>Browsing signed out — <Link to="/login" className="text-teal-600 hover:underline">sign in</Link> for organizer/staff tools.</>}
        </p>
      </div>

      {showOrganizer && (
        <Section title="Event organizer">
          <p>Create an event, invite guests, and check them in.</p>
          <Steps>
            <Step><b>Create:</b> Admin → New Event → name, date, details.</Step>
            <Step><b>Guest list:</b> Overview tab → upload CSV/Excel or paste a Google Sheets/OneDrive link (free events: up to 25 guests).</Step>
            <Step><b>RSVP setup:</b> Invite tab → choose <b>Open</b> (shared link) or <b>Closed</b> (unique per-guest links); optional deadline, approval, questions, cover image.</Step>
            <Step><b>Send invites:</b> Open mode → share the event link or use Manual invite. Closed mode → Bulk RSVP invites. (SMS/WhatsApp need an Event Pass; email is always free.)</Step>
            <Step><b>Track:</b> Guests tab shows Attending / Declined / Pending / No-reply and check-in status; approve pending RSVPs if approval is on.</Step>
            <Step><b>Broadcast:</b> Invite tab → message a target group (all, attending, checked-in, etc.).</Step>
            <Step><b>Seating &amp; Menu</b> (paid): enable in Overview → Features, then use the Seating/Menu tabs.</Step>
            <Step><b>Team:</b> Team tab → add a teammate by email (Staff/Admin), then assign staff to the event.</Step>
            <Step><b>Check-in day:</b> set the event Active; you/staff use <Link to="/scanner" className="text-teal-600 hover:underline">Scanner</Link>; watch <Link to="/dashboard" className="text-teal-600 hover:underline">Dashboard</Link>.</Step>
            <Step><b>Upgrade:</b> Invite tab → Event Pass unlocks SMS/WhatsApp, more guests, seating/menu, check-in, and removes branding. See <Link to="/pricing" className="text-teal-600 hover:underline">pricing</Link>.</Step>
          </Steps>
          <Shot src="/guide/pricing.png" alt="Pricing / Event Pass tiers" />
        </Section>
      )}

      {showStaff && (
        <Section title="Staff / scanner">
          <Steps>
            <Step>Sign in with the email your organizer invited.</Step>
            <Step>Open <Link to="/scanner" className="text-teal-600 hover:underline">Scanner</Link> and point your camera at each guest's QR.</Step>
            <Step><b>Welcome</b> = admitted · <b>Already admitted</b> = ticket used · <b>Not assigned / needs pass</b> = ask the organizer.</Step>
            <Step>No app needed — it runs in the browser.</Step>
          </Steps>
        </Section>
      )}

      <Section title="Guests">
        <Steps>
          <Step>Open the invite link from your email/SMS/WhatsApp.</Step>
          <Step>Fill in the RSVP form → <b>Confirm</b> (or <b>Can't make it</b>). On a personal link you can change it until the deadline.</Step>
          <Step>Your <b>ticket QR</b> is emailed once confirmed.</Step>
          <Step>Show the QR (phone or printed) at the entrance.</Step>
        </Steps>
        <Shot src="/guide/invite-page.png" alt="Invite / RSVP page" />
      </Section>

      {showOperator && (
        <Section title="Platform operator">
          <p>Open <Link to="/console" className="text-teal-600 hover:underline">Console</Link> (operators only).</p>
          <Steps>
            <Step><b>Overview:</b> all organizations &amp; events — comp a tier or add message credits to any event.</Step>
            <Step><b>Pricing:</b> edit tiers/credit packs (prices, credits, caps, active) — reflects live on /pricing and checkout.</Step>
            <Step><b>Operators:</b> add/revoke platform operators by email (can't revoke yourself).</Step>
          </Steps>
        </Section>
      )}
    </div>
  )
}
