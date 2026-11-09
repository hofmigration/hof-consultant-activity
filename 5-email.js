// 5-email.js — the daily email, in the house report style: navy hero, soft rounded numbers,
// the team at a glance, then every consultant's numbers in two compact tables. Tables and
// inline styles only, so it survives Gmail. Every record behind it is in the attached workbook.
const { SETTINGS } = require("./config");
const { fmtDayShort, fmtTime, dateKey, MONTHS } = require("./1-clock");
// "2026-01-01" -> "1 Jan" and "1 January 2026"
const naSince = (() => { const [y, m, d] = String(SETTINGS.NO_ANSWER_LEADS_FROM).split("-").map(Number); return { short: `${d} ${MONTHS[m - 1]}`, long: `${d} ${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m - 1]} ${y}` }; })();

const NUM = "'Century Gothic','Trebuchet MS','Gill Sans',sans-serif";
const SANS = "'Helvetica Neue',Helvetica,Arial,sans-serif";
const C = { navy: "#0f2d8a", deep: "#0a1650", accent: "#1848C8", secNum: "#C7D2E8", ink: "#111827", body: "#374151",
  soft: "#6B7280", line: "#E5E7EB", panel: "#F9FAFB", zebra: "#F7F8FA", zero: "#C3C8D2", warn: "#D97706" };
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n = (v) => Number(v || 0).toLocaleString("en-US");
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : "–");
const plural = (v, one, many) => `${n(v)} ${Number(v) === 1 ? one : many}`;
// house rule: no em dashes in what people read
const tidy = (s) => String(s).replace(/\s*—\s*/g, ", ");
const list = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0] || "");

function hero(rep) {
  const t = rep.counts.team;
  const active = rep.counts.people.filter((p) => p.active).length;
  return `<tr><td style="background:${C.navy};background-image:linear-gradient(135deg,#1e40af 0%,#0f2d8a 52%,#0a1f6e 100%);padding:30px 32px 26px">
<div style="font:700 11px/1.4 ${SANS};letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,0.72)">HOF Migration · Consultant Activity</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px"><tr>
<td valign="bottom" style="font:800 40px/1.02 ${SANS};letter-spacing:-0.5px;text-transform:uppercase;color:#ffffff">${rep.period.single ? "Daily" : "Consultant"}<br><span style="color:rgba(160,200,255,0.9)">Activity</span></td>
<td valign="bottom" align="right" style="white-space:nowrap"><div style="font:400 50px/1 ${NUM};color:#ffffff">${n(t.calls)}</div>
<div style="font:600 11px/1.6 ${SANS};color:rgba(255,255,255,0.78);margin-top:6px">raw calls logged</div></td></tr></table>
<div style="border-top:1px solid rgba(255,255,255,0.22);margin:20px 0 14px"></div>
<span style="display:inline-block;padding:4px 11px;border-radius:999px;background:rgba(255,255,255,0.14);font:600 11.5px/1.5 ${SANS};color:#ffffff">${esc(rep.period.label)}</span>
<span style="font:500 12px/1.5 ${SANS};color:rgba(255,255,255,0.78);margin-left:8px">${n(active)} of ${plural(rep.counts.people.length, "consultant", "consultants")} active</span>
</td></tr>`;
}

function strip(t) {
  const cells = [
    ["Calls", t.calls, `${n(t.contacts)} contacts`],
    ["Connected", t.connected, `${pct(t.connected, t.calls)} of calls`],
    ["Emails sent", t.emails, t.sequence ? `+${n(t.sequence)} by sequence` : "by the consultants"],
    ["Deals touched", t.dealsTouched, `${n(t.dealsMoved + t.dealsCreated)} moved or created`],
    ["CCL Sent", t.ccl, t.ccl === 1 ? "deal" : "deals"],
    ["Deal Lost", t.lost, t.lost === 1 ? "deal" : "deals"],
  ];
  const w = Math.floor(100 / cells.length);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.panel};border:1px solid ${C.line};border-radius:10px;margin:0 0 26px"><tr>
${cells.map(([label, value, sub], i) => `<td width="${w}%" align="center" valign="top" style="padding:15px 3px 13px;${i < cells.length - 1 ? `border-right:1px solid ${C.line};` : ""}">
<div style="font:700 9px/1.3 ${SANS};letter-spacing:.6px;text-transform:uppercase;color:${C.soft}">${label}</div>
<div style="font:400 26px/1.2 ${NUM};color:${C.navy};margin-top:6px">${n(value)}</div>
<div style="font:400 10.5px/1.4 ${SANS};color:${C.soft};margin-top:3px">${esc(sub)}</div></td>`).join("")}
</tr></table>`;
}

function sectionHead(no, label, sub) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:30px 0 0"><tr>
<td width="58" valign="middle" style="font:400 40px/1 ${NUM};color:${C.secNum}">${no}</td>
<td valign="middle"><div style="font:800 13px/1.3 ${SANS};letter-spacing:1.2px;text-transform:uppercase;color:${C.ink}">${esc(label)}</div>
<div style="font:400 12px/1.5 ${SANS};color:${C.soft};margin-top:2px">${esc(sub)}</div></td></tr></table>
<div style="border-top:1px solid ${C.line};margin:12px 0 10px"></div>`;
}

function numbered(items) {
  return items.map((it, i) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 11px"><tr>
<td width="42" valign="top"><div style="width:28px;height:28px;border:2px solid ${C.accent};border-radius:50%;text-align:center;font:400 13px/28px ${NUM};color:${C.accent}">${i + 1}</div></td>
<td valign="top"><div style="font:700 13px/1.4 ${SANS};color:${C.ink}">${esc(it.title)}</div>
<div style="font:400 12.5px/1.5 ${SANS};color:${C.soft};margin-top:1px">${esc(tidy(it.text))}</div></td></tr></table>`).join("");
}

// A compact table. The number font and right alignment are set once on the table, so a number
// cell is just <td>12</td>, and zero is pale. The heading rows (the band and the column names)
// are written above every team, so each team reads on its own; the overall total goes last.
const BAND = `font:700 9px/1.2 ${SANS};letter-spacing:1px;text-transform:uppercase;color:${C.accent}`;
const HEAD = `font:700 9px/1.25 ${SANS};letter-spacing:.4px;text-transform:uppercase;color:${C.soft};border-bottom:1px solid ${C.line}`;
const TN = `font:600 12px ${SANS};text-align:left`;
const TP = `font:600 12px ${SANS};text-align:left;padding-left:16px`;
const TT = `font:800 12px ${SANS};text-align:left;color:${C.accent};white-space:nowrap`;
const numCell = (v) => (v === "" || v == null ? "<td></td>" : v ? `<td>${n(v)}</td>` : `<td style="color:${C.zero}">0</td>`);
const boldCell = (v) => (v === "" || v == null ? "<td></td>" : `<td><b>${n(v)}</b></td>`);
function dataTable({ groups, heads, rows }) {
  const band = groups ? `<tr style="${BAND}">${groups.map(([label, span], i) => `<td${span > 1 ? ` colspan="${span}"` : ""}${label ? ` style="text-align:center;border-bottom:2px solid ${C.accent}${i > 1 ? ";border-left:6px solid #ffffff" : ""}"` : ""}>${label}</td>`).join("")}</tr>` : "";
  const head = `<tr style="${HEAD}">${heads.map((l, i) => (i ? `<td>${l}</td>` : `<td style="text-align:left">${l}</td>`)).join("")}</tr>`;
  let z = 0;
  const body = rows.map((r) => {
    switch (r.kind) {
      case "headings": return band + head;
      case "space": return `<tr><td colspan="${heads.length}" style="height:16px;padding:0"></td></tr>`;
      case "team": z = 0; return `<tr bgcolor="#EEF2FB"><td style="${TT}">${esc(r.name)}</td>${r.cells.map(boldCell).join("")}</tr>`;
      case "total": return `<tr bgcolor="#E1E8F8"><td style="${TN};font-weight:800">${esc(r.name)}</td>${r.cells.map(boldCell).join("")}</tr>`;
      case "more": return `<tr><td colspan="${heads.length}" style="font:400 11px ${SANS};color:${C.soft};text-align:left;padding-left:16px">${esc(r.name)}</td></tr>`;
      default: return `<tr${z++ % 2 ? ` bgcolor="${C.zebra}"` : ""}><td style="${r.kind === "person" ? TP : TN}">${esc(r.name)}</td>${r.cells.map(numCell).join("")}</tr>`;
    }
  }).join("");
  return `<table role="presentation" width="100%" cellpadding="5" cellspacing="0" style="font:400 13px/1.3 ${NUM};color:${C.ink};border-collapse:collapse;text-align:right">${body}</table>`;
}
// For each team: the headings, the team's totals, then its people (at most perTeam of them, the
// rest are in the workbook). Then the headings once more over the overall total.
function teamRows(groups, cellsOf, total, perTeam = Infinity) {
  const rows = groups.flatMap((g, i) => {
    const shown = g.people.slice(0, perTeam);
    const rest = g.people.length - shown.length;
    return [
      ...(i ? [{ kind: "space" }] : []),
      { kind: "headings" },
      { kind: "team", name: g.name, cells: cellsOf(g.total) },
      ...shown.map((p) => ({ kind: "person", name: p.name, cells: cellsOf(p.total) })),
      ...(rest > 0 ? [{ kind: "more", name: `and ${plural(rest, "more person", "more people")} in the workbook` }] : []),
    ];
  });
  return [...rows, { kind: "space" }, { kind: "headings" }, { kind: "total", name: total.name, cells: cellsOf(total.f) }];
}
const foot = (text) => `<div style="font:400 11.5px/1.6 ${SANS};color:${C.soft};margin:9px 0 0">${tidy(text)}</div>`;

function top(people, key, k = 3) {
  return people.filter((p) => p.total[key] > 0).sort((a, b) => b.total[key] - a.total[key] || a.name.localeCompare(b.name)).slice(0, k)
    .map((p) => `${p.name} ${n(p.total[key])}`);
}

function highlights(rep) {
  const { team } = rep.counts;
  const people = rep.counts.people.filter((p) => p.active);
  const items = [];
  const calls = top(people, "calls");
  if (calls.length) items.push({ title: `${n(team.calls)} raw calls to ${n(team.contacts)} contacts`, text: `Most calls: ${calls.join(", ")}.` });
  const conn = top(people, "connected");
  if (team.calls) items.push({ title: `${n(team.connected)} connected, ${n(team.noAnswer)} no answer`, text: conn.length ? `Most connected: ${conn.join(", ")}.` : "No call was marked connected." });
  const marked = team.markedNoAnswer + team.markedDidntFill + team.markedQualified + team.markedIneligible + team.markedOther;
  if (marked || team.calls) {
    const q = top(people, "markedQualified");
    items.push({ title: `Lead stage: ${n(team.markedNoAnswer)} No Answer, ${n(team.markedDidntFill)} They Didn't Fill, ${n(team.markedQualified)} Qualified, ${n(team.markedIneligible)} Ineligible`,
      text: `${q.length ? `Most marked qualified: ${q.join(", ")}.` : "No contact was marked qualified."}${team.markedOther ? ` ${plural(team.markedOther, "contact was", "contacts were")} moved to other stages.` : ""}` });
  }
  if (rep.world.naLeads && rep.world.naLeads.available) {
    const na = top(people, "naLeads");
    items.push({ title: `${plural(team.naLeads, "No Answer lead", "No Answer leads")} since ${naSince.short}`, text: na.length ? `Most: ${na.join(", ")}.` : `No lead created since ${naSince.long} is in No Answer.` });
  }
  const when = rep.period.single ? " that day" : " in this period";
  const ccl = top(people, "ccl", 6);
  items.push({ title: team.ccl ? `${plural(team.ccl, "deal", "deals")} moved to CCL Sent` : "No deals moved to CCL Sent", text: ccl.length ? `${ccl.join(", ")}.` : `Nobody moved a deal into ${SETTINGS.CCL_STAGE_LABELS.join(" or ")}${when}.` });
  const lost = top(people, "lost", 6);
  items.push({ title: team.lost ? `${plural(team.lost, "deal", "deals")} moved to Deal Lost` : "No deals moved to Deal Lost", text: lost.length ? `${lost.join(", ")}.` : `Nobody moved a deal to Deal Lost${when}.` });
  if (rep.world.openTasks && rep.world.openTasks.available) {
    const od = top(people, "overdue");
    items.push({ title: `Tasks: ${n(team.tasks)} done, ${n(team.dueToday)} due today, ${n(team.overdue)} overdue`, text: od.length ? `Most overdue: ${od.join(", ")}.` : "No open task is overdue." });
  }
  return items;
}

function buildEmail(rep, opts = {}) {
  const { counts, period, world } = rep;
  const team = counts.team;
  const perTeam = opts.perTeam || Infinity;
  const empty = !counts.people.some((p) => p.active);
  const who = world.allSelected ? "the consultants in your teams" : list(counts.people.map((p) => p.name));
  const when = period.single ? `on ${period.long}` : `from ${period.long}`;
  const intro = empty
    ? `No calls, emails or deal activity were logged in HubSpot by ${esc(who)} ${esc(when)}.`
    : `Calls, emails and deal work logged in HubSpot by ${esc(who)} ${esc(when)}, Pakistan time, by team. Every call, email, lead stage change, deal move and task due today behind these numbers is listed in the attached workbook.`;
  const openWhen = `${fmtDayShort(dateKey(rep.now))} at ${fmtTime(rep.now)}`;

  let body = "";
  if (!empty) {
    body += strip(team);
    body += `<div style="font:800 12px/1.4 ${SANS};letter-spacing:1.2px;text-transform:uppercase;color:${C.ink};margin:0 0 10px">At a glance</div>${numbered(highlights(rep))}`;
    let no = 1;
    const label = (i) => String(i).padStart(2, "0");

    if (!period.single) {
      body += sectionHead(label(no++), "Day by day", "The whole team, each day");
      body += dataTable({
        heads: ["Day", "Active", "Calls", "Conn.", "No ans.", "Emails", "Deals touched", "CCL", "Lost"],
        rows: [{ kind: "headings" },
          ...counts.byDay.map((d) => ({ kind: "row", name: fmtDayShort(d.day), cells: [d.active, d.calls, d.connected, d.noAnswer, d.emails, d.dealsTouched, d.ccl, d.lost] })),
          { kind: "total", name: "Total", cells: ["", team.calls, team.connected, team.noAnswer, team.emails, team.dealsTouched, team.ccl, team.lost] }],
      });
    }

    const whole = "Each consultant over the whole period, by team";
    const nc = counts.notCounted || {};
    const table = (spec) => dataTable({ ...spec, rows: teamRows(counts.groups, spec.cellsOf, { name: "All consultants", f: team }, perTeam) });

    body += sectionHead(label(no++), "Calls and No Answer leads", period.single ? "Raw calls, the contacts and deals on them, and leads in No Answer" : whole);
    body += table({
      groups: [["", 1], ["Calls", 5], ["No Answer leads", 1]],
      heads: ["Consultant", "Calls", "Contacts", "Deals", "Connected", "No answer", `Since ${naSince.short}`],
      cellsOf: (f) => [f.calls, f.contacts, f.dealsOnCalls, f.connected, f.noAnswer, f.naLeads],
    });
    body += foot(`Calls are raw call records: the ZIWO dialler and the consultant often both log the same dial, so one call can appear twice. Of the ${n(team.calls)} calls, ${n(team.dialled)} came from the dialler and ${n(team.byHand)} were logged by hand. Contacts and Deals are the different records linked to the calls. No Answer leads = contacts they own whose Lead Stage is No Answer now, out of the leads created from ${naSince.long} to ${openWhen}${world.naLeads && world.naLeads.available ? "" : " (they could not be counted this time)"}.`);

    body += sectionHead(label(no++), "Lead stages and deals", period.single ? "Contacts each consultant marked, the deals they worked, and the deals they moved" : whole);
    body += table({
      groups: [["", 1], ["Lead stage marked", 4], ["Deals", 3]],
      heads: ["Consultant", "No Answer", "Didn't fill", "Qualified", "Ineligible", "Touched", "CCL Sent", "Deal Lost"],
      cellsOf: (f) => [f.markedNoAnswer, f.markedDidntFill, f.markedQualified, f.markedIneligible, f.dealsTouched, f.ccl, f.lost],
    });
    const notes = [];
    if (nc.stagesAutomatic) notes.push(`${plural(nc.stagesAutomatic, "lead stage change", "lead stage changes")} a workflow made on contacts they worked`);
    if (nc.cclOther) notes.push(`${plural(nc.cclOther, "deal", "deals")} moved to CCL Sent by someone not in this report`);
    if (nc.lostOther) notes.push(`${plural(nc.lostOther, "deal", "deals")} moved to Deal Lost by a workflow or someone not in this report`);
    body += foot(`Marked = the consultant changed the contact's Lead Stage to that value${period.single ? " that day" : ""}; changes to other stages are in the workbook. Touched = different deals with a call, email, WhatsApp, note, completed task, meeting or stage change by them. CCL Sent and Deal Lost = deals they moved into that stage. Changes made by workflows count for nobody, except a CCL Sent move, which counts for the deal owner.${notes.length ? ` Listed in the workbook but not counted: ${notes.join("; ")}.` : ""}`);

    body += sectionHead(label(no++), "Emails and tasks", period.single ? "Emails each consultant sent, the tasks they completed, and their open tasks today" : whole);
    body += table({
      groups: [["", 1], ["Emails sent", 4], ["Tasks", 3]],
      heads: ["Consultant", "Sent", "On deals", "On contacts", "Sequence", "Done", "Due today", "Overdue"],
      cellsOf: (f) => [f.emails, f.emailsOnDeals, f.emailsOnContacts, f.sequence, f.tasks, f.dueToday, f.overdue],
    });
    body += foot(`Sent = emails the consultant sent themselves; sequence emails sent in their name are counted separately. On deals / On contacts = of those, the emails linked to a deal / to a contact. Done = tasks completed${period.single ? " that day" : " in the period"}. Due today and Overdue are open tasks as of ${openWhen}: due today, and due before today however old.${world.openTasks && world.openTasks.available ? "" : " (Open tasks could not be read this time.)"}`);

    if (counts.hidden) body += `<div style="font:400 12px/1.6 ${SANS};color:${C.soft};margin:22px 0 0">${plural(counts.hidden, "person", "people")} with no activity ${period.single ? "that day" : "in this period"} ${counts.hidden === 1 ? "is" : "are"} not shown.</div>`;
  }
  const warn = (world.warnings || []).length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px"><tr><td style="background:#FFFBEB;border-left:4px solid ${C.warn};padding:11px 14px;font:400 12.5px/1.55 ${SANS};color:#92400E">${world.warnings.map(esc).join("<br>")}</td></tr></table>` : "";

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Consultant activity</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f3f4f6" style="background:#f3f4f6;"><tr><td align="center" bgcolor="#f3f4f6" style="background:#f3f4f6;padding:28px 12px 48px;">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:640px;max-width:640px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid ${C.line}">
${hero(rep)}
<tr><td style="padding:28px 32px 10px">
${warn}
<p style="margin:0 0 20px;font:400 14px/1.65 ${SANS};color:${C.body}">${intro}</p>
${body}
<p style="margin:26px 0 26px;font:400 12.5px/1.6 ${SANS};color:${C.soft}">${empty ? "" : "The attached workbook has every consultant's numbers side by side"}${empty ? "" : period.single ? ", " : ", the team and each consultant day by day, "}${empty ? "" : "and every call, email, lead stage change, CCL Sent and Deal Lost move, deal touched and task due today, with links into HubSpot."}</p>
</td></tr>
<tr><td style="background:${C.deep};padding:20px 32px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="font:400 12px/1.6 ${SANS};color:rgba(255,255,255,0.85)"><b style="color:#ffffff">Ali Raza</b><br>Compliance Lead, HOF Migration</td>
<td align="right" style="font:400 12px/1.6 ${SANS};color:rgba(255,255,255,0.7)">HOF Migration<br>Consultant Activity<br><span style="font-family:${NUM};color:#ffffff">${esc(period.label)}</span></td></tr></table></td></tr>
</table></td></tr></table></body></html>`;
}

function fitEmail(rep) {
  let html = buildEmail(rep);
  for (const perTeam of [10, 7, 5, 3]) {
    if (Buffer.byteLength(html, "utf8") <= SETTINGS.EMAIL_MAX_BYTES) break;
    html = buildEmail(rep, { perTeam });
  }
  return html;
}

function subjectFor(rep) {
  const t = rep.counts.team;
  const when = rep.period.single ? fmtDayShort(rep.period.days[0]) : rep.period.label;
  if (!rep.counts.people.some((p) => p.active)) return `Consultant activity · ${when} · no activity logged`;
  return `Consultant activity · ${when} · ${plural(t.calls, "call", "calls")} · ${plural(t.emails, "email", "emails")} · ${n(t.ccl)} CCL Sent · ${n(t.lost)} Deal Lost`;
}

async function sendEmail(subject, html, attachments) {
  if (!process.env.RESEND_KEY) { console.log("No RESEND_KEY secret, so the email was not sent."); return false; }
  const body = { from: SETTINGS.FROM_EMAIL, to: [SETTINGS.REPORT_TO], subject, html, attachments };
  if (SETTINGS.CC.length) body.cc = SETTINGS.CC;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.log(`Email failed: ${res.status} ${(await res.text()).slice(0, 250)}`);
    if (res.status === 403) console.log("  The built-in sender (onboarding@resend.dev) only reaches the address the Resend account belongs to; CC needs a verified domain.");
    return false;
  }
  return true;
}

module.exports = { buildEmail, fitEmail, subjectFor, sendEmail };
