import { useCallback, useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import { Camera, CameraOff, Keyboard, ScanLine } from 'lucide-react'
import { Field, Input } from './ui'

/**
 * Camera QR scanner.
 *
 * - Camera access is requested only when the user presses "Start camera".
 * - The permission flow is explained up front (no silent prompt).
 * - A manual-entry fallback is always available (older devices, denied
 *   permission, or a camera-less desktop).
 * - The scanned value is treated as an opaque reference: it is validated by
 *   the backend, never trusted client-side.
 */
export default function QRScanner({ onDetected, busy = false, label = 'Scan QR code' }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const frameRef = useRef(null)
  const [state, setState] = useState('idle') // idle | starting | scanning | error | denied
  const [error, setError] = useState('')
  const [manual, setManual] = useState('')
  const [torch, setTorch] = useState(false)

  const stop = useCallback(() => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current)
    frameRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setState('idle')
  }, [])

  useEffect(() => () => stop(), [stop])

  const tick = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
      frameRef.current = requestAnimationFrame(tick)
      return
    }
    const context = canvas.getContext('2d', { willReadFrequently: true })
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    const image = context.getImageData(0, 0, canvas.width, canvas.height)
    const code = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' })
    if (code?.data) {
      onDetected?.(code.data.trim())
      stop()
      return
    }
    frameRef.current = requestAnimationFrame(tick)
  }, [onDetected, stop])

  const start = async () => {
    setError('')
    setState('starting')
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('unsupported')
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
        audio: false,
      })
      streamRef.current = stream
      const video = videoRef.current
      video.srcObject = stream
      await video.play()
      setState('scanning')
      frameRef.current = requestAnimationFrame(tick)
    } catch (err) {
      const denied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError'
      setState(denied ? 'denied' : 'error')
      setError(
        denied
          ? 'Camera permission was blocked. Allow camera access in your browser settings, or use manual entry below.'
          : err?.message === 'unsupported'
            ? 'This browser does not support camera capture. Use manual entry below.'
            : 'The camera could not be started. It may be in use by another application, or the device has no camera.',
      )
    }
  }

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks?.()[0]
    if (!track) return
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch }] })
      setTorch((value) => !value)
    } catch {
      setError('This device does not support the torch control.')
    }
  }

  return (
    <div className="space-y-4">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-ink-200 bg-ink-900">
        <video
          ref={videoRef}
          className="h-full w-full object-cover"
          playsInline
          muted
          aria-label="Camera preview for QR scanning"
        />
        <canvas ref={canvasRef} className="hidden" />

        {state === 'scanning' && (
          <>
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className="h-44 w-44 rounded-2xl border-2 border-teal-300/90 shadow-[0_0_0_9999px_rgba(15,23,42,0.45)]" />
            </div>
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-ink-900/70 px-3 py-2 text-xs text-white">
              <span className="flex items-center gap-1.5">
                <ScanLine className="h-3.5 w-3.5 animate-pulse" aria-hidden="true" /> Align the QR code inside the frame
              </span>
              <button type="button" onClick={toggleTorch} className="rounded border border-white/30 px-2 py-0.5">
                {torch ? 'Torch off' : 'Torch on'}
              </button>
            </div>
          </>
        )}

        {state !== 'scanning' && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center">
            <div className="max-w-sm space-y-3">
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-white/10 text-white">
                {state === 'denied' ? <CameraOff className="h-6 w-6" /> : <Camera className="h-6 w-6" />}
              </span>
              <p className="text-sm font-medium text-white">
                {state === 'starting' ? 'Starting camera…' : 'Camera scanning'}
              </p>
              <p className="text-xs leading-relaxed text-white/70">
                Scanning a staff or patient card only confirms identity. No medical information is
                encoded in the QR code.
              </p>
              {state !== 'starting' && (
                <button type="button" className="btn bg-white text-medical-700 hover:bg-ink-100" onClick={start} disabled={busy}>
                  <Camera className="h-4 w-4" aria-hidden="true" /> Start camera
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {state === 'scanning' && (
        <button type="button" className="btn-outline w-full" onClick={stop}>
          <CameraOff className="h-4 w-4" aria-hidden="true" /> Stop camera
        </button>
      )}

      {error && (
        <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {error}
        </p>
      )}

      <div className="rounded-xl border border-dashed border-ink-300 bg-ink-50/60 p-4">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-600">
          <Keyboard className="h-3.5 w-3.5" aria-hidden="true" /> Manual entry fallback
        </p>
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={(event) => {
            event.preventDefault()
            const value = manual.trim()
            if (value) onDetected?.(value)
          }}
        >
          <Field label="Card reference" htmlFor="manual-card-ref" className="flex-1">
            <Input
              id="manual-card-ref"
              value={manual}
              onChange={(event) => setManual(event.target.value)}
              placeholder="Paste or type the card token / staff ID"
              autoComplete="off"
            />
          </Field>
          <button type="submit" className="btn-primary" disabled={busy || !manual.trim()}>
            {busy ? 'Checking…' : `Resolve ${label.replace('Scan ', '')}`}
          </button>
        </form>
      </div>
    </div>
  )
}
