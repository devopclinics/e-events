// Consent is affirmative, channel-specific, and never inferred from an email,
// phone number, account creation, or a demo request. Unpresented channels are
// omitted, preserving any preferences an existing lead previously recorded.
export function marketingConsent(emailOptIn = false) {
  return {
    consent_email: emailOptIn === true,
  }
}

export function signupAttributionHeader(emailOptIn = false) {
  return encodeURIComponent(JSON.stringify(marketingConsent(emailOptIn)))
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
  if (lead.automation?.complete) return 'Complete'
  if (!lead.automation) return 'Not enrolled'
  if (!lead.next_follow_up_at) return 'No follow-up scheduled'
  return `Scheduled · Step ${lead.automation.step}/${lead.automation.total_steps}`
}
