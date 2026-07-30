export const UI_PREFERENCE_KEY = 'festio.adminUiPreference'

export function getUiPreference() {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(UI_PREFERENCE_KEY)
}

export function setUiPreference(preference) {
  if (typeof window === 'undefined') return
  if (preference === 'legacy' || preference === 'redesign') {
    window.localStorage.setItem(UI_PREFERENCE_KEY, preference)
  } else {
    window.localStorage.removeItem(UI_PREFERENCE_KEY)
  }
}

export function preferenceFromSearch(search = '') {
  const requested = new URLSearchParams(search).get('ui')
  return requested === 'legacy' || requested === 'redesign' ? requested : null
}
