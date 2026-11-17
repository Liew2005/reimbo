import { Hono } from 'hono'
import { type Env, todayMY } from './env'

// Auth secrets (auth_kv) and login_attempts are deliberately left out of backups.
const TABLES = ['cars', 'payment_methods', 'claims', 'expenses', 'receipts', 'odometer_readings', 'service_reminders', 'settings'] as const
const KEEP = 8

export async function dumpAll(db: D1Database) {
  const tables: Record<string, unknown[]> = {}
  for (const t of TABLES) tables[t] = (await db.prepare(`SELECT * FROM ${t}`).all()).results
  return { app: 'reimbo', version: 1, exported_at: new Date().toISOString(), tables }
}

/** Weekly job: JSON snapshot into R2 (backups/YYYY-MM-DD.json), keep the newest KEEP. */
export async function runBackup(env: Env) {
  await env.RECEIPTS.put(`backups/${todayMY()}.json`, JSON.stringify(await dumpAll(env.DB)), { httpMetadata: { contentType: 'application/json' } })
  const list = await env.RECEIPTS.list({ prefix: 'backups/' })
  const old = list.objects.map((o) => o.key).sort().reverse().slice(KEEP)
  if (old.length) await env.RECEIPTS.delete(old)
}

const app = new Hono<{ Bindings: Env }>()

app.get('/api/backup', async (c) => c.json(await dumpAll(c.env.DB)))

app.get('/api/backup/status', async (c) => {
  const list = await c.env.RECEIPTS.list({ prefix: 'backups/' })
  const keys = list.objects.map((o) => o.key).sort()
  return c.json({ count: keys.length, latest: keys.length ? keys[keys.length - 1].slice('backups/'.length, -'.json'.length) : null })
})

export default app
