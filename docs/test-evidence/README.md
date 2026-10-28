# TimeLedger: test evidence (Steps 1-8)

Everything that was run to check the app, in one folder: the results, every screenshot, and the test code itself. Generated 2026-10-28 18:25.

## Start here

| Open this | To see |
| --- | --- |
| [test-report.html](test-report.html) | The whole report in one page: summary, every test, all screenshots (click one to zoom). Double-click it to open in a browser. |
| [screenshots/](screenshots) | 79 screenshots taken by the browser tests, as separate PNG files. |
| [results/](results) | The raw output of each test run (text and JSON). |
| [sample-pdfs/](sample-pdfs) | Two invoices exactly as the browser's "Save as PDF" engine produced them (a one-page invoice, and a 36-project invoice over three pages). |
| [test-code/](test-code) | The test files that were run. |

## Summary

| Check | Result |
| --- | --- |
| Backend tests (Jest + Supertest) | **157/157 passed** |
| Browser checks, Step 2 (auth) | **29/29 passed** |
| Browser checks, Step 3 (layout, clients, projects) | **62/62 passed** |
| Browser checks, Step 4 (timer) | **73/73 passed** |
| Browser checks, Step 5 (time entries) | **82/82 passed** |
| Browser checks, Step 6 (timesheet) | **54/54 passed** |
| Browser checks, Step 7 (invoices) | **85/85 passed** |
| Browser checks, Step 8 (demo seed data, rounding, settings) | **63/63 passed** |
| Mutation checks, Step 8 (rounding to nearest instead of up, a seed that deletes everybody's data) | **7 and 1 tests fail** ([results/mutation-checks-step-8.txt](results/mutation-checks-step-8.txt)); restored, all pass |
| Mutation check: taking the "not billed yet" guard out of the claim | **5 tests fail** ([results/mutation-check-double-billing.txt](results/mutation-check-double-billing.txt)); with the guard restored 32/32 pass |
| Frontend production build | passed |

Environment: Node v22.22.1, npm 10.9.4, Microsoft Edge 156.0.4314.42, Microsoft Windows 11 Home Single Language.

## How the tests were run

- **Backend tests:** `cd backend && npm test`. Each test file starts its own throwaway in-memory MongoDB, so no real database is used (the invoice tests use an in-memory *replica set*, because invoices need MongoDB transactions).
- **Browser checks:** a script drives Microsoft Edge (headless) like a real user: it clicks, types, reloads and takes screenshots. It runs against the production build of the frontend and the real backend (on an in-memory MongoDB replica set) on separate ports (5100 and 5273). Any request to the normal dev ports 5000/5173 is blocked, so a running `npm run dev` and its real database are never touched.
- **What a "browser check" is:** one yes/no question about the running app, for example "after a wrong password a toast appears and we stay on /login". The full list is below.

## Problems the checks found while building Step 8

- **The phone top bar overflowed.** Adding the Settings gear next to Log out pushed Log out off a 375px screen while a timer was running (an existing Step 4 check failed). The logo and the mini timer are now a little more compact on phones; the Step 8 checks also test 360px.
- **The dashboard cards were wider than a phone screen** (since Step 6): the This week and Today cards ran off the right edge. Looking at the new screenshots showed it; the old "no sideways scroll" check could not, because on a phone the page width grows with the content and the check compared the page with that grown width. It now compares with the real screen width and also looks at every element on the page. Fixed with one class (`grid-cols-1`).
- **Test start-up was slow on a busy computer.** Every test file starts its own in-memory MongoDB; with nine files at once some did not start within the default 10 seconds. Jest now runs at most 4 files at a time with a 60 second limit.

## What was NOT tested

- The frontend components have no unit tests; they are only covered by the browser checks above.
- Only Microsoft Edge was used (no Firefox or Safari, no real phone; phone layouts were checked at a 375px-wide window).
- No load, performance or security-scanning tests.
- The "other devices" in the timer checks are separate browser windows with their own storage (some with deliberately wrong clocks), not real phones or computers.
- Time zones were checked for two zones only: India (the default) and New York (a device set to that zone, including the daylight-saving change). Other zones use the same code but were not run.
- The timesheet's 25-hour day (clocks going back, week of 26 October 2026) is checked by the backend tests only. In the browser only the 23-hour day (clocks going forward) was checked, on a device set to New York.
- The weekly timesheet was only looked at for weeks that start on a Monday and users with the default or New York time zone; other zones use the same code.
- Some of the Step 5 and Step 6 browser checks set up their data (an entry marked as billed, a timer entry with exact seconds) by writing to the throwaway test database directly, because invoices did not exist yet when those scripts were written. The Step 7 checks create everything through the API and the screens.
- Invoices were tested on an in-memory MongoDB replica set and are written for MongoDB Atlas (also a replica set). A plain local MongoDB that is not a replica set cannot run transactions; the app then answers 503 with an explanation (a test simulates that error), but a real standalone mongod was not started to see it.
- The printed invoice was checked by emulating print media in Edge, by the produced PDF files' page count and paper size (A4), and by screenshot. The PDF text itself was not extracted and no printer or other PDF viewer was used.
- The seed was run against a throwaway in-memory MongoDB replica set only (through the real `npm run seed` command, and by the tests), not against MongoDB Atlas.
- The demo data is placed relative to today (India time) and today only gets entries that have already finished, so the exact hours and amounts change from day to day. The tests check the rules (2-4 entries a day, 30 minutes to 3 hours, one entry across midnight, the invoices' periods and statuses, the last two weeks unbilled) and that two runs on the same day give identical data.
- The rounding rule has two settings, off and 15 minutes. It is applied on invoices only: the estimates on Time entries and the Timesheet (and the unbilled amount) use the tracked time.
- Phone layouts were checked at 375px, and at 360px for the top bar with a running timer.
- Invoices only have a status you set by hand (Draft, Sent, Paid): nothing is e-mailed, and there is no online payment, tax, discount or currency conversion.
- The timer in the browser tab title is updated by the page, and browsers slow down timers in background tabs, so a hidden tab may update its title less often than once a second. The elapsed time itself is always correct when you look at it. Not tested.
- The MongoDB Atlas connection was checked once by hand (a read-only ping), not by an automated test.
- `npm run seed` is still a placeholder.

## Backend tests (157)

Source: [test-code/backend/](test-code/backend). Raw output: [results/backend-jest-output.txt](results/backend-jest-output.txt).

### `rounding.test.js` (6 tests)

**roundUp(seconds, minutes)**

- ✅ rounds up to the next block of 15 minutes
- ✅ keeps an exact multiple as it is, and goes up a whole block one second after it
- ✅ keeps an empty entry at 0
- ✅ does nothing when rounding is off (0 minutes or no value)
- ✅ never goes below 0 and never rounds down
- ✅ works for other block sizes too

### `seed.test.js` (3 tests)

**seed**

- ✅ can be run again and again: same counts, same invoices, and the data looks like the brief
- ✅ does not delete or change another user's data
- ✅ refuses to run in production unless SEED_ALLOW=true

### `timer.test.js` (25 tests)

**POST /api/timer/start and GET /api/timer**

- ✅ sets startedAt from the server clock (ignoring any time the client sends) and GET returns it
- ✅ returns { timer: null, serverTime } when nothing is running
- ✅ defaults to billable with an empty description
- ✅ returns 409 when a timer is already running
- ✅ lets exactly one of two simultaneous start requests win
- ✅ still allows only one when many requests arrive at once
- ✅ allows different users to run timers at the same time
- ✅ rejects another user's project with 400 'Project not found'
- ✅ rejects an archived project and a project that does not exist
- ✅ validates the body

**one running timer per user is enforced by the database**

- ✅ has a partial unique index on userId for entries with endedAt: null
- ✅ rejects a second running entry even when the service is bypassed

**POST /api/timer/stop**

- ✅ calculates durationSeconds from startedAt and endedAt
- ✅ keeps very short entries (duration can be 0)
- ✅ returns 404 'No timer is running' when nothing is running
- ✅ lets only one of two simultaneous stop requests succeed
- ✅ lets the user start a new timer after stopping

**PATCH /api/timer**

- ✅ updates description and billable of the running timer
- ✅ can move the running timer to another of my projects (clientId follows)
- ✅ rejects another user's project, bad input, and an empty patch is harmless
- ✅ returns 404 when no timer is running and never edits a stopped entry

**users can't touch each other's timers**

- ✅ user A cannot see, stop or edit user B's timer
- ✅ requires authentication

**GET /api/entries**

- ✅ lists only my stopped entries inside the range, newest first, with project and client names
- ✅ rejects a malformed date

### `entries.test.js` (28 tests)

**POST /api/entries**

- ✅ creates a manual entry with the right duration and the project's client
- ✅ is billable by default, copies the client of whichever project is chosen, and stores UTC
- ✅ validates required fields, date formats and field lengths
- ✅ rejects another user's project and an archived project

**POST /api/entries > time rules**

- ✅ rejects an end before the start, and a zero-length entry
- ✅ rejects an entry longer than 24 hours but accepts exactly 24 hours
- ✅ rejects an end time in the future, with 1 minute of clock difference allowed

**PATCH /api/entries/:id**

- ✅ recalculates the duration when the times change
- ✅ checks the new time against the existing one when only one time is sent
- ✅ copies the new project's client when the project changes
- ✅ can change just the description and billable flag, leaving the times alone
- ✅ rejects another user's project, and edits stopped timer entries like any other
- ✅ returns 409 for a billed entry and leaves it unchanged
- ✅ returns 409 "Stop the timer first" for the running timer
- ✅ returns 404 for an unknown id and 400 for a malformed one

**DELETE /api/entries/:id**

- ✅ deletes an entry
- ✅ returns 409 for a billed entry
- ✅ returns 409 "Stop the timer first" for the running timer

**users can't touch each other's entries**

- ✅ user A cannot see, edit or delete user B's entries (404)
- ✅ user A cannot create an entry on user B's project
- ✅ requires authentication

**GET /api/entries**

- ✅ lists finished entries newest first, without the running timer or other users' entries
- ✅ calculates totals, including the billable amount from each project rate
- ✅ filters by billable
- ✅ filters by status (unbilled, billed, all)
- ✅ combines filters and filters by client, project and date range
- ✅ with overlap=true, from/to also match entries that start before the range or run past it
- ✅ rejects invalid filters

### `invoices.test.js` (36 tests)

**POST /api/invoices: which entries are billed**

- ✅ bills billable, unbilled, finished entries of that client inside the range, and nothing else
- ✅ shows the same entries in a preview without saving anything
- ✅ answers a preview and a create with "nothing to bill" when no entry matches

**line items and totals**

- ✅ makes one line per project with hours, rate and amount rounded to cents, and a total that adds up
- ✅ the total is the sum of the rounded lines, not the rounded sum of the exact amounts
- ✅ snapshots the client, the sender, the period, the time zone, the dates and the notes
- ✅ later changes to a rate, a project, the client or the user never change an existing invoice

**billed entries**

- ✅ become billed, cannot be edited or deleted, and cannot be invoiced a second time

**concurrency: an entry is never on two invoices**

- ✅ two identical requests at the same time: one invoice, every entry on exactly that one
- ✅ eight requests at once: exactly one wins
- ✅ overlapping ranges at the same time: every entry still ends up on exactly one invoice
- ✅ two users invoicing at the same time do not affect each other

**all or nothing**

- ✅ if saving the invoice fails, the claimed entries are released and no number is used up
- ✅ explains clearly when MongoDB has no transactions (a plain local server)

**rounding each entry up to 15 minutes**

- ✅ bills 7 min + 22 min as 15 + 30 min (per entry), and leaves the entries themselves alone
- ✅ is off by default: the same entries are billed as tracked
- ✅ rounds every entry, not the total, and one project at a time
- ✅ never changes an invoice that already exists when the setting is changed later (either way)

**the date range uses the user's time zone**

- ✅ India: 23:30 on the last day is in, 00:15 the next morning is out
- ✅ New York (UTC-4 in March): the day starts at 04:00 UTC

**validation**

- ✅ rejects a client that isn't the user's, or missing
- ✅ rejects bad dates, from after to, ranges over 366 days and an end date after today
- ✅ rejects notes over 500 characters

**invoice numbers**

- ✅ count up per user (INV-0001, INV-0002, ...) and are never reused
- ✅ are unique per user in the database too

**PATCH /api/invoices/:id/status**

- ✅ allows draft to sent, sent to paid, and draft to paid, and records when
- ✅ rejects every other change with 409 "Can't change status from X to Y"
- ✅ rejects a status that does not exist

**DELETE /api/invoices/:id**

- ✅ deletes a draft and gives its entries back so they can be invoiced again
- ✅ refuses to delete a sent or a paid invoice (409) and keeps its entries billed
- ✅ returns 404 for an invoice that does not exist and 400 for a malformed id

**GET /api/invoices and /api/invoices/:id**

- ✅ lists my invoices newest first with filters, without the heavy fields
- ✅ returns one invoice with its lines, and the entries on it in time order

**users can't touch each other's invoices**

- ✅ user B cannot see, change or delete user A's invoice (404) and it is not in B's list
- ✅ user B cannot bill user A's entries, even by using A's client id
- ✅ requires a login

### `timesheet.test.js` (24 tests)

**GET /api/timesheet: days and rows**

- ✅ puts entries on the right day columns, with 7 labelled days and rows sorted by client then project
- ✅ only lists projects that have time that week and returns zeros for an empty week
- ✅ defaults to the current week in the user's own time zone

**entries across midnight and at the edges of the week**

- ✅ splits an entry that crosses midnight between the two days
- ✅ clips entries to the edges of the week and ignores entries outside it
- ✅ leaves out the running timer
- ✅ counts whole seconds, so the days add up to exactly the entry's durationSeconds

**days are counted in the user's time zone**

- ✅ the same UTC entries land on different days for India and New York
- ✅ uses each user's own zone even when two users look at the same week

**daylight saving weeks (America/New_York)**

- ✅ the week DST starts (2 March 2026): Sunday 8 March is 23 hours long
- ✅ the week DST ends (26 October 2026): Sunday 1 November is 25 hours long
- ✅ a normal week after the change (9 March 2026): days start at 04:00 UTC

**totals**

- ✅ calculates dayTotals, weekTotalSeconds, billableSeconds and billableAmount
- ✅ billed entries still count towards the week

**validation and privacy**

- ✅ rejects a weekStart that is not a Monday
- ✅ rejects a weekStart that is not a date
- ✅ never shows another user's entries
- ✅ requires a login

**splitIntoDays**

- ✅ puts an entry that stays inside one day in that day
- ✅ splits an entry that crosses midnight
- ✅ spreads a very long entry over every day it touches
- ✅ clips the parts before the week starts and after it ends
- ✅ returns zeros for an entry outside the week or touching it only at an edge
- ✅ accepts Date objects as well as timestamps, and always returns 7 numbers

### `clients-projects.test.js` (18 tests)

**creating clients and projects**

- ✅ creates a client and a project, and lists them with projectCount and client name
- ✅ filters projects by clientId
- ✅ allows the same project name under different clients but not under the same client

**duplicate client names**

- ✅ returns 409 for a duplicate name (case-insensitive) for the same user
- ✅ allows another user to use the same name
- ✅ returns 409 when renaming a client to an existing name

**data isolation between users**

- ✅ user A cannot see, edit or delete user B's client
- ✅ user A cannot see, edit or delete user B's project
- ✅ rejects a project that uses another user's clientId with 400

**deleting**

- ✅ returns 409 when deleting a client that still has projects, then succeeds once they are gone
- ✅ returns 409 when deleting a project that has time entries

**moving a project to another client**

- ✅ moves the project's unbilled entries along, but not entries that are already on an invoice

**validation**

- ✅ rejects invalid hourlyRate values with a field error
- ✅ accepts the boundary rates 0 and 10000
- ✅ validates client and project fields
- ✅ lets a client email be cleared with an empty string
- ✅ returns 400 "Invalid id" for malformed ids
- ✅ requires authentication

### `health.test.js` (2 tests)

**GET /api/health**

- ✅ returns status ok
- ✅ returns a JSON error for unknown routes

### `auth.test.js` (15 tests)

**POST /api/auth/register**

- ✅ creates a user and returns { user, token } without the password hash
- ✅ returns 409 for a duplicate email (case-insensitive)
- ✅ returns 400 with field-wise errors for invalid input

**POST /api/auth/login**

- ✅ returns { user, token } for correct credentials
- ✅ returns 401 for a wrong password

**GET /api/auth/me**

- ✅ returns 401 without a token
- ✅ returns 401 for an invalid token
- ✅ returns the current user with a valid token

**PATCH /api/auth/me (time zone)**

- ✅ saves a valid time zone, including names Intl.supportedValuesOf leaves out
- ✅ rejects an unknown time zone and a missing value
- ✅ requires a token

**PATCH /api/auth/me (name and rounding rule)**

- ✅ has rounding off by default and saves 15 and 0
- ✅ rejects any other rounding value
- ✅ changes the name (trimmed) with the same rules as when registering
- ✅ changes several things at once, needs at least one, and ignores everything else

## Browser checks, Step 2: authentication (29)

Script: [test-code/browser/step-2-auth.mjs](test-code/browser/step-2-auth.mjs). Raw output: [results/browser-checks-step-2-auth.txt](results/browser-checks-step-2-auth.txt).

- ✅ / redirects to /login when logged out
- ✅ login page shows brand + demo hint
- ✅ empty login shows server field errors
- ✅ link goes to /register
- ✅ empty register shows errors under each field
- ✅ 3 inline field errors rendered (3)
- ✅ typing clears that field's error (2)
- ✅ register redirects to dashboard
- ✅ dashboard greets the user
- ✅ token saved in localStorage
- ✅ reload keeps user logged in
- ✅ logged-in user on /login is redirected to /
- ✅ logged-in user on /register is redirected to /
- ✅ logout goes to /login
- ✅ logout clears token
- ✅ wrong password shows toast
- ✅ stays on /login after failed login
- ✅ submit button shows spinner + disabled while loading
- ✅ correct login reaches dashboard
- ✅ second logout goes to /login
- ✅ register form renders after logout + reload
- ✅ duplicate email shows toast
- ✅ stays on /register after duplicate
- ✅ invalid token redirects to /login
- ✅ invalid token is cleared (401 handling)
- ✅ login: no horizontal overflow at 375px (overflow=0)
- ✅ register: no horizontal overflow at 375px (overflow=0)
- ✅ isolated: no request went to the dev servers on 5000/5173
- ✅ no unexpected console/page errors

## Browser checks, Step 3: layout, clients, projects (62)

Script: [test-code/browser/step-3-layout-clients-projects.mjs](test-code/browser/step-3-layout-clients-projects.mjs). Raw output: [results/browser-checks-step-3-layout-clients-projects.txt](results/browser-checks-step-3-layout-clients-projects.txt).

- ✅ desktop: sidebar visible, 256px wide, indigo-950 background (256px oklch(0.257 0.09 281.288))
- ✅ desktop: 6 nav items in order, then Settings (added in Step 8) (Dashboard, Clients, Projects, Time Entries, Timesheet, Invoices, Settings)
- ✅ desktop: active item has indigo-800 background
- ✅ desktop: user name + logout at bottom of sidebar
- ✅ desktop: mobile top bar and bottom tabs are hidden
- ✅ sidebar link goes to /clients
- ✅ clients: empty state with "Add your first client"
- ✅ clients: active item moves to Clients
- ✅ add client opens a modal
- ✅ empty client form shows name error
- ✅ bad email shows error under the email field
- ✅ valid client closes modal + toast
- ✅ client row shows name, company, email and project count (A Acme Corp 0 projects Acme Inc billing@acme.com)
- ✅ toast does not cover the Add client button
- ✅ duplicate client name shows error under name
- ✅ modal stays open after duplicate
- ✅ Escape closes the modal
- ✅ clicking the backdrop closes the modal
- ✅ 3 clients listed alphabetically (Acme, Globex, Initech)
- ✅ edit modal is prefilled
- ✅ editing a client updates the row
- ✅ projects: empty state
- ✅ project modal has 6 color presets
- ✅ empty project form shows name/client/rate errors
- ✅ negative rate shows server error
- ✅ rate above 10000 shows server error
- ✅ valid project saves + toast
- ✅ project row: name, client name, rate rounded + formatted as $45.68/hr (Website redesign Acme Corp $45.68/hr)
- ✅ project shows its color dot (Emerald) (rgb(16, 185, 129))
- ✅ rate uses JetBrains Mono
- ✅ same project name under a different client is allowed
- ✅ 3 projects listed
- ✅ duplicate project name shows inline error
- ✅ filter by client shows only that client's projects (Mobile app Globex Ltd $60.00/hr | Website redesign Globex Ltd $30.00/hr)
- ✅ filter with no projects shows its own empty state
- ✅ add project from a filtered view preselects the client
- ✅ edit project modal is prefilled
- ✅ editing a project updates the rate
- ✅ clients show project counts (1 / 2 / 0) (1 project, 2 projects, 0 projects)
- ✅ delete shows a confirm dialog
- ✅ Cancel keeps the client
- ✅ deleting a client with projects shows the 409 message
- ✅ client with projects is still listed
- ✅ client without projects is deleted
- ✅ project is deleted after confirming
- ✅ Invoices: the real page with "Create your first invoice" (no more "Coming soon")
- ✅ mobile: sidebar hidden, top bar with logo + logout shown
- ✅ mobile: bottom tab bar has 6 tabs, all inside the screen, pinned to bottom
- ✅ mobile: tab labels are not clipped
- ✅ mobile: no horizontal overflow on / (overflow=0)
- ✅ mobile: no horizontal overflow on /clients (overflow=0)
- ✅ mobile: no horizontal overflow on /projects (overflow=0)
- ✅ mobile: no horizontal overflow on /time-entries (overflow=0)
- ✅ mobile: no horizontal overflow on /timesheet (overflow=0)
- ✅ mobile: no horizontal overflow on /invoices (overflow=0)
- ✅ mobile: project rate is visible
- ✅ mobile: modal fits inside the screen ({"left":16,"right":359,"top":136,"bottom":531})
- ✅ mobile: modal causes no horizontal overflow
- ✅ mobile: project modal fits (scrolls internally if needed) ({"left":16,"right":359,"top":98.5,"bottom":568.5,"scrolls":false})
- ✅ mobile: logout from the top bar goes to /login
- ✅ isolated: no request went to the dev servers on 5000/5173
- ✅ no unexpected console/page errors

## Browser checks, Step 4: timer (73)

Script: [test-code/browser/step-4-timer.mjs](test-code/browser/step-4-timer.mjs). Raw output: [results/browser-checks-step-4-timer.txt](results/browser-checks-step-4-timer.txt).

- ✅ idle: card asks "What are you working on?"
- ✅ idle: description input is there
- ✅ idle: Billable switch is on by default
- ✅ idle: big primary "Start" button ({"text":"Start","size":16,"bg":"oklch(0.511 0.262 276.966)"})
- ✅ idle: tab title is plain "TimeLedger"
- ✅ idle: no mini timer in the sidebar
- ✅ idle: nothing running on the server
- ✅ start without a project shows an inline error
- ✅ ...and does not start anything
- ✅ dropdown opens as a listbox
- ✅ dropdown is grouped by client (alphabetical) (Acme Corp, Globex)
- ✅ dropdown lists every project with its color dot ([{"name":"Mobile app","dot":"rgb(79, 70, 229)"},{"name":"Website redesign","dot":"rgb(16, 185, 129)"},{"name":"Branding","dot":"rgb(245, 158, 11)"}])
- ✅ keyboard: ArrowDown + Enter selects a project and closes the list
- ✅ Start switches the card to the running state
- ✅ running: card is bg-primary (indigo-600) (oklch(0.511 0.262 276.966))
- ✅ running: shows "Running · Client / Project" (Running · Acme Corp / Website redesign)
- ✅ running: big HH:MM:SS clock in JetBrains Mono (00:00:00 60px)
- ✅ running: description is editable and holds what I typed
- ✅ running: white Stop button (rgb(255, 255, 255))
- ✅ running: clock starts at (almost) zero (00:00:00)
- ✅ running: tab title is "HH:MM:SS · TimeLedger" (00:00:00 · TimeLedger)
- ✅ server: timer exists with the server-side start time (between click and response) (65ms after the click)
- ✅ server: description and project saved
- ✅ clock ticks every second (0s -> 3s)
- ✅ mini timer in the sidebar: pulsing dot + time + stop icon ({"inSidebar":true,"time":"00:00:03","pulsing":true,"stopButton":true,"linkTo":"/"})
- ✅ mini timer stays visible on other pages
- ✅ tab title keeps showing the time on other pages
- ✅ clicking the mini timer goes to the dashboard
- ✅ ...and the running card shows straight away
- ✅ description saved to the server (Enter)
- ✅ Escape reverts the edit and saves nothing
- ✅ after a page refresh the timer is still running
- ✅ ...and the clock did not reset (it continues from the server start time) (4s -> 4s)
- ✅ ...description survived too
- ✅ a freshly opened browser shows the same running timer
- ✅ ...with the same elapsed time (within 2s) (A=4s B=5s)
- ✅ ...and the title shows the time there too
- ✅ device clock 10 minutes AHEAD still shows the correct elapsed time (A=7s C=7s)
- ✅ device clock 2 hours BEHIND still shows the correct elapsed time (A=7s D=7s)
- ✅ Stop shows a toast with the logged time
- ✅ ...the card goes back to the start form
- ✅ ...the tab title goes back to "TimeLedger"
- ✅ ...the mini timer disappears
- ✅ ...the server has no running timer
- ✅ "Today" lists the stopped entry with project, client, description and duration (Website redesign · Acme Corp Hero section v2 00:00:08)
- ✅ ...and its duration matches what the clock showed (within 2s) (clock=7s list=8s)
- ✅ ...Today shows a total
- ✅ server: stopped entry has endedAt and durationSeconds (8s)
- ✅ E: second tab loads idle
- ✅ another device starts a timer (API)
- ✅ starting a second timer shows the 409 message as is
- ✅ ...and E now shows the timer that is running elsewhere
- ✅ ...with the other device's description
- ✅ server still has exactly one running timer
- ✅ tab A shows the timer started elsewhere after becoming visible
- ✅ ...with the same time as E (within 2s)
- ✅ tab A goes idle after the timer is stopped elsewhere
- ✅ ...and "Today" now has both entries
- ✅ a timer started elsewhere appears on its own within ~30 seconds (no click, no refresh) (24s)
- ✅ the stop icon in the mini timer stops the timer
- ✅ ...and "Today" now has 3 entries
- ✅ no projects: "Create a project first" with a link
- ✅ ...the link goes to /projects
- ✅ mobile idle: no horizontal scroll (overflow=0)
- ✅ mobile: project dropdown fits the screen ({"left":33,"right":342})
- ✅ mobile: timer starts
- ✅ mobile: mini timer shows in the top bar next to the logo and log out ({"miniInTopBar":true,"miniVisible":true,"miniRight":287,"logoutLeft":323,"logoutRight":359,"time":"00:00:01"})
- ✅ mobile: top bar contents fit (nothing pushed off screen) ({"miniInTopBar":true,"miniVisible":true,"miniRight":287,"logoutLeft":323,"logoutRight":359,"time":"00:00:01"})
- ✅ mobile running: no horizontal scroll (overflow=0)
- ✅ mobile: other pages have no horizontal scroll while a timer runs
- ✅ mobile: stop works
- ✅ isolated: no request went to the dev servers on 5000/5173
- ✅ no unexpected console/page errors

## Browser checks, Step 5: time entries (82)

Script: [test-code/browser/step-5-time-entries.mjs](test-code/browser/step-5-time-entries.mjs). Raw output: [results/browser-checks-step-5-time-entries.txt](results/browser-checks-step-5-time-entries.txt).

- ✅ "Time Entries" in the sidebar opens the real page (not "Coming soon")
- ✅ header: "Time entries" + "Add entry" button
- ✅ default range is "This week": the request covers Monday 00:00 to next Monday 00:00 (India time) (2026-10-25T18:30:00.000Z -> 2026-11-01T18:30:00.000Z)
- ✅ this week shows today's entry under a "Today" heading (Today · Wed, 28 Oct 2026)
- ✅ ...but not last week's
- ✅ "Last week" asks for the previous Monday-to-Monday range (2026-10-18T18:30:00.000Z -> 2026-10-25T18:30:00.000Z)
- ✅ ...and shows last week's entry only
- ✅ "This month" asks for the 1st to the 1st of next month (2026-09-30T18:30:00.000Z -> 2026-10-31T18:30:00.000Z)
- ✅ ...and includes today's entry
- ✅ custom range includes both end days (9 March 00:00 to 14 March 00:00, India time) (2026-03-08T18:30:00.000Z -> 2026-03-13T18:30:00.000Z)
- ✅ summary cards: total hours (total hours 8h 45m)
- ✅ summary cards: billable hours (billable hours 7h 45m)
- ✅ summary cards: unbilled amount (the billed entry is left out) (unbilled amount $385.00)
- ✅ entries are grouped by day, newest day first, with the day's hours ([["Wed, 11 Mar 2026","5h 15m"],["Tue, 10 Mar 2026","1h 30m"],["Mon, 9 Mar 2026","2h"]])
- ✅ within a day the latest start comes first
- ✅ row: project, client, description, time range, duration, badge (Branding · Globex Logo options 09:00–12:15 Billable 3h 15m)
- ✅ row: an entry past midnight shows 23:00–01:00 (+1 day) (Website · Acme Corp Night deploy 23:00–01:00 (+1 day) Billable 2h)
- ✅ row: a non-billable entry gets the "Non-billable" badge (Mobile app · Acme Corp Internal sync 14:00–15:00 Non-billable 1h)
- ✅ row: an entry on an invoice gets the "Billed" badge (Website · Acme Corp Wireframes 09:00–11:00 Billed 2h)
- ✅ duration is shown in JetBrains Mono
- ✅ badge colors: Billable emerald, Non-billable slate, Billed indigo (["oklch(0.508 0.118 165.612)","oklch(0.372 0.044 257.287)","oklch(0.457 0.24 277.023)"])
- ✅ project color dot on each row (Branding is amber) (rgb(245, 158, 11))
- ✅ billed entry: lock icon instead of edit/delete
- ✅ normal entry: edit and delete buttons
- ✅ Billable filter "Non-billable" sends billable=false and shows just that entry
- ✅ ...the summary follows the filter (1h total, 0m billable, $0.00) (total hours 1h | billable hours 0s | unbilled amount $0.00)
- ✅ "Billable" sends billable=true and hides the non-billable entry
- ✅ Status "Billed" sends status=billed and shows only the invoiced entry
- ✅ Status "Unbilled" shows the other 4
- ✅ Client filter sends clientId and shows that client's entries
- ✅ the Project filter only offers that client's projects (All projects, Branding)
- ✅ Project filter sends projectId and shows only that project
- ✅ filters with no match show "No entries match these filters" and a Clear button
- ✅ Clear filters resets them and keeps the date range (rows=5 query={"from":"2026-03-08T18:30:00.000Z","to":"2026-03-13T18:30:00.000Z"})
- ✅ an empty period shows "No time entries yet" with an Add entry button
- ✅ ...and the summary is all zero (total hours 0s | billable hours 0s | unbilled amount $0.00)
- ✅ "Add entry" opens the modal with today's date filled in (2026-10-28)
- ✅ the modal has project, description, date, start, end and a billable switch (on)
- ✅ duration starts as "—"
- ✅ submitting an empty form shows field errors, and sends nothing
- ✅ ...the entries list was not touched
- ✅ live duration: 09:00 to 10:30 is "1h 30m"
- ✅ an end time before the start time means next day: "23h" and "ends next day" (Duration: 23h)
- ✅ ...and the hint goes away again
- ✅ saving shows a toast, closes the modal and the entry appears in its day
- ✅ ...under "Thu, 12 Mar 2026" with 1h 30m ({"heading":"Thu, 12 Mar 2026","total":"1h 30m","rows":["Website · Acme Corp Homepage copy 09:00–10:30 Billable 1h 30m"]})
- ✅ server: typed in India time, stored in UTC (09:00 IST = 03:30Z), 5400s, source manual, project's client copied (["2026-03-12T03:30:00.000Z","2026-03-12T05:00:00.000Z",5400,"manual"])
- ✅ the summary updated (10h 15m total, 9h 15m billable, $460.00 unbilled) (total hours 10h 15m | billable hours 9h 15m | unbilled amount $460.00)
- ✅ the Billable switch can be turned off
- ✅ server: 23:00 to 01:00 (India time) is stored as 2 hours crossing midnight, non-billable (["2026-03-13T17:30:00.000Z","2026-03-13T19:30:00.000Z",7200])
- ✅ ...and the list shows "(+1 day)" for it (Mobile app · Acme Corp Release night 23:00–01:00 (+1 day) Non-billable 2h)
- ✅ a future end time is rejected by the server and shown under "End time" (End time can't be in the future)
- ✅ ...the modal stays open so it can be fixed
- ✅ edit modal is filled with the entry ({"project":"Website\nAcme Corp","description":"Review","date":"2026-03-10","start":"10:00","end":"10:30","billable":"true","title":"Edit time entry","duration":"Duration: 30m"})
- ✅ saving an edit shows a toast and updates the row
- ✅ ...with the new time and duration (10:00–11:00, 1h) (Website · Acme Corp Review and fixes 10:00–11:00 Billable 1h)
- ✅ server: duration recalculated to 3600s ([3600,"2026-03-10T05:30:00.000Z"])
- ✅ changing the project also changes the entry's client on the server ([true,true])
- ✅ editing only the description of a timer entry leaves its exact start, end and seconds alone ([1234,"2026-03-12T04:00:07.000Z","2026-03-12T04:20:41.000Z"])
- ✅ delete asks for confirmation
- ✅ Cancel keeps the entry
- ✅ confirming deletes it, with a toast
- ✅ server: the entry is gone
- ✅ deleting an entry that was invoiced in the meantime shows the server's 409 message
- ✅ ...and it is still there
- ✅ Dashboard "Today": the pencil opens the same edit modal
- ✅ ...and saving refreshes the Today list
- ✅ server: the description changed, the times did not
- ✅ same zone under another name (India: Asia/Kolkata saved, device says Asia/Calcutta): nothing is sent to the server (PATCH /auth/me calls: 0)
- ✅ device time zone differs from the saved one: the app saves the device's zone, once (PATCH calls: 1, now saved: Asia/Calcutta)
- ✅ a device in New York: the saved zone becomes America/New_York
- ✅ 09:00-10:00 typed in New York is stored as 13:00Z-14:00Z (daylight saving, UTC-4) (["2026-03-12T13:00:00.000Z","2026-03-12T14:00:00.000Z"])
- ✅ phone: the filters are collapsed behind a "Filters" button
- ✅ ...tapping it opens the filters
- ✅ phone: the Filters button shows how many filters are on
- ✅ phone: no horizontal scroll with the list and summary (overflow=0)
- ✅ phone: every row fits inside the screen
- ✅ phone: the entry modal fits the screen ({"left":16,"right":359,"top":52.59375,"bottom":614.390625})
- ✅ phone: no horizontal scroll with the modal open
- ✅ phone: the dashboard Today list has no horizontal scroll (overflow=0)
- ✅ isolated: no request went to the dev servers on 5000/5173
- ✅ no unexpected console/page errors

## Browser checks, Step 6: timesheet (54)

Script: [test-code/browser/step-6-timesheet.mjs](test-code/browser/step-6-timesheet.mjs). Raw output: [results/browser-checks-step-6-timesheet.txt](results/browser-checks-step-6-timesheet.txt).

- ✅ "Timesheet" in the sidebar opens the real page (not "Coming soon")
- ✅ header: "Timesheet" with a note about the time zone
- ✅ week navigator shows "9 – 15 Mar 2026" (9 – 15 Mar 2026)
- ✅ columns: Project, Mon 9 ... Sun 15, Total (PROJECT | Mon 9 | Tue 10 | Wed 11 | Thu 12 | Fri 13 | Sat 14 | Sun 15 | TOTAL)
- ✅ rows are sorted by client, then project (Acme App, Acme Website, Zeta Brand) (Acme Corp/App | Acme Corp/Website | Zeta Ltd/Brand)
- ✅ App row: 30m on Wed, 1h 30m on Sun, 2h in total (— | — | 30m | — | — | — | 1h 30m | 2h)
- ✅ Website row: 2h Mon, 1h Tue + 1h Wed (the entry across midnight), 2h Sat, 6h in total (2h | 1h | 1h | — | — | 2h | — | 6h)
- ✅ Brand row: 1h on Fri (— | — | — | — | 1h | — | — | 1h)
- ✅ bottom row: daily totals and the week total (9h) (Daily total | 2h | 1h | 1h 30m | — | 1h | 2h | 1h 30m | 9h)
- ✅ summary cards: total 9h, billable 7h 30m, billable amount $410.00 (total hours 9h | billable hours 7h 30m | billable amount $410.00)
- ✅ project cell: color dot, project name, client name below in smaller text (rgb(16, 185, 129))
- ✅ cells use JetBrains Mono, empty cells a light "—" (oklch(0.208 0.042 265.755) vs oklch(0.869 0.022 252.894))
- ✅ weekend columns (Sat, Sun) are slightly muted (["oklch(0.984 0.003 247.858)","oklch(0.984 0.003 247.858)"])
- ✅ no "today" highlight in a past week
- ✅ the day cards are hidden on a wide screen
- ✅ Previous: URL becomes ?week=2026-03-02 and the label "2 – 8 Mar 2026" (2026-03-02 / 2 – 8 Mar 2026)
- ✅ a week without time shows "No time tracked this week" and a "Go to Dashboard" button
- ✅ Next: back to 9 – 15 Mar 2026 with its data
- ✅ a refresh keeps the week from the URL
- ✅ "This week" jumps to the current week (Monday in India time) (2026-10-26 (expected 2026-10-26))
- ✅ on the current week "Next" and "This week" are disabled, "Previous" is not ({"nextDisabled":true,"thisWeekDisabled":true,"prevDisabled":false})
- ✅ today's column is highlighted in light indigo (header and cells) ({"count":1,"text":"Wed 28","headerBg":"oklch(0.962 0.018 272.314)","cellBg":"oklch(0.962 0.018 272.314)","cellText":"15m","otherCellBg":"rgba(0, 0, 0, 0)"})
- ✅ ...and today's 15 minutes show in it (15m)
- ✅ a link with ?week=2026-03-10 (not a Monday) shows the current week and fixes the URL (2026-10-26)
- ✅ a link with ?week=2099-01-05 (in the future) shows the current week and fixes the URL (2026-10-26)
- ✅ a link with ?week=banana (not a date) shows the current week and fixes the URL (2026-10-26)
- ✅ clicking a cell opens /time-entries with the project and the day in the URL (?projectId=6ae1eb13a4a625db9e153182&from=2026-03-09&to=2026-03-09&overlap=1)
- ✅ Time entries starts with those filters already set (Custom range, that day, that project) ({"preset":"custom","from":"2026-03-09","to":"2026-03-09","project":"Website"})
- ✅ ...and asks for that day in India time, for that project ({"from":"2026-03-08T18:30:00.000Z","to":"2026-03-09T18:30:00.000Z","projectId":"6ae1eb13a4a625db9e153182","overlap":"true"})
- ✅ the list shows exactly that entry (Homepage, 09:00–11:00, 2h) (Website · Acme Corp Homepage 09:00–11:00 Billable 2h)
- ✅ Tuesday's cell (1h): the list shows the entry that crosses midnight (23:00–01:00) (Website · Acme Corp Late night deploy 23:00–01:00 (+1 day) Billable 2h)
- ✅ Wednesday's cell (1h): the list shows the entry that crosses midnight (23:00–01:00) (Website · Acme Corp Late night deploy 23:00–01:00 (+1 day) Billable 2h)
- ✅ changing the date range on that page drops the "overlap" matching
- ✅ Time entries ignores malformed filter parameters in the URL ({"preset":"this-week","project":"","status":"all"})
- ✅ Dashboard: a "This week" card with the week's total hours (15m) and a "View timesheet" link ({"title":"This week","total":"15m","link":"View timesheet","href":"/timesheet","side":true,"sameRow":true})
- ✅ ...placed next to the Today list on a wide screen ([true,true])
- ✅ "View timesheet" opens the timesheet
- ✅ an empty week hides the grid and the summary cards
- ✅ "Go to Dashboard" opens the dashboard
- ✅ a device in New York: the page shows "Times shown in America/New_York"
- ✅ the DST week (2 – 8 Mar 2026): Sunday 8 March has 23 hours, not 24 (["—","—","—","—","—","—","23h","23h"])
- ✅ ...and the 24th hour is Monday 00:00-01:00 in the next week (["1h","—","—","—","—","—","—","1h"])
- ✅ phone: no wide table, one card per day (7)
- ✅ phone: Wednesday card shows its total and the projects with their hours (Wed 11 1h 30m App Acme Corp 30m Website Acme Corp 1h)
- ✅ phone: a day without time says "No time tracked" (Thu 12 — No time tracked)
- ✅ phone: the entry across midnight shows on both Tuesday and Wednesday
- ✅ phone: no horizontal scroll, the navigator and cards fit in 375px (overflow=0 navRight=340.765625)
- ✅ phone: the summary cards are there (9h, 7h 30m, $410.00) (total hours 9h | billable hours 7h 30m | billable amount $410.00)
- ✅ phone: tapping a project in a day card also opens Time entries for that day
- ✅ phone: the dashboard "This week" card shows and nothing scrolls sideways
- ✅ tablet (768px): day cards, no sideways scroll
- ✅ small laptop (1024px): the grid shows and fits without sideways scroll ({"visible":true,"fits":true})
- ✅ isolated: no request went to the dev servers on 5000/5173
- ✅ no unexpected console/page errors

## Browser checks, Step 7: invoices (85)

Script: [test-code/browser/step-7-invoices.mjs](test-code/browser/step-7-invoices.mjs). Raw output: [results/browser-checks-step-7-invoices.txt](results/browser-checks-step-7-invoices.txt).

- ✅ Invoices: header "Invoices" with a "New invoice" button
- ✅ empty state "Create your first invoice" with a button
- ✅ summary cards start at Outstanding $0.00, Paid $0.00, Invoices 0 (outstanding $0.00 | paid $0.00 | invoices 0)
- ✅ the status filter is hidden while there are no invoices
- ✅ "New invoice" opens the modal with a client select, quick picks, dates and notes
- ✅ it starts on "This month" (the 1st up to today) ({"from":"2026-10-01","to":"2026-10-28","pressed":"This month"})
- ✅ "Create invoice" is disabled until there is something to bill
- ✅ ...and the preview asks for a client first
- ✅ quick pick "Last week" fills 2026-10-19 to 2026-10-25 ({"from":"2026-10-19","to":"2026-10-25"})
- ✅ quick pick "Last month" fills 2026-09-01 to 2026-09-30 ({"from":"2026-09-01","to":"2026-09-30"})
- ✅ quick pick "This month" fills 2026-10-01 to 2026-10-28 ({"from":"2026-10-01","to":"2026-10-28"})
- ✅ typing a date switches the quick pick to "Custom"
- ✅ the end date cannot be picked after today (2026-10-28)
- ✅ a client with its own unbilled time previews only that (Brand 1.00 h x $80.00 = $80.00) (Brand 1.00 h × $80.00 $80.00 1 entry · 9 – 13 Mar 2026 $80.00)
- ✅ Acme preview: line items with hours, rate and amount, entry count and total (App 1.50 h × $60.00 $90.00 Website 2.78 h × $50.00 $138.89 4 entries · 9 – 13 Mar 2026 $228.89)
- ✅ ...with the total $228.89 (non-billable, other client, outside the period and the 23:30 edge handled)
- ✅ ...and "Create invoice" is enabled
- ✅ creating shows the toast "Invoice INV-0001 created"
- ✅ ...and opens the invoice page
- ✅ invoice page: logo, "INVOICE", number INV-0001 and a Draft badge (INV-0001 Draft)
- ✅ From (the user) and Bill to (name, company, email)
- ✅ issue date is today and the due date is 14 days later (India time) (TimeLedger INVOICE INV-0001 Draft FROM Priya s7-priya-1793190693888@example.com BILL TO Acme Corp Acme Inc billing@acme.com ISSUE DATE 28 Oct 2026 DUE DATE 11 Nov 2026 PERIOD 9 – 13 Mar 2026 PROJECT HOURS RATE AMOUNT App 1.50 $60.00 $90.00 Website 2.78 $50.00 $138.89 Subtotal $228.89 Total $228.89 N)
- ✅ period "9 – 13 Mar 2026"
- ✅ line items table: Project, Hours, Rate, Amount (project | hours | rate | amount)
- ✅ ...App 1.50 / $60.00 / $90.00 and Website 2.78 / $50.00 / $138.89 ([["App","1.50","$60.00","$90.00"],["Website","2.78","$50.00","$138.89"]])
- ✅ subtotal and total $228.89
- ✅ notes are at the bottom
- ✅ actions: Back, Print / Save as PDF, Mark as sent, Mark as paid, Delete (a draft) (Back | Print / Save as PDF | Mark as sent | Mark as paid | Delete)
- ✅ the paper is a white card
- ✅ Draft badge is slate (oklch(0.372 0.044 257.287))
- ✅ "Time entries included (4)" is collapsed at first ({"open":false,"summary":"Time entries included (4)"})
- ✅ ...opening it lists the 4 entries in time order (date, project, description, duration), including the 23:30 one on 13 March (9 Mar 2026 Website Homepage 2h | 10 Mar 2026 App App review 1h 30m | 12 Mar 2026 Website Quick fix 16m | 13 Mar 2026 Website Late deploy 30m)
- ✅ the "Invoices" sidebar item stays highlighted on the invoice page
- ✅ billing the same period again: the preview says there is nothing to bill (No unbilled billable time for this client in this period)
- ✅ ...and "Create invoice" stays disabled
- ✅ API: creating it again is refused with the same 400
- ✅ Time entries: the 4 invoiced entries show a "Billed" badge (4)
- ✅ ...and the others are still billable / non-billable (Website · Acme Corp Not billable 09:00–10:00 Non-billable 1h | Brand · Zeta Ltd Other client 14:00–15:00 Billable 1h)
- ✅ the Billed badge links to its invoice (/invoices/6ae1eb2ba4a625db9e1531a3)
- ✅ ...and clicking it opens that invoice
- ✅ both tabs see the same preview ($270.00, 3 entries) (App 2.00 h × $60.00 $120.00 Website 3.00 h × $50.00 $150.00 3 entries · 16 – 20 Mar 2026 $270.00 || App 2.00 h × $60.00 $120.00 Website 3.00 h × $50.00 $150.00 3 entries · 16 – 20 Mar 2026 $270.00)
- ✅ exactly ONE of the two tabs got an invoice (/invoices / /invoices/6ae1eb35a4a625db9e1531a6)
- ✅ the other tab is told there is nothing left to bill, and stays on the form
- ✅ ...with "Create invoice" disabled again
- ✅ server: only one invoice exists for that period (INV-0002), not two (INV-0002,INV-0001)
- ✅ server: all 3 entries are on that one invoice
- ✅ API: 6 simultaneous requests for the same period give one 201 and five 400 (201,400,400,400,400,400)
- ✅ API: all 3 entries are on that single invoice and it lists exactly those ids
- ✅ API: the invoice numbers are INV-0001, INV-0002, INV-0003 with no gaps or repeats
- ✅ Mark as sent: toast, "Sent" badge, and the Mark as sent / Delete buttons go away
- ✅ the Sent badge is amber and the page shows the sent date
- ✅ the line items are still there after the status change
- ✅ Mark as paid: toast, "Paid" badge in emerald, no more status buttons
- ✅ ...emerald colour and a paid date
- ✅ API: a paid invoice cannot go back (409 "Can't change status from paid to sent") or be deleted (409)
- ✅ after the project rate (50 -> 99) and the client name/email changed, the old invoice is exactly the same (App|1.50|$60.00|$90.00 ; Website|2.78|$50.00|$138.89)
- ✅ list: 3 invoices, newest first, each with number, client, period, issued date, total and status (INV-0003 Acme Corp 6 – 10 Apr 2026 · issued 28 Oct 2026 $300.00 Draft || INV-0002 Acme Corp 16 – 20 Mar 2026 · issued 28 Oct 2026 $270.00 Draft || INV-0001 Acme Corp 9 – 13 Mar 2026 · issued 28 Oct 2026 $228.89 Paid)
- ✅ badge colours: Paid emerald, Draft slate; amounts in JetBrains Mono ({"paid":"oklch(0.508 0.118 165.612)","draft":"oklch(0.372 0.044 257.287)","mono":"\"JetBrains Mono\", ui-monospace, SFMono-Regular, monospace"})
- ✅ summary: Outstanding $570.00 (the two drafts), Paid $228.89, Invoices 3 (outstanding $570.00 | paid $228.89 | invoices 3)
- ✅ status filter: All, Draft, Sent, Paid
- ✅ filter "Draft" shows the 2 drafts, but the cards still cover everything
- ✅ filter "Paid" shows INV-0001 only
- ✅ filter "Sent" with none shows an empty state
- ✅ Delete asks for confirmation and explains the entries become unbilled (Delete invoice? INV-0002 will be deleted and its 3 time entries become unbilled again, so you can invoice them later. Cancel Delete)
- ✅ Cancel keeps it
- ✅ confirming deletes it: toast, back to the list
- ✅ server: its 3 entries are unbilled again (and can be edited again)
- ✅ the freed entries show up in a new preview again
- ✅ a new invoice for them gets INV-0004: the number of the deleted one is not reused
- ✅ print: the sidebar, top bar, bottom bar, action buttons and the entry list are hidden (["none","none","none","none","none"])
- ✅ print: white background, no leftover sidebar space, no border or shadow (["rgb(255, 255, 255)","0px","0px","rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px"])
- ✅ print: the invoice fills the page width and nothing is cut off at the sides ([0,794,794,0])
- ✅ print: the line items show as a table (not the stacked phone layout)
- ✅ print: a real PDF was produced (A4 size 595 x 842 pt, one page for this invoice) ({"pages":1,"width":594.95996,"height":841.91998,"isPdf":true,"bytes":122389})
- ✅ print: an invoice with 36 projects runs over several pages (nothing cut off) and still fits the width (3 pages, 36 lines)
- ✅ another user opening my invoice sees "Invoice not found" (and none of my data)
- ✅ ...and their own list is empty
- ✅ a malformed invoice id also shows "Invoice not found"
- ✅ phone: the invoice list has no horizontal scroll (overflow=0)
- ✅ phone: every invoice row fits and shows its total and status
- ✅ phone: the new-invoice modal fits the screen without sideways scroll ({"left":16,"right":359,"top":33.34375,"bottom":633.640625})
- ✅ phone: the line items become stacked rows (project, amount, hours × rate) (App $90.00 1.50 h × $60.00 Website $138.89 2.78 h × $50.00)
- ✅ phone: the invoice page has no horizontal scroll and the buttons fit (overflow=0 paper=359 actions=300.921875)
- ✅ isolated: no request went to the dev servers on 5000/5173
- ✅ no unexpected console/page errors

## Browser checks, Step 8: demo seed data, rounding, settings (63)

Script: [test-code/browser/step-8-seed-and-rounding.mjs](test-code/browser/step-8-seed-and-rounding.mjs). Raw output: [results/browser-checks-step-8-seed-and-rounding.txt](results/browser-checks-step-8-seed-and-rounding.txt). The script runs the real `npm run seed` command (output: [results/seed-cli-output.txt](results/seed-cli-output.txt)) and works out the expected invoice amounts itself from the raw entries and the project rates, so they are not just compared with the app's own numbers.

- ✅ npm run seed: exits cleanly and prints what it created (MongoDB connected: 127.0.0.1 | Demo data created for Alex Morgan (demo@timeledger.app, Asia/Kolkata, USD) |   Clients:   3)
- ✅ npm run seed again: exactly the same summary (safe to run many times)
- ✅ NODE_ENV=production refuses to seed unless SEED_ALLOW=true (Seed failed: Refusing to seed: NODE_ENV is "production". Set SEED_ALLOW=true if you really mean it.)
- ✅ the demo login works through the API (demo@timeledger.app / Demo@1234)
- ✅ the demo data: 3 clients, 4 projects with the rates from the brief
- ✅ the client names are Acme Corp, Globex Ltd and Initech
- ✅ about four weeks of entries, weekdays only, up to today (69 entries from 2026-09-28)
- ✅ 2-4 entries on every full weekday, each 30 minutes to 3 hours (22233323442233444442233)
- ✅ mostly billable, a few non-billable, one entry that crosses midnight, none in the future
- ✅ no running timer
- ✅ two invoices made by the real invoice service: INV-0001 Globex PAID (4 weeks ago), INV-0002 Acme SENT (3 to 2 weeks ago)
- ✅ the last two weeks are left unbilled (so a reviewer can invoice them right away)
- ✅ every billed entry is billable and claimed by exactly one of the two invoices
- ✅ logging in as demo@timeledger.app / Demo@1234 opens the dashboard for Alex Morgan
- ✅ Dashboard: the "This week" card shows this week's tracked time (9h 44m vs 9h 44m)
- ✅ Dashboard: nothing is running (a Start button, no clock) and the sidebar shows the name
- ✅ Timesheet (last week): a row per project, and the total hours match the entries (total hours 22h 53m vs 22h 53m)
- ✅ Time entries (all four weeks): every entry of INV-0001 and INV-0002 has a "Billed" badge that links to its own invoice (31 badges)
- ✅ ...every entry is listed and the non-billable ones are labelled (69 entries, 4 non-billable)
- ✅ Invoices: INV-0002 (Acme, Sent) above INV-0001 (Globex, Paid) with their totals (INV-0002 Acme Corp 5 – 18 Oct 2026 · issued 19 Oct 2026 $1,344.75 Sent || INV-0001 Globex Ltd 28 Sept – 4 Oct 2026 · issued 5 Oct 2026 $1,420.00 Paid)
- ✅ Invoices: Outstanding = the sent invoice, Paid = the paid one, 2 invoices (outstanding $1,344.75 | paid $1,420.00 | invoices 2)
- ✅ INV-0002: from Alex Morgan to Acme Corp, status Sent, total as listed, thank-you note, no rounding note
- ✅ the sidebar has a Settings item (gear) that opens /settings and stays highlighted
- ✅ Settings: Name is filled in, Time zone is Asia/Kolkata and read-only, rounding is off, Save is disabled until something changes ({"name":"Alex Morgan","timezone":"Asia/Kolkata","timezoneReadOnly":true,"on":false,"saveDisabled":true})
- ✅ Settings: the toggle is labelled "Round each entry up to 15 minutes"
- ✅ typing a different name enables Save
- ✅ a one-letter name is refused with the server's message under the field, and nothing changes
- ✅ a valid name is saved: toast, and the sidebar shows it straight away
- ✅ ...and it is still there after a reload
- ✅ Rounding off: the Initech preview bills exactly what was tracked (6 entries, $602.25) (API integration 10.95 h × $55.00 $602.25 6 entries · 28 Sept – 28 Oct 2026 $602.25)
- ✅ ...and there is no rounding note
- ✅ toggling the switch enables Save
- ✅ Save: toast "Settings saved"
- ✅ ...and the rule is still on after a reload (saved on the server)
- ✅ Rounding on: the preview says "Rounded up to 15 min per entry" and shows the tracked and billed time (API integration 11.50 h × $55.00 $632.50 Rounded up to 15 min per entry: 10h 57m tracked, 11h 30m billed 6 entries · 28 Sept – 28 Oct 2026 $632.50)
- ✅ ...with the amounts worked out per entry: $632.50 instead of $602.25 (API integration 11.50 h × $55.00 $632.50 Rounded up to 15 min per entry: 10h 57m tracked, 11h 30m billed 6 entries · 28 Sept – 28 Oct 2026 $632.50)
- ✅ creating it: toast "Invoice INV-0003 created" and the invoice page opens
- ✅ INV-0003 shows "Rounded up to 15 min per entry", the billed hours and the rounded total ([["API integration","11.50","$55.00","$632.50"]])
- ✅ the entry list shows tracked → billed for the entries that were rounded (4 of 6) (4 arrows)
- ✅ ...e.g. "2h 52m → 3h"
- ✅ the entries themselves are untouched: every tracked duration is exactly what it was
- ✅ rounding switched off again
- ✅ INV-0003 is unchanged after switching the rule off: same note, same total
- ✅ INV-0001 (made before) has no rounding note and its total is unchanged
- ✅ Rounding off again: an Acme invoice for the unbilled time is exactly as tracked (15 entries, $1,361.50; the billed INV-0002 entries are not in it) (Mobile app 18.07 h × $60.00 $1,084.00 Website redesign 6.17 h × $45.00 $277.50 15 entries · 28 Sept – 28 Oct 2026 $1,361.50)
- ✅ Print view of INV-0003: the sidebar is gone and the rounding note is part of the printed page
- ✅ npm run seed once more (with an extra invoice and rounding switched on): same clients, projects and invoices again
- ✅ the extra invoice INV-0003 is gone and numbering starts again at INV-0001/INV-0002
- ✅ the demo user is the same one (the session still works) and rounding is reset to off
- ✅ in the browser: still logged in after the re-seed, with the two seeded invoices
- ✅ Phone: the top bar has a Settings gear next to Log out, both inside the screen ({"gear":{"left":287,"right":323,"width":36},"logout":{"left":323,"right":359,"width":36},"bottomTabs":6})
- ✅ Phone: the bottom tab bar keeps its six tabs (no cramped seventh)
- ✅ Phone: the dashboard fits the screen: no horizontal scroll and no card wider than 375px (0 elements past the edge)
- ✅ Phone: the gear opens Settings, which fits the screen and shows the toggle (overflow=0)
- ✅ a timer can be started on the demo user (a reviewer does exactly this)
- ✅ Phone 375px, timer running: logo, clock, gear and Log out are in this order, don't overlap and stay on screen ({"logo":{"left":16,"right":137.96875},"mini":{"left":147.796875,"right":287},"gear":{"left":287,"right":323},"logout":{"left":323,"right":359}})
- ✅ Phone 375px, timer running: the dashboard cards (running timer, This week, Today) fit the screen (0 elements past the edge)
- ✅ Phone 360px, timer running: logo, clock, gear and Log out are in this order, don't overlap and stay on screen ({"logo":{"left":16,"right":137.96875},"mini":{"left":137.96875,"right":277.171875},"gear":{"left":277.171875,"right":313.171875},"logout":{"left":313.171875,"right":349.171875}})
- ✅ Phone 360px, timer running: the dashboard cards (running timer, This week, Today) fit the screen (0 elements past the edge)
- ✅ Phone: the demo invoice has no horizontal scroll and stacks its lines
- ✅ Phone: the demo timesheet shows one card per day without sideways scrolling
- ✅ isolated: no request went to the dev servers on 5000/5173
- ✅ no unexpected console/page errors

## Screenshots, Step 2: authentication

**Login page (desktop)**

![Login page (desktop)](screenshots/step-2-auth/01-login-desktop.png)

**Register: server validation errors shown under each field**

![Register: server validation errors shown under each field](screenshots/step-2-auth/02-register-errors-desktop.png)

**Dashboard right after registering (new sidebar layout)**

![Dashboard right after registering (new sidebar layout)](screenshots/step-2-auth/03-dashboard-desktop.png)

**Login: wrong password shows a toast and stays on /login**

![Login: wrong password shows a toast and stays on /login](screenshots/step-2-auth/04-login-toast-desktop.png)

**Login: button shows a spinner and is disabled while the request runs**

![Login: button shows a spinner and is disabled while the request runs](screenshots/step-2-auth/05-login-loading-desktop.png)

**Login on a 375px phone**

![Login on a 375px phone](screenshots/step-2-auth/06-login-mobile.png)

**Register errors on a 375px phone**

![Register errors on a 375px phone](screenshots/step-2-auth/07-register-errors-mobile.png)

**Dashboard (desktop) while logged in, before the second logout**

![Dashboard (desktop) while logged in, before the second logout](screenshots/step-2-auth/08-dashboard-before-second-logout.png)

## Screenshots, Step 3: layout, clients, projects

**App layout: fixed indigo-950 sidebar, active item highlighted, user + logout at the bottom**

![App layout: fixed indigo-950 sidebar, active item highlighted, user + logout at the bottom](screenshots/step-3-layout-clients-projects/01-dashboard-desktop.png)

**Clients: empty state**

![Clients: empty state](screenshots/step-3-layout-clients-projects/02-clients-empty-desktop.png)

**Add client modal with a validation error under Email**

![Add client modal with a validation error under Email](screenshots/step-3-layout-clients-projects/03-client-modal-errors-desktop.png)

**Clients list with project count, company and email (success toast on top)**

![Clients list with project count, company and email (success toast on top)](screenshots/step-3-layout-clients-projects/04-clients-list-desktop.png)

**Projects: empty state**

![Projects: empty state](screenshots/step-3-layout-clients-projects/05-projects-empty-desktop.png)

**Add project modal: name, client, hourly rate, 6 color presets**

![Add project modal: name, client, hourly rate, 6 color presets](screenshots/step-3-layout-clients-projects/06-project-modal-desktop.png)

**Projects filtered by client, rates in JetBrains Mono**

![Projects filtered by client, rates in JetBrains Mono](screenshots/step-3-layout-clients-projects/07-projects-filtered-desktop.png)

**Delete confirm dialog**

![Delete confirm dialog](screenshots/step-3-layout-clients-projects/08-confirm-dialog-desktop.png)

**Invoices page, empty state (it was a "Coming soon" placeholder in this step, built in Step 7)**

![Invoices page, empty state (it was a "Coming soon" placeholder in this step, built in Step 7)](screenshots/step-3-layout-clients-projects/09-invoices-empty-desktop.png)

**Projects on a 375px phone: top bar + bottom tab bar**

![Projects on a 375px phone: top bar + bottom tab bar](screenshots/step-3-layout-clients-projects/10-projects-mobile.png)

**Clients on a 375px phone**

![Clients on a 375px phone](screenshots/step-3-layout-clients-projects/11-clients-mobile.png)

**Client modal on a phone**

![Client modal on a phone](screenshots/step-3-layout-clients-projects/12-client-modal-mobile.png)

**Project modal on a phone**

![Project modal on a phone](screenshots/step-3-layout-clients-projects/13-project-modal-mobile.png)

## Screenshots, Step 4: timer

**Timer card, idle: description, project, Billable switch and a big Start button**

![Timer card, idle: description, project, Billable switch and a big Start button](screenshots/step-4-timer/01-idle-desktop.png)

**Project dropdown grouped by client, each project with its color dot**

![Project dropdown grouped by client, each project with its color dot](screenshots/step-4-timer/02-project-dropdown-desktop.png)

**Running: indigo card with the big HH:MM:SS clock, editable description and a white Stop button (mini timer in the sidebar)**

![Running: indigo card with the big HH:MM:SS clock, editable description and a white Stop button (mini timer in the sidebar)](screenshots/step-4-timer/03-running-desktop.png)

**The mini timer (pulsing dot, time, stop icon) stays in the sidebar on every page**

![The mini timer (pulsing dot, time, stop icon) stays in the sidebar on every page](screenshots/step-4-timer/04-mini-timer-on-clients-desktop.png)

**After Stop: the entry shows up under "Today" with its duration and the day total**

![After Stop: the entry shows up under "Today" with its duration and the day total](screenshots/step-4-timer/05-after-stop-today-desktop.png)

**Starting a second timer from another tab: the server answers "A timer is already running. Stop it first."**

![Starting a second timer from another tab: the server answers "A timer is already running. Stop it first."](screenshots/step-4-timer/06-second-timer-409-desktop.png)

**"Create a project first" when there are no projects yet**

!["Create a project first" when there are no projects yet](screenshots/step-4-timer/07-no-projects-desktop.png)

**Idle timer on a 375px phone**

![Idle timer on a 375px phone](screenshots/step-4-timer/08-idle-mobile.png)

**Project dropdown on a phone**

![Project dropdown on a phone](screenshots/step-4-timer/09-dropdown-mobile.png)

**Running on a phone: mini timer in the top bar, Today list below**

![Running on a phone: mini timer in the top bar, Today list below](screenshots/step-4-timer/10-running-mobile.png)

## Screenshots, Step 5: time entries

**Time entries: filters, summary cards (total, billable, unbilled amount) and entries grouped by day with badges**

![Time entries: filters, summary cards (total, billable, unbilled amount) and entries grouped by day with badges](screenshots/step-5-time-entries/01-time-entries-desktop.png)

**Status filter "Billed": an entry on an invoice shows a lock instead of edit/delete**

![Status filter "Billed": an entry on an invoice shows a lock instead of edit/delete](screenshots/step-5-time-entries/02-filter-billed-desktop.png)

**Empty state: "No time entries yet" with an Add entry button**

![Empty state: "No time entries yet" with an Add entry button](screenshots/step-5-time-entries/03-empty-state-desktop.png)

**Add entry: an end time before the start time shows the live duration and "ends next day"**

![Add entry: an end time before the start time shows the live duration and "ends next day"](screenshots/step-5-time-entries/04-add-entry-ends-next-day-desktop.png)

**The server's rule "End time can't be in the future" shown under the End time field**

![The server's rule "End time can't be in the future" shown under the End time field](screenshots/step-5-time-entries/05-add-entry-server-error-desktop.png)

**Edit entry: the form is filled with the entry's project, date, times and billable setting**

![Edit entry: the form is filled with the entry's project, date, times and billable setting](screenshots/step-5-time-entries/06-edit-entry-desktop.png)

**Delete confirmation for a time entry**

![Delete confirmation for a time entry](screenshots/step-5-time-entries/07-delete-confirm-desktop.png)

**Dashboard "Today": the pencil opens the same edit modal**

![Dashboard "Today": the pencil opens the same edit modal](screenshots/step-5-time-entries/08-dashboard-edit-desktop.png)

**Phone (375px): filters collapsed behind a "Filters" button**

![Phone (375px): filters collapsed behind a "Filters" button](screenshots/step-5-time-entries/09-mobile-collapsed-filters.png)

**Phone: filters open; the button shows how many are on**

![Phone: filters open; the button shows how many are on](screenshots/step-5-time-entries/10-mobile-filters-open.png)

**Phone: summary cards and entries without sideways scrolling**

![Phone: summary cards and entries without sideways scrolling](screenshots/step-5-time-entries/11-mobile-list.png)

**Phone: the add entry modal fits the screen**

![Phone: the add entry modal fits the screen](screenshots/step-5-time-entries/12-mobile-entry-modal.png)

## Screenshots, Step 6: timesheet

**Timesheet for 9 – 15 Mar 2026: summary cards, a row per project, a column per day, daily totals; weekend columns muted**

![Timesheet for 9 – 15 Mar 2026: summary cards, a row per project, a column per day, daily totals; weekend columns muted](screenshots/step-6-timesheet/01-timesheet-desktop.png)

**A week without time: "No time tracked this week" with a Go to Dashboard button**

![A week without time: "No time tracked this week" with a Go to Dashboard button](screenshots/step-6-timesheet/02-timesheet-empty-week-desktop.png)

**The current week: today's column is highlighted, "Next" and "This week" are disabled**

![The current week: today's column is highlighted, "Next" and "This week" are disabled](screenshots/step-6-timesheet/03-timesheet-current-week-desktop.png)

**Clicking Wednesday's cell opens Time entries with that project and day already filtered, including the entry that started Tuesday night**

![Clicking Wednesday's cell opens Time entries with that project and day already filtered, including the entry that started Tuesday night](screenshots/step-6-timesheet/04-cell-click-time-entries-desktop.png)

**Dashboard: the "This week" card next to today's list, with a View timesheet link**

![Dashboard: the "This week" card next to today's list, with a View timesheet link](screenshots/step-6-timesheet/05-dashboard-this-week-card-desktop.png)

**A device in New York, the week daylight saving starts: Sunday 8 March shows 23h, not 24h**

![A device in New York, the week daylight saving starts: Sunday 8 March shows 23h, not 24h](screenshots/step-6-timesheet/06-timesheet-dst-week-new-york-desktop.png)

**Phone (375px): the week navigator, summary cards and the first day card**

![Phone (375px): the week navigator, summary cards and the first day card](screenshots/step-6-timesheet/07-timesheet-mobile-top.png)

**Phone: one card per day (Mon to Sun) with its projects and hours**

![Phone: one card per day (Mon to Sun) with its projects and hours](screenshots/step-6-timesheet/08-timesheet-mobile-full.png)

**Tablet (768px): day cards instead of a cramped table**

![Tablet (768px): day cards instead of a cramped table](screenshots/step-6-timesheet/09-timesheet-tablet.png)

## Screenshots, Step 7: invoices

Printed as PDF: [sample-pdfs/invoice-INV-0001.pdf](sample-pdfs/invoice-INV-0001.pdf) and [sample-pdfs/invoice-long-36-projects.pdf](sample-pdfs/invoice-long-36-projects.pdf).

**Invoices, empty: summary cards at zero and "Create your first invoice"**

![Invoices, empty: summary cards at zero and "Create your first invoice"](screenshots/step-7-invoices/01-invoices-empty-desktop.png)

**New invoice: client, quick date picks, notes and a live preview of exactly what will be billed (4 entries, $228.89)**

![New invoice: client, quick date picks, notes and a live preview of exactly what will be billed (4 entries, $228.89)](screenshots/step-7-invoices/02-new-invoice-modal-desktop.png)

**The invoice page (a white A4-style paper): From / Bill to, dates, line items per project, total and notes, with the entries it contains below**

![The invoice page (a white A4-style paper): From / Bill to, dates, line items per project, total and notes, with the entries it contains below](screenshots/step-7-invoices/03-invoice-detail-desktop.png)

**Two tabs pressed "Create invoice" at the same moment: the one that lost is told "No unbilled billable time for this client in this period"**

![Two tabs pressed "Create invoice" at the same moment: the one that lost is told "No unbilled billable time for this client in this period"](screenshots/step-7-invoices/04-second-tab-nothing-to-bill-desktop.png)

**Invoices list: Outstanding / Paid / count cards, status filter, number, client, period, total and a Draft / Sent / Paid badge**

![Invoices list: Outstanding / Paid / count cards, status filter, number, client, period, total and a Draft / Sent / Paid badge](screenshots/step-7-invoices/05-invoices-list-desktop.png)

**Deleting a draft asks first and says its time entries become unbilled again**

![Deleting a draft asks first and says its time entries become unbilled again](screenshots/step-7-invoices/06-delete-invoice-confirm-desktop.png)

**The page as printed (print media, A4 width): sidebar, bars and buttons gone, only the invoice**

![The page as printed (print media, A4 width): sidebar, bars and buttons gone, only the invoice](screenshots/step-7-invoices/07-invoice-print-preview.png)

**Phone (375px): invoice list without sideways scrolling**

![Phone (375px): invoice list without sideways scrolling](screenshots/step-7-invoices/08-invoices-list-mobile.png)

**Phone: the New invoice modal with its preview fits the screen**

![Phone: the New invoice modal with its preview fits the screen](screenshots/step-7-invoices/09-new-invoice-modal-mobile.png)

**Phone: the invoice page, top of the page with its action buttons**

![Phone: the invoice page, top of the page with its action buttons](screenshots/step-7-invoices/10-invoice-detail-mobile-top.png)

**Phone: the whole invoice; line items become stacked rows (project and amount, hours × rate below)**

![Phone: the whole invoice; line items become stacked rows (project and amount, hours × rate below)](screenshots/step-7-invoices/11-invoice-detail-mobile-full.png)

**Time entries: invoiced entries show a "Billed" badge (a link to the invoice) and a lock instead of edit/delete**

![Time entries: invoiced entries show a "Billed" badge (a link to the invoice) and a lock instead of edit/delete](screenshots/step-7-invoices/12-time-entries-billed-badges-desktop.png)

## Screenshots, Step 8: demo seed data, rounding, settings

**The demo user (Alex Morgan) right after logging in: nothing running, today's entries and the This week card**

![The demo user (Alex Morgan) right after logging in: nothing running, today's entries and the This week card](screenshots/step-8-seed-and-rounding/01-demo-dashboard-desktop.png)

**Demo data: last week's timesheet, a row per project (it includes the late-night release that crosses midnight)**

![Demo data: last week's timesheet, a row per project (it includes the late-night release that crosses midnight)](screenshots/step-8-seed-and-rounding/02-demo-timesheet-desktop.png)

**Demo data: time entries over the four weeks, with the totals and the $3,494.42 that is unbilled and ready to invoice**

![Demo data: time entries over the four weeks, with the totals and the $3,494.42 that is unbilled and ready to invoice](screenshots/step-8-seed-and-rounding/03-demo-time-entries-desktop.png)

**Demo data: a PAID invoice for Globex and a SENT invoice for Acme, both made by the real invoice service**

![Demo data: a PAID invoice for Globex and a SENT invoice for Acme, both made by the real invoice service](screenshots/step-8-seed-and-rounding/04-demo-invoices-desktop.png)

**The SENT invoice for Acme (INV-0002)**

![The SENT invoice for Acme (INV-0002)](screenshots/step-8-seed-and-rounding/05-demo-invoice-sent-desktop.png)

**Settings: name, time zone (read-only) and the rounding switch, off by default**

![Settings: name, time zone (read-only) and the rounding switch, off by default](screenshots/step-8-seed-and-rounding/06-settings-desktop.png)

**Settings: a one-letter name is refused with the server's message under the field**

![Settings: a one-letter name is refused with the server's message under the field](screenshots/step-8-seed-and-rounding/07-settings-name-error-desktop.png)

**Settings after switching "Round each entry up to 15 minutes" on and saving**

![Settings after switching "Round each entry up to 15 minutes" on and saving](screenshots/step-8-seed-and-rounding/08-settings-rounding-on-desktop.png)

**New invoice with rounding on: "Rounded up to 15 min per entry: 10h 57m tracked, 11h 30m billed", and the total worked out per entry**

![New invoice with rounding on: "Rounded up to 15 min per entry: 10h 57m tracked, 11h 30m billed", and the total worked out per entry](screenshots/step-8-seed-and-rounding/09-new-invoice-rounding-preview-desktop.png)

**The invoice made with rounding on: billed hours, the rounding note on the paper, and the entry list below**

![The invoice made with rounding on: billed hours, the rounding note on the paper, and the entry list below](screenshots/step-8-seed-and-rounding/10-invoice-rounded-desktop.png)

**Phone (375px): the demo dashboard, with the new Settings gear next to Log out**

![Phone (375px): the demo dashboard, with the new Settings gear next to Log out](screenshots/step-8-seed-and-rounding/11-demo-dashboard-mobile.png)

**Phone: Settings opened from the gear in the top bar**

![Phone: Settings opened from the gear in the top bar](screenshots/step-8-seed-and-rounding/12-settings-mobile.png)

**Phone: the demo invoice with stacked line items**

![Phone: the demo invoice with stacked line items](screenshots/step-8-seed-and-rounding/13-demo-invoice-mobile.png)

**Phone: the demo timesheet, one card per day**

![Phone: the demo timesheet, one card per day](screenshots/step-8-seed-and-rounding/14-demo-timesheet-mobile.png)

**Phone: with a timer running, the top bar holds the logo, the clock, Settings and Log out, and the dashboard cards fit the screen**

![Phone: with a timer running, the top bar holds the logo, the clock, Settings and Log out, and the dashboard cards fit the screen](screenshots/step-8-seed-and-rounding/15-running-timer-top-bar-mobile.png)

## Re-running the browser checks

The scripts in [test-code/browser/](test-code/browser) are a snapshot of what was run. To run them again you need Microsoft Edge (the path is set at the top of each script) and `npm install puppeteer-core` next to them. Then:

1. Build the frontend for the test ports and serve it: set `VITE_API_URL=http://localhost:5100/api`, run `npm run build -- --outDir <some folder> --emptyOutDir` in `frontend/`, then `npm run preview -- --outDir <some folder> --port 5273 --strictPort`.
2. From `backend/`, run `node <path to>/start-isolated-backend.mjs` (in-memory database, as a replica set, port 5100).
3. Run `node step-2-auth.mjs`, `node step-3-layout-clients-projects.mjs`, `node step-4-timer.mjs`, `node step-5-time-entries.mjs`, `node step-6-timesheet.mjs`, `node step-7-invoices.mjs` and `node step-8-seed-and-rounding.mjs`. (Steps 5 and 8 also need the in-memory database's address: start the backend with the environment variable `E2E_MONGO_URI_FILE` set to a file path; the script reads the address from that file.) Each prints PASS/FAIL per check and writes its screenshots next to the script.
