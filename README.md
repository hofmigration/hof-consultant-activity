# Consultant activity report

Every morning at about **11:00 (Pakistan time), Monday to Saturday**, you get one email with what
each consultant did in HubSpot the day before, **by team**. Monday's email covers Saturday and Sunday.
It reports on the people in the nine teams in `config.js` (55 people), and nobody else. People with no
activity are not shown.

For each consultant, each day:

| | |
|---|---|
| **Calls** | the raw number of call records |
| **Contacts** | the different contacts linked to those calls |
| **Deals** | the different deals linked to those calls |
| **Connected** / **No answer** | calls with that call outcome |
| **Lead stage marked** | contacts whose Lead Stage they changed to **No Answer**, **They Didn't Fill**, **Qualified** or **Ineligible** (changes to other stages are in the workbook) |
| **Emails sent** | emails they sent themselves, and how many of those were on a deal and on a contact |
| **Sequence** | emails sent by a HubSpot sequence in their name, counted separately |
| **Deals touched** | the different deals they called, emailed, WhatsApped, noted, completed a task on, met about, or moved |
| **CCL Sent** | deals they moved to CCL Sent |
| **Deal Lost** | deals they moved to Deal Lost |
| **Tasks done** | tasks they completed that day |
| **Due today** | their open tasks due on the day the email is sent (Tuesday's email: due Tuesday) |
| **Overdue** | all their open tasks due before that day, however old |
| **No Answer leads** | the leads they own whose Lead Stage is No Answer right now, out of all leads created from 1 January 2026 up to the moment the email is sent (Monday's email: 1 Jan to Monday; Tuesday's: 1 Jan to Tuesday) |

The email has the team at a glance, then three tables (Calls and No Answer leads; Lead stages and
deals; Emails and tasks), each with a row per team showing the team's totals and its people under it. The Excel workbook
attached to it has the same by team, and lists every call (with the number dialled), every email,
every lead stage change, every CCL Sent and Deal Lost move, every deal touched and every task due
today, with links into HubSpot.

It only reads HubSpot. Nothing in HubSpot is changed.

---

## Setting it up (once)

1. Create a new **private** repo, for example `hof-consultant-activity`. The workbook has client
   names and phone numbers, so the repo must stay private.
2. Upload these files to the root of the repo:
   `config.js`, `0-hubspot.js`, `1-clock.js`, `2-collect.js`, `3-count.js`, `4-workbook.js`,
   `5-email.js`, `report.js`, `selftest.js`, `package.json`
3. Click **Add file → Create new file** and name it `.github/workflows/consultant-activity.yml`
   (typing the slashes creates the folders). Paste in the contents of `consultant-activity.yml`.
4. Go to **Settings → Secrets and variables → Actions** and add the same secrets your other agents use:

| Secret | |
|---|---|
| `HUBSPOT_TOKEN` | the HOF private app token |
| `RESEND_KEY` | the key your other reports send with |

That is all. The first email arrives at about 11:00 the next working morning.
(`preview-email.html` shows the layout with invented numbers; it does not go in the repo.)

## Running it yourself, with filters

Go to **Actions → Consultant activity → Run workflow**:

- **Which days**: *Yesterday* (Monday: Saturday and Sunday), *Today so far*, *Last 7 days*,
  *This month so far*, *Last month*, or *Custom dates*.
- **first day / last day**: for any day or range, for example `2026-11-02` and `2026-11-04`. A date
  typed here always wins over the choice above. Leave the last day empty for a single day.
- **consultants**: `all`, or names or teams separated by commas, for example `Fazal, Fatima Zahid`
  or `Fahad Butt's Team` (or just `Fahad team`). Part of a name is fine if only one person matches;
  if a name matches two people (`Insha`), the run stops and lists them. HubSpot owner ids work too.
  Only people in the teams can be picked.
- **Email the report**: untick it to only build the workbook (download it from the run page, under
  **Artifacts**).

A day takes about 2 to 4 minutes. A whole month takes longer (10 to 20 minutes).

---

## How each number is counted

- **Days** run midnight to midnight, Pakistan time.
- **Teams** are the nine teams in `config.js`, in that order. Someone in two teams (Aliza Ali,
  Patrecia Haddad) shows under both, and the *All consultants* row counts them once. A team row adds
  up the people under it. Anyone with no activity in the period is left out, and so is a team with
  nobody left; the email says how many people were left out.
- **No Answer leads** are counted when the report runs: contacts the consultant owns whose Lead Stage
  is *No Answer* right now, created in HubSpot from 1 January 2026 to that moment. The start date is
  `NO_ANSWER_LEADS_FROM` in `config.js` (change it to `2027-01-01` next year if you want a fresh
  count). They are counted, not listed.
- **Tasks**: *Done* counts tasks completed in the period. *Due today* and *Overdue* are counted when
  the report runs: open tasks due on the day the email is sent, and every open task due before that
  day, however old. A task is open until it is marked completed. The tasks due today are listed in the
  workbook; overdue ones are only counted.
- **Calls are raw.** The ZIWO dialler logs every dial itself, and many consultants also log the same
  call by hand, so one dial often appears twice. The workbook splits the raw number into *Through the
  dialler* and *Logged by hand*, and every call row says which it is. Inbound calls are listed but are
  not counted as calls made.
- **Connected** counts the outcomes *Connected* and *Meeting booked*. **No answer** counts *No answer*.
  Busy, Wrong number and the others are in the workbook.
- **Lead stage marked** is read from each contact's change history: the consultant changed the Lead
  Stage to that value during the day. A contact marked twice in a day counts once.
  - A change made by a HubSpot user counts for that user.
  - A change with no user on it (made through an app or the API) counts for whoever owned the contact then.
  - Changes made by **workflows**, imports and forms count for nobody. They are still listed in the
    workbook when they happened on a contact the consultant worked that day, marked *Not counted*.
  - **Qualified** means any of: Qualified CAN, Qualified AUS, USA NIW, Qualified Spain, Germany
    Opportunity Card, Visit Visa, Work Permit, Portugal D2/D8.
  - **Ineligible** means the Lead Stage *Ineligible* only. Occupation Not Listed, Outside GCC and the
    other stages are in the workbook.
- **Emails sent** are outgoing emails the consultant sent themselves. Sequence emails are counted
  separately (some consultants send hundreds a day by sequence). A bounced email still counts as
  sent; failed, cancelled and scheduled emails do not. *On deals* and *On contacts* are how many of
  those emails are linked to a deal and to a contact; one email is usually linked to both.
- **CCL Sent** is read from each deal's stage history: a move into a stage called *CCL Sent* (Canada &
  AUS and USA NIW pipelines). A move made by a workflow or an app counts for the deal's owner. A move
  made by someone outside the list (a manager) is listed in the workbook but not counted.
- **Deal Lost** is read the same way: a move into the *Deal Lost* stage of a sales pipeline (the Visit
  pipeline calls it *Lost*). A move made by a HubSpot user counts for that user. A move made by a
  **workflow** counts for nobody, and neither does a move by someone outside the list; both are listed
  in the workbook, and the email says how many there were.
- For a period longer than a day, contacts, deals and lead stages count each record once per
  consultant over the whole period. The workbook also has the team and each consultant day by day.

Every rule is also written in the **How it was counted** tab of each workbook.

## Changing things

Everything is in `config.js`, in plain words:

- **Who**: the `TEAMS` list. Add, move or remove people there; only people in a team are reported.
  Each person needs their HubSpot owner id (Claude can look it up for you).
- **Days off**: `DAYS_OFF` (Sunday). If the team stops working Saturdays, set it to `[6, 0]` and
  change the schedule in the workflow file to `"35 5 * * 1-5"`.
- **Time**: the `cron` line in the workflow file is in UTC. `35 5` is 10:35 in Pakistan; GitHub
  usually starts scheduled runs a few minutes late.
- **Which stages count as qualified** or ineligible, which call outcomes count as connected, and whether
  automatic CCL Sent and Deal Lost moves count for the deal owner.

## If something looks wrong

- The run page (**Actions → the run**) shows the same table as the email, and any warnings.
- `selftest.js` runs before every report. It checks every counting rule, then runs the whole report
  against a fake HubSpot and checks every number. If it fails, no email is sent.
- If HubSpot cannot be read for WhatsApp, notes, tasks or meetings, the email says so at the top and
  the report goes out without them. If calls or emails cannot be read, the run stops instead of
  sending wrong numbers.
