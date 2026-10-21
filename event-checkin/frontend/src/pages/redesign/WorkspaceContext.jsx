import { Link } from 'react-router-dom'
import { workspaceContext } from './workspaceContext.mjs'
import './WorkspaceContext.css'
export default function WorkspaceContext({ pathname, search, eventName, role }) {
  const context = workspaceContext(pathname, search)
  if (!context) return null
  const [scope, title, description] = context
  const canConfigure = ['admin','event_manager'].includes(role)
  return <aside className="workspace-context" aria-label="Workspace context"><div><span>{scope}{scope.startsWith('Event') && eventName ? ` · ${eventName}` : ''}</span><strong>{title}</strong></div><details><summary>Where this fits</summary><p>{description}</p><nav aria-label="Related guidance">{pathname === '/scanner-redesign' && <Link to="/guest-services">Meal attendance in Guest Services</Link>}{pathname === '/guest-services' && <Link to="/kitchen-redesign">Kitchen orders</Link>}{pathname === '/kitchen-redesign' && canConfigure && <Link to="/addons-redesign?tab=orders">Configure menus & choices</Link>}{pathname === '/conference-center' && canConfigure && <><Link to="/addons-redesign?tab=speakers">Shared speaker profiles</Link><Link to="/addons-redesign?tab=partners">Shared partner profiles</Link></>}{['admin','event_manager'].includes(role) && <Link to="/setup-redesign?view=guide">Setup checklist</Link>}{role === 'admin' && <Link to="/guest-experience">Guest experience overview</Link>}<Link to="/help-redesign">Help & reference</Link></nav></details></aside>
}
