import { useEffect, useState } from 'react'
import { api } from './api'
import { Backup } from './Backup'
import { Sheet } from './sheet'
import type { ThemePref } from './theme'
import { TwoFactor } from './TwoFactor'
import type { Car, PaymentMethod } from './types'

type Props = { cars: Car[]; methods: PaymentMethod[]; theme: ThemePref; setTheme: (t: ThemePref) => void; reload: () => Promise<void>; toast: (m: string) => void; onLogout: () => void }

export function Settings({ cars, methods, theme, setTheme, reload, toast, onLogout }: Props) {
  const [name, setName] = useState('')
  const [car, setCar] = useState<Car | 'new' | null>(null)
  const [pm, setPm] = useState<PaymentMethod | 'new' | null>(null)

  useEffect(() => { api.get<{ claimant_name?: string | null }>('/settings').then((s) => setName(s.claimant_name ?? '')).catch(() => {}) }, [])

  async function saveName() {
    await api.put('/settings', { claimant_name: name })
    toast('Name saved')
  }

  return (
    <>
      <div className="pagehead"><h1 className="disp">Setup</h1></div>
      <div className="stack" style={{ gap: 24 }}>
        <section className="stack" style={{ gap: 8 }}>
          <span className="lab">Appearance</span>
          <div className="seg">
            {(['light', 'dark', 'system'] as ThemePref[]).map((t) => (
              <button key={t} className={theme === t ? 'on' : ''} onClick={() => setTheme(t)}>{t[0].toUpperCase() + t.slice(1)}</button>
            ))}
          </div>
        </section>

        <section className="stack" style={{ gap: 8 }}>
          <span className="lab">Name on claim reports</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your full name" />
            <button className="btn sm" style={{ height: 48 }} onClick={saveName}>Save</button>
          </div>
        </section>

        <section>
          <div className="between hair" style={{ paddingBottom: 8 }}><span className="lab">Cars</span><button className="linkbtn" onClick={() => setCar('new')}>Add car</button></div>
          {cars.map((c) => (
            <button key={c.id} className="erow" style={{ gridTemplateColumns: '1fr auto' }} onClick={() => setCar(c)}>
              <span className="v" style={{ gridArea: 'auto' }}><span className="vn">{c.name}</span><span className="vm" style={{ display: 'block' }}>{c.plate || 'No plate'}</span></span>
              {c.archived ? <span className="tag plain">Archived</span> : <span />}
            </button>
          ))}
        </section>

        <section>
          <div className="between hair" style={{ paddingBottom: 8 }}><span className="lab">Payment methods</span><button className="linkbtn" onClick={() => setPm('new')}>Add</button></div>
          {methods.map((m) => (
            <button key={m.id} className="erow" style={{ gridTemplateColumns: '1fr auto' }} onClick={() => setPm(m)}>
              <span className="vn" style={{ gridArea: 'auto' }}>{m.name}</span>
              <span style={{ display: 'flex', gap: 6 }}>
                {m.archived ? <span className="tag plain">Archived</span> : null}
                <span className={'tag ' + (m.claimable ? 'own' : 'co')}>{m.claimable ? 'Claimable' : 'Company card'}</span>
              </span>
            </button>
          ))}
        </section>

        <TwoFactor toast={toast} />
        <Backup toast={toast} />

        <button className="btn2" onClick={async () => { await api.post('/logout'); onLogout() }}>Log out</button>
      </div>
      {car && <CarSheet car={car === 'new' ? null : car} onClose={() => setCar(null)} onSaved={async () => { setCar(null); await reload() }} />}
      {pm && <MethodSheet m={pm === 'new' ? null : pm} onClose={() => setPm(null)} onSaved={async () => { setPm(null); await reload() }} />}
    </>
  )
}

function CarSheet({ car, onClose, onSaved }: { car: Car | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(car?.name ?? '')
  const [plate, setPlate] = useState(car?.plate ?? '')
  const [archived, setArchived] = useState(!!car?.archived)
  const [err, setErr] = useState('')
  async function save(e: React.FormEvent) {
    e.preventDefault()
    try {
      const body = { name, plate, notes: car?.notes ?? '', archived }
      car ? await api.put(`/cars/${car.id}`, body) : await api.post('/cars', body)
      onSaved()
    } catch (x) { setErr(x instanceof Error ? x.message : 'Failed') }
  }
  return (
    <Sheet title={car ? 'Edit car' : 'Add car'} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <label><span className="lab">Name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Company Vios" autoFocus /></label>
        <label><span className="lab">Plate</span><input value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} placeholder="VAB 1234" /></label>
        {car && <label style={{ display: 'flex', gap: 10, alignItems: 'center' }}><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />Archived (hide from the car list)</label>}
        {err && <p className="error">{err}</p>}
        <button className="btn">Save</button>
      </form>
    </Sheet>
  )
}

function MethodSheet({ m, onClose, onSaved }: { m: PaymentMethod | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(m?.name ?? '')
  const [claimable, setClaimable] = useState(m ? !!m.claimable : true)
  const [archived, setArchived] = useState(!!m?.archived)
  const [err, setErr] = useState('')
  async function save(e: React.FormEvent) {
    e.preventDefault()
    try {
      const body = { name, claimable, archived }
      m ? await api.put(`/payment-methods/${m.id}`, body) : await api.post('/payment-methods', body)
      onSaved()
    } catch (x) { setErr(x instanceof Error ? x.message : 'Failed') }
  }
  return (
    <Sheet title={m ? 'Edit payment method' : 'Add payment method'} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <label><span className="lab">Name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Touch 'n Go" autoFocus /></label>
        <label style={{ display: 'flex', gap: 10, alignItems: 'center' }}><input type="checkbox" checked={claimable} onChange={(e) => setClaimable(e.target.checked)} />My money, so I claim it back (untick for a company card)</label>
        {m && <label style={{ display: 'flex', gap: 10, alignItems: 'center' }}><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />Archived</label>}
        {err && <p className="error">{err}</p>}
        <button className="btn">Save</button>
      </form>
    </Sheet>
  )
}
