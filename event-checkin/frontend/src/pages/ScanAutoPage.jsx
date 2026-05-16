import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api'

export default function ScanAutoPage() {
  const { token } = useParams()
  const [state, setState] = useState('loading') // loading | admitted | already_admitted | invalid
  const [result, setResult] = useState(null)

  useEffect(() => {
    api.scan(token).then((res) => {
      setResult(res)
      setState(res.status)
    }).catch((err) => {
      setResult({ status: 'invalid', message: err.message })
      setState('invalid')
    })
  }, [token])

  const cfg = {
    admitted: { bg: 'bg-green-500', icon: '✓', heading: 'ADMITTED' },
    already_admitted: { bg: 'bg-amber-500', icon: '⚠', heading: 'ALREADY ADMITTED' },
    invalid: { bg: 'bg-red-500', icon: '✕', heading: 'INVALID TICKET' },
  }[state]

  if (state === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="inline-block w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <p className="mt-4 text-gray-600">Verifying your ticket…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
      <div className={`${cfg.bg} text-white rounded-3xl p-10 text-center shadow-2xl max-w-sm w-full`}>
        <div className="text-8xl font-bold mb-3">{cfg.icon}</div>
        <div className="text-3xl font-bold mb-2">{cfg.heading}</div>
        {result?.guest && (
          <div className="text-2xl font-semibold mt-4">
            {result.guest.first_name} {result.guest.last_name}
          </div>
        )}
        <p className="mt-3 text-white/85 text-lg">{result?.message}</p>
        {result?.guest?.admitted_at && state === 'admitted' && (
          <p className="mt-2 text-white/70">
            {new Date(result.guest.admitted_at).toLocaleTimeString()}
          </p>
        )}
      </div>
    </div>
  )
}
