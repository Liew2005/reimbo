// Local end-to-end check of password + 2FA login. Usage: node scripts/test-2fa.mjs <base-url> <password>
import { createHmac } from 'node:crypto'
const [base, password] = process.argv.slice(2)
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

let r = await call('POST', '/login', { password }); check('password login (2FA off)', r.status === 200 && r.json.ok)
r = await call('GET', '/2fa'); check('status off', r.json.enabled === false)
r = await call('POST', '/2fa/setup'); const secret = r.json.secret; check('setup returns secret', /^[A-Z2-7]{32}$/.test(secret ?? ''), JSON.stringify(r))
r = await call('POST', '/2fa/enable', { code: '000000' }); check('enable rejects wrong code', r.status === 400)
r = await call('POST', '/2fa/enable', { code: totp(secret, nowStep()) }); const backups = r.json.backup_codes; check('enable accepts right code + 10 backups', r.status === 200 && backups?.length === 10, JSON.stringify(r))
r = await call('GET', '/settings'); check('settings does not leak secret', !JSON.stringify(r.json).includes(secret))
await call('POST', '/logout'); jar = {}
r = await call('GET', '/cars'); check('logged out blocked', r.status === 401)
r = await call('POST', '/login', { password }); check('password step asks for 2FA', r.json.needs_2fa === true && !jar.session, JSON.stringify(r))
r = await call('GET', '/cars'); check('pending cookie is not a session', r.status === 401)
r = await call('POST', '/login/2fa', { code: '000000' }); check('wrong code rejected', r.status === 401)
const good = totp(secret, nowStep() + 1)
r = await call('POST', '/login/2fa', { code: good, trust: true }); check('right code logs in', r.status === 200 && !!jar.session && !!jar.trusted, JSON.stringify(r))
r = await call('GET', '/cars'); check('session works', r.status === 200)
await call('POST', '/logout'); const trusted = jar.trusted; jar = { trusted }
r = await call('POST', '/login', { password }); check('trusted device skips 2FA', r.json.ok === true && !!jar.session, JSON.stringify(r))
await call('POST', '/logout'); jar = {}
r = await call('POST', '/login', { password }); r = await call('POST', '/login/2fa', { code: good }); check('replayed code rejected', r.status === 401)
r = await call('POST', '/login/2fa', { code: backups[0] }); check('backup code works', r.status === 200)
await call('POST', '/logout'); jar = {}
await call('POST', '/login', { password }); r = await call('POST', '/login/2fa', { code: backups[0] }); check('backup code is single-use', r.status === 401)
r = await call('POST', '/login/2fa', { code: backups[1] }); check('second backup code works', r.status === 200)
r = await call('GET', '/2fa'); check('backup count drops to 8', r.json.backup_left === 8, JSON.stringify(r))
r = await call('POST', '/2fa/disable', { code: '000000' }); check('disable rejects wrong code', r.status === 400)
r = await call('POST', '/2fa/disable', { code: backups[2] }); check('disable with backup code', r.status === 200)
r = await call('GET', '/2fa'); check('status off again', r.json.enabled === false)
console.log(fails ? `${fails} FAILED` : 'ALL PASSED')
process.exit(fails ? 1 : 0)
