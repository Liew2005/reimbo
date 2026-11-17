import { useCallback, useEffect, useState } from 'react'
import { api, AuthError } from './api'
import type { ExpenseValues } from './types'

/** Expenses saved on the phone while offline, uploaded later. Stored in IndexedDB so photos survive a closed app. */
export type QueuedFile = { name: string; type: string; blob: Blob }
export type Queued = { id?: number; values: ExpenseValues; files: QueuedFile[]; created: number; expenseId?: number; error?: string }

const DB_NAME = 'reimbo-offline'
const STORE = 'queue'
const notify = () => window.dispatchEvent(new Event('queue-changed'))

let dbPromise: Promise<IDBDatabase> | null = null

// One shared connection. Opening a new one per call (as before) leaked connections on a long-lived phone tab.
function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
    r.onsuccess = () => {
      r.result.onclose = () => { dbPromise = null }
      r.result.onversionchange = () => { r.result.close(); dbPromise = null }
      res(r.result)
    }
    r.onerror = () => { dbPromise = null; rej(r.error) }
  })
  return dbPromise
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  return new Promise((res, rej) => {
    const r = fn(db.transaction(STORE, mode).objectStore(STORE))
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}

export const listQueued = () => run<Queued[]>('readonly', (s) => s.getAll())
export async function addQueued(q: Omit<Queued, 'id'>) { await run('readwrite', (s) => s.add(q)); notify() }
const putQueued = (q: Queued) => run('readwrite', (s) => s.put(q))
export async function removeQueued(id: number) { await run('readwrite', (s) => s.delete(id)); notify() }

/** fetch() rejects with a TypeError when there is no connection. */
export const isNetworkError = (e: unknown) => e instanceof TypeError

let syncing = false

/** Uploads queued items in order. Stops quietly when offline. Items that the server rejects keep an error and are skipped unless `force`. */
export async function syncQueue(force = false): Promise<{ done: number; failed: number; left: number }> {
  if (syncing) return { done: 0, failed: 0, left: (await listQueued()).length }
  syncing = true
  let done = 0
  let failed = 0
  let touched = false // only tell the UI when something actually changed, or every poll refetches the list
  try {
    const items = (await listQueued()).sort((a, b) => (a.id ?? 0) - (b.id ?? 0))
    for (const q of items) {
      if (q.error && !force) continue
      touched = true
      try {
        let id = q.expenseId
        if (!id) {
          id = (await api.post<{ id: number }>('/expenses', q.values)).id
          q.expenseId = id // remember it so a retry never creates a duplicate
          q.error = undefined
          await putQueued(q)
        }
        while (q.files.length) {
          await api.upload(id, q.files[0].blob, q.files[0].name)
          q.files.shift()
          await putQueued(q)
        }
        await removeQueued(q.id!)
        done++
      } catch (e) {
        if (isNetworkError(e) || e instanceof AuthError) break
        q.error = e instanceof Error ? e.message : 'Upload failed'
        await putQueued(q)
        failed++
      }
    }
  } finally {
    syncing = false
    if (touched) notify()
  }
  return { done, failed, left: (await listQueued()).length }
}

const same = (a: Queued[], b: Queued[]) =>
  a.length === b.length && a.every((x, i) => x.id === b[i].id && x.error === b[i].error && x.files.length === b[i].files.length)

export function useQueue(): Queued[] {
  const [items, setItems] = useState<Queued[]>([])
  const refresh = useCallback(() => { listQueued().then((n) => setItems((cur) => (same(cur, n) ? cur : n))).catch(() => {}) }, [])
  useEffect(() => {
    refresh()
    window.addEventListener('queue-changed', refresh)
    return () => window.removeEventListener('queue-changed', refresh)
  }, [refresh])
  return items
}
