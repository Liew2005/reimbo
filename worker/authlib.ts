import type { Context } from 'hono'
import type { Env } from './env'
import { kvGet } from './twofa'

// Shared by login, password change and password reset: signing, attempt limits, short-lived tokens.
export type Ctx = Context<{ Bindings: Env }>
export const enc = new TextEncoder()

export function b64u(buf: ArrayBuffer | Uint8Array): string {
  let s = ''
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function sign(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64u(await crypto.subtle.sign('HMAC', key, enc.encode(data)))
}

export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([a, b].map((s) => crypto.subtle.digest('SHA-256', enc.encode(s))))
  const x = new Uint8Array(ha)
  const y = new Uint8Array(hb)
  let d = 0
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i]
  return d === 0
}

/**
 * The key that signs session, trusted-device and pending tokens. It includes an epoch counter that a
 * password change or reset bumps, so every existing session and trusted device stops working at once.
 */
export async function secretFor(env: Env): Promise<string> {
  const epoch = await kvGet(env.DB, 'auth_epoch')
  return epoch && epoch !== '0' ? `${env.SESSION_SECRET}:${epoch}` : env.SESSION_SECRET
}

export const MAX_LOGIN_ATTEMPTS = 5
const LOGIN_WINDOW_MS = 15 * 60 * 1000

export async function failures(c: Ctx, ip: string) {
  const now = Date.now()
  await c.env.DB.prepare('DELETE FROM login_attempts WHERE at < ?').bind(now - 24 * 3600 * 1000).run()
  const r = await c.env.DB.prepare('SELECT COUNT(*) AS n, MIN(at) AS first FROM login_attempts WHERE ip = ? AND at > ?')
    .bind(ip, now - LOGIN_WINDOW_MS).first<{ n: number; first: number | null }>()
  return { n: r?.n ?? 0, first: r?.first ?? now }
}

export const tooMany = (c: Ctx, first: number) => {
  const mins = Math.max(1, Math.ceil((first + LOGIN_WINDOW_MS - Date.now()) / 60000))
  return c.json({ error: `Too many attempts. Try again in ${mins} min.` }, 429)
}

export async function recordFailure(c: Ctx, ip: string, n: number, what: string) {
  await c.env.DB.prepare('INSERT INTO login_attempts (ip, at) VALUES (?, ?)').bind(ip, Date.now()).run()
  const left = MAX_LOGIN_ATTEMPTS - (n + 1)
  if (left <= 0) return c.json({ error: 'Too many attempts. Try again in 15 min.' }, 429)
  return c.json({ error: `${what} ${left} ${left === 1 ? 'try' : 'tries'} left.` }, 401)
}

export async function makeToken(secret: string, kind: string, ms: number) {
  const exp = String(Date.now() + ms)
  return `${exp}.${await sign(secret, kind + exp)}`
}

export async function tokenOk(secret: string, kind: string, t: string | undefined) {
  if (!t) return false
  const [exp, sig] = t.split('.')
  return !!exp && !!sig && Number(exp) > Date.now() && (await safeEqual(sig, await sign(secret, kind + exp)))
}
