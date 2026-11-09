// selftest.js — checks the rules on invented records before every run, with no network.
// The last part runs the whole report against a fake HubSpot and checks every number.
// Run: node selftest.js
process.env.SEARCH_RPS = process.env.SEARCH_RPS || "1000";
process.env.API_RPS = process.env.API_RPS || "1000";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { TEAMS, SETTINGS } = require("./config");
const { resolvePeriod, parseDay, dateKey } = require("./1-clock");
const { pickConsultants, roster } = require("./2-collect");
const C = require("./3-count");
const { buildEmail, fitEmail, subjectFor } = require("./5-email");

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); }
}
const OFF = 5 * 3600e3;
// "2026-11-05 10:00" Pakistan time -> ISO
const pk = (s) => new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), +(s.slice(11, 13) || 0), +(s.slice(14, 16) || 0), +(s.slice(17, 19) || 0)) - OFF).toISOString();
const pkMs = (s) => Date.parse(pk(s));

async function main() {
  // ---------- who is in the report: the teams, and nobody else ----------
  await test("the teams: real owner ids, nobody twice in one team, 55 people in all", () => {
    assert.strictEqual(TEAMS.length, 9);
    for (const t of TEAMS) {
      assert.ok(t.members.length, `${t.name} has nobody`);
      assert.strictEqual(new Set(t.members.map((m) => m.id)).size, t.members.length, `${t.name} lists someone twice`);
      for (const m of t.members) assert.match(m.id, /^\d+$/, `${m.name} has no owner id`);
    }
    const r = roster();
    assert.strictEqual(r.people.length, 55);
    assert.deepStrictEqual(r.teamsOf["76337312"], ["Waleed's Team"], "Patrecia is in Waleed's Team only");
    assert.deepStrictEqual(r.teamsOf["99731787"], ["Insha's Team", "Khurram's Team"], "Aliza is in two teams");
    assert.strictEqual(r.people.find((p) => p.ownerId === "100679683").name, "Fazal Mehdi", "the team list's name wins");
    assert.ok(!r.people.some((p) => p.ownerId === "101275168"), "Ujala Ali is in no team, so not in the report");
  });

  // ---------- periods ----------
  await test("Friday 11:00 reports on Thursday", () => {
    const p = resolvePeriod({ now: pkMs("2026-11-06 11:00") });
    assert.deepStrictEqual(p.days, ["2026-11-05"]);
    assert.strictEqual(p.start, pkMs("2026-11-05 00:00"));
    assert.strictEqual(p.end, pkMs("2026-11-06 00:00"));
    assert.strictEqual(p.label, "Thu 5 Nov 2026");
    assert.strictEqual(p.long, "Thursday 5 November 2026");
  });
  await test("Monday reports on Saturday and Sunday", () => {
    const p = resolvePeriod({ period: "Yesterday", now: pkMs("2026-11-09 10:40") });
    assert.deepStrictEqual(p.days, ["2026-11-07", "2026-11-08"]);
    assert.strictEqual(p.label, "Sat 7 Nov to Sun 8 Nov 2026");
  });
  await test("a run on Sunday reports on Saturday", () => {
    assert.deepStrictEqual(resolvePeriod({ now: pkMs("2026-11-08 11:00") }).days, ["2026-11-07"]);
  });
  await test("just after midnight Pakistan time it is already the next day", () => {
    assert.deepStrictEqual(resolvePeriod({ now: pkMs("2026-11-06 00:05") }).days, ["2026-11-05"]);
    assert.strictEqual(dateKey(pkMs("2026-11-05 23:59")), "2026-11-05");
    assert.strictEqual(dateKey(pkMs("2026-11-06 00:00")), "2026-11-06");
  });
  await test("typed dates win over the period choice", () => {
    const p = resolvePeriod({ period: "Yesterday", from: "2026-11-02", to: "2026-11-04", now: pkMs("2026-11-06 11:00") });
    assert.deepStrictEqual(p.days, ["2026-11-02", "2026-11-03", "2026-11-04"]);
    assert.strictEqual(p.label, "Mon 2 Nov to Wed 4 Nov 2026");
    const one = resolvePeriod({ period: "Custom dates", from: "2026-11-3", now: pkMs("2026-11-06 11:00") });
    assert.deepStrictEqual(one.days, ["2026-11-03"]);
  });
  await test("bad dates are refused with a plain message", () => {
    assert.throws(() => resolvePeriod({ from: "05/11/2026", now: pkMs("2026-11-06 11:00") }), /YYYY-MM-DD/);
    assert.throws(() => resolvePeriod({ from: "2026-11-04", to: "2026-11-02", now: pkMs("2026-11-06 11:00") }), /before/);
    assert.throws(() => resolvePeriod({ period: "Custom dates", now: pkMs("2026-11-06 11:00") }), /Custom dates/);
    assert.strictEqual(parseDay("2026-02-30"), null);
  });
  await test("today so far, last 7 days, this month, last month", () => {
    const now = pkMs("2026-11-06 14:05");
    const t = resolvePeriod({ period: "Today so far", now });
    assert.strictEqual(t.end, now); assert.ok(t.label.includes("(to 14:05)"));
    const w = resolvePeriod({ period: "Last 7 days", now });
    assert.deepStrictEqual(w.days, ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"]);
    const m = resolvePeriod({ period: "This month so far", now });
    assert.strictEqual(m.days[0], "2026-11-01"); assert.strictEqual(m.days.length, 6);
    const lm = resolvePeriod({ period: "Last month", now });
    assert.strictEqual(lm.days.length, 31); assert.strictEqual(lm.label, "October 2026");
    assert.strictEqual(lm.fileLabel, "2026-10-01_to_2026-10-31");
  });

  // ---------- choosing consultants ----------
  const hub = [{ ownerId: "86250521", name: "Ali Raza" }, { ownerId: "100552613", name: "Ali Raza" }, { ownerId: "100679683", name: "Muhammad Fazal Mehdi" }, { ownerId: "303029285", name: "Waleed Bin Zaman" }];
  await test("all, a first name, an id, a team, a HubSpot name", () => {
    assert.strictEqual(pickConsultants("all", hub).found.length, 55);
    assert.strictEqual(pickConsultants("", hub).found.length, 55);
    assert.deepStrictEqual(pickConsultants("Fazal", hub).found.map((c) => c.ownerId), ["100679683"]);
    assert.deepStrictEqual(pickConsultants("84172062, fazal", hub).found.map((c) => c.name), ["Fatima Zahid", "Fazal Mehdi"]);
    assert.deepStrictEqual(pickConsultants("Ali Raza Shoukat", hub).found.map((c) => c.ownerId), ["100552613"]);
    assert.deepStrictEqual(pickConsultants("Ali Raza", hub).found.map((c) => c.ownerId), ["100552613"], "HubSpot's name finds the team member first");
    assert.deepStrictEqual(pickConsultants("Muhammad Fazal Mehdi", hub).found.map((c) => c.name), ["Fazal Mehdi"]);
    assert.deepStrictEqual(pickConsultants("ali raza qureshi", hub).found.map((c) => c.ownerId), ["83788398"]);
    const fahad = pickConsultants("Fahad Butt's Team", hub).found.map((c) => c.ownerId);
    assert.strictEqual(fahad.length, 8);
    assert.deepStrictEqual(pickConsultants("fahad team", hub).found.map((c) => c.ownerId), fahad);
    assert.deepStrictEqual(pickConsultants("Insha team", hub).found.map((c) => c.name), ["Insha Khan", "Zunera Saghar", "Iqra Jameel", "Aliza Ali"]);
    assert.strictEqual(pickConsultants("Insha team, Khurram team", hub).found.length, 8, "Aliza Ali once");
  });
  await test("an unclear or unknown name stops the run", () => {
    assert.match(pickConsultants("Raza", hub).problems.join(" "), /matches 2 people/);
    assert.match(pickConsultants("Nobody team", hub).problems.join(" "), /No team matches/);
    assert.match(pickConsultants("Insha", hub).problems.join(" "), /matches 2 people/);
    assert.match(pickConsultants("Nobody Here", hub).problems.join(" "), /Nobody in the teams matches/);
    assert.match(pickConsultants("Waleed Bin Zaman", hub).problems.join(" "), /Nobody in the teams matches/, "someone in no team cannot be picked");
    assert.match(pickConsultants("123", hub).problems.join(" "), /Nobody in the teams has the HubSpot id 123/);
  });

  // ---------- calls and emails ----------
  await test("dialler records and hand logs are told apart", () => {
    const d = C.normCall(1, { hs_call_source: "INTEGRATIONS_PLATFORM", hs_call_to_number: "+971500000000", hs_call_direction: "OUTBOUND", hs_call_disposition: "73a0d17f-1163-4015-bdd5-ec830791da20" });
    assert.ok(d.dialled); assert.strictEqual(d.kind, "noAnswer"); assert.ok(!d.connected);
    const h = C.normCall(2, { hs_call_disposition: "f240bbac-87c9-4f6e-bf70-924b57d47db7" });
    assert.ok(!h.dialled); assert.ok(h.connected); assert.strictEqual(h.kind, "connected");
    assert.ok(C.normCall(3, { hs_call_direction: "INBOUND" }).inbound);
    assert.strictEqual(C.normCall(4, {}).kind, "none");
    assert.ok(C.normCall(5, { hs_call_disposition: "2e7360c1-6b71-40e9-ab2b-30ae98a4678c" }).connected, "Meeting booked counts as connected");
    assert.strictEqual(C.outcomeKind("Left voicemail"), "message");
    assert.strictEqual(C.outcomeKind("Something new"), "other");
  });
  await test("email statuses and sequences", () => {
    assert.ok(C.normEmail(1, { hs_email_status: "BOUNCED" }).sent);
    assert.ok(C.normEmail(1, { hs_email_status: "BOUNCED" }).bounced);
    assert.ok(!C.normEmail(1, { hs_email_status: "FAILED" }).sent);
    assert.ok(!C.normEmail(1, { hs_email_status: "SCHEDULED" }).sent);
    assert.ok(C.normEmail(1, { hs_sequence_id: "77" }).sequence);
    assert.ok(!C.normEmail(1, { hs_sequence_id: "" }).sequence);
  });
  await test("lead stage groups", () => {
    assert.strictEqual(C.stageGroup("No Answer"), "noAnswer");
    assert.strictEqual(C.stageGroup("They Didn't Fill"), "didntFill");
    for (const q of SETTINGS.LEAD_STAGES.qualified) assert.strictEqual(C.stageGroup(q), "qualified");
    assert.strictEqual(C.stageGroup("Ineligible"), "ineligible");
    assert.strictEqual(C.stageGroup("Occupation Not Listed"), "other");
    assert.strictEqual(C.stageGroup("Call Back"), "other");
    assert.strictEqual(C.stageGroup(""), "cleared");
  });

  // ---------- who a change is credited to ----------
  const people = { userToOwner: { "5001": "84172062", "6001": "100552613" }, userName: { "5001": "Fatima Zahid", "6001": "Ali Raza" }, ownerName: { "84172062": "Fatima Zahid", "100679683": "Muhammad Fazal Mehdi", "100552613": "Ali Raza" } };
  const selected = new Set(["84172062", "100679683"]);
  const ownerFazal = () => "100679683";
  await test("a change by a consultant counts for them", () => {
    const w = C.whoChanged({ userId: "5001", sourceType: "CRM_UI", at: 1 }, { people, selected, ownerAt: ownerFazal });
    assert.strictEqual(w.credit, "84172062"); assert.strictEqual(w.how, "user");
  });
  await test("a user whose user id is their owner id still counts", () => {
    assert.strictEqual(C.whoChanged({ userId: "100679683", sourceType: "CRM_UI", at: 1 }, { people, selected, ownerAt: ownerFazal }).credit, "100679683");
  });
  await test("a change by someone else counts for nobody", () => {
    const w = C.whoChanged({ userId: "6001", sourceType: "CRM_UI", at: 1 }, { people, selected, ownerAt: ownerFazal });
    assert.strictEqual(w.credit, null); assert.strictEqual(w.by, "Ali Raza");
  });
  await test("a workflow's change counts for nobody, unless allowed (CCL)", () => {
    const h = { userId: "", sourceType: "AUTOMATION_PLATFORM", at: 1 };
    assert.strictEqual(C.whoChanged(h, { people, selected, ownerAt: ownerFazal }).credit, null);
    assert.strictEqual(C.whoChanged(h, { people, selected, ownerAt: ownerFazal, allowAutomatic: true }).credit, "100679683");
    assert.strictEqual(C.whoChanged({ ...h, sourceType: "IMPORT" }, { people, selected, ownerAt: ownerFazal }).credit, null);
  });
  await test("an app's change with no user counts for the owner at the time", () => {
    const w = C.whoChanged({ userId: "", sourceType: "INTEGRATION", sourceLabel: "ZIWO", at: 1 }, { people, selected, ownerAt: ownerFazal });
    assert.strictEqual(w.credit, "100679683"); assert.match(w.by, /App \(ZIWO\), no user recorded/);
    assert.strictEqual(C.whoChanged({ userId: "", sourceType: "API", at: 1 }, { people, selected, ownerAt: () => "999" }).credit, null);
  });
  await test("history: user from sourceId, oldest first, owner at a moment", () => {
    const h = C.parseHistory([
      { value: "B", timestamp: "2026-11-05T10:00:00Z", sourceType: "CRM_UI", sourceId: "userId:5001" },
      { value: "A", timestamp: "2026-11-01T10:00:00Z", sourceType: "CRM_UI", updatedByUserId: 6001 },
    ]);
    assert.deepStrictEqual(h.map((x) => x.value), ["A", "B"]);
    assert.strictEqual(h[1].userId, "5001"); assert.strictEqual(h[0].userId, "6001");
    const ownerAt = C.makeOwnerAt(C.parseHistory([{ value: "1", timestamp: "2026-11-01T00:00:00Z" }, { value: "2", timestamp: "2026-11-05T00:00:00Z" }]), "3");
    assert.strictEqual(ownerAt(Date.parse("2026-11-03T00:00:00Z")), "1");
    assert.strictEqual(ownerAt(Date.parse("2026-11-06T00:00:00Z")), "2");
    assert.strictEqual(C.makeOwnerAt([], "3")(5), "3");
  });

  // ---------- the email at full size ----------
  await test("the email for all 55 people busy at once fits Gmail, by team, with no em dashes", () => {
    const period = resolvePeriod({ now: pkMs("2026-11-06 11:00") });
    const blank = C.flat(C.blank());
    const peopleRows = roster().people.map((o, i) => {
      const f = { ...blank, calls: 300 - i, dialled: 150, byHand: 150 - i, contacts: 120, dealsOnCalls: 14, connected: 60, noAnswer: 150, markedNoAnswer: 80, markedDidntFill: 9, markedQualified: 4, markedIneligible: 12, emails: 40, emailsOnDeals: 22, emailsOnContacts: 39, sequence: i % 9 ? 0 : 450, tasks: 14, dueToday: 23, overdue: 1240 + i, naLeads: 1070 - i, dealsTouched: 31, ccl: i % 5, lost: i % 3 };
      return { ownerId: o.ownerId, name: o.name, total: f, daily: { [period.days[0]]: f }, active: true };
    });
    const sum = {}; for (const p of peopleRows) for (const [k, v] of Object.entries(p.total)) sum[k] = (sum[k] || 0) + v;
    const groups = C.groupByTeam(peopleRows, TEAMS);
    assert.deepStrictEqual(groups.map((g) => g.name), TEAMS.map((t) => t.name));
    const rep = { period, now: pkMs("2026-11-06 10:40"), counts: { people: peopleRows, team: sum, groups, hidden: 0, byDay: [{ day: period.days[0], ...sum, active: 55 }], detail: {} }, world: { allSelected: true, warnings: [], openTasks: { available: true }, naLeads: { available: true } } };
    const html = fitEmail(rep);
    assert.ok(Buffer.byteLength(html) <= SETTINGS.EMAIL_MAX_BYTES, `${Buffer.byteLength(html)} bytes`);
    assert.ok(!html.includes("in the workbook</td>"), "everyone fits without trimming");
    assert.ok(!html.includes("—"), "em dash");
    assert.ok(html.includes("Fazal Mehdi") && html.includes("Aleen Naeem") && html.includes("Waleed's Team"), "every team and person listed");
    assert.ok(!html.includes("Not in a team") && !html.includes("Aliyah Nze"), "nobody outside the teams");
    assert.strictEqual(html.split(">Patrecia Haddad<").length - 1, 3, "Patrecia shows once in each of the three tables");
    assert.strictEqual(html.split(">Aliza Ali<").length - 1, 3 * 2, "Aliza shows under both of her teams in all three tables");
    assert.strictEqual(html.split(">Consultant</td>").length - 1, 3 * (TEAMS.length + 1), "the column headings sit above every team, and above the overall total");
    assert.match(subjectFor(rep), /^Consultant activity · Thu 5 Nov · [\d,]+ calls · [\d,]+ emails · [\d,]+ CCL Sent · [\d,]+ Deal Lost$/);
    const multi = { ...rep, period: resolvePeriod({ period: "Last 7 days", now: pkMs("2026-11-06 11:00") }) };
    multi.counts = { ...rep.counts, byDay: multi.period.days.map((d) => ({ day: d, ...sum, active: 55 })) };
    assert.ok(Buffer.byteLength(fitEmail(multi)) <= SETTINGS.EMAIL_MAX_BYTES);
    assert.ok(buildEmail(multi).includes("Day by day"));
  });

  // ---------- the whole report against a fake HubSpot ----------
  for (const truncate of [false, true]) {
    await test(`full run against a fake HubSpot${truncate ? " (batch history cut short)" : ""}`, async () => {
      const fake = makeFakeHubSpot({ truncateBatchHistory: truncate });
      const realFetch = global.fetch;
      global.fetch = fake.fetch;
      const out = fs.mkdtempSync(path.join(os.tmpdir(), "activity-"));
      let rep;
      try {
        rep = await require("./report").run({ env: { HUBSPOT_TOKEN: "x", REPORT_NOW: pk("2026-11-06 10:40") }, log: () => {}, send: false, outDir: out });
      } finally { global.fetch = realFetch; }
      checkFakeRun(rep, truncate);
      assert.ok(fs.existsSync(rep.files.xlsxPath));
      const ExcelJS = require("exceljs");
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(rep.files.xlsxPath);
      assert.deepStrictEqual(wb.worksheets.map((w) => w.name), ["Summary", "Calls", "Emails", "Lead stages", "CCL Sent", "Deal Lost", "Deals touched", "Tasks due today", "How it was counted"]);
      assert.strictEqual(wb.getWorksheet("Tasks due today").actualRowCount - 3, 2, "2 open tasks due today listed");
      const summary = wb.getWorksheet("Summary");
      const firstCol = []; summary.getColumn(1).eachCell((c, r) => { if (r > 4) firstCol.push(String(c.value)); });
      assert.deepStrictEqual(firstCol.slice(0, 6), ["Ali Raza Qureshi's Team", "Fazal Mehdi", "Rabbiya Jilani's Team", "Fatima Zahid", "Wahab's Team", "Ambreen Sayed"]);
      assert.ok(!firstCol.includes("Akanksha Yadav"), "nobody with no activity in the summary");
      const calls = wb.getWorksheet("Calls");
      assert.strictEqual(calls.actualRowCount - 3, 9, "9 calls listed (inbound included)");
      const ccl = wb.getWorksheet("CCL Sent");
      assert.strictEqual(ccl.actualRowCount - 3, 4, "4 CCL moves listed, one not counted");
      assert.strictEqual(wb.getWorksheet("Deal Lost").actualRowCount - 3, 3, "3 Deal Lost moves listed, one not counted");
      fs.rmSync(out, { recursive: true, force: true });
    });
  }

  // ---------- result ----------
  if (failures.length) {
    console.log(`selftest: ${passed} passed, ${failures.length} FAILED`);
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log(`selftest: all ${passed} checks passed`);
}

if (require.main === module) main();
module.exports = { makeFakeHubSpot, pk };

// ======================================================================================
// The fake HubSpot. Thursday 5 November 2026 (Pakistan time) is the day being reported, and the
// report runs on Friday at 10:40. Fazal Mehdi (owner 100679683, user 100679683) and Fatima Zahid
// (owner 84172062, user 5001) worked; Ambreen Sayed (89994865, user 5002) created a deal that a
// workflow moved to CCL Sent; a manager outside the teams (Ali Raza, 86250521, user 6001) moved
// Akanksha Yadav's deal.
function checkFakeRun(rep, truncate) {
  const by = (name) => rep.counts.people.find((p) => p.name === name).total;
  const fz = by("Fazal Mehdi");
  const expect = {
    calls: 6, dialled: 4, byHand: 2, inbound: 1, contacts: 4, dealsOnCalls: 1, connected: 2, noAnswer: 3, busy: 1, naContacts: 2,
    markedNoAnswer: 2, markedDidntFill: 1, markedQualified: 1, markedIneligible: 1, markedOther: 0,
    emails: 3, emailsOnDeals: 2, emailsOnContacts: 3, dealsEmailed: 2, contactsEmailed: 3, sequence: 1, bounced: 1,
    messages: 1, notes: 1, tasks: 1, dueToday: 1, overdue: 3, naLeads: 3, meetings: 0,
    dealsTouched: 9, dealsCreated: 0, dealsMoved: 5, ccl: 2, lost: 1,
  };
  for (const [k, v] of Object.entries(expect)) assert.strictEqual(fz[k], v, `Fazal ${k}: got ${fz[k]}, expected ${v}`);
  const fa = by("Fatima Zahid");
  const ef = { calls: 2, dialled: 1, byHand: 1, wrong: 1, noOutcome: 1, contacts: 1, markedDidntFill: 1, markedQualified: 0, emails: 1, emailsOnDeals: 1, emailsOnContacts: 1, dealsTouched: 2, ccl: 0, lost: 1, dueToday: 1, overdue: 0, naLeads: 0 };
  for (const [k, v] of Object.entries(ef)) assert.strictEqual(fa[k], v, `Fatima ${k}: got ${fa[k]}, expected ${v}`);
  const am = by("Ambreen Sayed");
  assert.strictEqual(am.dealsCreated, 1, "Ambreen created a deal"); assert.strictEqual(am.ccl, 1, "the workflow's CCL move counts for the owner");
  assert.strictEqual(am.calls, 0);
  const ak = by("Akanksha Yadav");
  assert.strictEqual(ak.ccl, 0, "a manager's move counts for nobody");
  assert.strictEqual(rep.counts.people.filter((p) => p.active).length, 3);
  const t = rep.counts.team;
  assert.strictEqual(t.calls, 8); assert.strictEqual(t.ccl, 3); assert.strictEqual(t.emails, 4); assert.strictEqual(t.sequence, 1);
  assert.strictEqual(t.lost, 2, "Fazal's and Fatima's Deal Lost moves; the workflow's and the service pipeline's Lost are not counted");
  assert.strictEqual(t.markedIneligible, 1);
  assert.strictEqual(t.dueToday, 2); assert.strictEqual(t.overdue, 3, "overdue: Fazal's three open tasks due before Friday; the completed one is not counted");
  assert.strictEqual(t.naLeads, 3, "No Answer leads: Fazal's three created since 1 Jan 2026 (just after midnight Pakistan time counts; 31 Dec does not)");
  assert.deepStrictEqual(rep.counts.groups.map((g) => [g.name, g.people.map((p) => p.name)]),
    [["Ali Raza Qureshi's Team", ["Fazal Mehdi"]], ["Rabbiya Jilani's Team", ["Fatima Zahid"]], ["Wahab's Team", ["Ambreen Sayed"]]]);
  assert.strictEqual(rep.counts.hidden, 52);
  // the lead stage list shows the workflow's change on a contact Fazal called, but does not count it
  const k3 = rep.counts.detail.stages.find((s) => s.contactId === "903");
  assert.ok(k3 && !k3.credit && k3.how === "automatic", "workflow change listed, not counted");
  assert.ok(!rep.counts.detail.stages.some((s) => s.contactId === "912"), "a manager's change on an unworked contact is not listed");
  assert.strictEqual(rep.world.historyMode.contacts, truncate ? "single" : "batch");
  // the email
  const html = rep.files.html;
  assert.ok(html.includes("Fazal Mehdi") && html.includes("Fatima Zahid") && html.includes("Ambreen Sayed"));
  assert.ok(html.includes("Ali Raza Qureshi's Team") && html.includes("Wahab's Team"), "team rows");
  assert.strictEqual(html.split(">Consultant</td>").length - 1, 3 * (3 + 1), "headings above each of the 3 teams shown, and the total, in all three tables");
  assert.ok(!html.includes("Akanksha Yadav") && !html.includes("Jully's Team"), "nobody with no activity, and no empty team");
  assert.ok(html.includes("52 people with no activity that day are not shown."));
  assert.ok(html.includes("Tasks: 1 done, 2 due today, 3 overdue"), "the tasks line");
  assert.ok(html.includes("3 No Answer leads since 1 Jan") && html.includes("Fazal Mehdi 3"), "the No Answer leads line");
  assert.ok(!html.includes("—"));
  assert.match(rep.subject, /Thu 5 Nov · 8 calls · 4 emails · 3 CCL Sent · 2 Deal Lost$/);
  assert.deepStrictEqual(rep.counts.notCounted, { stagesAutomatic: 1, stagesOther: 0, cclOther: 1, lostOther: 1 });
  assert.ok(html.includes("Listed in the workbook but not counted: 1 lead stage change a workflow made on contacts they worked; 1 deal moved to CCL Sent by someone not in this report; 1 deal moved to Deal Lost by a workflow or someone not in this report."), "what was not counted is said");
}

function makeFakeHubSpot({ truncateBatchHistory = false } = {}) {
  const FZ = "100679683", FA = "84172062", AM = "89994865", AK = "81129092", MGR = "86250521";
  const h = (value, when, userId, sourceType = "CRM_UI", extra = {}) => ({ value, timestamp: pk(when), sourceType, ...(userId ? { updatedByUserId: Number(userId) } : {}), ...extra });
  const dial = (no) => ({ hs_call_source: "INTEGRATIONS_PLATFORM", hs_call_to_number: no, hs_call_direction: "OUTBOUND", hs_call_status: "COMPLETED" });
  const NA = "73a0d17f-1163-4015-bdd5-ec830791da20", CONN = "f240bbac-87c9-4f6e-bf70-924b57d47db7", BUSY = "9d9162e7-6cf3-4944-bf63-4dff82258764", WRONG = "17b47fee-58de-441e-a44c-c6300d46f273";
  const call = (id, owner, when, extra, contacts = [], deals = []) => ({ id, properties: { hubspot_owner_id: owner, hs_timestamp: pk(when), ...extra }, assoc: { contacts, deals } });
  const DB = {
    calls: [
      call("1", FZ, "2026-11-05 10:00", { ...dial("+971500000001"), hs_call_disposition: NA }, ["901"]),
      call("2", FZ, "2026-11-05 10:01", { hs_call_disposition: NA }, ["901"]),
      call("3", FZ, "2026-11-05 11:00", { ...dial("+971500000002"), hs_call_disposition: CONN, hs_call_duration: "85000" }, ["902"], ["802"]),
      call("4", FZ, "2026-11-05 11:02", { hs_call_disposition: CONN }, ["902"], ["802"]),
      call("5", FZ, "2026-11-05 12:00", { ...dial("+971500000003"), hs_call_disposition: BUSY }, ["903"]),
      call("6", FZ, "2026-11-05 13:00", { hs_call_direction: "INBOUND", hs_call_disposition: CONN }, ["904"], ["804"]),
      call("7", FZ, "2026-11-04 23:30", { hs_call_disposition: NA }, ["901"]),                    // Wednesday: not counted
      call("8", FZ, "2026-11-05 23:59", { ...dial("+971500000005"), hs_call_disposition: NA }, ["905"]),
      call("9", FA, "2026-11-05 15:00", { ...dial("+971500000006"), hs_call_disposition: WRONG }, ["906"]),
      call("10", FA, "2026-11-05 15:01", {}, ["906"]),
      call("11", MGR, "2026-11-05 15:00", { hs_call_disposition: CONN }, ["906"]),               // not a consultant
      call("12", FZ, "2026-11-06 09:00", { hs_call_disposition: CONN }, ["902"]),                 // Friday: not counted
    ],
    emails: [
      { id: "21", properties: { hubspot_owner_id: FZ, hs_timestamp: pk("2026-11-05 11:30"), hs_email_direction: "EMAIL", hs_email_status: "SENT", hs_email_subject: "Your CCL" }, assoc: { contacts: ["902"], deals: ["802"] } },
      { id: "22", properties: { hubspot_owner_id: FZ, hs_timestamp: pk("2026-11-05 12:30"), hs_email_direction: "EMAIL", hs_email_status: "SENT" }, assoc: { contacts: ["907"], deals: [] } },
      { id: "23", properties: { hubspot_owner_id: FZ, hs_timestamp: pk("2026-11-05 08:00"), hs_email_direction: "EMAIL", hs_email_status: "SENT", hs_sequence_id: "555" }, assoc: { contacts: ["908"], deals: [] } },
      { id: "24", properties: { hubspot_owner_id: FZ, hs_timestamp: pk("2026-11-05 13:30"), hs_email_direction: "EMAIL", hs_email_status: "FAILED" }, assoc: { contacts: ["909"], deals: ["809"] } },
      { id: "25", properties: { hubspot_owner_id: FZ, hs_timestamp: pk("2026-11-05 14:30"), hs_email_direction: "EMAIL", hs_email_status: "BOUNCED" }, assoc: { contacts: ["909"], deals: ["809"] } },
      { id: "26", properties: { hubspot_owner_id: FA, hs_timestamp: pk("2026-11-05 16:00"), hs_email_direction: "EMAIL", hs_email_status: "SENT" }, assoc: { contacts: ["906"], deals: ["806"] } },
      { id: "27", properties: { hubspot_owner_id: FA, hs_timestamp: pk("2026-11-05 16:30"), hs_email_direction: "INCOMING_EMAIL", hs_email_status: "" }, assoc: { contacts: ["906"], deals: ["806"] } },
    ],
    communications: [{ id: "31", properties: { hubspot_owner_id: FZ, hs_timestamp: pk("2026-11-05 10:05"), hs_communication_channel_type: "WHATS_APP" }, assoc: { contacts: ["901"], deals: ["801"] } }],
    notes: [{ id: "41", properties: { hubspot_owner_id: FZ, hs_timestamp: pk("2026-11-05 17:00") }, assoc: { contacts: [], deals: ["803"] } }],
    tasks: [
      { id: "51", properties: { hubspot_owner_id: FZ, hs_task_completion_date: pk("2026-11-05 14:00"), hs_task_status: "COMPLETED" }, assoc: { contacts: [], deals: ["802"] } },
      { id: "52", properties: { hubspot_owner_id: FZ, hs_task_completion_date: "", hs_task_status: "NOT_STARTED", hs_timestamp: pk("2026-11-05 14:00") }, assoc: { contacts: [], deals: ["810"] } },
      // open and closed tasks for "due today" (Friday) and "overdue" (before Friday)
      { id: "53", properties: { hubspot_owner_id: FZ, hs_task_status: "NOT_STARTED", hs_timestamp: pk("2026-11-06 15:00"), hs_task_subject: "Call back Kamran", hs_task_type: "CALL" }, assoc: { contacts: ["901"], deals: [] } },
      { id: "54", properties: { hubspot_owner_id: FZ, hs_task_status: "NOT_STARTED", hs_timestamp: pk("2026-11-04 10:00") }, assoc: { contacts: [], deals: [] } },
      { id: "55", properties: { hubspot_owner_id: FZ, hs_task_status: "IN_PROGRESS", hs_timestamp: pk("2026-10-01 10:00") }, assoc: { contacts: [], deals: [] } },
      { id: "56", properties: { hubspot_owner_id: FZ, hs_task_status: "COMPLETED", hs_timestamp: pk("2026-11-03 10:00"), hs_task_completion_date: pk("2026-11-03 12:00") }, assoc: { contacts: [], deals: [] } },
      { id: "57", properties: { hubspot_owner_id: FA, hs_task_status: "NOT_STARTED", hs_timestamp: pk("2026-11-06 09:00"), hs_task_subject: "Send the CCL", hs_task_type: "TODO" }, assoc: { contacts: ["906"], deals: ["806"] } },
      { id: "58", properties: { hubspot_owner_id: MGR, hs_task_status: "NOT_STARTED", hs_timestamp: pk("2026-11-06 12:00") }, assoc: { contacts: [], deals: [] } },
    ],
    meetings: [],
    contacts: [
      { id: "901", properties: { firstname: "Kamran", lastname: "One", hubspot_owner_id: FZ, lead_stage: "No Answer", lastmodifieddate: pk("2026-11-05 10:02"), createdate: pk("2026-03-01 10:00") },
        history: { lead_stage: [h("Call Back", "2026-10-01 09:00", FZ), h("No Answer", "2026-11-05 10:02", FZ)], hubspot_owner_id: [h(FZ, "2026-09-30 09:00", "", "AUTOMATION_PLATFORM")] } },
      { id: "902", properties: { firstname: "Kiran", lastname: "Two", hubspot_owner_id: FZ, lead_stage: "Sale", lastmodifieddate: pk("2026-11-06 09:00") },
        history: { lead_stage: [h("No Answer", "2026-10-02 09:00", FZ), h("Qualified", "2026-11-05 11:05", FZ), h("Sale", "2026-11-06 09:00", FZ)], hubspot_owner_id: [h(FZ, "2026-09-30 09:00", "", "AUTOMATION_PLATFORM")] } },
      { id: "903", properties: { firstname: "Kashif", lastname: "Three", hubspot_owner_id: FZ, lead_stage: "No Answer", lastmodifieddate: pk("2026-11-05 12:01"), createdate: pk("2026-01-01 00:30") },
        history: { lead_stage: [h("No Answer", "2026-11-05 12:01", "", "AUTOMATION_PLATFORM", { sourceId: "workflow 99" })], hubspot_owner_id: [h(FZ, "2026-09-30 09:00", "", "AUTOMATION_PLATFORM")] } },
      { id: "904", properties: { firstname: "Khalid", lastname: "Four", hubspot_owner_id: FZ, lead_stage: "Qualified AUS", lastmodifieddate: pk("2026-10-20 09:00") },
        history: { lead_stage: [h("Qualified AUS", "2026-10-20 09:00", FZ)], hubspot_owner_id: [h(FZ, "2026-09-30 09:00", "", "AUTOMATION_PLATFORM")] } },
      { id: "905", properties: { firstname: "Kinza", lastname: "Five", hubspot_owner_id: FZ, lead_stage: "No Answer", lastmodifieddate: pk("2026-11-05 23:59"), createdate: pk("2025-12-31 23:50") },
        history: { lead_stage: [h("No Answer", "2026-11-05 23:59", "", "INTEGRATION", { sourceLabel: "ZIWO" })], hubspot_owner_id: [h(FZ, "2026-09-30 09:00", "", "AUTOMATION_PLATFORM")] } },
      { id: "906", properties: { firstname: "Komal", lastname: "Six", hubspot_owner_id: FA, lead_stage: "They Didn't Fill", lastmodifieddate: pk("2026-11-05 15:05") },
        history: { lead_stage: [h("They Didn't Fill", "2026-11-05 15:05", "5001")], hubspot_owner_id: [h(FA, "2026-09-30 09:00", "", "AUTOMATION_PLATFORM")] } },
      { id: "907", properties: { firstname: "Kanwal", lastname: "Seven", hubspot_owner_id: FZ, lead_stage: "Call Back", lastmodifieddate: pk("2026-11-01 09:00") }, history: { lead_stage: [], hubspot_owner_id: [] } },
      { id: "908", properties: { firstname: "Kashaf", lastname: "Eight", hubspot_owner_id: FZ, lead_stage: "", lastmodifieddate: pk("2026-11-05 08:00") }, history: { lead_stage: [], hubspot_owner_id: [] } },
      { id: "909", properties: { firstname: "Kaleem", lastname: "Nine", hubspot_owner_id: FZ, lead_stage: "", lastmodifieddate: pk("2026-11-05 14:30") }, history: { lead_stage: [], hubspot_owner_id: [] } },
      // marked by a bulk edit, with no call that day: found by the "recently changed" search
      { id: "910", properties: { firstname: "Kubra", lastname: "Ten", hubspot_owner_id: FZ, lead_stage: "They Didn't Fill", lastmodifieddate: pk("2026-11-05 16:00") },
        history: { lead_stage: [h("No Answer", "2026-10-03 09:00", FZ), h("They Didn't Fill", "2026-11-05 16:00", FZ, "CRM_UI")], hubspot_owner_id: [h(FZ, "2026-09-30 09:00", "", "AUTOMATION_PLATFORM")] } },
      // changed on Tuesday, touched since: not counted
      { id: "911", properties: { firstname: "Kamal", lastname: "Eleven", hubspot_owner_id: FZ, lead_stage: "No Answer", lastmodifieddate: pk("2026-11-05 09:00"), createdate: pk("2026-10-01 09:00") },
        history: { lead_stage: [h("No Answer", "2026-11-03 09:00", FZ)], hubspot_owner_id: [h(FZ, "2026-09-30 09:00", "", "AUTOMATION_PLATFORM")] } },
      // marked Ineligible by a bulk edit, with no call that day: found by the "recently changed" search
      { id: "913", properties: { firstname: "Kalsoom", lastname: "Thirteen", hubspot_owner_id: FZ, lead_stage: "Ineligible", lastmodifieddate: pk("2026-11-05 18:00") },
        history: { lead_stage: [h("They Didn't Fill", "2026-10-04 09:00", FZ), h("Ineligible", "2026-11-05 18:00", FZ)], hubspot_owner_id: [h(FZ, "2026-09-30 09:00", "", "AUTOMATION_PLATFORM")] } },
      // changed by a manager, on a contact nobody worked: not counted, not listed
      { id: "912", properties: { firstname: "Kausar", lastname: "Twelve", hubspot_owner_id: FA, lead_stage: "Qualified AUS", lastmodifieddate: pk("2026-11-05 15:30") },
        history: { lead_stage: [h("Qualified AUS", "2026-11-05 15:30", "6001")], hubspot_owner_id: [h(FA, "2026-09-30 09:00", "", "AUTOMATION_PLATFORM")] } },
    ],
    deals: [
      { id: "802", properties: { dealname: "Kiran Two", pipeline: "26699617", dealstage: "60994695", hubspot_owner_id: FZ, createdate: pk("2026-10-20 09:00"), hs_v2_date_entered_current_stage: pk("2026-11-05 11:10") },
        history: { dealstage: [h("75652492", "2026-10-20 09:00", FZ), h("60994695", "2026-11-05 11:10", FZ)], hubspot_owner_id: [h(FZ, "2026-10-20 09:00", FZ)] } },
      { id: "820", properties: { dealname: "New Client", pipeline: "26699617", dealstage: "60994695", hubspot_owner_id: AM, createdate: pk("2026-11-05 10:01:46"), hs_v2_date_entered_current_stage: pk("2026-11-05 10:01:52") },
        history: { dealstage: [h("75652492", "2026-11-05 10:01:46", "5002"), h("60994695", "2026-11-05 10:01:52", "", "AUTOMATION_PLATFORM")], hubspot_owner_id: [h(AM, "2026-11-05 10:01:46", "5002")] } },
      { id: "821", properties: { dealname: "NIW Client", pipeline: "642383975", dealstage: "947690585", hubspot_owner_id: AK, createdate: pk("2026-10-25 09:00"), hs_v2_date_entered_current_stage: pk("2026-11-05 15:43") },
        history: { dealstage: [h("947690584", "2026-10-25 09:00", "5003"), h("947690585", "2026-11-05 15:43", "6001")], hubspot_owner_id: [h(AK, "2026-10-25 09:00", "5003")] } },
      { id: "822", properties: { dealname: "Expected One", pipeline: "26699617", dealstage: "60994696", hubspot_owner_id: FZ, createdate: pk("2026-10-10 09:00"), hs_v2_date_entered_current_stage: pk("2026-11-05 17:00") },
        history: { dealstage: [h("75652492", "2026-10-10 09:00", FZ), h("60994696", "2026-11-05 17:00", FZ)], hubspot_owner_id: [h(FZ, "2026-10-10 09:00", FZ)] } },
      { id: "823", properties: { dealname: "Wednesday CCL", pipeline: "26699617", dealstage: "60994695", hubspot_owner_id: FZ, createdate: pk("2026-10-10 09:00"), hs_v2_date_entered_current_stage: pk("2026-11-04 12:00") },
        history: { dealstage: [h("75652492", "2026-10-10 09:00", FZ), h("60994695", "2026-11-04 12:00", FZ)], hubspot_owner_id: [h(FZ, "2026-10-10 09:00", FZ)] } },
      { id: "824", properties: { dealname: "Moved On", pipeline: "26699617", dealstage: "60994696", hubspot_owner_id: FZ, createdate: pk("2026-10-11 09:00"), hs_v2_date_entered_current_stage: pk("2026-11-06 09:00") },
        history: { dealstage: [h("75652492", "2026-10-11 09:00", FZ), h("60994695", "2026-11-05 09:00", FZ), h("60994696", "2026-11-06 09:00", FZ)], hubspot_owner_id: [h(FZ, "2026-10-11 09:00", FZ)] } },
      // Deal Lost: by Fazal; by a workflow on Fatima's deal (not counted); by Fatima in the Spain
      // pipeline (a stage found by its name); and a "Lost" stage in a service pipeline (not Deal Lost)
      { id: "825", properties: { dealname: "Lost One", pipeline: "26699617", dealstage: "75652493", hubspot_owner_id: FZ, createdate: pk("2026-10-12 09:00"), hs_v2_date_entered_current_stage: pk("2026-11-05 16:30") },
        history: { dealstage: [h("75652492", "2026-10-12 09:00", FZ), h("75652493", "2026-11-05 16:30", FZ)], hubspot_owner_id: [h(FZ, "2026-10-12 09:00", FZ)] } },
      { id: "826", properties: { dealname: "Auto Lost", pipeline: "26699617", dealstage: "75652493", hubspot_owner_id: FA, createdate: pk("2026-10-01 09:00"), hs_v2_date_entered_current_stage: pk("2026-11-05 12:00") },
        history: { dealstage: [h("75652492", "2026-10-01 09:00", "5001"), h("75652493", "2026-11-05 12:00", "", "AUTOMATION_PLATFORM")], hubspot_owner_id: [h(FA, "2026-10-01 09:00", "5001")] } },
      { id: "827", properties: { dealname: "Spain Lost", pipeline: "818882472", dealstage: "1209280121", hubspot_owner_id: FA, createdate: pk("2026-10-02 09:00"), hs_v2_date_entered_current_stage: pk("2026-11-05 13:00") },
        history: { dealstage: [h("1209280120", "2026-10-02 09:00", "5001"), h("1209280121", "2026-11-05 13:00", "5001")], hubspot_owner_id: [h(FA, "2026-10-02 09:00", "5001")] } },
      { id: "828", properties: { dealname: "Service Case", pipeline: "99999", dealstage: "555", hubspot_owner_id: FZ, createdate: pk("2026-09-02 09:00"), hs_v2_date_entered_current_stage: pk("2026-11-05 18:00") },
        history: { dealstage: [h("554", "2026-09-02 09:00", FZ), h("555", "2026-11-05 18:00", FZ)], hubspot_owner_id: [h(FZ, "2026-09-02 09:00", FZ)] } },
      ...["801", "803", "804", "806", "809", "810"].map((id) => ({ id, properties: { dealname: `Deal ${id}`, pipeline: "26699617", dealstage: "75652492", hubspot_owner_id: FZ, createdate: pk("2026-09-01 09:00"), hs_v2_date_entered_current_stage: pk("2026-09-01 09:00") }, history: { dealstage: [], hubspot_owner_id: [] } })),
    ],
  };
  const OWNERS_API = [
    { id: FZ, userId: Number(FZ), firstName: "Muhammad Fazal", lastName: "Mehdi" },
    { id: FA, userId: 5001, firstName: "Fatima", lastName: "Zahid" },
    { id: AM, userId: 5002, firstName: "Ambreen", lastName: "Sayed" },
    { id: AK, userId: 5003, firstName: "Akanksha", lastName: "Yadav" },
    { id: MGR, userId: 6001, firstName: "Ali", lastName: "Raza" },
  ];
  const PIPES = [
    { id: "26699617", label: "HOF Sales Pipeline - Canada & AUS", stages: [["75652492", "Qualified Client"], ["60994695", "CCL Sent"], ["60994696", "Expected Sales"], ["75652493", "Deal Lost"]].map(([id, label]) => ({ id, label })) },
    { id: "818882472", label: "HOF Sales - Spain", stages: [["1209280120", "Discussion"], ["1209280121", "Deal Lost"]].map(([id, label]) => ({ id, label })) },
    { id: "99999", label: "A service pipeline", stages: [["554", "Open"], ["555", "Lost"]].map(([id, label]) => ({ id, label })) },
    { id: "642383975", label: "USA NIW Sales Pipeline", stages: [["947690584", "Qualified Client"], ["947690585", "CCL Sent"]].map(([id, label]) => ({ id, label })) },
  ];
  const DATE_PROPS = new Set(["hs_timestamp", "hs_task_completion_date", "lastmodifieddate", "hs_v2_date_entered_current_stage", "createdate"]);
  const val = (rec, prop) => (prop === "hs_object_id" ? rec.id : rec.properties[prop]);
  const cmpVal = (prop, v) => (DATE_PROPS.has(prop) ? (v ? Date.parse(v) : NaN) : prop === "hs_object_id" ? Number(v) : String(v ?? ""));
  function matches(rec, f) {
    const v = val(rec, f.propertyName);
    const x = cmpVal(f.propertyName, v);
    const num = (s) => (DATE_PROPS.has(f.propertyName) ? Number(s) : s);
    switch (f.operator) {
      case "EQ": return String(v ?? "") === String(f.value);
      case "NEQ": return String(v ?? "") !== String(f.value);
      case "IN": return f.values.map(String).includes(String(v ?? ""));
      case "GTE": return x >= num(f.value);
      case "LT": return x < num(f.value);
      default: throw new Error(`fake: operator ${f.operator}`);
    }
  }
  const pick = (rec, props) => Object.fromEntries((props || []).filter((p) => p in rec.properties).map((p) => [p, rec.properties[p]]));
  const histOf = (rec, props) => {
    const out = {};
    for (const p of props || []) {
      let list = [...((rec.history || {})[p] || [])].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
      out[p] = list;
    }
    return out;
  };
  const respond = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });
  async function fetchFake(url, init = {}) {
    const u = new URL(url);
    const p = u.pathname;
    const body = init.body ? JSON.parse(init.body) : null;
    let m;
    if (p === "/crm/v3/owners") return respond(200, { results: u.searchParams.get("archived") === "true" ? [] : OWNERS_API });
    if (p === "/crm/v3/pipelines/deals") return respond(200, { results: PIPES });
    if (p === "/crm/v3/properties/calls/hs_call_disposition") return respond(200, { options: [] });
    if (p === "/crm/v3/properties/contacts/lead_stage") return respond(200, { options: [{ value: "Qualified", label: "Qualified CAN" }, { value: "No Answer", label: "No Answer" }] });
    if ((m = /^\/crm\/v3\/objects\/(\w+)\/search$/.exec(p))) {
      const rows = DB[m[1]].filter((r) => body.filterGroups.some((g) => g.filters.every((f) => matches(r, f))));
      if (body.sorts && body.sorts[0]) { const s = body.sorts[0].propertyName; rows.sort((a, b) => (cmpVal(s, val(a, s)) > cmpVal(s, val(b, s)) ? 1 : -1)); }
      const start = Number(body.after || 0), lim = body.limit || 10;
      const page = rows.slice(start, start + lim).map((r) => ({ id: r.id, properties: pick(r, body.properties) }));
      return respond(200, { total: rows.length, results: page, ...(start + lim < rows.length ? { paging: { next: { after: String(start + lim) } } } : {}) });
    }
    if ((m = /^\/crm\/v4\/associations\/(\w+)\/(\w+)\/batch\/read$/.exec(p))) {
      const [, from, to] = m;
      const results = body.inputs.map(({ id }) => DB[from].find((r) => r.id === id)).filter((r) => r && r.assoc && r.assoc[to] && r.assoc[to].length)
        .map((r) => ({ from: { id: r.id }, to: r.assoc[to].map((t) => ({ toObjectId: Number(t) })) }));
      return respond(200, { results });
    }
    if ((m = /^\/crm\/v3\/objects\/(\w+)\/batch\/read$/.exec(p))) {
      const results = body.inputs.map(({ id }) => DB[m[1]].find((r) => r.id === id)).filter(Boolean).map((r) => {
        const o = { id: r.id, properties: pick(r, body.properties) };
        if (body.propertiesWithHistory) {
          o.propertiesWithHistory = histOf(r, body.propertiesWithHistory);
          if (truncateBatchHistory) for (const k of Object.keys(o.propertiesWithHistory)) o.propertiesWithHistory[k] = o.propertiesWithHistory[k].slice(0, 1);
        }
        return o;
      });
      return respond(200, { results });
    }
    if ((m = /^\/crm\/v3\/objects\/(\w+)\/(\d+)$/.exec(p))) {
      const r = DB[m[1]].find((x) => x.id === m[2]);
      if (!r) return respond(404, { message: "not found" });
      const props = (u.searchParams.get("properties") || "").split(",");
      const hist = (u.searchParams.get("propertiesWithHistory") || "").split(",").filter(Boolean);
      return respond(200, { id: r.id, properties: pick(r, props), propertiesWithHistory: histOf(r, hist) });
    }
    return respond(404, { message: `fake: no route for ${init.method || "GET"} ${p}` });
  }
  return { fetch: fetchFake, DB };
}
