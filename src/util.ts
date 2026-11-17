import { useEffect, useRef, useState } from 'react'

export const rm = (cents: number) =>
  'RM ' + (cents / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const amountStr = (cents: number) =>
  (cents / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const km = (n: number) => n.toLocaleString('en-MY')

export const today = () => {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const parse = (iso: string) => new Date(iso + 'T00:00:00')
export const fmtDate = (iso: string) => parse(iso).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })
export const fmtDayMon = (iso: string) => parse(iso).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })
export const monthLabel = (ym: string) => parse(ym + '-01').toLocaleDateString('en-MY', { month: 'long', year: 'numeric' })
export const dayNum = (iso: string) => iso.slice(8, 10)
export const monAbbr = (iso: string) => parse(iso).toLocaleDateString('en-MY', { month: 'short' })

/** Shrink phone photos before upload (keeps R2 and mobile data small). PDFs pass through. */
const SMALL_IMAGE = 1.5 * 1024 * 1024

export async function prepareReceipt(file: File): Promise<{ blob: Blob; name: string }> {
  // PDFs and already-small images pass through (so preparing twice is harmless).
  if (!file.type.startsWith('image/') || file.size <= SMALL_IMAGE) return { blob: file, name: file.name }
  let bmp: ImageBitmap | null = null
  let canvas: HTMLCanvasElement | null = null
  try {
    // Decode straight to a smaller size: a 50 MP photo fully decoded is ~200 MB, and a few of those
    // in one session used to exhaust the phone's memory, so later photos failed until a refresh.
    try { bmp = await createImageBitmap(file, { resizeWidth: 1800, resizeQuality: 'medium' }) } catch { bmp = await createImageBitmap(file) }
    const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height))
    const w = Math.max(1, Math.round(bmp.width * scale))
    const h = Math.max(1, Math.round(bmp.height * scale))
    canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h)
    const blob = await new Promise<Blob | null>((res) => canvas!.toBlob(res, 'image/jpeg', 0.82))
    if (blob && blob.size < file.size) return { blob, name: file.name.replace(/\.\w+$/, '') + '.jpg' }
  } catch {
    // fall through to the original file
  } finally {
    bmp?.close()
    if (canvas) { canvas.width = 0; canvas.height = 0 } // hand the canvas memory back right away
  }
  return { blob: file, name: file.name }
}

/** Counts up to the target (and from the previous value on change). Skipped for reduced motion. */
export function useCountUp(target: number, ms = 600): number {
  const [v, setV] = useState(0)
  const prev = useRef(0)
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setV(target)
      prev.current = target
      return
    }
    const from = prev.current
    const start = performance.now()
    let raf = 0
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms)
      const e = 1 - Math.pow(1 - p, 3)
      setV(Math.round(from + (target - from) * e))
      if (p < 1) raf = requestAnimationFrame(tick)
      else prev.current = target
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return v
}

export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
