import { Hono, type Context } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import serviceApp from './service'
import claimsApp from './claims'
import backupApp, { runBackup } from './backup'
import { runReminders } from './reminders'
import twofaApp, { checkSecondFactor, kvGet } from './twofa'
import { failures, makeToken, MAX_LOGIN_ATTEMPTS, recordFailure, safeEqual, secretFor, sign, tokenOk, tooMany, type Ctx } from './authlib'
import { checkPassword, passwordPrivate, passwordPublic } from './password'

type Env = {
  DB: D1Database
  RECEIPTS: R2Bucket
  APP_PASSWORD: string
  SESSION_SECRET: string
  RESEND_API_KEY?: string
  REMINDER_EMAIL?: string
}

const app = new Hono<{ Bindings: Env }>()

const CATEGORIES = ['service', 'parts', 'addon', 'fuel', 'toll_parking', 'insurance', 'road_tax', 'other']
const MAX_RECEIPT_BYTES = 10 * 1024 * 1024
const SESSION_MS = 30 * 24 * 3600 * 1000

// ---------- auth (single user, shared password -> signed cookie) ----------
const TRUST_MS = 30 * 24 * 3600 * 1000
const PENDING_MS = 5 * 60 * 1000

async function startSession(c: Ctx, ip: string, trust: boolean) {
  const secret = await secretFor(c.env)
  await c.env.DB.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(ip).run()
  const secure = new URL(c.req.url).protocol === 'https:'
  const exp = String(Date.now() + SESSION_MS)
  setCookie(c, 'session', `${exp}.${await sign(secret, exp)}`, { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: SESSION_MS / 1000, secure })
  deleteCookie(c, 'pending', { path: '/' })
  if (trust) setCookie(c, 'trusted', await makeToken(secret, 't', TRUST_MS), { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: TRUST_MS / 1000, secure })
  return c.json({ ok: true })
}

app.route('/', passwordPublic)

app.post('/api/login', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  if (!c.env.SESSION_SECRET) return c.json({ error: 'Server not configured' }, 500)
  const secret = await secretFor(c.env)
  const ip = c.req.header('CF-Connecting-IP') || 'unknown'
  const f = await failures(c, ip)
  if (f.n >= MAX_LOGIN_ATTEMPTS) return tooMany(c, f.first)
  if (typeof body.password !== 'string' || !(await checkPassword(c.env, body.password))) {
    return recordFailure(c, ip, f.n, 'Wrong password.')
  }
  if (await kvGet(c.env.DB, 'totp_secret')) {
    if (await tokenOk(secret, 't', getCookie(c, 'trusted'))) return startSession(c, ip, false)
    const secure = new URL(c.req.url).protocol === 'https:'
    setCookie(c, 'pending', await makeToken(secret, 'p', PENDING_MS), { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: PENDING_MS / 1000, secure })
    return c.json({ needs_2fa: true })
  }
  return startSession(c, ip, false)
})

app.post('/api/login/2fa', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  if (!c.env.SESSION_SECRET) return c.json({ error: 'Server not configured' }, 500)
  const ip = c.req.header('CF-Connecting-IP') || 'unknown'
  const f = await failures(c, ip)
  if (f.n >= MAX_LOGIN_ATTEMPTS) return tooMany(c, f.first)
  if (!(await tokenOk(await secretFor(c.env), 'p', getCookie(c, 'pending')))) {
    return c.json({ error: 'Session expired. Enter your password again.' }, 401)
  }
  if (typeof body.code !== 'string' || !(await checkSecondFactor(c.env.DB, body.code))) {
    return recordFailure(c, ip, f.n, 'Wrong code.')
  }
  return startSession(c, ip, !!body.trust)
})

app.post('/api/logout', (c) => {
  deleteCookie(c, 'session', { path: '/' })
  return c.json({ ok: true })
})

app.use('/api/*', async (c, next) => {
  const token = getCookie(c, 'session')
  if (token) {
    const [exp, sig] = token.split('.')
    if (exp && sig && Number(exp) > Date.now() && (await safeEqual(sig, await sign(await secretFor(c.env), exp)))) {
      return next()
    }
  }
  return c.json({ error: 'Unauthorized' }, 401)
})

app.get('/api/me', (c) => c.json({ ok: true }))

// ---------- helpers ----------
const str = (v: unknown, max = 200): string | null => {
  if (v === null || v === undefined) return null
  const s = String(v).trim().slice(0, max)
  return s === '' ? null : s
}

// ---------- cars ----------
app.get('/api/cars', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM cars ORDER BY archived, name').all()
  return c.json(results)
})

app.post('/api/cars', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  const name = str(b.name, 80)
  if (!name) return c.json({ error: 'Name required' }, 400)
  const r = await c.env.DB.prepare('INSERT INTO cars (name, plate, notes) VALUES (?, ?, ?)')
    .bind(name, str(b.plate, 20), str(b.notes, 500))
    .run()
  return c.json({ id: r.meta.last_row_id })
})

app.put('/api/cars/:id', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  const name = str(b.name, 80)
  if (!name) return c.json({ error: 'Name required' }, 400)
  await c.env.DB.prepare('UPDATE cars SET name=?, plate=?, notes=?, archived=? WHERE id=?')
    .bind(name, str(b.plate, 20), str(b.notes, 500), b.archived ? 1 : 0, Number(c.req.param('id')))
    .run()
  return c.json({ ok: true })
})

// ---------- payment methods ----------
app.get('/api/payment-methods', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM payment_methods ORDER BY archived, id').all()
  return c.json(results)
})

app.post('/api/payment-methods', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  const name = str(b.name, 60)
  if (!name) return c.json({ error: 'Name required' }, 400)
  const r = await c.env.DB.prepare('INSERT INTO payment_methods (name, claimable) VALUES (?, ?)')
    .bind(name, b.claimable ? 1 : 0)
    .run()
  return c.json({ id: r.meta.last_row_id })
})

app.put('/api/payment-methods/:id', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  const name = str(b.name, 60)
  if (!name) return c.json({ error: 'Name required' }, 400)
  await c.env.DB.prepare('UPDATE payment_methods SET name=?, claimable=?, archived=? WHERE id=?')
    .bind(name, b.claimable ? 1 : 0, b.archived ? 1 : 0, Number(c.req.param('id')))
    .run()
  return c.json({ ok: true })
})

// ---------- expenses ----------
type ExpenseInput = {
  car_id: number
  payment_method_id: number
  date: string
  amount_cents: number
  category: string
  vendor: string | null
  odometer_km: number | null
  note: string | null
}

function parseExpense(b: any): { value?: ExpenseInput; error?: string } {
  const car_id = Number(b.car_id)
  const payment_method_id = Number(b.payment_method_id)
  const amount_cents = Math.round(Number(b.amount_cents))
  if (!Number.isInteger(car_id) || car_id <= 0) return { error: 'Pick a car' }
  if (!Number.isInteger(payment_method_id) || payment_method_id <= 0) return { error: 'Pick a payment method' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.date))) return { error: 'Invalid date' }
  if (!Number.isFinite(amount_cents) || amount_cents <= 0) return { error: 'Amount must be more than 0' }
  if (!CATEGORIES.includes(b.category)) return { error: 'Invalid category' }
  let odometer_km: number | null = null
  if (b.odometer_km !== null && b.odometer_km !== undefined && b.odometer_km !== '') {
    odometer_km = Math.round(Number(b.odometer_km))
    if (!Number.isFinite(odometer_km) || odometer_km < 0) return { error: 'Invalid odometer' }
  }
  return {
    value: {
      car_id,
      payment_method_id,
      date: String(b.date),
      amount_cents,
      category: b.category,
      vendor: str(b.vendor, 120),
      odometer_km,
      note: str(b.note, 1000),
    },
  }
}

const EXPENSE_SELECT = `
  SELECT e.*, c.name AS car_name, c.plate AS car_plate,
         p.name AS payment_method_name, p.claimable AS claimable,
         (SELECT COUNT(*) FROM receipts r WHERE r.expense_id = e.id) AS receipt_count,
         (SELECT status FROM claims WHERE id = e.claim_id) AS claim_status
  FROM expenses e
  JOIN cars c ON c.id = e.car_id
  JOIN payment_methods p ON p.id = e.payment_method_id`

app.get('/api/expenses', async (c) => {
  const q = c.req.query()
  const where: string[] = []
  const args: unknown[] = []
  if (q.car_id) { where.push('e.car_id = ?'); args.push(Number(q.car_id)) }
  if (q.payment_method_id) { where.push('e.payment_method_id = ?'); args.push(Number(q.payment_method_id)) }
  if (q.from) { where.push('e.date >= ?'); args.push(q.from) }
  if (q.to) { where.push('e.date <= ?'); args.push(q.to) }
  if (q.status === 'unclaimed') where.push('e.claim_id IS NULL AND p.claimable = 1')
  if (q.status === 'claimed') where.push('e.claim_id IS NOT NULL')
  const sql = `${EXPENSE_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY e.date DESC, e.id DESC LIMIT 2000`
  const { results } = await c.env.DB.prepare(sql).bind(...args).all()
  return c.json(results)
})

app.get('/api/expenses/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const expense = await c.env.DB.prepare(`${EXPENSE_SELECT} WHERE e.id = ?`).bind(id).first()
  if (!expense) return c.json({ error: 'Not found' }, 404)
  const { results: receipts } = await c.env.DB.prepare(
    'SELECT id, content_type, size_bytes FROM receipts WHERE expense_id = ? ORDER BY id',
  ).bind(id).all()
  return c.json({ ...expense, receipts })
})

app.post('/api/expenses', async (c) => {
  const { value, error } = parseExpense(await c.req.json().catch(() => ({})))
  if (!value) return c.json({ error }, 400)
  const r = await c.env.DB.prepare(
    'INSERT INTO expenses (car_id, payment_method_id, date, amount_cents, category, vendor, odometer_km, note) VALUES (?,?,?,?,?,?,?,?)',
  ).bind(value.car_id, value.payment_method_id, value.date, value.amount_cents, value.category, value.vendor, value.odometer_km, value.note).run()
  return c.json({ id: r.meta.last_row_id })
})

app.put('/api/expenses/:id', async (c) => {
  { const lock = await lockedMsg(c.env.DB, Number(c.req.param('id'))); if (lock) return c.json({ error: lock }, 409) }
  const { value, error } = parseExpense(await c.req.json().catch(() => ({})))
  if (!value) return c.json({ error }, 400)
  await c.env.DB.prepare(
    'UPDATE expenses SET car_id=?, payment_method_id=?, date=?, amount_cents=?, category=?, vendor=?, odometer_km=?, note=? WHERE id=?',
  ).bind(value.car_id, value.payment_method_id, value.date, value.amount_cents, value.category, value.vendor, value.odometer_km, value.note, Number(c.req.param('id'))).run()
  return c.json({ ok: true })
})

app.delete('/api/expenses/:id', async (c) => {
  const id = Number(c.req.param('id'))
  { const lock = await lockedMsg(c.env.DB, id); if (lock) return c.json({ error: lock }, 409) }
  const { results } = await c.env.DB.prepare('SELECT r2_key FROM receipts WHERE expense_id = ?').bind(id).all<{ r2_key: string }>()
  if (results.length) await c.env.RECEIPTS.delete(results.map((r) => r.r2_key))
  await c.env.DB.prepare('DELETE FROM expenses WHERE id = ?').bind(id).run()
  return c.json({ ok: true })
})

// ---------- receipts ----------
app.post('/api/expenses/:id/receipts', async (c) => {
  const id = Number(c.req.param('id'))
  { const lock = await lockedMsg(c.env.DB, id); if (lock) return c.json({ error: lock }, 409) }
  const exists = await c.env.DB.prepare('SELECT id FROM expenses WHERE id = ?').bind(id).first()
  if (!exists) return c.json({ error: 'Expense not found' }, 404)
  const form = await c.req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) return c.json({ error: 'No file' }, 400)
  if (!(file.type.startsWith('image/') || file.type === 'application/pdf')) return c.json({ error: 'Images or PDF only' }, 400)
  if (file.size > MAX_RECEIPT_BYTES) return c.json({ error: 'File over 10 MB' }, 400)
  const key = `expenses/${id}/${crypto.randomUUID()}`
  await c.env.RECEIPTS.put(key, file.stream(), { httpMetadata: { contentType: file.type } })
  const r = await c.env.DB.prepare('INSERT INTO receipts (expense_id, r2_key, content_type, size_bytes) VALUES (?,?,?,?)')
    .bind(id, key, file.type, file.size).run()
  return c.json({ id: r.meta.last_row_id })
})

app.get('/api/receipts/:id', async (c) => {
  const row = await c.env.DB.prepare('SELECT r2_key, content_type FROM receipts WHERE id = ?')
    .bind(Number(c.req.param('id'))).first<{ r2_key: string; content_type: string }>()
  if (!row) return c.json({ error: 'Not found' }, 404)
  const obj = await c.env.RECEIPTS.get(row.r2_key)
  if (!obj) return c.json({ error: 'File missing' }, 404)
  return new Response(obj.body, {
    headers: { 'Content-Type': row.content_type || 'application/octet-stream', 'Cache-Control': 'private, max-age=86400' },
  })
})

app.delete('/api/receipts/:id', async (c) => {
  const id = Number(c.req.param('id'))
  { const lock = await lockedByReceipt(c.env.DB, id); if (lock) return c.json({ error: lock }, 409) }
  const row = await c.env.DB.prepare('SELECT r2_key FROM receipts WHERE id = ?').bind(id).first<{ r2_key: string }>()
  if (row) await c.env.RECEIPTS.delete(row.r2_key)
  await c.env.DB.prepare('DELETE FROM receipts WHERE id = ?').bind(id).run()
  return c.json({ ok: true })
})

// ---------- summary ----------
app.get('/api/summary/unclaimed', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT c.id AS car_id, c.name AS car_name, COUNT(*) AS n, SUM(e.amount_cents) AS total_cents
     FROM expenses e JOIN cars c ON c.id = e.car_id JOIN payment_methods p ON p.id = e.payment_method_id
     WHERE e.claim_id IS NULL AND p.claimable = 1 GROUP BY c.id ORDER BY c.name`,
  ).all()
  return c.json(results)
})

async function lockedMsg(db: D1Database, expenseId: number): Promise<string | null> {
  const r = await db
    .prepare('SELECT cl.status, cl.claim_no FROM expenses e JOIN claims cl ON cl.id = e.claim_id WHERE e.id = ?')
    .bind(expenseId)
    .first<{ status: string; claim_no: string }>()
  return r && r.status !== 'draft' ? `In claim ${r.claim_no} (${r.status}). Move the claim back to draft to edit.` : null
}

async function lockedByReceipt(db: D1Database, receiptId: number): Promise<string | null> {
  const r = await db.prepare('SELECT expense_id FROM receipts WHERE id = ?').bind(receiptId).first<{ expense_id: number }>()
  return r ? lockedMsg(db, r.expense_id) : null
}

app.route('/', serviceApp)
app.route('/', claimsApp)
app.route('/', twofaApp)
app.route('/', passwordPrivate)
app.route('/', backupApp)

app.notFound((c) => c.json({ error: 'Not found' }, 404))

export default {
  fetch: app.fetch,
  scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    // Sunday cron = weekly backup, daily cron = service reminder email
    ctx.waitUntil(event.cron.includes('SUN') ? runBackup(env) : runReminders(env).catch((e) => console.error('reminders failed', e)))
  },
}
