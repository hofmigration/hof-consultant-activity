// 1-clock.js — days, periods and how dates are written, all in Pakistan time. No network in
// here, so every rule is tested on invented dates in selftest.js.
const { SETTINGS } = require("./config");

const HOUR = 3600e3, DAY = 24 * HOUR;
const OFF = SETTINGS.TZ_OFFSET_HOURS * HOUR;
const dayStart = (t) => Math.floor((t + OFF) / DAY) * DAY - OFF;            // midnight, Pakistan time
const dateKey = (t) => new Date(t + OFF).toISOString().slice(0, 10);        // "2026-11-05"
const weekday = (t) => new Date(t + OFF).getUTCDay();
const keyStart = (key) => Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10)) - OFF;
const pad = (n) => String(n).padStart(2, "0");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// "2026-11-05" (or "2026-11-5") -> midnight that day, Pakistan time. null if not a real date.
function parseDay(s) {
  const m = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})\s*$/.exec(String(s || ""));
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  if (new Date(t).getUTCDate() !== +m[3] || new Date(t).getUTCMonth() !== +m[2] - 1) return null;
  return t - OFF;
}
const monthStart = (now, add) => { const d = new Date(now + OFF); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + add, 1) - OFF; };

// Which days a run covers. Dates typed in the boxes always win; otherwise the period choice;
// otherwise (and on the daily schedule) yesterday, reaching back over any day off.
function resolvePeriod({ period, from, to, now = Date.now() } = {}) {
  const raw = String(period || "").trim().toLowerCase();
  const today = dayStart(now);
  let start, end, kind;
  if (String(from || "").trim()) {
    start = parseDay(from);
    if (start == null) throw new Error(`Type the first date as YYYY-MM-DD, for example 2026-11-05 (got "${from}").`);
    const last = String(to || "").trim() ? parseDay(to) : start;
    if (last == null) throw new Error(`Type the last date as YYYY-MM-DD, for example 2026-11-05 (got "${to}").`);
    if (last < start) throw new Error(`The last date (${to}) is before the first date (${from}).`);
    if (start > now) throw new Error(`The first date (${from}) is in the future.`);
    end = last + DAY; kind = "custom";
  } else if (/custom/.test(raw)) {
    throw new Error('For "Custom dates", type the first date (and the last date, if more than one day) as YYYY-MM-DD.');
  } else if (/today/.test(raw)) {
    start = today; end = now; kind = "today";
  } else if (/7|week/.test(raw)) {
    end = today; start = today - 7 * DAY; kind = "week";
  } else if (/this month/.test(raw)) {
    start = monthStart(now, 0); end = now; kind = "month";
  } else if (/last month|previous month/.test(raw)) {
    start = monthStart(now, -1); end = monthStart(now, 0); kind = "lastMonth";
  } else {
    end = today; start = today - DAY; kind = "yesterday";
    for (let i = 0; i < 6 && SETTINGS.DAYS_OFF.includes(weekday(start)); i++) start -= DAY;
  }
  if (end > now) end = now;
  if (!(end > start)) throw new Error("There is nothing to report yet for that period.");

  const days = [];
  for (let d = start; d < end; d += DAY) days.push(dateKey(d));
  const first = start, lastDay = dayStart(end - 1);
  const single = days.length === 1;
  const a = new Date(first + OFF), b = new Date(lastDay + OFF);
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  const wholeMonth = kind === "lastMonth" || (kind === "custom" && a.getUTCDate() === 1 && dayStart(end) === end && new Date(end + OFF).getUTCDate() === 1 && days.length >= 28 && days.length <= 31);
  let label, long;
  if (single) {
    label = fmtDayName(first);
    long = `${DAYS_LONG[a.getUTCDay()]} ${a.getUTCDate()} ${MONTHS_LONG[a.getUTCMonth()]} ${a.getUTCFullYear()}`;
    if (kind === "today") { label += ` (to ${fmtTime(end)})`; long += `, up to ${fmtTime(end)}`; }
  } else if (wholeMonth) {
    label = long = `${MONTHS_LONG[a.getUTCMonth()]} ${a.getUTCFullYear()}`;
  } else {
    label = `${DAYS[a.getUTCDay()]} ${a.getUTCDate()} ${MONTHS[a.getUTCMonth()]}${sameYear ? "" : ` ${a.getUTCFullYear()}`} to ${fmtDayName(lastDay)}`;
    long = `${DAYS_LONG[a.getUTCDay()]} ${a.getUTCDate()} ${MONTHS_LONG[a.getUTCMonth()]}${sameYear ? "" : ` ${a.getUTCFullYear()}`} to ${DAYS_LONG[b.getUTCDay()]} ${b.getUTCDate()} ${MONTHS_LONG[b.getUTCMonth()]} ${b.getUTCFullYear()}`;
    if (end < dayStart(end - 1) + DAY) { label += ` (to ${fmtTime(end)})`; long += `, up to ${fmtTime(end)}`; }
  }
  const fileLabel = single ? days[0] : `${days[0]}_to_${days[days.length - 1]}`;
  return { start, end, days, kind, single, label, long, fileLabel };
}

// ---- wording ----
const fmtDayName = (t) => { const d = new Date(t + OFF); return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const fmtDayKey = (key) => fmtDayName(keyStart(key));                           // "Thu 5 Nov 2026"
const fmtDayShort = (key) => { const d = new Date(keyStart(key) + OFF); return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
const fmtTime = (t) => { const d = new Date(t + OFF); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
const xlDate = (t) => (t ? new Date(t + OFF) : null);                              // Excel shows the UTC reading: Pakistan wall time
const ms = (v) => {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v;
  const s = String(v);
  if (/^\d{10,}$/.test(s)) return Number(s);
  return Date.parse(s) || 0;
};

module.exports = { resolvePeriod, parseDay, dayStart, dateKey, weekday, keyStart, fmtDayName, fmtDayKey, fmtDayShort, fmtTime, xlDate, ms, HOUR, DAY, MONTHS, DAYS };
