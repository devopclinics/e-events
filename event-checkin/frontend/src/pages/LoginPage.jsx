import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { signInWithEmailAndPassword, signInWithPopup } from 'firebase/auth'
import { auth, googleProvider } from '../firebase'
import { useAuth } from '../context/AuthContext'
import { getPreferredView, setPreferredView } from '../App'

function ViewPicker({ role, onPick }) {
  const views = [
    ...(role === 'admin' ? [{ key: 'admin',     icon: 'SET', label: 'Event Setup',  desc: 'Create events, import guests, and send invitations' }] : []),
    { key: 'dashboard', icon: 'RES', label: 'Results',    desc: 'RSVP progress, check-ins, and attendance' },
    { key: 'scanner',   icon: 'QR', label: 'Check-in',   desc: 'Scan guest QR codes at the entrance' },
  ]
  return (
    <div className="app-shell min-h-screen flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl w-full max-w-md p-8">
        <div className="text-center mb-6">
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-lg bg-teal-600 text-white font-bold">EQ</div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Welcome back!</h1>
          <p className="text-gray-500 dark:text-slate-400 text-sm mt-2">Choose your default view.</p>
        </div>
        <div className="space-y-3">
          {views.map(({ key, icon, label, desc }) => (
            <button key={key} onClick={() => onPick(key)}
              className="w-full flex items-center gap-4 p-4 border border-slate-200 dark:border-slate-700 rounded-lg hover:border-teal-400 hover:bg-teal-50 dark:hover:bg-teal-950/30 transition-all text-left group">
              <span className="grid h-10 w-10 place-items-center rounded-md bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300">{icon}</span>
              <div>
                <div className="font-semibold text-gray-800 dark:text-slate-100 group-hover:text-teal-700 dark:group-hover:text-teal-300">{label}</div>
                <div className="text-xs text-gray-500 dark:text-slate-400">{desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [pickerRole, setPickerRole] = useState(null)

  useEffect(() => {
    if (user && !pickerRole) navigate(getPreferredView(user.role), { replace: true })
  }, [user, pickerRole, navigate])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  function afterSignIn(role) {
    if (!localStorage.getItem('preferredView')) {
      setPickerRole(role)
    } else {
      navigate(getPreferredView(role), { replace: true })
    }
  }

  async function submit(e) {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      const cred = await signInWithEmailAndPassword(auth, form.email, form.password)
      const token = await cred.user.getIdToken()
      const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      const dbUser = await res.json()
      afterSignIn(dbUser.role)
    } catch (err) {
      setError(friendlyError(err.code))
    } finally {
      setLoading(false)
    }
  }

  async function signInWithGoogle() {
    setLoading(true); setError('')
    try {
      const cred = await signInWithPopup(auth, googleProvider)
      const token = await cred.user.getIdToken()
      const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      const dbUser = await res.json()
      afterSignIn(dbUser.role)
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user') setError(friendlyError(err.code))
    } finally {
      setLoading(false)
    }
  }

  function handlePick(view) {
    setPreferredView(view)
    navigate(view === 'admin' ? '/admin' : `/${view}`, { replace: true })
  }

  if (pickerRole) return <ViewPicker role={pickerRole} onPick={handlePick} />

  const field = 'w-full border border-slate-300 dark:border-slate-700 rounded-md px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-800 text-gray-900 dark:text-white'

  return (
    <div className="app-shell min-h-screen flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl w-full max-w-md p-8">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-teal-600 rounded-lg mb-4 text-white font-bold">
            EQ
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">EventQR</h1>
          <p className="text-gray-500 dark:text-slate-400 text-sm mt-1">Sign in to your account</p>
        </div>

        <button onClick={signInWithGoogle} disabled={loading}
          className="flex items-center justify-center gap-3 w-full border border-gray-300 dark:border-slate-700 rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors">
          <svg width="18" height="18" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          Continue with Google
        </button>

        <div className="flex items-center my-5">
          <div className="flex-1 h-px bg-gray-200 dark:bg-slate-700" />
          <span className="px-3 text-xs text-gray-400 dark:text-slate-500">or sign in with email</span>
          <div className="flex-1 h-px bg-gray-200 dark:bg-slate-700" />
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label htmlFor="login-email" className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Email</label>
            <input id="login-email" className={field} type="email" value={form.email} onChange={set('email')} required autoComplete="email" />
          </div>
          <div>
            <label htmlFor="login-password" className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Password</label>
            <input id="login-password" className={field} type="password" value={form.password} onChange={set('password')} required autoComplete="current-password" />
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button type="submit" disabled={loading}
            className="w-full bg-indigo-600 text-white py-2.5 rounded-lg font-semibold text-sm hover:bg-indigo-700 disabled:opacity-50 transition-colors">
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <p className="text-center text-sm text-gray-500 dark:text-slate-400 mt-6">
          Don't have an account?{' '}
          <Link to="/register" className="text-indigo-600 font-medium hover:underline">Create one</Link>
        </p>
      </div>
    </div>
  )
}

function friendlyError(code) {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Invalid email or password.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Try again later.'
    case 'auth/network-request-failed':
      return 'Network error. Check your connection.'
    default:
      return 'Sign-in failed. Please try again.'
  }
}
