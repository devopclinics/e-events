// Preserve navigation intent while retiring legacy routes. Never carry actions
// or nested redirect URLs into the destination workspace.
export function legacyDestination(route, search = '', hash = '') {
  const target = new URL(route, 'https://festio.events')
  const explicit = new Set(target.searchParams.keys())
  const allowed = new Set(['event', 'event_id', 'eventId', 'tab', 'view', 'task'])
  for (const [key, value] of new URLSearchParams(search)) {
    if (allowed.has(key) && !explicit.has(key)) target.searchParams.append(key, value)
  }
  return target.pathname + target.search + hash
}
