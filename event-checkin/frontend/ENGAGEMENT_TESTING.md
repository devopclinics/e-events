# Engagement frontend: rollout and local verification

## Scope and safe defaults

These changes do not deploy or enable client messaging. Public sales chat is OFF
unless all of the following build-time settings are explicitly configured:

- `VITE_SALES_CHAT_ENABLED=true` (default OFF).
- `VITE_SALES_CHAT_INBOX_VALIDATED=true` (default OFF; an operator attests that the
  release checks below passed, not merely that the token has valid syntax).
- `VITE_SALES_CHAT_BASE_URL`: a dedicated HTTPS Chatwoot origin, distinct from both
  the Festio app origin and the authenticated support origin.
- `VITE_SALES_CHAT_WEBSITE_TOKEN`: the public website token of a separate sales
  inbox, different from `VITE_CHATWOOT_WEBSITE_TOKEN`.

Do not put agent API tokens, HMAC secrets, or any server credential in VITE
variables. Website tokens are public identifiers, not authentication secrets.
The existing `VITE_CHATWOOT_BASE_URL`, `VITE_CHATWOOT_WEBSITE_TOKEN`, platform
`support_chat_enabled` switch, and signed `/api/support/identify` response remain
necessary for authenticated support. Missing/unsigned identity fails closed.
Support is available on the explicit protected legacy and redesign routes; chat
is never injected into public guest/pass routes.

## Session and identity boundary

The page-global Chatwoot SDK was replaced by a cross-origin iframe and a minimal,
origin-and-source-checked message bridge. The public iframe receives only the
sales inbox token, language and display settings. It never calls an identity
endpoint or receives email, user ID, organization, plan, current URL, referrer,
Firebase token, or a `cw_conversation` token from Festio.

Authenticated support uses only the existing server-signed support identity and
its existing `org_name`/`plan` fields. The iframe URL does not contain that data.
A fresh iframe is created for every route/account/auth-state change, with no
conversation token persisted or copied by the application. Closing and reopening
on the same route retains the current iframe. Logout, route navigation, and
account changes dispose its handlers and remove the iframe; late settings and
identity results are ignored. All frames use `no-referrer`, and sandbox permissions
do not allow top navigation, popouts, camera, or microphone.

Chatwoot itself can receive browser/network metadata and its own origin's cookies.
Do not interpret frontend isolation as a substitute for inbox/server policy.
Public chat uses a distinct origin to prevent shared origin-local storage, and
rollout must verify that no broad-domain authentication cookies span those hosts.

Protocol reference, inspected 2026-10-16 (upstream develop, not a deployed-version
verification):

- [WidgetsController](https://github.com/chatwoot/chatwoot/blob/develop/app/controllers/widgets_controller.rb)
  chooses the website inbox from `website_token`; it resolves the contact from the
  `cw_conversation` parameter and creates a fresh contact when that token is absent.
- [Widget App](https://github.com/chatwoot/chatwoot/blob/develop/app/javascript/widget/App.vue)
  handles `config-set`, `set-user`, `set-custom-attributes`, and `toggle-open` after
  the iframe's `loaded` event.
- [SDK IFrameHelper](https://github.com/chatwoot/chatwoot/blob/develop/app/javascript/sdk/IFrameHelper.js)
  supplies the same `/widget?website_token=...` entry point and message format.

## Required staging gates before rollout

1. Pin/check the deployed Chatwoot version against this protocol, framing CSP,
   required identity validation, supported mobile browsers, and third-party
   storage settings. Test signed support history retrieval and sending in the
   existing support inbox. Do not roll out the support transport change without
   that compatibility test.
2. Create/validate a separate public sales inbox and origin. Do not route anonymous
   sales conversations through privileged organizer-support automation. Public
   handlers must not infer organization membership from a supplied email/phone.
3. Keep proactive campaigns and all automated outbound switches OFF. Review inbox
   pre-chat copy and separate channel-specific marketing opt-in before enabling
   any bot, email follow-up, or WhatsApp sending.
4. Verify anonymous sales → login → support → logout → sales, account switching,
   Back/Forward, guest/pass links, repeated Close/Open, mobile viewport, slow
   identity response, disabled support setting, and provider failure.
5. Inspect outgoing traffic: no auth/tenant/session context in public requests;
   never pass a support conversation token to the sales origin. Recheck cookies
   and storage behavior against the deployed version, not just the mock.

## Consent and demo requests

Password and Google signup share an optional, initially unchecked email marketing
checkbox. Demo forms do the same. The UI sends only `consent_email`; it omits SMS
and WhatsApp preferences because neither is presented. Backend defaults must
remain false for new leads and preserve omitted fields for existing leads. Normal
AuthContext sign-in does not resubmit signup consent.

Demo success text means a request was stored, not that the chosen time is booked
or a calendar invitation/email was sent. The same payload reuses its Idempotency-Key
after a network failure; changed payloads get a new key. CRM lead profiles show
read-only WhatsApp consent, inbound/handoff timestamps, suppression reasons, and
human-review/paused status. No new resume or consent-grant button is added.

## Local checks (no live providers)

- `node --test tests/*.test.mjs`: existing and new Node tests.
- `npm run build`: production frontend bundle and guide generation.
- `npx playwright test --config playwright.engagement.config.js`: isolated local
  React/Playwright fixture on 127.0.0.1:4178. Firebase, backend, and Chatwoot are
  mocked. The fixture does not load .env and aborts non-local/non-fixture requests.
  The fake chat origins are fulfilled in the browser, never contacted.
- `node e2e/engagement-fixture-server.mjs --check`: validate fixture module
  transforms when browser execution is unavailable; this is not a UI test.

At implementation time: Node tests and production build passed. The 9 Playwright
scenarios were authored but could not execute: Chromium launch was blocked by the
execution sandbox's local-socket restriction, and elevated execution failed during
environment setup. Real browser layout, live Firebase signup, deployed Chatwoot
compatibility, and end-to-end delivery are therefore NOT verified here.
The supported cloud-browser fallback was also attempted, but its request to the
local fixture returned `net::ERR_CONNECTION_REFUSED`; no port-forward route was
available in the execution tools.
