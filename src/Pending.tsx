import { useState } from 'react'
import { removeQueued, syncQueue, useQueue } from './offline'
import { Sheet } from './sheet'
import { categoryLabel } from './types'
import { fmtDayMon, rm } from './util'

export function PendingSheet({ onClose, toast }: { onClose: () => void; toast: (m: string) => void }) {
  const items = useQueue()
  const [busy, setBusy] = useState(false)

  async function sync() {
    setBusy(true)
    const r = await syncQueue(true)
    setBusy(false)
    if (r.done) toast(`Uploaded ${r.done} saved offline`)
    else if (r.left) toast(navigator.onLine ? 'Could not reach Reimbo yet' : 'Still offline')
    if (!r.left) onClose()
  }

  return (
    <Sheet title="Waiting to upload" onClose={onClose}>
      {items.length === 0 ? <p className="muted">All uploaded.</p> : (
        <div className="stack" style={{ gap: 10 }}>
          <div>
            {items.map((q) => (
              <div className="checkrow" style={{ gridTemplateColumns: '1fr auto auto' }} key={q.id}>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.values.vendor || categoryLabel(q.values.category)}</span>
                  <span className="muted" style={{ fontSize: 13 }}>{fmtDayMon(q.values.date)}{q.files.length ? ` · ${q.files.length} receipt${q.files.length > 1 ? 's' : ''}` : ' · no receipt'}</span>
                  {q.error && <span className="error" style={{ display: 'block', fontSize: 13 }}>{q.error}</span>}
                </span>
                <span className="mono">{rm(q.values.amount_cents)}</span>
                <button className="linkbtn danger" onClick={() => { if (confirm('Discard this saved expense? It has not been uploaded.')) removeQueued(q.id!) }}>Discard</button>
              </div>
            ))}
          </div>
          <button className="btn" disabled={busy} onClick={sync}>{busy ? 'Uploading…' : 'Upload now'}</button>
        </div>
      )}
    </Sheet>
  )
}
