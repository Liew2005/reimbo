// Turns a Reimbo backup (data.json from the ZIP, or backups/*.json from R2) into SQL.
// Usage: node scripts/restore.mjs data.json > restore.sql
//   then: npx wrangler d1 execute reimbo --remote --file restore.sql      (use --local for the dev DB)
// Receipt files go back with: npx wrangler r2 object put reimbo-receipts/<r2_key> --file <file> (r2_key is in data.json).
import { readFileSync } from 'node:fs'

const dump = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const ORDER = ['cars', 'payment_methods', 'claims', 'expenses', 'receipts', 'odometer_readings', 'service_reminders', 'settings']
const q = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`)
const out = ['PRAGMA defer_foreign_keys = true;']
for (const t of [...ORDER].reverse()) out.push(`DELETE FROM ${t};`)
for (const t of ORDER) {
  for (const row of dump.tables[t] ?? []) {
    const cols = Object.keys(row)
    out.push(`INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map((c) => q(row[c])).join(', ')});`)
  }
}
console.log(out.join('\n'))
