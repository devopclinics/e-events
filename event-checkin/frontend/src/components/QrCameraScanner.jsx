import { useEffect, useId, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { Html5Qrcode } from 'html5-qrcode'

function secureContextHelp() {
  return [
    'Camera is unavailable in this browser context.',
    `Current address: ${window.location.protocol}//${window.location.host}`,
    'Mobile browsers require HTTPS for camera access, except on localhost.',
  ].join('\n')
}

function cameraHelp(error) {
  if (typeof error === 'string') return `Camera blocked: ${error}`
  const name = error?.name || ''
  // Only DOMException-style names carry real signal — a plain Error (our own
  // timeout/validation errors) has name 'Error' by default, which would
  // otherwise bury our actual, more specific .message behind "(Error)".
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return `Camera blocked (${name}).\nAllow camera access for this site in the browser settings, then reload.`
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return `Camera blocked (${name}).\nNo compatible camera was found on this device.`
  }
  if (name === 'NotReadableError') {
    return `Camera blocked (${name}).\nAnother app may be using the camera. Close it and retry.`
  }
  return error?.message || `Camera blocked (${name || 'unknown'}).`
}

// getUserMedia/enumerateDevices have no native timeout — a browser or OS
// media stack that gets stuck leaves the caller waiting forever with no
// error and no way out except a reload. Guard every camera-acquisition step
// with a hard ceiling so that always surfaces as a real, actionable error.
function withTimeout(promise, ms, message) {
  let timer
  const timeout = new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), ms) })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

export default function QrCameraScanner({ onScan, disabled = false }) {
  const reactId = useId()
  const elementId = `qr-camera-${reactId.replaceAll(':', '')}`
  const scannerRef = useRef(null)
  const [running, setRunning] = useState(false)
  const [starting, setStarting] = useState(false)
  const [cameras, setCameras] = useState([])
  const [cameraId, setCameraId] = useState('')
  const [error, setError] = useState('')

  async function stopCamera() {
    const scanner = scannerRef.current
    scannerRef.current = null
    if (!scanner) return
    try { await scanner.stop() } catch { /* already stopped */ }
    try { await scanner.clear() } catch { /* already cleared */ }
  }

  useEffect(() => () => { stopCamera() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function beginWebScanner(id) {
    const scanner = new Html5Qrcode(elementId)
    scannerRef.current = scanner
    await scanner.start(
      id,
      { fps: 10, qrbox: { width: 250, height: 250 } },
      async (value) => {
        await stopCamera()
        setRunning(false)
        onScan(value)
      },
      () => {},
    )
    setRunning(true)
  }

  async function startCamera() {
    if (starting || disabled) return
    setStarting(true)
    setError('')
    if (Capacitor.isNativePlatform()) {
      try {
        const { BarcodeScanner, BarcodeFormat } = await import('@capacitor-mlkit/barcode-scanning')
        const permission = await BarcodeScanner.requestPermissions()
        if (!['granted', 'limited'].includes(permission.camera)) throw new Error('Camera permission denied. Enable it in Settings to scan.')
        const { barcodes } = await BarcodeScanner.scan({ formats: [BarcodeFormat.QrCode] })
        if (barcodes?.[0]?.rawValue) onScan(barcodes[0].rawValue)
      } catch (e) {
        setError(e?.message || 'Scanner failed')
      } finally {
        setStarting(false)
      }
      return
    }

    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError(secureContextHelp())
      setStarting(false)
      return
    }

    try {
      // iOS Safari requires getUserMedia() to be called synchronously inside
      // the click gesture — this probe is that call. html5-qrcode opens its
      // own stream afterward; this one is only to secure the permission grant
      // before handing off. getUserMedia/enumerateDevices have no native
      // timeout, so every step here is timeout-guarded: a stuck browser/OS
      // media stack previously left "Requesting camera…" spinning forever
      // with no way out but a reload.
      let probe
      try {
        probe = await withTimeout(
          navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }),
          15000, 'Camera permission request timed out. Check for a pending browser permission prompt, or reload and try again.')
      } catch {
        probe = await withTimeout(
          navigator.mediaDevices.getUserMedia({ video: true, audio: false }),
          15000, 'Camera permission request timed out. Check for a pending browser permission prompt, or reload and try again.')
      }
      probe.getTracks().forEach((track) => track.stop())
      const devices = await withTimeout(Html5Qrcode.getCameras(), 15000,
        'Listing cameras timed out. Reload and try again.')
      if (!devices.length) throw new Error('No camera detected on this device.')
      setCameras(devices)
      const preferred = devices.find((device) => /back|rear|environment/i.test(device.label)) || devices.at(-1)
      setCameraId(preferred.id)
      await withTimeout(beginWebScanner(preferred.id), 15000,
        'Camera failed to start in time. Reload and try again.')
    } catch (e) {
      setError(cameraHelp(e))
    } finally {
      setStarting(false)
    }
  }

  async function switchCamera(nextId) {
    if (!nextId || nextId === cameraId) return
    setError('')
    try {
      await stopCamera()
      setCameraId(nextId)
      await withTimeout(beginWebScanner(nextId), 15000, 'Camera failed to switch in time. Reload and try again.')
    } catch (e) {
      setRunning(false)
      setError(cameraHelp(e))
    }
  }

  return (
    <div className="sc-camera-live">
      <div id={elementId} className="sc-camera-reader" />
      {!running && (
        <button type="button" className="rr-btn primary" disabled={starting || disabled} onClick={startCamera}>
          {starting ? 'Requesting camera…' : 'Start camera'}
        </button>
      )}
      {running && cameras.length > 1 && (
        <select className="sc-selector" aria-label="Camera" value={cameraId} onChange={(event) => switchCamera(event.target.value)}>
          {cameras.map((camera) => <option key={camera.id} value={camera.id}>{camera.label || camera.id}</option>)}
        </select>
      )}
      {error && <p className="sc-camera-error" role="alert">{error}</p>}
    </div>
  )
}
