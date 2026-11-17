// Local check: seed data, snapshot, wipe via restore SQL round trip, scheduled backup. Usage: node scripts/test-backup.mjs <base> <password>
import { execSync } from 'node:child_process'
import { writeFileSync, readFileSync, unlinkSync } from 'node:fs'
const [base, password] = process.argv.slice(2)
let cookie = ''
const call = async (method, path, body) => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined })
  const sc = res.headers.getSetCookie().map((c) => c.split(';')[0]); if (sc.length) cookie = sc.join('; ')
  return { status: res.status, json: await res.json().catch(() => ({})) }
}
let fails = 0
const check = (n, ok, x = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' ' + x)); if (!ok) fails++ }

await call('POST', '/api/login', { password })
const car = (await call('POST', '/api/cars', { name: "O'Brien Test Car", plate: 'T 1' })).json.id
const e = await call('POST', '/api/expenses', { car_id: car, payment_method_id: 1, date: '2026-11-01', amount_cents: 12345, category: 'fuel', vendor: "Shell 'Cheras'", note: 'line1,"q"' })
check('seeded expense', e.status === 200)
const dump = (await call('GET', '/api/backup')).json
check('dump has tables', dump.app === 'reimbo' && dump.tables.expenses.length >= 1 && dump.tables.cars.length >= 1)
check('dump excludes auth secrets', !('auth_kv' in dump.tables) && !('login_attempts' in dump.tables))

writeFileSync('.t-dump.json', JSON.stringify(dump))
const sql = execSync('node scripts/restore.mjs .t-dump.json', { encoding: 'utf8', maxBuffer: 1 << 26 })
writeFileSync('.t-restore.sql', sql)
await call('DELETE', `/api/expenses/${e.json.id}`)
check('expense deleted before restore', (await call('GET', '/api/expenses')).json.every((x) => x.id !== e.json.id))
execSync('npx wrangler d1 execute reimbo --local --file .t-restore.sql', { stdio: 'pipe' })
const back = (await call('GET', `/api/expenses/${e.json.id}`)).json
check('restore brings the expense back intact', back.amount_cents === 12345 && back.vendor === "Shell 'Cheras'" && back.note === 'line1,"q"', JSON.stringify(back))
unlinkSync('.t-dump.json'); unlinkSync('.t-restore.sql')

execSync('curl.exe -s "http://127.0.0.1:8787/cdn-cgi/handler/scheduled?cron=0+19+*+*+0"', { stdio: 'pipe' })
await new Promise((r) => setTimeout(r, 1500))
const st = (await call('GET', '/api/backup/status')).json
check('scheduled job wrote a snapshot to R2', st.count >= 1 && /^\d{4}-\d{2}-\d{2}$/.test(st.latest ?? ''), JSON.stringify(st))
console.log(fails ? `${fails} FAILED` : 'ALL PASSED')
process.exit(fails ? 1 : 0)
