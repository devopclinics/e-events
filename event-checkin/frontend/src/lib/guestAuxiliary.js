import { canSeeStaffFeature } from './staffFeatures'

// Guest-list access does not grant seating, venue-access or design access.
// These optional pickers must never prevent an authorized guest directory read.
export async function loadGuestAuxiliary(api, eventId, event) {
  if (!event || event.id !== eventId) return { groups: [], tables: [], ticketTypes: [], questions: [] }
  async function optional(feature, load) {
    if (!canSeeStaffFeature(event, feature)) return []
    try { return await load(eventId) }
    catch (error) { if (error.status === 403) return []; throw error }
  }
  const [groups, tables, ticketTypes, questions] = await Promise.all([
    optional('seating', api.listTableGroups), optional('seating', api.listTables),
    optional('access', api.listTicketTypes), optional('design', api.listRSVPQuestions),
  ])
  return { groups, tables, ticketTypes, questions }
}
