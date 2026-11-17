import { useEffect, useMemo, useRef, useState } from 'react'
import { CATEGORIES, type Car, type ExpenseDetail, type ExpenseValues, type PaymentMethod } from './types'
import { Icon } from './ui'
import { prepareReceipt, today } from './util'

const MAX_FILES = 12

type Props = {
  cars: Car[]
  methods: PaymentMethod[]
  carId: number
  initial?: ExpenseDetail
  submitLabel: string
  onSubmit: (v: ExpenseValues, files: File[]) => Promise<void>
  onDeleteReceipt?: (id: number) => Promise<void>
}

export function ExpenseForm({ cars, methods, carId, initial, submitLabel, onSubmit, onDeleteReceipt }: Props) {
  const activeMethods = methods.filter((m) => !m.archived || m.id === initial?.payment_method_id)
  const lastPm = Number(localStorage.getItem('lastPm'))
  const [amount, setAmount] = useState(initial ? String(initial.amount_cents / 100) : '')
  const [pm, setPm] = useState(initial?.payment_method_id ?? (activeMethods.find((m) => m.id === lastPm) ?? activeMethods[0])?.id ?? 0)
  const [category, setCategory] = useState(initial?.category ?? 'service')
  const [vendor, setVendor] = useState(initial?.vendor ?? '')
  const [date, setDate] = useState(initial?.date ?? today())
  const [odo, setOdo] = useState(initial?.odometer_km != null ? String(initial.odometer_km) : '')
  const [note, setNote] = useState(initial?.note ?? '')
  const [files, setFiles] = useState<File[]>([])
  const [existing, setExisting] = useState(initial?.receipts ?? [])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [preparing, setPreparing] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)
  const camRef = useRef<HTMLInputElement>(null)

  /** Photos are shrunk one at a time as soon as they are picked, so only small files are kept in memory. */
  async function addFiles(list: FileList | null) {
    const picked = Array.from(list ?? [])
    if (!picked.length) return
    setErr('')
    setPreparing((n) => n + picked.length)
    for (const f of picked) {
      try {
        const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
        if (!isPdf && !f.type.startsWith('image/')) { setErr(`${f.name || 'That file'} is not a photo or PDF.`); continue }
        if (existing.length + files.length >= MAX_FILES) { setErr(`Up to ${MAX_FILES} receipts per expense.`); continue }
        const src = isPdf && f.type !== 'application/pdf' ? new File([f], f.name, { type: 'application/pdf' }) : f
        const p = await prepareReceipt(src)
        const out = new File([p.blob], p.name, { type: p.blob.type || src.type })
        const limit = isPdf ? 25 : 10
        if (out.size > limit * 1048576) { setErr(`${f.name || 'That file'} is too big (over ${limit} MB). Try a smaller one.`); continue }
        setFiles((x) => [...x, out])
      } catch {
        setErr('Could not read that file. Try again.')
      } finally {
        setPreparing((n) => n - 1)
      }
    }
  }
  const method = methods.find((m) => m.id === pm)
  const previews = useMemo(() => files.map((f) => (f.type.startsWith('image/') ? URL.createObjectURL(f) : '')), [files])
  useEffect(() => () => previews.forEach((u) => u && URL.revokeObjectURL(u)), [previews])
  const car = cars.find((c) => c.id === (initial?.car_id ?? carId))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const cents = Math.round(parseFloat(amount) * 100)
    if (!Number.isFinite(cents) || cents <= 0) return setErr('Enter the amount')
    if (!pm) return setErr('Pick how you paid')
    setBusy(true)
    setErr('')
    try {
      await onSubmit({ car_id: car?.id ?? carId, payment_method_id: pm, date, amount_cents: cents, category, vendor, odometer_km: odo, note }, files)
      localStorage.setItem('lastPm', String(pm))
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <div>
        <span className="lab">Amount</span>
        <div className="amount">
          <span className="rm mono">RM</span>
          <input className="mono" inputMode="decimal" placeholder="0.00" value={amount} autoFocus={!initial}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} aria-label="Amount in ringgit" />
        </div>
      </div>

      <div>
        <span className="lab">Paid with</span>
        <div className="chips" style={{ marginTop: 8 }}>
          {activeMethods.map((m) => (
            <button type="button" key={m.id} className={'chip' + (pm === m.id ? ' on' : '')} onClick={() => setPm(m.id)}>{m.name}</button>
          ))}
        </div>
        {method && (
          <div className={'hint ' + (method.claimable ? 'ok' : 'co')}>
            <Icon name={method.claimable ? 'check' : 'alert'} size={16} />
            {method.claimable ? 'Your money. Goes into your claim.' : 'Company card. Listed in the report, not claimed.'}
          </div>
        )}
      </div>

      <div>
        <span className="lab">Category</span>
        <div className="chips" style={{ marginTop: 8 }}>
          {CATEGORIES.map((c) => (
            <button type="button" key={c.value} className={'chip' + (category === c.value ? ' on' : '')} onClick={() => setCategory(c.value)}>{c.label}</button>
          ))}
        </div>
      </div>

      <div>
        <span className="lab">Receipt</span>
        <div className="snaprow" style={{ marginTop: 8 }}>
          {existing.map((r) => (
            <div className="thumbf" key={r.id}>
              {r.content_type?.startsWith('image/') ? <img src={`/api/receipts/${r.id}`} alt="Receipt" /> : <div className="pdf">PDF</div>}
              {onDeleteReceipt && (
                <button type="button" aria-label="Remove receipt" onClick={async () => { await onDeleteReceipt(r.id); setExisting((x) => x.filter((y) => y.id !== r.id)) }}><Icon name="x" size={14} /></button>
              )}
            </div>
          ))}
          {files.map((_f, i) => (
            <div className="thumbf" key={i}>
              {previews[i] ? <img src={previews[i]} alt="Receipt" /> : <div className="pdf">PDF</div>}
              <button type="button" aria-label="Remove receipt" onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}><Icon name="x" size={14} /></button>
            </div>
          ))}
          {preparing > 0 && <div className="thumbf" role="status" aria-label="Preparing photo"><div className="pdf">…</div></div>}
          <button type="button" className="snap" onClick={() => camRef.current?.click()}><Icon name="camera" />Camera</button>
          <button type="button" className="snap" onClick={() => fileRef.current?.click()}><Icon name="clip" />Photos / PDF</button>
          <input ref={camRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
            onChange={(e) => { void addFiles(e.target.files); e.target.value = '' }} />
          <input ref={fileRef} type="file" accept="image/*,application/pdf,.pdf" multiple style={{ display: 'none' }}
            onChange={(e) => { void addFiles(e.target.files); e.target.value = '' }} />
        </div>
      </div>

      <label><span className="lab">Vendor</span><input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Where" /></label>
      <div className="row2">
        <label><span className="lab">Date</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label><span className="lab">Odometer km</span><input inputMode="numeric" value={odo} onChange={(e) => setOdo(e.target.value.replace(/\D/g, ''))} placeholder="optional" /></label>
      </div>
      <label><span className="lab">Note</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" /></label>

      {err && <p className="error">{err}</p>}
      <div className="savebar"><button className="btn" disabled={busy || preparing > 0}>{busy ? 'Saving…' : preparing > 0 ? 'Preparing photo…' : submitLabel}</button></div>
    </form>
  )
}
