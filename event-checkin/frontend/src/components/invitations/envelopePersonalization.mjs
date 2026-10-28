// Only server-provided personal invite names (or explicit Studio samples) belong here.
// This module never reads query strings, contacts, prior RSVPs, or global storage.
export const GUEST_NAME_TOKENS = ['first_name', 'last_name', 'full_name', 'guest_name']
export function renderEnvelopeWording(template, guest) {
  const source = String(template)
  if (!/{{\s*(first_name|last_name|full_name|guest_name)\s*}}/i.test(source)) return source
  const clean = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 100) : ''
  const first = clean(guest?.first_name), last = clean(guest?.last_name)
  const full = [first, last].filter(Boolean).join(' ') || 'Guest'
  const values = { first_name: first || 'Guest', last_name: last, full_name: full, guest_name: full }
  // One replacement pass: a name containing braces is text, never another template.
  const rendered = source.replace(/{{\s*(first_name|last_name|full_name|guest_name)\s*}}/gi, (_, key) => values[key.toLowerCase()])
    .replace(/[ \t]+([,.;:!?])/g, '$1').replace(/[ \t]{2,}/g, ' ').trim()
  const chars = Array.from(rendered)
  return chars.length > 320 ? chars.slice(0, 319).join('') + '…' : rendered
}
export async function personalEnvelopeScope(token) {
  if (!token) return ''
  try {
    // Keep names and bearer tokens out of completion records. No new API call.
    const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
  } catch { return null } // Personal links then use memory-only completion for this visit.
}
