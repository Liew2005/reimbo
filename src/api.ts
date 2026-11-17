export class AuthError extends Error {}
export class ApiError extends Error {
  constructor(message: string, public needs2fa = false) { super(message) }
}

let onUnauthorized: (() => void) | null = null
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch('/api' + path, { credentials: 'same-origin', ...init })
  if (res.status === 401 && !path.startsWith('/login') && !path.startsWith('/password')) {
    onUnauthorized?.()
    throw new AuthError('Unauthorized')
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new ApiError(body.error || res.statusText, !!body.needs_2fa)
  }
  return res.json() as Promise<T>
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown = {}) => request<T>(path, jsonInit('POST', body)),
  put: <T>(path: string, body: unknown) => request<T>(path, jsonInit('PUT', body)),
  patch: <T>(path: string, body: unknown) => request<T>(path, jsonInit('PATCH', body)),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: async (expenseId: number, file: Blob, name: string) => {
    // A phone often has a dead connection after coming back from the camera app; the first request then
    // fails with a TypeError and the next one works. Retry quietly instead of failing the receipt.
    let last: unknown
    for (let i = 0; i < 3; i++) {
      try {
        const form = new FormData()
        form.append('file', new File([file], name, { type: file.type }))
        return await request<{ id: number }>(`/expenses/${expenseId}/receipts`, { method: 'POST', body: form })
      } catch (e) {
        last = e
        if (!(e instanceof TypeError)) throw e
        await new Promise((r) => setTimeout(r, 700 * (i + 1)))
      }
    }
    throw last
  },
  blob: async (path: string): Promise<Blob> => {
    const res = await fetch('/api' + path, { credentials: 'same-origin' })
    if (!res.ok) throw new Error('Could not load file')
    return res.blob()
  },
}
