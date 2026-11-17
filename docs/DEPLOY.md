# Deploying Reimbo

Needs a free Cloudflare account. R2 must be enabled once in the dashboard (it asks for a payment method but the free tier covers this app).

## First deploy
1. `npm install`
2. `npx wrangler login`
3. `npx wrangler d1 create reimbo`, then paste the returned `database_id` into `wrangler.jsonc`.
4. `npx wrangler r2 bucket create reimbo-receipts`
5. `npm run db:remote` to apply the migrations.
6. Set the secrets (each prompts for the value):
   - `npx wrangler secret put APP_PASSWORD` the login password, use a long one
   - `npx wrangler secret put SESSION_SECRET` a long random string
   - `npx wrangler secret put RESEND_API_KEY` optional, for reminder emails
   - `npx wrangler secret put REMINDER_EMAIL` optional, where reminders are sent
7. `npm run deploy`
8. Open the URL on your phone and choose "Add to Home screen".

On Windows PowerShell, to avoid a stray newline in a secret, pipe it from a file: `cmd /c "npx wrangler secret put APP_PASSWORD < pw.txt"`.

## Updating
```
npm run db:remote   # only when a new migration was added
npm run deploy
```

## Turn on two-factor
Setup tab, Two-factor. Scan the QR code with an authenticator app, enter a code to confirm, and save the backup codes somewhere safe.

## Reminder email
The sender is Resend's shared `onboarding@resend.dev`, which can only deliver to the email address the Resend account was created with. To send to another address, verify a domain in Resend and change the `from` address in `worker/reminders.ts`.

## Restore from a backup
1. Download a snapshot from R2 (`backups/YYYY-MM-DD.json`) or use the ZIP from Setup.
2. `node scripts/restore.mjs backup.json > restore.sql`
3. `npx wrangler d1 execute reimbo --remote --file restore.sql`

Receipt files go back into the bucket with `npx wrangler r2 object put reimbo-receipts/<r2_key> --file <file>`, where `r2_key` is listed in `data.json`.

## Local testing of scheduled jobs
```
npx wrangler dev --test-scheduled --port 8787
curl "http://127.0.0.1:8787/cdn-cgi/handler/scheduled?cron=0+19+*+*+SUN"
```
