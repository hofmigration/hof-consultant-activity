// 4-workbook.js — the attached Excel workbook: every consultant by team, the team day by day,
// and every call, email, lead stage change, CCL Sent and Deal Lost move, deal touched and task
// due today, one per row, so any number in the email can be traced to the records behind it.
const ExcelJS = require("exceljs");
const { SETTINGS } = require("./config");
const { xlDate, fmtDayKey, keyStart, fmtTime, dateKey } = require("./1-clock");
const { contactLink, dealLink } = require("./0-hubspot");
const { HOW_TEXT, isActive } = require("./3-count");

const NAVY = "FF0F2D8A", INK = "FF1F2937", SOFT = "FF6B7280", LINE = "FFE5E7EB", PANEL = "FFF3F6FB", WHITE = "FFFFFFFF", BLUE = "FF1848C8", PALE = "FFC3C8D2";
const F = "Arial";
const thin = { style: "thin", color: { argb: LINE } };
const BOX = { top: thin, left: thin, bottom: thin, right: thin };
const fill = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });

// The metric columns, in order, grouped as in the email. A fourth value of true marks a number
// counted when the report runs (open tasks), which has no day-by-day value.
const METRICS = [
  ["Calls", [
    ["calls", "Raw calls", "Every call record the consultant logged or the dialler logged for them (inbound calls aside)"],
    ["dialled", "Through the dialler", "Call records made by the ZIWO dialler"],
    ["byHand", "Logged by hand", "Call records the consultant logged themselves"],
    ["contacts", "Contacts on calls", "Different contacts linked to those calls"],
    ["dealsOnCalls", "Deals on calls", "Different deals linked to those calls"],
    ["connected", "Connected", `Calls with the outcome ${SETTINGS.CONNECTED_OUTCOMES.join(" or ")}`],
    ["noAnswer", "No answer", "Calls with the outcome No answer"],
    ["busy", "Busy", ""], ["wrong", "Wrong number", ""], ["message", "Voicemail or message", "Left voicemail or Left live message"],
    ["meeting", "Meeting booked", ""], ["otherOutcome", "Other outcome", ""], ["noOutcome", "No outcome", "No call outcome was chosen"],
    ["naContacts", "Contacts with a no-answer call", "Different contacts with at least one No answer call"],
  ]],
  ["Lead stage marked", [
    ["markedNoAnswer", "No Answer", "Contacts whose Lead Stage the consultant changed to No Answer"],
    ["markedDidntFill", "They Didn't Fill", "Contacts whose Lead Stage the consultant changed to They Didn't Fill"],
    ["markedQualified", "Qualified", `Contacts whose Lead Stage the consultant changed to a qualified stage (${SETTINGS.LEAD_STAGES.qualified.join(", ")})`],
    ["markedIneligible", "Ineligible", "Contacts whose Lead Stage the consultant changed to Ineligible"],
    ["markedOther", "Any other stage", "Contacts whose Lead Stage the consultant changed to any other value"],
  ]],
  ["No Answer leads", [
    ["naLeads", `Since ${SETTINGS.NO_ANSWER_LEADS_FROM}`, `Contacts the consultant owns whose Lead Stage is No Answer now, out of the leads created since ${SETTINGS.NO_ANSWER_LEADS_FROM}, counted when the report ran`, true],
  ]],
  ["Emails", [
    ["emails", "Emails sent", "Emails the consultant sent themselves (not by a sequence)"],
    ["emailsOnDeals", "Emails on deals", "Of those, emails linked to at least one deal"],
    ["emailsOnContacts", "Emails on contacts", "Of those, emails linked to at least one contact"],
    ["dealsEmailed", "Deals emailed", "Different deals those emails were linked to"],
    ["contactsEmailed", "Contacts emailed", "Different contacts those emails were linked to"],
    ["sequence", "Sequence emails", "Emails sent by a HubSpot sequence in the consultant's name"],
    ["bounced", "Bounced", "Emails (by hand or sequence) that bounced"],
  ]],
  ["Tasks", [
    ["tasks", "Tasks done", "Tasks the consultant completed in the period"],
    ["dueToday", "Due today", "Open tasks due on the day the report was sent, counted when it ran", true],
    ["overdue", "Overdue", "Open tasks due before the day the report was sent, however old, counted when it ran", true],
  ]],
  ["Other activity", [
    ["messages", "WhatsApp logged", "WhatsApp (and other) messages logged"],
    ["notes", "Notes", ""], ["meetings", "Meetings", ""],
    ["inbound", "Inbound calls", "Calls the consultant received (not counted as calls made)"],
  ]],
  ["Deals", [
    ["dealsTouched", "Deals touched", "Different deals with a call, email, WhatsApp, note, completed task, meeting or stage change by the consultant"],
    ["dealsCreated", "Deals created", "Deals the consultant created"],
    ["dealsMoved", "Deals moved stage", "Deals whose stage the consultant changed"],
    ["ccl", "Moved to CCL Sent", "Deals moved into the CCL Sent stage"],
    ["lost", "Moved to Deal Lost", "Deals moved into the Deal Lost stage (called Lost in the Visit pipeline)"],
  ]],
];
const DAY_METRICS = METRICS.map(([g, list]) => [g, list.filter((c) => !c[3])]).filter(([, list]) => list.length);
const colsOf = (metrics) => metrics.flatMap(([, list]) => list);
const COLS = colsOf(METRICS), DAY_COLS = colsOf(DAY_METRICS);

function title(ws, text, sub, width) {
  ws.mergeCells(1, 1, 1, Math.max(2, width));
  const t = ws.getCell(1, 1);
  t.value = text; t.font = { name: F, bold: true, size: 15, color: { argb: WHITE } }; t.fill = fill(NAVY);
  t.alignment = { vertical: "middle", indent: 1 }; ws.getRow(1).height = 30;
  if (sub) {
    ws.mergeCells(2, 1, 2, Math.max(2, width));
    const s = ws.getCell(2, 1);
    s.value = sub; s.font = { name: F, size: 10, color: { argb: SOFT } }; s.alignment = { vertical: "middle", indent: 1, wrapText: true };
    ws.getRow(2).height = 34;
  }
}
function header(ws, rowNo, labels, height = 36) {
  const r = ws.getRow(rowNo);
  labels.forEach((l, i) => {
    const c = r.getCell(i + 1);
    c.value = l; c.font = { name: F, bold: true, size: 9.5, color: { argb: WHITE } }; c.fill = fill(NAVY);
    c.alignment = { vertical: "middle", horizontal: i ? "center" : "left", wrapText: true, indent: i ? 0 : 1 }; c.border = BOX;
  });
  r.height = height;
}
// the band above the metric headers: CALLS, LEAD STAGE MARKED, EMAILS...
function groups(ws, rowNo, firstCol, metrics = METRICS) {
  let col = firstCol;
  for (const [name, list] of metrics) {
    if (list.length > 1) ws.mergeCells(rowNo, col, rowNo, col + list.length - 1);
    const c = ws.getCell(rowNo, col);
    c.value = name.toUpperCase(); c.font = { name: F, bold: true, size: 9, color: { argb: BLUE } }; c.fill = fill(PANEL);
    c.alignment = { horizontal: "center", vertical: "middle" }; c.border = BOX;
    col += list.length;
  }
  ws.getRow(rowNo).height = 18;
}
function notes(ws, rowNo, firstCol, cols = COLS) {
  cols.forEach(([, , hint], i) => { if (hint) ws.getCell(rowNo, firstCol + i).note = hint; });
}
function metricRow(ws, rowNo, leading, f, { bold = false, band = false, indent = 0 } = {}, cols = COLS) {
  const r = ws.getRow(rowNo);
  leading.forEach((v, i) => {
    const c = r.getCell(i + 1);
    c.value = v; c.border = BOX;
    c.alignment = typeof v === "number" ? { vertical: "middle", horizontal: "center" } : { vertical: "middle", horizontal: "left", indent: (i === leading.length - 1 ? indent : 0) + 1 };
    c.font = { name: F, size: 10, bold, color: { argb: INK } };
    if (band) c.fill = fill(PANEL);
  });
  cols.forEach(([key], i) => {
    const c = r.getCell(leading.length + i + 1);
    const v = f[key] || 0;
    c.value = v; c.border = BOX; c.alignment = { horizontal: "center", vertical: "middle" }; c.numFmt = "#,##0";
    c.font = { name: F, size: 10, bold, color: { argb: v ? INK : PALE } };
    if (band) c.fill = fill(PANEL);
  });
}

function makeNames(world) {
  const contactName = (id) => {
    const r = world.contacts.get(String(id)); const p = (r && r.properties) || {};
    return `${p.firstname || ""} ${p.lastname || ""}`.replace(/\s+/g, " ").trim() || `Contact ${id}`;
  };
  const dealRec = (id) => { const r = world.deals.get(String(id)); return (r && r.properties) || {}; };
  const dealName = (id) => String(dealRec(id).dealname || "").replace(/\s+/g, " ").trim() || `Deal ${id}`;
  const stageName = (sid) => (world.pipes.stages[String(sid)] || {}).label || (sid ? `Stage ${sid}` : "");
  const pipeName = (pid) => world.pipes.names[String(pid)] || (pid ? `Pipeline ${pid}` : "");
  const person = (oid) => world.people.ownerName[String(oid)] || (oid ? `Owner ${oid}` : "");
  const leadLabel = (v) => (v ? (world.leadLabels || {})[v] || v : "(blank)");
  const teamOf = (oid) => ((world.teamsOf || {})[String(oid)] || []).join(", ");
  return { contactName, dealRec, dealName, stageName, pipeName, person, leadLabel, teamOf };
}

function linkCell(cell, url, text) {
  cell.value = { text: String(text), hyperlink: url };
  cell.font = { name: F, size: 10, color: { argb: BLUE }, underline: true };
}
// One row of a list: plain values, or { text, link }, { date }, { time }, { num, fmt }, { faded }.
function put(r, values) {
  values.forEach((v, i) => {
    const c = r.getCell(i + 1);
    if (v == null || v === "") return;
    if (typeof v !== "object") { c.value = v; return; }
    if (v.link) linkCell(c, v.link, v.text);
    else if ("date" in v) { c.value = xlDate(v.date); c.numFmt = "ddd d mmm yyyy"; }
    else if ("time" in v) { c.value = xlDate(v.time); c.numFmt = "hh:mm"; }
    else if ("num" in v) { c.value = v.num; c.numFmt = v.fmt || "#,##0"; }
    else if ("faded" in v) { c.value = v.faded; c.font = { name: F, size: 10, color: { argb: SOFT } }; }
  });
}

// A plain list sheet: header row 3, rows below, a frozen header and filters.
function listSheet(wb, name, heading, sub, cols, rows, toValues) {
  const ws = wb.addWorksheet(name, { views: [{ showGridLines: false, state: "frozen", ySplit: 3 }] });
  ws.columns = cols.map(([, width]) => ({ width, style: { font: { name: F, size: 10 } } }));
  title(ws, heading, sub, cols.length);
  header(ws, 3, cols.map(([label]) => label), 30);
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: cols.length } };
  const cap = Math.min(rows.length, SETTINGS.DETAIL_ROWS_MAX);
  for (let i = 0; i < cap; i++) {
    const r = ws.getRow(4 + i);
    put(r, toValues(rows[i]));
    r.alignment = { vertical: "top" };
  }
  if (rows.length > cap) {
    const c = ws.getCell(4 + cap, 1);
    c.value = `Only the first ${cap.toLocaleString("en-US")} of ${rows.length.toLocaleString("en-US")} rows are listed. Run a shorter period to see them all.`;
    c.font = { name: F, size: 10, italic: true, color: { argb: SOFT } };
  }
  return ws;
}

async function buildWorkbook(rep) {
  const { world, counts, period, now } = rep;
  const N = makeNames(world);
  const wb = new ExcelJS.Workbook();
  wb.creator = "HOF consultant activity";
  wb.created = new Date(now);
  const readAt = `${fmtDayKey(dateKey(now))} ${fmtTime(now)}`;
  const todayName = fmtDayKey(dateKey(now));
  const hiddenLine = counts.hidden ? `${counts.hidden} ${counts.hidden === 1 ? "person" : "people"} with no activity in the period ${counts.hidden === 1 ? "is" : "are"} not listed.` : "";

  // ---------- Summary: by team ----------
  {
    const ws = wb.addWorksheet("Summary", { views: [{ showGridLines: false, state: "frozen", ySplit: 4, xSplit: 1 }] });
    ws.columns = [{ width: 32 }, ...COLS.map(() => ({ width: 12 }))];
    title(ws, `Consultant activity · ${period.label}`,
      `What each consultant logged in HubSpot, ${period.long}, Pakistan time, by team. ${period.single ? "" : "Contacts, deals and lead stages count each record once per consultant over the whole period. "}Due today and Overdue are open tasks as of ${readAt}. Hover over a heading for what it counts.`, COLS.length + 1);
    groups(ws, 3, 2);
    header(ws, 4, ["Team / consultant", ...COLS.map(([, label]) => label)], 44);
    notes(ws, 4, 2);
    let row = 5;
    for (const g of counts.groups) {
      metricRow(ws, row++, [g.name], g.total, { bold: true, band: true });
      for (const p of g.people) metricRow(ws, row++, [p.name], p.total, { indent: 2 });
    }
    metricRow(ws, row++, ["All consultants"], counts.team, { bold: true, band: true });
    if (hiddenLine) { const c = ws.getCell(row + 1, 1); c.value = hiddenLine; c.font = { name: F, size: 10, italic: true, color: { argb: SOFT } }; }
  }

  // ---------- By day / Daily (more than one day only) ----------
  if (!period.single) {
    const ws = wb.addWorksheet("By day", { views: [{ showGridLines: false, state: "frozen", ySplit: 4, xSplit: 2 }] });
    ws.columns = [{ width: 18 }, { width: 11 }, ...DAY_COLS.map(() => ({ width: 12 }))];
    title(ws, `The team, day by day · ${period.label}`, "Every consultant's numbers for the day added together.", DAY_COLS.length + 2);
    groups(ws, 3, 3, DAY_METRICS);
    header(ws, 4, ["Day", "Active", ...DAY_COLS.map(([, label]) => label)], 44);
    notes(ws, 4, 3, DAY_COLS);
    let row = 5;
    for (const d of counts.byDay) {
      metricRow(ws, row, [xlDate(keyStart(d.day)), d.active], d, {}, DAY_COLS);
      ws.getCell(row, 1).numFmt = "ddd d mmm yyyy";
      row++;
    }
    metricRow(ws, row, ["Whole period", ""], counts.team, { bold: true, band: true }, DAY_COLS);

    const wd = wb.addWorksheet("Daily", { views: [{ showGridLines: false, state: "frozen", ySplit: 4, xSplit: 3 }] });
    wd.columns = [{ width: 18 }, { width: 24 }, { width: 28 }, ...DAY_COLS.map(() => ({ width: 12 }))];
    title(wd, `Each consultant, day by day · ${period.label}`, "One row per consultant per day with any activity. Filter on a day, a team or a name.", DAY_COLS.length + 3);
    groups(wd, 3, 4, DAY_METRICS);
    header(wd, 4, ["Day", "Team", "Consultant", ...DAY_COLS.map(([, label]) => label)], 44);
    notes(wd, 4, 4, DAY_COLS);
    row = 5;
    for (const d of period.days) {
      for (const g of counts.groups) {
        for (const p of g.people) {
          if (!isActive(p.daily[d])) continue;
          metricRow(wd, row, [xlDate(keyStart(d)), g.name, p.name], p.daily[d], {}, DAY_COLS);
          wd.getCell(row, 1).numFmt = "ddd d mmm yyyy";
          row++;
        }
      }
    }
    wd.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: DAY_COLS.length + 3 } };
  }

  const D = counts.detail;
  const names = (ids, f) => ids.map(f).join(", ");
  const contactCell = (ids) => (ids.length ? { link: contactLink(ids[0]), text: names(ids, N.contactName) } : "");
  const dealCell = (ids) => (ids.length ? { link: dealLink(ids[0]), text: names(ids, N.dealName) } : "");
  const counted = (oid) => (oid ? N.person(oid) : { faded: "Not counted" });

  // ---------- Calls ----------
  listSheet(wb, "Calls", `Every call · ${period.label}`,
    "Raw call records. The ZIWO dialler and the consultant often both log the same call, so one dial can appear twice: \"Logged by\" shows which is which. Inbound calls are listed but are not counted as calls made.",
    [["Date", 15], ["Time", 7], ["Consultant", 24], ["Team", 22], ["Outcome", 15], ["Logged by", 14], ["Direction", 10], ["Duration", 9], ["Number dialled", 16], ["Contact", 26], ["Lead stage now", 18], ["Deal", 26], ["Call title", 30]],
    D.calls, (c) => {
      const rec = c.contacts.length ? world.contacts.get(String(c.contacts[0])) : null;
      return [{ date: c.at }, { time: c.at }, N.person(c.ownerId), N.teamOf(c.ownerId), c.outcome || "(none)", c.dialled ? "ZIWO dialler" : "By hand",
        c.inbound ? "Inbound" : c.direction === "OUTBOUND" ? "Outbound" : "", c.durationMs ? { num: c.durationMs / 86400000, fmt: "[m]:ss" } : "", c.toNumber,
        contactCell(c.contacts), c.contacts.length ? N.leadLabel(rec && rec.properties && rec.properties.lead_stage) : "", dealCell(c.deals), c.title];
    });

  // ---------- Emails ----------
  listSheet(wb, "Emails", `Every email sent · ${period.label}`,
    "Outgoing emails, by the consultant and by sequences in their name. Failed, cancelled and scheduled emails are left out; a bounced email still counts as sent.",
    [["Date", 15], ["Time", 7], ["Consultant", 24], ["Team", 22], ["Sent by", 12], ["Status", 11], ["Subject", 40], ["To", 30], ["Contact", 26], ["Deal", 26]],
    D.emails, (e) => [{ date: e.at }, { time: e.at }, N.person(e.ownerId), N.teamOf(e.ownerId), e.sequence ? "Sequence" : "Consultant",
      e.status ? e.status.charAt(0) + e.status.slice(1).toLowerCase() : "", e.subject, e.to, contactCell(e.contacts), dealCell(e.deals)]);

  // ---------- Lead stages ----------
  listSheet(wb, "Lead stages", `Lead stage changes · ${period.label}`,
    "Every Lead Stage change credited to a consultant, and the changes nobody was credited for on contacts they worked that day (made by a workflow, or by someone else).",
    [["Date", 15], ["Time", 7], ["Contact", 28], ["Set to", 20], ["Was", 20], ["Counted for", 24], ["Team", 22], ["Changed by", 26], ["How it was counted", 40], ["Contact owner then", 24]],
    D.stages, (s) => [{ date: s.at }, { time: s.at }, { link: contactLink(s.contactId), text: N.contactName(s.contactId) }, N.leadLabel(s.to),
      s.from ? N.leadLabel(s.from) : "", counted(s.credit), s.credit ? N.teamOf(s.credit) : "", s.by, HOW_TEXT[s.how] || s.how, N.person(s.ownerAt)]);

  // ---------- CCL Sent and Deal Lost ----------
  const moveSheet = (name, heading, sub, rows) => listSheet(wb, name, `${heading} · ${period.label}`, sub,
    [["Date", 15], ["Time", 7], ["Deal", 30], ["Pipeline", 30], ["Moved from", 22], ["Counted for", 24], ["Team", 22], ["Moved by", 26], ["Deal owner then", 24], ["Stage now", 22], ["Amount", 12]],
    rows, (x) => {
      const p = N.dealRec(x.dealId);
      const amount = p.amount != null && p.amount !== "" && Number.isFinite(Number(p.amount)) ? { num: Number(p.amount) } : "";
      return [{ date: x.at }, { time: x.at }, { link: dealLink(x.dealId), text: N.dealName(x.dealId) }, N.pipeName((world.pipes.stages[x.to] || {}).pipelineId || p.pipeline),
        x.creation ? "(created here)" : N.stageName(x.from), counted(x.credit), x.credit ? N.teamOf(x.credit) : "", x.by, N.person(x.ownerAt), N.stageName(p.dealstage), amount];
    });
  moveSheet("CCL Sent", "Deals moved to CCL Sent",
    "Every move into a CCL Sent stage. A move made by a workflow or an app is credited to the deal's owner; a move made by someone outside the report is listed but not counted.", D.ccl);
  moveSheet("Deal Lost", "Deals moved to Deal Lost",
    `Every move into a Deal Lost stage in the sales pipelines (called Lost in the Visit pipeline). A move made by a workflow ${SETTINGS.LOST_CREDIT_AUTOMATIC_TO_OWNER ? "is credited to the deal's owner" : "is listed but not counted"}; so is a move made by someone outside the report.`, D.lost || []);

  // ---------- Deals touched ----------
  const touched = [...D.touched.entries()].map(([k, why]) => { const [oid, day, did] = k.split("|"); return { oid, day, did, why: [...why] }; })
    .sort((a, b) => a.day.localeCompare(b.day) || N.person(a.oid).localeCompare(N.person(b.oid)) || N.dealName(a.did).localeCompare(N.dealName(b.did)));
  listSheet(wb, "Deals touched", `Deals touched · ${period.label}`,
    "One row per consultant, day and deal: the deal had a call, email, WhatsApp, note, completed task, meeting or stage change by them that day.",
    [["Date", 15], ["Consultant", 24], ["Team", 22], ["Deal", 30], ["Pipeline", 30], ["Stage now", 22], ["What they did", 40], ["Deal owner", 24]],
    touched, (x) => {
      const p = N.dealRec(x.did);
      return [{ date: keyStart(x.day) }, N.person(x.oid), N.teamOf(x.oid), { link: dealLink(x.did), text: N.dealName(x.did) }, N.pipeName(p.pipeline),
        N.stageName(p.dealstage), x.why.join(", "), N.person(p.hubspot_owner_id)];
    });

  // ---------- Tasks due today ----------
  listSheet(wb, "Tasks due today", `Open tasks due ${todayName}`,
    `Every open task due on the day the report was sent, as it stood at ${fmtTime(now)}. Overdue tasks are only counted, not listed.`,
    [["Due", 15], ["Time", 7], ["Consultant", 24], ["Team", 22], ["Task", 44], ["Type", 10], ["Status", 12], ["Contact", 26], ["Deal", 26]],
    D.dueTasks || [], (t) => [{ date: t.at }, { time: t.at }, N.person(t.ownerId), N.teamOf(t.ownerId), t.subject,
      t.type ? t.type.charAt(0) + t.type.slice(1).toLowerCase().replace(/_/g, " ") : "", t.status ? t.status.charAt(0) + t.status.slice(1).toLowerCase().replace(/_/g, " ") : "",
      contactCell(t.contacts), dealCell(t.deals)]);

  // ---------- How it was counted ----------
  {
    const ws = wb.addWorksheet("How it was counted", { views: [{ showGridLines: false }] });
    ws.columns = [{ width: 30 }, { width: 110 }];
    title(ws, "How it was counted", `${period.long}, Pakistan time. Everything was read from HubSpot; nothing in HubSpot was changed.`, 2);
    const lines = [
      ["Days", "Each day runs from midnight to midnight, Pakistan time. The daily report covers yesterday; the morning after a day off it covers that day too, so Monday's report covers Saturday and Sunday."],
      ["Who", `${counts.people.length} ${counts.people.length === 1 ? "person" : "people"}${world.allSelected ? ": everyone in the teams in config.js, and nobody else" : ""}. An activity counts for the consultant it is assigned to in HubSpot.${hiddenLine ? ` ${hiddenLine}` : ""}`],
      ["Teams", "People are grouped by the teams in config.js, in that order. Someone in two teams shows under both, and the All consultants row counts them once. A team row adds up the people under it."],
      ["Raw calls", "Every call record. The ZIWO dialler logs each dial itself, and many consultants also log the call by hand, so one dial often appears twice. \"Through the dialler\" and \"Logged by hand\" add up to the raw calls. Inbound calls are listed separately and not counted as calls made."],
      ["Contacts and deals on calls", "The different contacts and deals the calls are linked to in HubSpot."],
      ["Connected, No answer", `The call outcome chosen for each call record. Connected counts ${SETTINGS.CONNECTED_OUTCOMES.join(" and ")}.`],
      ["Lead stage marked", "A contact counts when the consultant changed its Lead Stage to that value during the day, read from the contact's change history. A change made by a HubSpot user counts for that user. A change with no user on it (an app or the API) counts for whoever owned the contact then. Changes made by workflows, imports and forms count for nobody. A contact marked twice in a day counts once."],
      ["Contacts checked", "Every contact the consultants called, emailed, messaged, noted or met that day, and every contact of theirs now in No Answer, They Didn't Fill, Ineligible or a qualified stage that changed in any way since the day began (so a stage set without any call is still found)."],
      ["Qualified", `Any of: ${SETTINGS.LEAD_STAGES.qualified.map((v) => N.leadLabel(v)).join(", ")}.`],
      ["Ineligible", `The Lead Stage ${SETTINGS.LEAD_STAGES.ineligible.map((v) => N.leadLabel(v)).join(" or ")}. Occupation Not Listed, Outside GCC and other stages are counted under "Any other stage".`],
      ["Emails sent", `Outgoing emails the consultant sent themselves. Sequence emails sent in their name are counted separately. A bounced email still counts as sent; ${SETTINGS.EMAIL_NOT_SENT_STATUSES.map((s) => s.toLowerCase()).join(", ")} emails do not.`],
      ["Emails on deals / contacts", "Of the emails sent, how many are linked to at least one deal, and to at least one contact. One email is usually linked to both."],
      ["No Answer leads", `Counted when the report runs (${readAt}): the contacts each consultant owns whose Lead Stage is No Answer right now, out of the leads created in HubSpot from ${SETTINGS.NO_ANSWER_LEADS_FROM} to that moment. Each day's report covers one more day. The number is counted, not listed.`],
      ["Tasks", `Tasks done = tasks completed in the period. Due today and Overdue are counted when the report runs (${readAt}): open tasks due on ${todayName}, and open tasks due before ${todayName}, however old. A task is open until it is marked completed. The tasks due today are listed; overdue ones are only counted.`],
      ["Deals touched", "Different deals with a call, email (not a sequence), WhatsApp, note, completed task, meeting, or stage change by the consultant that day. A deal touched on several days counts once in the period total."],
      ["Moved to CCL Sent", `Deals moved into a stage called ${SETTINGS.CCL_STAGE_LABELS.join(" or ")}, read from the deal's stage history. A move by a HubSpot user counts for that user; a move by a workflow or an app counts for the deal's owner.`],
      ["Moved to Deal Lost", `Deals moved into a stage called ${SETTINGS.LOST_STAGE_LABELS.join(" or ")} in the sales pipelines, read from the deal's stage history. A move by a HubSpot user counts for that user; a move with no user on it (an app or the API) counts for the deal's owner; a move by a workflow ${SETTINGS.LOST_CREDIT_AUTOMATIC_TO_OWNER ? "counts for the deal's owner" : "counts for nobody"}.`],
      ["Stage history", `Read ${world.historyMode.contacts === "batch" && world.historyMode.deals === "batch" ? "in batches, after a sample was checked against single reads and matched" : "one record at a time"}.`],
    ];
    let row = 4;
    for (const [a, b] of lines) {
      const r = ws.getRow(row++);
      r.getCell(1).value = a; r.getCell(1).font = { name: F, size: 10, bold: true, color: { argb: INK } };
      r.getCell(2).value = b; r.getCell(2).font = { name: F, size: 10, color: { argb: INK } };
      r.getCell(2).alignment = { wrapText: true, vertical: "top" }; r.getCell(1).alignment = { vertical: "top" };
      r.height = Math.max(18, Math.ceil(b.length / 120) * 15);
    }
    for (const w of world.warnings || []) {
      const r = ws.getRow(row++);
      r.getCell(1).value = "Note"; r.getCell(1).font = { name: F, size: 10, bold: true, color: { argb: "FFB45309" } };
      r.getCell(2).value = w; r.getCell(2).font = { name: F, size: 10, color: { argb: "FFB45309" } }; r.getCell(2).alignment = { wrapText: true };
    }
  }
  return wb;
}

module.exports = { buildWorkbook, METRICS, COLS, DAY_COLS, makeNames };
