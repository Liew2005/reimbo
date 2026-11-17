// Local end-to-end check of password change, reset and how they interact with 2FA.
// Usage: node scripts/test-password.mjs <base-url> <current-password>   (against `wrangler dev`, throwaway local DB)
// The reset email itself is not sent locally (no Resend key), so reset tokens are written straight to the local DB.
import { createHash, createHmac } from 'node:crypto'
import { execSync } from 'node:child_process'

const [base, password] = process.argv.slice(2)
const NEW1 = 'first-new-password-1'
const NEW2 = 'second-new-password-2'
const NEW3 = 'third-new-password-3'
const NEW4 = 'fourth-new-password-4'

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const dec = (s) => { let bits = 0, v = 0; const o = []; for (const ch of s) { v = (v << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { o.push((v >>> (bits - 8)) & 255); bits -= 8 } } return Buffer.from(o) }
const totp = (secret, step) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(step)); const h = createHmac('sha1', dec(secret)).update(b).digest(); const o = h[19] & 15; return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0') }
const nowStep = () => Math.floor(Date.now() / 30000)

let jar = {}
const call = async (method, path, body) => {
  const res = await fetch(base + '/api' + path, { method, headers: { 'Content-Type': 'application/json', cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') }, body: body ? JSON.stringify(body) : undefined })
  for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const [k, ...v] = kv.split('='); if (/Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c)) delete jar[k]; else jar[k] = v.join('=') }
  return { status: res.status, json: await res.json().catch(() => ({})) }
}
let fails = 0
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : ' ' + extra)); if (!ok) fails++ }

let tokenN = 0
function injectToken(msFromNow = 10 * 60 * 1000) {
  const token = `test-token-${Date.now()}-${tokenN++}`
  const value = `${createHash('sha256').update(token).digest('hex')}.${Date.now() + msFromNow}`
  execSync(`npx wrangler d1 execute reimbo --local --command "INSERT INTO auth_kv (key, value) VALUES ('reset_token', '${value}') ON CONFLICT(key) DO UPDATE SET value = excluded.value"`, { stdio: 'ignore' })
  return token
}
const login = async (pw) => { jar = {}; return call('POST', '/login', { password: pw }) }

// ---- change password, 2FA off ----
let r = await login(password); check('login with the starting password', r.status === 200 && r.json.ok)
r = await call('POST', '/password/change', { current: 'wrong-password', next: NEW1 }); check('change: wrong current password rejected', r.status === 401, JSON.stringify(r))
r = await call('POST', '/password/change', { current: password, next: '' }); check('change: empty password rejected', r.status === 400, JSON.stringify(r))
r = await call('POST', '/password/change', { current: password, next: 'a' }); check('change: a 1-character password is allowed', r.status === 200, JSON.stringify(r))
r = await login('a'); r = await call('POST', '/password/change', { current: 'a', next: NEW1 }); check('change: back to a normal password', r.status === 200, JSON.stringify(r))
r = await call('GET', '/cars'); check('change: old session is signed out', r.status === 401, JSON.stringify(r))
r = await login(password); check('change: old password no longer works', r.status === 401, JSON.stringify(r))
r = await login(NEW1); check('change: new password works', r.status === 200 && r.json.ok, JSON.stringify(r))
r = await call('GET', '/cars'); check('change: new session works', r.status === 200)

// ---- forgot password ----
jar = {}
r = await call('POST', '/password/forgot'); check('forgot: reports email not set up when no Resend key', r.status === 503 && /not set up/i.test(r.json.error ?? ''), JSON.stringify(r))

// ---- reset, 2FA off ----
let t = injectToken()
r = await call('POST', '/password/reset', { token: 'not-the-token', password: NEW2 }); check('reset: wrong token rejected', r.status === 401, JSON.stringify(r))
r = await call('POST', '/password/reset', { token: t, password: '' }); check('reset: empty password rejected, token kept', r.status === 400, JSON.stringify(r))
r = await call('POST', '/password/reset', { token: t, password: NEW2 }); check('reset: works', r.status === 200 && r.json.ok, JSON.stringify(r))
r = await call('POST', '/password/reset', { token: t, password: NEW3 }); check('reset: token is single-use', r.status === 401, JSON.stringify(r))
r = await login(NEW1); check('reset: previous password no longer works', r.status === 401, JSON.stringify(r))
r = await login(NEW2); check('reset: new password works', r.status === 200 && r.json.ok, JSON.stringify(r))
t = injectToken(-1000)
r = await call('POST', '/password/reset', { token: t, password: NEW3 }); check('reset: expired token rejected', r.status === 401, JSON.stringify(r))
r = await login(NEW2); check('reset: password unchanged after expired token', r.status === 200)

// ---- turn 2FA on ----
r = await call('POST', '/2fa/setup'); const secret = r.json.secret
r = await call('POST', '/2fa/enable', { code: totp(secret, nowStep()) }); const backups = r.json.backup_codes; check('2fa: enabled with 10 backup codes', backups?.length === 10, JSON.stringify(r))

// ---- reset with 2FA on: an email link alone must not be enough ----
jar = {}
t = injectToken()
r = await call('POST', '/password/reset', { token: t, password: NEW3 }); check('reset+2fa: asks for a code instead of resetting', r.status === 400 && r.json.needs_2fa === true, JSON.stringify(r))
r = await login(NEW2); check('reset+2fa: password still unchanged', r.json.needs_2fa === true, JSON.stringify(r))
jar = {}
r = await call('POST', '/password/reset', { token: t, password: NEW3, code: '000000' }); check('reset+2fa: wrong code rejected', r.status === 401, JSON.stringify(r))
r = await call('POST', '/password/reset', { token: t, password: NEW3, code: totp(secret, nowStep() + 1) }); check('reset+2fa: right authenticator code works', r.status === 200 && r.json.ok, JSON.stringify(r))
r = await login(NEW3); check('reset+2fa: new password then asks for 2FA at login', r.json.needs_2fa === true, JSON.stringify(r))

t = injectToken()
jar = {}
r = await call('POST', '/password/reset', { token: t, password: NEW4, code: backups[0] }); check('reset+2fa: a backup code works', r.status === 200 && r.json.ok, JSON.stringify(r))
r = await call('POST', '/password/reset', { token: injectToken(), password: NEW3, code: backups[0] }); check('reset+2fa: used backup code cannot be reused', r.status === 401, JSON.stringify(r))

// ---- change with 2FA on ----
await login(NEW4)
r = await call('POST', '/login/2fa', { code: backups[1] }); check('2fa login with backup code', r.status === 200)
r = await call('POST', '/password/change', { current: NEW4, next: NEW3 }); check('change+2fa: asks for a code', r.status === 400 && r.json.needs_2fa === true, JSON.stringify(r))
r = await call('POST', '/password/change', { current: NEW4, next: NEW3, code: '000000' }); check('change+2fa: wrong code rejected', r.status === 401, JSON.stringify(r))
r = await call('POST', '/password/change', { current: NEW4, next: NEW3, code: backups[2] }); check('change+2fa: works with a backup code', r.status === 200, JSON.stringify(r))
r = await call('GET', '/cars'); check('change+2fa: signed out everywhere', r.status === 401)
r = await login(NEW3); check('change+2fa: trusted device is cleared, 2FA asked again', r.json.needs_2fa === true, JSON.stringify(r))

// ---- tidy up so the local DB goes back to its starting state ----
await call('POST', '/login/2fa', { code: backups[3] })
r = await call('POST', '/2fa/disable', { code: backups[4] }); check('cleanup: 2fa off', r.status === 200)
execSync(`npx wrangler d1 execute reimbo --local --command "DELETE FROM auth_kv WHERE key IN ('pw_hash','auth_epoch','reset_token','reset_req')"`, { stdio: 'ignore' })
r = await login(password); check('cleanup: starting password works again', r.status === 200 && r.json.ok, JSON.stringify(r))

console.log(fails ? `${fails} FAILED` : 'ALL PASSED')
process.exit(fails ? 1 : 0)
