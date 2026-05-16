import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function AuthCallbackPage() {
  const [params] = useSearchParams()
  const { saveToken } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    const token = params.get('token')
    if (!token) {
      navigate('/login?error=google_failed', { replace: true })
      return
    }
    // Decode role from token payload (no library needed — just read the claim)
    try {
      const payload = JSON.parse(atob(token.split('.')[1]))
      saveToken(token)
      navigate(payload.role === 'admin' ? '/' : '/scanner', { replace: true })
    } catch {
      navigate('/login?error=google_failed', { replace: true })
    }
  }, [params, saveToken, navigate])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="inline-block w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        <p className="mt-4 text-gray-600">Completing sign-in…</p>
      </div>
    </div>
  )
}
