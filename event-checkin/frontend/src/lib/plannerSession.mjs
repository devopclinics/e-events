// A planner JWT is scoped to both the Firebase actor and the event. Never let
// an in-flight exchange or a cached JWT survive a change of signed-in account.
export function assertPlannerActor(getActor, actor) {
  if (!actor?.uid || getActor() !== actor) throw new Error('Your account changed. Reopen Planner to continue.')
}
export function createPlannerSessionCache({getActor, exchange, now = Date.now}) {
  let session = null
  return async function getSession(eventId, force = false) {
    const actor = getActor()
    assertPlannerActor(getActor, actor)
    if (!force && session?.actor === actor && session.eventId === eventId && session.expiresAt > now() + 30000) return session.token
    const firebaseToken = await actor.getIdToken()
    assertPlannerActor(getActor, actor)
    const data = await exchange(eventId, firebaseToken)
    assertPlannerActor(getActor, actor)
    if (!data?.token) throw new Error('Planner authentication could not be completed.')
    session = {actor, eventId, token:data.token, expiresAt:now() + Number(data.expires_in || 900) * 1000}
    return session.token
  }
}
