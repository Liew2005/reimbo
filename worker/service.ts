import { Hono } from 'hono'
import { type Env, intOrNull, isDate, str, todayMY } from './env'

const app = new Hono<{ Bindings: Env }>()

const DAY = 86400000
const toMs = (d: string) => Date.parse(d + 'T00:00:00Z')
const daysBetween = (a: string, b: string) => Math.round((toMs(b) - toMs(a)) / DAY)

function addMonths(d: string, months: number): string {
  const [y, m, day] = d.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1 + months, 1))
  const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate()
  dt.setUTCDate(Math.min(day, last))
  return dt.toISOString().slice(0, 10)
}

type Odo = { km: number; date: string; source: string } | null

async function currentOdometer(db: D1Database, carId: number): Promise<Odo> {
  const row = await db
    .prepare(
      `SELECT km, date, source FROM (
         SELECT km, date, 'reading' AS source FROM odometer_readings WHERE car_id = ?1
         UNION ALL
         SELECT odometer_km AS km, date, 'expense' AS source FROM expenses WHERE car_id = ?1 AND odometer_km IS NOT NULL
       ) ORDER BY km DESC, date DESC LIMIT 1`,
    )
    .bind(carId)
    .first<{ km: number; date: string; source: string }>()
  return row ?? null
}

type ReminderRow = {
  id: number
  car_id: number
  name: string
  interval_km: number | null
  interval_months: number | null
  last_done_date: string | null
  last_done_km: number | null
}

function computeReminder(r: ReminderRow, odo: Odo, today: string) {
  const next_km = r.interval_km && r.last_done_km !== null ? r.last_done_km + r.interval_km : null
  const next_date = r.interval_months && r.last_done_date ? addMonths(r.last_done_date, r.interval_months) : null
  const km_left = next_km !== null && odo ? next_km - odo.km : null
  const days_left = next_date ? daysBetween(today, next_date) : null

  let status: 'ok' | 'soon' | 'overdue' | 'unknown' = 'ok'
  if (km_left === null && days_left === null) status = 'unknown'
  else if ((km_left !== null && km_left < 0) || (days_left !== null && days_left < 0)) status = 'overdue'
  else if ((km_left !== null && km_left <= 1000) || (days_left !== null && days_left <= 30)) status = 'soon'

  const parts: number[] = []
  if (km_left !== null && r.interval_km) parts.push(1 - km_left / r.interval_km)
  if (days_left !== null && r.last_done_date && next_date) {
    const total = daysBetween(r.last_done_date, next_date)
    if (total > 0) parts.push(1 - days_left / total)
  }
  const progress = parts.length ? Math.max(0, Math.min(1, Math.max(...parts))) : 0
  return { ...r, next_km, next_date, km_left, days_left, status, progress }
}

/** Overdue and due-soon reminders across every active car (used by the daily email job). */
export async function dueReminders(db: D1Database) {
  const { results: cars } = await db.prepare('SELECT id, name FROM cars WHERE archived = 0').all<{ id: number; name: string }>()
  const today = todayMY()
  const out: (ReturnType<typeof computeReminder> & { car_name: string })[] = []
  for (const car of cars) {
    const odo = await currentOdometer(db, car.id)
    const { results } = await db.prepare(
      'SELECT id, car_id, name, interval_km, interval_months, last_done_date, last_done_km FROM service_reminders WHERE car_id = ? AND archived = 0',
    ).bind(car.id).all<ReminderRow>()
    for (const r of results) {
      const x = computeReminder(r, odo, today)
      if (x.status === 'overdue' || x.status === 'soon') out.push({ ...x, car_name: car.name })
    }
  }
  return out
}

app.get('/api/service', async (c) => {
  const carId = Number(c.req.query('car_id'))
  if (!Number.isInteger(carId) || carId <= 0) return c.json({ error: 'car_id required' }, 400)
  const odo = await currentOdometer(c.env.DB, carId)
  const { results } = await c.env.DB.prepare(
    'SELECT id, car_id, name, interval_km, interval_months, last_done_date, last_done_km FROM service_reminders WHERE car_id = ? AND archived = 0 ORDER BY id',
  ).bind(carId).all<ReminderRow>()
  const today = todayMY()
  const reminders = results.map((r) => computeReminder(r, odo, today))
  const rank = { overdue: 0, soon: 1, unknown: 2, ok: 3 } as const
  reminders.sort((a, b) => rank[a.status] - rank[b.status] || b.progress - a.progress)
  return c.json({ odometer: odo, reminders, today })
})

app.post('/api/odometer', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  const carId = Number(b.car_id)
  const km = intOrNull(b.km)
  const date = isDate(b.date) ? b.date : todayMY()
  if (!Number.isInteger(carId) || carId <= 0 || km === null) return c.json({ error: 'Car and km required' }, 400)
  await c.env.DB.prepare('INSERT INTO odometer_readings (car_id, date, km) VALUES (?,?,?)').bind(carId, date, km).run()
  return c.json({ ok: true })
})

function parseReminder(b: any): { v?: Omit<ReminderRow, 'id'>; error?: string } {
  const name = str(b.name, 80)
  const car_id = Number(b.car_id)
  const interval_km = intOrNull(b.interval_km) || null
  const interval_months = intOrNull(b.interval_months) || null
  if (!name) return { error: 'Name required' }
  if (!Number.isInteger(car_id) || car_id <= 0) return { error: 'Pick a car' }
  if (!interval_km && !interval_months) return { error: 'Set a km or month interval' }
  const last_done_date = isDate(b.last_done_date) ? b.last_done_date : null
  const last_done_km = intOrNull(b.last_done_km)
  return { v: { car_id, name, interval_km, interval_months, last_done_date, last_done_km } }
}

app.post('/api/reminders', async (c) => {
  const { v, error } = parseReminder(await c.req.json().catch(() => ({})))
  if (!v) return c.json({ error }, 400)
  const r = await c.env.DB.prepare(
    'INSERT INTO service_reminders (car_id, name, interval_km, interval_months, last_done_date, last_done_km) VALUES (?,?,?,?,?,?)',
  ).bind(v.car_id, v.name, v.interval_km, v.interval_months, v.last_done_date, v.last_done_km).run()
  return c.json({ id: r.meta.last_row_id })
})

app.put('/api/reminders/:id', async (c) => {
  const { v, error } = parseReminder(await c.req.json().catch(() => ({})))
  if (!v) return c.json({ error }, 400)
  await c.env.DB.prepare(
    'UPDATE service_reminders SET name=?, interval_km=?, interval_months=?, last_done_date=?, last_done_km=? WHERE id=?',
  ).bind(v.name, v.interval_km, v.interval_months, v.last_done_date, v.last_done_km, Number(c.req.param('id'))).run()
  return c.json({ ok: true })
})

app.delete('/api/reminders/:id', async (c) => {
  await c.env.DB.prepare('UPDATE service_reminders SET archived = 1 WHERE id = ?').bind(Number(c.req.param('id'))).run()
  return c.json({ ok: true })
})

app.post('/api/reminders/:id/done', async (c) => {
  const id = Number(c.req.param('id'))
  const b = await c.req.json().catch(() => ({}))
  const r = await c.env.DB.prepare('SELECT car_id FROM service_reminders WHERE id = ?').bind(id).first<{ car_id: number }>()
  if (!r) return c.json({ error: 'Not found' }, 404)
  const date = isDate(b.date) ? b.date : todayMY()
  let km = intOrNull(b.km)
  if (km === null) km = (await currentOdometer(c.env.DB, r.car_id))?.km ?? null
  await c.env.DB.prepare('UPDATE service_reminders SET last_done_date = ?, last_done_km = ? WHERE id = ?').bind(date, km, id).run()
  if (km !== null && b.km !== undefined && b.km !== null && b.km !== '') {
    await c.env.DB.prepare('INSERT INTO odometer_readings (car_id, date, km) VALUES (?,?,?)').bind(r.car_id, date, km).run()
  }
  return c.json({ ok: true })
})

const DEFAULTS: { name: string; km: number | null; months: number | null }[] = [
  { name: 'Engine oil', km: 10000, months: 6 },
  { name: 'Tyre rotation', km: 10000, months: null },
  { name: 'Brake fluid', km: null, months: 24 },
  { name: 'Road tax', km: null, months: 12 },
  { name: 'Insurance', km: null, months: 12 },
]

app.post('/api/cars/:id/default-reminders', async (c) => {
  const carId = Number(c.req.param('id'))
  const stmts = DEFAULTS.map((d) =>
    c.env.DB.prepare('INSERT INTO service_reminders (car_id, name, interval_km, interval_months) VALUES (?,?,?,?)').bind(carId, d.name, d.km, d.months),
  )
  await c.env.DB.batch(stmts)
  return c.json({ ok: true })
})

export default app
