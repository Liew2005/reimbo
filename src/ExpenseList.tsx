import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from './api'
import { ExpenseForm } from './ExpenseForm'
import { Sheet } from './sheet'
import { Summary } from './Summary'
import { categoryLabel, type Car, type Expense, type ExpenseDetail, type ExpenseValues, type PaymentMethod } from './types'
import { Icon, Receipt } from './ui'
import { dayNum, fmtDate, monAbbr, monthLabel, prepareReceipt, rm, useCountUp } from './util'

type Props = { cars: Car[]; methods: PaymentMethod[]; carId: number; toast: (m: string) => void; onBuild: () => void }

export function ExpenseList({ cars, methods, carId, toast, onBuild }: Props) {
  const [items, setItems] = useState<Expense[] | null>(null)
  const [seg, setSeg] = useState<'all' | 'claim' | 'summary'>('all')
  const [pmf, setPmf] = useState('')
  const [month, setMonth] = useState('')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<number | null>(null)
  const [err, setErr] = useState('')

  const load = useCallback(() => {
    api.get<Expense[]>(`/expenses?car_id=${carId}`).then((n) => setItems((cur) => (cur && JSON.stringify(cur) === JSON.stringify(n) ? cur : n))).catch((e) => setErr(e.message))
  }, [carId])
  useEffect(load, [load])
  useEffect(() => {
    window.addEventListener('queue-changed', load) // an offline expense just uploaded
    return () => window.removeEventListener('queue-changed', load)
  }, [load])

  const toClaim = useMemo(() => (items ?? []).filter((e) => !e.claim_id && e.claimable), [items])
  const toClaimCents = toClaim.reduce((s, e) => s + e.amount_cents, 0)
  const missing = toClaim.filter((e) => e.receipt_count === 0).length
  const shownTotal = useCountUp(toClaimCents)

  const months = useMemo(() => [...new Set((items ?? []).map((e) => e.date.slice(0, 7)))], [items])
  const needle = q.trim().toLowerCase()
  const rows = useMemo(
    () => (items ?? []).filter((e) =>
      (seg === 'all' || (!e.claim_id && e.claimable)) &&
      (!pmf || e.payment_method_id === Number(pmf)) &&
      (!month || e.date.startsWith(month)) &&
      (!needle || [e.vendor, e.note, categoryLabel(e.category), e.payment_method_name, (e.amount_cents / 100).toFixed(2)].some((s) => s?.toLowerCase().includes(needle)))),
    [items, seg, pmf, month, needle],
  )
  const groups = useMemo(() => {
    const g = new Map<string, Expense[]>()
    for (const e of rows) g.set(e.date.slice(0, 7), [...(g.get(e.date.slice(0, 7)) ?? []), e])
    return [...g.entries()]
  }, [rows])

  if (err) return <p className="error">{err}</p>

  let idx = 0
  return (
    <>
      <div className="pagehead"><h1 className="disp">Expenses</h1></div>
      <div className="stack">
        {seg !== 'summary' && (
          <div className="card summary">
            <span className="lab">To claim</span>
            <div className="between">
              <span className="big mono">{rm(shownTotal)}</span>
              <button className="btn sm" onClick={onBuild} disabled={!toClaim.length}>Build claim</button>
            </div>
            <div className="muted" style={{ fontSize: 13, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span>{toClaim.length} {toClaim.length === 1 ? 'item' : 'items'}</span>
              {missing > 0 && <span className="tag warn"><Icon name="alert" size={12} />{missing} missing {missing === 1 ? 'receipt' : 'receipts'}</span>}
            </div>
          </div>
        )}

        <div className="seg" role="tablist">
          <button className={seg === 'all' ? 'on' : ''} onClick={() => setSeg('all')}>All</button>
          <button className={seg === 'claim' ? 'on' : ''} onClick={() => setSeg('claim')}>To claim</button>
          <button className={seg === 'summary' ? 'on' : ''} onClick={() => setSeg('summary')}>Summary</button>
        </div>

        {seg === 'summary' ? (items ? <Summary items={items} /> : null) : (
          <>
            <div className="searchbox">
              <Icon name="search" size={18} />
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search vendor, note, amount" aria-label="Search expenses" />
            </div>
            <div className="filters">
              <select value={pmf} onChange={(e) => setPmf(e.target.value)} aria-label="Payment method">
                <option value="">All payments</option>
                {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
                <option value="">All months</option>
                {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
              </select>
            </div>

            {items && rows.length === 0 && (
              <div className="empty">
                <Receipt w={64} h={84} total={false} />
                <h2 className="disp" style={{ fontSize: 22 }}>{needle ? 'No matches' : seg === 'claim' ? 'Nothing to claim' : 'No expenses yet'}</h2>
                <p className="muted">{needle ? 'Try a different word or clear the filters.' : seg === 'claim' ? 'Everything you paid for is already in a claim.' : 'Add your first one from the Add tab.'}</p>
              </div>
            )}

            {groups.length > 0 && (
              <div className="tablehead lab"><span>Date</span><span>Vendor</span><span>Category</span><span>Paid with</span><span>Receipt</span><span style={{ textAlign: 'right' }}>Amount</span></div>
            )}
            {groups.map(([ym, list]) => (
              <section key={ym}>
                <div className="group-h">
                  <span className="lab">{monthLabel(ym)}</span>
                  <span className="mono muted" style={{ fontSize: 13 }}>{rm(list.reduce((s, e) => s + e.amount_cents, 0))}</span>
                </div>
                {list.map((e) => (
                  <button key={e.id} className="erow" style={{ ['--i' as string]: Math.min(idx++, 12) }} onClick={() => setOpen(e.id)}>
                    <div className="d"><b className="mono">{dayNum(e.date)}</b><span className="muted">{monAbbr(e.date)}</span></div>
                    <div className="v">
                      <div className="vn">{e.vendor || categoryLabel(e.category)}</div>
                      <div className="vm" style={e.claimable ? undefined : { color: 'var(--co)' }}>{categoryLabel(e.category)} · {e.payment_method_name}</div>
                    </div>
                    <div className="c">{categoryLabel(e.category)}</div>
                    <span className={'p tag ' + (e.claimable ? 'own' : 'co')}>{e.payment_method_name}</span>
                    <div className="r">
                      {e.receipt_count === 0 ? <span className="tag warn">No receipt</span> : <span className="muted" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Icon name="clip" size={14} />{e.receipt_count}</span>}
                      {e.claim_id && <span className="tag plain">Claimed</span>}
                    </div>
                    <div className="a mono">{rm(e.amount_cents)}</div>
                  </button>
                ))}
              </section>
            ))}
          </>
        )}
      </div>
      {open != null && <ExpenseSheet id={open} cars={cars} methods={methods} carId={carId} onClose={() => setOpen(null)} onChanged={load} toast={toast} />}
    </>
  )
}

function ExpenseSheet({ id, cars, methods, carId, onClose, onChanged, toast }: { id: number; cars: Car[]; methods: PaymentMethod[]; carId: number; onClose: () => void; onChanged: () => void; toast: (m: string) => void }) {
  const [e, setE] = useState<ExpenseDetail | null>(null)
  const [edit, setEdit] = useState(false)
  const [err, setErr] = useState('')
  const reload = useCallback(() => { api.get<ExpenseDetail>(`/expenses/${id}`).then(setE).catch((x) => setErr(x.message)) }, [id])
  useEffect(reload, [reload])
  const locked = !!e?.claim_id && e.claim_status !== 'draft'

  async function save(v: ExpenseValues, files: File[]) {
    await api.put(`/expenses/${id}`, v)
    for (const f of files) {
      const p = await prepareReceipt(f)
      await api.upload(id, p.blob, p.name)
    }
    toast('Updated')
    setEdit(false)
    reload()
    onChanged()
  }

  async function remove() {
    if (!confirm('Delete this expense and its receipts?')) return
    try {
      await api.del(`/expenses/${id}`)
      onChanged()
      onClose()
    } catch (x) {
      setErr(x instanceof Error ? x.message : 'Could not delete')
    }
  }

  return (
    <Sheet title={edit ? 'Edit expense' : 'Expense'} onClose={onClose} drawer>
      {!e ? <p className="muted">{err || 'Loading…'}</p> : edit ? (
        <ExpenseForm key={e.receipts.length} cars={cars} methods={methods} carId={carId} initial={e} submitLabel="Save changes" onSubmit={save}
          onDeleteReceipt={async (rid) => { await api.del(`/receipts/${rid}`); onChanged() }} />
      ) : (
        <>
          <div className="mono" style={{ fontSize: 34, marginBottom: 12 }}>{rm(e.amount_cents)}</div>
          {e.receipts.length > 0 ? (
            <div className="thumbs">
              {e.receipts.map((r) => (
                <a key={r.id} href={`/api/receipts/${r.id}`} target="_blank" rel="noreferrer">
                  {r.content_type?.startsWith('image/') ? <img src={`/api/receipts/${r.id}`} alt="Receipt" /> : <span className="chip">PDF</span>}
                </a>
              ))}
            </div>
          ) : <p><span className="tag warn"><Icon name="alert" size={12} />No receipt</span></p>}
          <div className="kv"><span>Vendor</span><span>{e.vendor || '—'}</span></div>
          <div className="kv"><span>Date</span><span>{fmtDate(e.date)}</span></div>
          <div className="kv"><span>Category</span><span>{categoryLabel(e.category)}</span></div>
          <div className="kv"><span>Paid with</span><span className={'tag ' + (e.claimable ? 'own' : 'co')}>{e.payment_method_name}</span></div>
          <div className="kv"><span>Car</span><span>{e.car_name}</span></div>
          {e.odometer_km != null && <div className="kv"><span>Odometer</span><span className="mono">{e.odometer_km.toLocaleString('en-MY')} km</span></div>}
          {e.note && <div className="kv"><span>Note</span><span>{e.note}</span></div>}
          {e.claim_id && <div className="kv"><span>Claim</span><span className="tag plain">{e.claim_status}</span></div>}
          {err && <p className="error" style={{ marginTop: 10 }}>{err}</p>}
          {locked ? (
            <p className="muted" style={{ fontSize: 13 }}>This item is in a {e.claim_status} claim. Move the claim back to draft to change it.</p>
          ) : (
            <div className="row2" style={{ marginTop: 16 }}>
              <button className="btn2" onClick={() => setEdit(true)}>Edit</button>
              <button className="btn2 danger" onClick={remove}>Delete</button>
            </div>
          )}
        </>
      )}
    </Sheet>
  )
}
