import { useState } from 'react'
import { api } from './api'
import { LogoTile, Word, CarGlyph } from './ui'

export function Splash() {
  return (
    <div className="splash" role="status" aria-label="Loading">
      <CarGlyph size={150} road />
      <Word size={54} />
    </div>
  )
}

export function Login({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<'password' | 'code'>('password')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [trust, setTrust] = useState(true)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      if (step === 'password') {
        const r = await api.post<{ needs_2fa?: boolean }>('/login', { password })
        if (r.needs_2fa) setStep('code')
        else onDone()
      } else {
        await api.post('/login/2fa', { code, trust })
        onDone()
      }
    } catch (x) {
      const msg = x instanceof Error ? x.message : 'Could not sign in'
      setErr(msg)
      if (msg.startsWith('Session expired')) { setStep('password'); setCode('') }
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="login" onSubmit={submit}>
      <div className="brand"><LogoTile size={44} /><Word size={34} /></div>
      {step === 'password' ? (
        <>
          <p className="muted" style={{ margin: 0 }}>Car receipts and claims, in one place.</p>
          <label>
            <span className="lab">Password</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="current-password" />
          </label>
        </>
      ) : (
        <>
          <p className="muted" style={{ margin: 0 }}>Enter the 6-digit code from your authenticator app, or a backup code.</p>
          <label>
            <span className="lab">Code</span>
            <input className="mono" value={code} onChange={(e) => setCode(e.target.value)} autoFocus autoComplete="one-time-code" inputMode="text" placeholder="123456" />
          </label>
          <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 14 }}>
            <input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} />Trust this device for 30 days
          </label>
        </>
      )}
      {err && <p className="error">{err}</p>}
      <button className="btn" disabled={busy || (step === 'password' ? !password : !code)}>{busy ? 'Checking…' : step === 'password' ? 'Sign in' : 'Verify'}</button>
      {step === 'code' && <button type="button" className="linkbtn" onClick={() => { setStep('password'); setCode(''); setErr('') }}>Back</button>}
    </form>
  )
}
