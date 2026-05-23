import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api'

function StatusBadge({ status }) {
  const cfg = {
    valid: {
      bg: 'bg-emerald-50 border-emerald-200 text-emerald-700',
      dot: 'bg-emerald-500',
      label: 'Valid Ticket',
    },
    admitted: {
      bg: 'bg-teal-50 border-teal-200 text-teal-700',
      dot: 'bg-teal-500',
      label: 'Admitted',
    },
    invalid: {
      bg: 'bg-red-50 border-red-300 text-red-600',
      dot: 'bg-red-500',
      label: 'Invalid Ticket',
    },
  }[status] || { bg: 'bg-gray-100 border-gray-300 text-gray-500', dot: 'bg-gray-400', label: 'Unknown' }

  return (
    <span className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full border text-sm font-semibold ${cfg.bg}`}>
      <span className={`w-2 h-2 rounded-full ${cfg.dot} ${status === 'valid' ? 'animate-pulse' : ''}`} />
      {cfg.label}
    </span>
  )
}

function AdmittedBanner({ guest, event }) {
  return (
    <div className="bg-teal-600 text-white rounded-lg px-6 py-5 text-center">
      <div className="flex items-center justify-center gap-2 mb-1">
        <svg className="w-5 h-5 text-teal-100" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
        </svg>
        <span className="text-teal-100 text-sm font-medium">Check-in complete</span>
      </div>
      <p className="font-semibold text-lg">
        Welcome, {guest.first_name}!
      </p>
      {guest.admitted_at && (
        <p className="text-teal-100 text-sm mt-0.5">
          Admitted at {new Date(guest.admitted_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      )}
    </div>
  )
}

export default function ScanAutoPage() {
  const { token } = useParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.viewTicket(token)
      .then(setData)
      .catch(() => setData({ status: 'invalid' }))
      .finally(() => setLoading(false))
  }, [token])

  if (loading) {
    return (
      <div className="app-shell min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-10 h-10 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" />
          <p className="mt-4 text-slate-500 text-sm">Loading your ticket…</p>
        </div>
      </div>
    )
  }

  if (data?.status === 'invalid') {
    return (
      <div className="app-shell min-h-screen flex items-center justify-center p-4">
        <div className="bg-white rounded-xl border border-slate-200 shadow-xl p-10 text-center max-w-sm w-full">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">Invalid Ticket</h2>
          <p className="text-slate-500 text-sm">This QR code is not valid for any event. Please contact the event organiser.</p>
        </div>
      </div>
    )
  }

  const { guest, event, status } = data || {}
  const qrImageUrl = `/api/scan/${token}/qr.png`
  const eventDate = event?.event_date ? new Date(event.event_date) : null

  return (
    <div className="app-shell min-h-screen flex items-center justify-center p-4 py-10">
      {/* Ticket card */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xl w-full max-w-sm overflow-hidden">

        {/* Header strip */}
        <div className="bg-slate-950 px-6 pt-8 pb-10 text-center relative">
          <div className="absolute top-4 right-4 left-4 flex justify-center">
            <StatusBadge status={status} />
          </div>
          <div className="mt-8">
            <p className="text-teal-200 text-xs uppercase font-semibold mb-1">You're invited to</p>
            <h1 className="text-white text-2xl font-bold leading-tight">{event?.name || 'Event'}</h1>
            <p className="text-slate-300 text-sm mt-1 italic">{event?.couples_name}</p>
            {eventDate && (
              <p className="text-slate-400 text-xs mt-2 font-medium">
                {eventDate.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
            )}
          </div>
        </div>

        {/* Tear-line notches */}
        <div className="relative -mt-4 flex justify-between px-0">
          <div className="w-8 h-8 bg-slate-100 dark:bg-slate-950 rounded-full -ml-4" />
          <div className="flex-1 border-t-2 border-dashed border-slate-200 self-center mx-2 mt-4" />
          <div className="w-8 h-8 bg-slate-100 dark:bg-slate-950 rounded-full -mr-4" />
        </div>

        {/* Body */}
        <div className="px-6 pb-8 pt-2 space-y-5">
          {/* Guest name */}
          <div className="text-center">
            <p className="text-xs uppercase tracking-widest text-slate-400 font-medium mb-0.5">Guest</p>
            <p className="text-slate-800 dark:text-white text-xl font-bold">
              {guest?.first_name} {guest?.last_name}
            </p>
          </div>

          {/* QR code */}
          <div className="flex justify-center">
            <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4 inline-block">
              {guest?.id ? (
                <img
                  src={qrImageUrl}
                  alt="Your QR code"
                  className="w-44 h-44 object-contain"
                  onError={(e) => { e.target.style.display = 'none' }}
                />
              ) : (
                <div className="w-44 h-44 flex items-center justify-center text-slate-300 text-sm">
                  QR not available
                </div>
              )}
            </div>
          </div>

          <p className="text-center text-slate-400 text-xs">
            {status === 'admitted'
              ? 'You have already been checked in.'
              : 'Show this code to the check-in official at the entrance.'}
          </p>

          {/* Admitted banner */}
          {status === 'admitted' && <AdmittedBanner guest={guest} event={event} />}
        </div>
      </div>

      <p className="fixed bottom-4 text-slate-400 text-xs text-center w-full">Powered by EventQR</p>
    </div>
  )
}
