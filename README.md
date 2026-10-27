# TimeLedger

A full-stack time tracker and invoicing app for freelancers, built with the MERN stack (MongoDB, Express, React, Node.js).

## Progress

| Step | What | Status |
| --- | --- | --- |
| 1 | Project setup: Express + Mongoose API, React + Vite + Tailwind app | Done |
| 2 | Authentication: register, login, JWT, protected routes | Done |
| 3 | App layout, Clients and Projects | Done |
| 4 | Start/stop timer, kept on the server | Done |
| 5 | Time entries: add and edit by hand, filters and totals, time zones | Done |
| 6 | Weekly timesheet: hours per project per day | Done |
| 7 | Invoices: bill unbilled time to a client once, printable invoice page, Draft / Sent / Paid | Done |
| 8+ | Demo seed data | Planned |

**Test results:** 140 backend tests and 385 automated browser checks all pass. Everything is in [docs/test-evidence](docs/test-evidence): a one-page report with screenshots ([test-report.html](docs/test-evidence/test-report.html), download it and open it in a browser), every screenshot as a separate image, the raw results and the test code.

## Features

- **Authentication**: register and log in with a hashed password (bcrypt) and a JWT. Logged-in users stay logged in after a reload; logged-out users are redirected to `/login`.
- **App layout**: fixed sidebar on desktop; top bar and bottom tab bar on phones.
- **Clients**: add, edit and delete clients (name, optional company and email). The list shows how many projects each client has. Names are unique per user, ignoring case.
- **Projects**: each project belongs to a client and has an hourly rate (0 to 10000, stored with 2 decimals) and a color. Filter the list by client. Names are unique per client. A project that has time entries can't be deleted.
- **Timer**: start and stop a timer on a project from the dashboard. Only one timer can run per user. It is kept on the server, so it is still correct after a refresh, after closing the browser, and on another device. A small running indicator shows in the sidebar (or top bar on phones) on every page, and the time appears in the browser tab title.
- **Today**: the dashboard lists today's stopped timers with their total. Each one can be edited.
- **Time entries**: add an entry by hand (project, description, date, start and end time, billable or not), edit or delete it. The Time entries page filters by date range (this week, last week, this month, custom), client, project, billable and billed/unbilled, shows total hours, billable hours and the unbilled amount, and groups entries by day. Entries that are on an invoice are locked.
- **Timesheet**: a weekly grid of hours per project per day (Monday to Sunday) with daily and weekly totals, the billable hours and amount, a week navigator (the week is kept in the URL, e.g. `/timesheet?week=2026-03-09`) and today's column highlighted. An entry that crosses midnight is split between the days it touches. Click a cell to see the entries behind it. On phones and tablets the grid becomes one card per day. The dashboard has a "This week" card with a link to it.
- **Invoices**: pick a client and a period (quick picks: last week, this month, last month, or custom dates) and see exactly what will be billed before you create the invoice: one line per project (hours × rate), the entry count and the total. Creating it takes the client's unbilled, billable, finished entries in that period (both days included, counted in your time zone; a running timer is never billed) and marks them as billed. Invoices are numbered `INV-0001`, `INV-0002`, ... per user, due 14 days after they are issued, and keep a copy of the client, the rates and the lines, so editing a client or a project later never changes an invoice. The invoice page is a printable A4 paper (**Print / Save as PDF**: the sidebar, bars and buttons are left out), with the entries it contains listed below it. Mark an invoice as sent, then paid; delete a draft to give its entries back (its number is never reused). The Time entries page shows a "Billed" badge that links to the invoice. See [How invoices avoid double billing](#how-invoices-avoid-double-billing).
- **Time zones**: all times are stored in UTC. Day boundaries and the times you type use your saved time zone, which follows your device (it is updated when you open the app on a device in another zone). Days are counted in that zone, never the server's, and with calendar arithmetic, so a daylight saving day is correctly 23 or 25 hours long.
- **Private data**: every record belongs to one user. Asking for someone else's record returns `404`.

### How the timer works

- The running timer is a time entry with no end time (`endedAt: null`). It lives in MongoDB, never only in the browser.
- A unique index (one entry per user with `endedAt: null`) makes the **database** guarantee one running timer per user, even if two devices press Start at the same moment. The loser gets `409 A timer is already running. Stop it first.`
- The start time always comes from the server's clock. The browser works out the elapsed time as `now - startedAt`, corrected for any difference between the device clock and the server clock (every API response includes `serverTime`), so a device with a wrong clock still shows the right time.
- The browser re-checks the server when the tab becomes visible again and every 30 seconds, so a timer started or stopped on another device shows up by itself.
- Stopping is one atomic update that only matches a still-running timer, so two Stop requests can't both succeed. The duration is calculated by the database as `floor((endedAt - startedAt) / 1000)` seconds.

### How invoices avoid double billing

The rule: **a time entry can never be on two invoices, even if two requests arrive at the same moment** (two tabs, a double click, two devices).

- Creating an invoice first **claims** the entries. It is one `updateMany` whose filter only matches entries that are billable, finished, in the period, for that client and **not billed yet** (`invoiceId: null`), and it sets `invoiceId` to the new invoice's id. MongoDB applies a change to a single entry one at a time, so when two requests race for the same entries, one of them finds them already claimed. It claims nothing and gets `400 No unbilled billable time for this client in this period`.
- The invoice is then built from **exactly the entries that this request claimed** (read back by its own invoice id), never from a list read earlier, so the lines always add up to what was claimed.
- The claim, the next invoice number (a per-user counter) and the invoice itself are saved in **one MongoDB transaction**. If any step fails, the claim is rolled back and the number is not used. A transaction that collides with another one is retried by the driver.
- Entries on an invoice are locked (they can't be edited or deleted). Deleting a **draft** invoice releases its entries again in one transaction; sent and paid invoices can't be deleted.
- The tests cover two identical simultaneous requests, eight at once, overlapping periods at the same moment, two users invoicing at the same time, and a failure while saving the invoice (the claimed entries are released and no number is used up). The browser checks press "Create invoice" in two tabs at the same moment and send six simultaneous API requests: exactly one invoice comes out each time. Taking the "not billed yet" condition out of the claim makes 5 of the invoice tests fail, including all three concurrency tests (see [docs/test-evidence](docs/test-evidence/results/mutation-check-double-billing.txt)).
- **Transactions need a replica set.** MongoDB Atlas is one, so it works as is. A plain local `mongod` is not: invoice routes then answer `503 Invoices need MongoDB transactions...`. To use a local MongoDB, start it as a single-node replica set (`mongod --replSet rs0`, then run `rs.initiate()` once in `mongosh`) and add `?replicaSet=rs0` to `MONGODB_URI`.
- Money: each line is `hours × rate` rounded to cents; the invoice total is the sum of those rounded lines (so the printed lines always add up to the printed total).

## Tech stack

- **Backend:** Node.js (ES modules), Express 5, MongoDB with Mongoose 9, Zod 4 for validation, JSON Web Tokens, bcryptjs, Luxon (time zone maths)
- **Frontend:** React 19, Vite, Tailwind CSS 4, React Router, Axios, lucide-react icons, react-hot-toast
- **Tests:** Jest, Supertest and mongodb-memory-server (backend)

## Setup

**Prerequisites:** Node.js 20.19+ (or 22.12+) and a MongoDB database: a free MongoDB Atlas cluster, or a local MongoDB that runs as a **replica set** (invoices use transactions, which a plain standalone `mongod` does not support; see [How invoices avoid double billing](#how-invoices-avoid-double-billing)).

### Backend

```bash
cd backend
npm install
cp .env.example .env   # then fill in the values (see below)
npm run dev            # http://localhost:5000
```

The server stops with a clear message if `JWT_SECRET` or `MONGODB_URI` is missing or MongoDB can't be reached. Open http://localhost:5000/api/health to check it is running (`{"status":"ok"}`).

### Frontend

```bash
cd frontend
npm install
cp .env.example .env   # optional: the default API URL already points to localhost:5000
npm run dev            # http://localhost:5173
```

Then open http://localhost:5173 and create an account.

### Environment variables

`backend/.env`

| Variable | Required | Description |
| --- | --- | --- |
| `MONGODB_URI` | yes | MongoDB connection string. Include the database name, for example `.../timeledger` |
| `JWT_SECRET` | yes | Long random string used to sign tokens |
| `PORT` | no | API port (default `5000`) |
| `JWT_EXPIRES_IN` | no | Token lifetime (default `7d`) |
| `FRONTEND_URL` | no | Allowed CORS origin (default `http://localhost:5173`) |
| `DNS_SERVERS` | no | Comma-separated DNS servers used to look up `mongodb+srv://` hosts (default `8.8.8.8,1.1.1.1`) |

`frontend/.env`

| Variable | Required | Description |
| --- | --- | --- |
| `VITE_API_URL` | no | API base URL including `/api` (default `http://localhost:5000/api`) |

Never commit a real `.env` file. `.env` is git-ignored, and `.env.example` must only contain placeholders.

### Scripts

| Where | Command | What it does |
| --- | --- | --- |
| `backend/` | `npm run dev` | Start the API with auto-restart (nodemon) |
| `backend/` | `npm start` | Start the API |
| `backend/` | `npm test` | Run the backend tests |
| `backend/` | `npm run seed` | Placeholder for now (demo data comes in a later step) |
| `frontend/` | `npm run dev` | Start the Vite dev server |
| `frontend/` | `npm run build` | Production build into `dist/` |
| `frontend/` | `npm run preview` | Serve the production build locally |

## API

All routes are under `/api`. Routes marked **auth** need the header `Authorization: Bearer <token>`.

| Method and path | Auth | Description |
| --- | --- | --- |
| `GET /health` | no | Returns `{ "status": "ok" }` |
| `POST /auth/register` | no | Body: `name` (2-50 chars), `email`, `password` (min 8). Returns `201 { user, token }`. `409` if the email is taken |
| `POST /auth/login` | no | Body: `email`, `password`. Returns `{ user, token }`. `401` for a wrong email or password |
| `GET /auth/me` | yes | Returns `{ user }` |
| `GET /clients` | yes | Returns `{ clients }`, each with `projectCount` |
| `POST /clients` | yes | Body: `name` (2-80), optional `email`, `company`. Returns `201 { client }`. `409` for a duplicate name |
| `PATCH /clients/:id` | yes | Update any of the client fields. Returns `{ client }` |
| `DELETE /clients/:id` | yes | Returns `204`. `409` if the client still has projects |
| `GET /projects` | yes | Returns `{ projects }` with `client: { _id, name }`. Optional `?clientId=` filter |
| `POST /projects` | yes | Body: `name` (2-80), `clientId`, `hourlyRate` (0-10000), optional `color` (hex, default `#4F46E5`). Returns `201 { project }`. `400 Client not found` if the client isn't yours, `409` for a duplicate name |
| `PATCH /projects/:id` | yes | Update any of the project fields. Returns `{ project }` |
| `DELETE /projects/:id` | yes | Returns `204` |
| `GET /timer` | yes | Returns `{ timer, serverTime }`: the running timer (with project and client names) or `null` |
| `POST /timer/start` | yes | Body: `projectId`, optional `description` (max 200), `billable` (default true). Returns `201 { timer, serverTime }`. `400 Project not found` if the project isn't yours or is archived, `409 A timer is already running. Stop it first.` |
| `POST /timer/stop` | yes | Returns `{ entry, serverTime }` with `endedAt` and `durationSeconds`. `404 No timer is running` |
| `PATCH /timer` | yes | Change `description`, `billable` or `projectId` of the running timer only. Returns `{ timer, serverTime }` |
| `PATCH /auth/me` | yes | Body: `timezone` (a real time zone name such as `Asia/Kolkata`). Returns `{ user }` |
| `GET /entries` | yes | Finished entries (the running timer is left out), newest first, plus totals. Optional filters: `from` (inclusive) and `to` (exclusive) as ISO date-times, `clientId`, `projectId`, `billable` (`true` / `false`), `status` (`all` / `unbilled` / `billed`), and `overlap=true` to make `from`/`to` match every entry that touches the range instead of only entries that started in it. Returns `{ entries, totals: { totalSeconds, billableSeconds, billableAmount, unbilledAmount } }` |
| `POST /entries` | yes | Body: `projectId`, `startedAt`, `endedAt` (ISO timestamps, offsets allowed), optional `description` (max 200), `billable` (default true). Returns `201 { entry }` with `source: "manual"` and the project's client copied in. `400` if the end isn't after the start, the entry is longer than 24 hours, or the end is in the future (1 minute of clock difference is allowed) |
| `GET /timesheet` | yes | Optional `weekStart` (a Monday, `YYYY-MM-DD`; defaults to the current week in your time zone, `400 Week must start on a Monday` otherwise). Returns `{ weekStart, weekEnd, timezone, days, rows, dayTotals, weekTotalSeconds, billableSeconds, billableAmount }`: `days` are 7 `{ date, label }`, each row has a project, its client and 7 `seconds` (one per day, an entry across midnight is split) plus `totalSeconds` and `billableSeconds`. The running timer is left out |
| `PATCH /entries/:id` | yes | Change any of those fields. `409 This entry is on an invoice and can't be changed` for a billed entry, `409 Stop the timer first` for the running timer |
| `DELETE /entries/:id` | yes | Returns `204`. Same `409` rules as editing |
| `GET /invoices` | yes | Returns `{ invoices }`, newest first, without their lines. Optional `?status=draft\|sent\|paid` and `?clientId=` |
| `GET /invoices/:id` | yes | Returns `{ invoice, entries }`: the invoice with its lines, and the time entries on it in time order |
| `POST /invoices/preview` | yes | Body: `clientId`, `from`, `to` (`YYYY-MM-DD`, both days included, in your time zone). Returns `{ preview }` with the lines, total and entries that an invoice would contain, and saves nothing. `400` for a client that isn't yours, `from` after `to`, a period over 366 days or an end date after today, and `400 No unbilled billable time for this client in this period` when nothing matches |
| `POST /invoices` | yes | Same body plus optional `notes` (max 500). Bills the matching entries and returns `201 { invoice }` (`INV-0001`, ...). The same `400`s as the preview, which is also what a second, simultaneous request for the same entries gets. `503` if MongoDB has no transactions (a local server that isn't a replica set) |
| `PATCH /invoices/:id/status` | yes | Body: `status` (`sent` or `paid`). Draft to sent, sent to paid or draft to paid; anything else is `409 Can't change status from X to Y`. Returns `{ invoice }` |
| `DELETE /invoices/:id` | yes | Returns `204` and makes the invoice's entries unbilled again. Only drafts: `409 Only draft invoices can be deleted` |

**Errors** always look like `{ "message": "...", "errors": [{ "path": "email", "message": "..." }] }`; `errors` is only present for validation failures (`400`). A malformed `:id` returns `400 Invalid id`, a missing or invalid token returns `401`, and a record that doesn't exist or belongs to someone else returns `404`.

## Project structure

```
timeledger/
├── backend/
│   ├── .env.example
│   └── src/
│       ├── app.js, server.js         Express app and startup
│       ├── config/                   MongoDB connection
│       ├── models/                   User, Client, Project, TimeEntry, Invoice, Counter (invoice numbers)
│       ├── routes/                   auth, clients, projects, timer, entries, timesheet, invoices
│       ├── controllers/              request handlers
│       ├── services/                 timer.service.js (the running timer), entries.service.js (manual entries, filters, totals), timesheet.service.js (the weekly grid), invoice.service.js (preview, create, status, delete)
│       ├── middleware/               auth, validation, error handling
│       ├── validators/               Zod schemas
│       ├── utils/                    helpers (tokens, errors, money, ids)
│       └── tests/                    Jest tests
├── frontend/
│   ├── .env.example
│   └── src/
│       ├── api/                      axios instance and API calls
│       ├── components/               shared UI (Modal, Button, FormField, ...)
│       ├── context/, hooks/          auth and timer state
│       ├── layouts/                  AuthLayout, AppLayout (sidebar / tab bar)
│       ├── pages/                    Login, Register, Dashboard, Clients, Projects, TimeEntries, Timesheet, Invoices, InvoiceDetail
│       └── utils/                    formatting and error helpers
└── docs/
    └── test-evidence/                test report, screenshots, raw results, test code
```

## Testing

```bash
cd backend
npm test
```

The 140 backend tests run against a throwaway in-memory MongoDB (the invoice tests against an in-memory replica set, which needs a moment to start), so they never touch your real database:

| File | Tests | Covers |
| --- | --- | --- |
| `health.test.js` | 2 | health route and JSON 404 |
| `auth.test.js` | 11 | register, login, `/me`, validation, duplicate email, saving the time zone |
| `clients-projects.test.js` | 18 | create/edit/delete, duplicate names, per-user isolation, delete rules (including projects that have time entries), entries following a project to another client, rate validation and rounding |
| `timer.test.js` | 25 | server-side start time, one timer per user (including simultaneous requests and the database index itself), stop and duration, editing the running timer, other users' timers |
| `entries.test.js` | 28 | manual entries (duration, client copied, UTC storage), the time rules (end after start, max 24 hours, not in the future), editing and deleting, billed and running entries locked, other users' entries, filters (including `overlap`) and totals (billable amount from each project's rate) |
| `timesheet.test.js` | 24 | entries on the right day columns, splitting across midnight, clipping at the week edges, the same UTC entry on different days for India and New York, the daylight saving weeks of 2 March and 26 October 2026 (23-hour and 25-hour Sundays), totals and billable amount, Monday rule, other users' entries, and the pure `splitIntoDays` function |
| `invoices.test.js` | 32 | which entries are billed, line items and rounding, snapshots that later changes can't alter, billed entries locked, **an entry never on two invoices (two identical requests, eight at once, overlapping periods, two users)**, all or nothing, the 503 without transactions, time zone day boundaries (India, New York), validation, numbering that is never reused, the status flow, deleting a draft, per-user privacy |

The browser checks (385 in total for Steps 2 to 7) drive the real app in a headless browser: sign-up and login, the sidebar and mobile layout, every Clients and Projects action, the timer (start, stop, refresh while running, a freshly opened browser, a second tab, wrong device clocks, starting a second timer), time entries (date presets, every filter, adding and editing by hand, delete, the dashboard's Today edit, time zones including a device in New York), the timesheet (an entry across midnight, the week in the URL, the navigator, today's column, clicking a cell, the daylight saving Sunday on a New York device, phone and tablet layouts, the dashboard's "This week" card), invoices (the live preview, creating an invoice, billing the same period again, two tabs creating at the same moment, six simultaneous API requests, Draft to Sent to Paid, deleting a draft, an invoice that doesn't change when a rate or client changes, another user's invoice, the printed page and the PDF it produces, phone layout), and a check that nothing scrolls sideways at 375px. Their results, screenshots and scripts are in [docs/test-evidence](docs/test-evidence).

## Troubleshooting

- **`querySrv ECONNREFUSED` when connecting to Atlas:** Node's DNS lookup failed. The app already uses public DNS servers by default. If your network blocks them, set `DNS_SERVERS` in `backend/.env` to your network's DNS.
- **`JWT_SECRET is not defined`:** copy `backend/.env.example` to `backend/.env` and set a long random value.
- **Browser shows a CORS error:** make sure `FRONTEND_URL` in `backend/.env` matches the address of the frontend (default `http://localhost:5173`).
- **`503 Invoices need MongoDB transactions` when creating or deleting an invoice:** your MongoDB is a plain standalone server. Use MongoDB Atlas, or run a local MongoDB as a single-node replica set (`mongod --replSet rs0`, `rs.initiate()` once in `mongosh`, and `?replicaSet=rs0` on `MONGODB_URI`).
- **Port already in use:** another copy of the app is running. Stop it, or change `PORT` / the Vite port.
