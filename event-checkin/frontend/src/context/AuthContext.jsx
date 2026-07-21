import { createContext, useContext, useState, useEffect } from 'react'
import { onAuthStateChanged, signOut as fbSignOut } from 'firebase/auth'
import { auth } from '../firebase'

const AuthContext = createContext(null)

// Fire-and-forget: attribute this account's org to whoever referred it, if a
// code was captured on /register or /login. Safe to call on every sign-in —
// the backend no-ops once an org is already attributed.
function claimPendingReferral(token) {
  let code
  try { code = localStorage.getItem('festio:referral-code') } catch { return }
  if (!code) return
  try { localStorage.removeItem('festio:referral-code') } catch { /* ignore */ }
  fetch('/api/organizations/me/referral/claim', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  }).catch(() => {})
}

export function AuthProvider({ children }) {
  // undefined = still loading, null = signed out, object = signed in
  const [user, setUser] = useState(undefined)

  useEffect(() => {
    const timeout = window.setTimeout(() => setUser((current) => current === undefined ? null : current), 5000)
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      window.clearTimeout(timeout)
      if (!firebaseUser) {
        setUser(null)
        return
      }
      try {
        const token = await firebaseUser.getIdToken()
        const res = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (res.ok) {
          setUser(await res.json())
          claimPendingReferral(token)
        } else {
          setUser(null)
        }
      } catch {
        setUser(null)
      }
    })
    return () => {
      window.clearTimeout(timeout)
      unsubscribe()
    }
  }, [])

  async function logout() {
    await fbSignOut(auth)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user: user || null, loading: user === undefined, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
