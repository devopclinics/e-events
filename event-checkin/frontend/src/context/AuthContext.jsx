import { createContext, useContext, useState, useEffect } from 'react'
import { onAuthStateChanged, signOut as fbSignOut } from 'firebase/auth'
import { auth } from '../firebase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  // undefined = still loading, null = signed out, object = signed in
  const [user, setUser] = useState(undefined)

  useEffect(() => {
    return onAuthStateChanged(auth, async (firebaseUser) => {
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
  }, [])

  async function logout() {
    await fbSignOut(auth)
    setUser(null)
  }

  // Block render until Firebase resolves the auth state (prevents flash)
  if (user === undefined) return null

  return (
    <AuthContext.Provider value={{ user, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
