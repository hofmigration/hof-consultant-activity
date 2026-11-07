// 0-hubspot.js — reading HubSpot. Nothing is ever written.
//
// HubSpot allows five searches a second for the whole account (the other agents share that),
// so searches and reads are paced, and a busy moment is simply waited out.
const { SETTINGS } = require("./config");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uniq = (ids) => [...new Set((ids || []).map(String))];

function throttle(rps) {
  let next = 0;
  return async () => { const now = Date.now(); const at = Math.max(now, next); next = at + 1000 / rps; if (at > now) await sleep(at - now); };
}
const gate = { search: throttle(SETTINGS.SEARCH_RPS), api: throttle(SETTINGS.API_RPS) };
const stats = { calls: 0, retries: 0 };

async function hs(method, path, body, kind = "api", attempt = 0) {
  await gate[kind]();
  stats.calls++;
  let res;
  try {
    res = await fetch(`https://api.hubapi.com${path}`, {
      method, headers: { Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if (attempt < 6) { stats.retries++; await sleep(2000 * (attempt + 1)); return hs(method, path, body, kind, attempt + 1); }
    throw new Error(`Could not reach HubSpot: ${e.message}`);
  }
  if ((res.status === 429 || res.status >= 500) && attempt < 8) {
    stats.retries++;
    await sleep(Math.min(30000, 1500 * 2 ** attempt));
    return hs(method, path, body, kind, attempt + 1);
  }
  const text = await res.text();
  if (!res.ok) { const e = new Error(`${method} ${path.split("?")[0]} -> ${res.status} ${text.slice(0, 220)}`); e.status = res.status; throw e; }
  return text ? JSON.parse(text) : null;
}

// Run fn over items with at most n at a time (the pacing above still applies).
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  const worker = async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

// Every record matching `filters` with `dateProp` in [from, to). `to` may be Infinity (no end).
// HubSpot will not page past 10,000 results in one search, so a window holding more is halved
// until each part fits: nothing is ever silently cut short. When dateProp can change while we
// read (a "last modified" date), pages are sorted by record id so nothing shifts between pages,
// and the windows are read oldest first, so a record that moves only moves into a later window.
const SPLIT_AT = 9800;
async function searchRange(obj, filters, dateProp, from, to, properties, opts = {}, depth = 0) {
  const group = (f, t) => [{ filters: [...filters,
    { propertyName: dateProp, operator: "GTE", value: String(f) },
    ...(Number.isFinite(t) ? [{ propertyName: dateProp, operator: "LT", value: String(t) }] : [])] }];
  const probe = await hs("POST", `/crm/v3/objects/${obj}/search`, { filterGroups: group(from, to), properties: ["hs_object_id"], limit: 1 }, "search");
  const total = (probe && probe.total) || 0;
  if (!total) return [];
  const hi = Number.isFinite(to) ? to : Math.max(Date.now(), from + 120e3);
  if (total > SPLIT_AT && depth < 20 && hi - from > 60e3) {
    const mid = Math.floor((from + hi) / 2);
    const left = await searchRange(obj, filters, dateProp, from, mid, properties, opts, depth + 1);
    const right = await searchRange(obj, filters, dateProp, mid, to, properties, opts, depth + 1);
    return [...left, ...right];
  }
  let sortProp = opts.sortProp || dateProp;
  const out = []; let after;
  for (let i = 0; i < 60; i++) {
    let r;
    try {
      r = await hs("POST", `/crm/v3/objects/${obj}/search`, {
        filterGroups: group(from, to), sorts: [{ propertyName: sortProp, direction: "ASCENDING" }], properties, limit: 200, after,
      }, "search");
    } catch (e) {
      if (e.status === 400 && sortProp !== dateProp && !after) { sortProp = dateProp; i--; continue; }
      if (e.status === 400 && after) { console.log(`  !! HubSpot stopped paging ${obj} after ${out.length} of ${total} records in one window`); break; }
      throw e;
    }
    out.push(...((r && r.results) || []));
    after = r && r.paging && r.paging.next && r.paging.next.after;
    if (!after) break;
  }
  if (out.length < Math.min(total, 10000) && Number.isFinite(to)) console.log(`  !! HubSpot said ${total} ${obj} in a window but ${out.length} were read`);
  return out;
}

// Associations, many records at once. HubSpot's batch size for this has changed over time,
// so it starts big and halves on refusal rather than assuming. A record with more links
// than one answer holds is paged to the end.
let assocBatch = 1000;
async function links(fromObj, toObj, ids) {
  const map = new Map();
  const list = uniq(ids);
  for (let i = 0; i < list.length;) {
    const chunk = list.slice(i, i + assocBatch);
    let r;
    try {
      r = await hs("POST", `/crm/v4/associations/${fromObj}/${toObj}/batch/read`, { inputs: chunk.map((id) => ({ id })) });
    } catch (e) {
      if (e.status === 400 && assocBatch > 100) { assocBatch = Math.max(100, Math.floor(assocBatch / 2)); continue; }
      throw e;
    }
    for (const row of (r && r.results) || []) {
      const from = String(row.from && row.from.id);
      const to = new Set([...(map.get(from) || []), ...(row.to || []).map((t) => String(t.toObjectId))]);
      let after = row.paging && row.paging.next && row.paging.next.after;
      for (let p = 0; after && p < 50; p++) {
        const more = await hs("GET", `/crm/v4/objects/${fromObj}/${from}/associations/${toObj}?limit=500&after=${encodeURIComponent(after)}`);
        for (const t of (more && more.results) || []) to.add(String(t.toObjectId));
        after = more && more.paging && more.paging.next && more.paging.next.after;
      }
      map.set(from, [...to]);
    }
    i += chunk.length;
  }
  return map;
}

async function batchRead(obj, ids, properties) {
  const map = new Map();
  const list = uniq(ids);
  for (let i = 0; i < list.length; i += 100) {
    const r = await hs("POST", `/crm/v3/objects/${obj}/batch/read`, { properties, inputs: list.slice(i, i + 100).map((id) => ({ id })) });
    for (const o of (r && r.results) || []) map.set(String(o.id), o.properties || {});
  }
  return map;
}

// Records with the change history of some properties: { properties, history: { prop: [...] } }.
let histBatch = 50;
async function batchHistory(obj, ids, properties, histProps) {
  const map = new Map();
  const list = uniq(ids);
  for (let i = 0; i < list.length;) {
    const chunk = list.slice(i, i + histBatch);
    let r;
    try {
      r = await hs("POST", `/crm/v3/objects/${obj}/batch/read`, { properties, propertiesWithHistory: histProps, inputs: chunk.map((id) => ({ id })) });
    } catch (e) {
      if (e.status === 400 && histBatch > 5) { histBatch = Math.max(5, Math.floor(histBatch / 2)); continue; }
      throw e;
    }
    for (const o of (r && r.results) || []) map.set(String(o.id), { properties: o.properties || {}, history: o.propertiesWithHistory || {} });
    i += chunk.length;
  }
  return map;
}
async function history(obj, id, properties, histProps) {
  try {
    const r = await hs("GET", `/crm/v3/objects/${obj}/${id}?properties=${properties.join(",")}&propertiesWithHistory=${histProps.join(",")}`);
    return r ? { properties: r.properties || {}, history: r.propertiesWithHistory || {} } : null;
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

// History is read 50 records at a time, which is quick. Whether HubSpot gives the batch read
// the same history as a single read is not something to assume, so a sample (the records with
// the longest histories, and a spread of others) is read again one by one and compared over the
// report's days. If any differ, every record is read one by one instead.
async function historyFor(obj, ids, properties, histProps, since, log = console.log) {
  const list = uniq(ids);
  const result = { map: new Map(), mode: "batch", failed: 0, checked: 0 };
  if (!list.length) return result;
  try {
    result.map = await batchHistory(obj, list, properties, histProps);
  } catch (e) {
    log(`  ${obj}: history could not be read in batches (${e.message.slice(0, 120)}); reading one by one`);
    result.mode = "single";
  }
  if (result.mode === "batch") {
    const since0 = (x) => (Array.isArray(x) ? x : []).filter((h) => Date.parse(h.timestamp) >= since).map((h) => `${h.value}|${Date.parse(h.timestamp)}`).sort().join(",");
    const longest = [...result.map.entries()].map(([id, r]) => [id, histProps.reduce((a, p) => a + ((r.history[p] || []).length), 0)])
      .sort((a, b) => b[1] - a[1]).slice(0, 12).map((x) => x[0]);
    const step = Math.max(1, Math.floor(list.length / 8));
    const spread = list.filter((_, i) => i % step === 0).slice(0, 8);
    const sample = uniq([...longest, ...spread]);
    let differ = 0;
    for (const id of sample) {
      const one = await history(obj, id, properties, histProps);
      if (!one) continue;
      result.checked++;
      const b = result.map.get(id);
      for (const p of histProps) if (since0(b && b.history[p]) !== since0(one.history[p])) differ++;
    }
    if (differ) {
      log(`  ${obj}: the batch history differed from single reads on ${differ} of ${sample.length} checked; reading all ${list.length} one by one`);
      result.mode = "single";
    }
  }
  if (result.mode === "single") {
    const map = new Map();
    await pool(list, 8, async (id) => {
      try { const r = await history(obj, id, properties, histProps); if (r) map.set(id, r); } catch (e) { result.failed++; }
    });
    result.map = map;
  }
  return result;
}

// Owners (people), active and deactivated, with the user id their history entries carry.
async function owners() {
  const list = [];
  for (const archived of [false, true]) {
    let after;
    try {
      for (let i = 0; i < 20; i++) {
        const r = await hs("GET", `/crm/v3/owners?limit=500&archived=${archived}${after ? `&after=${encodeURIComponent(after)}` : ""}`);
        for (const o of (r && r.results) || []) list.push({
          ownerId: String(o.id), userId: o.userId != null ? String(o.userId) : "",
          name: `${o.firstName || ""} ${o.lastName || ""}`.replace(/\s+/g, " ").trim() || o.email || String(o.id),
          email: String(o.email || "").toLowerCase(), archived,
        });
        after = r && r.paging && r.paging.next && r.paging.next.after;
        if (!after) break;
      }
    } catch (e) { if (!archived) throw e; }
  }
  return list;
}

// Deal stage and pipeline names. Stage names differ between pipelines, so they are read from
// HubSpot rather than assumed.
async function pipelines() {
  const r = await hs("GET", "/crm/v3/pipelines/deals");
  const stages = {}, names = {};
  for (const p of (r && r.results) || []) {
    names[String(p.id)] = String(p.label || "").trim();
    for (const s of p.stages || []) stages[String(s.id)] = { label: String(s.label || "").trim(), pipelineId: String(p.id) };
  }
  return { stages, names };
}

async function options(obj, prop) {
  try {
    const p = await hs("GET", `/crm/v3/properties/${obj}/${prop}`);
    return Object.fromEntries((p.options || []).map((o) => [String(o.value), String(o.label || o.value).trim()]));
  } catch (e) { console.log(`  Could not read ${obj}.${prop}: ${e.message}`); return {}; }
}

const contactLink = (id) => `https://app.hubspot.com/contacts/${SETTINGS.PORTAL_ID}/record/0-1/${id}`;
const dealLink = (id) => `https://app.hubspot.com/contacts/${SETTINGS.PORTAL_ID}/record/0-3/${id}`;

module.exports = { hs, pool, searchRange, links, batchRead, batchHistory, history, historyFor, owners, pipelines, options, contactLink, dealLink, stats, uniq };
