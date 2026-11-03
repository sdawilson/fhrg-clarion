// Simulated Bunny storage, website database, Claude, reference library and public sources, so Clarion can
// be tested without any accounts. Importing it replaces fetch; requests to 127.0.0.1 (a server under test)
// go through. The library uses the real table and column names, so the figures' SQL is really run.
import { webcrypto as crypto } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export const env = {
  ANTHROPIC_API_KEY: "test", STORAGE_ACCESS_KEY: "key", STORAGE_ZONE: "zone", WEBSITE_DATABASE_URL: "https://db.test", WEBSITE_DATABASE_AUTH_TOKEN: "tok",
  SESSION_SECRET: "a-long-test-secret-of-forty-or-more-characters!!", FHRG_REF_KEY: "ref-key-secret-123", FHRG_REF_URL: "https://builder.test", SITE_ADMINS: "boss@fhrg.test",
};
Object.assign(process.env, env);

export const store = new Map(); // path -> { body: Uint8Array, type }
const enc = new TextEncoder(), dec = new TextDecoder();
export const putText = (path, text) => store.set(path, { body: enc.encode(text), type: "application/json" });
export const getText = (path) => (store.has(path) ? dec.decode(store.get(path).body) : null);
export const getJson = (path) => JSON.parse(getText(path));
export const files = (prefix) => [...store.keys()].filter((k) => k.startsWith(prefix));

// accounts: password "pw" for everyone
const b64url = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function hash(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, key, 256);
  return `pbkdf2$100000$${b64url(salt)}$${b64url(new Uint8Array(bits))}`;
}
export const authorities = [
  { id: 10, name: "Lincolnshire County Council", status: "approved" }, { id: 20, name: "Kirklees Council", status: "approved" }, { id: 30, name: "West Sussex County Council", status: "approved" },
  { id: 40, name: "North Lincolnshire Council", status: "approved" }, { id: 99, name: "FHRG", status: "approved" },
];
export const users = [];
export async function addUser(id, email, name, aid, role = "member", siteAdmin = 0) {
  users.push({ id, email, name, title: "Engineer", role, status: "approved", site_admin: siteAdmin, password_hash: await hash("pw"), authority_id: aid });
}

function hrana(rows) {
  const cols = rows.length ? Object.keys(rows[0]) : [];
  const v = (x) => (x === null || x === undefined ? { type: "null" } : typeof x === "number" ? { type: "integer", value: String(x) } : { type: "text", value: String(x) });
  return { results: [{ type: "ok", response: { type: "execute", result: { cols: cols.map((name) => ({ name })), rows: rows.map((r) => cols.map((c) => v(r[c]))) } } }, { type: "ok", response: { type: "close" } }] };
}
function query(sql, args) {
  const me = (u) => { const a = authorities.find((x) => x.id === u.authority_id); return { ...u, a_id: a.id, a_name: a.name, a_status: a.status }; };
  if (/WHERE u.email = \?/.test(sql)) return users.filter((u) => u.email === args[0]).map(me);
  if (/WHERE u.id = \?/.test(sql)) return users.filter((u) => u.id === Number(args[0])).map(me);
  if (/FROM news_topics/.test(sql)) return newsTopics.map((name) => ({ name }));
  return [];
}
export const newsTopics = ["Potholes", "Street lighting", "Road safety"];

// ----- Claude: `claude.script` decides what each job's model says; every call is recorded
export const claude = { calls: [], script: {}, fail: null, failMessage: "nope", refused: [], dropAfter: 0, hold: null };
export const website = { down: false };
const message = (content, stop = "tool_use", extra = {}) => ({ id: "msg", type: "message", role: "assistant", content, stop_reason: stop, usage: { input_tokens: 1000, output_tokens: 200, ...extra } });
const use = (name, input) => ({ type: "tool_use", id: `tu_${name}_${Math.random().toString(36).slice(2, 8)}`, name, input });
export const reading = (over = {}) => ({
  headline: "Residents rate road condition poorly, though evidence is thin.", level: "Condition of highways scored 24 out of 100.", level_basis: "NHT survey 2025", direction: "Worsening", direction_kinds: ["survey"],
  confidence: "Moderate", confidence_reason: "One survey and a few public signals.", drivers: [{ theme: "Potholes", evidence: "Most public reports", kind: "actions" }], gaps: ["Fault report counts"], next_steps: ["Run a street survey"], ...over,
});
export const change = (over = {}) => ({
  title: "£220m of incentive funding released", summary: "DfT released £220m of the £525m incentive pot.", instrument: "Funding", announced_by: "Department for Transport", announced: "2026-10-21", amount: "£220m",
  public_message: "Record funding is bringing record results.", primary_found: true, deadlines: [{ date: "2026-11-30", what: "Learning evidence due at DfT" }], conditions: ["Publish a transparency report"],
  disagreements: [{ point: "Share of funding at risk", positions: "DfT says at least 25%; trade press lists 75%." }], named: ["A27 Worthing scheme, West Sussex County Council: withdrawn", "A16 scheme, Lincolnshire County Council: continuing"],
  sources: [{ url: "https://www.gov.uk/government/news/record", title: "Record funding", kind: "Primary" }, { url: "https://invented.example/made-up", title: "Invented", kind: "Other" }], ...over,
});
const impact = (statement, over = {}) => ({ route: "Money", statement, direction: "Worse", size: "Moderate", likelihood: "Almost certain", confidence: "Moderate", confidence_reason: "One trade source.", when: "Now", basis: "Data", working: "7583000 * 0.125 = 947875 [Data 1], from the survey [Data 9]", action: "Confirm the email has gone.", owner: "Asset manager", check_date: "2026-12-01", ...over });
export const assessment = (over = {}) => ({
  headline: "£0.95m rests on evidence due by 30 November.", why_here: "West Sussex is funded directly.",
  impacts: [impact("£0.95m rests on learning evidence."), impact("A second claim that doesn't stand up."), impact("A third claim that is overconfident.", { confidence: "High", check_date: "not a date" }), { statement: "" }],
  mood: { promise: "Record results", local_experience: "Condition scored 24", gap: "Large", likely_reaction: "Not on my road", confidence: "Low", survey_question: "Have you seen this on your own road?" },
  questions: ["Are we at risk?"], unknowns: ["Check DfT's letter", "The date"], ...over,
});
export const review = () => ({ reviews: [{ index: 1, verdict: "keep", reason: "Stands up." }, { index: 2, verdict: "cut", reason: "Unsupported." }, { index: 3, verdict: "reduce", reason: "Too sure." }], also_confirm: ["The date"], headline: "£0.95m may rest on evidence due by 30 November.", why_here: "West Sussex appears to be funded directly." });

// What the real service turns down with a 400 on Sonnet 5.5 and Opus 5.5.
function badSchema(s, where = "input_schema") {
  if (!s || typeof s !== "object") return "";
  if (s.type === "object" && s.additionalProperties !== false) return `${where}: additionalProperties must be false`;
  for (const k of ["minimum", "maximum", "multipleOf", "minLength", "maxLength"]) if (k in s) return `${where}: ${k} is not supported`;
  if (s.minItems !== undefined && s.minItems > 1) return `${where}: minItems above 1 is not supported`;
  for (const [k, v] of Object.entries(s.properties || {})) { const b = badSchema(v, `${where}.${k}`); if (b) return b; }
  return s.items ? badSchema(s.items, `${where}[]`) : "";
}
export function refused(body) {
  if (["any", "tool"].includes(body.tool_choice?.type)) return `tool_choice: type "tool" and "any" are not supported for this model.`;
  if (body.thinking?.type === "disabled") return "thinking: disabled is not supported for this model. Use between_tools.";
  for (const m of body.messages || []) if (m.role === "assistant" && Array.isArray(m.content) && /thinking$/.test(m.content.at(-1)?.type || "")) return "The final block in an assistant message cannot be `thinking`.";
  for (const t of body.tools || []) if (t.strict) { const b = badSchema(t.input_schema); if (b) return `tools.${t.name}: ${b}`; }
  return "";
}

// The reply as the real service streams it, tool input in pieces. Anything cut off ends mid-way through its JSON.
function sse(m) {
  const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  const usage = m.usage || {};
  let out = ev("message_start", { message: { id: m.id, type: "message", role: "assistant", model: "claude-sonnet-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: usage.input_tokens ?? 0, output_tokens: 1 } } });
  out += ev("ping", {});
  m.content.forEach((b, index) => {
    if (b.type === "tool_use" || b.type === "server_tool_use") {
      const json = JSON.stringify(b.input ?? {}).slice(0, m.stop_reason === "max_tokens" ? -4 : undefined);
      out += ev("content_block_start", { index, content_block: { ...b, input: {} } });
      for (let i = 0; i < json.length; i += 40) out += ev("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: json.slice(i, i + 40) } });
    } else if (b.type === "text") {
      out += ev("content_block_start", { index, content_block: { type: "text", text: "" } }) + ev("content_block_delta", { index, delta: { type: "text_delta", text: b.text } });
    } else if (b.type === "thinking") {
      out += ev("content_block_start", { index, content_block: { type: "thinking", thinking: "", signature: "" } }) + ev("content_block_delta", { index, delta: { type: "thinking_delta", thinking: b.thinking } }) + ev("content_block_delta", { index, delta: { type: "signature_delta", signature: b.signature } });
    } else out += ev("content_block_start", { index, content_block: b });
    out += ev("content_block_stop", { index });
  });
  if (claude.dropAfter > 0) { claude.dropAfter--; return out + `event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } })}\n\n`; }
  return out + ev("message_delta", { delta: { stop_reason: m.stop_reason, stop_sequence: null }, usage: { output_tokens: usage.output_tokens ?? 0, ...(usage.server_tool_use ? { input_tokens: usage.input_tokens, server_tool_use: usage.server_tool_use } : {}) } }) + ev("message_stop", {});
}

function anthropic(body) {
  const sys = String(body.system || "");
  const first = body.messages[0].content;
  claude.calls.push({ body, sys, prompt: typeof first === "string" ? first : first.map((b) => b.text ?? "").join("") });
  const names = (body.tools || []).map((t) => t.name);
  const finish = names.find((n) => n.startsWith("submit_"));
  const custom = claude.script[finish];
  if (custom) { const r = custom(body); if (r) return r; }
  const turn = body.messages.length;
  if (finish === "submit_reading") return message([use(finish, reading())]);
  if (finish === "submit_change") {
    if (turn === 1 && body.tools.some((t) => /^web_/.test(t.type || ""))) return message([
      { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "incentive funding" } },
      { type: "web_search_tool_result", tool_use_id: "s1", content: [{ type: "web_search_result", url: "https://www.gov.uk/government/news/record", title: "Record funding", encrypted_content: "x", page_age: "" }] },
      { type: "text", text: "Found it." },
    ], "pause_turn", { server_tool_use: { web_search_requests: 1 } });
    return message([use(finish, change())]);
  }
  if (finish === "submit_assessment") {
    if (turn === 1) return message([use("query_data", { sql: "SELECT funding_pot, amount_gbp FROM maintenance_allocations WHERE la_code = 'E10000032' AND fye = 2027", purpose: "West Sussex allocations" })]);
    if (turn === 3) return message([use("calculate", { expression: "7583000 * 0.125" })]);
    return message([use(finish, assessment())]);
  }
  if (finish === "submit_review") return message([use(finish, review())]);
  if (finish === "submit_questions") return message([use(finish, { questions: [{ text: "Have you noticed the work on the A27?", kind: "choice", options: ["Yes", "No", "Don't know"], why: "Shows how far the scheme has reached people.", reason: "Loud: has it reached people?", topic: "A27 works", based_on: ["Impact note", "Fault reports", "Press"] }, { text: "What would you change first?", kind: "text", options: [], why: "Priorities in people's own words." }] })]);
  if (finish === "submit_wording") return message([use(finish, { verdicts: [{ id: "l1", verdict: "leading", reason: "It assumes the roads are bad.", better: "How are the roads near you?" }, { id: "l9", verdict: "Fine", reason: "", better: "" }] })]);
  if (finish === "submit_forms") return message([use(finish, { forms: [
    { form_number: "71", site: "Market Square", answers: [{ id: "c1", answer: "fairly satisfied" }, { id: "c2", answer: "Worse" }, { id: "c3", answer: "Saw a big hole. Jane Smith told me." }, { id: "zz", answer: "not a question" }], unclear: ["c2"] },
    { form_number: "72", site: "", answers: [{ id: "c1", answer: "A scribble" }, { id: "c2", answer: "Better" }, { id: "a2", answer: "Female" }], unclear: [] },
  ] })]);
  if (finish === "submit_comments") {
    const comments = JSON.parse(/<comments>\n([\s\S]*)\n<\/comments>/.exec(typeof first === "string" ? first : "")?.[1] || "[]");
    return message([use(finish, { comments: comments.filter((x) => !x.text.includes("lost in the post")).map((x) => ({ ref: x.ref, text: x.text.replace(/Jane Smith/g, "[removed]"), topic: /light/i.test(x.text) ? "street lighting" : /hole/i.test(x.text) ? "Potholes" : "Made-up topic" })) })]);
  }
  return message([{ type: "text", text: "Hello." }], "end_turn");
}

// ----- the reference library, with the real tables
const db = new DatabaseSync(":memory:");
db.exec(`
CREATE TABLE authorities (la_code TEXT, la_name TEXT, region TEXT, country TEXT, kind TEXT, other_names TEXT);
CREATE TABLE road_condition_la (la_code TEXT, la_name TEXT, region TEXT, road_class TEXT, fye INTEGER, rating TEXT, pct REAL, flag TEXT);
CREATE TABLE road_treatment_la (la_code TEXT, la_name TEXT, region TEXT, road_class TEXT, fye INTEGER, network_km REAL, strengthening_pct REAL, resurfacing_pct REAL, preservation_pct REAL, total_pct REAL);
CREATE TABLE road_length_la (la_code TEXT, la_name TEXT, region TEXT, year INTEGER, road_type TEXT, km REAL);
CREATE TABLE traffic_la (la_code TEXT, la_name TEXT, year INTEGER, link_length_km REAL, cars_and_taxis REAL, all_motor_vehicles REAL);
CREATE TABLE collisions (collision_index TEXT, collision_year INTEGER, date_iso TEXT, la_code TEXT, collision_severity INTEGER);
CREATE TABLE collision_casualties (collision_index TEXT, casualty_severity INTEGER);
CREATE TABLE maintenance_allocations (authority TEXT, authority_type TEXT, la_code TEXT, funding_pot TEXT, fye INTEGER, years TEXT, amount_gbp REAL, note TEXT, source TEXT);
CREATE TABLE census_age_sex_la (la_code TEXT, la_name TEXT, region TEXT, age_band TEXT, age_from INTEGER, age_to INTEGER, sex TEXT, people INTEGER);
CREATE TABLE neighbourhoods (msoa_code TEXT, msoa_name TEXT, place_name TEXT, la_code TEXT, la_name TEXT, lat REAL, lng REAL, rural INTEGER, rural_class TEXT, people INTEGER, adults INTEGER, aged_16_34 INTEGER, aged_35_64 INTEGER, aged_65_plus INTEGER,
  households INTEGER, households_no_car INTEGER, workers INTEGER, drive INTEGER, walk_cycle INTEGER, bus_train INTEGER, imd_score REAL, imd_people INTEGER, people_most_deprived_20pct INTEGER, town_code TEXT, town_name TEXT);
CREATE TABLE audience_rates (kind TEXT, source_type TEXT, measure TEXT, group_type TEXT, group_name TEXT, age_from INTEGER, age_to INTEGER, value REAL, unit TEXT, year TEXT, geography TEXT, base TEXT, publisher TEXT, publication TEXT, url TEXT, licence TEXT);
CREATE TABLE towns (town_code TEXT, town_name TEXT, la_code TEXT, la_name TEXT, lat REAL, lng REAL, people INTEGER);
CREATE TABLE neighbourhood_shapes (msoa_code TEXT, la_code TEXT, rings TEXT);
`);
const ins = (t, n) => db.prepare(`INSERT INTO ${t} VALUES (${Array(n).fill("?").join(",")})`);
const AUTH = [["E10000032", "West Sussex", "South East", "County council"], ["E10000016", "Kent", "South East", "County council"], ["E10000030", "Surrey", "South East", "County council"],
  ["E10000019", "Lincolnshire", "East Midlands", "County council"], ["E10000024", "Nottinghamshire", "East Midlands", "County council"],
  // the authorities table names this region differently from DfT's tables, as the real one does
  ["E08000034", "Kirklees", "Yorkshire and the Humber", "Metropolitan district", "The Humber"], ["E08000035", "Leeds", "Yorkshire and the Humber", "Metropolitan district", "The Humber"]];
AUTH.forEach(([code, name, region, kind, ownRegion], i) => {
  ins("authorities", 6).run(code, name, ownRegion ?? region, "England", kind, "");
  for (const fye of [2022, 2026]) for (const [cls, base] of [["A", 2], ["B and C", 4], ["Unclassified", 15]]) ins("road_condition_la", 8).run(code, name, region, cls, fye, "red", base + i + (fye === 2026 ? 1 : 0), "");
  ins("road_condition_la", 8).run(code, name, region, "A", 2026, "green", 80, "");
  for (const cls of ["A", "B, C and unclassified"]) ins("road_treatment_la", 10).run(code, name, region, cls, 2026, 500, 1, 2, 3, 3 + i);
  ins("road_length_la", 6).run(code, name, region, 2024, "All roads [note 4]", 4000 + i); ins("road_length_la", 6).run(code, name, region, 2023, "All roads [note 4]", 3999 + i); ins("road_length_la", 6).run(code, name, region, 2024, "Minor roads", 3000);
  // the lockdown year is far lower, as it is in the real data. Nottinghamshire has nothing for 2019.
  for (let k = -1; k < 7; k++) if (!(name === "Nottinghamshire" && k < 1)) ins("traffic_la", 6).run(code, name, 2019 + k, 4000, 1, k === 1 ? 700 : 1000 + k * 10);
  for (let k = 0; k < 3; k++) { ins("collisions", 5).run(`C${i}-${k}`, 2024, "2024-01-01", code, k + 1); ins("collision_casualties", 2).run(`C${i}-${k}`, k + 1); }
});
// the real bands. West Sussex has more older people than younger ones, which is what weighting has to correct.
const CENSUS_BANDS = [["0 to 4", 0, 4], ["5 to 9", 5, 9], ["10 to 15", 10, 15], ["16 to 19", 16, 19], ["20 to 24", 20, 24], ...[25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80].map((a) => [`${a} to ${a + 4}`, a, a + 4]), ["85 and over", 85, null]];
for (const [band, from, to] of CENSUS_BANDS) for (const sex of ["Female", "Male"]) ins("census_age_sex_la", 8).run("E10000032", "West Sussex", "South East", band, from, to, sex, from < 16 ? 9999 : from < 35 ? 10000 : from < 65 ? 20000 : 30000);
ins("road_condition_la", 8).run("E10000004", "Bedfordshire", "East of England", "A", 2026, "red", 40, ""); // abolished, and not in authorities
ins("road_treatment_la", 10).run("E10000004", "Bedfordshire", "East of England", "A", 2026, 500, 1, 2, 3, 40);
for (const [pot, amount] of [["Baseline", 20720000], ["Incentive", 7583000], ["Total", 28303000]]) ins("maintenance_allocations", 9).run("West Sussex", "local highway authority", "E10000032", pot, 2027, "2026 to 2027", amount, "", "DfT");
ins("maintenance_allocations", 9).run("West Sussex", "local highway authority", "E10000032", "Total", 2028, "2027 to 2028", 32904000, "", "DfT");

// A made-up West Sussex: 24 neighbourhoods in a grid around six towns, with the real tables' columns
const TOWNS = [["T1", "Testhaven", 1, 1, 100000], ["T2", "Seaton", 4, 1, 60000], ["T3", "Hilltop", 1, 3, 30000], ["T4", "Riverford", 4, 3, 20000], ["T5", "Oldbury", 2.6, 2, 12000], ["T6", "Marsh End", 5, 0, 9000], ["T7", "Smallville", 3, 0, 3000]];
const spot = (col, row) => [-0.9 + col * 0.1, 50.8 + row * 0.06];
TOWNS.forEach(([code, name, col, row, people]) => { const [lng, lat] = spot(col, row); ins("towns", 7).run(code, name, "E10000032", "West Sussex", lat, lng, people); });
for (let col = 0; col < 6; col++) for (let row = 0; row < 4; row++) {
  const [lng, lat] = spot(col, row), code = `M${col}${row}`;
  const near = [...TOWNS].sort((a, b) => Math.hypot(a[2] - col, a[3] - row) - Math.hypot(b[2] - col, b[3] - row))[0], inside = Math.hypot(near[2] - col, near[3] - row) < 0.8;
  const adults = 5000 + col * 300 + row * 200;
  ins("neighbourhoods", 25).run(code, `West Sussex ${code}`, `Place ${code}`, "E10000032", "West Sussex", lat, lng, inside ? 0 : 1, inside ? "Urban" : "Rural", adults + 1000, adults, Math.round(adults * (0.2 + col * 0.02)), Math.round(adults * 0.5), Math.round(adults * (0.3 - col * 0.02)),
    2500, 200 + row * 100, 3000, 1500 + col * 50, 300, 150, 12, adults, row === 0 ? 900 : 0, inside ? near[0] : null, inside ? near[1] : null);
  const x = 0.05, y = 0.03;
  ins("neighbourhood_shapes", 3).run(code, "E10000032", JSON.stringify([[[lng - x, lat - y], [lng + x, lat - y], [lng + x, lat + y], [lng - x, lat + y], [lng - x, lat - y]]]));
}

// Published rates, in the different age bands the real sources use
const rate = (measure, year, rows) => rows.forEach(([from, to, value]) => ins("audience_rates", 16).run("behaviour", "", measure, "age", `${from}`, from, to, value, "%", year, "England", "", "Test", "Test", "", "OGL"));
const FIVES = (values) => values.map((v, i) => [16 + (i ? i * 5 - 1 : 0), i === 0 ? 19 : i === values.length - 1 ? null : 19 + i * 5, v]);
rate("Read news in a local printed newspaper in the last 12 months", "2025/26", FIVES([8, 9, 10, 12, 14, 18, 20, 22, 24, 27, 31, 36, 39, 41, 40]));
rate("Read news in a national printed newspaper in the last 12 months", "2025/26", FIVES([10, 12, 14, 15, 19, 22, 26, 28, 31, 36, 41, 48, 54, 56, 54]));
const SEVEN = (values) => values.map((v, i) => [16 + (i ? i * 10 - 1 : 0), i === 6 ? null : 24 + i * 10, v]);
rate("Local news in the last month or so: Television", "2026", SEVEN([25, 29, 38, 39, 51, 59, 64]));
rate("Local news in the last month or so: Social media such as Facebook, X (formerly Twitter) or Instagram, etc.", "2026", SEVEN([59, 59, 52, 52, 40, 38, 26]));
rate("drive: holds a full car driving licence", "2025", [[17, 20, 32], [21, 29, 61], [30, 39, 72], [40, 49, 81], [50, 59, 84], [60, 69, 84], [70, null, 74]]);
rate("walk: walks at least once a week, any purpose", "2023", [[16, 24, 71], [25, 34, 71], [35, 44, 69], [45, 54, 71], [55, 64, 71], [65, 74, 72], [75, 84, 61], [85, null, 36]]);
rate("cycle: cycles at least once a week, any purpose", "2023", [[16, 24, 18], [25, 34, 17], [35, 44, 16], [45, 54, 12], [55, 64, 8], [65, 74, 5], [75, 84, 3], [85, null, 1]]);
rate("complain/contact + petition: any civic participation in last 12 months (composite)", "2025/26 (Oct 2025 to Mar 2026)", [[16, 24, 28], [25, 34, 38], [35, 49, 41], [50, 64, 42], [65, 74, 43], [75, null, 34]]);
rate("complain/contact + petition: any civic participation in last 12 months (composite)", "2024/25 (Oct 2024 to Mar 2025)", [[16, 24, 1], [25, null, 1]]);
rate("complain/contact: Contacted my local council (ever in last few years)", "2025", [[16, 24, 9], [25, 34, 22], [35, 44, 38], [45, 54, 33], [55, 64, 24], [65, null, 31]]);

// The search service: what a site has on a keyword. Tests fill this in, and each call is noted.
export const search = { calls: [], hits: {}, status: 200, body: null };
export const slowStorage = { ms: 0 }; // to let two requests overlap

export const lib = { queries: [], down: false };
const OGL = "Contains public sector information licensed under the Open Government Licence v3.0.";
const dataset = (title, tables) => ({ name: title, title, attribution: `${title}. ${OGL}`, sourceDate: "2026-10", loadedAt: "2026-10-20", tables: tables.map((name) => ({ name })) });
const DATASETS = [dataset("Road traffic statistics", ["authorities", "traffic_la"]), dataset("Road condition statistics", ["road_condition_la"]), dataset("Road treatment", ["road_treatment_la"]), dataset("Road lengths", ["road_length_la"]), dataset("Road casualties", ["collisions", "collision_casualties"]), dataset("Highways maintenance funding", ["maintenance_allocations"]), dataset("Census 2021", ["census_age_sex_la"])];
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
function library(url, init) {
  if (lib.down) return reply(500, { error: "Down" });
  if ((init.headers || {}).Authorization !== `Bearer ${env.FHRG_REF_KEY}`) return reply(401, { error: "Wrong key" });
  const path = url.slice("https://builder.test".length);
  if (path === "/api/reference/datasets") return reply(200, { datasets: DATASETS });
  if (path === "/api/reference/query") {
    const b = JSON.parse(init.body);
    lib.queries.push(b);
    if (!/^\s*(select|with)\b/i.test(b.sql) || /;\s*\S/.test(b.sql)) return reply(400, { error: "Only one SELECT is allowed" });
    try {
      const st = db.prepare(b.sql);
      const rows = st.all(...(b.args || []));
      return reply(200, { columns: rows.length ? Object.keys(rows[0]) : [], rows });
    } catch (e) { return reply(400, { error: e.message }); }
  }
  return reply(404, { error: "Not found" });
}

// ----- public sources
const rssItem = (cat, when, lat, lon) => `<item><title>Dangerous hole outside Jane Smith's house at 4 Acacia Avenue</title><link>https://www.fixmystreet.com/report/1</link><description><![CDATA[Reported by Jane Smith. Nearest road: Acacia Avenue]]></description><category>${cat}</category><pubDate>${when}</pubDate><georss:point>${lat} ${lon}</georss:point></item>`;
export const FEED = `<?xml version="1.0"?><rss version="2.0"><channel><title>Reports</title>${[
  rssItem("Potholes", "Sun, 01 Nov 2026 10:00:00 +0000", 50.91, -0.45), rssItem("Potholes", "Sat, 31 Oct 2026 10:00:00 +0000", 50.911, -0.451), rssItem("Potholes", "Fri, 30 Oct 2026 10:00:00 +0000", 50.912, -0.452), rssItem("Street lighting", "Thu, 29 Oct 2026 10:00:00 +0000", 51.1, -0.2),
].join("")}</channel></rss>`;
const PETITIONS = { data: [
  { id: 101, attributes: { action: "Fix the nation's potholes", background: "Roads are crumbling", signature_count: 10000 } },
  { id: 102, attributes: { action: "Ban fireworks", background: "Noise", signature_count: 900000 } },
] };
const PETITION = { data: { attributes: { signatures_by_constituency: [{ name: "Horsham", ons_code: "E1", mp: "An MP", signature_count: 300 }, { name: "Worthing West", ons_code: "E2", mp: "Another MP", signature_count: 100 }, { name: "Bath", ons_code: "E3", mp: "X", signature_count: 500 }] } } };
const MEMBER_IDS = { horsham: 501 };
// A busy MP: a hundred and twenty newer questions on other things before the one on roads
const SCHOOLS = Array.from({ length: 120 }, (_, i) => ({ value: { id: 1000 + i, askingMemberId: 501, dateTabled: "2026-10-20T00:00:00", uin: String(20000 + i), heading: "Schools: Funding", questionText: "To ask the Secretary of State about schools in Horsham." } }));
const QUESTIONS = { results: [ ...SCHOOLS,
  { value: { id: 9, askingMemberId: 501, dateTabled: "2026-10-01T00:00:00", uin: "12345", heading: "Roads: Potholes", questionText: "To ask the Secretary of State about potholes in Horsham." } },
  { value: { id: 10, askingMemberId: 999, dateTabled: "2026-10-02T00:00:00", uin: "12346", heading: "Roads: Elsewhere", questionText: "Somewhere else." } },
  { value: { id: 11, askingMemberId: 501, dateTabled: "2026-10-03T00:00:00", uin: "12347", heading: "Air Traffic Control", questionText: "To ask the Secretary of State about air traffic over Horsham." } },
] };
const GOVUK = { results: [
  { title: "Record funding, record results", link: "/government/news/record", public_timestamp: "2026-10-21T21:00:00Z", description: "Potholes and roads." },
  { title: "DfT organisational charts", link: "/government/publications/charts", public_timestamp: "2026-11-02T07:00:00Z", description: "Salaries." },
] };
export const outside = { down: new Set(), hits: [] };
function publicSource(url) {
  const host = new URL(url).hostname;
  outside.hits.push(url);
  if (outside.down.has(host)) return new Response("no", { status: 503 });
  if (host === "www.fixmystreet.com") return new Response(FEED, { status: 200 });
  if (host === "petition.parliament.uk") return reply(200, url.includes("/petitions/") ? PETITION : PETITIONS);
  if (host === "members-api.parliament.uk") {
    const name = decodeURIComponent(new URL(url).searchParams.get("searchText") || "");
    const id = MEMBER_IDS[name.toLowerCase()] ?? (600 + name.length);
    return reply(200, { items: [{ value: { id: 1, name, currentRepresentation: { member: { value: { id, nameDisplayAs: `MP for ${name}` } } } } }] });
  }
  if (host === "questions-statements-api.parliament.uk") {
    const q = new URL(url).searchParams, id = Number(q.get("askingMemberId")), skip = Number(q.get("skip") || 0), take = Number(q.get("take") || 20);
    const all = QUESTIONS.results.filter((r) => !id || r.value.askingMemberId === id);
    return reply(200, { results: all.slice(skip, skip + take), totalResults: all.length });
  }
  if (host === "www.gov.uk") return reply(200, GOVUK);
  return null;
}

export const hooks = { fetch: null };
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url;
  const method = (init.method || "GET").toUpperCase();
  if (url.startsWith("https://storage.bunnycdn.com/zone/")) {
    if (slowStorage.ms) await new Promise((r) => setTimeout(r, slowStorage.ms));
    const path = decodeURIComponent(url.slice("https://storage.bunnycdn.com/zone/".length));
    if (method === "PUT") { store.set(path, { body: enc.encode(String(init.body)), type: (init.headers || {})["Content-Type"] || "" }); return new Response("{}", { status: 201 }); }
    if (method === "DELETE") { const had = store.delete(path); return new Response("", { status: had ? 200 : 404 }); }
    if (path.endsWith("/")) return new Response(JSON.stringify([...store.keys()].filter((k) => k.startsWith(path) && !k.slice(path.length).includes("/")).map((k) => ({ ObjectName: k.slice(path.length), IsDirectory: false }))), { status: 200 });
    const f = store.get(path);
    return f ? new Response(f.body, { status: 200 }) : new Response("", { status: 404 });
  }
  if (url === "https://db.test/v2/pipeline") {
    if (website.down) return new Response("", { status: 503 });
    const stmt = JSON.parse(init.body).requests[0].stmt;
    return new Response(JSON.stringify(hrana(query(stmt.sql, stmt.args.map((a) => a.value)))), { status: 200 });
  }
  if (url === "https://api.anthropic.com/v1/messages") {
    if (claude.fail) return new Response(JSON.stringify({ error: { message: claude.failMessage } }), { status: claude.fail });
    if (claude.hold) await claude.hold;
    const body = JSON.parse(init.body), no = refused(body);
    if (no) { claude.refused.push(no); return new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: no } }), { status: 400 }); }
    return new Response(sse(anthropic(body)), { status: 200, headers: { "content-type": "text/event-stream" } });
  }
  if (url.startsWith("https://builder.test")) return library(url, init);
  if (url.startsWith("https://api.search.brave.com/")) {
    search.calls.push({ url, headers: init.headers, at: Date.now() });
    if (search.status !== 200 || search.body !== null) return new Response(search.body ?? "{}", { status: search.status });
    const q = new URL(url).searchParams.get("q"), hits = search.hits[q];
    return new Response(JSON.stringify({ type: "search", query: { original: q }, ...(hits ? { web: { type: "search", results: hits } } : {}) }), { status: 200, headers: { "content-type": "application/json" } }); // nothing found leaves out the results
  }
  if (/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) return realFetch(input, init); // the server under test
  if (hooks.fetch) { const r = await hooks.fetch(url, init); if (r) return r; }
  const r = publicSource(url);
  if (r) return r;
  throw new Error("Unexpected fetch: " + url);
};

export async function until(fn, what, ms = 8000) {
  const t = Date.now();
  while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 15)); }
  throw new Error("Timed out waiting for " + what);
}
