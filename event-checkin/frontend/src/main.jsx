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

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)
