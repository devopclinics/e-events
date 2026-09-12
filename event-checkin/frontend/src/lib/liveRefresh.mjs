// Coalesce audience bursts and serialize reads. Host actions invalidate an older
// in-flight snapshot and jump ahead of the next scheduled audience refresh.
export function createLiveRefresh(load, { delayMs = 350, onError = () => {} } = {}) {
  let timer = null
  let running = false
  let pending = false
  let urgent = false
  let disposed = false
  let version = 0

  const schedule = () => {
    if (disposed || running || !pending) return
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(run, urgent ? 0 : delayMs)
  }
  const run = async () => {
    timer = null
    if (disposed || running || !pending) return
    running = true
    pending = false
    urgent = false
    const startedVersion = version
    try {
      await load({ isCurrent: () => !disposed && startedVersion === version })
    } catch (error) {
      if (!disposed) onError(error)
    } finally {
      running = false
      schedule()
    }
  }
  return {
    request(immediate = false) {
      if (disposed) return
      pending = true
      if (immediate) { urgent = true; version += 1 }
      // A continuous stream of votes must not postpone a refresh indefinitely.
      if (timer === null || immediate) schedule()
    },
    dispose() {
      disposed = true
      pending = false
      if (timer !== null) clearTimeout(timer)
    },
  }
}

export function reconnectDelay(attempt, random = Math.random) {
  return Math.min(30000, 1000 * (2 ** Math.min(attempt, 5))) * (0.8 + random() * 0.4)
}

const joinCache = new Map()
export function cachedJoinCode(eventId, fetcher = fetch) {
  if (!eventId) return Promise.resolve(null)
  const cached = joinCache.get(eventId)
  if (cached && cached.expires > Date.now()) return cached.promise
  const entry = { expires: Date.now() + 60000 }
  entry.promise = fetcher(`/api/events/${encodeURIComponent(eventId)}/live/public-join-info`, { signal: AbortSignal.timeout(5000) })
    .then(async (response) => {
      if (!response.ok) return null
      const { code } = await response.json()
      if (code) entry.expires = Date.now() + 30 * 60000
      return code || null
    }).catch(() => null)
  joinCache.set(eventId, entry)
  if (joinCache.size > 50) joinCache.delete(joinCache.keys().next().value)
  return entry.promise
}
