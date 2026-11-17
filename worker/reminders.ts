import { todayMY } from './env'
import { dueReminders } from './service'
import { kvGet, kvSet } from './twofa'

type Env = { DB: D1Database; RESEND_API_KEY?: string; REMINDER_EMAIL?: string }

const REPEAT_DAYS = 7 // while something stays due, nag at most once a week
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const km = (n: number) => n.toLocaleString('en-MY')

function line(r: Awaited<ReturnType<typeof dueReminders>>[number]): string {
  const bits: string[] = []
  if (r.status === 'overdue') {
    if (r.km_left !== null && r.km_left < 0) bits.push(`${km(-r.km_left)} km over`)
    if (r.days_left !== null && r.days_left < 0) bits.push(`${-r.days_left} days over`)
  } else {
    if (r.km_left !== null && r.km_left <= 1000) bits.push(`${km(r.km_left)} km left`)
    if (r.days_left !== null && r.days_left <= 30) bits.push(`${r.days_left} days left`)
  }
  return `${r.name} (${r.car_name}): ${bits.join(', ')}`
}

/** Daily job: email what is overdue or due soon. Silent when nothing is due or it was already sent this week. */
export async function runReminders(env: Env): Promise<{ sent: number; skipped: string }> {
  if (!env.RESEND_API_KEY || !env.REMINDER_EMAIL) return { sent: 0, skipped: 'email not configured' }
  const today = todayMY()
  const due = await dueReminders(env.DB)
  const fresh: typeof due = []
  for (const r of due) {
    const last = await kvGet(env.DB, `reminder_sent_${r.id}`)
    // stored as 'o<date>' (sent while overdue) or 's<date>' (sent while due soon)
    const age = last ? (Date.parse(today) - Date.parse(last.slice(1))) / 86400000 : Infinity
    if (age >= REPEAT_DAYS || (r.status === 'overdue' && !last?.startsWith('o'))) fresh.push(r)
  }
  if (!fresh.length) return { sent: 0, skipped: due.length ? 'already reminded this week' : 'nothing due' }

  const overdue = fresh.filter((r) => r.status === 'overdue')
  const soon = fresh.filter((r) => r.status === 'soon')
  const subject = overdue.length ? `Reimbo: ${overdue.length} overdue, ${soon.length} due soon` : `Reimbo: ${soon.length} due soon`
  const block = (title: string, list: typeof fresh) => (list.length ? `${title}\n${list.map((r) => '  - ' + line(r)).join('\n')}\n\n` : '')
  const text = block('OVERDUE', overdue) + block('DUE SOON', soon) + 'Open Reimbo > Service to mark them done.\n'
  const html = `<div style="font-family:system-ui,sans-serif;color:#1c1f1d;max-width:480px">
<h2 style="margin:0 0 12px;color:#14532d">${esc(subject)}</h2>
${overdue.length ? `<p style="margin:12px 0 4px;color:#b42318;font-weight:600">Overdue</p><ul>${overdue.map((r) => `<li>${esc(line(r))}</li>`).join('')}</ul>` : ''}
${soon.length ? `<p style="margin:12px 0 4px;color:#9a4a07;font-weight:600">Due soon</p><ul>${soon.map((r) => `<li>${esc(line(r))}</li>`).join('')}</ul>` : ''}
<p style="color:#5b615d">Open Reimbo, then Service, to mark them done.</p></div>`

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'Reimbo <onboarding@resend.dev>', to: [env.REMINDER_EMAIL], subject, text, html }),
  })
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`)
  for (const r of fresh) await kvSet(env.DB, `reminder_sent_${r.id}`, (r.status === 'overdue' ? 'o' : 's') + today)
  return { sent: fresh.length, skipped: '' }
}
