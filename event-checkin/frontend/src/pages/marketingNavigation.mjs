export const MARKETING_NAV_GROUPS = [
  { id: 'onboarding', label: 'Client onboarding', ids: ['dashboard', 'sequences', 'handoffs'] },
  { id: 'growth', label: 'Audience & growth', ids: ['leads', 'segments', 'tags', 'forms', 'campaigns', 'content', 'referrals', 'tasks', 'experiments', 'analytics'] },
  { id: 'workspace', label: 'Workspace', ids: ['preferences', 'help', 'social-settings', 'access', 'audit'] },
]
export function marketingGroups(tabs) {
  return MARKETING_NAV_GROUPS.map(group => ({ ...group, tabs: group.ids.map(id => tabs.find(tab => tab[0] === id)).filter(Boolean) })).filter(group => group.tabs.length)
}
export function marketingTab(value, tabs) {
  return tabs.some(([id]) => id === value) ? value : 'dashboard'
}
