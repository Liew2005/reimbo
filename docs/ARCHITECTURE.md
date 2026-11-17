# Architecture

```
Phone / desktop (PWA)
  React app + service worker + IndexedDB offline queue
        |  /api/*  (JSON, cookie auth)
        v
Cloudflare Worker (Hono)  -- one Worker serves both the static app and the API
   |-- D1 (SQLite)   expenses, claims, cars, reminders, settings, auth state
   |-- R2            receipt images, weekly backups
   '-- cron          weekly backup, daily reminder email (Resend)
```

One Worker does everything. Static files come from the Worker's `assets` binding. `run_worker_first: ["/api/*"]` sends only API paths through code, so the app shell is served straight from the edge.

## Frontend (`src/`)
- Five tabs: Add, Expenses, Claims, Service, Setup. No router library; the tab is component state.
- `api.ts` wraps `fetch`, throws `AuthError` on 401 (which returns the user to login) and lets network failures surface as `TypeError`, which the offline code relies on.
- PDF, CSV and ZIP are built in the browser (`pdf.ts`), so the server never renders documents and costs nothing.
- Receipt photos are resized and recompressed on the phone before upload (`prepareReceipt` in `util.ts`) to stay small in R2.
- Styling is a single CSS file driven by design tokens, with light and dark themes and reduced-motion support.

## Offline queue (`offline.ts`)
- Adding an expense while offline (or when the request fails with a network error) stores it in IndexedDB with its photos.
- `syncQueue` runs on login, on the browser `online` event, and every 30 seconds. It uploads in order and stops quietly when the network drops.
- The server-assigned expense id is saved right after the create call. If the app dies between creating the expense and uploading photos, the retry resumes with the remaining photos rather than creating a duplicate.
- A server rejection (validation error) marks the item with its message and skips it until the user retries from the "Waiting to upload" sheet.

## API (`worker/`)
| File | Responsibility |
| --- | --- |
| `index.ts` | Login, session, cars, payment methods, expenses, receipts, cron entry point |
| `claims.ts` | Claims lifecycle, claim items, settings |
| `service.ts` | Odometer readings and service reminders |
| `twofa.ts` | TOTP setup, enable, disable, second-factor check |
| `backup.ts` | Full data dump, weekly R2 snapshot |
| `reminders.ts` | Daily email for due or overdue reminders |

Money is integer sen to avoid floating point errors. Dates are `YYYY-MM-DD` in Malaysia time.

## Authentication
1. `POST /api/login` checks the shared password (constant-time compare) and the rate limit.
2. With 2FA off, the response sets an HMAC-signed `session` cookie (HttpOnly, Secure, SameSite).
3. With 2FA on, and no valid `trusted` cookie, it sets a short-lived signed `pending` cookie and returns `{needs_2fa: true}`. `POST /api/login/2fa` then accepts a 6-digit code or a one-time backup code.
4. TOTP follows RFC 6238 (SHA-1, 6 digits, 30 s, plus or minus one step) using Web Crypto. The last used time step is stored so a code cannot be replayed.
5. Backup codes are stored only as SHA-256 hashes and are removed once used.
6. Rate limit: 5 failed attempts per IP per 15 minutes, counted across both steps, stored in `login_attempts`.

2FA secrets live in `auth_kv`, a table the API never returns. They are kept out of `settings` because `GET /api/settings` returns every row there.

## Backups
- Cron `0 19 * * SUN` writes `backups/YYYY-MM-DD.json` to R2 and keeps the newest 8.
- Setup has a "Download backup" button that builds a ZIP of `data.json` and every receipt in the browser.
- `scripts/restore.mjs` turns a dump into SQL for `wrangler d1 execute`.

## Reminders
Cron `0 1 * * *` (09:00 Malaysia) looks for reminders that are due soon or overdue and emails a summary through Resend. Each reminder's last-sent state is stored in `auth_kv` so the same item is not mailed twice in a day.

## Decisions worth noting
- **Cloudflare only:** D1 and R2 free tiers are far above single-user needs, and one `wrangler deploy` ships everything.
- **Client-side PDFs:** avoids a rendering service and keeps the Worker small.
- **Shared password plus TOTP, not accounts:** the app has one user. Accounts would add a lot of surface for no benefit.
- **Hand-rolled TOTP:** about 60 lines on Web Crypto, no dependency in the Worker bundle, covered by `scripts/test-2fa.mjs`.
