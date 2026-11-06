# TimeLedger: test evidence (Steps 1-8, Phase 1A, 1B and 1C)

Everything that was run to check the app, in one folder: the results, every screenshot, and the test code itself. Generated 2026-11-06 14:29.

## Start here

| Open this | To see |
| --- | --- |
| [test-report.html](test-report.html) | The whole report in one page: summary, every test, all screenshots (click one to zoom). Double-click it to open in a browser. |
| [screenshots/](screenshots) | 133 screenshots taken by the browser tests, as separate PNG files. |
| [results/](results) | The raw output of each test run (text and JSON). |
| [sample-pdfs/](sample-pdfs) | Invoices exactly as the browser's "Save as PDF" engine produced them (a one-page invoice, a 36-project invoice over three pages, and the client's public page with the payment details). |
| [sample-emails/](sample-emails) | The invoice e-mail, the reminder e-mails and the invoice e-mail with "Pay now" (HTML and text), and what the `console` provider printed. |
| [test-code/](test-code) | The test files that were run. |

## Summary

| Check | Result |
| --- | --- |
| Backend tests (Jest + Supertest) | **332/332 passed** |
| Browser checks, Step 2 (auth) | **30/30 passed** |
| Browser checks, Step 3 (layout, clients, projects) | **62/62 passed** |
| Browser checks, Step 4 (timer) | **73/73 passed** |
| Browser checks, Step 5 (time entries) | **82/82 passed** |
| Browser checks, Step 6 (timesheet) | **54/54 passed** |
| Browser checks, Step 7 (invoices) | **85/85 passed** |
| Browser checks, Step 8 (demo seed data, rounding, settings) | **63/63 passed** |
| Browser checks, Phase 1A (send by e-mail, public link, overdue) | **64/64 passed** |
| Mutation checks, UPI ID warning and cleaning (10 changes: a suggestion for a handle that is not close to anything, no swap rule, no same-first-letter preference, no lower-casing, a changed warning text, an ID without a name warned about twice, a handle missing from the list, no suggestion for short handles, the server keeping the case typed, the server refusing an unknown handle) | **10 of 10 caught** (1 to 3 tests fail for each; [results/mutation-checks-upi-warning.txt](results/mutation-checks-upi-warning.txt)); restored byte for byte, all pass |
| Mutation checks, seed guard and .env.example (10 changes: a +srv string, one local host among remote ones or a "localhost" user name counting as local; the guard removed or its SEED_ALLOW override broken; the connection string in the message; the command not calling the guard; a setting missing from .env.example; a real-looking key or a password in it) | **10 of 10 caught** (1 to 3 tests fail for each; [results/mutation-checks-seed-guard-and-env-example.txt](results/mutation-checks-seed-guard-and-env-example.txt)); restored byte for byte, all pass |
| Browser checks, Phase 1C (who owes me what: dashboard, clients, a page for each client) | **85/85 passed** |
| Mutation checks, Phase 1C (17 changes: due today counted as overdue, off by one at 30 and 60 days, paid or draft invoices counted, another user's numbers or client visible, non-billable, billed or running time counted as unbilled, "this month" in UTC, no 90 day window, wrong ordering, no cents rounding, wrong oldest invoice, no limit of 5 payments) | **17 of 17 caught** (1 to 3 tests fail for each; [results/mutation-checks-phase-1c.txt](results/mutation-checks-phase-1c.txt)); restored byte for byte, all pass |
| Browser checks, Phase 1B (payment reminders, payment details, Pay now) | **72/72 passed** |
| Mutation checks, Phase 1B (the unique index that stops a double send, the oldest instead of the latest missed reminder, "today" in UTC, a 10-day catch-up, the placeholder cron secret accepted, no 24 hour limit, a failed e-mail logged as sent, Pay now without a link, a payment link that need not be https) | **9 of 9 caught** (10, 2, 2, 1, 1, 4, 6, 3 and 2 tests fail; [results/mutation-checks-phase-1b.txt](results/mutation-checks-phase-1b.txt)); restored byte for byte, all pass |
| Mutation checks, Phase 1A (a private field leaking, a view overwritten, a paid invoice overdue, a failed e-mail changing the status, a link that is not replaced) | **5 of 5 caught** ([results/mutation-checks-phase-1a.txt](results/mutation-checks-phase-1a.txt)); restored, all pass |
| Mutation checks, trust proxy (the setting removed; the setting changed to trust every address) | **both caught** (3 and 2 tests fail; [results/mutation-checks-trust-proxy.txt](results/mutation-checks-trust-proxy.txt)); restored, all pass |
| Mutation checks, Step 8 (rounding to nearest instead of up, a seed that deletes everybody's data) | **7 and 1 tests fail** ([results/mutation-checks-step-8.txt](results/mutation-checks-step-8.txt)); restored, all pass |
| Mutation check: taking the "not billed yet" guard out of the claim | **5 tests fail** ([results/mutation-check-double-billing.txt](results/mutation-check-double-billing.txt)); with the guard restored 32/32 pass |
| Frontend production build | passed |

Environment: Node v22.22.1, npm 10.9.4, Microsoft Edge 156.0.4314.58, Microsoft Windows 11 Home Single Language.

## How the tests were run

- **Backend tests:** `cd backend && npm test`. Each test file starts its own throwaway in-memory MongoDB, so no real database is used (the invoice tests use an in-memory *replica set*, because invoices need MongoDB transactions).
- **Browser checks:** a script drives Microsoft Edge (headless) like a real user: it clicks, types, reloads and takes screenshots. It runs against the production build of the frontend and the real backend (on an in-memory MongoDB replica set) on separate ports (5100 and 5273). Any request to the normal dev ports 5000/5173 is blocked, so a running `npm run dev` and its real database are never touched.
- **What a "browser check" is:** one yes/no question about the running app, for example "after a wrong password a toast appears and we stay on /login". The full list is below.

## Problems the checks found while building Step 8

- **The phone top bar overflowed.** Adding the Settings gear next to Log out pushed Log out off a 375px screen while a timer was running (an existing Step 4 check failed). The logo and the mini timer are now a little more compact on phones; the Step 8 checks also test 360px.
- **The dashboard cards were wider than a phone screen** (since Step 6): the This week and Today cards ran off the right edge. Looking at the new screenshots showed it; the old "no sideways scroll" check could not, because on a phone the page width grows with the content and the check compared the page with that grown width. It now compares with the real screen width and also looks at every element on the page. Fixed with one class (`grid-cols-1`).
- **Test start-up was slow on a busy computer.** Every test file starts its own in-memory MongoDB; with nine files at once some did not start within the default 10 seconds. Jest now runs at most 4 files at a time with a 60 second limit.

## What the checks showed while adding the UPI ID warning

- **The warning waits until the person has left the field.** Shown while typing it would flash "did you mean @okaxis?" at every key press (the Phase 1B browser checks look at this: no warning while typing, one after leaving the field, gone again when typing resumes). Leaving the field also shows the ID the way it will be saved (no spaces around it, lower case).
- **A warning is not an error.** An ID with a handle like @okhdfcnk is saved all the same (a test on the server, and a browser check that presses Save with the amber warning showing); only a wrongly formed ID is a red error, and then the amber warning stays away.
- **The swap rule needs a short handle to be tested.** A swapped-letter typo of a long handle is found even without the rule (it counts as two edits and up to three are allowed), so the tests also use a short one (`ylb` for `ybl`), where only a swap counts as one edit. The mutation that removes the rule is caught by it.
- **The list lives in one file, and the tests use that file.** The warning is shown as the person types, so the list and the closest-handle logic are in the frontend (`frontend/src/utils/upiHandles.js`, no dependencies); the backend's Jest imports the same file, so there is no second copy to drift. The server only cleans the ID (trim, lower case) and checks its format.

## What the checks showed when the demo data was taken out

- **The seed refuses a database that is not local, in tests and in the real command.** Local and remote connection strings (including the tricks: `mongodb+srv://localhost`, a user name that says "localhost", `127.0.0.1.evil.example.com`, one remote host in a list) are tested, and so is the command itself: `npm run seed` is started with an address that can never be reached and has to stop with the refusal before connecting, without printing the password. The guard's answer for the real `backend/.env` was also read, without connecting anywhere.
- **The new `backend/.env` would have leaked into the browser checks.** It now has `APP_URL=http://localhost:5173` (the developer's own frontend), and the isolated test backend only overrides what it sets itself, so e-mail links would have pointed at the wrong server. The isolated backend now sets `APP_URL` (and the e-mail provider) itself.
- **The login hint is gone from the built page, not just hidden.** With `VITE_SHOW_DEMO` unset the text "Demo@1234" is not in the built JavaScript at all; the Step 2 script checks the page has no hint, and a second build made with `VITE_SHOW_DEMO=true` (port 5274) shows it. The other browser scripts passed unchanged.
- **Every setting the code reads is listed in `.env.example`.** A test finds each `process.env.X` in the backend source and checks it is listed, so a setting added later can't be forgotten; its first version also caught that a comment mentioning `mongodb+srv://` looked like a connection string with a password, so the pattern now only matches one with a user and a password.

## What the checks showed while building Phase 1C

- **The demo needed something overdue.** Without it the new screens had nothing to show, so the seed now makes a third invoice (Initech: sent four weeks ago, opened, not paid, 7 to 13 days overdue whatever the weekday). The seed test checks the numbers. Step 8 and Phases 1A and 1B had to learn about it: the invoice a script makes for itself is now INV-0004, Step 8 expects three invoices, and Phase 1A moves the due date of INV-0003 out of the way so that INV-0002 stays the only overdue invoice there. Steps 2 to 7 passed unchanged (Clients and Dashboard included).
- **A weakness of my own Phase 1B script, shown by a Friday.** It assumed that no reminder was due the moment the job first ran. The demo's Acme invoice is due 3 days after the weekday the checks ran on, so on a Friday its 3-days-before reminder was due at once and the "idle job sends nothing" check failed. The due dates of the demo invoices are now parked 30 days ahead first, so the result no longer depends on the day.
- **The helper that moves a due date in the throwaway database was too loose.** It changed the first invoice with a given number of any user (invoice numbers repeat for every user, and the older scripts leave their users behind), so after the other scripts had run it changed somebody else's invoice and checks failed. It now only touches the demo user's invoice.
- **A mutation check that would have survived.** Counting a still-running timer as unbilled time changes no amount (it has no duration), so the first version of the tests did not notice. A running timer is now part of the test of the unbilled period, and the mutation is caught.

## What the checks showed while building Phase 1B

- **Old expectations that the new screen correctly broke.** The Phase 1A check "all steps of the paid invoice's timeline are done" failed, because the timeline now has a fifth step, *Reminder sent*, and the paid demo invoice never got a reminder. It now looks at the four steps by name and also checks that no reminder was sent. All other Step 2-8 and Phase 1A checks passed unchanged (511 checks, rerun against the Phase 1B build).
- **Two of the new browser checks raced the page.** The invoice page's reminders section appears with "Loading reminders..." before its own request has finished; two checks read it too early (one failed, one crashed the script). The checks now wait for the real text. The app was fine: a separate look at a draft invoice showed the right text and no buttons.
- **The browser could no longer be started the old way.** With the installed Edge (156.0.4314.58) `puppeteer.launch()` stopped working ("Failed to launch the browser process: Code: 0"), although Edge itself runs. The scripts now start Edge themselves and connect to it ([test-code/browser/launch-edge.mjs](test-code/browser/launch-edge.mjs)); every script, old and new, was rerun this way.
- **Design choices the tests pin down** (each one has a test, and most a mutation check): a reminder is claimed in the database before the e-mail goes out, so two job runs at the same moment send one e-mail; only the latest missed reminder is sent (never a burst), and nothing older than 2 days; "today" is the owner's day (Kolkata and New York near midnight UTC); no reminder is ever scheduled on or before the day the invoice was sent; a failed e-mail is logged as failed and tried again by the next run (3 attempts at most); "Send reminder now" is limited to one per invoice per 24 hours, even for two clicks at the same moment.

## What was NOT tested

- **The list of handles was not checked against the banks.** It is the list of common handles that was asked for (30 of them); a real handle that is not in it gets the amber warning, which is why it is a warning and not an error. Nobody checks that a UPI ID exists. The amber line is announced politely (`role="status"`), but no screen reader was used.
- **Removing the demo data from the real database is not part of these tests.** It was done with a one-off script (a dry run that only counts, then a delete that runs only if the live counts still equal the dry run, and a final comparison), not by a test, and its output is not in this evidence. The seed guard was tested with connection strings and with the real command and an unreachable address; the real seed was never started against the real database to watch it refuse.
- **Phase 1C: the numbers were compared with other routes, not with a real database.** The dashboard and clients numbers are checked against sums the browser script works out from the invoices list and the entries totals (a different code path), and against the Jest tests, but never against MongoDB Atlas, and there was no load test: they are worked out from all of a user's sent and paid invoices on every request.
- **Phase 1C: dates were moved in the throwaway database.** No screen changes a due date, so the checks moved them to make the demo invoice overdue and to put an unpaid invoice in every aging bucket. "Dismissed for the day" was tested by writing an older date into the browser's storage, not by waiting for midnight, and "Paid this month" in the browser follows the day the checks run (the script works the expected value out from the invoices).
- **Phase 1C: one currency, Edge only.** The sums assume one currency per user. Phones were checked at 375px (the dashboard also at 360px) in Microsoft Edge only.
- **The GitHub Action was never run on GitHub.** The workflow file was written and read, but its secrets (`REMINDERS_URL`, `CRON_SECRET`) were not set and nothing ran there. What was tested is the endpoint it calls (with curl and the secret against a local backend, and by the Jest tests) and the job itself. GitHub's scheduler can start a run late, and a sleeping Render service waking up (the workflow waits 3 minutes and retries) was not tried.
- **No real reminder e-mail was sent** (Brevo, see below). The reminder and invoice e-mails with "Pay now" were rendered in Edge and read from the `console` provider's output only.
- **The "Pay now" link was never followed**: it points to an example address. There is no payment gateway, no webhook, and "Paid" is still set by hand. The UPI ID is only checked for its format (it cannot be known whether such an account exists); bank details are free text.
- In the browser, the dates the reminders depend on (an invoice's due date and the day it was sent) were moved in the throwaway database, because no screen can change them. The schedule itself is tested by Jest with a fixed "now" (a time zone test for Asia/Kolkata and America/New_York near midnight UTC, catch-up, paused, disabled, paid, draft, no client e-mail).
- The "which day is it" rule was tested in two time zones (Asia/Kolkata and America/New_York) and in UTC for the mutation check; other zones use the same code.
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
- **Brevo was never called for real.** The Brevo provider is tested with a faked network (the exact request, the failures, the production guard). No real e-mail was sent or received, so delivery, the spam folder and how a real mail program (Gmail, Outlook) draws the HTML e-mail were not checked; the HTML e-mail was only rendered in Edge.
- The e-mail checks in the browser read what the `console` provider printed in the backend's output.
- To get an overdue invoice in the browser, the due date of one demo invoice was moved back in the throwaway database (no screen can change a due date). The overdue rule itself is checked by the backend tests (due yesterday, due today, paid, draft, New York).
- The rate limit on the public link (60 requests a minute per address) is tested directly, and behind one proxy (`app.set('trust proxy', 1)`: each visitor is counted by the address the proxy reports, and faking `X-Forwarded-For` doesn't help). A real proxy or load balancer, and a setup with two proxies in front (the setting trusts one hop), were not tested.
- Copying the share link to the clipboard was checked in headless Edge (the clipboard could be read there); other browsers use the same code with a fallback for pages that are not HTTPS, which was not tested.
- "Paid" is a status you set by hand: there is no online payment, tax, discount or currency conversion.
- The timer in the browser tab title is updated by the page, and browsers slow down timers in background tabs, so a hidden tab may update its title less often than once a second. The elapsed time itself is always correct when you look at it. Not tested.
- The MongoDB Atlas connection was checked once by hand (a read-only ping), not by an automated test.

## Backend tests (332)

Source: [test-code/backend/](test-code/backend). Raw output: [results/backend-jest-output.txt](results/backend-jest-output.txt).

### `payment.test.js` (29 tests)

**PATCH /api/auth/me: payment details**

- ✅ saves a payment link, a UPI ID and bank details, and /me gives them back
- ✅ a new user has no payment details at all
- ✅ changes only what is sent: the other details stay, and an empty string removes one
- ✅ can be saved together with other settings without touching the reminder settings
- ✅ trims the text, normalises line endings and drops control characters from the bank details
- ✅ saves the UPI ID trimmed and in lower case, and gives it back that way
- ✅ a UPI ID with a handle that is not a known one is still saved (the warning is only shown on screen)
- ✅ only spaces remove the UPI ID, like an empty string does

**payment details are validated**

- ✅ the payment link must be a full https address: no javascript:, http, ftp, bare words, passwords or spaces
- ✅ accepts real payment links (Stripe, PayPal, Razorpay)
- ✅ the payment link can be at most 500 characters
- ✅ the UPI ID must look like name@bank
- ✅ upper case and spaces are no way round the format check: a space inside the ID is still refused
- ✅ the bank details can be at most 500 characters
- ✅ wrong types and an empty payment are refused
- ✅ several mistakes are all reported, each under its own field
- ✅ needs a login

**the "Pay now" button in the invoice e-mail**

- ✅ is not there when no payment link is set
- ✅ is there, linking to the payment link, when one is set
- ✅ with only a UPI ID or bank details there is no button, but the details are shown
- ✅ with a link and details: the button, and the details below it
- ✅ what the owner typed is escaped, so it can not add markup to the e-mail
- ✅ removing the link removes the button from the next e-mail

**the payment details on the public invoice**

- ✅ are null when the owner set up nothing
- ✅ have the link, the UPI ID and the bank details when they are set
- ✅ have no link (null) when only a UPI ID is set, so the page can show no button
- ✅ follow the owner's current settings, also for invoices made before
- ✅ are left out once the invoice is paid (nothing to pay any more)
- ✅ are the only owner data on the public page: no other user field is added

### `reminders.test.js` (52 tests)

**the schedule (3 days before, on the due date, 7 and 14 days after)**

- ✅ before_due: sent 3 days before the due date, with the right words, link and recipient
- ✅ on_due: sent on the due date
- ✅ overdue: sent 7 days and 14 days after the due date, and not on the days in between
- ✅ follows the owner's own settings: 5 days before, no due-date reminder, 2 and 30 days after
- ✅ a day is counted in the OWNER's time zone: Kolkata and New York near midnight UTC
- ✅ the same instant is a different day for each owner: 03:30 UTC is already 10 March in Kolkata but still 9 March in New York

**a reminder is never sent twice**

- ✅ running the job twice (and again) sends it once
- ✅ two runs at the same moment (Promise.all) send it once, and so do five
- ✅ the database itself refuses a second row for the same reminder; manual reminders are not limited

**nothing is sent for ...**

- ✅ a paid invoice, a draft, a paused invoice
- ✅ a client with no e-mail address
- ✅ an owner who switched reminders off, or has no reminder turned on at all
- ✅ an invoice that was sent on the very day a reminder would go out (the client just got it)
- ✅ an invoice whose reminder day is far away
- ✅ an owner whose reminder was just sent by hand (not 2 in one day)
- ✅ an invoice that is paid or paused after the job looked at it (nothing is sent, nothing is left claimed)

**catch-up when the job did not run on the day (the server was asleep)**

- ✅ a missed reminder is still sent up to 2 days late, with the words for today ("1 day overdue")
- ✅ nothing older than 2 days is sent
- ✅ only the LATEST missed reminder is sent, never a burst of old ones
- ✅ does not send a reminder for a day before the invoice was sent, however late the job is

**when the e-mail provider fails**

- ✅ the log says "failed", the invoice is unchanged, and nothing was sent
- ✅ a failed reminder is tried again by the next run, and then sent exactly once
- ✅ gives up after 3 attempts (the row stays "failed")
- ✅ one failure does not stop the others in the same run

**POST /api/cron/reminders**

- ✅ answers 401 without the secret and with a wrong one (also a different length), and runs nothing
- ✅ with the right secret it runs the job and returns { checked, sent, skipped, failed }
- ✅ is not open when the secret is missing on the server, too short, or still the placeholder (503, even with a matching header)
- ✅ needs POST, and needs no login

**POST /api/invoices/:id/reminders/send-now**

- ✅ sends a reminder at once, once: the second time within 24 hours is 429
- ✅ can be sent again once 24 hours have passed (and not before)
- ✅ two clicks at the same moment send one e-mail
- ✅ an automatic reminder counts too: no manual one within 24 hours of it
- ✅ words follow the day: due today, overdue
- ✅ when the provider fails: 502, and the 24 hours are given back so it can be tried again
- ✅ a paid invoice and a draft are refused (409), and a client without an e-mail is 400
- ✅ is private: user B can't send, read or pause user A's reminders (404), and a login is needed

**pausing, and what the invoice page shows**

- ✅ PATCH { paused } pauses and resumes the automatic reminders of one invoice
- ✅ refuses anything but true or false
- ✅ GET /reminders has the history (newest first, failures included) and the next reminder
- ✅ "next" skips what was already sent, and says why there is none

**reminder settings**

- ✅ a user starts with: on, 3 days before, on the due date, 7 and 14 days after
- ✅ saves any of them, changes only what is sent, and sorts the days after the due date
- ✅ beforeDueDays is a whole number from 0 (off) to 14
- ✅ afterDueDays: 1 to 60 each, at most 3, no repeats
- ✅ enabled and onDueDate must be true or false; an empty group is refused; nothing is saved when one field is wrong
- ✅ users saved before reminders existed get the defaults (nothing is missing in the job)

**the reminder e-mail**

- ✅ has a different subject for each situation (singular and plural)
- ✅ is friendly, has the amount, the due date, the freelancer and a View invoice button, in HTML and in text
- ✅ an overdue one says how long, and that a payment already made can be ignored
- ✅ shows "Pay now" only when the owner has a payment link, and the UPI ID and bank details below it
- ✅ escapes what people typed (the client's name, the freelancer's name, the bank details)
- ✅ when the job sends it, "Pay now" follows the owner's current payment link

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

### `seed.test.js` (7 tests)

**seed**

- ✅ can be run again and again: same counts, same invoices, and the data looks like the brief
- ✅ does not delete or change another user's data
- ✅ refuses to run in production unless SEED_ALLOW=true

**seed > only against a local database**

- ✅ knows which connection strings are local
- ✅ refuses a remote database (Atlas or any other host) and never repeats the connection string
- ✅ SEED_ALLOW=true allows it; a local database is fine; so is no connection string yet (connecting reports that itself)
- ✅ `npm run seed` itself refuses before it connects anywhere (and does not print the password)

### `public-invoice.test.js` (20 tests)

**GET /api/public/invoices/:token**

- ✅ shows the invoice to anybody with the link: no login, and only what the client needs
- ✅ is not cached or indexed
- ✅ shows the real state: sent, overdue (with the days) and paid
- ✅ answers 404 for a token that does not exist, however it is written
- ✅ a token query can't be turned into a database query
- ✅ an invoice that has no link yet is not reachable

**viewedAt**

- ✅ is set the first time the client opens the link and never overwritten
- ✅ an unknown token or the owner's own login never sets it

**share links**

- ✅ POST /:id/share-link makes the link once and gives the same one every time, even when asked at the same moment
- ✅ the invoice page data has the link (and no raw token), the list has neither
- ✅ every invoice gets its own token
- ✅ regenerate makes a new link and the old one stops working at once
- ✅ regenerate starts "viewed" again, because the new link has not been opened yet
- ✅ is private: user B can't get or regenerate user A's link (404), and a login is needed
- ✅ the link made by sending an email opens the invoice
- ✅ a deleted draft takes its link with it

**rate limit on the public route**

- ✅ answers 429 after 60 requests in a minute from one address, and only for this route

**trust proxy (the app runs behind one proxy or load balancer)**

- ✅ is set to 1 proxy hop
- ✅ the rate limit counts each visitor by the address the proxy reports, not by the proxy
- ✅ a visitor can't escape the limit by faking X-Forwarded-For: only the address the proxy added counts

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

### `receivables.test.js` (29 tests)

**summary: totals and the aging breakdown**

- ✅ puts invoices in every bucket: not due and due today are Current, then 1-30, 31-60 and 61+ days overdue
- ✅ the oldest overdue invoice is the one that has waited longest, with its client and its days
- ✅ nothing is overdue when everything is current: no oldest invoice
- ✅ a paid invoice never counts as outstanding or overdue, and neither does a draft
- ✅ a user with nothing gets zeros, four empty buckets and no average
- ✅ adds up money to two decimals

**summary: paid this month and the average days to get paid**

- ✅ paid this month counts what was paid since the 1st, in the owner's own time zone
- ✅ the average days to get paid goes from sent to paid, over the last 90 days only
- ✅ the 90 day window: an invoice paid a minute inside it counts, one paid a minute outside it does not
- ✅ the average has one decimal
- ✅ an invoice that was marked paid without being sent counts from the day it was issued

**summary: a day is the owner's day**

- ✅ the same invoice is one day overdue in New York but only due today in India

**byClient**

- ✅ has one row per client, with the numbers of that client only
- ✅ a client whose invoices are all paid owes nothing, however old they are
- ✅ sorts by overdue amount, then by outstanding, then by name
- ✅ works out the unbilled amount from billable entries that are on no invoice, at each project's rate
- ✅ only counts the user's own entries and projects

**clientDetail**

- ✅ has the same numbers as the clients list, the invoices with their display status, and the last 5 payments
- ✅ says what is not billed yet and for which days, so "Invoice unbilled time" can fill the period in
- ✅ a client with nothing yet has zeros, no invoices and no unbilled time
- ✅ answers 404 for a client that does not exist and for somebody else's client

**user A never sees the numbers of user B**

- ✅ summary, clients and unbilled time only cover the logged-in user

**GET /api/receivables/summary**

- ✅ needs a login
- ✅ returns { summary } for the logged-in user

**GET /api/receivables/clients**

- ✅ returns { clients } sorted with the most overdue first

**GET /api/clients/:id/overview**

- ✅ returns the client, the numbers, the invoices and the last payments
- ✅ needs a login
- ✅ is 404 for a client that does not exist and for another user's client (the same answer for both)
- ✅ is 400 for an id that is not an id

### `env-example.test.js` (6 tests)

**backend/.env.example**

- ✅ lists every setting that was asked for
- ✅ lists every setting the backend code reads from the environment (so a new one can not be forgotten)
- ✅ has placeholders only: no real key, password or token
- ✅ is set up for local development: console e-mail, no keys, the demo e-mail, a local frontend

**frontend/.env.example**

- ✅ lists the API address and keeps the demo login hint off by default

**git**

- ✅ ignores every .env file, so a real one is never committed

### `health.test.js` (2 tests)

**GET /api/health**

- ✅ returns status ok
- ✅ returns a JSON error for unknown routes

### `upi-handles.test.js` (14 tests)

**the list of common UPI handles**

- ✅ has every handle that was asked for, once each and in lower case
- ✅ can not be changed by accident

**the handle of a UPI ID**

- ✅ is what follows the @, trimmed and in lower case
- ✅ is empty when there is nothing to look at: the server explains those mistakes itself, so they are not warned about twice

**the closest known handle**

- ✅ suggests the handle a typo was meant to be
- ✅ is not case sensitive
- ✅ suggests nothing when nothing is close: no wild guesses
- ✅ a handle that is known needs no suggestion of its own: it is its own closest one
- ✅ on a tie prefers a handle that starts with the same letter, then the one that comes first in the list

**checking an ID**

- ✅ has nothing to say about a known handle, in any case and with spaces around the ID
- ✅ says which handle it does not know, and what was probably meant

**the amber warning under the UPI ID field**

- ✅ names the handle and suggests the closest known one
- ✅ without a close match it only says to double-check
- ✅ is empty for a known handle, for nothing typed yet, and for IDs the server will explain itself

### `rounding.test.js` (6 tests)

**roundUp(seconds, minutes)**

- ✅ rounds up to the next block of 15 minutes
- ✅ keeps an exact multiple as it is, and goes up a whole block one second after it
- ✅ keeps an empty entry at 0
- ✅ does nothing when rounding is off (0 minutes or no value)
- ✅ never goes below 0 and never rounds down
- ✅ works for other block sizes too

### `invoice-send.test.js` (21 tests)

**POST /api/invoices/:id/send**

- ✅ emails the client with a link, and moves the invoice from draft to sent
- ✅ sends to the address typed in, copies others, and puts the personal message in both versions (escaped in the HTML)
- ✅ goes to the client's email as it is now when it was corrected after the invoice was made
- ✅ needs somebody to send it to: 400 "Add the client's email first", nothing is sent, nothing changes
- ✅ validates the addresses and the message
- ✅ refuses a paid invoice (409) and sends nothing
- ✅ when the provider fails: 502 "Couldn't send the email. Try again." and the invoice is left as it was
- ✅ can be sent again: only lastSentAt (and the recipient) change, sentAt stays and the same link is used
- ✅ an overdue invoice can be sent again too, and stays overdue
- ✅ is private: user B can't send user A's invoice (404, nothing is sent), and a login is needed

**email providers**

- ✅ brevo: one POST to the transactional API with the key in a header and the whole email in the body
- ✅ brevo: an error answer, a network failure or a missing key all become an EmailError (and the key is never in the message)
- ✅ through the API: Brevo refusing the email gives 502 and leaves the invoice a draft
- ✅ console is the default while developing; in production an unset provider is an error, not a silent log

**overdue**

- ✅ a sent invoice that was due yesterday (Asia/Kolkata) is overdue by 1 day
- ✅ due today is not overdue yet, even at 00:00 today; one minute earlier is
- ✅ counts the days: due 5 days ago is 5 days overdue
- ✅ a paid invoice is never overdue, and neither is a draft
- ✅ uses the user's own time zone: 23:00 yesterday in New York is overdue for a New York user
- ✅ GET /api/invoices has displayStatus and daysOverdue on every invoice, and ?status=overdue / sent / draft / paid filter by it
- ✅ marking it paid ends the overdue state

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

## Browser checks, Step 2: authentication (30)

Script: [test-code/browser/step-2-auth.mjs](test-code/browser/step-2-auth.mjs). Raw output: [results/browser-checks-step-2-auth.txt](results/browser-checks-step-2-auth.txt).

- ✅ / redirects to /login when logged out
- ✅ login page shows the brand and NO demo hint (VITE_SHOW_DEMO is not set)
- ✅ login page built with VITE_SHOW_DEMO=true shows "Demo: demo@timeledger.app / Demo@1234"
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
- ✅ client row shows name, company, email and project count (A Acme Corp No invoices yet 0 projects Acme Inc billing@acme.com Outstanding $0.00 Overdue — Unbilled — Last payment —)
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
- ✅ server: timer exists with the server-side start time (between click and response) (81ms after the click)
- ✅ server: description and project saved
- ✅ clock ticks every second (0s -> 2s)
- ✅ mini timer in the sidebar: pulsing dot + time + stop icon ({"inSidebar":true,"time":"00:00:02","pulsing":true,"stopButton":true,"linkTo":"/"})
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
- ✅ device clock 10 minutes AHEAD still shows the correct elapsed time (A=6s C=7s)
- ✅ device clock 2 hours BEHIND still shows the correct elapsed time (A=6s D=7s)
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
- ✅ a timer started elsewhere appears on its own within ~30 seconds (no click, no refresh) (25s)
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
- ✅ default range is "This week": the request covers Monday 00:00 to next Monday 00:00 (India time) (2026-11-01T18:30:00.000Z -> 2026-11-08T18:30:00.000Z)
- ✅ this week shows today's entry under a "Today" heading (Today · Fri, 6 Nov 2026)
- ✅ ...but not last week's
- ✅ "Last week" asks for the previous Monday-to-Monday range (2026-10-25T18:30:00.000Z -> 2026-11-01T18:30:00.000Z)
- ✅ ...and shows last week's entry only
- ✅ "This month" asks for the 1st to the 1st of next month (2026-10-31T18:30:00.000Z -> 2026-11-30T18:30:00.000Z)
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
- ✅ "Add entry" opens the modal with today's date filled in (2026-11-06)
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
- ✅ "This week" jumps to the current week (Monday in India time) (2026-11-02 (expected 2026-11-02))
- ✅ on the current week "Next" and "This week" are disabled, "Previous" is not ({"nextDisabled":true,"thisWeekDisabled":true,"prevDisabled":false})
- ✅ today's column is highlighted in light indigo (header and cells) ({"count":1,"text":"Fri 6","headerBg":"oklch(0.962 0.018 272.314)","cellBg":"oklch(0.962 0.018 272.314)","cellText":"15m","otherCellBg":"rgba(0, 0, 0, 0)"})
- ✅ ...and today's 15 minutes show in it (15m)
- ✅ a link with ?week=2026-03-10 (not a Monday) shows the current week and fixes the URL (2026-11-02)
- ✅ a link with ?week=2099-01-05 (in the future) shows the current week and fixes the URL (2026-11-02)
- ✅ a link with ?week=banana (not a date) shows the current week and fixes the URL (2026-11-02)
- ✅ clicking a cell opens /time-entries with the project and the day in the URL (?projectId=6aed95e72982a6e63babfa31&from=2026-03-09&to=2026-03-09&overlap=1)
- ✅ Time entries starts with those filters already set (Custom range, that day, that project) ({"preset":"custom","from":"2026-03-09","to":"2026-03-09","project":"Website"})
- ✅ ...and asks for that day in India time, for that project ({"from":"2026-03-08T18:30:00.000Z","to":"2026-03-09T18:30:00.000Z","projectId":"6aed95e72982a6e63babfa31","overlap":"true"})
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
- ✅ it starts on "This month" (the 1st up to today) ({"from":"2026-11-01","to":"2026-11-06","pressed":"This month"})
- ✅ "Create invoice" is disabled until there is something to bill
- ✅ ...and the preview asks for a client first
- ✅ quick pick "Last week" fills 2026-10-26 to 2026-11-01 ({"from":"2026-10-26","to":"2026-11-01"})
- ✅ quick pick "Last month" fills 2026-10-01 to 2026-10-31 ({"from":"2026-10-01","to":"2026-10-31"})
- ✅ quick pick "This month" fills 2026-11-01 to 2026-11-06 ({"from":"2026-11-01","to":"2026-11-06"})
- ✅ typing a date switches the quick pick to "Custom"
- ✅ the end date cannot be picked after today (2026-11-06)
- ✅ a client with its own unbilled time previews only that (Brand 1.00 h x $80.00 = $80.00) (Brand 1.00 h × $80.00 $80.00 1 entry · 9 – 13 Mar 2026 $80.00)
- ✅ Acme preview: line items with hours, rate and amount, entry count and total (App 1.50 h × $60.00 $90.00 Website 2.78 h × $50.00 $138.89 4 entries · 9 – 13 Mar 2026 $228.89)
- ✅ ...with the total $228.89 (non-billable, other client, outside the period and the 23:30 edge handled)
- ✅ ...and "Create invoice" is enabled
- ✅ creating shows the toast "Invoice INV-0001 created"
- ✅ ...and opens the invoice page
- ✅ invoice page: logo, "INVOICE", number INV-0001 and a Draft badge (INV-0001 Draft)
- ✅ From (the user) and Bill to (name, company, email)
- ✅ issue date is today and the due date is 14 days later (India time) (TimeLedger INVOICE INV-0001 Draft FROM Priya s7-priya-1793955318150@example.com BILL TO Acme Corp Acme Inc billing@acme.com ISSUE DATE 6 Nov 2026 DUE DATE 20 Nov 2026 PERIOD 9 – 13 Mar 2026 PROJECT HOURS RATE AMOUNT App 1.50 $60.00 $90.00 Website 2.78 $50.00 $138.89 Subtotal $228.89 Total $228.89 NO)
- ✅ period "9 – 13 Mar 2026"
- ✅ line items table: Project, Hours, Rate, Amount (project | hours | rate | amount)
- ✅ ...App 1.50 / $60.00 / $90.00 and Website 2.78 / $50.00 / $138.89 ([["App","1.50","$60.00","$90.00"],["Website","2.78","$50.00","$138.89"]])
- ✅ subtotal and total $228.89
- ✅ notes are at the bottom
- ✅ actions: Back, Print / Save as PDF, Send invoice (added in Phase 1A), Mark as sent, Mark as paid, Delete (a draft) (Back | Print / Save as PDF | Send invoice | Mark as sent | Mark as paid | Delete)
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
- ✅ the Billed badge links to its invoice (/invoices/6aed95fa2982a6e63babfa52)
- ✅ ...and clicking it opens that invoice
- ✅ both tabs see the same preview ($270.00, 3 entries) (App 2.00 h × $60.00 $120.00 Website 3.00 h × $50.00 $150.00 3 entries · 16 – 20 Mar 2026 $270.00 || App 2.00 h × $60.00 $120.00 Website 3.00 h × $50.00 $150.00 3 entries · 16 – 20 Mar 2026 $270.00)
- ✅ exactly ONE of the two tabs got an invoice (/invoices/6aed96022982a6e63babfa55 / /invoices)
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
- ✅ list: 3 invoices, newest first, each with number, client, period, issued date, total and status (INV-0003 Acme Corp 6 – 10 Apr 2026 · issued 6 Nov 2026 $300.00 Draft || INV-0002 Acme Corp 16 – 20 Mar 2026 · issued 6 Nov 2026 $270.00 Draft || INV-0001 Acme Corp 9 – 13 Mar 2026 · issued 6 Nov 2026 $228.89 Paid)
- ✅ badge colours: Paid emerald, Draft slate; amounts in JetBrains Mono ({"paid":"oklch(0.508 0.118 165.612)","draft":"oklch(0.372 0.044 257.287)","mono":"\"JetBrains Mono\", ui-monospace, SFMono-Regular, monospace"})
- ✅ summary: Outstanding $570.00 (the two drafts), Paid $228.89, Invoices 3 (outstanding $570.00 | paid $228.89 | invoices 3)
- ✅ status filter: All, Draft, Sent, Overdue (added in Phase 1A), Paid
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
- ✅ print: a real PDF was produced (A4 size 595 x 842 pt, one page for this invoice) ({"pages":1,"width":594.95996,"height":841.91998,"isPdf":true,"bytes":122428})
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
- ✅ about four weeks of entries, weekdays only, up to today (74 entries from 2026-10-05)
- ✅ 2-4 entries on every full weekday, each 30 minutes to 3 hours (3222233323442233444442233)
- ✅ mostly billable, a few non-billable, one entry that crosses midnight, none in the future
- ✅ no running timer
- ✅ three invoices made by the real invoice service: INV-0001 Globex PAID (4 weeks ago), INV-0002 Acme SENT (3 to 2 weeks ago), INV-0003 Initech SENT (4 weeks ago, overdue)
- ✅ the last two weeks are left unbilled (so a reviewer can invoice them right away)
- ✅ every billed entry is billable and claimed by exactly one of the three invoices
- ✅ logging in as demo@timeledger.app / Demo@1234 opens the dashboard for Alex Morgan
- ✅ Dashboard: the "This week" card shows this week's tracked time (15h 41m vs 15h 41m)
- ✅ Dashboard: nothing is running (a Start button, no clock) and the sidebar shows the name
- ✅ Timesheet (last week): a row per project, and the total hours match the entries (total hours 22h 53m vs 22h 53m)
- ✅ Time entries (all four weeks): every entry of INV-0001 and INV-0002 has a "Billed" badge that links to its own invoice (33 badges)
- ✅ ...every entry is listed and the non-billable ones are labelled (74 entries, 5 non-billable)
- ✅ Invoices: INV-0002 (Acme, Sent), INV-0003 (Initech, overdue) and INV-0001 (Globex, Paid), newest first, with their totals (INV-0002 Acme Corp 12 – 25 Oct 2026 · issued 26 Oct 2026 $1,344.75 Sent || INV-0003 Initech 5 – 11 Oct 2026 · issued 12 Oct 2026 $148.50 11 days overdue || INV-0001 Globex Ltd 5 – 11 Oct 2026 · issued 12 Oct 2026 $1,420.00 Paid)
- ✅ Invoices: Outstanding = the two sent invoices (with the overdue part), Paid = the paid one, 3 invoices (outstanding $1,493.25 $148.50 overdue | paid $1,420.00 | invoices 3)
- ✅ INV-0002: from Alex Morgan to Acme Corp, status Sent, total as listed, thank-you note, no rounding note
- ✅ the sidebar has a Settings item (gear) that opens /settings and stays highlighted
- ✅ Settings: Name is filled in, Time zone is Asia/Kolkata and read-only, rounding is off, Save is disabled until something changes ({"name":"Alex Morgan","timezone":"Asia/Kolkata","timezoneReadOnly":true,"on":false,"saveDisabled":true})
- ✅ Settings: the toggle is labelled "Round each entry up to 15 minutes"
- ✅ typing a different name enables Save
- ✅ a one-letter name is refused with the server's message under the field, and nothing changes
- ✅ a valid name is saved: toast, and the sidebar shows it straight away
- ✅ ...and it is still there after a reload
- ✅ Rounding off: the Initech preview bills exactly what was tracked (5 entries, $495.00) (API integration 9.00 h × $55.00 $495.00 5 entries · 5 Oct – 6 Nov 2026 $495.00)
- ✅ ...and there is no rounding note
- ✅ toggling the switch enables Save
- ✅ Save: toast "Settings saved"
- ✅ ...and the rule is still on after a reload (saved on the server)
- ✅ Rounding on: the preview says "Rounded up to 15 min per entry" and shows the tracked and billed time (API integration 9.25 h × $55.00 $508.75 Rounded up to 15 min per entry: 9h tracked, 9h 15m billed 5 entries · 5 Oct – 6 Nov 2026 $508.75)
- ✅ ...with the amounts worked out per entry: $508.75 instead of $495.00 (API integration 9.25 h × $55.00 $508.75 Rounded up to 15 min per entry: 9h tracked, 9h 15m billed 5 entries · 5 Oct – 6 Nov 2026 $508.75)
- ✅ creating it: toast "Invoice INV-0004 created" and the invoice page opens
- ✅ INV-0004 shows "Rounded up to 15 min per entry", the billed hours and the rounded total ([["API integration","9.25","$55.00","$508.75"]])
- ✅ the entry list shows tracked → billed for the entries that were rounded (2 of 5) (2 arrows)
- ✅ ...e.g. "2h 52m → 3h"
- ✅ the entries themselves are untouched: every tracked duration is exactly what it was
- ✅ rounding switched off again
- ✅ INV-0004 is unchanged after switching the rule off: same note, same total
- ✅ INV-0001 (made before) has no rounding note and its total is unchanged
- ✅ Rounding off again: an Acme invoice for the unbilled time is exactly as tracked (18 entries, $1,551.75; the billed INV-0002 entries are not in it) (Mobile app 19.90 h × $60.00 $1,194.00 Website redesign 7.95 h × $45.00 $357.75 18 entries · 5 Oct – 6 Nov 2026 $1,551.75)
- ✅ Print view of INV-0004: the sidebar is gone and the rounding note is part of the printed page
- ✅ npm run seed once more (with an extra invoice and rounding switched on): same clients, projects and invoices again
- ✅ the extra invoice INV-0004 is gone and numbering starts again at INV-0001 to INV-0003
- ✅ the demo user is the same one (the session still works) and rounding is reset to off
- ✅ in the browser: still logged in after the re-seed, with the three seeded invoices
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

## Browser checks, Phase 1A: send by e-mail, public link, overdue (64)

Script: [test-code/browser/phase-1a-send-share-overdue.mjs](test-code/browser/phase-1a-send-share-overdue.mjs). Raw output: [results/browser-checks-phase-1a-send-share-overdue.txt](results/browser-checks-phase-1a-send-share-overdue.txt). The e-mails were sent with the `console` provider and read back from the backend's output ([sample-emails/console-provider-output.txt](sample-emails/console-provider-output.txt)); the HTML e-mail is in [sample-emails/](sample-emails).

- ✅ npm run seed created the demo data (a paid invoice, a sent one and an overdue one)
- ✅ test set-up: the sent demo invoice INV-0002 is moved 3 days past its due date (in the throwaway database)
- ✅ test set-up: the demo invoice INV-0003 (Initech) is moved to 10 days from now
- ✅ API: every invoice has displayStatus and daysOverdue
- ✅ API: INV-0002 (sent, due 2026-11-03) is now 3 days overdue, while its stored status is still "sent" (overdue 3)
- ✅ a new draft invoice for Initech (INV-0004) to send
- ✅ status filter chips: All, Draft, Sent, Overdue, Paid (All,Draft,Sent,Overdue,Paid)
- ✅ INV-0002 shows a red-text badge "N days overdue" (not "Sent") (3 days overdue)
- ✅ ...the overdue badge is red, Draft slate, Paid emerald
- ✅ Outstanding card $1,988.25 with "$1,344.75 overdue" below it in red (OUTSTANDING $1,988.25 $1,344.75 overdue)
- ✅ the Paid and count cards have no overdue note
- ✅ filter "Overdue" shows only INV-0002 (INV-0002)
- ✅ filter "Sent" does not include the overdue one (only the demo invoice that is not due yet is sent) (INV-0003)
- ✅ draft: the buttons are Back, Print, Send invoice, Mark as sent, Mark as paid, Delete
- ✅ "Send invoice" is the primary (indigo) button (oklch(0.511 0.262 276.966))
- ✅ timeline of a draft: Created done; Sent, Viewed and Paid still to come ({"created":{"done":true,"text":"Created 6 Nov 2026"},"sent":{"done":false,"text":"Sent Not sent yet"},"reminder":{"done":false,"text":"Reminder sent —"},"viewed":{"done":false,"text":"Viewed —"},"paid":{"done":false,"text":"Paid —"}})
- ✅ no share link yet: the box says so, and there is no Regenerate button
- ✅ the modal opens with To filled in with the client's email and a subject preview ({"to":"finance@initech.example","subject":"Invoice INV-0004 from Alex Morgan","title":"Send invoice","submit":"Send invoice"})
- ✅ a bad CC address is refused under the CC field and nothing is sent
- ✅ when the email can't be sent: the toast says so, the form stays open with what was typed, and the invoice is still a draft
- ✅ Send: toast "Invoice sent to finance@initech.example" and the modal closes
- ✅ the invoice is now Sent: sentAt, lastSentAt and sentTo are saved, and it has a share link
- ✅ the share link points at the app (APP_URL falls back to FRONTEND_URL) (http://localhost:5273/i/HFzEi714GX8D43qU69NNrBFdcJweEb_K)
- ✅ console provider: exactly one email, to the client, CC the boss, with the right subject ([["finance@initech.example","boss@initech.example","Invoice INV-0004 from Alex Morgan"]])
- ✅ ...the text version has the personal message, the amount, the due date and the link to /i/<token>
- ✅ the page updated by itself: badge "Sent", and the timeline shows Sent with the date and "to finance@initech.example" ({"done":true,"text":"Sent 6 Nov 2026 to finance@initech.example"})
- ✅ the buttons now say "Resend invoice"; "Mark as sent" and Delete are gone (it is sent)
- ✅ the share link is shown in a box, with Copy and Regenerate buttons
- ✅ "Copy share link": toast "Share link copied"
- ✅ ...and the link is really on the clipboard (http://localhost:5273/i/HFzEi714GX8D43qU69NNrBFdcJweEb_K)
- ✅ the client sees the invoice without logging in: no sidebar, no app bars, the same paper (Sent)
- ✅ ...with a "Download PDF" button and a small "Sent with TimeLedger" footer link to the start page
- ✅ ...a useful tab title and no search engine indexing (Invoice INV-0004 from Alex Morgan | noindex, nofollow)
- ✅ the page holds nothing from the owner: no buttons to send, delete or edit, no share link box
- ✅ black box: the public JSON has no user id, entry ids, client id, project ids, token or viewedAt
- ✅ "Download PDF" opens the print dialog (Save as PDF)
- ✅ printed: the button bar and the footer are hidden, white background, one A4 page ({"footer":"none","bar":"none","paperRight":794,"bg":"rgb(255, 255, 255)","pages":1,"width":594.95996,"height":841.91998})
- ✅ the owner's timeline now shows Viewed with a date (set when the client opened the link) (Viewed 6 Nov 2026)
- ✅ opening it again does not change the first view date
- ✅ an unknown link says "This invoice link is not valid", still without any app layout
- ✅ Regenerate asks first and says the old link stops working (Regenerate the share link? The current link stops working at once. Anyone you sent it to will need the new one. Cancel Regenerate)
- ✅ Cancel keeps the link as it was
- ✅ Regenerate: toast, and the box shows a different link
- ✅ the new link is on the same address with a new token
- ✅ the timeline starts "Viewed" again (the new link has not been opened) (Viewed Not opened yet)
- ✅ the OLD link now says "This invoice link is not valid"
- ✅ the NEW link opens the invoice
- ✅ Resend: the modal is titled "Resend invoice" and remembers who it was sent to ({"title":"Resend invoice","to":"finance@initech.example","note":true})
- ✅ sending again to another address works (toast shows the new address)
- ✅ two emails in total; the second has the NEW link; sentAt stayed, status still sent
- ✅ INV-0002's badge says "3 days overdue" in red, and so does the Sent step of the timeline (3 days overdue | Sent 26 Oct 2026 to accounts@acme.example 3 days overdue)
- ✅ the demo history is there: Sent to the client, not viewed yet; the share link exists
- ✅ an overdue invoice can be sent again (Resend invoice) and marked as paid
- ✅ Mark as paid ends the overdue state: badge "Paid" (emerald), the timeline shows Paid, and there is no Send button any more
- ✅ the Outstanding card no longer has an overdue line; "Overdue" is an empty list
- ✅ the paid demo invoice INV-0001 (Globex): no Send button; timeline Created, Sent, Viewed and Paid are all done (and no reminder was sent) (["created:true","sent:true","reminder:false","viewed:true","paid:true"])
- ✅ its link shows a Paid badge to the client
- ✅ Phone: the timeline is vertical and fits the screen; no sideways scroll on the invoice page ({"stacked":true,"right":342} off=0)
- ✅ Phone: the action buttons wrap inside the screen
- ✅ Phone: the Send invoice modal fits the screen ({"left":16,"right":359,"top":33.34375,"bottom":633.640625})
- ✅ Phone: the invoices list with the Overdue chip fits the screen
- ✅ Phone: the public invoice stacks its lines, the Download PDF button is on screen, and nothing runs off the edge ({"stacked":true,"table":"none","btnRight":359,"btnLeft":207.125} overflow=0 off=0 innerWidth=375)
- ✅ isolated: no request went to the dev servers on 5000/5173
- ✅ no unexpected console/page errors

## Browser checks, Phase 1B: payment reminders, payment details, Pay now (72)

Script: [test-code/browser/phase-1b-reminders-and-payment.mjs](test-code/browser/phase-1b-reminders-and-payment.mjs). Raw output: [results/browser-checks-phase-1b-reminders-and-payment.txt](results/browser-checks-phase-1b-reminders-and-payment.txt). The hourly job is called the way the GitHub Action calls it: `curl -X POST -H "X-Cron-Secret: ..." .../api/cron/reminders` against the isolated backend (a wrong or missing secret is checked too). The e-mails were read back from the backend's output ([sample-emails/console-provider-output-phase-1b.txt](sample-emails/console-provider-output-phase-1b.txt)); the HTML e-mails rendered in Edge are in [sample-emails/](sample-emails) (made by [test-code/browser/render-reminder-emails.mjs](test-code/browser/render-reminder-emails.mjs)).

- ✅ npm run seed: the demo user now has reminders on and fake payment details
- ✅ test set-up: the due dates of the demo invoices INV-0002 and INV-0003 are moved 30 days ahead (in the throwaway database)
- ✅ the demo user: reminders 3 days before, on the due date, 7 and 14 after; a payment link, UPI ID and bank details
- ✅ the sent demo invoice INV-0002 is not paused and has no reminders yet
- ✅ curl without the secret, or with a wrong one: 401 and nothing runs (401/401)
- ✅ curl -X POST -H "X-Cron-Secret: ..." .../api/cron/reminders: 200 with { checked, sent, skipped, failed } ({"checked":0,"sent":0,"skipped":0,"failed":0,"ranAt":"2026-11-06T08:56:48.831Z"})
- ✅ Settings has a "Payment reminders" card and a "Payment details" card
- ✅ the reminder defaults: on, 3 days before, on the due date, chips 7 and 14 (30 is not picked)
- ✅ the summary line says what will happen (Clients get reminders 3 days before, on the due date, and 7 and 14 days after.)
- ✅ Save is disabled until something changes
- ✅ the summary follows the choices at once (Clients get reminders 5 days before, on the due date, and 14 and 30 days after.)
- ✅ Save: toast "Reminder settings saved"
- ✅ saved on the server: 5 days before, on the due date, [14, 30] ({"enabled":true,"beforeDueDays":5,"onDueDate":true,"afterDueDays":[14,30]})
- ✅ ...and it is still there after a reload
- ✅ switching the master toggle off: the options are disabled and the summary says reminders are off
- ✅ saved: reminders are off for this user
- ✅ the job with reminders off sends nothing (the invoice is skipped) ({"checked":1,"sent":0,"skipped":1,"failed":0,"ranAt":"2026-11-06T08:56:51.995Z"})
- ✅ Invoices list: a muted bell-off on both sent invoices ("Reminders are off in Settings")
- ✅ the payment card is filled in (from the demo data)
- ✅ an http:// link and a bad UPI ID are refused, each under its own field
- ✅ ...and nothing was saved
- ✅ a javascript: link is refused too
- ✅ while the UPI ID is still being typed there is no warning yet
- ✅ leaving the field shows the ID the way it will be saved: no spaces around it, lower case
- ✅ an unknown handle gets an amber warning that suggests the closest known one (We don't recognise "@okhdfcnk". Double-check your UPI ID — did you mean @okhdfcbank?)
- ✅ ...in amber (not the red of an error), announced politely, and the field has no error state ({"color":"oklch(0.555 0.163 48.998)","role":"status"})
- ✅ the warning does not stop the save: toast "Payment details saved", the ID is stored in lower case, and the warning is still there
- ✅ a handle that is not close to any known one: "Double-check your UPI ID." and no suggestion
- ✅ typing again hides the warning until the field is left
- ✅ a known handle (@okaxis) has no warning
- ✅ a wrongly formed ID is an error (red) and the amber warning stays away
- ✅ valid details save: toast "Payment details saved"
- ✅ ...and are stored as typed
- ✅ test set-up: INV-0002 is made due in 3 days (the throwaway database)
- ✅ timeline: Created, Sent, Reminder sent, Viewed, Paid
- ✅ before the job: "Next reminder: today, due in 3 days", no history, and the reminder step still to come (Next reminder: today, due in 3 days)
- ✅ the controls: a "Pause reminders" switch and a "Send reminder now" button
- ✅ the job (curl with the secret): 1 reminder sent ({"checked":1,"sent":1,"skipped":0,"failed":0,"ranAt":"2026-11-06T08:57:01.510Z"})
- ✅ the e-mail: to the client, "Reminder: INV-0002 is due in 3 days", the amount, a link to the invoice, Pay now and the UPI ID (["Reminder: INV-0002 is due in 3 days"])
- ✅ calling the job again (an hourly scheduler does) sends nothing more ({"checked":1,"sent":0,"skipped":1,"failed":0,"ranAt":"2026-11-06T08:57:01.588Z"})
- ✅ the page shows the reminder: "3 days before the due date", to the client, Sent (3 days before the due date 6 Nov 2026 · to accounts@acme.example Sent)
- ✅ the timeline now has "Reminder sent" with a date and "1 reminder so far" (Reminder sent 6 Nov 2026 1 reminder so far)
- ✅ the next one is on the due date (Next reminder: 9 Nov 2026, on the due date)
- ✅ "Send reminder now" within 24 hours of the automatic one: toast "You already sent a reminder in the last 24 hours", no e-mail
- ✅ a draft: "Reminders start once the invoice has been sent." and no pause or send buttons
- ✅ a paid invoice: "This invoice is paid, so there are no more reminders." and no buttons
- ✅ INV-0003 (due in 10 days): "Next reminder: <date>, due in 3 days" (Next reminder: 13 Nov 2026, due in 3 days)
- ✅ when the e-mail provider fails: toast "Couldn't send the email. Try again." and nothing is sent
- ✅ "Send reminder now": toast "Reminder sent to finance@initech.example"
- ✅ the e-mail went out (due in 10 days), the history says "Sent by you", and the timeline has the reminder (["Reminder: INV-0003 is due in 10 days"])
- ✅ "Pause reminders": toast, the switch is on, and the page says reminders are paused (Reminders are paused for this invoice.)
- ✅ saved on the server (remindersPaused)
- ✅ Invoices list: a bell on INV-0002, a muted bell-off on the paused INV-0003, none on the draft and the paid invoice ({"INV-0004":"none","INV-0002":"reminders-on","INV-0003":"reminders-off","INV-0001":"none"})
- ✅ ...the active bell is indigo and the paused one is muted grey ({"on":"oklch(0.511 0.262 276.966)","off":"oklch(0.869 0.022 252.894)"})
- ✅ the job skips a paused invoice (not even looked at) ({"checked":1,"sent":0,"skipped":1,"failed":0,"ranAt":"2026-11-06T08:57:17.113Z"})
- ✅ "Pause reminders" off again: toast "Reminders resumed"
- ✅ after resuming, the job sends the reminder that is due (and it counts as the day-of-send guard allows) ({"checked":2,"sent":0,"skipped":2,"failed":0,"ranAt":"2026-11-06T08:57:20.354Z"})
- ✅ the public invoice has a green "Pay now" button that opens the payment link in a new tab, safely ({"href":"https://rzp.io/l/alex-morgan","target":"_blank","rel":"noopener noreferrer","text":"Pay now","details":"OR PAY BY UPI alex.morgan@okhdfcbank BANK DETAILS Account name: Alex Morgan Bank: HDFC Bank Account no: 50100123456789 IFSC: HDFC0001234","heading":"Pay this invoice","bg":"oklch(0.596 0.145 163.225)"})
- ✅ ...with the UPI ID and the bank details below it (OR PAY BY UPI alex.morgan@okhdfcbank BANK DETAILS Account name: Alex Morgan Bank: HDFC Bank Account no: 50100123456789 IFSC: HDFC0001234)
- ✅ the order on the page: the invoice, then Pay now, then the details
- ✅ when printed: the Pay now button is hidden and the UPI / bank details stay on the page (one A4 page) ({"button":"none","details":"block","pages":1})
- ✅ black box: the public JSON has payment { link, upiId, bankDetails } and no other owner data
- ✅ without a payment link: no Pay now button, but the heading is "How to pay" and the UPI / bank details are there
- ✅ with nothing set up: no payment block at all
- ✅ a PAID invoice shows no payment block, even though the owner has payment details
- ✅ the invoice e-mail (Send invoice) has Pay now and the UPI ID as well
- ✅ Phone: the Settings page with the reminder and payment cards fits the screen (off=0)
- ✅ Phone: the invoice page with the reminders fits, and the 5-step timeline is vertical ({"five":5,"stacked":true} off=0)
- ✅ Phone: the invoices list with the bells fits the screen
- ✅ Phone: the Pay now button is full width, inside the screen, and nothing runs off the edge ({"left":37,"right":338,"width":301})
- ✅ isolated: no request went to the dev servers on 5000/5173
- ✅ no unexpected console/page errors

## Browser checks, Phase 1C: who owes me what (85)

Script: [test-code/browser/phase-1c-who-owes-what.mjs](test-code/browser/phase-1c-who-owes-what.mjs). Raw output: [results/browser-checks-phase-1c-who-owes-what.txt](results/browser-checks-phase-1c-who-owes-what.txt). The script runs the real seed command and compares what the screens show with what other routes say (the invoices list, the entries totals), so the numbers are not just compared with the app's own answer; due dates are moved in the throwaway database to fill every aging bucket.

- ✅ the demo has 3 invoices: Globex paid, Acme sent (not due yet), Initech sent and overdue (["INV-0002:sent:0","INV-0003:overdue:11","INV-0001:paid:0"])
- ✅ Initech's invoice is 7 to 13 days overdue (11)
- ✅ summary: outstanding is every sent invoice (Acme + Initech) ({"amount":1493.25,"count":2})
- ✅ summary: overdue is Initech's invoice, and it is the oldest one ({"amount":148.5,"count":1,"oldest":{"invoiceId":"6aed96791ed2744faadf3add","number":"INV-0003","clientId":"6aed96791ed2744faadf3a8a","clientName":"Initech","days":11,"amount":148.5}})
- ✅ summary: aging has Acme as current and Initech as 1-30 days ([{"key":"current","amount":1344.75,"count":1},{"key":"1-30","amount":148.5,"count":1},{"key":"31-60","amount":0,"count":0},{"key":"61+","amount":0,"count":0}])
- ✅ summary: the average days to get paid is Globex's (sent to paid, counted on the calendar) (9 vs 9)
- ✅ summary: paid this month is worked out from the paid date (Globex only counts when it was paid this month) ({"amount":0,"count":0})
- ✅ clients: Initech (overdue) first, then Acme (owes), then Globex (all paid) (Initech,Acme Corp,Globex Ltd)
- ✅ clients: the unbilled amounts add up to the unbilled total of the time entries (worked out by a different route) (3577.42 vs 3577.42)
- ✅ clients: Initech has an overdue invoice, last payment none; Globex paid and nothing owed
- ✅ another user's client is a 404 with the same answer as one that does not exist (404/404)
- ✅ a stranger sees none of the demo numbers
- ✅ no login, no numbers (401)
- ✅ Dashboard: a red banner "1 invoice overdue · $X", and the oldest one ("Initech, N days") (1 invoice overdue · $148.50 | Oldest: Initech, 11 days)
- ✅ ...tinted red, at the top: above the timer
- ✅ ...with a "View overdue" button that goes to the Overdue filter of Invoices
- ✅ Money row: Outstanding (both sent invoices) with its note ({"label":"OUTSTANDING","value":"$1,493.25","note":"2 unpaid invoices"})
- ✅ Money row: Overdue is red, with "1 invoice · oldest N days" ({"label":"OVERDUE","value":"$148.50","note":"1 invoice · oldest 11 days"})
- ✅ Money row: Paid this month is emerald when there is something ({"label":"PAID THIS MONTH","value":"$0.00","note":"0 invoices"})
- ✅ Money row: the average days to get paid, over the last 90 days ({"label":"AVG. DAYS TO GET PAID","value":"9 days","note":"last 90 days · 1 invoice"})
- ✅ Aging bar legend: Current has Acme's invoice, 1–30 days has Initech's, the others are empty ({"current":{"amount":"$1,344.75","count":"1 invoice"},"1-30":{"amount":"$148.50","count":"1 invoice"},"31-60":{"amount":"$0.00","count":"0 invoices"},"61+":{"amount":"$0.00","count":"0 invoices"}})
- ✅ Aging bar: one stacked bar with a part for each bucket that has money, as wide as its share ([["current","90%"],["1-30","10%"]])
- ✅ Aging bar: a text alternative for screen readers
- ✅ Sidebar: a small red "1" badge next to Invoices (and nothing on the other items) ({"text":"1","label":"1 overdue invoice","bg":"oklch(0.577 0.245 27.325)","rect":{"x":214,"y":307,"width":18,"height":18,"top":307,"right":232,"bottom":325,"left":214}})
- ✅ Sidebar: the badge sits inside the Invoices link
- ✅ Dismiss (X): the banner goes, and the money cards and the badge stay
- ✅ ...for the day: it is remembered in the browser (today's date)
- ✅ ...and still hidden after a reload
- ✅ ...a dismissal from another day does not count: the banner is back tomorrow
- ✅ View overdue: Invoices opens with the Overdue filter already on, showing only the overdue invoice
- ✅ an unknown ?status= is ignored (All is on)
- ✅ Clients: sorted "Overdue first" by default: Initech, Acme Corp, Globex Ltd
- ✅ Initech: red "Overdue", its overdue amount with "N days", unbilled amount, no payment yet ({"status":"Overdue","outstanding":"$148.50","overdue":"$148.50 11 days","unbilled":"$495.00","last":"—","href":"/clients/6aed96791ed2744faadf3a8a"})
- ✅ Acme Corp: amber "Owes $X", nothing overdue ({"status":"Owes $1,344.75","outstanding":"$1,344.75","overdue":"—","unbilled":"$1,551.75","last":"—","href":"/clients/6aed96791ed2744faadf3a88"})
- ✅ Globex Ltd: emerald "All paid" with the date of the last payment ({"status":"All paid","outstanding":"$0.00","overdue":"—","unbilled":"$1,530.67","last":"21 Oct 2026","href":"/clients/6aed96791ed2744faadf3a89"})
- ✅ ...the colours are red, amber and emerald ({"Initech":"oklch(0.505 0.213 27.518)","Acme Corp":"oklch(0.555 0.163 48.998)","Globex Ltd":"oklch(0.508 0.118 165.612)"})
- ✅ the old things are still there: project count, company, e-mail, Edit and Delete
- ✅ Sort "Outstanding": the biggest amount owed first, whoever is late
- ✅ Sort "Name": alphabetical
- ✅ Filter "Owes me money": only the clients with something outstanding
- ✅ ...and the chip switches it off again
- ✅ Clicking a client opens /clients/:id
- ✅ Client page: the name, and the contact (company and e-mail)
- ✅ Four metric cards: Outstanding, Overdue, Unbilled and Paid, with the same numbers as the API ({"out":{"label":"OUTSTANDING","value":"$1,344.75","note":"1 unpaid invoice"},"over":{"label":"OVERDUE","value":"$0.00","note":"Nothing is late"},"unb":{"label":"UNBILLED","value":"$1,551.75","note":"27h 51m in 18 entries"},"paid":{"label":"PAID","value":"$0.00","note":"No payments yet"}})
- ✅ ...the Unbilled card says how much time that is (27h 51m in 18 entries)
- ✅ Its invoices, with status badges
- ✅ Two buttons: "New invoice" and, because there is unbilled time, "Invoice unbilled time"
- ✅ "New invoice" opens the modal with this client already chosen
- ✅ "Invoice unbilled time": the client and the days of the unbilled time are filled in ({"client":"6aed96791ed2744faadf3a88","from":"2026-10-26","to":"2026-11-06","total":"$1,551.75"})
- ✅ ...and the preview total is exactly the unbilled amount of the card ($1,551.75 vs $1,551.75)
- ✅ A client that does not exist: "Client not found" with a way back
- ✅ Somebody else's client looks the same: "Client not found", no name, no numbers
- ✅ A broken id is "Client not found" too
- ✅ Creating the invoice from "Invoice unbilled time" bills all of Initech's unbilled time (the new invoice is as big as the card said)
- ✅ ...and the client page now has nothing unbilled and no "Invoice unbilled time" button
- ✅ (set-up) two more invoices were made from unbilled time and sent ([{"number":"INV-0005","status":200},{"number":"INV-0006","status":200}])
- ✅ (set-up) one unpaid invoice in every bucket ({"current":1,"1-30":1,"31-60":1,"61+":1})
- ✅ Aging: the legend has the amounts and counts of every bucket (worked out from the invoices list) ({"current":{"amount":"$1,530.67","count":"1 invoice"},"1-30":{"amount":"$1,551.75","count":"1 invoice"},"31-60":{"amount":"$1,344.75","count":"1 invoice"},"61+":{"amount":"$148.50","count":"1 invoice"}})
- ✅ Aging: four parts in order, each as wide as its share of everything unpaid (within 1.5%) ([["current","33%"],["1-30","34%"],["31-60","29%"],["61+","3%"]])
- ✅ ...in four different colours, from emerald to red (["oklch(0.696 0.17 162.48)","oklch(0.828 0.189 84.429)","oklch(0.705 0.213 47.604)","oklch(0.577 0.245 27.325)"])
- ✅ The banner counts every overdue invoice and names the oldest (Initech, 70 days) (3 invoices overdue · $3,045.00)
- ✅ The sidebar badge shows the count
- ✅ Clients: ordered by overdue amount (the API and the page agree) (Acme Corp,Initech,Globex Ltd | Acme Corp,Initech,Globex Ltd)
- ✅ Phone: the banner and the Money cards fit; the four cards stack in one column (overflow=0 off=0 [343,343,343,343])
- ✅ Phone: the "View overdue" button is full width inside the banner ([33,300])
- ✅ Phone: the aging bar is as wide as the card and the legend sits in two columns, readable and inside the screen ([{"left":33,"top":77,"right":180},{"left":196,"top":77,"right":342},{"left":33,"top":143,"right":180},{"left":196,"top":143,"right":342}])
- ✅ Phone: the badge is on the Invoices tab of the bottom bar, in the corner of its icon, inside the screen ({"text":"1","label":"1 overdue invoice","bg":"oklch(0.577 0.245 27.325)","rect":{"x":347.75,"y":612,"width":18,"height":18,"top":612,"right":365.75,"bottom":630,"left":347.75}})
- ✅ Phone: the clients page fits; each row has its four figures in two columns (overflow=0 off=0)
- ✅ Phone: a client page fits; the four metric cards stack, the invoices list is readable (overflow=0 off=0)
- ✅ Phone at 360px: the dashboard still fits (overflow=0 off=0)
- ✅ (before) the badge shows 1
- ✅ Mark as paid: the badge in the sidebar disappears at once (no reload)
- ✅ Dashboard after paying: no banner, Overdue $0.00 ("Nothing is late"), Paid this month has the new payment ({"label":"PAID THIS MONTH","value":"$148.50","note":"1 invoice"})
- ✅ ...and the aging bar only has Acme's invoice left (current)
- ✅ ...the average days to get paid now covers both payments (Globex's and the one just made) ({"days":17,"count":2,"windowDays":90})
- ✅ Clients: only Acme still owes money
- ✅ Clients: when everybody has paid, "Owes me money" says so and offers "Show all clients"
- ✅ A new user: no banner, no badge, zeros in the cards, "—" for the average ([{"label":"OUTSTANDING","value":"$0.00","note":"0 unpaid invoices"},{"label":"AVG. DAYS TO GET PAID","value":"—","note":"no payments in the last 90 days"}])
- ✅ ...and an aging bar with nothing in it (all four buckets $0.00)
- ✅ A client that was never invoiced: "No invoices yet", zero figures (F First Client No invoices yet 0 projects first@client.example Outstanding $0.00 Overdue — Unbilled — Last payment —)
- ✅ Its page: zeros, "No invoices yet", and no "Invoice unbilled time" button (nothing to bill)
- ✅ Storage blocked: the banner still shows, can be dismissed for this visit, and nothing breaks
- ✅ ...it simply comes back after a reload (nothing could be remembered)
- ✅ isolated: no request went to the dev servers on 5000/5173
- ✅ no unexpected console/page errors

## Screenshots, Step 2: authentication

**Login page (desktop): no demo hint unless VITE_SHOW_DEMO=true**

![Login page (desktop): no demo hint unless VITE_SHOW_DEMO=true](screenshots/step-2-auth/01-login-desktop.png)

**The same login page from a build made with VITE_SHOW_DEMO=true: the "Demo: ..." hint**

![The same login page from a build made with VITE_SHOW_DEMO=true: the "Demo: ..." hint](screenshots/step-2-auth/01b-login-with-demo-hint-desktop.png)

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

**Demo data: time entries over the four weeks, with the totals and the unbilled amount that is ready to invoice**

![Demo data: time entries over the four weeks, with the totals and the unbilled amount that is ready to invoice](screenshots/step-8-seed-and-rounding/03-demo-time-entries-desktop.png)

**Demo data: a PAID invoice for Globex, a SENT one for Acme and an OVERDUE one for Initech, all made by the real invoice service**

![Demo data: a PAID invoice for Globex, a SENT one for Acme and an OVERDUE one for Initech, all made by the real invoice service](screenshots/step-8-seed-and-rounding/04-demo-invoices-desktop.png)

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

## Screenshots, Phase 1A: send by e-mail, public link, overdue

The public invoice as the client prints it: [sample-pdfs/public-invoice-as-the-client-prints-it.pdf](sample-pdfs/public-invoice-as-the-client-prints-it.pdf).

**Invoices: a red "3 days overdue" badge, the Overdue filter chip, and the overdue amount in red under Outstanding**

![Invoices: a red "3 days overdue" badge, the Overdue filter chip, and the overdue amount in red under Outstanding](screenshots/phase-1a-send-share-overdue/01-invoices-list-overdue-desktop.png)

**A draft invoice: "Send invoice" is the main button; the timeline shows only Created, and there is no share link yet**

![A draft invoice: "Send invoice" is the main button; the timeline shows only Created, and there is no share link yet](screenshots/phase-1a-send-share-overdue/02-invoice-draft-send-button-desktop.png)

**Send invoice: To is filled in with the client's email, with CC, a personal message and the subject preview; a bad CC address is refused under its field**

![Send invoice: To is filled in with the client's email, with CC, a personal message and the subject preview; a bad CC address is refused under its field](screenshots/phase-1a-send-share-overdue/03-send-invoice-cc-error-desktop.png)

**When the email provider fails: "Couldn't send the email. Try again.", the form stays open with what was typed, and the invoice stays a draft**

![When the email provider fails: "Couldn't send the email. Try again.", the form stays open with what was typed, and the invoice stays a draft](screenshots/phase-1a-send-share-overdue/04-send-failed-desktop.png)

**After sending: toast gone, status Sent, the timeline shows when and to whom, and the share link with Copy and Regenerate**

![After sending: toast gone, status Sent, the timeline shows when and to whom, and the share link with Copy and Regenerate](screenshots/phase-1a-send-share-overdue/05-invoice-sent-timeline-desktop.png)

**What the client sees from the link: no login, no sidebar, the same invoice, a Download PDF button**

![What the client sees from the link: no login, no sidebar, the same invoice, a Download PDF button](screenshots/phase-1a-send-share-overdue/06-public-invoice-desktop.png)

**The public page as printed (A4 width): the button bar and the footer are gone**

![The public page as printed (A4 width): the button bar and the footer are gone](screenshots/phase-1a-send-share-overdue/07-public-invoice-print-preview.png)

**After the client opened the link, the owner's timeline shows Viewed with the date**

![After the client opened the link, the owner's timeline shows Viewed with the date](screenshots/phase-1a-send-share-overdue/08-timeline-viewed-desktop.png)

**An unknown or replaced link: "This invoice link is not valid", still without the app layout**

![An unknown or replaced link: "This invoice link is not valid", still without the app layout](screenshots/phase-1a-send-share-overdue/09-public-invoice-not-valid-desktop.png)

**Regenerate link asks first: the current link stops working at once**

![Regenerate link asks first: the current link stops working at once](screenshots/phase-1a-send-share-overdue/10-regenerate-confirm-desktop.png)

**An overdue invoice: red "3 days overdue" badge, the Sent step of the timeline says so too, and it can be resent**

![An overdue invoice: red "3 days overdue" badge, the Sent step of the timeline says so too, and it can be resent](screenshots/phase-1a-send-share-overdue/11-invoice-overdue-desktop.png)

**Phone (375px): the invoice page with a vertical timeline and wrapping buttons**

![Phone (375px): the invoice page with a vertical timeline and wrapping buttons](screenshots/phase-1a-send-share-overdue/12-invoice-sent-mobile.png)

**Phone: the Send invoice modal fits the screen**

![Phone: the Send invoice modal fits the screen](screenshots/phase-1a-send-share-overdue/13-send-modal-mobile.png)

**Phone: the invoices list with the Overdue chip**

![Phone: the invoices list with the Overdue chip](screenshots/phase-1a-send-share-overdue/14-invoices-list-mobile.png)

**Phone: the public invoice, the top of the page with its Download PDF button**

![Phone: the public invoice, the top of the page with its Download PDF button](screenshots/phase-1a-send-share-overdue/15-public-invoice-mobile.png)

**Phone: the whole public invoice; the line items become stacked rows**

![Phone: the whole public invoice; the line items become stacked rows](screenshots/phase-1a-send-share-overdue/16-public-invoice-mobile-full.png)

**The invoice email (HTML version) rendered in Edge: amount, due date, personal message and a big View invoice button**

![The invoice email (HTML version) rendered in Edge: amount, due date, personal message and a big View invoice button](screenshots/phase-1a-send-share-overdue/17-invoice-email-desktop.png)

**The same email at phone width**

![The same email at phone width](screenshots/phase-1a-send-share-overdue/18-invoice-email-mobile.png)

## Screenshots, Phase 1B: payment reminders, payment details, Pay now

The client's public page as printed (the Pay now button is hidden, the payment details stay): [sample-pdfs/public-invoice-with-payment-details.pdf](sample-pdfs/public-invoice-with-payment-details.pdf).

**Settings: the new "Payment reminders" card under the profile: a master switch and "Remind 3 days before"**

![Settings: the new "Payment reminders" card under the profile: a master switch and "Remind 3 days before"](screenshots/phase-1b-reminders-and-payment/01-settings-reminders-desktop.png)

**Settings: the "Payment details" card (payment link, UPI ID, bank details), filled in from the demo data**

![Settings: the "Payment details" card (payment link, UPI ID, bank details), filled in from the demo data](screenshots/phase-1b-reminders-and-payment/02-settings-payment-desktop.png)

**An http:// link and a bad UPI ID are refused, each under its own field, and nothing is saved**

![An http:// link and a bad UPI ID are refused, each under its own field, and nothing is saved](screenshots/phase-1b-reminders-and-payment/03-settings-payment-errors-desktop.png)

**A UPI ID with a handle we do not know (@okhdfcnk): an amber warning under the field, "did you mean @okhdfcbank?"; the ID is shown the way it is saved (lower case, no spaces) and the details can still be saved**

![A UPI ID with a handle we do not know (@okhdfcnk): an amber warning under the field, "did you mean @okhdfcbank?"; the ID is shown the way it is saved (lower case, no spaces) and the details can still be saved](screenshots/phase-1b-reminders-and-payment/03b-settings-upi-warning-desktop.png)

**A sent invoice: "Next reminder: today, due in 3 days", with Pause reminders and Send reminder now; the timeline has the new "Reminder sent" step**

![A sent invoice: "Next reminder: today, due in 3 days", with Pause reminders and Send reminder now; the timeline has the new "Reminder sent" step](screenshots/phase-1b-reminders-and-payment/04-invoice-reminders-before-desktop.png)

**After the hourly job ran (curl with the secret): the reminder is in the history as Sent, the timeline says "1 reminder so far", and the next one is on the due date**

![After the hourly job ran (curl with the secret): the reminder is in the history as Sent, the timeline says "1 reminder so far", and the next one is on the due date](screenshots/phase-1b-reminders-and-payment/05-invoice-reminder-sent-desktop.png)

**When the e-mail provider fails, "Send reminder now" shows "Couldn't send the email. Try again." and sends nothing**

![When the e-mail provider fails, "Send reminder now" shows "Couldn't send the email. Try again." and sends nothing](screenshots/phase-1b-reminders-and-payment/06-send-reminder-failed-desktop.png)

**Invoices list: an indigo bell on a sent invoice with reminders on, a muted bell-off on the paused one, none on the draft and the paid invoice**

![Invoices list: an indigo bell on a sent invoice with reminders on, a muted bell-off on the paused one, none on the draft and the paid invoice](screenshots/phase-1b-reminders-and-payment/07-invoices-list-bells-desktop.png)

**The client's page: below the invoice a green "Pay now" button (opens the payment link in a new tab), the UPI ID and the bank details**

![The client's page: below the invoice a green "Pay now" button (opens the payment link in a new tab), the UPI ID and the bank details](screenshots/phase-1b-reminders-and-payment/08-public-pay-now-desktop.png)

**Without a payment link: no button, the block is called "How to pay" and shows the UPI ID and bank details**

![Without a payment link: no button, the block is called "How to pay" and shows the UPI ID and bank details](screenshots/phase-1b-reminders-and-payment/09-public-how-to-pay-no-link-desktop.png)

**Phone (375px): the Payment reminders card**

![Phone (375px): the Payment reminders card](screenshots/phase-1b-reminders-and-payment/10-settings-reminders-mobile.png)

**Phone: the Payment details card**

![Phone: the Payment details card](screenshots/phase-1b-reminders-and-payment/11-settings-payment-mobile.png)

**Phone: the invoice page with the five-step timeline stacked vertically (Created, Sent, Reminder sent, Viewed, Paid)**

![Phone: the invoice page with the five-step timeline stacked vertically (Created, Sent, Reminder sent, Viewed, Paid)](screenshots/phase-1b-reminders-and-payment/12-invoice-reminders-mobile.png)

**Phone: the Pay now button is full width and the payment details fit the screen**

![Phone: the Pay now button is full width and the payment details fit the screen](screenshots/phase-1b-reminders-and-payment/13-public-pay-now-mobile.png)

**The reminder e-mail "Reminder: INV-0003 is due in 3 days" rendered in Edge: amount, due date, View invoice, a green Pay now button and the UPI / bank details**

![The reminder e-mail "Reminder: INV-0003 is due in 3 days" rendered in Edge: amount, due date, View invoice, a green Pay now button and the UPI / bank details](screenshots/phase-1b-reminders-and-payment/14-reminder-email-desktop.png)

**The same reminder e-mail at phone width**

![The same reminder e-mail at phone width](screenshots/phase-1b-reminders-and-payment/15-reminder-email-mobile.png)

**An overdue reminder ("INV-0003 is 7 days overdue") for an owner without a payment link: no Pay now button, a "How to pay" block**

![An overdue reminder ("INV-0003 is 7 days overdue") for an owner without a payment link: no Pay now button, a "How to pay" block](screenshots/phase-1b-reminders-and-payment/16-reminder-email-overdue-no-link-desktop.png)

**The invoice e-mail now has the Pay now button and the payment details too**

![The invoice e-mail now has the Pay now button and the payment details too](screenshots/phase-1b-reminders-and-payment/17-invoice-email-pay-now-desktop.png)

## Screenshots, Phase 1C: who owes me what

**Dashboard with an overdue invoice: the red alert at the top ("1 invoice overdue · $148.50", the oldest one, View overdue), the Money cards, the aging bar, and the red 1 on Invoices in the sidebar**

![Dashboard with an overdue invoice: the red alert at the top ("1 invoice overdue · $148.50", the oldest one, View overdue), the Money cards, the aging bar, and the red 1 on Invoices in the sidebar](screenshots/phase-1c-who-owes-what/01-dashboard-overdue-desktop.png)

**The alert dismissed for the day (the X): the Money cards, the aging bar and the sidebar badge stay**

![The alert dismissed for the day (the X): the Money cards, the aging bar and the sidebar badge stay](screenshots/phase-1c-who-owes-what/02-banner-dismissed-desktop.png)

**View overdue opens Invoices with the Overdue filter already on, showing only the overdue invoice**

![View overdue opens Invoices with the Overdue filter already on, showing only the overdue invoice](screenshots/phase-1c-who-owes-what/03-invoices-overdue-filter-desktop.png)

**Clients as "who owes me what": the late client first (red Overdue, its overdue amount and days), then Acme Corp (Owes $1,344.75), then Globex Ltd (All paid, with its last payment date); every row shows its unbilled amount**

![Clients as "who owes me what": the late client first (red Overdue, its overdue amount and days), then Acme Corp (Owes $1,344.75), then Globex Ltd (All paid, with its last payment date); every row shows its unbilled amount](screenshots/phase-1c-who-owes-what/04-clients-desktop.png)

**The "Owes me money" filter: only the clients with something outstanding**

![The "Owes me money" filter: only the clients with something outstanding](screenshots/phase-1c-who-owes-what/05-clients-owes-me-money-desktop.png)

**A client's page: the contact, four metric cards (Outstanding, Overdue, Unbilled, Paid), its invoices with their status, and the New invoice and Invoice unbilled time buttons**

![A client's page: the contact, four metric cards (Outstanding, Overdue, Unbilled, Paid), its invoices with their status, and the New invoice and Invoice unbilled time buttons](screenshots/phase-1c-who-owes-what/06-client-detail-desktop.png)

**"Invoice unbilled time" opens New invoice with the client and the exact days of the unbilled time filled in; the preview total is the amount on the Unbilled card**

!["Invoice unbilled time" opens New invoice with the client and the exact days of the unbilled time filled in; the preview total is the amount on the Unbilled card](screenshots/phase-1c-who-owes-what/07-invoice-unbilled-time-modal-desktop.png)

**A client that does not exist (or belongs to somebody else): "Client not found", with no name and no numbers**

![A client that does not exist (or belongs to somebody else): "Client not found", with no name and no numbers](screenshots/phase-1c-who-owes-what/08-client-not-found-desktop.png)

**An unpaid invoice in every bucket (due dates moved in the throwaway database): the bar has four parts as wide as their amounts, "3 invoices overdue · $2,988.75", the oldest is 70 days, and the badge says 3**

![An unpaid invoice in every bucket (due dates moved in the throwaway database): the bar has four parts as wide as their amounts, "3 invoices overdue · $2,988.75", the oldest is 70 days, and the badge says 3](screenshots/phase-1c-who-owes-what/09-dashboard-all-buckets-desktop.png)

**The clients after that: ordered by what is overdue, with the days of the oldest overdue invoice**

![The clients after that: ordered by what is overdue, with the days of the oldest overdue invoice](screenshots/phase-1c-who-owes-what/10-clients-spread-desktop.png)

**Phone (375px): the overdue alert with a full-width View overdue button, and the red badge on the Invoices tab of the bottom bar**

![Phone (375px): the overdue alert with a full-width View overdue button, and the red badge on the Invoices tab of the bottom bar](screenshots/phase-1c-who-owes-what/11-dashboard-mobile.png)

**Phone: the aging bar and its legend in two columns, readable and inside the screen**

![Phone: the aging bar and its legend in two columns, readable and inside the screen](screenshots/phase-1c-who-owes-what/12-aging-bar-mobile.png)

**Phone: the clients with their four figures in two columns**

![Phone: the clients with their four figures in two columns](screenshots/phase-1c-who-owes-what/13-clients-mobile.png)

**Phone: a client's page with its metric cards stacked**

![Phone: a client's page with its metric cards stacked](screenshots/phase-1c-who-owes-what/14-client-detail-mobile.png)

**After "Mark as paid" on the overdue invoice (no reload): the alert and the badge are gone, Overdue is $0.00, and the payment is under Paid this month and in the average**

![After "Mark as paid" on the overdue invoice (no reload): the alert and the badge are gone, Overdue is $0.00, and the payment is under Paid this month and in the average](screenshots/phase-1c-who-owes-what/15-dashboard-all-paid-desktop.png)

**Everybody has paid: the "Owes me money" filter says "Nobody owes you money" and offers Show all clients**

![Everybody has paid: the "Owes me money" filter says "Nobody owes you money" and offers Show all clients](screenshots/phase-1c-who-owes-what/16-clients-nobody-owes-desktop.png)

**A brand-new user: no alert, zeros in the cards, a dash for the average and an empty aging bar**

![A brand-new user: no alert, zeros in the cards, a dash for the average and an empty aging bar](screenshots/phase-1c-who-owes-what/17-dashboard-new-user-desktop.png)

## Re-running the browser checks

The scripts in [test-code/browser/](test-code/browser) are a snapshot of what was run. To run them again you need Microsoft Edge (the path is set in `launch-edge.mjs`, which every script imports and which must stay next to them) and `npm install puppeteer-core` next to them. Then:

1. Build the frontend for the test ports and serve it: set `VITE_API_URL=http://localhost:5100/api`, run `npm run build -- --outDir <some folder> --emptyOutDir` in `frontend/`, then `npm run preview -- --outDir <some folder> --port 5273 --strictPort`. The Step 2 script also wants a second build made with `VITE_SHOW_DEMO=true`, served on port 5274 (or the address in `E2E_BASE_DEMO`), to check that the login hint appears only there.
2. From `backend/`, run `node <path to>/start-isolated-backend.mjs` (in-memory database, as a replica set, port 5100).
3. Run `node step-2-auth.mjs`, `node step-3-layout-clients-projects.mjs`, `node step-4-timer.mjs`, `node step-5-time-entries.mjs`, `node step-6-timesheet.mjs`, `node step-7-invoices.mjs`, `node step-8-seed-and-rounding.mjs`, `node phase-1a-send-share-overdue.mjs`, `node phase-1b-reminders-and-payment.mjs` and `node phase-1c-who-owes-what.mjs`. (Steps 5 and 8 and Phases 1A and 1B also need the in-memory database's address, and Phases 1A and 1B read the e-mails from the backend's output, so save that output to a file and give its path in `E2E_BACKEND_LOG`. The isolated backend sets `CRON_SECRET` for the reminder job (the value is in the script, or in `E2E_CRON_SECRET`; Phase 1B reads it from the same variable). For the address: start the backend with the environment variable `E2E_MONGO_URI_FILE` set to a file path; the script reads the address from that file.) Each prints PASS/FAIL per check and writes its screenshots next to the script.
