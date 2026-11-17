import { useState } from 'react'
import { api } from './api'
import { ExpenseForm } from './ExpenseForm'
import { addQueued, isNetworkError, type QueuedFile } from './offline'
import type { Car, ExpenseValues, PaymentMethod } from './types'
import { prepareReceipt, rm } from './util'

type Props = { cars: Car[]; methods: PaymentMethod[]; carId: number; toast: (m: string) => void; onSaved: () => void }

export function AddExpense({ cars, methods, carId, toast, onSaved }: Props) {
  const [n, setN] = useState(0)

  async function submit(v: ExpenseValues, files: File[]) {
    const prepared: QueuedFile[] = []
    for (const f of files) {
      const p = await prepareReceipt(f)
      prepared.push({ name: p.name, type: p.blob.type, blob: p.blob })
    }
    const saveOffline = async (expenseId?: number, rest: QueuedFile[] = prepared) => {
      await addQueued({ values: v, files: rest, created: Date.now(), expenseId })
      toast('Saved on this phone. Uploads when you are online.')
      setN((x) => x + 1)
    }

    if (!navigator.onLine) return saveOffline()
    let id: number
    try {
      id = (await api.post<{ id: number }>('/expenses', v)).id
    } catch (e) {
      if (isNetworkError(e)) return saveOffline()
      throw e
    }
    let failed = 0
    for (let i = 0; i < prepared.length; i++) {
      try {
        await api.upload(id, prepared[i].blob, prepared[i].name)
      } catch (e) {
        if (isNetworkError(e)) { await saveOffline(id, prepared.slice(i)); onSaved(); return }
        failed++
      }
    }
    toast(failed ? `Saved ${rm(v.amount_cents)}, ${failed} receipt failed to upload` : `Saved ${rm(v.amount_cents)}`)
    setN((x) => x + 1)
    onSaved()
  }

  return (
    <>
      <div className="pagehead"><h1 className="disp">Add expense</h1></div>
      <ExpenseForm key={n} cars={cars} methods={methods} carId={carId} submitLabel="Save expense" onSubmit={submit} />
    </>
  )
}
