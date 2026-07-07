import { createContext, useContext, useState, useEffect } from 'react'
import { onAuthStateChanged, signOut as fbSignOut } from 'firebase/auth'
import { auth } from '../firebase'

const AuthContext = createContext(null)

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
