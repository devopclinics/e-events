import { Link } from 'react-router-dom'

function Section({ title, children }) {
  return (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 space-y-3">
      <h2 className="text-lg font-bold text-slate-900 dark:text-white">{title}</h2>
      {children}
    </section>
  )
}

function Code({ children }) {
  return (
    <pre className="rounded-xl bg-slate-900 text-slate-100 text-xs p-4 overflow-x-auto leading-relaxed">
      <code>{children}</code>
    </pre>
  )
}

function Endpoint({ method, path, description, example }) {
  const methodColor = method === 'GET'
    ? 'bg-teal-100 dark:bg-teal-900 text-teal-700 dark:text-teal-300'
    : 'bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300'
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-xs font-bold px-2 py-0.5 rounded ${methodColor}`}>{method}</span>
        <code className="text-sm font-semibold text-slate-800 dark:text-slate-200">{path}</code>
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-400">{description}</p>
      {example && <Code>{example}</Code>}
    </div>
  )
}

export default function ApiDocsPage() {
  return (
    <div className="app-shell min-h-screen">
      <div className="max-w-3xl mx-auto px-4 py-10 space-y-6">
        <div>
          <span className="inline-block text-xs font-bold uppercase tracking-wide text-teal-700 dark:text-teal-400 mb-2">
            Public API · v1
          </span>
          <h1 className="text-3xl font-extrabold text-slate-900 dark:text-white">Festio Public API</h1>
          <p className="text-slate-600 dark:text-slate-400 mt-2 leading-relaxed">
            A small, read-only API for integrating your Festio events and guest data with your own tools —
            Zapier, a CRM sync, a custom dashboard, whatever you need. Keys are managed by your organization's
            owner from <Link to="/org-settings" className="text-teal-700 dark:text-teal-400 underline">Org Settings</Link>.
          </p>
        </div>

        <Section title="Authentication">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Every request needs an <code className="bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded text-xs">X-API-Key</code> header.
            Create a key from <strong>Org Settings → API Keys</strong> (you must be the organization's owner) — the
            full key is shown exactly once, at creation. If you lose it, revoke it and create a new one; there's no way
            to view a key again after that first screen.
          </p>
          <Code>{`curl -H "X-API-Key: fk_live_YOUR_KEY" \\
  https://staging.festio.events/api/public/v1/events`}</Code>
        </Section>

        <Section title="How access is secured">
          <ul className="text-sm text-slate-600 dark:text-slate-400 space-y-2 list-disc pl-5">
            <li><strong className="text-slate-800 dark:text-slate-200">Separate from your login.</strong> API keys are a completely different credential from the Firebase session staff use to sign in — a leaked key can't be used to log into the product, and a stolen login session can't call this API.</li>
            <li><strong className="text-slate-800 dark:text-slate-200">Hashed at rest.</strong> We store a SHA-256 hash, never the key itself. Even a database compromise wouldn't expose a usable key.</li>
            <li><strong className="text-slate-800 dark:text-slate-200">Owner-only to create.</strong> Only your organization's owner can mint or revoke keys — enforced on the server, not just hidden in the UI.</li>
            <li><strong className="text-slate-800 dark:text-slate-200">Scoped to your org.</strong> A key can only ever see events and guests belonging to the organization it was created under — never another organization's data, even by guessing an ID.</li>
            <li><strong className="text-slate-800 dark:text-slate-200">Revocation is immediate.</strong> A revoked key is rejected on its very next request — no caching delay.</li>
            <li><strong className="text-slate-800 dark:text-slate-200">Rate limited.</strong> 120 requests/minute per key, so a leaked or misbehaving key can't scrape everything or overload the API.</li>
            <li><strong className="text-slate-800 dark:text-slate-200">Read-only.</strong> There are no write endpoints yet — a compromised key can view data but cannot create, change, or delete anything.</li>
            <li><strong className="text-slate-800 dark:text-slate-200">Audited.</strong> Every request (method, path, status, time) is logged against the key that made it and visible to your org from the API Keys panel.</li>
          </ul>
        </Section>

        <Section title="Rate limits">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            120 requests per minute, per key. Going over returns <code className="bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded text-xs">429</code> with
            a short message — back off and retry after a few seconds.
          </p>
        </Section>

        <Section title="Endpoints">
          <div className="space-y-3">
            <Endpoint
              method="GET" path="/api/public/v1/events"
              description="List every event that belongs to your organization."
              example={`[
  {
    "id": "3ee6cefb-...",
    "name": "Fall Gala",
    "event_date": "2026-09-01T18:00:00",
    "event_end_date": null,
    "timezone": "America/Chicago",
    "status": "active"
  }
]`}
            />
            <Endpoint
              method="GET" path="/api/public/v1/events/{event_id}"
              description="Get one event. 404 if it doesn't exist or belongs to a different organization."
            />
            <Endpoint
              method="GET" path="/api/public/v1/events/{event_id}/guests"
              description="List guests for one of your events."
              example={`[
  {
    "id": "9a1f...",
    "first_name": "Ada",
    "last_name": "Lovelace",
    "email": "ada@example.com",
    "phone": null,
    "rsvp_status": "confirmed",
    "admitted": true,
    "admitted_at": "2026-09-01T19:04:12"
  }
]`}
            />
            <Endpoint
              method="GET" path="/api/public/v1/docs"
              description="This same reference, as JSON — no key required, so you can check the contract before you have one."
            />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-500 mt-2">
            Note: event responses intentionally exclude venue name/address — many events use a private address, and this
            API is meant to be handed to third-party integrations, not just people you've already invited.
          </p>
        </Section>

        <Section title="Outbound webhooks">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Prefer to be notified the moment something happens, instead of polling? Set up a webhook from{' '}
            <Link to="/org-settings" className="text-teal-700 dark:text-teal-400 underline">Org Settings</Link>.
            Available events: <code className="bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded text-xs">guest.created</code>,{' '}
            <code className="bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded text-xs">guest.checked_in</code>,{' '}
            <code className="bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded text-xs">rsvp.confirmed</code>.
            Every delivery is signed — verify it with the secret shown when you create the webhook:
          </p>
          <Code>{`X-Festio-Signature: sha256=<hex>
X-Festio-Event-Type: guest.created

# Verify (Python):
import hmac, hashlib
expected = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
assert hmac.compare_digest(expected, signature_from_header)`}</Code>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Failed deliveries retry with exponential backoff for up to 8 attempts (roughly a day), then stop —
            check the delivery log next to each webhook in Org Settings.
          </p>
        </Section>
      </div>
    </div>
  )
}
