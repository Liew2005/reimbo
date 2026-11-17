import { useEffect, useMemo, useRef, useState } from 'react'
import { CATEGORIES, type Car, type ExpenseDetail, type ExpenseValues, type PaymentMethod } from './types'
import { Icon } from './ui'
import { today } from './util'

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
  const fileRef = useRef<HTMLInputElement>(null)
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
          <button type="button" className="snap" onClick={() => fileRef.current?.click()}><Icon name="camera" />Snap</button>
          <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple
            onChange={(e) => { setFiles((x) => [...x, ...Array.from(e.target.files ?? [])]); e.target.value = '' }} />
        </div>
      </div>

      <label><span className="lab">Vendor</span><input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Where" /></label>
      <div className="row2">
        <label><span className="lab">Date</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label><span className="lab">Odometer km</span><input inputMode="numeric" value={odo} onChange={(e) => setOdo(e.target.value.replace(/\D/g, ''))} placeholder="optional" /></label>
      </div>
      <label><span className="lab">Note</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" /></label>

      {err && <p className="error">{err}</p>}
      <div className="savebar"><button className="btn" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button></div>
    </form>
  )
}
