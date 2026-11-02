// The whole app through its API, against the simulators.
import { addUser, assessment, change, claude, files, getJson, getText, lib, outside, putText, reading, until, website } from "./sim.mjs";
const { handleRequest } = await import("./.build/app.mjs");

let failures = 0;
const ok = (cond, what) => { console.log(`${cond ? "PASS" : "FAIL"}  ${what}`); if (!cond) failures++; };
const R = "clarion/", WSX = "E10000032", KIRK = "E08000034", LINCS = "E10000019";
await addUser(1, "lead@westsussex.gov.uk", "Lee Lead", 30, "lead");
await addUser(2, "member@westsussex.gov.uk", "Mo Member", 30, "member");
await addUser(3, "officer@kirklees.gov.uk", "Kay Officer", 20, "member");
await addUser(4, "other@northlincs.gov.uk", "Nell Other", 40, "lead");
await addUser(5, "boss@fhrg.test", "Bo Boss", 99, "member");
await addUser(6, "burst@westsussex.gov.uk", "Bert Burst", 30, "member");
await addUser(7, "forgetful@westsussex.gov.uk", "Fay Forgetful", 30, "member");

const raw = (path, body, token) => handleRequest(new Request("https://clarion.test" + path, { method: "POST", headers: { "content-type": "application/json", ...(token ? { "x-session-token": token } : {}) }, body: JSON.stringify(body ?? {}) }));
const api = async (path, body, token) => { const r = await raw(path, body, token); return { status: r.status, ...(await r.json()) }; };
const login = async (email) => (await api("/api/login", { email, password: "pw" })).token;
const lead = await login("lead@westsussex.gov.uk"), member = await login("member@westsussex.gov.uk"), kirk = await login("officer@kirklees.gov.uk"), other = await login("other@northlincs.gov.uk"), boss = await login("boss@fhrg.test");

// ---- sign-in and access
let r = await api("/api/login", { email: "lead@westsussex.gov.uk", password: "wrong" });
ok(r.status === 401, "a wrong password is refused");
let burst = await Promise.all(Array.from({ length: 20 }, () => api("/api/login", { email: "burst@westsussex.gov.uk", password: "guess" })));
ok(burst.filter((x) => x.status === 401).length === 8 && burst.filter((x) => x.status === 429).length === 12, "of 20 tries sent at once, only 8 are let through");
ok((await api("/api/login", { email: "burst@westsussex.gov.uk", password: "pw" })).status === 429, "and the right password then has to wait");
ok(Math.max(...files(`${R}system/signin/`).map((f) => getJson(f).fails.length)) === 8, "all 8 are kept on file, so they outlast a restart");
await addUser(8, "patient@westsussex.gov.uk", "Pat Patient", 30, "member");
website.down = true;
let down = [];
for (let i = 0; i < 12; i++) down.push((await api("/api/login", { email: "patient@westsussex.gov.uk", password: "pw" })).status);
website.down = false;
ok(down.every((x) => x === 500), "while the website's database is down, sign-ins say so");
ok((await api("/api/login", { email: "patient@westsussex.gov.uk", password: "pw" })).status === 200, "and those tries don't count against the member afterwards");
await Promise.all(Array.from({ length: 7 }, () => api("/api/login", { email: "forgetful@westsussex.gov.uk", password: "guess" })));
ok((await api("/api/login", { email: "forgetful@westsussex.gov.uk", password: "pw" })).status === 200, "a member who gets it right within the limit signs in");
ok((await api("/api/login", { email: "forgetful@westsussex.gov.uk", password: "guess" })).status === 401, "and their count starts again");
r = await api("/api/status", {}, "not.a.token");
ok(r.status === 401, "a made-up token is refused");
r = await api("/api/status", {}, member);
ok(r.authorities.map((a) => a.name).join() === "West Sussex" && !r.spend, "a member sees their pilot, and no spending figures");
r = await api("/api/status", {}, other);
ok(r.authorities.length === 0, "a member outside the pilots sees none");
r = await api("/api/status", {}, boss);
ok(r.authorities.length === 3 && r.spend.cap === 40, "a site administrator (SITE_ADMINS) sees all three, and the spend");
for (const [path, body] of [["/api/authority", { code: WSX }], ["/api/reading/start", { code: WSX }], ["/api/note/list", { code: WSX }], ["/api/note/start", { code: WSX, text: "x" }], ["/api/note/get", { code: WSX, id: "20261102120000000-abcd1234" }], ["/api/facts/notes", { code: WSX, notes: "x" }]]) {
  ok((await api(path, body, kirk)).status === 403, `another authority's member is refused: ${path}`);
  ok((await api(path, body)).status === 401, `nobody signed in is refused: ${path}`);
}
ok((await api("/api/authority", { code: "E99999999" }, boss)).status === 403, "an unknown authority is refused");

// ---- what Clarion holds
r = await api("/api/authority", { code: WSX }, member);
const e = r.evidence, f = e.figures;
ok(r.status === 200 && f.authority.region === "South East", "evidence loads from the library");
const a = f.condition.find((x) => x.roadClass === "A");
ok(a && a.value === 3 && a.region === 4 && a.england === 6 && a.fye === 2026 && a.earlier.value === 2, "condition is compared with the region and England medians, using red roads only");
ok(f.condition.length === 3 && f.treatment.length === 2, "covers each road class");
ok(f.roadLength.km === 4000 && f.roadLength.year === 2024, "road length is the total for the latest year, whatever DfT's heading says");
ok(f.traffic.changePct === 6 && f.traffic.sinceYear === 2019 && f.traffic.year === 2025, "traffic change is measured from 2019, not from a pandemic year");
ok(f.seriousCollisions.length === 1 && f.seriousCollisions[0].count === 2, "collisions are totals of fatal and serious only");
ok(f.allocations.length === 3 && f.allocations.find((x) => x.pot === "Total").amount === 28303000, "allocations are for the first year only");
ok(f.unavailable.length === 0 && f.sources.some((s) => /Open Government Licence/.test(s.attribution)), "every figure was read, with its attribution");
ok(e.surveys[0].year === 2025 && e.surveys.some((s) => s.score === 24), "West Sussex's NHT results are there");
ok(e.signals.fixMyStreet.data.reports === 4 && !/Jane|Acacia/.test(JSON.stringify(r)), "signals are in, with no words from reports");
const p = e.signals.petitions.data;
ok(p.length === 1 && p[0].local === 400 && p[0].localShare === 4 && p[0].fairShare === 1.4, "a road petition is counted locally; an off-topic one isn't");
const q = e.signals.questions.data;
ok(q.length === 1 && /MP for Horsham \(Horsham\)/.test(q[0].member) && q[0].url.endsWith("/2026-10-01/12345"), "only this authority's MPs' questions on roads are kept");
ok(outside.hits.some((u) => /askingMemberId=501\b.*skip=100\b/.test(u)), "each local MP's questions are read page by page, so a busy MP's older ones are found");
ok(e.gaps.some((g) => /Fault report/.test(g)) && e.gaps.some((g) => /street survey/.test(g)), "gaps are listed");
ok(r.canEdit === false, "a member can't edit");
ok((await api("/api/authority", { code: WSX }, lead)).canEdit === true, "a lead can");
outside.down.add("www.fixmystreet.com");
r = await api("/api/authority", { code: LINCS }, boss);
ok(r.evidence.signals.fixMyStreet.ok === false && r.evidence.signals.fixMyStreet.note && r.evidence.signals.petitions.ok === true && r.evidence.figures.condition.length === 3, "a source that's down says so, and leaves the others standing");
ok(r.evidence.gaps[0] === "The 2025 NHT survey report" && r.evidence.gaps.some((g) => /FixMyStreet/.test(g)), "Lincolnshire's first gap is its NHT report, and the outage is listed");
outside.down.delete("www.fixmystreet.com");
ok((await api("/api/authority", { code: LINCS }, boss)).evidence.signals.fixMyStreet.ok === true, "and it comes back as soon as the source does, not hours later");
r = await api("/api/authority", { code: KIRK }, kirk);
ok(r.evidence.figures.allocations.length === 0 && /West Yorkshire/.test(r.authority.fundingRoute), "Kirklees shows its funding route, with no made-up allocation");
ok(r.evidence.figures.condition.find((x) => x.roadClass === "A").region === 8.5, "a region is compared even where the tables name it differently");


// ---- officers' additions
ok((await api("/api/facts/survey", { code: WSX, year: 2026, measure: "x", score: 5, source: "y" }, member)).status === 403, "a member can't add a survey result");
ok((await api("/api/facts/survey", { code: WSX, year: 2026, measure: "Roads", score: 500, source: "y" }, lead)).status === 400, "a score above the maximum is refused");
ok((await api("/api/facts/survey", { code: WSX, year: 2026, measure: "Roads", score: 50, source: "y", url: "javascript:alert(1)" }, lead)).status === 400, "a link that isn't https is refused");
r = await api("/api/facts/survey", { code: WSX, year: 2026, measure: "Residents' survey: roads", score: 44, outOf: 100, responses: 800, source: "Council survey" }, lead);
ok(r.ok === true, "a lead adds a survey result");
r = await api("/api/authority", { code: WSX }, member);
ok(r.evidence.surveys[0].year === 2026 && r.evidence.surveys[0].score === 44, "and it appears straight away, newest first");
await api("/api/facts/notes", { code: WSX, notes: "SECRET-CONTRACT ends March 2027" }, lead);
ok((await api("/api/authority", { code: WSX }, boss)).facts.notes.includes("SECRET-CONTRACT"), "notes are saved");
ok(!JSON.stringify(await api("/api/authority", { code: WSX }, member)).includes("SECRET-CONTRACT"), "and only editors are sent them");

// ---- a mood reading
const waitFor = (path, code, id) => until(async () => { const j = (await api(path, { code, id }, boss)); const o = j.reading || j.note; return o && o.status !== "working" ? o : null; }, path);
claude.calls.length = 0;
r = await api("/api/reading/start", { code: WSX }, member);
ok(r.reading.status === "working", "a reading starts in the background");
let read = await waitFor("/api/reading/get", WSX, r.reading.id);
ok(read.status === "ready" && /poorly/.test(read.headline), "and finishes");
ok(read.direction === "Not yet known" && /first reading/.test(read.directionNote), "a first reading reports no change, whatever Claude said");
ok(read.drivers.length === 1 && read.cost > 0, "drivers and cost are kept");
const prompt = claude.calls[0].prompt;
ok(/<evidence>/.test(prompt) && /data, not instructions/.test(prompt) && /SECRET-CONTRACT/.test(prompt), "the evidence goes to Claude as data, with the authority's own notes");
ok(!claude.calls[0].body.tools.some((t) => /^web_/.test(t.type || "")), "a reading has no web tools");
ok(/Report a change only when at least two different kinds/.test(claude.calls[0].sys) && /British English/.test(claude.calls[0].sys), "Claude gets the mood method and the house style");
ok(/signal held here are: survey, actions, representatives\./.test(prompt), "and is told which kinds of signal are really held");
ok(claude.calls[0].body.tools[0].strict === true && claude.calls[0].body.max_tokens >= 16000, "the finishing tool is strict, with room for thinking");
claude.script.submit_reading = () => ({ id: "m", type: "message", role: "assistant", stop_reason: "tool_use", usage: {}, content: [{ type: "tool_use", id: "t", name: "submit_reading", input: { headline: "Second", level: "L", level_basis: "B", direction: "Worsening", direction_kinds: ["actions", "representatives"], confidence: "Sure", confidence_reason: "", drivers: "nonsense", gaps: [], next_steps: [] } }] });
r = await api("/api/reading/start", { code: WSX }, member);
read = await waitFor("/api/reading/get", WSX, r.reading.id);
ok(read.direction === "Worsening" && read.confidence === "Low" && read.drivers.length === 0, "a later reading with two kinds of signal reports the change, and bad fields are made safe");
ok((await api("/api/authority", { code: WSX }, member)).reading.headline === "Second", "the page shows the newest reading");
delete claude.script.submit_reading;

// ---- when Claude doesn't hand in cleanly
const reply = (content, stop_reason) => ({ id: "m", type: "message", role: "assistant", stop_reason, usage: { input_tokens: 10, output_tokens: 10 }, content });
const lincsReading = async () => waitFor("/api/reading/get", LINCS, (await api("/api/reading/start", { code: LINCS }, boss)).reading.id);
claude.calls.length = 0;
let calls = 0;
claude.script.submit_reading = () => (calls++ === 0 ? reply([{ type: "tool_use", id: "t", name: "submit_reading", input: { headline: "Half a sent" } }], "max_tokens") : null);
read = await lincsReading();
ok(read.status === "ready" && /poorly/.test(read.headline), "an answer cut off part-way is thrown away, not used");
ok(claude.calls[1].body.max_tokens > claude.calls[0].body.max_tokens && claude.calls[1].body.messages.length === 1, "and is asked for again with more room");
claude.script.submit_reading = () => reply([], "max_tokens");
read = await lincsReading();
ok(read.status === "failed" && /too long/.test(read.error), "if it still runs out of room, the job says so");
claude.calls.length = 0;
calls = 0;
claude.script.submit_reading = () => (calls++ === 0 ? reply([{ type: "text", text: "Here is my reading." }], "end_turn") : null);
read = await lincsReading();
ok(read.status === "ready" && /submit_reading tool/.test(JSON.stringify(claude.calls[1].body.messages.at(-1))), "if Claude stops without handing in, it's asked to");
ok(claude.calls.every((x) => !x.body.tool_choice), "and is never forced to, which these models refuse");
claude.script.submit_reading = () => reply([{ type: "text", text: "Still talking." }], "end_turn");
read = await lincsReading();
ok(read.status === "failed" && /didn't finish/.test(read.error), "if it never does, the job stops rather than looping");
delete claude.script.submit_reading;
for (const [status, message, want] of [[400, "tool_choice is not supported for this model.", /couldn't do that/], [404, "model: nope", /recognise the model/]]) {
  claude.fail = status; claude.failMessage = message;
  read = await lincsReading();
  ok(read.status === "failed" && want.test(read.error), `a ${status} from Claude is described correctly`);
}
claude.fail = null; claude.failMessage = "nope";
claude.calls.length = 0;
claude.dropAfter = 1;
read = await lincsReading();
ok(read.status === "ready" && claude.calls.length === 2, "a reply that breaks off part-way is asked for again");
claude.script.submit_reading = () => reply([{ type: "tool_use", id: "t", name: "submit_reading", input: reading() }], "model_context_window_exceeded");
read = await lincsReading();
ok(read.status === "failed" && /too much/.test(read.error), "an answer stopped by the size of the conversation isn't used");
calls = 0;
claude.calls.length = 0;
claude.script.submit_reading = () => (calls++ === 0 ? reply([{ type: "thinking", thinking: "Mulling it over", signature: "sig-1" }], "end_turn") : null);
read = await lincsReading();
ok(read.status === "ready" && claude.calls[1].body.messages.length === 2, "a reply of nothing but thinking is dropped, not sent back");
delete claude.script.submit_reading;
claude.calls.length = 0;
claude.script.submit_reading = () => reply([{ type: "tool_use", id: "t", name: "submit_reading", input: reading({ drivers: [{ theme: "Held", evidence: "e", kind: "Actions" }, { theme: "Not held", evidence: "e", kind: "open talk" }] }) }], "tool_use");
read = await lincsReading();
ok(read.drivers.length === 1 && read.drivers[0].theme === "Held" && read.drivers[0].kind === "actions", "a driver from a kind of signal Clarion doesn't hold is dropped");
delete claude.script.submit_reading;

// ---- an impact note
claude.calls.length = 0;
const spentBefore = getJson(files(`${R}usage/`)[0]).usd;
let spentDuring = 0;
claude.script.submit_review = () => { spentDuring = getJson(files(`${R}usage/`)[0]).usd; return null; };
claude.script.submit_assessment = (body) => (body.messages.length === 3 ? reply([{ type: "thinking", thinking: "Now the sum", signature: "sig-2" }, { type: "tool_use", id: "calc", name: "calculate", input: { expression: "7583000 * 0.125" } }], "tool_use") : null);
r = await api("/api/note/start", { code: WSX, url: "https://www.gov.uk/government/news/record", title: "Record funding" }, lead);
ok(r.note.status === "working", "a note starts in the background");
const note = await waitFor("/api/note/get", WSX, r.note.id);
ok(note.status === "ready", `and finishes${note.error ? `: ${note.error}` : ""}`);
const step1 = claude.calls.filter((x) => x.body.tools.some((t) => t.name === "submit_change"));
const step2 = claude.calls.filter((x) => x.body.tools.some((t) => t.name === "submit_assessment"));
const step3 = claude.calls.filter((x) => x.body.tools.some((t) => t.name === "submit_review"));
ok(step1.length === 2 && step2.length === 3 && step3.length === 1, "three steps ran, carrying on after a paused search and through its tool calls");
const web = step1[0].body.tools.filter((t) => /^web_/.test(t.type || ""));
ok(web.length === 2 && web.every((t) => t.allowed_domains.includes("gov.uk") && !t.allowed_domains.includes("x.com")), "reading the announcement uses web tools limited to trusted sites");
const step1All = JSON.stringify(step1.map((x) => x.body));
ok(!/West Sussex|SECRET-CONTRACT|E10000032/.test(step1All), "the step that reads the web sees nothing about the authority");
ok([...step2, ...step3].every((x) => !x.body.tools.some((t) => /^web_/.test(t.type || ""))), "the steps that see private notes have no web tools");
ok(/SECRET-CONTRACT/.test(step2[0].prompt), "the assessment sees the authority's notes");
ok(step2[0].body.messages[0].content.includes("<announcement>") && /nine routes/.test(step2[0].sys), "and the announcement as data, with the method");
ok(step3[0].body.tools.length === 1, "the challenge has no tools at all");
ok(/<library_results_used>[\s\S]*20720000[\s\S]*<\/library_results_used>/.test(step3[0].prompt), "the challenge can see the figures behind the sums");
ok(!("sample" in note.dataUsed[0]) && !("sql" in note.dataUsed[0]), "those figures aren't kept in the note");
ok(spentDuring > spentBefore, "spending counts as a job runs, not just at the end");
const back = step2[2].body.messages[3].content;
ok(back[0].type === "thinking" && back[0].thinking === "Now the sum" && back[0].signature === "sig-2" && back[1].input.expression === "7583000 * 0.125", "a streamed reply goes back to Claude exactly as it came, thinking and all");
delete claude.script.submit_assessment;
ok(claude.calls.every((x) => x.body.tools.every((t) => !/^submit_/.test(t.name) || t.strict === true)), "every finishing tool is strict");
delete claude.script.submit_review;
ok(note.change.sources.length === 1 && note.change.sources[0].url === "https://www.gov.uk/government/news/record", "a source Claude never read doesn't appear");
ok(note.change.disagreements.length === 1, "disagreements between sources are kept");
ok(note.impacts.length === 2 && note.cut.length === 1 && /doesn't stand up/.test(note.cut[0].statement), "the challenge cut one claim");
ok(note.impacts[1].confidence === "Moderate" && note.impacts[1].challenge === "Too sure.", "and marked another down");
ok(note.impacts[1].checkDate > "2026-01-01", "a bad check date is replaced");
ok(note.dataUsed.length === 1 && note.dataUsed[0].sources.length === 1 && /Open Government/.test(note.dataUsed[0].sources[0].attribution), "data used is listed with its attribution");
ok(note.mood.gap === "Large" && note.mood.surveyQuestion.length > 0 && note.questions.length === 1 && note.unknowns.length === 2, "the mood forecast, questions and items to confirm are there");
const calc = step2[2].body.messages.at(-1).content[0];
ok(/947875/.test(calc.content), "the calculator's answer goes back to Claude");
const fc = getJson(`${R}authorities/${WSX}/forecasts.json`);
ok(fc.length === 2 && fc[0].noteId === note.id && fc[0].outcome === "" && fc[0].checkDate === "2026-12-01", "surviving impacts are logged as forecasts with check dates");
ok(files(`${R}usage/`).length === 1 && getJson(files(`${R}usage/`)[0]).usd > 0, "spending is recorded");
r = await api("/api/note/list", { code: WSX }, member);
ok(r.notes.length === 1 && r.notes[0].headline.includes("£0.95m"), "the note is listed");
ok((await api("/api/note/get", { code: WSX, id: "../../facts" }, boss)).status === 404, "a made-up id can't reach other files");

// ---- pasted text stays away from the web
claude.calls.length = 0;
r = await api("/api/note/start", { code: WSX, text: "PRIVATE-DRAFT of our bid for the Horsham scheme" }, lead);
const pasted = await waitFor("/api/note/get", WSX, r.note.id);
const pastedStep = claude.calls.filter((x) => x.body.tools.some((t) => t.name === "submit_change"));
ok(pasted.status === "ready" && pastedStep.length === 1 && pastedStep.every((x) => !x.body.tools.some((t) => /^web_/.test(t.type || ""))), "text pasted by an officer goes to a step with no web tools");
ok(pasted.change.primaryFound === false && pasted.change.sources.length === 0, "and the note doesn't claim to have checked the original");
ok(/no web access/.test(pastedStep[0].prompt), "Claude is told so");

// ---- running out of steps
claude.calls.length = 0;
claude.script.submit_assessment = (body) => {
  const last = body.messages.at(-1).content;
  if (Array.isArray(last) && last.some((b) => b.type === "text" && /submit_assessment tool/.test(b.text))) return null;
  return reply([{ type: "tool_use", id: `c${body.messages.length}`, name: "calculate", input: { expression: "1 + 1" } }], "tool_use");
};
r = await api("/api/note/start", { code: WSX, text: "Some text" }, lead);
let slow = await waitFor("/api/note/get", WSX, r.note.id);
delete claude.script.submit_assessment;
const nudged = claude.calls.filter((x) => x.body.tools.some((t) => t.name === "submit_assessment")).at(-1).body.messages.at(-1).content;
ok(slow.status === "ready" && nudged[0].type === "tool_result" && nudged.at(-1).type === "text", "a job running out of steps is told to hand in, after its tool results");

// ---- a daily limit for each authority
const stamp = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 17);
process.env.DAILY_JOBS_MAX = "2";
for (const n of [1, 2]) { const id = `${stamp}-0000000${n}`; putText(`${R}authorities/${KIRK}/notes/${id}.json`, JSON.stringify({ id, code: KIRK, status: "failed", stage: "Stopped", created: "2026-11-02T12:00:00Z", updated: "2026-11-02T12:00:00Z", by: "x", input: {}, impacts: [], cut: [] })); }
r = await api("/api/reading/start", { code: KIRK }, kirk);
ok(r.status === 429 && /Kirklees has reached today's limit of 2/.test(r.error), "an authority can't start more than the day's limit");
r = await api("/api/note/start", { code: KIRK, text: "x" }, kirk);
ok(r.status === 429, "and that counts notes as well as readings");
r = await api("/api/reading/start", { code: KIRK }, boss);
ok(r.status === 200 && r.reading.status === "working", "a site administrator isn't limited");
await waitFor("/api/reading/get", KIRK, r.reading.id);
delete process.env.DAILY_JOBS_MAX;

// ---- when things go wrong
claude.script.submit_change = () => ({ id: "m", type: "message", role: "assistant", stop_reason: "refusal", usage: {}, content: [] });
r = await api("/api/note/start", { code: WSX, text: "Some text" }, lead);
let bad = await waitFor("/api/note/get", WSX, r.note.id);
ok(bad.status === "failed" && /declined/.test(bad.error), "a refusal stops the note and says so");
delete claude.script.submit_change;
claude.fail = 401;
r = await api("/api/reading/start", { code: LINCS }, boss);
bad = await waitFor("/api/reading/get", LINCS, r.reading.id);
ok(bad.status === "failed" && /ANTHROPIC_API_KEY/.test(bad.error), "a bad Claude key is reported in plain words");
claude.fail = null;

const stuck = { id: "20261101120000000-abcd1234", code: WSX, status: "working", stage: "Testing", created: "2026-11-01T12:00:00Z", updated: "2026-11-01T12:00:00Z", by: "x", input: {}, impacts: [], cut: [] };
putText(`${R}authorities/${WSX}/notes/${stuck.id}.json`, JSON.stringify(stuck));
r = await api("/api/note/get", { code: WSX, id: stuck.id }, boss);
ok(r.note.status === "failed" && /interrupted/.test(r.note.error), "a job cut off by a restart shows as stopped");

putText(files(`${R}usage/`)[0], JSON.stringify({ usd: 40.5 }));
r = await api("/api/note/start", { code: WSX, text: "Some text" }, lead);
ok(r.status === 429 && /spending limit/.test(r.error), "the monthly cap stops new work");
putText(files(`${R}usage/`)[0], JSON.stringify({ usd: 1 }));

r = await api("/api/note/start", { code: WSX, url: "https://evil.example/x" }, lead);
ok(r.status === 400, "a link to an untrusted site is refused");


ok(claude.refused.length === 0, `nothing Clarion sent was refused by Claude${claude.refused.length ? `: ${claude.refused[0]}` : ""}`);

console.log(failures ? `\n${failures} FAILED` : "\nAll passed");
process.exit(failures ? 1 : 0);
