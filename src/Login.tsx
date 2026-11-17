import { useState } from 'react'
import { api, ApiError } from './api'
import { LogoTile, Word, CarGlyph } from './ui'

export function Splash() {
  return (
    <div className="splash" role="status" aria-label="Loading">
      <CarGlyph size={150} road />
      <Word size={54} />
    </div>
  )
}

type Step = 'password' | 'code' | 'forgot' | 'reset'

/** Set after a password change or reset, shown once on the sign-in screen. */
export const setNotice = (m: string) => sessionStorage.setItem('notice', m)

export function Login({ onDone }: { onDone: () => void }) {
  // A reset link opens the app as /?reset=<token>. Read it once, then remove it from the address bar.
  const [resetToken] = useState(() => {
    const t = new URLSearchParams(location.search).get('reset')
    if (t) history.replaceState(null, '', location.pathname)
    return t
  })
  const [step, setStep] = useState<Step>(resetToken ? 'reset' : 'password')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [code, setCode] = useState('')
  const [needsCode, setNeedsCode] = useState(false)
  const [trust, setTrust] = useState(true)
  const [err, setErr] = useState('')
  const [info, setInfo] = useState(() => {
    const n = sessionStorage.getItem('notice') ?? ''
    sessionStorage.removeItem('notice')
    return n
  })
  const [busy, setBusy] = useState(false)

  const go = (s: Step) => { setStep(s); setErr(''); setInfo(''); setCode(''); setPassword(''); setPassword2('') }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      if (step === 'password') {
        const r = await api.post<{ needs_2fa?: boolean }>('/login', { password })
        if (r.needs_2fa) setStep('code')
        else onDone()
      } else if (step === 'code') {
        await api.post('/login/2fa', { code, trust })
        onDone()
      } else if (step === 'forgot') {
        await api.post('/password/forgot')
        setInfo('Check your email. The link works once and expires in 15 minutes.')
      } else {
        if (password !== password2) { setErr('The two passwords do not match.'); return }
        await api.post('/password/reset', { token: resetToken, password, code })
        go('password')
        setInfo('Password updated. Sign in with your new password.')
      }
    } catch (x) {
      const msg = x instanceof Error ? x.message : 'Something went wrong'
      if (x instanceof ApiError && x.needs2fa) setNeedsCode(true)
      setErr(msg)
      if (msg.startsWith('Session expired')) { setStep('password'); setCode('') }
    } finally {
      setBusy(false)
    }
  }

  const label = step === 'password' ? 'Sign in' : step === 'code' ? 'Verify' : step === 'forgot' ? 'Email me a link' : 'Set new password'
  const disabled = busy || (step === 'password' ? !password : step === 'code' ? !code : step === 'reset' ? !password || !password2 || (needsCode && !code) : !!info)

  return (
    <form className="login" onSubmit={submit}>
      <div className="brand"><LogoTile size={44} /><Word size={34} /></div>
      {step === 'password' && (
        <>
          <p className="muted" style={{ margin: 0 }}>Car receipts and claims, in one place.</p>
          {info && <p className="muted" style={{ margin: 0, color: 'var(--accent)' }} role="status">{info}</p>}
          <label>
            <span className="lab">Password</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="current-password" />
          </label>
        </>
      )}
      {step === 'code' && (
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
      {step === 'forgot' && (
        <p className="muted" style={{ margin: 0 }}>
          We'll email a reset link to the address Reimbo uses for reminders. If you use two-factor, you'll still need your authenticator or a backup code to finish.
        </p>
      )}
      {step === 'reset' && (
        <>
          <p className="muted" style={{ margin: 0 }}>Choose a new password (at least 10 characters).</p>
          <label>
            <span className="lab">New password</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="new-password" />
          </label>
          <label>
            <span className="lab">Repeat it</span>
            <input type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" />
          </label>
          {needsCode && (
            <label>
              <span className="lab">Authenticator or backup code</span>
              <input className="mono" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" placeholder="123456" />
            </label>
          )}
        </>
      )}
      {step === 'forgot' && info && <p className="muted" style={{ margin: 0, color: 'var(--accent)' }} role="status">{info}</p>}
      {err && <p className="error">{err}</p>}
      <button className="btn" disabled={disabled}>{busy ? 'Checking…' : label}</button>
      {step === 'password' && <button type="button" className="linkbtn" onClick={() => go('forgot')}>Forgot password?</button>}
      {(step === 'code' || step === 'forgot' || step === 'reset') && <button type="button" className="linkbtn" onClick={() => go('password')}>Back to sign in</button>}
    </form>
  )
}
