import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'

// In the Capacitor native app the web is served from https://localhost, so the
// app's relative `/api/...` calls must be redirected to the real backend. This
// is set only for mobile builds (VITE_API_ORIGIN); it is a strict no-op on the
// web where the value is empty, so browser behavior is unchanged.
const API_ORIGIN = import.meta.env.VITE_API_ORIGIN || ''
if (API_ORIGIN) {
  const _fetch = window.fetch.bind(window)
  window.fetch = (input, init) => {
    if (typeof input === 'string' && input.startsWith('/api')) {
      input = API_ORIGIN + input
    }
    return _fetch(input, init)
  }
}

// A manifest has one start URL per domain. When a guest installs from their
// personal Hub, remember that safe-on-this-device route so the installed app
// returns to their pass rather than the Festio home page.
if (new URLSearchParams(window.location.search).get('guesthub') === '1') {
  try {
    const savedHub = localStorage.getItem('festio:installed-guest-hub')
    if (savedHub && savedHub.startsWith('/')) window.location.replace(savedHub)
  } catch { /* storage can be unavailable in private browsing */ }
}

// The Guest Hub is a Progressive Web App. Registering this small worker makes
// the pass installable and retains the guest's QR image for weak venue Wi-Fi.
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/guesthub-sw.js?v=2').catch(() => {
      // Installing the app is optional; the browser experience stays usable.
    })
  })
}

// Keep Chrome/Android's install event until the Guest Hub has loaded. The
// browser may dispatch it before the guest-specific React view mounts.
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault()
  window.__festioInstallPrompt = event
  window.dispatchEvent(new Event('festio-install-ready'))
})

class RootErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Festio UI crashed', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="min-h-screen bg-slate-950 p-6 text-slate-100">
        <div className="mx-auto mt-20 max-w-2xl rounded-xl border border-red-900 bg-red-950/30 p-5">
          <h1 className="text-lg font-bold text-red-100">Festio could not render this page</h1>
          <p className="mt-2 text-sm text-red-100/80">
            Refresh the page. If it continues, share this error:
          </p>
          <pre className="mt-4 max-h-80 overflow-auto rounded-lg bg-black/40 p-3 text-xs text-red-50">
            {String(this.state.error?.stack || this.state.error?.message || this.state.error)}
          </pre>
        </div>
      </div>
    )
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <RootErrorBoundary>
        <App />
      </RootErrorBoundary>
    </BrowserRouter>
  </React.StrictMode>
)
