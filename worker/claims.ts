import { Hono } from 'hono'
import { type Env, str, todayMY } from './env'

const app = new Hono<{ Bindings: Env }>()

const CLAIM_SELECT = `
  SELECT cl.id, cl.claim_no, cl.title, cl.status, cl.car_id, cl.created_at, cl.submitted_at, cl.reimbursed_at,
         c.name AS car_name, c.plate AS car_plate,
         COUNT(e.id) AS item_count,
         COALESCE(SUM(CASE WHEN p.claimable = 1 THEN e.amount_cents END), 0) AS reimburse_cents,
         COALESCE(SUM(CASE WHEN p.claimable = 0 THEN e.amount_cents END), 0) AS company_cents,
         MIN(e.date) AS date_from, MAX(e.date) AS date_to
  FROM claims cl
  LEFT JOIN cars c ON c.id = cl.car_id
  LEFT JOIN expenses e ON e.claim_id = cl.id
  LEFT JOIN payment_methods p ON p.id = e.payment_method_id`

app.get('/api/claims', async (c) => {
  const carId = Number(c.req.query('car_id'))
  const where = Number.isInteger(carId) && carId > 0 ? 'WHERE cl.car_id = ?' : ''
  const stmt = c.env.DB.prepare(`${CLAIM_SELECT} ${where} GROUP BY cl.id ORDER BY cl.id DESC LIMIT 200`)
  const { results } = await (where ? stmt.bind(carId) : stmt).all()
  return c.json(results)
})

app.get('/api/claims/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const claim = await c.env.DB.prepare(`${CLAIM_SELECT} WHERE cl.id = ? GROUP BY cl.id`).bind(id).first()
  if (!claim) return c.json({ error: 'Not found' }, 404)
  const { results: expenses } = await c.env.DB.prepare(
    `SELECT e.id, e.date, e.amount_cents, e.category, e.vendor, e.odometer_km, e.note,
            p.name AS payment_method_name, p.claimable AS claimable
     FROM expenses e JOIN payment_methods p ON p.id = e.payment_method_id
     WHERE e.claim_id = ? ORDER BY p.claimable DESC, e.date, e.id`,
  ).bind(id).all<{ id: number }>()
  const { results: receipts } = await c.env.DB.prepare(
    `SELECT r.id, r.expense_id, r.content_type FROM receipts r JOIN expenses e ON e.id = r.expense_id WHERE e.claim_id = ? ORDER BY r.id`,
  ).bind(id).all<{ id: number; expense_id: number; content_type: string | null }>()
  const byExpense = new Map<number, { id: number; content_type: string | null }[]>()
  for (const r of receipts) {
    const list = byExpense.get(r.expense_id) ?? []
    list.push({ id: r.id, content_type: r.content_type })
    byExpense.set(r.expense_id, list)
  }
  const claimant = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'claimant_name'").first<{ value: string }>()
  return c.json({
    ...claim,
    claimant_name: claimant?.value ?? null,
    expenses: expenses.map((e) => ({ ...e, receipts: byExpense.get(e.id) ?? [] })),
  })
})

app.post('/api/claims', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  const carId = Number(b.car_id)
  const ids: number[] = Array.isArray(b.expense_ids) ? [...new Set<number>(b.expense_ids.map(Number))].filter((n) => Number.isInteger(n) && n > 0) : []
  if (!Number.isInteger(carId) || carId <= 0) return c.json({ error: 'Pick a car' }, 400)
  if (ids.length === 0) return c.json({ error: 'Select at least one expense' }, 400)
  if (ids.length > 200) return c.json({ error: 'Too many items (max 200)' }, 400)

  const marks = ids.map(() => '?').join(',')
  const { results } = await c.env.DB.prepare(
    `SELECT id FROM expenses WHERE id IN (${marks}) AND car_id = ? AND claim_id IS NULL`,
  ).bind(...ids, carId).all()
  if (results.length !== ids.length) return c.json({ error: 'Some items are already in a claim or belong to another car' }, 409)

  const ym = todayMY().slice(2, 4) + todayMY().slice(5, 7)
  const prefix = `CL-${ym}-`
  const n = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM claims WHERE claim_no LIKE ?').bind(prefix + '%').first<{ n: number }>()
  const claimNo = prefix + String((n?.n ?? 0) + 1).padStart(2, '0')

  const ins = await c.env.DB.prepare('INSERT INTO claims (claim_no, title, car_id) VALUES (?,?,?)').bind(claimNo, str(b.title, 120), carId).run()
  const claimId = ins.meta.last_row_id
  await c.env.DB.prepare(`UPDATE expenses SET claim_id = ? WHERE id IN (${marks})`).bind(claimId, ...ids).run()
  return c.json({ id: claimId, claim_no: claimNo })
})

const NEXT: Record<string, string[]> = {
  draft: ['submitted'],
  submitted: ['reimbursed', 'draft'],
  reimbursed: ['submitted'],
}

app.patch('/api/claims/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const b = await c.req.json().catch(() => ({}))
  const cur = await c.env.DB.prepare('SELECT status FROM claims WHERE id = ?').bind(id).first<{ status: string }>()
  if (!cur) return c.json({ error: 'Not found' }, 404)
  if (!NEXT[cur.status]?.includes(b.status)) return c.json({ error: `Cannot go from ${cur.status} to ${b.status}` }, 409)
  const now = todayMY()
  await c.env.DB.prepare(
    `UPDATE claims SET status = ?1,
       submitted_at = CASE WHEN ?1 = 'submitted' THEN ?2 WHEN ?1 = 'draft' THEN NULL ELSE submitted_at END,
       reimbursed_at = CASE WHEN ?1 = 'reimbursed' THEN ?2 ELSE NULL END
     WHERE id = ?3`,
  ).bind(b.status, now, id).run()
  return c.json({ ok: true })
})

app.delete('/api/claims/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const cur = await c.env.DB.prepare('SELECT status FROM claims WHERE id = ?').bind(id).first<{ status: string }>()
  if (!cur) return c.json({ error: 'Not found' }, 404)
  if (cur.status !== 'draft') return c.json({ error: 'Only draft claims can be deleted. Move it back to draft first.' }, 409)
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE expenses SET claim_id = NULL WHERE claim_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM claims WHERE id = ?').bind(id),
  ])
  return c.json({ ok: true })
})

// Replace a draft claim's items in one go (the "Edit items" picker).
app.put('/api/claims/:id/items', async (c) => {
  const id = Number(c.req.param('id'))
  const b = await c.req.json().catch(() => ({}))
  const ids: number[] = Array.isArray(b.expense_ids) ? [...new Set<number>(b.expense_ids.map(Number))].filter((n) => Number.isInteger(n) && n > 0) : []
  const cur = await c.env.DB.prepare('SELECT status, car_id FROM claims WHERE id = ?').bind(id).first<{ status: string; car_id: number }>()
  if (!cur) return c.json({ error: 'Not found' }, 404)
  if (cur.status !== 'draft') return c.json({ error: 'Claim is not a draft' }, 409)
  if (ids.length === 0) return c.json({ error: 'Keep at least one item, or delete the draft instead' }, 400)
  if (ids.length > 200) return c.json({ error: 'Too many items (max 200)' }, 400)
  const marks = ids.map(() => '?').join(',')
  const { results } = await c.env.DB.prepare(
    `SELECT id FROM expenses WHERE id IN (${marks}) AND car_id = ? AND (claim_id IS NULL OR claim_id = ?)`,
  ).bind(...ids, cur.car_id, id).all()
  if (results.length !== ids.length) return c.json({ error: 'Some items are already in another claim' }, 409)
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE expenses SET claim_id = NULL WHERE claim_id = ? AND id NOT IN (${marks})`).bind(id, ...ids),
    c.env.DB.prepare(`UPDATE expenses SET claim_id = ? WHERE id IN (${marks})`).bind(id, ...ids),
  ])
  return c.json({ ok: true })
})

app.delete('/api/claims/:id/items/:expenseId', async (c) => {
  const id = Number(c.req.param('id'))
  const cur = await c.env.DB.prepare('SELECT status FROM claims WHERE id = ?').bind(id).first<{ status: string }>()
  if (!cur) return c.json({ error: 'Not found' }, 404)
  if (cur.status !== 'draft') return c.json({ error: 'Claim is not a draft' }, 409)
  await c.env.DB.prepare('UPDATE expenses SET claim_id = NULL WHERE id = ? AND claim_id = ?').bind(Number(c.req.param('expenseId')), id).run()
  return c.json({ ok: true })
})

// ---- settings (claimant name for the report header) ----
app.get('/api/settings', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>()
  return c.json(Object.fromEntries(results.map((r) => [r.key, r.value])))
})

app.put('/api/settings', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  const name = str(b.claimant_name, 80)
  if (name) {
    await c.env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .bind('claimant_name', name).run()
  } else {
    await c.env.DB.prepare("DELETE FROM settings WHERE key = 'claimant_name'").run()
  }
  return c.json({ ok: true })
})

export default app
