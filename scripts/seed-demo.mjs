// Fills a LOCAL dev server with fictional demo data (for screenshots and trying the app out).
// Usage: npm run dev:api   (in another terminal, with a fresh local DB), then: node scripts/seed-demo.mjs
const BASE = process.env.BASE ?? 'http://127.0.0.1:8787'
const PASSWORD = process.env.APP_PASSWORD ?? 'change-me-locally'

let cookie = ''
async function api(method, path, body) {
  const res = await fetch(BASE + '/api' + path, {
    method,
    headers: { 'content-type': 'application/json', cookie },
    body: body ? JSON.stringify(body) : undefined,
  })
  const sc = res.headers.getSetCookie?.() ?? []
  if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ')
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(data)}`)
  return data
}

const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
const daysAgo = (n) => new Date(new Date(today).getTime() - n * 86400e3).toISOString().slice(0, 10)

function receiptSvg(vendor, date, cents, lines) {
  const rows = lines.map((l, i) => `<text x="24" y="${118 + i * 22}" font-size="13">${l[0]}</text><text x="256" y="${118 + i * 22}" font-size="13" text-anchor="end">${l[1]}</text>`).join('')
  const total = (cents / 100).toFixed(2)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="${190 + lines.length * 22}" font-family="monospace"><rect width="100%" height="100%" fill="#fbfaf5"/>
<text x="140" y="36" font-size="16" font-weight="bold" text-anchor="middle">${vendor}</text><text x="140" y="58" font-size="11" text-anchor="middle">${date}</text>
<line x1="24" y1="76" x2="256" y2="76" stroke="#999" stroke-dasharray="3 3"/>${rows}
<line x1="24" y1="${128 + lines.length * 22}" x2="256" y2="${128 + lines.length * 22}" stroke="#999" stroke-dasharray="3 3"/>
<text x="24" y="${156 + lines.length * 22}" font-size="15" font-weight="bold">TOTAL</text><text x="256" y="${156 + lines.length * 22}" font-size="15" font-weight="bold" text-anchor="end">RM ${total}</text></svg>`
}

async function upload(expenseId, svg) {
  const form = new FormData()
  form.append('file', new File([svg], 'receipt.svg', { type: 'image/svg+xml' }))
  const res = await fetch(`${BASE}/api/expenses/${expenseId}/receipts`, { method: 'POST', headers: { cookie }, body: form })
  if (!res.ok) throw new Error('upload failed ' + res.status)
}

await api('POST', '/login', { password: PASSWORD })
const car = (await api('POST', '/cars', { name: 'Toyota Vios', plate: 'VFE 2468', notes: 'Company car' })).id
const methods = await api('GET', '/payment-methods')
const own = methods.find((m) => m.claimable).id
const card = methods.find((m) => !m.claimable).id

// [daysAgo, cents, category, vendor, odometer, note, paidWith, receiptLines | null]
const rows = [
  [150, 38500, 'service', 'Toyota Service Centre Kajang', 42100, 'Oil change and filter', own, [['Engine oil 4L', '210.00'], ['Oil filter', '35.00'], ['Labour', '140.50']]],
  [142, 9000, 'toll_parking', 'Touch n Go reload', null, 'Highway tolls, client visits', own, [['Reload', '90.00']]],
  [120, 52000, 'parts', 'Autoparts Seri Kembangan', 43800, 'Front brake pads', own, [['Brake pads (front)', '380.00'], ['Fitting', '140.00']]],
  [96, 18400, 'fuel', 'Petronas Bangi', 44600, null, card, [['RON95 62.1 L', '134.40'], ['Car wash', '50.00']]],
  [88, 6200, 'toll_parking', 'KLCC parking', null, 'Meeting with supplier', own, [['Parking 8h', '62.00']]],
  [61, 24500, 'addon', 'Dashcam Pro Shop', 45900, 'Front and rear dashcam', own, [['Dashcam set', '245.00']]],
  [47, 12800, 'fuel', 'Shell Semenyih', 46700, null, own, [['V-Power 41.2 L', '128.00']]],
  [33, 31500, 'parts', 'Bridgestone Kajang', 47400, 'Wiper blades and tyre rotation', own, [['Wiper blades', '65.00'], ['Rotation and balance', '250.00']]],
  [19, 8800, 'toll_parking', 'Touch n Go reload', null, null, own, [['Reload', '88.00']]],
  [11, 15400, 'fuel', 'Petronas Kajang', 47950, null, card, [['RON95 53.0 L', '154.00']]],
  [6, 6500, 'toll_parking', 'Bandar Utama parking', null, 'Site visit', own, [['Parking', '65.00']]],
  [3, 17800, 'fuel', 'Shell Bangi', 48250, null, own, [['V-Power 55.1 L', '178.00']]],
  [1, 4500, 'other', 'Car wash and vacuum', null, 'Missing receipt on purpose', own, null],
]
const ids = []
for (const [d, cents, category, vendor, odo, note, pm, lines] of rows) {
  const date = daysAgo(d)
  const { id } = await api('POST', '/expenses', { car_id: car, payment_method_id: pm, date, amount_cents: cents, category, vendor, odometer_km: odo == null ? '' : String(odo), note: note ?? '' })
  if (lines) await upload(id, receiptSvg(vendor, date, cents, lines))
  ids.push(id)
}

// Older items go into claims: first four reimbursed, next four submitted.
const c1 = await api('POST', '/claims', { car_id: car, title: 'Q3 service and tolls', expense_ids: ids.slice(0, 4) })
await api('PATCH', `/claims/${c1.id}`, { status: 'submitted' })
await api('PATCH', `/claims/${c1.id}`, { status: 'reimbursed' })
const c2 = await api('POST', '/claims', { car_id: car, title: 'Accessories and tyres', expense_ids: ids.slice(4, 8) })
await api('PATCH', `/claims/${c2.id}`, { status: 'submitted' })

await api('POST', '/odometer', { car_id: car, km: 48250, date: daysAgo(3) })
await api('POST', `/cars/${car}/default-reminders`, {})
const svc = await api('GET', `/service?car_id=${car}`)
const done = [[39600, 150], [44000, 120], [30500, 400], [46000, 60]]
for (const [i, r] of svc.reminders.slice(0, done.length).entries()) {
  await api('PUT', `/reminders/${r.id}`, { car_id: car, name: r.name, interval_km: r.interval_km, interval_months: r.interval_months, last_done_km: done[i][0], last_done_date: daysAgo(done[i][1]) })
}
console.log('Seeded demo data for car', car)
