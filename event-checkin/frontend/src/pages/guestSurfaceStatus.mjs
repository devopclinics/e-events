import { signature } from '../components/design-studio/model.mjs'
export function safeWebsiteLink(value) {
  if (typeof value !== 'string' || !value || value.startsWith('//') || /[\\\u0000-\u0020]/.test(value)) return null
  try { const url = new URL(value, 'https://festio.events'); return url.protocol === 'https:' && !url.username && !url.password ? (value.startsWith('/') ? url.pathname + url.search + url.hash : url.href) : null } catch { return null }
}
export function designPublication(design) {
  if (!design) return 'Publication status unavailable'
  if (!design.is_published) return 'Not published'
  const comparison = !design.published_snapshot ? 'draft comparison unavailable' : signature(design) === signature(design.published_snapshot) ? 'saved draft matches this release' : 'saved draft has unpublished changes'
  return `Published version ${design.published_version ?? 'available'} · ${comparison}`
}
export function websitePublication(website) {
  if (!website) return 'Publication status unavailable'
  if (!website.published_release_id) return 'Not published'
  return `Published version ${website.published_version ?? 'available'}${website.draft_is_newer || website.live_release_outdated ? ' · draft or source changes need review' : ''}`
}
