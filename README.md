# Chowa Clinic — Backend API

Express 5 + TypeScript + Prisma 6 + PostgreSQL. Front desk system for
Chowa Physio & Dental Care (Physiotherapy, Dental, Diet).

## Setup

```bash
npm install
cp .env.example .env        # then set DATABASE_URL, JWT_ACCESS_SECRET, SEED_ADMIN_PASSWORD
npm run db:migrate          # creates the database and tables
npm run db:seed             # departments, admin, sample doctors, services, plans
npm run dev                 # http://localhost:4000/api
```

| Script | What it does |
|---|---|
| `npm run dev` | Start with auto-reload |
| `npm run build` / `npm start` | Compile to `dist/` and run (production) |
| `npm run typecheck` | Type errors only (app and tests) |
| `npm test` | Unit + API tests against a separate test database (see Testing) |
| `npm run postman:build` | Regenerate the Postman collection in `postman/` |
| `npm run db:migrate` | Create/apply a migration after editing `schema.prisma` |
| `npm run db:deploy` | Apply migrations on the server (no prompts) |
| `npm run db:seed` | Seed base data (safe to re-run) |
| `npm run create-admin` | Add an admin login, or make an existing account an active admin with a new password (see below) |
| `npm run db:studio` | Browse the database |

## Architecture: feature modules

```
src/
  server.ts            starts HTTP server, graceful shutdown
  app.ts               middleware + mounts every module under /api
  config/env.ts        validated environment variables
  shared/              code with no business rules, used by every module
    db/prisma.ts         Prisma client + `Db` type (client or transaction)
    errors/AppError.ts   badRequest / notFound / conflict / ...
    middleware/          authenticate, requireRole, request id, uploads, error handler
    lib/                 dates (Asia/Dhaka), money (poisha), numbering, validation, pagination, images
    storage/             local disk or Cloudflare R2, signed file links
    pdf/                 PDFKit helpers, fonts, paper sizes
    module.ts            the AppModule contract
  modules/
    index.ts             the list of mounted modules
    <feature>/
      index.ts             module definition + PUBLIC API for other modules
      <feature>.routes.ts  paths and role checks
      <feature>.controller.ts  parse request (Zod) -> call service -> send response
      <feature>.service.ts     business rules and database access
      <feature>.schema.ts      Zod schemas and inferred types
```

**Module rules**

1. A module imports from `shared/`, `config/`, and other modules' **`index.ts` only**.
   Never import another module's `*.service.ts` or `*.schema.ts` directly.
2. A module **writes** only its own tables. Writes to another module's data go
   through that module's public API (e.g. `staff` links a login to a doctor
   via `setPractitionerUser` from `practitioners`).
3. Reading related rows through Prisma relations for list/profile views is allowed.
4. Public functions that may run inside a bigger transaction take `db: Db` as
   their first argument, so callers can pass a transaction client.
5. To add a feature: create `src/modules/<name>/`, export an `AppModule` from its
   `index.ts`, add it to `src/modules/index.ts`. A module can also add
   `middleware` that runs in front of every route (the audit trail does this) and
   background `jobs`.

| Module | Routes | Phase |
|---|---|---|
| health | `/api/health` | B1 |
| auth | `/api/auth/*` | B1 |
| staff | `/api/staff` | B2 |
| clinic-settings | `/api/clinic-settings` | B2 |
| departments | `/api/departments` | B2 |
| practitioners | `/api/practitioners` (+ schedules) | B2 |
| services | `/api/services` | B2 |
| memberships | `/api/membership-plans` (B2), `/api/memberships` (B4) | B2/B4 |
| patients | `/api/patients` (+ lookup, history, notes) | B2 |
| search | `/api/search` | B2 |
| appointments | `/api/appointments` (owns the Appointment table + queue state machine) | B3 |
| queue | `/api/queue` (live board, Next / Skip / Requeue) | B3 |
| visits | `/api/visits` (register + book in one go) | B3 |
| invoices | `/api/invoices` (billing, payments, void, PDF) | B4 |
| prescriptions | `/api/prescriptions` (photo upload, PDF) | B4 |
| files | `/api/files/:token` (signed links to locally stored files) | B4 |
| dashboard | `/api/dashboard` (today at a glance) | B5 |
| reports | `/api/reports` (date-range figures for Admin) | B5 |
| audit | `/api/audit-log` + records every successful write | B5 |

## Conventions

- **Money**: every amount in requests, responses and the database is an
  integer number of **poisha** (৳1 = 100). The frontend formats taka.
- **Dates**: timestamps are UTC ISO strings. Calendar days (`visitDate`,
  `dateOfBirth`, membership dates) are `YYYY-MM-DD` in Asia/Dhaka time —
  always computed with `shared/lib/dates.ts`, never `new Date()` alone.
- **Phones**: accepted as `01XXXXXXXXX`, `+8801…` or `8801…`; stored as `01XXXXXXXXX`.
- **Numbers** (patient code, invoice no, Rx no, card no, daily queue serial)
  come from the `Counter` table via `shared/lib/numbering.ts` — atomic, so two
  desks saving at once never get the same number.
- **Errors** always look like:
  `{ "error": { "code": "VALIDATION_ERROR", "message": "…", "details": [...] } }`.
  500 and 503 errors also carry `requestId`, the same value as the `X-Request-Id`
  response header and the server log line, so a reported error can be traced.
- **Soft delete**: patients get `deletedAt`; nothing with history is ever erased.

## Auth

- `POST /api/auth/login` `{ username, password }` → `{ user, accessToken }` and
  sets an httpOnly `chowa_rt` refresh cookie (path `/api/auth`).
- Send `Authorization: Bearer <accessToken>` on every other request.
  Access tokens last 15 minutes.
- `POST /api/auth/refresh` (cookie only) → new `{ user, accessToken }`; the
  refresh token rotates on every call. Reusing an old one signs that user out
  everywhere.
- `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/change-password`.
- Deactivating a staff member, changing their role or resetting their password
  ends all their sessions.
- Login is rate-limited to 10 failed attempts per 15 minutes per IP.

## Patients

- `GET /api/patients?q=&departmentId=&membership=active|none&page=&pageSize=`. `q` matches name, phone or patient ID. `departmentId` keeps patients with at least one non-cancelled visit in that department.
- Practitioners see no billing on patients: `GET /api/patients/:id` returns `totalDue: null`, and `GET /api/patients/:id/history` leaves out invoices.

## Visits & queue (B3)

**New visit** — `POST /api/visits`
```json
{
  "newPatient": { "name": "Ayesha Khatun", "phone": "01711000000", "gender": "FEMALE", "ageYears": 30 },
  "departmentId": "…", "practitionerId": "…",
  "services": [{ "serviceId": "…" }, { "serviceId": "…", "quantity": 2 }]
}
```
Send `"patientId"` instead of `newPatient` for an existing patient (find them
first with `GET /api/patients/lookup?phone=`). Returns the patient ID, the
serial number, services with prices, `queue.waitingAhead`, and `warnings`
(e.g. doctor not scheduled today — the visit is still saved).

**Queue rules**

- Serial numbers restart at 1 per doctor per clinic day and never change once
  printed. Queue order uses a separate `queuePosition`.
- Every queue change locks that doctor's queue first, so simultaneous clicks are
  applied one at a time. A double-clicked Save returns 409 instead of a second visit.
- `POST /api/queue/:practitionerId/next` with
  `{ "expectedCurrentAppointmentId": "<id in room>" | null }`: completes the patient
  in the room and calls the lowest waiting position. If the queue changed since the
  screen refreshed, it returns **409** instead of skipping anyone. The frontend must
  always send this field. `"callNext": false` finishes the current patient and leaves
  the doctor free (break).
- `POST /api/queue/:appointmentId/skip` `{ "action": "NO_SHOW" | "MOVE_TO_END" }`:
  works on waiting or in-room patients.
- `POST /api/queue/:appointmentId/requeue`: a no-show came back; joins the end.
- `GET /api/queue?departmentId=&date=`: board for every doctor (current, waiting
  in order, no-shows, counts, `nextSerial` for the New Visit preview). Poll it.
- Job `close-past-queues` (every 30 min + on start): visits from earlier days still
  IN_ROOM become COMPLETED, still WAITING become NO_SHOW.

**Appointments**

- `GET /api/appointments?date=|from=&to=&departmentId=&practitionerId=&patientId=&status=A,B&unbilled=true`
  (`unbilled=true` = completed visits without an invoice, for the dashboard).
- `GET /api/appointments/:id`, `POST /api/appointments/:id/cancel { reason }`
  (only BOOKED / WAITING).
- `PUT /api/appointments/:id/services { services: [...] }`: change services until the
  visit is invoiced. Existing lines keep their booked price.
- `POST /api/appointments/:id/treatments { description, toothOrArea?, serviceId? }`.

## Billing, memberships, prescriptions (B4)

**Invoices** — Admin and Front Desk only.

- `POST /api/invoices/preview` returns the same totals as create without saving;
  use it for the Billing screen.
- `POST /api/invoices`
  ```json
  { "appointmentId": "…", "manualDiscount": 0, "applyMemberDiscount": true,
    "payment": { "amount": 104000, "method": "BKASH", "reference": "TrxID" } }
  ```
  Leave out `items` to bill the services booked for the visit. Send `items`
  (`{ serviceId, quantity }` or a custom `{ description, unitPrice, quantity }`)
  to override, or with `patientId` instead of `appointmentId` to bill without a visit.
  `payment` is optional: full, part, or nothing (invoice stays DUE).
- A visit can have only one live (non-void) invoice. Once a visit is invoiced, its
  services can no longer be changed.
- **Member discount**: for each line, the best active plan covering that line's
  department on the billing day (all-department plans cover everything). Plans do
  not stack. The note (`Gold 20% · CPD-M-00017`) is saved on the invoice and printed.
  A manual discount comes off after that and cannot exceed what is left.
- Status is calculated: `DUE` → `PARTIAL` → `PAID`. A ৳0 invoice is `PAID`.
- `POST /api/invoices/:id/payments` `{ amount, method, reference? }`: more than the due
  amount returns 400 with `details.due`.
- `PATCH /api/invoices/:id` `{ items?, manualDiscount?, applyMemberDiscount? }`: only
  while nothing has been paid; not for membership invoices.
- `POST /api/invoices/:id/void` `{ reason, refundMethod }` (Admin): records a refund
  of everything paid as a negative payment and marks it VOID. Invoices are never deleted.
- `GET /api/invoices?status=DUE,PARTIAL&from=&to=&departmentId=&patientId=&kind=visit|membership|other&q=`
  returns a page of invoices plus `totals` for the whole filter (VOID excluded).
- `GET /api/invoices/:id/pdf?paper=a5|a4&download=true`: A5 by default.

**Memberships**

- `POST /api/memberships` `{ patientId, planId, startDate?, payment? }`: issues a card
  number (`CPD-M-00001`) and its invoice in one step. A patient cannot hold two
  overlapping memberships of the same plan.
- `POST /api/memberships/:id/renew` `{ payment? }`: the new period starts the day after
  the old one ends (or today if it already expired).
- `POST /api/memberships/:id/cancel` `{ reason }` (Admin). The invoice is not changed;
  void it separately if money is returned.
- `GET /api/memberships?tab=active|expiring|upcoming|expired|cancelled|all&planId=&q=`;
  `expiring` = ends within 30 days.
- `GET /api/memberships/lookup?patientId=`: current discounts for the Billing screen.
- `GET /api/memberships/:id/card`: credit-card size PDF with a QR code of the card number.
- Job `expire-memberships` (hourly + on start) marks ended memberships EXPIRED.

**Prescriptions** — paper prescriptions are photographed and stored.

- `POST /api/prescriptions` as `multipart/form-data`: `images` (1–10 image files, up to
  15 MB each) + `appointmentId`, `diagnosis?`, `advice?`, `nextVisitDate?`. One
  prescription per visit (`RX-2026-000001`).
- Photos are rotated upright, shrunk to fit 2000 px and saved as JPEG.
  A file that is not a readable image returns 400. Some HEIC photos cannot be read;
  ask the desk to set the phone camera to "Most Compatible" (JPEG).
- `POST /:id/images` adds pages, `DELETE /:id/images/:imageId` removes one (Admin, Front Desk),
  `PATCH /:id` edits the text fields.
- `GET /:id` returns each page with a short-lived `url`. `GET /:id/pdf` merges the pages
  into one A4 PDF for printing or sending. `GET /?patientId=&appointmentId=` lists them.
- Practitioners may add prescriptions only for their own visits.

**Serial slip** — `GET /api/appointments/:id/slip`: 80 mm thermal receipt PDF.

**PDFs** use the Hind Siliguri font (`assets/fonts`, SIL Open Font License), so Bangla
names print correctly. PDFs open inline in the browser; on invoice and prescription
PDFs, add `?download=true` to save the file instead.

**File storage** (`STORAGE_DRIVER`)

- `local` (default): files go to `UPLOAD_DIR`. The API returns signed links
  `PUBLIC_API_URL/api/files/<token>` that expire after `FILE_URL_TTL_SECONDS`. Back up
  this folder together with the database.
- `r2`: Cloudflare R2 with presigned URLs. Set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. Not yet tested against a real bucket.

## Dashboard, reports, audit log (B5)

**Dashboard** — `GET /api/dashboard?departmentId=` (every role)

- `queue`: the same board as `GET /api/queue` (Now serving strip).
- `stats`: visits today, waiting now, in room, completed, no-shows, cancelled.
- `todayVisits`: every visit today in arrival order, each with its live invoice
  (or `null` if not billed yet).
- `money`: collected today (net of refunds) and by payment method, billed today,
  total due on all open invoices.
- `pendingPayments` (10 newest open invoices + count), `unbilledVisits` (completed
  today without an invoice), `expiringMemberships` (ending within 30 days).
- Practitioners get `money`, `pendingPayments`, `unbilledVisits` and
  `expiringMemberships` as `null`.
- With `departmentId`, money covers that department's visit invoices only.
- Refresh the page every 30–60 s; poll `GET /api/queue` every few seconds for the
  live strip (it is much lighter).

**Reports** — `GET /api/reports?from=YYYY-MM-DD&to=YYYY-MM-DD&groupBy=day|month` (Admin)

- Default range: the 1st of this month to today. Up to 3 years; `groupBy` defaults
  to `day` up to 62 days, `month` beyond.
- `summary`: invoices, subtotal, member/manual discounts, billed, due, received,
  refunded, collected, voided, visits (completed / no-show / cancelled), new patients.
- `series`: one bucket per day or month with billed, collected, visits, completed —
  every bucket present, ready for a chart.
- `revenueByDepartment` (+ Memberships and Other rows), `appointmentsByDepartment`,
  `practitioners`, `topServices` (top 10 by amount before discounts),
  `paymentMethods`, `memberships` (sold, renewals, by plan), `dues` (everything
  still owed today, by age 0-7 / 8-30 / 31-90 / 90+ days, and the 10 largest).
- Definitions: **billed** = totals of non-void invoices created in the range;
  **collected** = money received in the range minus refunds, whatever day the
  invoice was made. A visit invoice counts for the visit's department and doctor.
  The department rows, chart buckets and payment methods add up to the summary.

**Audit log** — `GET /api/audit-log?entityType=&entityId=&actorId=&action=&from=&to=` (Admin)

- Every successful create / update / delete / void / cancel / payment request is
  recorded: who, when, from which IP, the route (`POST /invoices/:id/void`), the
  record id and the request body. Passwords and tokens are replaced by `[removed]`.
- Not recorded: reads, invoice previews, sign-in / refresh / sign-out (sessions are
  kept in the Session table), and failed requests.
- Written right after the response; if writing the log fails the request still
  succeeds and the failure is logged on the server.

## Security and operations

- **Production start-up checks**: with `NODE_ENV=production` the API refuses to start
  if `JWT_ACCESS_SECRET` or `DATABASE_URL` still contain `CHANGE_ME`, or
  `COOKIE_SECURE` is not `true`. It warns if `CORS_ORIGIN` allows localhost.
- **Rate limits**: 10 failed sign-ins per 15 minutes per IP, and
  `RATE_LIMIT_PER_MINUTE` (default 1200) requests per minute per IP across the API.
  All clinic computers usually share one public IP, so keep the second one generous.
- **Behind Nginx**: set `TRUST_PROXY=1` (the default in production) so rate limits
  and the audit log see the real client IP.
- **No caching**: every `/api` response is `Cache-Control: no-store` except signed
  file links.
- **Request ids**: every response has `X-Request-Id`; an incoming one (from Nginx or
  the frontend) is reused if it looks sane.
- **Errors**: a busy record (lock timeout) returns 503 `BUSY`, an unreachable database
  503 `DB_UNAVAILABLE`, an oversized body 413. Unhandled promise rejections are logged;
  an uncaught exception logs and exits so PM2 restarts a clean process.
- Access tokens stay valid until they expire (15 min) even after a login is
  deactivated; refresh is refused at once.
- `npm audit` reports a high-severity advisory in `deepmerge-ts`, used only by the
  Prisma CLI to load its config (`prisma` → `@prisma/config`). The API never runs it
  on request data; the fix needs Prisma 7, a breaking upgrade.

## Testing

```bash
npm test
```

- Unit tests (`tests/unit`) cover totals, discounts, invoice status, money, clinic
  dates and phone numbers.
- API tests (`tests/api`) run the real app through HTTP: auth and sessions, roles,
  visits and the queue (including simultaneous clicks and bookings), billing,
  payments and voids, memberships, prescription uploads, dashboard, reports and the
  audit log.
- They use their own database: `TEST_DATABASE_URL`, or `DATABASE_URL` with `_test`
  added to the name (`chowa_clinic_test`). It is created and migrated
  automatically, then **emptied and re-seeded on every run**. The tests refuse to run
  unless the database name ends in `_test`, so the real database is never touched.
- Uploaded test files go to the system temp folder.

## Postman

`postman/chowa-clinic.postman_collection.json` + `postman/chowa-local.postman_environment.json`

1. Import both into Postman and select the **Chowa local** environment.
2. Set `password` (the admin password) in the environment.
3. Run the collection in order (Runner): 57 requests in 10 folders walk through a
   whole day — sign in, create a doctor, new visit, queue, bill and collect, upload a
   prescription, sell and renew a membership, patient history, dashboard, reports,
   admin actions. Every request has tests.
4. For the prescription upload, pick `postman/sample-prescription.jpg` (or any image)
   in the `images` field if Postman cannot find it.

Run it against a development or test database: it creates a doctor, a patient,
invoices and a staff login. From the command line:

```bash
cd postman
npx newman run chowa-clinic.postman_collection.json -e chowa-local.postman_environment.json \
  --env-var password=YOUR_ADMIN_PASSWORD --working-dir .
```

Edit `postman/build-collection.mjs` and run `npm run postman:build` to change it.

## Deployment (VPS with PM2 + Nginx)

```bash
npm ci
npm run build
npm run db:deploy            # apply migrations
npm run db:seed              # first time only
pm2 start dist/server.js --name chowa-api
pm2 save
```

**Admin accounts.** The seed creates one admin (`SEED_ADMIN_USERNAME` /
`SEED_ADMIN_PASSWORD`); sign in and change that password straight away. For
further admins, use Settings > Staff, or on the server:

```bash
npm run create-admin                                        # asks for username, name, password
npm run create-admin -- --username rahim --name "Rahim Uddin"
```

The password is typed hidden and must be at least 8 characters. If the username
already exists (for example, a locked-out or deactivated admin), the script asks
before making it an active admin with the new password, and signs it out
everywhere else.

- `.env` on the server: `NODE_ENV=production`, a new `JWT_ACCESS_SECRET`,
  `COOKIE_SECURE=true`, `CORS_ORIGIN=https://<frontend>`, `PUBLIC_API_URL=https://<api>`.
- Nginx: proxy `/api` to `http://127.0.0.1:4000`, `client_max_body_size 160m`
  (10 photos × 15 MB), HTTPS via Let's Encrypt.
- Run one API process (or set `RUN_JOBS=false` on all but one) so the hourly
  membership expiry and the queue close-out jobs run once.
- **Backups, daily**: `pg_dump -Fc chowa_clinic > chowa-$(date +%F).dump` and a copy
  of `UPLOAD_DIR` (prescription photos) to another machine or cloud storage. Test a
  restore (`pg_restore -d <empty db> file.dump`) before going live.

## Roles

| Endpoint | Admin | Front Desk | Practitioner |
|---|---|---|---|
| Staff accounts | ✓ | – | – |
| Clinic settings, departments, practitioners, services, plans: read | ✓ | ✓ | ✓ |
| … create / edit | ✓ | – | – |
| Patients: list, view, history, lookup, search | ✓ | ✓ | ✓ |
| Patients: create, edit | ✓ | ✓ | – |
| Patients: delete, restore, list deleted | ✓ | – | – |
| Patient notes: read, add | ✓ | ✓ | ✓ |
| New visit, Next / Skip / Requeue, cancel, change services | ✓ | ✓ | – |
| Queue board, appointments list/detail | ✓ | ✓ | ✓ |
| Add treatment record | ✓ | ✓ | ✓ |
| Invoices: list, view, create, edit, pay, PDF | ✓ | ✓ | – |
| Void invoice | ✓ | – | – |
| Memberships: list, issue, renew, card | ✓ | ✓ | – |
| Memberships: view one, lookup | ✓ | ✓ | ✓ |
| Cancel membership | ✓ | – | – |
| Prescriptions: view, PDF | ✓ | ✓ | ✓ |
| Prescriptions: create, add pages, edit | ✓ | ✓ | own visits |
| Prescriptions: remove a page | ✓ | ✓ | – |
| Serial slip | ✓ | ✓ | – |
| Dashboard | ✓ | ✓ | ✓ (no money) |
| Reports, audit log | ✓ | – | – |
