export type Car = { id: number; name: string; plate: string | null; notes: string | null; archived: number }

export type PaymentMethod = { id: number; name: string; claimable: number; archived: number }

export type Expense = {
  id: number
  car_id: number
  payment_method_id: number
  date: string
  amount_cents: number
  category: string
  vendor: string | null
  odometer_km: number | null
  note: string | null
  claim_id: number | null
  claim_status: string | null
  car_name: string
  car_plate: string | null
  payment_method_name: string
  claimable: number
  receipt_count: number
}

export type ReceiptMeta = { id: number; content_type: string | null; size_bytes: number | null }

export type ExpenseDetail = Expense & { receipts: ReceiptMeta[] }

export type ExpenseValues = {
  car_id: number
  payment_method_id: number
  date: string
  amount_cents: number
  category: string
  vendor: string
  odometer_km: string
  note: string
}

export const CATEGORIES: { value: string; label: string }[] = [
  { value: 'service', label: 'Service' },
  { value: 'parts', label: 'Parts' },
  { value: 'addon', label: 'Add-on' },
  { value: 'fuel', label: 'Fuel' },
  { value: 'toll_parking', label: 'Toll / Parking' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'road_tax', label: 'Road tax' },
  { value: 'other', label: 'Other' },
]

export const categoryLabel = (v: string) => CATEGORIES.find((c) => c.value === v)?.label ?? v

export type ClaimStatus = 'draft' | 'submitted' | 'reimbursed'

export type Claim = {
  id: number
  claim_no: string
  title: string | null
  status: ClaimStatus
  car_id: number
  car_name: string
  car_plate: string | null
  created_at: string
  submitted_at: string | null
  reimbursed_at: string | null
  item_count: number
  reimburse_cents: number
  company_cents: number
  date_from: string | null
  date_to: string | null
}

export type ClaimExpense = {
  id: number
  date: string
  amount_cents: number
  category: string
  vendor: string | null
  odometer_km: number | null
  note: string | null
  payment_method_name: string
  claimable: number
  receipts: { id: number; content_type: string | null }[]
}

export type ClaimDetail = Claim & { claimant_name: string | null; expenses: ClaimExpense[] }

export type Reminder = {
  id: number
  car_id: number
  name: string
  interval_km: number | null
  interval_months: number | null
  last_done_date: string | null
  last_done_km: number | null
  next_km: number | null
  next_date: string | null
  km_left: number | null
  days_left: number | null
  status: 'ok' | 'soon' | 'overdue' | 'unknown'
  progress: number
}

export type ServiceData = {
  odometer: { km: number; date: string; source: string } | null
  reminders: Reminder[]
  today: string
}
