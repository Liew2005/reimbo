import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import { Sheet } from './sheet'
import { saveBlob } from './util'

type Status = { enabled: boolean; backup_left: number }

export function TwoFactor({ toast }: { toast: (m: string) => void }) {
  const [st, setSt] = useState<Status | null>(null)
  const [mode, setMode] = useState<'on' | 'off' | null>(null)
  const load = useCallback(() => { api.get<Status>('/2fa').then(setSt).catch(() => {}) }, [])
  useEffect(load, [load])

  return (
    <section className="stack" style={{ gap: 8 }}>
      <span className="lab">Security</span>
      <div className="between">
        <div>
          <div style={{ fontWeight: 500 }}>Two-factor login</div>
          <div className="muted" style={{ fontSize: 13 }}>
            {st?.enabled ? `On. ${st.backup_left} backup ${st.backup_left === 1 ? 'code' : 'codes'} left.` : 'Off. Adds a 6-digit code from an authenticator app.'}
          </div>
        </div>
        {st && (st.enabled
          ? <button className="btn2 sm" onClick={() => setMode('off')}>Turn off</button>
          : <button className="btn sm" onClick={() => setMode('on')}>Turn on</button>)}
      </div>
      {mode === 'on' && <Enable onClose={() => { setMode(null); load() }} toast={toast} />}
      {mode === 'off' && <Disable onClose={() => setMode(null)} onDone={() => { setMode(null); load(); toast('Two-factor turned off') }} />}
    </section>
  )
}

function Enable({ onClose, toast }: { onClose: () => void; toast: (m: string) => void }) {
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null)
  const [qr, setQr] = useState('')
  const [code, setCode] = useState('')
  const [codes, setCodes] = useState<string[] | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.post<{ secret: string; uri: string }>('/2fa/setup').then(async (s) => {
      setSetup(s)
      const QR = await import('qrcode')
      setQr(await QR.toDataURL(s.uri, { margin: 1, width: 220, color: { dark: '#14532d', light: '#ffffff' } }))
    }).catch((e) => setErr(e.message))
  }, [])

  async function verify(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      const r = await api.post<{ backup_codes: string[] }>('/2fa/enable', { code })
      setCodes(r.backup_codes)
      toast('Two-factor is on')
    } catch (x) {
      setErr(x instanceof Error ? x.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  if (codes) {
    const text = 'Reimbo backup codes (each works once)\n\n' + codes.join('\n') + '\n'
    return (
      <Sheet title="Save your backup codes" onClose={onClose}>
        <div className="stack">
          <p className="muted" style={{ margin: 0 }}>If you lose your phone, each of these signs you in once. They won't be shown again.</p>
          <div className="card mono" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 16 }}>
            {codes.map((c) => <span key={c}>{c}</span>)}
          </div>
          <div className="row2">
            <button className="btn2" onClick={() => navigator.clipboard?.writeText(text).then(() => toast('Copied'))}>Copy</button>
            <button className="btn2" onClick={() => saveBlob(new Blob([text], { type: 'text/plain' }), 'reimbo-backup-codes.txt')}>Download</button>
          </div>
          <button className="btn" onClick={onClose}>I've saved them</button>
        </div>
      </Sheet>
    )
  }

  return (
    <Sheet title="Turn on two-factor" onClose={onClose}>
      <form className="stack" onSubmit={verify}>
        <p className="muted" style={{ margin: 0 }}>1. Open an authenticator app (Google Authenticator, Authy, 1Password…) and scan this.</p>
        <div style={{ display: 'grid', placeItems: 'center' }}>
          {qr ? <img src={qr} alt="QR code for the authenticator app" width={220} height={220} style={{ borderRadius: 8, border: '1px solid var(--line)' }} /> : <div style={{ width: 220, height: 220 }} />}
        </div>
        {setup && (
          <p className="muted" style={{ margin: 0, fontSize: 13, wordBreak: 'break-all' }}>
            Can't scan? Enter this key instead:<br /><span className="mono" style={{ color: 'var(--ink)' }}>{setup.secret}</span>
          </p>
        )}
        <label>
          <span className="lab">2. Enter the 6-digit code it shows</span>
          <input className="mono" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="123456" />
        </label>
        {err && <p className="error">{err}</p>}
        <button className="btn" disabled={busy || code.length !== 6 || !setup}>{busy ? 'Checking…' : 'Turn on'}</button>
      </form>
    </Sheet>
  )
}

function Disable({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    try { await api.post('/2fa/disable', { code }); onDone() } catch (x) { setErr(x instanceof Error ? x.message : 'Failed') }
  }
  return (
    <Sheet title="Turn off two-factor" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="muted" style={{ margin: 0 }}>Enter a code from your authenticator app, or a backup code, to confirm.</p>
        <input className="mono" value={code} onChange={(e) => setCode(e.target.value)} autoFocus placeholder="123456" />
        {err && <p className="error">{err}</p>}
        <button className="btn" disabled={!code}>Turn off</button>
      </form>
    </Sheet>
  )
}
