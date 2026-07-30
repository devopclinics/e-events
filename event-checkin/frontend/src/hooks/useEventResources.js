import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useEventDetails } from './useEventDetails'
import { useGuests } from './useGuests'
import { validateVenueAccess } from '../adapters/contractValidation'

function useEventResource(eventId, loader, emptyValue, errorMessage) {
  const [data, setData] = useState(emptyValue)
  const [loading, setLoading] = useState(!!eventId)
  const [error, setError] = useState('')
  const requestId = useRef(0)

  const refresh = useCallback(async () => {
    const current = ++requestId.current
    if (!eventId) {
      setData(emptyValue)
      setLoading(false)
      setError('')
      return
    }
    setLoading(true)
    setError('')
    try {
      const next = await loader(eventId)
      if (requestId.current === current) setData(next)
    } catch (cause) {
      if (requestId.current === current) setError(cause.message || errorMessage)
    } finally {
      if (requestId.current === current) setLoading(false)
    }
  }, [emptyValue, errorMessage, eventId, loader])

  useEffect(() => { refresh() }, [refresh])
  return { data, setData, loading, error, refresh }
}

const EMPTY_ACCESS = { zones: [], ticketTypes: [] }
const EMPTY_SEATING = { tables: [], tableGroups: [] }
const EMPTY_BILLING = { tiers: [], ledger: null }
const EMPTY_MESSAGING = { invitations: null, broadcasts: [] }

const loadAccess = async (eventId) => {
  const [zones, ticketTypes] = await Promise.all([api.listZones(eventId), api.listTicketTypes(eventId)])
  return validateVenueAccess({ zones, ticketTypes })
}
const loadSeating = async (eventId) => {
  const [tables, tableGroups] = await Promise.all([api.listTables(eventId), api.listTableGroups(eventId)])
  return { tables, tableGroups }
}
const loadBilling = async (eventId) => {
  const [tiers, ledger] = await Promise.all([api.getBillingTiers(eventId), api.getCreditLedger(eventId)])
  return { tiers, ledger }
}
const loadMessaging = async (eventId) => {
  const [invitations, broadcasts] = await Promise.all([
    api.resultsInvitations(eventId),
    api.resultsBroadcasts(eventId).catch(() => []),
  ])
  return { invitations, broadcasts }
}

export function useVenueAccess(eventId) {
  return useEventResource(eventId, loadAccess, EMPTY_ACCESS, 'Venue access could not be loaded')
}

export function useSeating(eventId) {
  return useEventResource(eventId, loadSeating, EMPTY_SEATING, 'Seating could not be loaded')
}

export function useTasks(eventId) {
  return useEventResource(eventId, api.listTasks, [], 'Tasks could not be loaded')
}

export function useBilling(eventId) {
  return useEventResource(eventId, loadBilling, EMPTY_BILLING, 'Billing could not be loaded')
}

export function useMessaging(eventId) {
  return useEventResource(eventId, loadMessaging, EMPTY_MESSAGING, 'Messaging could not be loaded')
}

export function useEventStats(eventId) {
  return useEventResource(eventId, api.getDashboard, null, 'Event statistics could not be loaded')
}

export function useInvitations(eventId) {
  const guests = useGuests(eventId)
  const messaging = useMessaging(eventId)
  return { guests, delivery: messaging }
}

export function useEventWorkspace(eventId) {
  const eventDetails = useEventDetails(eventId)
  const guests = useGuests(eventId)
  return { eventDetails, guests }
}

export function useEntitlements(event, loading = false) {
  return {
    loading,
    flags: {
      seating: !!event?.seating_enabled,
      orders: !!event?.menu_enabled,
      logistics: !!event?.logistics_enabled,
      registry: !!event?.registry_enabled,
      venueAccess: !!event?.venue_access_enabled,
      experience: !!event?.experience_enabled,
      festiome: !!event?.festiome_addon_enabled,
    },
  }
}
