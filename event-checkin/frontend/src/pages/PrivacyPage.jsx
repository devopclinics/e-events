import { Link } from 'react-router-dom'

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <div className="max-w-2xl mx-auto px-4 py-12 prose dark:prose-invert">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Privacy Policy</h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">Last updated: June 2026</p>

        <div className="space-y-4 text-sm text-slate-700 dark:text-slate-300 mt-4">
          <p>
            Festio, operated by <strong>FOHMA Solutions LLC</strong>, provides an event
            invitation, RSVP and check-in platform. This policy explains what we collect and
            how we use it.
          </p>

          <h2 className="font-semibold text-slate-900 dark:text-white">Information we collect</h2>
          <p>
            <strong>Organizers (our customers):</strong> name, email, and account details.
            <br />
            <strong>Guests:</strong> the name, email, mobile phone number, RSVP responses, and
            seating/ticket details that an event organizer adds, or that a guest submits via an
            event’s RSVP page.
          </p>

          <h2 className="font-semibold text-slate-900 dark:text-white">How we use it</h2>
          <p>
            To run the event: deliver invitations and QR passes, collect RSVPs, assign seating,
            and confirm check-in. We use email, SMS, and WhatsApp to send these event
            notifications to guests.
          </p>

          <h2 className="font-semibold text-slate-900 dark:text-white">SMS / text messaging</h2>
          <p>
            If a guest provides a mobile number and consents, we send transactional event SMS — an
            invitation/ticket link and a check-in confirmation (and occasionally a seat update) for
            the specific event they were invited to. Message frequency varies by event. Message and
            data rates may apply. Reply <strong>STOP</strong> to opt out at any time, or
            <strong> HELP</strong> for help; guests can also turn SMS off on their ticket page.
            See our{' '}
            <Link to="/sms-policy" className="text-teal-600 hover:underline">SMS Opt-In and Messaging Terms</Link>.
          </p>
          <p>
            <strong>
              We do not sell, rent, or share guests’ mobile phone numbers or SMS opt-in/consent data
              with third parties or affiliates for their marketing or promotional purposes.
            </strong>{' '}
            Phone numbers are used only to deliver the event notifications described above. We share
            data with service providers (for example, our SMS and email delivery vendors) solely to
            operate the service on our behalf.
          </p>

          <h2 className="font-semibold text-slate-900 dark:text-white">Data sharing</h2>
          <p>
            Guest data is shared with the event organizer who invited them, and with
            infrastructure/messaging providers strictly to deliver the service. We do not sell
            personal data.
          </p>

          <h2 className="font-semibold text-slate-900 dark:text-white">Retention &amp; your choices</h2>
          <p>
            Organizers control their event data and may export or delete it. Guests can opt out of
            SMS by replying STOP, and can request access or removal of their data by contacting the
            event organizer or us.
          </p>

          <h2 className="font-semibold text-slate-900 dark:text-white">Contact</h2>
          <p>
            Questions about this policy:{' '}
            <a href="mailto:events@festio.events" className="text-teal-600 hover:underline">events@festio.events</a>.
          </p>
          <p>
            Festio is operated by <strong>FOHMA Solutions LLC</strong>.
          </p>
        </div>

        <p className="mt-8 text-sm">
          <Link to="/" className="text-teal-600 hover:underline">← Back to Festio</Link>
          {' · '}
          <Link to="/terms" className="text-teal-600 hover:underline">Terms of Service</Link>
          {' · '}
          <Link to="/sms-policy" className="text-teal-600 hover:underline">SMS Terms</Link>
        </p>
      </div>
    </div>
  )
}
