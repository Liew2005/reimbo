export class AuthError extends Error {}

let onUnauthorized: (() => void) | null = null
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch('/api' + path, { credentials: 'same-origin', ...init })
  if (res.status === 401 && !path.startsWith('/login')) {
    onUnauthorized?.()
    throw new AuthError('Unauthorized')
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || res.statusText)
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
    const form = new FormData()
    form.append('file', new File([file], name, { type: file.type }))
    return request<{ id: number }>(`/expenses/${expenseId}/receipts`, { method: 'POST', body: form })
  },
  blob: async (path: string): Promise<Blob> => {
    const res = await fetch('/api' + path, { credentials: 'same-origin' })
    if (!res.ok) throw new Error('Could not load file')
    return res.blob()
  },
}
