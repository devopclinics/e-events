import { Link } from 'react-router-dom'

export default function SmsPolicyPage() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <div className="mx-auto max-w-3xl px-4 py-12">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950 sm:p-8">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-teal-600 dark:text-teal-300">Festio messaging</p>
          <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-950 dark:text-white">SMS Opt-In and Messaging Terms</h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Last updated: July 2026</p>

          <div className="mt-8 space-y-6 text-sm leading-6 text-slate-700 dark:text-slate-300">
            <section>
              <h2 className="text-base font-bold text-slate-950 dark:text-white">Who sends messages</h2>
              <p className="mt-2">
                Festio is operated by <strong>FOHMA Solutions LLC</strong>. Event organizers use Festio to send
                event-specific invitations, RSVP links, QR tickets, check-in confirmations, seating updates, session
                reminders, and related guest service notifications.
              </p>
            </section>

            <section>
              <h2 className="text-base font-bold text-slate-950 dark:text-white">How guests opt in</h2>
              <p className="mt-2">
                Mobile opt-in path: a guest opens their Festio RSVP link on a phone, for example
                <strong> https://festio.events/rsvp/&#123;event-token&#125;</strong>, enters or confirms their mobile
                number, checks the SMS/text notifications consent checkbox, and taps the RSVP or submit button. A
                ticket/pass path such as <strong>https://festio.events/scan/&#123;guest-token&#125;</strong> also lets
                guests view or update event messaging preferences. Organizers may add a guest phone number only when
                they already have permission to contact that guest for the event.
              </p>
              <div className="mt-3 rounded-xl border border-teal-200 bg-teal-50 p-4 text-slate-800 dark:border-teal-800 dark:bg-teal-950/30 dark:text-teal-50">
                <p className="font-semibold">Example opt-in statement shown to guests:</p>
                <p className="mt-2">
                  I agree to receive SMS/text messages from Festio for this event, including my invitation or ticket
                  link, QR pass, RSVP updates, check-in confirmation, seating updates, session reminders, and other
                  event-service notifications. Message frequency varies by event. Message and data rates may apply.
                  Reply STOP to opt out at any time or HELP for help. Consent is not required to buy goods or services.
                  View our Privacy Policy at https://festio.events/privacy.
                </p>
              </div>
            </section>

            <section>
              <h2 className="text-base font-bold text-slate-950 dark:text-white">Message frequency and costs</h2>
              <p className="mt-2">
                Message frequency varies by event and guest activity. Most guests receive a low number of transactional
                event messages, such as an invitation or ticket link, event reminders, check-in confirmation, seating
                updates, or session updates. Message and data rates may apply.
              </p>
            </section>

            <section>
              <h2 className="text-base font-bold text-slate-950 dark:text-white">HELP and STOP instructions</h2>
              <p className="mt-2">
                Reply <strong>HELP</strong> for help. HELP responses direct guests to Festio support at
                <a href="mailto:events@festio.events" className="font-semibold text-teal-700 underline dark:text-teal-300"> events@festio.events</a>.
                Reply <strong>STOP</strong> to opt out. After STOP, Festio will stop sending SMS messages to that
                number except messages needed to confirm the opt-out or where legally required.
              </p>
            </section>

            <section>
              <h2 className="text-base font-bold text-slate-950 dark:text-white">Privacy</h2>
              <p className="mt-2">
                We do not sell, rent, or share mobile phone numbers or SMS opt-in consent data with third parties or
                affiliates for their marketing or promotional purposes. Phone numbers are used to deliver the event
                messages described here and to operate Festio with our service providers.
              </p>
              <p className="mt-2">
                Read the full <Link to="/privacy" className="font-semibold text-teal-700 underline dark:text-teal-300">Privacy Policy</Link> and{' '}
                <Link to="/terms" className="font-semibold text-teal-700 underline dark:text-teal-300">Terms of Service</Link>.
              </p>
            </section>

            <section>
              <h2 className="text-base font-bold text-slate-950 dark:text-white">Contact</h2>
              <p className="mt-2">
                Festio by FOHMA Solutions LLC<br />
                <a href="https://festio.events" className="font-semibold text-teal-700 underline dark:text-teal-300">festio.events</a><br />
                <a href="mailto:events@festio.events" className="font-semibold text-teal-700 underline dark:text-teal-300">events@festio.events</a>
              </p>
            </section>
          </div>

          <p className="mt-8 text-sm">
            <Link to="/" className="font-semibold text-teal-700 underline dark:text-teal-300">Back to Festio</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
