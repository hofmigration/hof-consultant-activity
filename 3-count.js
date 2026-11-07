// 3-count.js — turns what was read into numbers. For each consultant and each day: the calls,
// the contacts and deals on them, how the calls ended, the lead stages they marked, the emails
// they sent, the deals they touched and the deals they moved to CCL Sent. No network in here,
// so every rule is tested on invented records in selftest.js.
const { SETTINGS } = require("./config");
const { ms, dateKey } = require("./1-clock");

// HubSpot's standard call outcomes, used if the portal's own list cannot be read.
const STANDARD_DISPOSITIONS = {
  "9d9162e7-6cf3-4944-bf63-4dff82258764": "Busy",
  "f240bbac-87c9-4f6e-bf70-924b57d47db7": "Connected",
  "a4c4c377-d246-4b32-a13b-75a56a4cd0ff": "Left live message",
  "b2cf5968-551e-4856-9783-52b3da59a7d0": "Left voicemail",
  "2e7360c1-6b71-40e9-ab2b-30ae98a4678c": "Meeting booked",
  "73a0d17f-1163-4015-bdd5-ec830791da20": "No answer",
  "17b47fee-58de-441e-a44c-c6300d46f273": "Wrong number",
};

const low = (s) => String(s == null ? "" : s).trim().toLowerCase();
const CONNECTED = new Set(SETTINGS.CONNECTED_OUTCOMES.map(low));
const NO_ANSWER = new Set(SETTINGS.NO_ANSWER_OUTCOMES.map(low));
const GROUP_OF = {};
for (const [g, vals] of Object.entries(SETTINGS.LEAD_STAGES)) for (const v of vals) GROUP_OF[low(v)] = g;
// "noAnswer" | "didntFill" | "qualified" | "ineligible" | "other" | "cleared" (the stage was emptied)
const stageGroup = (v) => (low(v) ? GROUP_OF[low(v)] || "other" : "cleared");

function outcomeKind(label) {
  const l = low(label);
  if (!l) return "none";
  if (NO_ANSWER.has(l)) return "noAnswer";
  if (l === "meeting booked") return "meeting";
  if (l === "connected") return "connected";
  if (l === "busy") return "busy";
  if (l === "wrong number") return "wrong";
  if (/voicemail|live message/.test(l)) return "message";
  return "other";
}

// ---------- one record at a time ----------
function normCall(id, p, dispo = {}) {
  const code = String(p.hs_call_disposition || "");
  const outcome = dispo[code] || STANDARD_DISPOSITIONS[code] || (code ? "Other" : "");
  const dir = String(p.hs_call_direction || "").toUpperCase();
  return {
    id: String(id), at: ms(p.hs_timestamp), ownerId: String(p.hubspot_owner_id || ""),
    outcome, kind: outcomeKind(outcome), connected: CONNECTED.has(low(outcome)),
    inbound: dir === "INBOUND", direction: dir,
    // The ZIWO dialler's own record carries the number dialled; a call logged by hand does not.
    dialled: String(p.hs_call_source || "").toUpperCase() === "INTEGRATIONS_PLATFORM" || !!String(p.hs_call_to_number || "").trim(),
    durationMs: Number(p.hs_call_duration || 0) || 0, toNumber: String(p.hs_call_to_number || "").trim(),
    title: String(p.hs_call_title || "").trim(),
  };
}

function normEmail(id, p) {
  const status = String(p.hs_email_status || "").toUpperCase();
  return {
    id: String(id), at: ms(p.hs_timestamp), ownerId: String(p.hubspot_owner_id || ""), status,
    sent: !SETTINGS.EMAIL_NOT_SENT_STATUSES.includes(status), bounced: status === "BOUNCED",
    sequence: !!String(p.hs_sequence_id || "").trim(),
    subject: String(p.hs_email_subject || "").trim(), to: String(p.hs_email_to_email || "").trim(),
  };
}

// History entries, oldest first: { value, at, sourceType, sourceId, sourceLabel, userId }
function parseHistory(list) {
  return (Array.isArray(list) ? list : []).map((h) => {
    let userId = h.updatedByUserId != null && h.updatedByUserId !== "" ? String(h.updatedByUserId) : "";
    if (!userId) { const m = /userId:(\d+)/.exec(String(h.sourceId || "")); if (m) userId = m[1]; }
    return { value: h.value == null ? "" : String(h.value), at: ms(h.timestamp), sourceType: String(h.sourceType || ""),
      sourceId: String(h.sourceId || ""), sourceLabel: String(h.sourceLabel || ""), userId };
  }).filter((h) => h.at).sort((a, b) => a.at - b.at);
}

// Who owned the record at moment t (the owner change and the stage change can land together).
function makeOwnerAt(ownerHistory, current) {
  return (t) => {
    let o = "";
    for (const h of ownerHistory) { if (h.at <= t + 2000) o = h.value; else break; }
    return o || String(current || "");
  };
}

const AUTOMATIC = /AUTOMATION|WORKFLOW|IMPORT|MIGRATION|CALCULATED|FORM|SEQUENCE|BOT|ANALYTICS|MERGE|SALESFORCE|ENRICHMENT|AI_GROUP/i;
function sourceText(h) {
  const t = String(h.sourceType || "").toUpperCase();
  if (/AUTOMATION|WORKFLOW/.test(t)) return "Workflow";
  if (/IMPORT/.test(t)) return "Import";
  if (/FORM/.test(t)) return "Form";
  if (/MERGE/.test(t)) return "Merge";
  if (/INTEGRATION/.test(t)) return h.sourceLabel ? `App (${h.sourceLabel})` : "App";
  if (t === "API") return "API";
  if (/MOBILE/.test(t)) return "HubSpot mobile app";
  if (/CRM_UI|BATCH/.test(t)) return "HubSpot";
  return t ? t.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()) : "Unknown";
}

// Who a change is credited to. A HubSpot user: that user. No user on it (an app or the API):
// whoever owned the record then. A workflow, import or form: nobody, unless allowAutomatic.
function whoChanged(h, { people, selected, ownerAt, allowAutomatic = false }) {
  if (h.userId) {
    const oid = people.userToOwner[h.userId] || (selected.has(h.userId) ? h.userId : "");
    if (oid && selected.has(oid)) return { credit: oid, how: "user", by: people.ownerName[oid] || oid };
    return { credit: null, how: "otherUser", by: people.userName[h.userId] || (oid && people.ownerName[oid]) || `HubSpot user ${h.userId}` };
  }
  const automatic = AUTOMATIC.test(h.sourceType);
  const owner = ownerAt(h.at);
  const what = automatic ? sourceText(h) : `${sourceText(h)}, no user recorded`;
  if ((automatic ? allowAutomatic : SETTINGS.CREDIT_NO_USER_TO_OWNER) && owner && selected.has(owner)) {
    return { credit: owner, how: automatic ? "automaticOwner" : "noUserOwner", by: what };
  }
  return { credit: null, how: automatic ? "automatic" : "noUser", by: what };
}
const HOW_TEXT = {
  user: "By them", noUserOwner: "Credited to the contact or deal owner (no user recorded)", automaticOwner: "Credited to the deal owner (automatic)",
  otherUser: "By someone else, not counted", automatic: "Automatic, not counted", noUser: "No user recorded, not counted",
};

// ---------- the counting ----------
const KINDS = ["connected", "meeting", "noAnswer", "busy", "wrong", "message", "other", "none"];
function blank() {
  return {
    calls: 0, dialled: 0, byHand: 0, inbound: 0, connected: 0, kinds: Object.fromEntries(KINDS.map((k) => [k, 0])),
    contactsCalled: new Set(), dealsOnCalls: new Set(), naContacts: new Set(),
    marked: { noAnswer: new Set(), didntFill: new Set(), qualified: new Set(), ineligible: new Set(), other: new Set() },
    emails: 0, emailsOnDeals: 0, emailsOnContacts: 0, dealsEmailed: new Set(), contactsEmailed: new Set(), sequence: 0, bounced: 0,
    messages: 0, notes: 0, tasks: 0, meetings: 0,
    touched: new Set(), dealsCreated: new Set(), dealsMoved: new Set(), ccl: new Set(), lost: new Set(),
  };
}
function merge(list) {
  const t = blank();
  for (const m of list) {
    for (const [k, v] of Object.entries(m)) {
      if (typeof v === "number") t[k] += v;
      else if (v instanceof Set) for (const x of v) t[k].add(x);
    }
    for (const k of KINDS) t.kinds[k] += m.kinds[k];
    for (const g of Object.keys(t.marked)) for (const x of m.marked[g]) t.marked[g].add(x);
  }
  return t;
}
function flat(m) {
  return {
    calls: m.calls, dialled: m.dialled, byHand: m.byHand, inbound: m.inbound,
    contacts: m.contactsCalled.size, dealsOnCalls: m.dealsOnCalls.size,
    connected: m.connected, noAnswer: m.kinds.noAnswer, busy: m.kinds.busy, wrong: m.kinds.wrong, message: m.kinds.message,
    meeting: m.kinds.meeting, otherOutcome: m.kinds.other, noOutcome: m.kinds.none, naContacts: m.naContacts.size,
    markedNoAnswer: m.marked.noAnswer.size, markedDidntFill: m.marked.didntFill.size, markedQualified: m.marked.qualified.size,
    markedIneligible: m.marked.ineligible.size, markedOther: m.marked.other.size,
    emails: m.emails, emailsOnDeals: m.emailsOnDeals, emailsOnContacts: m.emailsOnContacts, dealsEmailed: m.dealsEmailed.size,
    contactsEmailed: m.contactsEmailed.size, sequence: m.sequence, bounced: m.bounced,
    messages: m.messages, notes: m.notes, tasks: m.tasks, meetings: m.meetings, dueToday: 0, overdue: 0, naLeads: 0,
    dealsTouched: m.touched.size, dealsCreated: m.dealsCreated.size, dealsMoved: m.dealsMoved.size, ccl: m.ccl.size, lost: m.lost.size,
  };
}
const isActive = (f) => f.calls + f.inbound + f.emails + f.sequence + f.messages + f.notes + f.tasks + f.meetings + f.dealsTouched +
  f.markedNoAnswer + f.markedDidntFill + f.markedQualified + f.markedIneligible + f.markedOther + f.lost > 0;
const sum = (rows) => { const out = {}; for (const r of rows) for (const [k, v] of Object.entries(r)) out[k] = (out[k] || 0) + v; return out; };

function count(world) {
  const { period, consultants, people } = world;
  const selected = new Set(consultants.map((c) => String(c.ownerId)));
  const inPeriod = (t) => t >= period.start && t < period.end;
  const grid = new Map();
  const cell = (oid, day) => { const k = `${oid}|${day}`; let m = grid.get(k); if (!m) grid.set(k, (m = blank())); return m; };
  const detail = { calls: [], emails: [], stages: [], ccl: [], lost: [], dueTasks: [], touched: new Map() };
  const workedBy = new Map();                      // "contact|day" -> the consultants who worked it
  const noteWork = (cid, day, oid) => { const k = `${cid}|${day}`; if (!workedBy.has(k)) workedBy.set(k, new Set()); workedBy.get(k).add(oid); };
  const touch = (m, oid, day, did, why) => {
    m.touched.add(did);
    const k = `${oid}|${day}|${did}`;
    if (!detail.touched.has(k)) detail.touched.set(k, new Set());
    detail.touched.get(k).add(why);
  };
  const L = world.links || {};
  const linked = (type, to, id) => (L[type] && L[type][to] && L[type][to].get(String(id))) || [];

  // calls
  for (const r of world.act.calls || []) {
    const c = normCall(r.id, r.p, world.dispo);
    if (!selected.has(c.ownerId) || !inPeriod(c.at)) continue;
    const day = dateKey(c.at), m = cell(c.ownerId, day);
    const contacts = linked("calls", "contacts", c.id), deals = linked("calls", "deals", c.id);
    detail.calls.push({ ...c, day, contacts, deals });
    contacts.forEach((x) => noteWork(x, day, c.ownerId));
    deals.forEach((d) => touch(m, c.ownerId, day, d, c.inbound ? "inbound call" : "call"));
    if (c.inbound) m.inbound++;
    if (c.inbound && !SETTINGS.COUNT_INBOUND_CALLS) continue;
    m.calls++;
    if (c.dialled) m.dialled++; else m.byHand++;
    m.kinds[c.kind]++;
    if (c.connected) m.connected++;
    contacts.forEach((x) => { m.contactsCalled.add(x); if (c.kind === "noAnswer") m.naContacts.add(x); });
    deals.forEach((d) => m.dealsOnCalls.add(d));
  }

  // emails
  for (const r of world.act.emails || []) {
    const e = normEmail(r.id, r.p);
    if (!selected.has(e.ownerId) || !inPeriod(e.at) || !e.sent) continue;
    const day = dateKey(e.at), m = cell(e.ownerId, day);
    const contacts = linked("emails", "contacts", e.id), deals = linked("emails", "deals", e.id);
    detail.emails.push({ ...e, day, contacts, deals });
    if (e.bounced) m.bounced++;
    if (e.sequence) { m.sequence++; continue; }
    m.emails++;
    if (deals.length) m.emailsOnDeals++;
    if (contacts.length) m.emailsOnContacts++;
    contacts.forEach((x) => { m.contactsEmailed.add(x); noteWork(x, day, e.ownerId); });
    deals.forEach((d) => { m.dealsEmailed.add(d); touch(m, e.ownerId, day, d, "email"); });
  }

  // WhatsApp and other logged messages, notes, completed tasks, meetings
  const simple = [
    ["communications", "messages", "hs_timestamp", (p) => (/WHATS/i.test(p.hs_communication_channel_type || "") || !p.hs_communication_channel_type ? "WhatsApp" : "message")],
    ["notes", "notes", "hs_timestamp", () => "note"],
    ["tasks", "tasks", "hs_task_completion_date", () => "task completed"],
    ["meetings", "meetings", "hs_timestamp", () => "meeting"],
  ];
  for (const [type, field, prop, why] of simple) {
    for (const r of world.act[type] || []) {
      const oid = String(r.p.hubspot_owner_id || ""), at = ms(r.p[prop]);
      if (!selected.has(oid) || !inPeriod(at)) continue;
      const day = dateKey(at), m = cell(oid, day);
      m[field]++;
      linked(type, "contacts", r.id).forEach((x) => noteWork(x, day, oid));
      linked(type, "deals", r.id).forEach((d) => touch(m, oid, day, d, why(r.p)));
    }
  }

  // lead stages marked
  for (const [cid, rec] of world.contacts || new Map()) {
    if (!rec || !rec.history) continue;
    const hist = parseHistory(rec.history.lead_stage);
    if (!hist.some((h) => inPeriod(h.at))) continue;
    const ownerAt = makeOwnerAt(parseHistory(rec.history.hubspot_owner_id), (rec.properties || {}).hubspot_owner_id);
    hist.forEach((h, i) => {
      if (!inPeriod(h.at)) return;
      const day = dateKey(h.at);
      const w = whoChanged(h, { people, selected, ownerAt });
      const group = stageGroup(h.value);
      const row = { contactId: cid, at: h.at, day, to: h.value, from: i ? hist[i - 1].value : "", group, credit: w.credit, how: w.how, by: w.by, ownerAt: ownerAt(h.at) };
      if (w.credit) {
        if (group !== "cleared") cell(w.credit, day).marked[group].add(cid);
        detail.stages.push(row);
      } else if (workedBy.has(`${cid}|${day}`)) {
        detail.stages.push(row);                    // listed so the workbook shows what happened, not counted
      }
    });
  }

  // deal stages: deals created, moved, moved to CCL Sent, and moved to Deal Lost
  const ccl = world.cclIds || new Set();
  const lost = world.lostIds || new Set();
  for (const [did, rec] of world.deals || new Map()) {
    if (!rec || !rec.history) continue;
    const hist = parseHistory(rec.history.dealstage);
    if (!hist.some((h) => inPeriod(h.at))) continue;
    const ownerAt = makeOwnerAt(parseHistory(rec.history.hubspot_owner_id), (rec.properties || {}).hubspot_owner_id);
    const created = ms((rec.properties || {}).createdate);
    hist.forEach((h, i) => {
      if (!inPeriod(h.at)) return;
      const day = dateKey(h.at);
      const toCcl = ccl.has(h.value), toLost = lost.has(h.value);
      const creation = i === 0 && !!created && Math.abs(h.at - created) < 120e3;
      const allowAutomatic = (toCcl && SETTINGS.CCL_CREDIT_AUTOMATIC_TO_OWNER) || (toLost && SETTINGS.LOST_CREDIT_AUTOMATIC_TO_OWNER);
      const w = whoChanged(h, { people, selected, ownerAt, allowAutomatic });
      const row = { dealId: did, at: h.at, day, from: i ? hist[i - 1].value : "", to: h.value, credit: w.credit, how: w.how, by: w.by, ownerAt: ownerAt(h.at), creation };
      if (toCcl) detail.ccl.push(row);
      if (toLost) detail.lost.push(row);
      if (!w.credit) return;
      const m = cell(w.credit, day);
      if (creation) m.dealsCreated.add(did); else m.dealsMoved.add(did);
      touch(m, w.credit, day, did, creation ? "deal created" : toCcl ? "moved to CCL Sent" : toLost ? "moved to Deal Lost" : "stage moved");
      if (toCcl) m.ccl.add(did);
      if (toLost) m.lost.add(did);
    });
  }

  // per consultant, per day, and the team
  const out = consultants.map((c) => {
    const cells = period.days.map((d) => grid.get(`${c.ownerId}|${d}`)).filter(Boolean);
    const total = flat(merge(cells));
    const daily = {};
    for (const d of period.days) daily[d] = flat(grid.get(`${c.ownerId}|${d}`) || blank());
    return { ownerId: String(c.ownerId), name: c.name, total, daily, active: isActive(total) };
  });
  // open tasks and No Answer leads are counted when the report runs, not per day
  const open = world.openTasks || { dueToday: new Map(), overdue: new Map() };
  for (const p of out) {
    p.total.dueToday = open.dueToday.get(p.ownerId) || 0;
    p.total.overdue = open.overdue.get(p.ownerId) || 0;
    p.total.naLeads = (world.naLeads && world.naLeads.counts.get(p.ownerId)) || 0;
    p.teams = (world.teamsOf || {})[p.ownerId] || [];
  }
  for (const t of (world.openTasks && world.openTasks.due) || []) {
    const oid = String(t.p.hubspot_owner_id || "");
    if (!selected.has(oid)) continue;
    detail.dueTasks.push({ id: t.id, at: ms(t.p.hs_timestamp), ownerId: oid, subject: String(t.p.hs_task_subject || "").trim(),
      status: String(t.p.hs_task_status || ""), type: String(t.p.hs_task_type || ""), contacts: linked("dueTasks", "contacts", t.id), deals: linked("dueTasks", "deals", t.id) });
  }
  detail.dueTasks.sort((a, b) => a.at - b.at);
  // the overall row: everyone shown (people with no activity are not shown, so their open tasks are not added)
  const team = sum([flat(blank()), ...out.filter((p) => p.active).map((p) => p.total)]);
  const byDay = period.days.map((d) => ({ day: d, ...sum(out.map((p) => p.daily[d])), active: out.filter((p) => isActive(p.daily[d])).length }));
  // changes that were seen but not counted, so the email can say so
  const notCounted = {
    stagesAutomatic: detail.stages.filter((s) => !s.credit && /^automatic/.test(s.how)).length,
    stagesOther: detail.stages.filter((s) => !s.credit && !/^automatic/.test(s.how)).length,
    cclOther: detail.ccl.filter((x) => !x.credit).length,
    lostOther: detail.lost.filter((x) => !x.credit).length,
  };
  detail.calls.sort((a, b) => a.at - b.at);
  detail.emails.sort((a, b) => a.at - b.at);
  detail.stages.sort((a, b) => a.at - b.at);
  detail.ccl.sort((a, b) => a.at - b.at);
  detail.lost.sort((a, b) => a.at - b.at);
  const groups = groupByTeam(out, world.teams);
  const hidden = out.filter((p) => !p.active).length;
  return { people: out, team, byDay, detail, notCounted, groups, hidden };
}

// The people to show, grouped by team in the order of TEAMS, each team with its totals. People
// who did nothing in the period are left out, and so is a team with nobody left. Someone in two
// teams shows in both.
const byActivity = (a, b) => b.total.calls - a.total.calls || b.total.dealsTouched - a.total.dealsTouched || b.total.emails - a.total.emails || a.name.localeCompare(b.name);
function groupByTeam(people, teams = []) {
  const shown = people.filter((p) => p.active);
  const byId = new Map(shown.map((p) => [String(p.ownerId), p]));
  const groups = [];
  for (const t of teams) {
    const members = [...new Set(t.members.map((m) => String(m.id)))].map((id) => byId.get(id)).filter(Boolean).sort(byActivity);
    if (members.length) groups.push({ name: t.name, people: members, total: sum(members.map((m) => m.total)) });
  }
  return groups;
}

module.exports = { count, groupByTeam, byActivity, normCall, normEmail, parseHistory, whoChanged, makeOwnerAt, stageGroup, outcomeKind, sourceText, flat, blank, merge, isActive, HOW_TEXT, STANDARD_DISPOSITIONS, AUTOMATIC };
