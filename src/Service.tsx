import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import { Sheet } from './sheet'
import type { Reminder, ServiceData } from './types'
import { Icon } from './ui'
import { fmtDate, km, today } from './util'

type Props = { carId: number; toast: (m: string) => void; onChanged: () => void }

export function statusText(r: Reminder): string {
  if (r.status === 'unknown') return 'Set last done'
  const parts: string[] = []
  if (r.status === 'overdue') {
    if (r.km_left !== null && r.km_left < 0) parts.push(`${km(-r.km_left)} km over`)
    if (r.days_left !== null && r.days_left < 0) parts.push(`${-r.days_left} days over`)
    return parts.join(' · ')
  }
  if (r.km_left !== null) parts.push(`${km(r.km_left)} km left`)
  if (r.days_left !== null) parts.push(r.days_left > 60 ? `${Math.round(r.days_left / 30)} months left` : `${r.days_left} days left`)
  return parts.join(' · ')
}

const barColor = (s: Reminder['status']) => (s === 'overdue' ? 'var(--bad)' : s === 'soon' ? 'var(--warn)' : 'var(--accent)')

export function Service({ carId, toast, onChanged }: Props) {
  const [data, setData] = useState<ServiceData | null>(null)
  const [odo, setOdo] = useState('')
  const [done, setDone] = useState<Reminder | null>(null)
  const [edit, setEdit] = useState<Reminder | 'new' | null>(null)
  const [err, setErr] = useState('')

  const load = useCallback(() => {
    api.get<ServiceData>(`/service?car_id=${carId}`).then((d) => { setData(d); onChanged() }).catch((e) => setErr(e.message))
  }, [carId, onChanged])
  useEffect(load, [load])

  async function saveOdo(e: React.FormEvent) {
    e.preventDefault()
    if (!odo) return
    try {
      await api.post('/odometer', { car_id: carId, km: Number(odo), date: today() })
      setOdo('')
      toast('Odometer updated')
      load()
    } catch (x) { setErr(x instanceof Error ? x.message : 'Failed') }
  }

  async function addDefaults() {
    await api.post(`/cars/${carId}/default-reminders`, {})
    load()
  }

  if (err) return <p className="error">{err}</p>
  return (
    <>
      <div className="pagehead"><h1 className="disp">Service</h1><button className="btn sm" onClick={() => setEdit('new')}>Add</button></div>
      <div className="stack">
        <form className="card" onSubmit={saveOdo} style={{ display: 'grid', gap: 10 }}>
          <span className="lab">Odometer</span>
          <div className="odo mono">{data?.odometer ? `${km(data.odometer.km)} km` : '—'}</div>
          {data?.odometer && <span className="muted" style={{ fontSize: 13 }}>as of {fmtDate(data.odometer.date)}</span>}
          <div style={{ display: 'flex', gap: 8 }}>
            <input inputMode="numeric" placeholder="New reading, km" value={odo} onChange={(e) => setOdo(e.target.value.replace(/\D/g, ''))} aria-label="New odometer reading" />
            <button className="btn sm" style={{ height: 48 }} disabled={!odo}>Update</button>
          </div>
        </form>

        {data && data.reminders.length === 0 && (
          <div className="empty">
            <Icon name="gauge" size={40} />
            <h2 className="disp" style={{ fontSize: 22 }}>No reminders yet</h2>
            <p className="muted">Track oil, tyres, road tax and insurance by km or months.</p>
            <button className="btn sm" onClick={addDefaults}>Add common reminders</button>
          </div>
        )}

        <div>
          {data?.reminders.map((r) => (
            <div className="rem" key={r.id}>
              <div className="between">
                <b style={{ fontSize: 16 }}>{r.name}</b>
                <span className={'tag ' + (r.status === 'overdue' ? 'bad' : r.status === 'soon' ? 'warn' : r.status === 'unknown' ? 'plain' : 'ok')}>{statusText(r)}</span>
              </div>
              <div className="bar"><i style={{ width: `${Math.max(3, Math.min(100, r.progress * 100))}%`, background: barColor(r.status) }} /></div>
              <div className="between">
                <span className="muted" style={{ fontSize: 13 }}>
                  {[r.interval_km && `every ${km(r.interval_km)} km`, r.interval_months && `every ${r.interval_months} mo`].filter(Boolean).join(' / ')}
                  {r.last_done_date && ` · last ${fmtDate(r.last_done_date)}`}
                </span>
                <span style={{ display: 'flex', gap: 14 }}>
                  <button className="linkbtn" onClick={() => setEdit(r)}>Edit</button>
                  <button className="linkbtn" onClick={() => setDone(r)}>Mark done</button>
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
      {done && <DoneSheet r={done} onClose={() => setDone(null)} onSaved={() => { setDone(null); toast(`${done.name} marked done`); load() }} />}
      {edit && <ReminderSheet carId={carId} r={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load() }} />}
    </>
  )
}

function DoneSheet({ r, onClose, onSaved }: { r: Reminder; onClose: () => void; onSaved: () => void }) {
  const [date, setDate] = useState(today())
  const [k, setK] = useState('')
  const [err, setErr] = useState('')
  async function save(e: React.FormEvent) {
    e.preventDefault()
    try { await api.post(`/reminders/${r.id}/done`, { date, km: k || null }); onSaved() } catch (x) { setErr(x instanceof Error ? x.message : 'Failed') }
  }
  return (
    <Sheet title={r.name} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <div className="row2">
          <label><span className="lab">Done on</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label><span className="lab">At km</span><input inputMode="numeric" value={k} onChange={(e) => setK(e.target.value.replace(/\D/g, ''))} placeholder="odometer" /></label>
        </div>
        {err && <p className="error">{err}</p>}
        <button className="btn">Mark done</button>
      </form>
    </Sheet>
  )
}

function ReminderSheet({ carId, r, onClose, onSaved }: { carId: number; r: Reminder | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(r?.name ?? '')
  const [ik, setIk] = useState(r?.interval_km ? String(r.interval_km) : '')
  const [im, setIm] = useState(r?.interval_months ? String(r.interval_months) : '')
  const [err, setErr] = useState('')
  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setErr('Give it a name')
    if (!ik && !im) return setErr('Set a km or month interval')
    const body = { car_id: carId, name, interval_km: ik || null, interval_months: im || null, last_done_date: r?.last_done_date ?? null, last_done_km: r?.last_done_km ?? null }
    try { r ? await api.put(`/reminders/${r.id}`, body) : await api.post('/reminders', body); onSaved() } catch (x) { setErr(x instanceof Error ? x.message : 'Failed') }
  }
  async function remove() {
    if (r && confirm(`Remove "${r.name}"?`)) { await api.del(`/reminders/${r.id}`); onSaved() }
  }
  return (
    <Sheet title={r ? 'Edit reminder' : 'New reminder'} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <label><span className="lab">Name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Engine oil" /></label>
        <div className="row2">
          <label><span className="lab">Every km</span><input inputMode="numeric" value={ik} onChange={(e) => setIk(e.target.value.replace(/\D/g, ''))} placeholder="10000" /></label>
          <label><span className="lab">Every months</span><input inputMode="numeric" value={im} onChange={(e) => setIm(e.target.value.replace(/\D/g, ''))} placeholder="6" /></label>
        </div>
        {err && <p className="error">{err}</p>}
        <button className="btn">Save</button>
        {r && <button type="button" className="btn2 danger" onClick={remove}>Remove</button>}
      </form>
    </Sheet>
  )
}
