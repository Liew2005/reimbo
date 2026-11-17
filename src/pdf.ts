import { api } from './api'
import { categoryLabel, type ClaimDetail, type ClaimExpense } from './types'
import { fmtDate, saveBlob } from './util'

const money = (c: number) => 'RM ' + (c / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 30) || 'receipt'

type Ref = { ref: string; expense: ClaimExpense; id: number; type: string | null }

/** Number every receipt R1..Rn in report order (claimable items first, then company card). */
function buildRefs(c: ClaimDetail): { refs: Ref[]; byExpense: Map<number, string[]> } {
  const refs: Ref[] = []
  const byExpense = new Map<number, string[]>()
  for (const e of c.expenses) {
    for (const r of e.receipts) {
      const ref = 'R' + (refs.length + 1)
      refs.push({ ref, expense: e, id: r.id, type: r.content_type })
      byExpense.set(e.id, [...(byExpense.get(e.id) ?? []), ref])
    }
  }
  return { refs, byExpense }
}

async function imageToJpeg(blob: Blob): Promise<{ data: string; w: number; h: number }> {
  const bmp = await createImageBitmap(blob)
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * scale)
  canvas.height = Math.round(bmp.height * scale)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  return { data: canvas.toDataURL('image/jpeg', 0.85), w: canvas.width, h: canvas.height }
}

export async function exportPdf(c: ClaimDetail) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = 210, M = 14, R = W - M
  const { refs, byExpense } = buildRefs(c)
  const own = c.expenses.filter((e) => e.claimable)
  const co = c.expenses.filter((e) => !e.claimable)
  let y = M

  doc.setFont('helvetica', 'bold').setFontSize(20).text('Expense claim', M, y + 6)
  doc.setFontSize(11).setFont('helvetica', 'normal').text(c.claim_no, R, y + 6, { align: 'right' })
  y += 16
  doc.setDrawColor(180).line(M, y, R, y)
  y += 7
  const meta: [string, string][] = [
    ['Claimant', c.claimant_name || '—'],
    ['Vehicle', c.car_name + (c.car_plate ? ` (${c.car_plate})` : '')],
    ['Period', c.date_from ? `${fmtDate(c.date_from)} to ${fmtDate(c.date_to!)}` : '—'],
    ['Status', c.status],
  ]
  doc.setFontSize(10)
  for (const [k, v] of meta) {
    doc.setTextColor(110).text(k, M, y)
    doc.setTextColor(20).text(v, M + 28, y)
    y += 6
  }
  y += 4

  const col = { n: M, date: M + 8, desc: M + 34, paid: M + 112, ref: M + 144, amt: R }
  const header = () => {
    doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(110)
    doc.text('#', col.n, y); doc.text('DATE', col.date, y); doc.text('DESCRIPTION', col.desc, y)
    doc.text('PAID WITH', col.paid, y); doc.text('RECEIPT', col.ref, y); doc.text('AMOUNT', col.amt, y, { align: 'right' })
    y += 2; doc.setDrawColor(200).line(M, y, R, y); y += 5
  }
  const section = (title: string, list: ClaimExpense[], note: string) => {
    if (y > 250) { doc.addPage(); y = M }
    doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(20).text(title, M, y)
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(110).text(note, R, y, { align: 'right' })
    y += 6
    header()
    let n = 0
    for (const e of list) {
      if (y > 275) { doc.addPage(); y = M; header() }
      n++
      doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(20)
      doc.text(String(n), col.n, y)
      doc.text(fmtDate(e.date), col.date, y)
      doc.text(doc.splitTextToSize(`${e.vendor || categoryLabel(e.category)}`, 76)[0], col.desc, y)
      doc.setTextColor(110).setFontSize(8).text(categoryLabel(e.category), col.desc, y + 3.6)
      doc.setTextColor(20).setFontSize(9).text(doc.splitTextToSize(e.payment_method_name, 30)[0], col.paid, y)
      const rf = byExpense.get(e.id)
      if (rf) doc.text(rf.join(', '), col.ref, y)
      else doc.setTextColor(154, 74, 7).text('none', col.ref, y)
      doc.setTextColor(20).text(money(e.amount_cents), col.amt, y, { align: 'right' })
      y += 9
    }
    const sub = list.reduce((s, e) => s + e.amount_cents, 0)
    doc.setDrawColor(200).line(M, y - 3, R, y - 3)
    doc.setFont('helvetica', 'bold').setFontSize(10).text('Subtotal', col.paid, y + 2)
    doc.text(money(sub), col.amt, y + 2, { align: 'right' })
    y += 12
    return sub
  }

  const ownTotal = own.length ? section('To be reimbursed', own, 'Paid by claimant') : 0
  const coTotal = co.length ? section('Paid by company card', co, 'Not claimable, listed for the record') : 0

  if (y > 255) { doc.addPage(); y = M }
  doc.setDrawColor(20).line(M, y, R, y); y += 8
  doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(20)
  doc.text('Total to reimburse', M, y); doc.text(money(ownTotal), R, y, { align: 'right' })
  if (coTotal) {
    y += 7
    doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(110)
    doc.text('Company card (not claimed)', M, y); doc.text(money(coTotal), R, y, { align: 'right' })
  }
  const missing = c.expenses.filter((e) => !byExpense.has(e.id)).length
  if (missing) {
    y += 9
    doc.setFontSize(9).setTextColor(154, 74, 7).text(`${missing} item${missing > 1 ? 's' : ''} without a receipt.`, M, y)
  }

  // Receipt appendix
  for (const r of refs) {
    doc.addPage()
    doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(20).text(r.ref, M, M + 4)
    doc.setFont('helvetica', 'normal').setFontSize(10)
    doc.text(`${fmtDate(r.expense.date)}  ·  ${r.expense.vendor || categoryLabel(r.expense.category)}  ·  ${money(r.expense.amount_cents)}  ·  ${r.expense.payment_method_name}`, M, M + 11)
    if (!r.type?.startsWith('image/')) {
      doc.setTextColor(110).text('This receipt is a PDF file and cannot be embedded here. It is included in the ZIP export.', M, M + 24)
      continue
    }
    try {
      const img = await imageToJpeg(await api.blob(`/receipts/${r.id}`))
      const maxW = W - 2 * M, maxH = 297 - 2 * M - 20
      const k = Math.min(maxW / img.w, maxH / img.h)
      doc.addImage(img.data, 'JPEG', M, M + 17, img.w * k, img.h * k)
    } catch {
      doc.setTextColor(180, 35, 24).text('Could not load this receipt image.', M, M + 24)
    }
  }
  doc.save(`${c.claim_no}.pdf`)
}

const csvCell = (v: string | number | null) => {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function claimCsv(c: ClaimDetail): string {
  const { byExpense } = buildRefs(c)
  const head = ['Date', 'Vendor', 'Category', 'Paid with', 'Claimable', 'Amount (RM)', 'Odometer km', 'Receipts', 'Note']
  const rows = c.expenses.map((e) => [
    e.date, e.vendor, categoryLabel(e.category), e.payment_method_name, e.claimable ? 'yes' : 'no (company card)',
    (e.amount_cents / 100).toFixed(2), e.odometer_km, (byExpense.get(e.id) ?? []).join(' '), e.note,
  ])
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

export function exportCsv(c: ClaimDetail) {
  saveBlob(new Blob(['﻿' + claimCsv(c)], { type: 'text/csv;charset=utf-8' }), `${c.claim_no}.csv`)
}

export async function exportZip(c: ClaimDetail) {
  const { zipSync } = await import('fflate')
  const files: Record<string, Uint8Array> = {}
  const { refs } = buildRefs(c)
  for (const r of refs) {
    const blob = await api.blob(`/receipts/${r.id}`)
    const ext = r.type === 'application/pdf' ? 'pdf' : r.type === 'image/png' ? 'png' : 'jpg'
    files[`receipts/${r.ref}_${r.expense.date}_${slug(r.expense.vendor || categoryLabel(r.expense.category))}.${ext}`] = new Uint8Array(await blob.arrayBuffer())
  }
  files[`${c.claim_no}.csv`] = new TextEncoder().encode('﻿' + claimCsv(c))
  saveBlob(new Blob([zipSync(files, { level: 0 }) as BlobPart], { type: 'application/zip' }), `${c.claim_no}.zip`)
}
