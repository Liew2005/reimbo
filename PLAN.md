# Reimbo: plan

Track car spending (service, parts, add-ons, fuel, tolls), keep every receipt, and produce a claim report for the company. Works on phone and web, free to run, supports multiple cars.

## Decisions
- Company car now, personal car later: multi-car from day one.
- Company-card purchases appear in the report, marked "paid by company card" and excluded from the reimbursable total.
- No company claim template: generic clean format.
- Single user: shared password, signed cookie, optional 2FA.
- Stack, all Cloudflare free tier: React + Vite PWA, Hono on a Worker, D1, R2.
- Money is stored as integer sen. Dates use Malaysia time.
- Receipt reading with Gemini was considered and dropped (manual entry is fast enough).

## Data model
- `cars`: name, plate, notes, archived
- `payment_methods`: name, `claimable` (1 = reimburse me, 0 = paid by company), archived
- `expenses`: car, payment method, date, amount (sen), category, vendor, odometer, note, claim_id
- `receipts`: expense, R2 key, type, size
- `claims`: claim_no, title, status (draft / submitted / reimbursed), dates
- `reminders`, `odometer` readings: service reminders by km or date
- `settings`: claimant name and similar
- `login_attempts`: rate limiting
- `auth_kv`: private 2FA secrets and reminder bookkeeping (kept apart from `settings`, which the API returns whole)

## Phases
1. **MVP (done):** login, cars, payment methods, quick add with receipt photos, expense list with filters, "To claim" view, edit/delete, installable PWA.
2. **Claims (done):** build a claim from unclaimed items, status tracking, locked items, PDF report with numbered receipt appendix, CSV and ZIP export.
3. **Service (done):** odometer log, reminders by km or date, due banner, overdue badge on the tab.
4. **Security (done):** login rate limit (5 per 15 min per IP), TOTP 2FA with backup codes and trusted-device cookie.
4b. **Passwords (done):** change password in Setup, forgot-password by email, both honouring 2FA, sign-out of all devices on change.
5. **Safety net (done):** weekly R2 snapshot (keep 8), client-side ZIP backup, restore script, daily reminder email via Resend.
6. **Polish (done):** redesigned UI (light/dark), PNG app icons, search, summary by category and month, running cost per km, offline queue with auto-upload.
7. **Ideas, not started:**
   - Fuel tracking (litres, price per litre, km/L)
   - Custom domain
   - Automated tests (Vitest for the Worker, Playwright for the offline flow)
   - Multi-user accounts, if it is ever shared with others

## Known gaps
- Offline mode queues new expenses only. Editing or deleting offline is not supported.
- Offline start needs one earlier online visit so cars and payment methods are cached.
- Single shared password: fine for one person, not for a team.
- Tests are manual scripts, not a CI suite.
- The Resend sender is the shared `onboarding@resend.dev` address, which can only mail the account owner. A verified domain is needed to send elsewhere.
