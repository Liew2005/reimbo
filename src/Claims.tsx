import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from './api'
import { exportCsv, exportPdf, exportZip } from './pdf'
import { Sheet } from './sheet'
import { categoryLabel, type Claim, type ClaimDetail, type Expense } from './types'
import { ClaimStatusTag, Icon, Receipt } from './ui'
import { fmtDate, fmtDayMon, rm } from './util'

type Props = { carId: number; toast: (m: string) => void; buildSignal: number }

export function Claims({ carId, toast, buildSignal }: Props) {
  const [claims, setClaims] = useState<Claim[] | null>(null)
  const [open, setOpen] = useState<number | null>(null)
  const [building, setBuilding] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(() => { api.get<Claim[]>(`/claims?car_id=${carId}`).then(setClaims).catch((e) => setErr(e.message)) }, [carId])
  useEffect(load, [load])
  useEffect(() => { if (buildSignal > 0) setBuilding(true) }, [buildSignal])

  if (err) return <p className="error">{err}</p>
  return (
    <>
      <div className="pagehead">
        <h1 className="disp">Claims</h1>
        <button className="btn sm" onClick={() => setBuilding(true)}>New claim</button>
      </div>
      {claims && claims.length === 0 && (
        <div className="empty">
          <Receipt w={64} h={84} total={false} />
          <h2 className="disp" style={{ fontSize: 22 }}>No claims yet</h2>
          <p className="muted">Pick what you paid for and bundle it into one report with receipts.</p>
        </div>
      )}
      <div className="stack" style={{ gap: 10 }}>
        {claims?.map((c, i) => (
          <button key={c.id} className="claimcard" style={{ ['--i' as string]: Math.min(i, 12) }} onClick={() => setOpen(c.id)}>
            <div className="between"><b className="mono">{c.claim_no}</b><ClaimStatusTag status={c.status} /></div>
            <div className="muted" style={{ fontSize: 13 }}>
              {c.date_from ? `${fmtDayMon(c.date_from)} to ${fmtDayMon(c.date_to!)}` : 'Empty'} · {c.item_count} {c.item_count === 1 ? 'item' : 'items'}
            </div>
            <div className="between">
              <span className="mono" style={{ fontSize: 20 }}>{rm(c.reimburse_cents)}</span>
              {c.company_cents > 0 && <span className="tag co">+ {rm(c.company_cents)} company card</span>}
            </div>
          </button>
        ))}
      </div>
      {building && <Builder carId={carId} onClose={() => setBuilding(false)} onCreated={(id) => { setBuilding(false); load(); setOpen(id) }} />}
      {open != null && <ClaimSheet id={open} onClose={() => setOpen(null)} onChanged={load} toast={toast} />}
    </>
  )
}

/** Picks items for a new claim, or (with `claimId`) edits the items of a draft claim. */
function Builder({ carId, claimId, onClose, onCreated }: { carId: number; claimId?: number; onClose: () => void; onCreated: (id: number) => void }) {
  const [items, setItems] = useState<Expense[] | null>(null)
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const editing = claimId != null

  useEffect(() => {
    api.get<Expense[]>(`/expenses?car_id=${carId}`).then((all) => {
      const pool = all.filter((e) => !e.claim_id || e.claim_id === claimId)
      setItems(pool)
      setSel(new Set(pool.filter((e) => (editing ? e.claim_id === claimId : true)).map((e) => e.id)))
    }).catch((e) => setErr(e.message))
  }, [carId, claimId, editing])

  const own = useMemo(() => (items ?? []).filter((e) => e.claimable), [items])
  const co = useMemo(() => (items ?? []).filter((e) => !e.claimable), [items])
  const total = own.filter((e) => sel.has(e.id)).reduce((s, e) => s + e.amount_cents, 0)
  const toggle = (id: number) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  async function create() {
    setBusy(true)
    setErr('')
    try {
      if (editing) {
        await api.put(`/claims/${claimId}/items`, { expense_ids: [...sel] })
        onCreated(claimId)
      } else {
        const r = await api.post<{ id: number }>('/claims', { car_id: carId, expense_ids: [...sel] })
        onCreated(r.id)
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : editing ? 'Could not save items' : 'Could not create claim')
      setBusy(false)
    }
  }

  const list = (title: string, hint: string, rows: Expense[]) => rows.length > 0 && (
    <section>
      <div className="group-h"><span className="lab">{title}</span><span className="muted" style={{ fontSize: 12 }}>{hint}</span></div>
      {rows.map((e) => (
        <label key={e.id} className="checkrow">
          <input type="checkbox" checked={sel.has(e.id)} onChange={() => toggle(e.id)} />
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.vendor || categoryLabel(e.category)}</span>
            <span className="muted" style={{ fontSize: 13 }}>{fmtDayMon(e.date)} · {categoryLabel(e.category)}{e.receipt_count === 0 && <span className="tag warn" style={{ marginLeft: 6 }}>No receipt</span>}</span>
          </span>
          <span className="mono">{rm(e.amount_cents)}</span>
        </label>
      ))}
    </section>
  )

  return (
    <Sheet title={editing ? 'Edit items' : 'New claim'} onClose={onClose}>
      {!items ? <p className="muted">{err || 'Loading…'}</p> : items.length === 0 ? (
        <p className="muted">Nothing left to claim. Every expense is already in a claim.</p>
      ) : (
        <div className="stack">
          {list('You paid · claimed', 'goes into total', own)}
          {list('Company card · listed only', 'not claimed', co)}
          <div className="between"><span className="lab">To reimburse</span><b className="mono" style={{ fontSize: 22 }}>{rm(total)}</b></div>
          {err && <p className="error">{err}</p>}
          <button className="btn" disabled={busy || sel.size === 0} onClick={create}>{busy ? (editing ? 'Saving…' : 'Creating…') : editing ? `Save items (${sel.size})` : `Create claim (${sel.size})`}</button>
        </div>
      )}
    </Sheet>
  )
}

function ClaimSheet({ id, onClose, onChanged, toast }: { id: number; onClose: () => void; onChanged: () => void; toast: (m: string) => void }) {
  const [c, setC] = useState<ClaimDetail | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const [editingItems, setEditingItems] = useState(false)
  const reload = useCallback(() => { api.get<ClaimDetail>(`/claims/${id}`).then(setC).catch((e) => setErr(e.message)) }, [id])
  useEffect(reload, [reload])

  async function run(label: string, fn: () => Promise<unknown>, done?: string) {
    setBusy(label)
    setErr('')
    try { await fn(); if (done) toast(done) } catch (e) { setErr(e instanceof Error ? e.message : 'Failed') } finally { setBusy('') }
  }
  const setStatus = (status: string) => run('status', async () => { await api.patch(`/claims/${id}`, { status }); reload(); onChanged() })

  if (!c) return <Sheet title="Claim" onClose={onClose} drawer><p className="muted">{err || 'Loading…'}</p></Sheet>
  const own = c.expenses.filter((e) => e.claimable)
  const co = c.expenses.filter((e) => !e.claimable)
  const missing = c.expenses.filter((e) => e.receipts.length === 0).length
  const draft = c.status === 'draft'
  let n = 0
  const rcs = c.expenses.flatMap((e) => e.receipts.map((r) => ({ ...r, ref: 'R' + ++n })))

  const rows = (list: typeof own) => list.map((e, i) => (
    <div className="pitem" key={e.id}>
      <span className="n mono">{i + 1}</span>
      <span className="nm">{e.vendor || categoryLabel(e.category)} <small>{fmtDayMon(e.date)}</small></span>
      <span className="mono" style={{ fontSize: 13 }}>{rm(e.amount_cents)}</span>
      <span className="rf mono">{e.receipts.length ? rcs.filter((r) => e.receipts.some((x) => x.id === r.id)).map((r) => r.ref).join(' ') : <b style={{ color: '#9a4a07' }}>none</b>}</span>
    </div>
  ))

  return (
    <Sheet title={c.claim_no} onClose={onClose} drawer>
      <div className="stack" style={{ gap: 14 }}>
        <div className="between"><ClaimStatusTag status={c.status} /><span className="muted" style={{ fontSize: 13 }}>{c.car_name}{c.car_plate ? ` · ${c.car_plate}` : ''}</span></div>
        <div className="paper">
          <div className="plab">Claimant</div>
          <div style={{ marginBottom: 8 }}>{c.claimant_name || <i>set your name in Setup</i>}</div>
          <div className="plab">Period</div>
          <div>{c.date_from ? `${fmtDate(c.date_from)} to ${fmtDate(c.date_to!)}` : '—'}</div>
          <div className="dash" />
          {own.length > 0 && <><div className="plab" style={{ marginBottom: 4 }}>To be reimbursed</div>{rows(own)}</>}
          {co.length > 0 && <><div className="plab" style={{ margin: '12px 0 4px' }}>Company card · not claimed</div>{rows(co)}</>}
          <div className="dash" />
          <div className="leader"><span>Total to reimburse</span><span className="dots" /><b className="mono" style={{ fontSize: 18 }}>{rm(c.reimburse_cents)}</b></div>
          {c.company_cents > 0 && <div className="leader" style={{ color: '#6b675a', fontSize: 13 }}><span>Company card</span><span className="dots" /><span className="mono">{rm(c.company_cents)}</span></div>}
        </div>
        {missing > 0 && <div className="tag warn" style={{ height: 'auto', padding: '8px 10px', whiteSpace: 'normal' }}><Icon name="alert" size={14} />{missing} {missing === 1 ? 'item has' : 'items have'} no receipt. The report will say so.</div>}
        {rcs.length > 0 && (
          <div className="rcstrip">
            {rcs.map((r) => (
              <a key={r.id} href={`/api/receipts/${r.id}`} target="_blank" rel="noreferrer">
                {r.content_type?.startsWith('image/') ? <img src={`/api/receipts/${r.id}`} alt={r.ref} /> : <Receipt w={48} h={63} total={false} />}
                {r.ref}
              </a>
            ))}
          </div>
        )}
        <button className="btn" disabled={!!busy} onClick={() => run('pdf', () => exportPdf(c), 'PDF ready')}><Icon name="download" size={18} />{busy === 'pdf' ? 'Building PDF…' : 'Download PDF'}</button>
        <div className="row2">
          <button className="btn2" disabled={!!busy} onClick={() => run('zip', () => exportZip(c), 'ZIP ready')}>{busy === 'zip' ? 'Zipping…' : 'ZIP + receipts'}</button>
          <button className="btn2" onClick={() => exportCsv(c)}>CSV</button>
        </div>
        {err && <p className="error">{err}</p>}
        <div className="row2">
          {draft && <button className="btn2" disabled={!!busy} onClick={() => setEditingItems(true)}>Edit items</button>}
          {c.status === 'draft' && <button className="btn2" disabled={!!busy} onClick={() => setStatus('submitted')}>Mark submitted</button>}
          {c.status === 'submitted' && <><button className="btn2" disabled={!!busy} onClick={() => setStatus('reimbursed')}>Mark reimbursed</button><button className="btn2" disabled={!!busy} onClick={() => setStatus('draft')}>Back to draft</button></>}
          {c.status === 'reimbursed' && <button className="btn2" disabled={!!busy} onClick={() => setStatus('submitted')}>Undo reimbursed</button>}
          {draft && <button className="btn2 danger" disabled={!!busy} onClick={() => { if (confirm('Delete this draft claim? Items go back to unclaimed.')) run('del', async () => { await api.del(`/claims/${id}`); onChanged(); onClose() }) }}>Delete draft</button>}
        </div>
      </div>
      {editingItems && <Builder carId={c.car_id} claimId={id} onClose={() => setEditingItems(false)} onCreated={() => { setEditingItems(false); reload(); onChanged(); toast('Items updated') }} />}
    </Sheet>
  )
}
