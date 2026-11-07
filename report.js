// report.js — runs the report: reads HubSpot, counts each consultant's activity, writes the
// workbook and the email, and sends it. Read-only: nothing in HubSpot is changed.
const fs = require("fs");
const path = require("path");
const { SETTINGS } = require("./config");
const { resolvePeriod } = require("./1-clock");
const { collect } = require("./2-collect");
const { count } = require("./3-count");
const { buildWorkbook } = require("./4-workbook");
const { fitEmail, subjectFor, sendEmail } = require("./5-email");
const H = require("./0-hubspot");

async function run({ env = process.env, log = console.log, send = SETTINGS.SEND_EMAIL, outDir = SETTINGS.OUT_DIR } = {}) {
  if (!env.HUBSPOT_TOKEN) throw new Error("The HUBSPOT_TOKEN secret is missing.");
  const now = env.REPORT_NOW ? Date.parse(env.REPORT_NOW) : Date.now();       // REPORT_NOW is for testing
  const period = resolvePeriod({ period: env.PERIOD, from: env.FROM_DATE, to: env.TO_DATE, now });
  log(`Consultant activity: ${period.long}\n`);

  const world = await collect({ period, consultantsInput: env.CONSULTANTS, log, now });
  const counts = count(world);
  const rep = { world, counts, period, now };

  fs.mkdirSync(outDir, { recursive: true });
  const base = `consultant-activity_${period.fileLabel}`;
  const xlsxPath = path.join(outDir, `${base}.xlsx`);
  const wb = await buildWorkbook(rep);
  await wb.xlsx.writeFile(xlsxPath);
  const html = fitEmail(rep);
  fs.writeFileSync(path.join(outDir, "email.html"), html);

  // a short summary in the log, and on the Actions run page
  const t = counts.team;
  const lines = ["| Team / consultant | Calls | Contacts | Deals | Connected | No answer | Marked No Answer | Didn't Fill | Qualified | Ineligible | Other stage | Emails | Sequence | Deals touched | CCL Sent | Deal Lost | Tasks done | Due today | Overdue | No Answer leads |",
    "|---|" + "---:|".repeat(19)];
  const line = (name, f) => `| ${name} | ${f.calls} | ${f.contacts} | ${f.dealsOnCalls} | ${f.connected} | ${f.noAnswer} | ${f.markedNoAnswer} | ${f.markedDidntFill} | ${f.markedQualified} | ${f.markedIneligible} | ${f.markedOther} | ${f.emails} | ${f.sequence} | ${f.dealsTouched} | ${f.ccl} | ${f.lost} | ${f.tasks} | ${f.dueToday} | ${f.overdue} | ${f.naLeads} |`;
  for (const g of counts.groups) {
    lines.push(line(`**${g.name}**`, g.total));
    for (const p of g.people) lines.push(line(`&nbsp;&nbsp;${p.name}`, p.total));
  }
  lines.push(line("**All consultants**", t));
  if (counts.hidden) lines.push("", `${counts.hidden} people with no activity are not shown.`);
  log("\n" + lines.join("\n"));
  const nc = counts.notCounted;
  log(`Lead stage changes credited: ${counts.detail.stages.filter((x) => x.credit).length}; by workflows on worked contacts (not counted): ${nc.stagesAutomatic}; by others: ${nc.stagesOther}. CCL Sent moves not counted: ${nc.cclOther}. Deal Lost moves not counted: ${nc.lostOther}.`);
  for (const w of world.warnings) log(`!! ${w}`);
  if (env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `## Consultant activity · ${period.label}\n\n${lines.join("\n")}\n\n${world.warnings.map((w) => `> ${w}`).join("\n")}\n`);
  }

  const sizeMb = fs.statSync(xlsxPath).size / 1048576;
  log(`\nWorkbook ${xlsxPath} (${sizeMb.toFixed(1)} MB), email ${Math.round(Buffer.byteLength(html) / 1024)} KB`);
  log(`HubSpot requests: ${H.stats.calls} (${H.stats.retries} retried)`);
  rep.subject = subjectFor(rep);
  rep.files = { xlsxPath, html };

  const empty = !counts.people.some((p) => p.active);
  if (!send) { log("Not emailed (send email was off)."); return rep; }
  if (empty && !SETTINGS.SEND_WHEN_EMPTY) { log("Nothing was logged, so no email was sent."); return rep; }
  const attachments = !empty && sizeMb < SETTINGS.ATTACH_MAX_MB ? [{ filename: `${base}.xlsx`, content: fs.readFileSync(xlsxPath).toString("base64") }] : [];
  if (!empty && !attachments.length) log("The workbook is too big to attach; it is in this run's artifacts.");
  rep.sent = await sendEmail(rep.subject, html, attachments);
  log(rep.sent ? `Emailed to ${SETTINGS.REPORT_TO}: "${rep.subject}"` : "The email was NOT sent.");
  if (!rep.sent) process.exitCode = 1;
  return rep;
}

if (require.main === module) {
  run().catch((e) => { console.error(`\nThe report could not run: ${e.message}`); if (process.env.DEBUG) console.error(e.stack); process.exit(1); });
}

module.exports = { run };
