function contractError(contract, detail) {
  return new Error(`API contract mismatch (${contract}): ${detail}`)
}

function requireObject(value, contract) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw contractError(contract, 'expected an object')
  }
  return value
}

export function validateEventList(value) {
  if (!Array.isArray(value)) throw contractError('EventOut[]', 'expected an array')
  value.forEach((event, index) => {
    requireObject(event, `EventOut[${index}]`)
    if (typeof event.id !== 'string' || typeof event.name !== 'string') {
      throw contractError(`EventOut[${index}]`, 'id and name must be strings')
    }
  })
  return value
}

export function validateGuestList(value) {
  if (!Array.isArray(value)) throw contractError('GuestOut[]', 'expected an array')
  value.forEach((guest, index) => {
    requireObject(guest, `GuestOut[${index}]`)
    if (typeof guest.id !== 'string') throw contractError(`GuestOut[${index}]`, 'id must be a string')
  })
  return value
}

export function validateVenueAccess(value) {
  requireObject(value, 'VenueAccess')
  if (!Array.isArray(value.zones) || !Array.isArray(value.ticketTypes)) {
    throw contractError('VenueAccess', 'zones and ticketTypes must be arrays')
  }
  for (const [collectionName, items] of [['zones', value.zones], ['ticketTypes', value.ticketTypes]]) {
    items.forEach((item, index) => {
      requireObject(item, `${collectionName}[${index}]`)
      if (typeof item.id !== 'string' || typeof item.name !== 'string') {
        throw contractError(`${collectionName}[${index}]`, 'id and name must be strings')
      }
    })
  }
  return value
}
