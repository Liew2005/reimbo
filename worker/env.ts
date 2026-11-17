export type Env = {
  DB: D1Database
  RECEIPTS: R2Bucket
  APP_PASSWORD: string
  SESSION_SECRET: string
  RESEND_API_KEY?: string
  REMINDER_EMAIL?: string
}

/** Today in Malaysia time (UTC+8), as YYYY-MM-DD. */
export const todayMY = (): string => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)

export const str = (v: unknown, max = 200): string | null => {
  if (v === null || v === undefined) return null
  const s = String(v).trim().slice(0, max)
  return s === '' ? null : s
}

export const intOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Math.round(Number(v))
  return Number.isFinite(n) && n >= 0 ? n : null
}

export const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
