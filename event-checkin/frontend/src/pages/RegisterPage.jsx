import { useState, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth'
import { auth } from '../firebase'
import { googleSignIn } from '../auth/googleSignIn'
import { useAuth } from '../context/AuthContext'
import { setPreferredView } from '../App'

function ViewPicker({ role, onPick }) {
  const views = [
    { key: 'setup', icon: 'SET', label: 'Create an event', desc: 'Start with a draft event and preview before paying' },
    ...(role === 'admin' ? [{ key: 'admin',     icon: 'OPS', label: 'Event Setup',  desc: 'Manage existing events, guests, and invitations' }] : []),
    { key: 'dashboard', icon: 'RES', label: 'Results',    desc: 'RSVP progress, check-ins, and attendance' },
    { key: 'scanner',   icon: 'QR', label: 'Check-in',   desc: 'Scan guest QR codes at the entrance' },
  ]
  return (
    <div className="app-shell min-h-screen flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl w-full max-w-md p-8">
        <div className="text-center mb-6">
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-lg bg-teal-600 text-white font-bold">F</div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Welcome to Festio!</h1>
          <p className="text-gray-500 dark:text-slate-400 text-sm mt-2">Choose the view you want to open by default when you sign in.</p>
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

export default function RegisterPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const plan = params.get('plan') || ''
  const setupQuery = plan ? `?plan=${encodeURIComponent(plan)}` : ''
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [pickerRole, setPickerRole] = useState(null)

  useEffect(() => {
    if (user && !pickerRole) navigate(`/setup${setupQuery}`, { replace: true })
  }, [user, pickerRole, navigate, setupQuery])

  // Partner referral: remember the code through the Firebase signup redirect
  // so AuthContext can attribute this org once the account exists.
  useEffect(() => {
    const ref = params.get('ref')
    if (ref) {
      try { localStorage.setItem('festio:referral-code', ref) } catch { /* storage unavailable */ }
    }
  }, [params])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    if (form.password.length < 6) return setError('Password must be at least 6 characters.')
    setLoading(true); setError('')
    try {
      const cred = await createUserWithEmailAndPassword(auth, form.email, form.password)
      await updateProfile(cred.user, { displayName: form.name })
      // Sync with backend (creates the DB record)
      const token = await cred.user.getIdToken()
      await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      setPickerRole('official')
    } catch (err) {
      setError(friendlyError(err.code))
    } finally {
      setLoading(false)
    }
  }

  async function signUpWithGoogle() {
    setLoading(true); setError('')
    try {
      const cred = await googleSignIn()
      const token = await cred.user.getIdToken()
      await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      setPickerRole('official')
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user') setError(friendlyError(err.code))
    } finally {
      setLoading(false)
    }
  }

  function handlePick(view) {
    setPreferredView(view)
    navigate(view === 'setup' ? `/setup${setupQuery}` : view === 'admin' ? '/admin' : `/${view}`, { replace: true })
  }

  if (pickerRole) return <ViewPicker role={pickerRole} onPick={handlePick} />

  const field = 'w-full border border-slate-300 dark:border-slate-700 rounded-md px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-800 text-gray-900 dark:text-white'

  return (
    <div className="app-shell min-h-screen flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl w-full max-w-md p-8">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-teal-600 rounded-lg mb-4 text-white font-bold">
            F
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Create Account</h1>
          <p className="text-gray-500 dark:text-slate-400 text-sm mt-1">Join Festio as an official</p>
        </div>

        <button onClick={signUpWithGoogle} disabled={loading}
          className="flex items-center justify-center gap-3 w-full border border-gray-300 dark:border-slate-700 rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors">
          <svg width="18" height="18" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          Sign up with Google
        </button>

        <div className="flex items-center my-5">
          <div className="flex-1 h-px bg-gray-200 dark:bg-slate-700" />
          <span className="px-3 text-xs text-gray-400 dark:text-slate-500">or fill in details</span>
          <div className="flex-1 h-px bg-gray-200 dark:bg-slate-700" />
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label htmlFor="register-name" className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Full Name</label>
            <input id="register-name" className={field} value={form.name} onChange={set('name')} required placeholder="Jane Smith" />
          </div>
          <div>
            <label htmlFor="register-email" className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Email</label>
            <input id="register-email" className={field} type="email" value={form.email} onChange={set('email')} required autoComplete="email" />
          </div>
          <div>
            <label htmlFor="register-password" className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Password</label>
            <input id="register-password" className={field} type="password" value={form.password} onChange={set('password')} required autoComplete="new-password" placeholder="Min. 6 characters" />
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button type="submit" disabled={loading}
            className="w-full bg-indigo-600 text-white py-2.5 rounded-lg font-semibold text-sm hover:bg-indigo-700 disabled:opacity-50 transition-colors">
            {loading ? 'Creating account…' : 'Create Account'}
          </button>
        </form>

        <p className="text-center text-sm text-gray-500 dark:text-slate-400 mt-6">
          Already have an account?{' '}
          <Link to="/login" className="text-indigo-600 font-medium hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  )
}

function friendlyError(code) {
  switch (code) {
    case 'auth/email-already-in-use': return 'An account with this email already exists.'
    case 'auth/weak-password':        return 'Password is too weak.'
    case 'auth/invalid-email':        return 'Invalid email address.'
    case 'auth/network-request-failed': return 'Network error. Check your connection.'
    default: return 'Something went wrong. Please try again.'
  }
}
