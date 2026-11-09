// config.js — Consultant activity report. SAFE TO EDIT.
//
// Who is reported on, and every rule for what is counted, is written here in plain words.
// The same rules are repeated in the "How it was counted" tab of every workbook.

// Who is reported on: the people in these teams, and nobody else. The teams show in this order.
// Names are written the way you use them; the numbers are their HubSpot owner ids. Someone in two
// teams (Aliza Ali) shows under both, and the overall total still counts them once. People who did nothing in the period are not shown. Add, move or remove people here.
const TEAMS = [
  { name: "Ali Raza Qureshi's Team", members: [
    { id: "83788398",   name: "Ali Raza Qureshi" },
    { id: "100679683",  name: "Fazal Mehdi" },
    { id: "89097036",   name: "Mishal Fatima Bashir" },       // "Mashal Fatima" in HubSpot
    { id: "84648486",   name: "Muhammad Shahzad Fiaz" },
    { id: "84172061",   name: "Ayesha Zahid" },
    { id: "100552613",  name: "Ali Raza Shoukat" },           // "Ali Raza" in HubSpot
    { id: "100552645",  name: "Abdullah Khalil" },
    { id: "100679717",  name: "Abdullah Naseer" },
  ] },
  { name: "Rabbiya Jilani's Team", members: [
    { id: "85714760",   name: "Rabbiya Jilani" },
    { id: "90507250",   name: "Muhammad Awaad" },
    { id: "84172062",   name: "Fatima Zahid" },
    { id: "83210660",   name: "Muhammad Diean" },
    { id: "93650916",   name: "Aimen Shakeel" },
    { id: "239623628",  name: "Atika Zainab" },
    { id: "101182326",  name: "Affan Wasti" },
    { id: "100679600",  name: "Affan Bin Kashif" },
    { id: "100549686",  name: "Usman Aslam" },
  ] },
  { name: "Fahad Butt's Team", members: [
    { id: "75852018",   name: "Fahad Butt" },
    { id: "89097037",   name: "Tuba Ahmad" },
    { id: "85070897",   name: "Ahmad Ali" },
    { id: "98718071",   name: "Danish Anwar" },
    { id: "84491440",   name: "Syed Hussain Shah" },
    { id: "100679666",  name: "Adil Hassan" },
    { id: "100679575",  name: "Mehran Ali" },
    { id: "100679501",  name: "Noor Ul Ain" },
  ] },
  { name: "Insha's Team", members: [
    { id: "79152876",   name: "Insha Khan" },
    { id: "100183525",  name: "Zunera Saghar" },
    { id: "100183515",  name: "Iqra Jameel" },
    { id: "99731787",   name: "Aliza Ali" },
  ] },
  { name: "Khurram's Team", members: [
    { id: "99731787",   name: "Aliza Ali" },
    { id: "86887642",   name: "Khurram Iqbal" },
    { id: "99217082",   name: "Uwais Ali" },
    { id: "96753780",   name: "Janice Noronha" },
    { id: "98333925",   name: "Mahesh Nanda" },
  ] },
  { name: "Jully's Team", members: [
    { id: "93415418",   name: "Sneha Nair" },
    { id: "425098599",  name: "Jully Gill" },
    { id: "81129092",   name: "Akanksha Yadav" },
    { id: "98416664",   name: "Maham Akmal" },
  ] },
  { name: "Wahab's Team", members: [
    { id: "100468742",  name: "Abigail Yabut" },
    { id: "100762696",  name: "Djebli Chahinez" },
    { id: "97905576",   name: "Umar Shahbaz" },
    { id: "102283436",  name: "Danielle Albano" },
    { id: "93601358",   name: "Anne Mariele De Guzman" },
    { id: "1186837974", name: "Asfandyar Malik" },
    { id: "89994865",   name: "Ambreen Sayed" },
    { id: "78332276",   name: "Kawleen Kaur" },
    { id: "594801542",  name: "Wahab Saeed Dogar" },
    { id: "100468532",  name: "Muhammad Rohaan Umer" },
    { id: "97131926",   name: "Insha Ali" },
    { id: "82714205",   name: "Muhammad Jalal Shah" },
  ] },
  { name: "Rahul's Team", members: [
    { id: "97417891",   name: "Mariya S" },
    { id: "82756823",   name: "Arya Murali" },
    { id: "457296009",  name: "Rahul Pillai" },
  ] },
  { name: "Waleed's Team", members: [
    { id: "76337310",   name: "Ahlam Khandoq" },
    { id: "76337312",   name: "Patrecia Haddad" },
    { id: "331190104",  name: "Aleen Naeem" },
  ] },
];

const SETTINGS = {
  // ---- when ----
  // Days run midnight to midnight, Pakistan time. The daily run reports on yesterday. The team
  // does not work on the days listed here (0 = Sunday ... 6 = Saturday), so there is no run
  // the morning after them, and the next report includes them: Monday's covers Saturday and Sunday.
  TZ_OFFSET_HOURS: 5,
  DAYS_OFF: [0],

  // ---- calls ----
  // Every call record counts ("raw" calls). The ZIWO dialler and the consultant often both log
  // the same call, so one dial can appear twice; the workbook shows how many came from each.
  CONNECTED_OUTCOMES: ["Connected", "Meeting booked"],
  NO_ANSWER_OUTCOMES: ["No answer"],
  COUNT_INBOUND_CALLS: false,          // inbound calls are listed, but are not "calls made"

  // ---- lead stage (HubSpot's internal values: "Qualified" shows in HubSpot as "Qualified CAN") ----
  LEAD_STAGES: {
    noAnswer: ["No Answer"],
    didntFill: ["They Didn't Fill"],
    qualified: ["Qualified", "Qualified AUS", "USA NIW", "Qualified Spain", "Germany Opportunity Card",
      "Visit Visa", "Work Permit", "Portugal D2/D8"],
    ineligible: ["Ineligible"],
  },
  // "Marked" means the consultant changed the contact's Lead Stage to that value during the day.
  // A change made by a HubSpot user is credited to that user. A change with no user on it (made
  // through an app or the API) is credited to whoever owned the contact at that moment.
  // Changes made by workflows, imports and forms are never credited to anyone.
  CREDIT_NO_USER_TO_OWNER: true,

  // ---- deals ----
  CCL_STAGE_LABELS: ["CCL Sent"],                  // a stage with this name, in any pipeline
  CCL_STAGE_IDS: ["60994695", "947690585"],        // Canada & AUS, USA NIW (used if the pipeline list cannot be read)
  // A deal moved to CCL Sent by a workflow or an app is credited to the deal's owner.
  CCL_CREDIT_AUTOMATIC_TO_OWNER: true,
  // Deal Lost is looked for in the sales pipelines only (the same seven as the deal compliance
  // agent). The Visit pipeline calls the stage just "Lost".
  SALES_PIPELINES: ["26699617", "642383975", "97449039", "647754380", "818310187", "818882472", "97796183"],
  LOST_STAGE_LABELS: ["Deal Lost", "Lost"],
  LOST_STAGE_IDS: ["75652493", "947690590", "178346508", "953907003", "1209885801", "179262217"],
  // A deal moved to Deal Lost by a workflow counts for nobody; it is listed in the workbook.
  LOST_CREDIT_AUTOMATIC_TO_OWNER: false,

  // ---- tasks ----
  // "Done" counts tasks completed in the period (yesterday). "Due today" and "Overdue" are counted
  // when the report runs: open tasks due on the day it is sent, and every open task due before that
  // day, however old. A task is open until it is marked completed.

  // ---- No Answer leads ----
  // Counted when the report runs: the contacts each consultant owns whose Lead Stage is No Answer
  // right now, out of the leads created from this date up to the moment the report runs.
  NO_ANSWER_LEADS_FROM: "2026-01-01",

  // ---- emails ----
  // Outgoing emails only. Sequence emails are counted separately from emails the consultant sent
  // themselves. A bounced email still counts as sent; these never do:
  EMAIL_NOT_SENT_STATUSES: ["FAILED", "CANCELED", "CANCELLED", "SCHEDULED"],

  // ---- the report ----
  REPORT_TO: "razaali@hofmigration.com",
  CC: [],                                          // only after hofmigration.com is verified in Resend
  FROM_EMAIL: "onboarding@resend.dev",
  SEND_EMAIL: String(process.env.SEND_EMAIL || "true").toLowerCase() !== "false",
  SEND_WHEN_EMPTY: true,                           // still email a short note on a day with no activity
  EMAIL_MAX_BYTES: 95000,                          // Gmail cuts emails off above about 100 KB
  DETAIL_ROWS_MAX: 60000,                          // rows per detail tab (calls, emails...) in the workbook
  ATTACH_MAX_MB: 25,

  // ---- HubSpot ----
  PORTAL_ID: "23735726",
  SEARCH_RPS: Number(process.env.SEARCH_RPS || 4), // HubSpot allows 5 searches a second for the whole account
  API_RPS: Number(process.env.API_RPS || 8),
  OUT_DIR: "out",
};

module.exports = { TEAMS, SETTINGS };
