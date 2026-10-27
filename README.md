# TimeLedger

A full-stack time tracker and invoicing app for freelancers, built with the MERN stack (MongoDB, Express, React, Node.js).

## Progress

| Step | What | Status |
| --- | --- | --- |
| 1 | Project setup: Express + Mongoose API, React + Vite + Tailwind app | Done |
| 2 | Authentication: register, login, JWT, protected routes | Done |
| 3 | App layout, Clients and Projects | Done |
| 4 | Start/stop timer, kept on the server | Done |
| 5+ | Manual time entries, timesheet, invoices, demo seed data | Planned |

**Test results:** 51 backend tests and 166 automated browser checks all pass. Everything is in [docs/test-evidence](docs/test-evidence): a one-page report with screenshots ([test-report.html](docs/test-evidence/test-report.html), download it and open it in a browser), every screenshot as a separate image, the raw results and the test code.

## Features

- **Authentication**: register and log in with a hashed password (bcrypt) and a JWT. Logged-in users stay logged in after a reload; logged-out users are redirected to `/login`.
- **App layout**: fixed sidebar on desktop; top bar and bottom tab bar on phones. Time Entries, Timesheet and Invoices are "Coming soon" placeholders for now.
- **Clients**: add, edit and delete clients (name, optional company and email). The list shows how many projects each client has. Names are unique per user, ignoring case.
- **Projects**: each project belongs to a client and has an hourly rate (0 to 10000, stored with 2 decimals) and a color. Filter the list by client. Names are unique per client.
- **Timer**: start and stop a timer on a project from the dashboard. Only one timer can run per user. It is kept on the server, so it is still correct after a refresh, after closing the browser, and on another device. A small running indicator shows in the sidebar (or top bar on phones) on every page, and the time appears in the browser tab title.
- **Today**: the dashboard lists today's stopped timers with their total.
- **Private data**: every record belongs to one user. Asking for someone else's record returns `404`.

### How the timer works

- The running timer is a time entry with no end time (`endedAt: null`). It lives in MongoDB, never only in the browser.
- A unique index (one entry per user with `endedAt: null`) makes the **database** guarantee one running timer per user, even if two devices press Start at the same moment. The loser gets `409 A timer is already running. Stop it first.`
- The start time always comes from the server's clock. The browser works out the elapsed time as `now - startedAt`, corrected for any difference between the device clock and the server clock (every API response includes `serverTime`), so a device with a wrong clock still shows the right time.
- The browser re-checks the server when the tab becomes visible again and every 30 seconds, so a timer started or stopped on another device shows up by itself.
- Stopping is one atomic update that only matches a still-running timer, so two Stop requests can't both succeed. The duration is calculated by the database as `floor((endedAt - startedAt) / 1000)` seconds.

## Tech stack

- **Backend:** Node.js (ES modules), Express 5, MongoDB with Mongoose 9, Zod 4 for validation, JSON Web Tokens, bcryptjs
- **Frontend:** React 19, Vite, Tailwind CSS 4, React Router, Axios, lucide-react icons, react-hot-toast
- **Tests:** Jest, Supertest and mongodb-memory-server (backend)

## Setup

**Prerequisites:** Node.js 20.19+ (or 22.12+) and a MongoDB database (local, or a free MongoDB Atlas cluster).

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
| `GET /entries?from=&to=` | yes | Stopped entries (ISO date-times, `from` inclusive, `to` exclusive), newest first. Used for the dashboard's "Today" list |

**Errors** always look like `{ "message": "...", "errors": [{ "path": "email", "message": "..." }] }`; `errors` is only present for validation failures (`400`). A malformed `:id` returns `400 Invalid id`, a missing or invalid token returns `401`, and a record that doesn't exist or belongs to someone else returns `404`.

## Project structure

```
timeledger/
├── backend/
│   ├── .env.example
│   └── src/
│       ├── app.js, server.js         Express app and startup
│       ├── config/                   MongoDB connection
│       ├── models/                   User, Client, Project, TimeEntry
│       ├── routes/                   auth, clients, projects, timer, entries
│       ├── controllers/              request handlers
│       ├── services/                 timer.service.js (start / stop / edit the running timer)
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
│       ├── pages/                    Login, Register, Dashboard, Clients, Projects
│       └── utils/                    formatting and error helpers
└── docs/
    └── test-evidence/                test report, screenshots, raw results, test code
```

## Testing

```bash
cd backend
npm test
```

The 51 backend tests run against a throwaway in-memory MongoDB, so they never touch your real database:

| File | Tests | Covers |
| --- | --- | --- |
| `health.test.js` | 2 | health route and JSON 404 |
| `auth.test.js` | 8 | register, login, `/me`, validation, duplicate email |
| `clients-projects.test.js` | 16 | create/edit/delete, duplicate names, per-user isolation, delete rules, rate validation and rounding |
| `timer.test.js` | 25 | server-side start time, one timer per user (including simultaneous requests and the database index itself), stop and duration, editing the running timer, other users' timers, the entries list |

The browser checks (166 in total for Steps 2 to 4) drive the real app in a headless browser: sign-up and login, the sidebar and mobile layout, every Clients and Projects action, the timer (start, stop, refresh while running, a freshly opened browser, a second tab, wrong device clocks, starting a second timer), and a check that nothing scrolls sideways at 375px. Their results, screenshots and scripts are in [docs/test-evidence](docs/test-evidence).

## Troubleshooting

- **`querySrv ECONNREFUSED` when connecting to Atlas:** Node's DNS lookup failed. The app already uses public DNS servers by default. If your network blocks them, set `DNS_SERVERS` in `backend/.env` to your network's DNS.
- **`JWT_SECRET is not defined`:** copy `backend/.env.example` to `backend/.env` and set a long random value.
- **Browser shows a CORS error:** make sure `FRONTEND_URL` in `backend/.env` matches the address of the frontend (default `http://localhost:5173`).
- **Port already in use:** another copy of the app is running. Stop it, or change `PORT` / the Vite port.
