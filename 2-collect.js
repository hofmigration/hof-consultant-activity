// 2-collect.js — reads, once, everything the report counts: the consultants' calls, emails,
// WhatsApps, notes, completed tasks and meetings in the period; the contacts and deals linked
// to them; the Lead Stage history of every contact that could have been marked; the deal
// stage history of every deal that moved; and their open tasks due today or overdue.
// Nothing is written to HubSpot.
const { SETTINGS, TEAMS } = require("./config");
const H = require("./0-hubspot");
const { STANDARD_DISPOSITIONS } = require("./3-count");
const { dayStart, DAY, parseDay } = require("./1-clock");

const ACTIVITIES = {
  calls: { label: "Calls", required: true, dateProp: "hs_timestamp",
    props: ["hs_timestamp", "hs_call_disposition", "hs_call_direction", "hs_call_status", "hs_call_duration", "hs_call_to_number", "hs_call_source", "hs_call_title", "hubspot_owner_id"] },
  emails: { label: "Emails", required: true, dateProp: "hs_timestamp",
    props: ["hs_timestamp", "hs_email_direction", "hs_email_status", "hs_email_subject", "hs_sequence_id", "hs_email_to_email", "hubspot_owner_id"],
    filters: [{ propertyName: "hs_email_direction", operator: "IN", values: ["EMAIL", "FORWARDED_EMAIL"] }] },
  communications: { label: "WhatsApp messages", dateProp: "hs_timestamp", props: ["hs_timestamp", "hs_communication_channel_type", "hubspot_owner_id"] },
  notes: { label: "Notes", dateProp: "hs_timestamp", props: ["hs_timestamp", "hubspot_owner_id"] },
  tasks: { label: "Completed tasks", dateProp: "hs_task_completion_date", props: ["hs_task_completion_date", "hs_task_subject", "hs_task_status", "hubspot_owner_id"],
    filters: [{ propertyName: "hs_task_status", operator: "EQ", value: "COMPLETED" }] },
  meetings: { label: "Meetings", dateProp: "hs_timestamp", props: ["hs_timestamp", "hs_meeting_title", "hs_meeting_outcome", "hubspot_owner_id"] },
};
const CONTACT_PROPS = ["firstname", "lastname", "lead_stage", "hubspot_owner_id", "createdate"];
const DEAL_PROPS = ["dealname", "pipeline", "dealstage", "hubspot_owner_id", "amount", "createdate"];

const short = (e) => String((e && e.message) || e).slice(0, 140);
const secs = (t0) => Math.round((Date.now() - t0) / 1000);
const words = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);

// Everyone the report covers: the people in the teams, and nobody else.
function roster() {
  const byId = new Map(), teamsOf = {};
  for (const t of TEAMS) {
    for (const m of t.members) {
      const id = String(m.id);
      if (!byId.has(id)) byId.set(id, { ownerId: id, name: m.name });
      teamsOf[id] = [...new Set([...(teamsOf[id] || []), t.name])];
    }
  }
  return { people: [...byId.values()], teamsOf };
}

// "all" (or nothing) = everyone in the teams. Otherwise names, team names or HubSpot owner ids,
// separated by commas. Every word typed must be in the name ("Fazal" finds Fazal Mehdi; "Fahad
// team" finds Fahad Butt's Team). Only people in the teams can be picked.
function pickConsultants(input, hubOwners = []) {
  const raw = String(input || "").trim();
  const ours = roster().people;
  if (!raw || /^(all|everyone|everybody|all consultants|\*|-)$/i.test(raw)) return { found: ours, all: true, problems: [] };
  // each person can be found by the name used here or by their name in HubSpot
  const hubName = new Map(hubOwners.map((h) => [h.ownerId, h.name]));
  const everyone = ours.map((o) => ({ ...o, names: [o.name, hubName.get(o.ownerId)].filter(Boolean).map((x) => words(x)) }));
  const found = [], problems = [];
  const add = (o) => { if (!found.some((f) => f.ownerId === o.ownerId)) found.push(o); };
  for (const term of raw.split(/[,;|\n]+/).map((t) => t.trim()).filter(Boolean)) {
    if (words(term).includes("team")) {
      const want = words(term).filter((w) => w !== "s");
      const teams = TEAMS.filter((t) => want.every((w) => words(t.name).includes(w)));
      if (teams.length === 1) teams[0].members.forEach((m) => add(ours.find((o) => o.ownerId === String(m.id))));
      else if (!teams.length) problems.push(`No team matches "${term}". The teams are: ${TEAMS.map((t) => t.name).join(", ")}.`);
      else problems.push(`"${term}" matches ${teams.length} teams (${teams.map((t) => t.name).join(", ")}). Type more of the name.`);
      continue;
    }
    if (/^\d+$/.test(term)) {
      const o = everyone.find((x) => x.ownerId === term);
      if (o) add(o); else problems.push(`Nobody in the teams has the HubSpot id ${term}.`);
      continue;
    }
    const tw = words(term);
    if (!tw.length) continue;
    const exact = everyone.filter((o) => o.names.some((nm) => nm.join(" ") === tw.join(" ")));
    let hits = exact.length ? exact : everyone.filter((o) => o.names.some((nm) => tw.every((w) => nm.includes(w))));
    if (!hits.length) problems.push(`Nobody in the teams matches "${term}".`);
    else if (hits.length > 1) problems.push(`"${term}" matches ${hits.length} people (${hits.map((h) => h.name).join(", ")}). Type more of the name.`);
    else add(hits[0]);
  }
  return { found: found.map(({ names, ...o }) => o), all: false, problems };
}

async function linksFor(type, to, ids) {
  try { return await H.links(type, to, ids); } catch (e) {
    if (type === "communications") return H.links("0-18", to, ids);
    throw e;
  }
}

async function collect({ period, consultantsInput, log = console.log, now = Date.now() }) {
  const t0 = Date.now();
  const warnings = [];

  // 1. people
  let hubOwners = [];
  try { hubOwners = await H.owners(); } catch (e) { warnings.push(`HubSpot's list of users could not be read (${short(e)}), so some lead stage changes and CCL Sent moves may not be matched to the consultant who made them.`); }
  const sel = pickConsultants(consultantsInput, hubOwners);
  if (sel.problems.length) throw new Error(sel.problems.join(" "));
  if (!sel.found.length) throw new Error("No consultants were chosen.");
  const consultants = sel.found.map((c) => ({ ownerId: c.ownerId, name: c.name }));
  const ownerIds = consultants.map((c) => c.ownerId);
  const people = { userToOwner: {}, userName: {}, ownerName: {} };
  for (const o of hubOwners) {
    people.ownerName[o.ownerId] = o.name;
    if (o.userId) { people.userToOwner[o.userId] = o.ownerId; people.userName[o.userId] = o.name; }
  }
  for (const o of roster().people) people.ownerName[o.ownerId] = o.name;
  const { teamsOf } = roster();
  log(`Consultants: ${sel.all ? `all ${consultants.length}` : consultants.map((c) => c.name).join(", ")}`);

  // 2. pipelines and call outcomes
  let pipes = { stages: {}, names: {} };
  try { pipes = await H.pipelines(); } catch (e) { warnings.push(`Deal pipelines could not be read (${short(e)}), so CCL Sent was matched on its known stage ids only.`); }
  const norm = (s) => String(s || "").trim().toLowerCase();
  const cclIds = new Set(SETTINGS.CCL_STAGE_IDS.map(String));
  for (const [id, s] of Object.entries(pipes.stages)) if (SETTINGS.CCL_STAGE_LABELS.some((l) => norm(l) === norm(s.label))) cclIds.add(id);
  for (const id of SETTINGS.CCL_STAGE_IDS) if (!pipes.stages[id]) pipes.stages[id] = { label: "CCL Sent", pipelineId: "" };
  const lostIds = new Set(SETTINGS.LOST_STAGE_IDS.map(String));
  for (const [id, s] of Object.entries(pipes.stages)) {
    if (SETTINGS.SALES_PIPELINES.includes(s.pipelineId) && SETTINGS.LOST_STAGE_LABELS.some((l) => norm(l) === norm(s.label))) lostIds.add(id);
  }
  for (const id of SETTINGS.LOST_STAGE_IDS) if (!pipes.stages[id]) pipes.stages[id] = { label: "Deal Lost", pipelineId: "" };
  const dispo = { ...STANDARD_DISPOSITIONS, ...(await H.options("calls", "hs_call_disposition")) };
  const leadLabels = await H.options("contacts", "lead_stage");

  // 3. the consultants' own calls, emails, messages, notes, tasks and meetings in the period
  const act = {}, available = {};
  for (const [type, spec] of Object.entries(ACTIVITIES)) {
    try {
      const rows = new Map();
      for (let i = 0; i < ownerIds.length; i += 100) {
        const found = await H.searchRange(type, [{ propertyName: "hubspot_owner_id", operator: "IN", values: ownerIds.slice(i, i + 100) }, ...(spec.filters || [])],
          spec.dateProp, period.start, period.end, spec.props);
        for (const r of found) rows.set(String(r.id), { id: String(r.id), p: r.properties || {} });
      }
      act[type] = [...rows.values()];
      available[type] = true;
    } catch (e) {
      if (spec.required) throw new Error(`${spec.label} could not be read from HubSpot: ${short(e)}`);
      act[type] = []; available[type] = false;
      warnings.push(`${spec.label} could not be read from HubSpot (${short(e)}), so they are left out of this report.`);
    }
    log(`  ${type}: ${act[type].length}`);
  }

  // 4. the contacts and deals linked to them
  const links = {};
  for (const type of Object.keys(ACTIVITIES)) {
    links[type] = { contacts: new Map(), deals: new Map() };
    const ids = act[type].map((r) => r.id);
    if (!ids.length) continue;
    for (const to of ["contacts", "deals"]) {
      try { links[type][to] = await linksFor(type, to, ids); }
      catch (e) { warnings.push(`The ${to} linked to ${ACTIVITIES[type].label.toLowerCase()} could not be read (${short(e)}).`); }
    }
  }
  log(`Links read (${secs(t0)}s)`);

  // 5. every contact whose Lead Stage could have been marked: the contacts the consultants
  // worked (sequence emails aside), and their contacts now in a counted stage that have
  // changed in any way since the period began (a stage can be set without any call logged).
  const seq = new Set(act.emails.filter((e) => String(e.p.hs_sequence_id || "").trim()).map((e) => e.id));
  const worked = new Set();
  for (const type of Object.keys(ACTIVITIES)) {
    for (const [eid, cids] of links[type].contacts) if (!(type === "emails" && seq.has(eid))) for (const c of cids) worked.add(c);
  }
  const tracked = [...new Set(Object.values(SETTINGS.LEAD_STAGES).flat())];
  const staged = [];
  try {
    for (let i = 0; i < ownerIds.length; i += 100) {
      staged.push(...await H.searchRange("contacts", [
        { propertyName: "hubspot_owner_id", operator: "IN", values: ownerIds.slice(i, i + 100) },
        { propertyName: "lead_stage", operator: "IN", values: tracked }],
      "lastmodifieddate", period.start, Infinity, ["hs_object_id"], { sortProp: "hs_object_id" }));
    }
  } catch (e) {
    warnings.push(`Contacts recently moved to a counted lead stage could not be searched (${short(e)}), so only contacts the consultants worked were checked for lead stage changes.`);
  }
  const candidates = H.uniq([...worked, ...staged.map((r) => r.id)]);
  log(`Contacts checked for lead stage changes: ${candidates.length} (${worked.size} worked, ${staged.length} changed since the period began)`);
  const ch = await H.historyFor("contacts", candidates, CONTACT_PROPS, ["lead_stage", "hubspot_owner_id"], period.start, log);
  if (ch.failed) warnings.push(`The lead stage history of ${ch.failed} contacts could not be read, so any change on them is missing.`);
  const contacts = ch.map;

  // 6. every deal that changed stage (or was created) since the period began, with its history
  let moved = [];
  try {
    moved = await H.searchRange("deals", [], "hs_v2_date_entered_current_stage", period.start, Infinity, ["hs_object_id"], { sortProp: "hs_object_id" });
  } catch (e) {
    try { moved = await H.searchRange("deals", [], "hs_lastmodifieddate", period.start, Infinity, ["hs_object_id"], { sortProp: "hs_object_id" }); }
    catch (e2) { warnings.push(`Deals that changed stage could not be searched (${short(e2)}), so stage moves and CCL Sent are missing.`); }
  }
  const dh = await H.historyFor("deals", moved.map((r) => r.id), DEAL_PROPS, ["dealstage", "hubspot_owner_id"], period.start, log);
  if (dh.failed) warnings.push(`The stage history of ${dh.failed} deals could not be read, so any move on them is missing.`);
  const deals = dh.map;
  log(`Deals that changed stage: ${deals.size}`);

  // 7. open tasks, counted when the report runs: due today (the day it is sent) and overdue
  // (due before today, however old). The ones due today are listed in the workbook.
  const today = dayStart(now);
  const openTasks = { available: false, today, dueToday: new Map(), overdue: new Map(), due: [] };
  try {
    const due = new Map();
    for (let i = 0; i < ownerIds.length; i += 100) {
      const found = await H.searchRange("tasks", [
        { propertyName: "hubspot_owner_id", operator: "IN", values: ownerIds.slice(i, i + 100) },
        { propertyName: "hs_task_status", operator: "NEQ", value: "COMPLETED" }],
      "hs_timestamp", today, today + DAY, ["hs_timestamp", "hs_task_subject", "hs_task_status", "hs_task_type", "hubspot_owner_id"]);
      for (const r of found) due.set(String(r.id), { id: String(r.id), p: r.properties || {} });
    }
    openTasks.due = [...due.values()];
    for (const t of openTasks.due) { const o = String(t.p.hubspot_owner_id || ""); openTasks.dueToday.set(o, (openTasks.dueToday.get(o) || 0) + 1); }
    await H.pool(ownerIds, 3, async (oid) => {
      const r = await H.hs("POST", "/crm/v3/objects/tasks/search", { filterGroups: [{ filters: [
        { propertyName: "hubspot_owner_id", operator: "EQ", value: oid },
        { propertyName: "hs_task_status", operator: "NEQ", value: "COMPLETED" },
        { propertyName: "hs_timestamp", operator: "LT", value: String(today) }] }], properties: ["hs_object_id"], limit: 1 }, "search");
      openTasks.overdue.set(oid, (r && r.total) || 0);
    });
    openTasks.available = true;
    links.dueTasks = { contacts: new Map(), deals: new Map() };
    if (openTasks.due.length) {
      for (const to of ["contacts", "deals"]) {
        try { links.dueTasks[to] = await H.links("tasks", to, openTasks.due.map((t) => t.id)); } catch (e) { /* the list just shows no contact or deal */ }
      }
    }
    log(`Open tasks: ${openTasks.due.length} due today, ${[...openTasks.overdue.values()].reduce((a, b) => a + b, 0)} overdue`);
  } catch (e) {
    warnings.push(`Open tasks could not be read from HubSpot (${short(e)}), so Due today and Overdue are missing.`);
  }

  // 8. No Answer leads, counted when the report runs: contacts each consultant owns whose Lead
  // Stage is No Answer now, out of the leads created since NO_ANSWER_LEADS_FROM
  const naFrom = parseDay(SETTINGS.NO_ANSWER_LEADS_FROM);
  const naLeads = { available: false, from: naFrom, counts: new Map() };
  try {
    if (naFrom == null) throw new Error(`NO_ANSWER_LEADS_FROM in config.js is not a date like 2026-01-01`);
    await H.pool(ownerIds, 3, async (oid) => {
      const r = await H.hs("POST", "/crm/v3/objects/contacts/search", { filterGroups: [{ filters: [
        { propertyName: "hubspot_owner_id", operator: "EQ", value: oid },
        { propertyName: "lead_stage", operator: "IN", values: SETTINGS.LEAD_STAGES.noAnswer },
        { propertyName: "createdate", operator: "GTE", value: String(naFrom) }] }], properties: ["hs_object_id"], limit: 1 }, "search");
      naLeads.counts.set(oid, (r && r.total) || 0);
    });
    naLeads.available = true;
    log(`No Answer leads since ${SETTINGS.NO_ANSWER_LEADS_FROM}: ${[...naLeads.counts.values()].reduce((a, b) => a + b, 0)}`);
  } catch (e) {
    warnings.push(`No Answer leads could not be counted (${short(e)}).`);
  }

  // 9. names for every other contact and deal in the report
  try {
    const linkedDeals = H.uniq(Object.values(links).flatMap((l) => [...l.deals.values()].flat())).filter((id) => !deals.has(id));
    for (const [id, p] of await H.batchRead("deals", linkedDeals, DEAL_PROPS)) deals.set(id, { properties: p, history: null });
    const linkedContacts = H.uniq(Object.values(links).flatMap((l) => [...l.contacts.values()].flat())).filter((id) => !contacts.has(id));
    for (const [id, p] of await H.batchRead("contacts", linkedContacts, CONTACT_PROPS)) contacts.set(id, { properties: p, history: null });
  } catch (e) { warnings.push(`Some contact or deal names could not be read (${short(e)}).`); }

  log(`Read in ${secs(t0)}s with ${H.stats.calls} HubSpot requests (${H.stats.retries} retried); history read ${ch.mode === "batch" ? "in batches" : "one by one"}`);
  return {
    period, consultants, allSelected: sel.all, people, teams: TEAMS, teamsOf, pipes, cclIds, lostIds, dispo, leadLabels, act, links, contacts, deals, openTasks, naLeads, available, warnings,
    historyMode: { contacts: ch.mode, deals: dh.mode, checked: ch.checked + dh.checked },
  };
}

module.exports = { collect, pickConsultants, roster, ACTIVITIES, CONTACT_PROPS, DEAL_PROPS };
