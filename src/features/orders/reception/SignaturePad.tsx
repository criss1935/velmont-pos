import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui'
import styles from './Reception.module.css'

/**
 * Firma manuscrita del cliente.
 *
 * Canvas + Pointer Events: el mismo código sirve para dedo, stylus y mouse (para
 * pruebas). Al terminar cada trazo se exporta un PNG y se entrega al padre —
 * nunca se guarda como string gigante: se sube a Storage y en la orden solo
 * queda la ruta.
 */
export function SignaturePad({
  onChange,
}: {
  onChange: (result: { blob: Blob; url: string } | null) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)
  const [hasInk, setHasInk] = useState(false)

  // El canvas se dimensiona a su tamaño real en píxeles (con devicePixelRatio)
  // para que la firma no salga borrosa en la tablet.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ratio = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * ratio
    canvas.height = rect.height * ratio
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.scale(ratio, ratio)
      ctx.lineWidth = 2.4
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = '#f4efe6'
    }
  }, [])

  function pos(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId)
    drawing.current = true
    last.current = pos(event)
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx || !last.current) return
    const p = pos(event)
    ctx.beginPath()
    ctx.moveTo(last.current.x, last.current.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    last.current = p
    setHasInk(true)
  }

  function end() {
    if (!drawing.current) return
    drawing.current = false
    last.current = null
    emit()
  }

  function emit() {
    canvasRef.current?.toBlob((blob) => {
      if (blob) onChange({ blob, url: URL.createObjectURL(blob) })
    }, 'image/png')
  }

  function clear() {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasInk(false)
    onChange(null)
  }

  return (
    <div className={styles.signature}>
      <div className={styles.signatureFrame}>
        <canvas
          ref={canvasRef}
          className={styles.signatureCanvas}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          onPointerCancel={end}
        />
        {!hasInk && <span className={styles.signatureHint}>Firma aquí</span>}
        <span className={styles.signatureLine} aria-hidden />
      </div>
      <div className={styles.signatureActions}>
        <Button variant="ghost" size="sm" onClick={clear} disabled={!hasInk}>
          Borrar y firmar de nuevo
        </Button>
      </div>
    </div>
  )
}
