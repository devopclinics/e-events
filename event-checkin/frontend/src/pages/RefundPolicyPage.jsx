import { Link } from 'react-router-dom'

export default function RefundPolicyPage() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <div className="max-w-2xl mx-auto px-4 py-12 prose dark:prose-invert">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Refund Policy</h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">Last updated: June 2026</p>

        <div className="space-y-4 text-sm text-slate-700 dark:text-slate-300 mt-4">
          <p>
            Festio sells one-time <strong>Event Passes</strong> and <strong>message-credit
            top-ups</strong> per event. The following applies to those purchases.
          </p>
          <h2 className="font-semibold text-slate-900 dark:text-white">Event Passes</h2>
          <p>
            If you have not yet sent any invitations or checked in any guests for an event,
            you may request a full refund of that event’s pass within <strong>14 days</strong>
            of purchase. Once invitations have been sent or check-in has begun, the pass is
            considered used and is non-refundable.
          </p>
          <h2 className="font-semibold text-slate-900 dark:text-white">Message credits</h2>
          <p>
            Unused message credits are refundable within <strong>14 days</strong> of purchase,
            pro-rated for any credits already consumed. Consumed credits (delivered SMS/WhatsApp
            messages) are non-refundable.
          </p>
          <h2 className="font-semibold text-slate-900 dark:text-white">How to request a refund</h2>
          <p>
            Email <a href="mailto:info@devopclinics.com" className="text-teal-600 hover:underline">info@devopclinics.com</a> from
            the account email used for the purchase, including the event name and approximate
            purchase date. Approved refunds are returned to the original payment method within
            5–10 business days.
          </p>
          <h2 className="font-semibold text-slate-900 dark:text-white">Taxes</h2>
          <p>
            Where applicable, taxes are calculated and shown at checkout and are refunded together
            with any approved refund.
          </p>
        </div>

        <p className="mt-8 text-sm">
          <Link to="/pricing" className="text-teal-600 hover:underline">← Back to pricing</Link>
        </p>
      </div>
    </div>
  )
}
