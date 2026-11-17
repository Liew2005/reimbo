// Local check of the daily reminder email job. Needs `wrangler dev --test-scheduled` on <base> with a working RESEND_API_KEY in .dev.vars.
// Usage: node scripts/test-reminders.mjs <base> <password>     (sends ONE real email to REMINDER_EMAIL)
import { execSync } from 'node:child_process'
const [base, password] = process.argv.slice(2)
let cookie = ''
const call = async (method, path, body) => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined })
  const sc = res.headers.getSetCookie().map((c) => c.split(';')[0]); if (sc.length) cookie = sc.join('; ')
  return { status: res.status, json: await res.json().catch(() => ({})) }
}
const sql = (q) => JSON.parse(execSync(`npx wrangler d1 execute reimbo --local --json --command "${q}"`, { encoding: 'utf8' }))[0].results
const trigger = () => execSync('curl.exe -s "http://127.0.0.1:8787/cdn-cgi/handler/scheduled?cron=0+1+*+*+*"', { stdio: 'pipe' })
let fails = 0
const check = (n, ok, x = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' ' + x)); if (!ok) fails++ }

await call('POST', '/api/login', { password })
const car = (await call('POST', '/api/cars', { name: 'Reminder Test Car' })).json.id
const rid = (await call('POST', '/api/reminders', { car_id: car, name: 'Test tyre rotation', interval_months: 1 })).json.id
await call('POST', `/api/reminders/${rid}/done`, { date: '2026-09-01' })
const svc = (await call('GET', `/api/service?car_id=${car}`)).json
check('reminder is overdue', svc.reminders.find((r) => r.id === rid)?.status === 'overdue')

trigger(); await new Promise((r) => setTimeout(r, 4000))
let rows = sql(`SELECT key, value FROM auth_kv WHERE key = 'reminder_sent_${rid}'`)
check('first run sent the email (marker saved)', rows.length === 1 && rows[0].value.startsWith('o'), JSON.stringify(rows))

sql(`UPDATE auth_kv SET value = 'o2000-01-01' WHERE key = 'reminder_sent_${rid}'`)   // pretend last sent long ago
sql(`UPDATE auth_kv SET value = 'o' || date('now') WHERE key = 'reminder_sent_${rid}'`) // ...then today again
trigger(); await new Promise((r) => setTimeout(r, 2500))
rows = sql(`SELECT value FROM auth_kv WHERE key = 'reminder_sent_${rid}'`)
check('second run same day does not resend', rows[0].value === sql(`SELECT 'o' || date('now') AS v`)[0].v, JSON.stringify(rows))
console.log(fails ? `${fails} FAILED` : 'ALL PASSED')
process.exit(fails ? 1 : 0)
