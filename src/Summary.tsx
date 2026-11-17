import { useMemo, useState } from 'react'
import { categoryLabel, type Expense } from './types'
import { km, monthLabel, rm, today, useCountUp } from './util'

type Period = 'month' | '3m' | 'year' | 'all'
const PERIODS: { id: Period; label: string }[] = [
  { id: 'month', label: 'This month' },
  { id: '3m', label: '3 months' },
  { id: 'year', label: 'This year' },
  { id: 'all', label: 'All time' },
]

function periodStart(p: Period): string {
  const t = today()
  if (p === 'month') return t.slice(0, 7) + '-01'
  if (p === 'year') return t.slice(0, 4) + '-01-01'
  if (p === '3m') {
    const d = new Date(Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 3, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
  }
  return ''
}

function Rows({ rows, total }: { rows: [string, number][]; total: number }) {
  return (
    <div>
      {rows.map(([name, cents]) => (
        <div className="srow" key={name}>
          <div className="between"><span>{name}</span><span className="mono" style={{ fontSize: 14 }}>{rm(cents)}</span></div>
          <div className="bar"><i style={{ width: `${Math.max(2, (cents / total) * 100)}%`, background: 'var(--accent)' }} /></div>
        </div>
      ))}
    </div>
  )
}

export function Summary({ items }: { items: Expense[] }) {
  const [period, setPeriod] = useState<Period>('month')
  const rows = useMemo(() => items.filter((e) => e.date >= periodStart(period)), [items, period])

  const s = useMemo(() => {
    const total = rows.reduce((a, e) => a + e.amount_cents, 0)
    const own = rows.filter((e) => e.claimable).reduce((a, e) => a + e.amount_cents, 0)
    const cat = new Map<string, number>()
    const mon = new Map<string, number>()
    for (const e of rows) {
      cat.set(categoryLabel(e.category), (cat.get(categoryLabel(e.category)) ?? 0) + e.amount_cents)
      mon.set(e.date.slice(0, 7), (mon.get(e.date.slice(0, 7)) ?? 0) + e.amount_cents)
    }
    const odos = rows.map((e) => e.odometer_km).filter((x): x is number => x != null)
    const driven = odos.length >= 2 ? Math.max(...odos) - Math.min(...odos) : 0
    return {
      total, own, company: total - own,
      cats: [...cat.entries()].sort((a, b) => b[1] - a[1]),
      months: [...mon.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 12).reverse(),
      driven,
    }
  }, [rows])
  const shown = useCountUp(s.total)

  return (
    <div className="stack">
      <div className="chips">
        {PERIODS.map((p) => <button key={p.id} className={'chip' + (period === p.id ? ' on' : '')} onClick={() => setPeriod(p.id)}>{p.label}</button>)}
      </div>

      <div className="card summary">
        <span className="lab">Spent</span>
        <span className="big mono">{rm(shown)}</span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="muted" style={{ fontSize: 13 }}>{rows.length} {rows.length === 1 ? 'expense' : 'expenses'}</span>
          <span className="tag own">You paid {rm(s.own)}</span>
          {s.company > 0 && <span className="tag co">Company card {rm(s.company)}</span>}
        </div>
      </div>

      {rows.length === 0 && <p className="muted" style={{ textAlign: 'center' }}>Nothing in this period.</p>}

      {s.cats.length > 0 && (
        <section>
          <div className="group-h"><span className="lab">By category</span></div>
          <Rows rows={s.cats} total={s.cats[0][1]} />
        </section>
      )}

      {period !== 'month' && s.months.length > 1 && (
        <section>
          <div className="group-h"><span className="lab">By month</span></div>
          <Rows rows={s.months.map(([m, c]) => [monthLabel(m), c] as [string, number])} total={Math.max(...s.months.map((m) => m[1]))} />
        </section>
      )}

      {s.driven > 0 && (
        <div className="card">
          <span className="lab">Running cost per km</span>
          <div className="mono" style={{ fontSize: 26, marginTop: 6 }}>{rm(Math.round(s.total / s.driven))}<span className="muted" style={{ fontSize: 14 }}> / km</span></div>
          <span className="muted" style={{ fontSize: 13 }}>Total spent over the {km(s.driven)} km between your first and last odometer entry in this period.</span>
        </div>
      )}
    </div>
  )
}
