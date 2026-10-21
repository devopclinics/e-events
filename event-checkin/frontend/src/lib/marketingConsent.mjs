import { acquisitionAttribution } from './acquisitionAttribution.mjs'

// Consent is affirmative, channel-specific, and never inferred from an email,
// phone number, account creation, or a demo request. Unpresented channels are
// omitted, preserving any preferences an existing lead previously recorded.
export function marketingConsent(emailOptIn = false) {
  return {
    consent_email: emailOptIn === true,
  }
}

export function signupAttributionHeader(emailOptIn = false) {
  return encodeURIComponent(JSON.stringify({ ...acquisitionAttribution(), ...marketingConsent(emailOptIn) }))
}

export const DEMO_REQUEST_RECEIVED = 'Your demo request has been received. Your preferred time is not confirmed yet; our team will contact you to arrange the meeting.'

// Keep the key after a network failure: the server may have accepted the request
// even when the response was lost. Changed payloads get a new key.
export function demoRequestAttempt(previous, body, newKey = () => crypto.randomUUID()) {
  const fingerprint = JSON.stringify(body)
  return previous?.fingerprint === fingerprint ? previous : { fingerprint, key: newKey() }
}

export function leadAutomationStatus(lead) {
  if (lead.automation_paused || lead.handoff_requested_at || lead.suppression_reason || lead.unsubscribed) return 'Needs human review'
  if (lead.automation?.automatic_eligible === false) return 'Not enrolled in automatic onboarding'
  if (lead.automation?.complete) return 'Complete'
  if (!lead.automation) return 'Not enrolled'
  if (!lead.next_follow_up_at) return 'No follow-up scheduled'
  return `Scheduled · Step ${lead.automation.step}/${lead.automation.total_steps}`
}

// Retain the checkbox only for its own UID/mailbox until a verified sign-in.
// A cached checkbox never supplies email-verification authority to the backend.
export function rememberSignupConsent(uid, email, optedIn, storage = globalThis.localStorage, now = Date.now()) {
  try { storage.setItem(`festio:signup-consent:${uid}`, JSON.stringify({ email: email.toLowerCase(), optedIn: optedIn === true, at: now })) } catch {}
}

export function verifiedSignupConsent(user, storage = globalThis.localStorage, now = Date.now()) {
  if (!user?.emailVerified || !user?.uid || !user?.email) return {}
  try {
    const saved = JSON.parse(storage.getItem(`festio:signup-consent:${user.uid}`) || 'null')
    if (!saved || saved.email !== user.email.toLowerCase() || typeof saved.optedIn !== 'boolean' || !Number.isFinite(saved.at) || saved.at > now || now - saved.at > 7 * 86400000) return {}
    return { 'X-Festio-Attribution': signupAttributionHeader(saved.optedIn) }
  } catch { return {} }
}

export function clearSignupConsent(uid, storage = globalThis.localStorage) {
  try { storage.removeItem(`festio:signup-consent:${uid}`) } catch {}
}

export function onboardingPreviewLeads(leads, runtime) {
  return runtime?.enabled ? leads.filter(lead => lead.automation?.automatic_eligible === true) : leads
}
