import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
export default function NotFoundPage() {
  const { user } = useAuth()
  return <main className="max-w-xl mx-auto p-8"><h1 className="text-2xl font-bold">Page not found</h1><p className="my-4">This link may be incomplete or out of date. Your account and event have not been changed.</p><nav className="flex flex-wrap gap-4" aria-label="Page recovery"><Link to={user ? '/events-redesign' : '/'}>{user ? 'Choose an event' : 'Festio home'}</Link><Link to={user ? '/help-redesign' : '/login'}>{user ? 'Help' : 'Sign in'}</Link></nav></main>
}
