import { Hono } from 'hono'
import type { Env } from './env'

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const STEP_MS = 30_000
const enc = new TextEncoder()

// ---------- private store ----------
export async function kvGet(db: D1Database, key: string): Promise<string | null> {
  const r = await db.prepare('SELECT value FROM auth_kv WHERE key = ?').bind(key).first<{ value: string }>()
  return r?.value ?? null
}
export async function kvSet(db: D1Database, key: string, value: string) {
  await db.prepare('INSERT INTO auth_kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value).run()
}
export async function kvDel(db: D1Database, ...keys: string[]) {
  for (const k of keys) await db.prepare('DELETE FROM auth_kv WHERE key = ?').bind(k).run()
}

// ---------- TOTP (RFC 6238: SHA-1, 6 digits, 30 s) ----------
function b32encode(bytes: Uint8Array): string {
  let bits = 0, val = 0, out = ''
  for (const b of bytes) {
    val = (val << 8) | b
    bits += 8
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5 }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31]
  return out
}

function b32decode(s: string): Uint8Array {
  let bits = 0, val = 0
  const out: number[] = []
  for (const ch of s.replace(/=+$/, '').toUpperCase()) {
    const i = B32.indexOf(ch)
    if (i < 0) continue
    val = (val << 5) | i
    bits += 5
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8 }
  }
  return new Uint8Array(out)
}

export const newSecret = () => b32encode(crypto.getRandomValues(new Uint8Array(20)))

async function hotp(secret: string, counter: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', b32decode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  const msg = new ArrayBuffer(8)
  new DataView(msg).setBigUint64(0, BigInt(counter))
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg))
  const o = h[19] & 15
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]
  return String(n % 1_000_000).padStart(6, '0')
}

/** Returns the matching time step (current or ±1) that is newer than `afterStep`, else null. */
export async function verifyTotp(secret: string, code: string, afterStep: number): Promise<number | null> {
  if (!/^\d{6}$/.test(code)) return null
  const now = Math.floor(Date.now() / STEP_MS)
  for (const step of [now, now - 1, now + 1]) {
    if (step > afterStep && (await hotp(secret, step)) === code) return step
  }
  return null
}

export const otpauthUri = (secret: string, account: string) =>
  `otpauth://totp/Reimbo:${encodeURIComponent(account)}?secret=${secret}&issuer=Reimbo&algorithm=SHA1&digits=6&period=30`

// ---------- backup codes ----------
async function sha256hex(s: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('')
}
const CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789'
function newBackupCode(): string {
  const r = crypto.getRandomValues(new Uint8Array(8))
  const s = [...r].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join('')
  return s.slice(0, 4) + '-' + s.slice(4)
}
const normBackup = (s: string) => s.trim().toLowerCase().replace(/[\s-]/g, '')

/** Accepts a current authenticator code or an unused backup code. Replay-safe. */
export async function checkSecondFactor(db: D1Database, input: string): Promise<boolean> {
  const secret = await kvGet(db, 'totp_secret')
  if (!secret) return false
  const code = input.trim().replace(/\s/g, '')
  const last = Number(await kvGet(db, 'totp_last_step')) || 0
  const step = await verifyTotp(secret, code, last)
  if (step !== null) {
    await kvSet(db, 'totp_last_step', String(step))
    return true
  }
  const hashes: string[] = JSON.parse((await kvGet(db, 'backup_codes')) ?? '[]')
  const h = await sha256hex(normBackup(input))
  if (!hashes.includes(h)) return false
  await kvSet(db, 'backup_codes', JSON.stringify(hashes.filter((x) => x !== h)))
  return true
}

// ---------- management routes (mounted behind the session check) ----------
const app = new Hono<{ Bindings: Env }>()

app.get('/api/2fa', async (c) => {
  const enabled = !!(await kvGet(c.env.DB, 'totp_secret'))
  const left: string[] = JSON.parse((await kvGet(c.env.DB, 'backup_codes')) ?? '[]')
  return c.json({ enabled, backup_left: enabled ? left.length : 0 })
})

app.post('/api/2fa/setup', async (c) => {
  if (await kvGet(c.env.DB, 'totp_secret')) return c.json({ error: '2FA is already on. Turn it off first.' }, 409)
  const secret = newSecret()
  await kvSet(c.env.DB, 'totp_pending', secret)
  return c.json({ secret, uri: otpauthUri(secret, 'Reimbo') })
})

app.post('/api/2fa/enable', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  const pending = await kvGet(c.env.DB, 'totp_pending')
  if (!pending) return c.json({ error: 'Start setup first' }, 400)
  const step = await verifyTotp(pending, String(b.code ?? '').replace(/\s/g, ''), 0)
  if (step === null) return c.json({ error: 'That code is not right. Check the time on your phone and try the next code.' }, 400)
  const codes = Array.from({ length: 10 }, newBackupCode)
  await kvSet(c.env.DB, 'totp_secret', pending)
  await kvSet(c.env.DB, 'totp_last_step', String(step))
  await kvSet(c.env.DB, 'backup_codes', JSON.stringify(await Promise.all(codes.map((x) => sha256hex(normBackup(x))))))
  await kvDel(c.env.DB, 'totp_pending')
  return c.json({ backup_codes: codes })
})

app.post('/api/2fa/disable', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  if (!(await checkSecondFactor(c.env.DB, String(b.code ?? '')))) return c.json({ error: 'Wrong code' }, 400)
  await kvDel(c.env.DB, 'totp_secret', 'totp_pending', 'totp_last_step', 'backup_codes')
  return c.json({ ok: true })
})

export default app
