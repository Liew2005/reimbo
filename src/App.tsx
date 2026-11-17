import { useCallback, useEffect, useState } from 'react'
import { AddExpense } from './AddExpense'
import { api, AuthError, setUnauthorizedHandler } from './api'
import { Claims } from './Claims'
import { ExpenseList } from './ExpenseList'
import { Login, Splash } from './Login'
import { isNetworkError, syncQueue, useQueue } from './offline'
import { PendingSheet } from './Pending'
import { Service, statusText } from './Service'
import { Settings } from './Settings'
import { useTheme } from './theme'
import type { Car, PaymentMethod, Reminder, ServiceData } from './types'
import { Icon, LogoTile, Receipt, Word, type IconName } from './ui'

type Tab = 'add' | 'expenses' | 'claims' | 'service' | 'setup'
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'add', label: 'Add', icon: 'plus' },
  { id: 'expenses', label: 'Expenses', icon: 'list' },
  { id: 'claims', label: 'Claims', icon: 'doc' },
  { id: 'service', label: 'Service', icon: 'gauge' },
  { id: 'setup', label: 'Setup', icon: 'gear' },
]
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export default function App() {
  const [auth, setAuth] = useState<'loading' | 'in' | 'out'>('loading')
  const [cars, setCars] = useState<Car[]>([])
  const [methods, setMethods] = useState<PaymentMethod[]>([])
  const [carId, setCarId] = useState(() => Number(localStorage.getItem('carId')) || 0)
  const [tab, setTab] = useState<Tab>('add')
  const [theme, setTheme] = useTheme()
  const [toast, setToast] = useState<{ msg: string; k: number } | null>(null)
  const [overdue, setOverdue] = useState(0)
  const [due, setDue] = useState<Reminder[]>([])
  const [dismissed, setDismissed] = useState<string>(() => sessionStorage.getItem('dueDismissed') ?? '')
  const [buildSignal, setBuildSignal] = useState(0)

  const show = useCallback((msg: string) => setToast({ msg, k: Date.now() }), [])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(t)
  }, [toast])

  const reload = useCallback(async () => {
    const [c, m] = await Promise.all([api.get<Car[]>('/cars'), api.get<PaymentMethod[]>('/payment-methods')])
    localStorage.setItem('cache:cars', JSON.stringify(c))
    localStorage.setItem('cache:methods', JSON.stringify(m))
    setCars(c)
    setMethods(m)
    setCarId((cur) => {
      const active = c.filter((x) => !x.archived)
      return active.some((x) => x.id === cur) ? cur : active[0]?.id ?? 0
    })
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(() => setAuth('out'))
    Promise.all([api.get('/me').then(reload), sleep(900)])
      .then(() => setAuth('in'))
      .catch((e) => {
        if (isNetworkError(e)) { // offline start: use the last known cars and payment methods
          try {
            const c = JSON.parse(localStorage.getItem('cache:cars') ?? 'null') as Car[] | null
            const m = JSON.parse(localStorage.getItem('cache:methods') ?? 'null') as PaymentMethod[] | null
            if (c && m) { setCars(c); setMethods(m); setCarId((cur) => cur || c.find((x) => !x.archived)?.id || 0); setAuth('in'); return }
          } catch { /* fall through */ }
        }
        if (!(e instanceof AuthError)) console.error(e)
        setAuth('out')
      })
  }, [reload])

  const queue = useQueue()
  const [showPending, setShowPending] = useState(false)
  useEffect(() => {
    if (auth !== 'in') return
    const run = () => {
      if (!navigator.onLine) return
      syncQueue().then((r) => { if (r.done) show(`Uploaded ${r.done} saved offline`) }).catch(() => {})
    }
    run()
    window.addEventListener('online', run)
    const t = setInterval(run, 30000)
    return () => { window.removeEventListener('online', run); clearInterval(t) }
  }, [auth, show])

  useEffect(() => { if (carId) localStorage.setItem('carId', String(carId)) }, [carId])

  const refreshBadge = useCallback(() => {
    if (!carId) return
    api.get<ServiceData>(`/service?car_id=${carId}`).then((d) => {
      setOverdue(d.reminders.filter((r) => r.status === 'overdue').length)
      setDue(d.reminders.filter((r) => r.status === 'overdue' || r.status === 'soon'))
    }).catch(() => {})
  }, [carId])
  useEffect(() => { if (auth === 'in') refreshBadge() }, [auth, refreshBadge, tab])

  if (auth === 'loading') return <Splash />
  if (auth === 'out') return <Login onDone={() => { setAuth('loading'); Promise.all([reload(), sleep(300)]).then(() => { setTab('add'); setAuth('in') }).catch(() => setAuth('out')) }} />

  const dueKey = carId + ':' + due.map((r) => r.id + r.status).join(',')
  const showAlert = due.length > 0 && dismissed !== dueKey && tab !== 'service' && tab !== 'setup'
  const activeCars = cars.filter((c) => !c.archived)
  const dark = document.documentElement.dataset.theme === 'dark'
  const carSelect = activeCars.length > 1 && (
    <select className="carsel" value={carId} onChange={(e) => setCarId(Number(e.target.value))} aria-label="Car">
      {activeCars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  )

  let screen
  if (!carId && tab !== 'setup') {
    screen = (
      <div className="empty">
        <Receipt w={64} h={84} total={false} />
        <h2 className="disp" style={{ fontSize: 22 }}>Add your car first</h2>
        <p className="muted">Reimbo needs a car to attach expenses to.</p>
        <button className="btn sm" onClick={() => setTab('setup')}>Go to Setup</button>
      </div>
    )
  } else if (tab === 'add') screen = <AddExpense cars={activeCars} methods={methods} carId={carId} toast={show} onSaved={() => {}} />
  else if (tab === 'expenses') screen = <ExpenseList cars={activeCars} methods={methods} carId={carId} toast={show} onBuild={() => { setBuildSignal((n) => n + 1); setTab('claims') }} />
  else if (tab === 'claims') screen = <Claims carId={carId} toast={show} buildSignal={buildSignal} />
  else if (tab === 'service') screen = <Service carId={carId} toast={show} onChanged={refreshBadge} />
  else screen = <Settings cars={cars} methods={methods} theme={theme} setTheme={setTheme} reload={reload} toast={show} onLogout={() => setAuth('out')} />

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand" style={{ marginBottom: 24 }}><LogoTile size={36} /><Word size={26} /></div>
        {TABS.map((t) => (
          <button key={t.id} className={'navbtn' + (tab === t.id ? ' on' : '')} onClick={() => setTab(t.id)}>
            <Icon name={t.icon} size={20} /><span className="grow">{t.label}</span>
            {t.id === 'service' && overdue > 0 && <span className="tag bad">{overdue}</span>}
          </button>
        ))}
        <div style={{ marginTop: 'auto', display: 'grid', gap: 10 }}>
          {carSelect || (activeCars[0] && <span className="muted" style={{ fontSize: 13 }}>{activeCars[0].name}</span>)}
          <button className="btn2 sm" onClick={() => setTheme(dark ? 'light' : 'dark')}><Icon name={dark ? 'sun' : 'moon'} size={18} />{dark ? 'Light mode' : 'Dark mode'}</button>
        </div>
      </aside>
      <div className="main">
        <header className="mhdr">
          <div className="brand"><LogoTile size={32} /><Word size={22} /></div>
          {carSelect || (activeCars[0] && <span className="muted" style={{ fontSize: 13 }}>{activeCars[0].name}</span>)}
        </header>
        <main className="content" key={tab}>
          {queue.length > 0 && (
            <div className="alert info" role="status">
              <button className="alert-body" onClick={() => setShowPending(true)}>
                <Icon name="alert" size={18} />
                <span>{queue.length} saved on this phone, waiting to upload</span>
              </button>
            </div>
          )}
          {showAlert && (
            <div className={'alert' + (due.some((r) => r.status === 'overdue') ? ' bad' : '')} role="alert">
              <button className="alert-body" onClick={() => setTab('service')}>
                <Icon name="alert" size={18} />
                <span>
                  {due.slice(0, 2).map((r) => `${r.name}: ${statusText(r)}`).join(' · ')}
                  {due.length > 2 ? ` · +${due.length - 2} more` : ''}
                </span>
              </button>
              <button className="icobtn" style={{ width: 32, height: 32, border: 0, background: 'transparent' }} aria-label="Dismiss" onClick={() => { sessionStorage.setItem('dueDismissed', dueKey); setDismissed(dueKey) }}><Icon name="x" size={16} /></button>
            </div>
          )}
          {screen}
        </main>
      </div>
      <nav className="tabbar" aria-label="Main">
        {TABS.map((t) => (
          <button key={t.id} className={'tab' + (tab === t.id ? ' on' : '')} onClick={() => setTab(t.id)} aria-current={tab === t.id ? 'page' : undefined}>
            <Icon name={t.icon} />{t.label}
            {t.id === 'service' && overdue > 0 && <span className="badge">{overdue}</span>}
          </button>
        ))}
      </nav>
      {showPending && <PendingSheet onClose={() => setShowPending(false)} toast={show} />}
      {toast && (
        <div className="toast" key={toast.k} role="status">
          <span className="pile"><Receipt className="slip" w={26} h={34} total={false} /></span>{toast.msg}
        </div>
      )}
    </div>
  )
}
