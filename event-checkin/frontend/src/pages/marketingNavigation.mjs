// Existing tab identifiers stay stable; only their everyday organization changes.
export const MARKETING_NAV_GROUPS = [
  { id: 'today', label: 'Today', ids: ['dashboard'] },
  { id: 'people', label: 'People', ids: ['leads', 'forms'] },
  {
    id: 'messages',
    label: 'Messages',
    ids: ['messages', 'campaigns', 'sequences', 'content'],
  },
  { id: 'followups', label: 'Follow-ups', ids: ['handoffs', 'tasks'] },
  {
    id: 'results',
    label: 'Results',
    ids: ['analytics', 'referrals', 'experiments'],
  },
  {
    id: 'settings',
    label: 'Settings',
    ids: [
      'settings',
      'segments',
      'tags',
      'preferences',
      'help',
      'social-settings',
      'access',
      'audit',
    ],
  },
]
export function marketingGroups(tabs) {
  return MARKETING_NAV_GROUPS.map((group) => ({
    ...group,
    tabs: group.ids
      .map((id) => tabs.find((tab) => tab[0] === id))
      .filter(Boolean),
  })).filter((group) => group.tabs.length)
}
export function marketingTab(value, tabs) {
  return tabs.some(([id]) => id === value) ? value : 'dashboard'
}
