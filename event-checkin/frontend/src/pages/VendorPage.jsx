import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api'

// Public, read-only packing list for a vendor. Reached via the shipment's
// unguessable share_token (no login). Opening it marks the shipment "viewed".
export default function VendorPage() {
  const { token } = useParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    api.getVendorPage(token)
      .then(setData)
      .catch((e) => setError(e.message || 'Shipping list not found'))
      .finally(() => setLoading(false))
  }, [token])

  function addr(l) {
    return [l.ship_address1, l.ship_address2, l.ship_city, l.ship_state, l.ship_postal, l.ship_country].filter(Boolean).join(', ')
  }

  if (loading) {
    return <div className="min-h-screen grid place-items-center text-slate-500">Loading…</div>
  }
  if (error) {
    return (
      <div className="min-h-screen grid place-items-center px-4">
        <div className="text-center">
          <div className="text-4xl mb-3">📦</div>
          <p className="text-slate-600">{error}</p>
        </div>
      </div>
    )
  }

  const lines = data.lines || []
  const withAddr = lines.filter((l) => l.has_address).length

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 py-8 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-2">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              📦 {data.shipment_name}
              <span className={`text-xs font-semibold px-2 py-0.5 rounded ${data.phase === 'post' ? 'bg-purple-100 text-purple-700' : 'bg-teal-100 text-teal-700'}`}>
                {data.phase === 'post' ? 'Post-event' : 'Pre-event'}
              </span>
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">{data.event_name} · {lines.length} recipient(s) · {withAddr} with address</p>
          </div>
          <button onClick={() => api.downloadVendorXlsx(token, `${data.shipment_name}.xlsx`)}
            className="bg-teal-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-teal-700">
            ⬇ Download spreadsheet
          </button>
        </div>

        {data.notes && (
          <div className="bg-white border-l-4 border-teal-600 rounded-r-lg px-4 py-3 text-sm text-slate-700 mb-4">{data.notes}</div>
        )}

        <div className="bg-white rounded-xl shadow overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-xs font-semibold text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-2 text-left">#</th>
                <th className="px-4 py-2 text-left">Recipient</th>
                <th className="px-4 py-2 text-left">Phone</th>
                <th className="px-4 py-2 text-left">Address</th>
                <th className="px-4 py-2 text-left">Item</th>
                {data.collect_size && <th className="px-4 py-2 text-center">Size</th>}
                <th className="px-4 py-2 text-center">Qty</th>
                <th className="px-4 py-2 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((l, i) => (
                <tr key={l.guest_id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 text-slate-400">{i + 1}</td>
                  <td className="px-4 py-2.5 font-medium whitespace-nowrap">{l.first_name} {l.last_name}</td>
                  <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{l.phone || '—'}</td>
                  <td className={`px-4 py-2.5 ${l.has_address ? 'text-slate-700' : 'text-amber-500 italic'}`}>{l.has_address ? addr(l) : 'No address yet'}</td>
                  <td className="px-4 py-2.5 text-slate-700">{l.item || data.shipment_name}</td>
                  {data.collect_size && <td className="px-4 py-2.5 text-center">{l.size || '—'}</td>}
                  <td className="px-4 py-2.5 text-center">{l.quantity}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${l.ship_status === 'delivered' ? 'bg-green-100 text-green-700' : l.ship_status === 'shipped' ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-600'}`}>{l.ship_status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-slate-400 text-center mt-4">Shared securely via EventQR · read-only</p>
      </div>
    </div>
  )
}
