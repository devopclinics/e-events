import { Link } from 'react-router-dom'

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <div className="max-w-2xl mx-auto px-4 py-12 prose dark:prose-invert">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Terms of Service</h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">Last updated: June 2026</p>

        <div className="space-y-4 text-sm text-slate-700 dark:text-slate-300 mt-4">
          <p>
            These terms govern your use of Festio, an event invitation, RSVP and check-in platform
            operated by <strong>FOHMA Solutions LLC</strong> (“Festio”, “we”, “us”). By creating an
            account or using the service you agree to them.
          </p>

          <h2 className="font-semibold text-slate-900 dark:text-white">The service</h2>
          <p>
            Festio lets event organizers manage guest lists, send invitations and QR tickets,
            collect RSVPs, assign seating, and check guests in. Some features require a paid Event
            Pass.
          </p>

          <h2 className="font-semibold text-slate-900 dark:text-white">Accounts</h2>
          <p>
            You are responsible for your account, your team members’ access, and the accuracy of the
            event and guest data you upload.
          </p>

          <h2 className="font-semibold text-slate-900 dark:text-white">Guest data &amp; messaging consent</h2>
          <p>
            As an organizer, you confirm that you have a lawful basis and the necessary consent to
            add each guest’s contact details and to send them event communications by email, SMS, or
            WhatsApp. You will not use Festio to send unsolicited, marketing, or unlawful messages.
            Guests can opt out of SMS at any time by replying STOP, and we honor opt-outs on every
            message.
          </p>

          <h2 className="font-semibold text-slate-900 dark:text-white">Acceptable use</h2>
          <p>
            Do not use Festio to violate any law, infringe others’ rights, send spam, or attempt to
            disrupt the service. We may suspend accounts that do.
          </p>

          <h2 className="font-semibold text-slate-900 dark:text-white">Payments &amp; refunds</h2>
          <p>
            Event Passes and message-credit top-ups are billed per event. Refunds are handled under
            our{' '}
            <Link to="/refund-policy" className="text-teal-600 hover:underline">Refund Policy</Link>.
          </p>

          <h2 className="font-semibold text-slate-900 dark:text-white">Disclaimer &amp; liability</h2>
          <p>
            The service is provided “as is.” To the extent permitted by law, Festio is not liable for
            indirect or consequential damages, and our total liability is limited to the amounts you
            paid for the event in question.
          </p>

          <h2 className="font-semibold text-slate-900 dark:text-white">Changes &amp; contact</h2>
          <p>
            We may update these terms; continued use means you accept the changes. Questions:{' '}
            <a href="mailto:info@devopclinics.com" className="text-teal-600 hover:underline">info@devopclinics.com</a>.
          </p>
        </div>

        <p className="mt-8 text-sm">
          <Link to="/" className="text-teal-600 hover:underline">← Back to Festio</Link>
          {' · '}
          <Link to="/privacy" className="text-teal-600 hover:underline">Privacy Policy</Link>
        </p>
      </div>
    </div>
  )
}
