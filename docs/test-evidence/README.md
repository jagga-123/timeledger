# TimeLedger: test evidence (Steps 1-5)

Everything that was run to check the app, in one folder: the results, every screenshot, and the test code itself. Generated 2026-10-27 17:38.

## Start here

| Open this | To see |
| --- | --- |
| [test-report.html](test-report.html) | The whole report in one page: summary, every test, all screenshots (click one to zoom). Double-click it to open in a browser. |
| [screenshots/](screenshots) | 43 screenshots taken by the browser tests, as separate PNG files. |
| [results/](results) | The raw output of each test run (text and JSON). |
| [test-code/](test-code) | The test files that were run. |

## Summary

| Check | Result |
| --- | --- |
| Backend tests (Jest + Supertest) | **83/83 passed** |
| Browser checks, Step 2 (auth) | **29/29 passed** |
| Browser checks, Step 3 (layout, clients, projects) | **63/63 passed** |
| Browser checks, Step 4 (timer) | **73/73 passed** |
| Browser checks, Step 5 (time entries) | **82/82 passed** |
| Frontend production build | passed |

Environment: Node v22.22.1, npm 10.9.4, Microsoft Edge 156.0.4314.42, Microsoft Windows 11 Home Single Language.

## How the tests were run

- **Backend tests:** `cd backend && npm test`. Each test file starts its own throwaway in-memory MongoDB, so no real database is used.
- **Browser checks:** a script drives Microsoft Edge (headless) like a real user: it clicks, types, reloads and takes screenshots. It runs against the production build of the frontend and the real backend (on an in-memory MongoDB) on separate ports (5100 and 5273). Any request to the normal dev ports 5000/5173 is blocked, so a running `npm run dev` and its real database are never touched.
- **What a "browser check" is:** one yes/no question about the running app, for example "after a wrong password a toast appears and we stay on /login". The full list is below.

## What was NOT tested

- The frontend components have no unit tests; they are only covered by the browser checks above.
- Only Microsoft Edge was used (no Firefox or Safari, no real phone; phone layouts were checked at a 375px-wide window).
- No load, performance or security-scanning tests.
- The "other devices" in the timer checks are separate browser windows with their own storage (some with deliberately wrong clocks), not real phones or computers.
- Time zones were checked for two zones only: India (the default) and New York (a device set to that zone, including the daylight-saving change). Other zones use the same code but were not run.
- The database parts of the browser checks that no screen can do yet (marking an entry as billed, a timer entry with exact seconds) were set up by writing to the throwaway test database directly, because there are no invoices yet.
- The timer in the browser tab title is updated by the page, and browsers slow down timers in background tabs, so a hidden tab may update its title less often than once a second. The elapsed time itself is always correct when you look at it. Not tested.
- The MongoDB Atlas connection was checked once by hand (a read-only ping), not by an automated test.
- `npm run seed` is still a placeholder.

## Backend tests (83)

Source: [test-code/backend/](test-code/backend). Raw output: [results/backend-jest-output.txt](results/backend-jest-output.txt).

### `health.test.js` (2 tests)

**GET /api/health**

- ✅ returns status ok
- ✅ returns a JSON error for unknown routes

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

### `auth.test.js` (11 tests)

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

### `entries.test.js` (27 tests)

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
- ✅ rejects invalid filters

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

## Browser checks, Step 3: layout, clients, projects (63)

Script: [test-code/browser/step-3-layout-clients-projects.mjs](test-code/browser/step-3-layout-clients-projects.mjs). Raw output: [results/browser-checks-step-3-layout-clients-projects.txt](results/browser-checks-step-3-layout-clients-projects.txt).

- ✅ desktop: sidebar visible, 256px wide, indigo-950 background (256px oklch(0.257 0.09 281.288))
- ✅ desktop: 6 nav items in order (Dashboard, Clients, Projects, Time Entries, Timesheet, Invoices)
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
- ✅ Timesheet: "Coming soon" placeholder
- ✅ Invoices: "Coming soon" placeholder
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
- ✅ server: timer exists with the server-side start time (between click and response) (64ms after the click)
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
- ✅ ...with the same elapsed time (within 2s) (A=5s B=5s)
- ✅ ...and the title shows the time there too
- ✅ device clock 10 minutes AHEAD still shows the correct elapsed time (A=7s C=7s)
- ✅ device clock 2 hours BEHIND still shows the correct elapsed time (A=7s D=8s)
- ✅ Stop shows a toast with the logged time
- ✅ ...the card goes back to the start form
- ✅ ...the tab title goes back to "TimeLedger"
- ✅ ...the mini timer disappears
- ✅ ...the server has no running timer
- ✅ "Today" lists the stopped entry with project, client, description and duration (Website redesign · Acme Corp Hero section v2 00:00:08)
- ✅ ...and its duration matches what the clock showed (within 2s) (clock=8s list=8s)
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
- ✅ a timer started elsewhere appears on its own within ~30 seconds (no click, no refresh) (23s)
- ✅ the stop icon in the mini timer stops the timer
- ✅ ...and "Today" now has 3 entries
- ✅ no projects: "Create a project first" with a link
- ✅ ...the link goes to /projects
- ✅ mobile idle: no horizontal scroll (overflow=0)
- ✅ mobile: project dropdown fits the screen ({"left":33,"right":342})
- ✅ mobile: timer starts
- ✅ mobile: mini timer shows in the top bar next to the logo and log out ({"miniInTopBar":true,"miniVisible":true,"miniRight":319,"logoutLeft":323,"logoutRight":359,"time":"00:00:01"})
- ✅ mobile: top bar contents fit (nothing pushed off screen) ({"miniInTopBar":true,"miniVisible":true,"miniRight":319,"logoutLeft":323,"logoutRight":359,"time":"00:00:01"})
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
- ✅ this week shows today's entry under a "Today" heading (Today · Tue, 27 Oct 2026)
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
- ✅ Clear filters resets them and keeps the date range
- ✅ an empty period shows "No time entries yet" with an Add entry button
- ✅ ...and the summary is all zero (total hours 0s | billable hours 0s | unbilled amount $0.00)
- ✅ "Add entry" opens the modal with today's date filled in (2026-10-27)
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

**"Coming soon" placeholder (Invoices)**

!["Coming soon" placeholder (Invoices)](screenshots/step-3-layout-clients-projects/09-coming-soon-desktop.png)

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

## Re-running the browser checks

The scripts in [test-code/browser/](test-code/browser) are a snapshot of what was run. To run them again you need Microsoft Edge (the path is set at the top of each script) and `npm install puppeteer-core` next to them. Then:

1. Build the frontend for the test ports and serve it: set `VITE_API_URL=http://localhost:5100/api`, run `npm run build -- --outDir <some folder> --emptyOutDir` in `frontend/`, then `npm run preview -- --outDir <some folder> --port 5273 --strictPort`.
2. From `backend/`, run `node <path to>/start-isolated-backend.mjs` (in-memory database, port 5100).
3. Run `node step-2-auth.mjs`, `node step-3-layout-clients-projects.mjs`, `node step-4-timer.mjs` and `node step-5-time-entries.mjs`. (Step 5 also needs the in-memory database's address: start the backend with the environment variable `E2E_MONGO_URI_FILE` set to a file path; the script reads the address from that file.) Each prints PASS/FAIL per check and writes its screenshots next to the script.
