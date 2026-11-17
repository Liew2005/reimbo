import { useEffect, useState } from 'react'
import { api } from './api'
import { fmtDate, saveBlob, today } from './util'

type Dump = { tables: { receipts: { id: number; content_type: string | null }[] } }

export function Backup({ toast }: { toast: (m: string) => void }) {
  const [busy, setBusy] = useState('')
  const [auto, setAuto] = useState<{ count: number; latest: string | null } | null>(null)
  useEffect(() => { api.get<{ count: number; latest: string | null }>('/backup/status').then(setAuto).catch(() => {}) }, [])

  async function download() {
    setBusy('Collecting data…')
    try {
      const { zipSync } = await import('fflate')
      const dump = await api.get<Dump>('/backup')
      const files: Record<string, Uint8Array> = { 'data.json': new TextEncoder().encode(JSON.stringify(dump, null, 2)) }
      const rs = dump.tables.receipts
      let done = 0
      const queue = [...rs]
      await Promise.all(Array.from({ length: 4 }, async () => {
        for (let r = queue.shift(); r; r = queue.shift()) {
          const ext = r.content_type === 'application/pdf' ? 'pdf' : r.content_type === 'image/png' ? 'png' : 'jpg'
          files[`receipts/${r.id}.${ext}`] = new Uint8Array(await (await api.blob(`/receipts/${r.id}`)).arrayBuffer())
          setBusy(`Receipts ${++done}/${rs.length}…`)
        }
      }))
      saveBlob(new Blob([zipSync(files, { level: 0 }) as BlobPart], { type: 'application/zip' }), `reimbo-backup-${today()}.zip`)
      toast('Backup downloaded')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Backup failed')
    } finally {
      setBusy('')
    }
  }

  return (
    <section className="stack" style={{ gap: 8 }}>
      <span className="lab">Backup</span>
      <div className="between">
        <div>
          <div style={{ fontWeight: 500 }}>Download everything</div>
          <div className="muted" style={{ fontSize: 13 }}>
            Data and all receipts in one ZIP.{auto?.latest ? ` Automatic weekly copy last ran ${fmtDate(auto.latest)}.` : ' An automatic weekly copy also runs on Cloudflare.'}
          </div>
        </div>
        <button className="btn2 sm" disabled={!!busy} onClick={download}>{busy || 'Download'}</button>
      </div>
    </section>
  )
}
