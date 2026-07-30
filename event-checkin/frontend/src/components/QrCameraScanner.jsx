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
  const name = error?.name || ''
  const lines = [`Camera blocked (${name || error?.message || 'unknown'}).`]
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    lines.push('Allow camera access for this site in the browser settings, then reload.')
  } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    lines.push('No compatible camera was found on this device.')
  } else if (name === 'NotReadableError') {
    lines.push('Another app may be using the camera. Close it and retry.')
  }
  return lines.join('\n')
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

    let probe
    try {
      try {
        probe = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      } catch {
        probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      }
      probe.getTracks().forEach((track) => track.stop())
      const devices = await Html5Qrcode.getCameras()
      if (!devices.length) throw new Error('No camera detected on this device.')
      setCameras(devices)
      const preferred = devices.find((device) => /back|rear|environment/i.test(device.label)) || devices.at(-1)
      setCameraId(preferred.id)
      await beginWebScanner(preferred.id)
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
      await beginWebScanner(nextId)
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
