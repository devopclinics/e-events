export const WORKSPACES = [
  { id: 'events', label: 'Events', items: ['events'] },
  { id: 'workspace', label: 'Event workspace', items: ['setup', 'guide', 'design', 'planner', 'mytasks'] },
  { id: 'guest', label: 'Guest experience', items: ['guesthub', 'website', 'festiome'] },
  { id: 'operations', label: 'Event operations', items: ['ticketing', 'checkin', 'live', 'orders'] },
  { id: 'results', label: 'Results', items: ['results'] },
]
export function workspaceNavigation(links, { pathname, search = '' }, topActive) {
  const groups = WORKSPACES.map(group => ({ ...group, links: group.items.map(id => links.find(link => link.id === id)).filter(Boolean) })).filter(group => group.links.length)
  const exact = links.filter(link => {
    const [path, query] = link.to.split('?')
    return pathname === path && (!query || [...new URLSearchParams(query)].every(([key, value]) => new URLSearchParams(search).get(key) === value))
  }).sort((a, b) => b.to.length - a.to.length)[0]
  const activeId = exact?.id || topActive
  const activeGroup = groups.find(group => group.items.includes(activeId))
  return { groups, activeId, activeGroup, accountLinks: links.filter(link => !WORKSPACES.some(group => group.items.includes(link.id))) }
}
