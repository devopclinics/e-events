// Use the event's location, never the attendee's browser locale or name.
const NORTH_AMERICAN_TIMEZONES = new Set([
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Detroit', 'America/Boise', 'America/Phoenix', 'America/Anchorage',
  'America/Juneau', 'America/Sitka', 'America/Metlakatla', 'America/Yakutat',
  'America/Nome', 'America/Adak', 'Pacific/Honolulu', 'America/Indianapolis',
  'America/Louisville', 'America/Toronto', 'America/Vancouver', 'America/Winnipeg',
  'America/Edmonton', 'America/Halifax', 'America/St_Johns', 'America/Regina',
  'America/Swift_Current', 'America/Whitehorse', 'America/Dawson', 'America/Dawson_Creek',
  'America/Fort_Nelson', 'America/Atikokan', 'America/Blanc-Sablon', 'America/Glace_Bay',
  'America/Goose_Bay', 'America/Iqaluit', 'America/Moncton', 'America/Pangnirtung',
  'America/Rainy_River', 'America/Rankin_Inlet', 'America/Resolute', 'America/Thunder_Bay',
  'America/Yellowknife', 'America/Inuvik', 'America/Creston', 'America/Montreal',
  'America/Nipigon', 'America/Fort_Wayne',
])

export function phoneInputSettings(event) {
  const zone = (event?.timezone || '').trim()
  if (NORTH_AMERICAN_TIMEZONES.has(zone) || zone.startsWith('America/Indiana/') ||
      zone.startsWith('America/Kentucky/') || zone.startsWith('America/North_Dakota/') || zone.startsWith('Canada/') ||
      /^US\/(Eastern|Central|Mountain|Pacific|Arizona|Alaska|Aleutian|Hawaii|Indiana-Starke|Michigan)$/.test(zone)) {
    return {
      callingCode: '1', placeholder: '(555) 123-4567',
      helpText: 'U.S. and Canadian numbers use +1. For another country, include + and its country code.',
    }
  }
  if (zone === 'Africa/Lagos') {
    return {
      callingCode: '234', placeholder: '0801 234 5678',
      helpText: 'Nigerian numbers use +234. For another country, include + and its country code.',
    }
  }
  return {
    callingCode: '', placeholder: '+1 555 123 4567',
    helpText: 'Include + and the country code, for example +1 555 123 4567.',
  }
}

export function normalizePhone(raw, event) {
  const value = (raw || '').trim()
  if (!value) return ''
  // Only discard presentation separators; letters or repeated '+' are errors.
  const clean = value.replace(/[\s().-]/g, '')
  const { callingCode } = phoneInputSettings(event)
  let candidate
  if (clean.startsWith('+')) candidate = clean
  else if (clean.startsWith('00')) candidate = '+' + clean.slice(2)
  else if (callingCode === '1') {
    if (/^\d{10}$/.test(clean)) candidate = '+1' + clean
    else if (/^1\d{10}$/.test(clean)) candidate = '+' + clean
    else throw new Error('Enter a 10-digit U.S. or Canadian phone number, or include + and the country code.')
  } else if (callingCode === '234') {
    if (/^0\d{10}$/.test(clean)) candidate = '+234' + clean.slice(1)
    else if (/^\d{10}$/.test(clean)) candidate = '+234' + clean
    else if (/^234\d{10}$/.test(clean)) candidate = '+' + clean
    else throw new Error('Enter a Nigerian phone number, or include + and the country code.')
  } else throw new Error('Please include + and the country code in your phone number.')
  // Match the server's existing E.164 format check.
  if (!/^\+[1-9]\d{6,14}$/.test(candidate)) throw new Error('Please enter a valid phone number with its country code.')
  return candidate
}
