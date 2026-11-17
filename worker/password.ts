import { Hono } from 'hono'
import type { Env } from './env'
import { b64u, enc, failures, MAX_LOGIN_ATTEMPTS, recordFailure, safeEqual, tooMany } from './authlib'
import { checkSecondFactor, kvDel, kvGet, kvSet } from './twofa'

// Password storage, in-app change, and reset by email.
//  - Until a password is changed in the app, the APP_PASSWORD secret is the password.
//  - After that, a salted PBKDF2 hash in auth_kv wins and the secret is ignored.
//  - Changing or resetting bumps `auth_epoch`, which signs everyone out (see secretFor).
//  - With two-factor on, both change and reset also need an authenticator or backup code,
//    so an email link alone never gets past 2FA.

const ITER = 100_000 // Workers cap PBKDF2 at 100k iterations
const RESET_MS = 15 * 60 * 1000

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b))
const unb64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0))

async function derive(pw: string, salt: Uint8Array, iter: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits'])
  return b64(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256)))
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return `pbkdf2$${ITER}$${b64(salt)}$${await derive(pw, salt, ITER)}`
}

export async function checkPassword(env: Env, input: string): Promise<boolean> {
  const stored = await kvGet(env.DB, 'pw_hash')
  if (!stored) return !!env.APP_PASSWORD && safeEqual(input, env.APP_PASSWORD)
  const [scheme, iter, salt, hash] = stored.split('$')
  if (scheme !== 'pbkdf2' || !iter || !salt || !hash) return false
  return safeEqual(await derive(input, unb64(salt), Number(iter)), hash)
}

async function sha256hex(s: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function setPassword(env: Env, pw: string) {
  await kvSet(env.DB, 'pw_hash', await hashPassword(pw))
  await kvSet(env.DB, 'auth_epoch', String((Number(await kvGet(env.DB, 'auth_epoch')) || 0) + 1))
  await kvDel(env.DB, 'reset_token')
}

async function sendMail(env: Env, subject: string, text: string): Promise<boolean> {
  if (!env.RESEND_API_KEY || !env.REMINDER_EMAIL) return false
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: 'Reimbo <onboarding@resend.dev>', to: [env.REMINDER_EMAIL], subject, text }),
    })
    return r.ok
  } catch {
    return false
  }
}

const changedMail = (env: Env) =>
  sendMail(env, 'Your Reimbo password was changed', 'Your Reimbo password was just changed and all devices were signed out.\n\nIf this was not you, reset it now from the sign-in page ("Forgot password") and turn on two-factor in Setup.')

const weak = (pw: unknown): string | null =>
  typeof pw !== 'string' || pw.length < 1 ? 'Enter a password.' : pw.length > 1000 ? 'That password is too long.' : null

// ---------- public: no session needed ----------
export const passwordPublic = new Hono<{ Bindings: Env }>()

passwordPublic.post('/api/password/forgot', async (c) => {
  if (!c.env.RESEND_API_KEY || !c.env.REMINDER_EMAIL) return c.json({ error: 'Email is not set up on this server, so a reset link cannot be sent.' }, 503)
  const now = Date.now()
  const recent = (JSON.parse((await kvGet(c.env.DB, 'reset_req')) ?? '[]') as number[]).filter((t) => t > now - 3600_000)
  if (recent.length >= 3) return c.json({ error: 'Too many reset emails. Try again in an hour.' }, 429)
  await kvSet(c.env.DB, 'reset_req', JSON.stringify([...recent, now]))

  const token = b64u(crypto.getRandomValues(new Uint8Array(32)))
  await kvSet(c.env.DB, 'reset_token', `${await sha256hex(token)}.${now + RESET_MS}`) // only the newest link works
  const link = `${new URL(c.req.url).origin}/?reset=${token}`
  const sent = await sendMail(c.env, 'Reset your Reimbo password', `Open this link to choose a new password. It works once and expires in 15 minutes.\n\n${link}\n\nIf you did not ask for this, ignore this email. Your password has not changed.`)
  if (!sent) return c.json({ error: 'Could not send the email. Try again in a moment.' }, 503)
  return c.json({ ok: true })
})

passwordPublic.post('/api/password/reset', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const ip = c.req.header('CF-Connecting-IP') || 'unknown'
  const f = await failures(c, ip)
  if (f.n >= MAX_LOGIN_ATTEMPTS) return tooMany(c, f.first)

  const stored = await kvGet(c.env.DB, 'reset_token')
  let valid = false
  if (stored && typeof body.token === 'string') {
    const [hash, exp] = stored.split('.')
    valid = Number(exp) > Date.now() && (await safeEqual(await sha256hex(body.token), hash))
  }
  if (!valid) return recordFailure(c, ip, f.n, 'This reset link is invalid or has expired.')

  const bad = weak(body.password)
  if (bad) return c.json({ error: bad }, 400)

  if (await kvGet(c.env.DB, 'totp_secret')) {
    const code = typeof body.code === 'string' ? body.code : ''
    if (!code.trim()) return c.json({ needs_2fa: true, error: 'Enter your authenticator code to finish.' }, 400)
    if (!(await checkSecondFactor(c.env.DB, code))) return recordFailure(c, ip, f.n, 'Wrong code.')
  }

  await setPassword(c.env, body.password)
  await c.env.DB.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(ip).run()
  await changedMail(c.env)
  return c.json({ ok: true })
})

// ---------- private: behind the session check ----------
export const passwordPrivate = new Hono<{ Bindings: Env }>()

passwordPrivate.post('/api/password/change', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const ip = c.req.header('CF-Connecting-IP') || 'unknown'
  const f = await failures(c, ip)
  if (f.n >= MAX_LOGIN_ATTEMPTS) return tooMany(c, f.first)

  if (typeof body.current !== 'string' || !(await checkPassword(c.env, body.current))) {
    return recordFailure(c, ip, f.n, 'Current password is wrong.')
  }
  const bad = weak(body.next)
  if (bad) return c.json({ error: bad }, 400)
  if (await kvGet(c.env.DB, 'totp_secret')) {
    const code = typeof body.code === 'string' ? body.code : ''
    if (!code.trim()) return c.json({ needs_2fa: true, error: 'Enter your authenticator code to confirm.' }, 400)
    if (!(await checkSecondFactor(c.env.DB, code))) return recordFailure(c, ip, f.n, 'Wrong code.')
  }

  await setPassword(c.env, body.next)
  await c.env.DB.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(ip).run()
  await changedMail(c.env)
  return c.json({ ok: true })
})
