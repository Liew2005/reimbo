import { useState } from 'react'
import { api, ApiError } from './api'
import { setNotice } from './Login'
import { Sheet } from './sheet'

export function ChangePassword({ onSignedOut }: { onSignedOut: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="stack" style={{ gap: 8 }}>
      <div className="between">
        <div>
          <div style={{ fontWeight: 500 }}>Password</div>
          <div className="muted" style={{ fontSize: 13 }}>Changing it signs out every device.</div>
        </div>
        <button className="btn2 sm" onClick={() => setOpen(true)}>Change</button>
      </div>
      {open && <Form onClose={() => setOpen(false)} onDone={() => { setNotice('Password changed. Sign in with your new password.'); onSignedOut() }} />}
    </section>
  )
}

function Form({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [code, setCode] = useState('')
  const [needsCode, setNeedsCode] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (next !== again) { setErr('The two new passwords do not match.'); return }
    setBusy(true)
    setErr('')
    try {
      await api.post('/password/change', { current, next, code })
      onDone()
    } catch (x) {
      if (x instanceof ApiError && x.needs2fa) setNeedsCode(true)
      setErr(x instanceof Error ? x.message : 'Could not change the password')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title="Change password" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <label>
          <span className="lab">Current password</span>
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus autoComplete="current-password" />
        </label>
        <label>
          <span className="lab">New password (at least 10 characters)</span>
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        </label>
        <label>
          <span className="lab">Repeat the new password</span>
          <input type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" />
        </label>
        {needsCode && (
          <label>
            <span className="lab">Authenticator or backup code</span>
            <input className="mono" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" placeholder="123456" />
          </label>
        )}
        {err && <p className="error">{err}</p>}
        <button className="btn" disabled={busy || !current || !next || !again || (needsCode && !code)}>{busy ? 'Saving…' : 'Change password'}</button>
      </form>
    </Sheet>
  )
}
