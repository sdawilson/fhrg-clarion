// Councillor briefings: the Word file, drafting, release and the election setting, through the API and on the page.
import fs from "node:fs";
import zlib from "node:zlib";
import { JSDOM } from "jsdom";
import { addUser, authorities, claude, files, getText, newsTopics, putText, slowStorage, until } from "./sim.mjs";
const { handleRequest } = await import("./.build/app.mjs");
const t = await import("./.build/internals.mjs");

let failures = 0;
const ok = (cond, what) => { console.log(`${cond ? "PASS" : "FAIL"}  ${what}`); if (!cond) failures++; };
const WSX = "E10000032", KIRK = "E08000034";

// ---- the Word file, read back the way a zip reader does
function unzip(bytes) {
  const b = Buffer.from(bytes), end = b.lastIndexOf(Buffer.from([0x50, 0x4b, 5, 6])), out = {};
  let at = b.readUInt32LE(end + 16);
  for (let i = 0; i < b.readUInt16LE(end + 10); i++) {
    const name = b.subarray(at + 46, at + 46 + b.readUInt16LE(at + 28)).toString(), start = b.readUInt32LE(at + 42), size = b.readUInt32LE(at + 24);
    const data = b.subarray(start + 30 + b.readUInt16LE(start + 26) + b.readUInt16LE(start + 28)).subarray(0, size);
    out[name] = { text: data.toString(), good: zlib.crc32(data) === b.readUInt32LE(at + 16) };
    at += 46 + b.readUInt16LE(at + 28) + b.readUInt16LE(at + 30) + b.readUInt16LE(at + 32);
  }
  return out;
}
let z = unzip(t.wordFile([{ kind: "title", text: "Roads & <paths>" }, { kind: "bullet", text: "Café \u{1F6A7}\u0007 line" }]));
ok(Object.keys(z).length === 5 && Object.values(z).every((f) => f.good), "a Word file holds its five parts, each intact");
ok(z["word/document.xml"].text.includes("Roads &amp; &lt;paths&gt;") && z["word/document.xml"].text.includes("Café \u{1F6A7} line"), "and text is made safe for it");

// ---- through the API
await addUser(1, "lead@westsussex.gov.uk", "Lee Lead", 30, "lead");
await addUser(2, "member@westsussex.gov.uk", "Mo Member", 30, "member");
await addUser(3, "kit@kirklees.gov.uk", "Kit Officer", 20, "lead");
await addUser(4, "boss@fhrg.test", "Bo Boss", 99, "member", 1);
await addUser(5, "ivy@westsussex.gov.uk", "Ivy Admin", 30, "member", 1);
await addUser(6, "nameless@westsussex.gov.uk", "", 30, "lead");
authorities.push({ id: 31, name: "West Sussex Council", status: "approved" }); // loosely the same, but another body
await addUser(7, "near@westsussex.example", "Nia Near", 31, "lead");
newsTopics.push("Parking", "Pavements");
const api = async (path, body, token) => { const res = await handleRequest(new Request(`https://clarion.test${path}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { "x-session-token": token } : {}) }, body: JSON.stringify(body) })); return Object.assign(await res.json(), { status: res.status }); };
const login = async (email) => (await api("/api/login", { email, password: "pw" })).token;
const lead = await login("lead@westsussex.gov.uk"), member = await login("member@westsussex.gov.uk"), kit = await login("kit@kirklees.gov.uk"), boss = await login("boss@fhrg.test"), ivy = await login("ivy@westsussex.gov.uk"), nameless = await login("nameless@westsussex.gov.uk"), near = await login("near@westsussex.example");

const DRAFT = { summary: "Satisfaction has fallen.\nPotholes come first.", how_residents_feel: "Less satisfied, on the survey.", why_it_matters_here: "New money raises hopes.", likely_questions: [{ question: "Are roads worse?", answer: "ANSWER-ONE from the survey." }, { question: "When?", answer: "ANSWER-TWO not yet known." }], factual_lines: ["LINE-ONE of two.", "LINE-TWO of two."] };
claude.script.submit_briefing = (body) => ({ id: "m", type: "message", role: "assistant", model: "x", stop_reason: "tool_use", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: "tool_use", id: "t1", name: "submit_briefing", input: body.tools[0].input_schema.properties.factual_lines ? DRAFT : { ...DRAFT, likely_questions: DRAFT.likely_questions.map(({ question }) => ({ question })), factual_lines: undefined } }] });
const write = async (token = lead, code = WSX) => {
  const r = await api("/api/briefing/start", { code }, token);
  await until(async () => (await api("/api/briefing/get", { code, id: r.briefing.id }, token)).briefing?.status !== "working", "the briefing to finish");
  return (await api("/api/briefing/get", { code, id: r.briefing.id }, token)).briefing;
};
const form = (x, more = {}) => ({ code: WSX, id: x.id, updated: x.updated, hidden: false, title: x.title, summary: x.summary, feel: x.feel, matters: x.matters, questions: x.questions, lines: x.lines, ...more });
const stored = (x) => JSON.parse(getText(files(`clarion/authorities/${WSX}/briefings/`).find((f) => f.includes(x.id))));

// ---- what Claude is given, with real material held
await api("/api/facts/notes", { code: WSX, notes: "PRIVATE-NOTE about a named cabinet member" }, lead);
await api("/api/facts/survey", { code: WSX, year: 2026, measure: "Roads", score: 44, outOf: 100, responses: 800, source: "Council survey" }, lead);
const OFFICER_WORDS = "Officer's own words about the piece";
const paper = (await api("/api/coverage/source", { code: WSX, name: "A paper", type: "Local Newspaper", reach: 5000 }, lead)).source;
for (const [topic, n] of [["Potholes", 3], ["Road safety", 2], ["Parking", 1]]) for (let i = 0; i < n; i++) await api("/api/coverage/assess", { code: WSX, source: paper.id, date: new Date(Date.now() - (2 + i) * 86400000).toISOString().slice(0, 10), summary: OFFICER_WORDS, topic, relevance: "High", tone: "Critical", prominence: "Inside page" }, lead);
const lastMonth = (() => { const m = new Date(); m.setUTCDate(15); m.setUTCMonth(m.getUTCMonth() - 1); return m.toISOString().slice(0, 7); })();
await api("/api/enquiries/import", { code: WSX, file: "new.csv", rows: 971, months: { [lastMonth]: { categories: { "Street lights": [500, 20], Pavements: [400, 30], "Road defects": [20, 1] }, areas: {}, routes: {} } } }, lead);
const signs = await api("/api/attention", { code: WSX }, lead);
ok(signs.ready && signs.earlySigns.length > 0, "there are early signs and assessments to keep out");
const reading = (await api("/api/reading/start", { code: WSX }, lead)).reading;
await until(async () => (await api("/api/reading/get", { code: WSX, id: reading.id }, lead)).reading?.status !== "working", "the reading");
const heard = (await api("/api/authority", { code: WSX }, lead)).evidence.signals;
ok(heard.questions.data.length > 0 && heard.petitions.data.length > 0, "there are MPs' questions and petitions to keep out");
ok((await api("/api/briefing/start", { code: WSX }, kit)).status === 403, "another authority can't write a briefing here");
let before = claude.calls.length;
const one = await write();
const call = claude.calls[before];
ok(one.status === "ready" && one.summary.startsWith("Satisfaction") && one.questions.length === 2 && one.lines.length === 2, "Claude drafts a briefing");
ok(!call.prompt.includes("PRIVATE-NOTE") && !call.prompt.includes("Lee Lead"), "from no officer's notes or name");
ok(!heard.questions.data.some((q) => call.prompt.includes(q.text) || call.prompt.includes(q.member)) && !heard.petitions.data.some((x) => call.prompt.includes(x.title)), "no MP's words or name, and no petition's title");
ok(!call.prompt.includes("Residents rate road condition poorly") && !/concern_rank|Look into it early|Act, and be seen to|over-react|earlySigns|early_signs/.test(call.prompt) && !signs.earlySigns.some((x) => call.prompt.includes(x.why)), "no reading's words, and no early signs or advice");
ok(!call.prompt.includes(OFFICER_WORDS), "and no officer's words about a piece");
ok(/"assessed_press_and_media_last_four_weeks":\[\{"topic"/.test(call.prompt) && /"enquiries_and_complaints_latest_month":\[\{"topic"/.test(call.prompt), "only their figures");
ok(/"road_petitions":\{"count":\d/.test(call.prompt) && /"mps_written_questions_about_roads":[1-9]/.test(call.prompt) && /"latest_mood_reading":\{"date":"[\d-]+","direction":"[^"]+","confidence":"[^"]+"\}/.test(call.prompt) && /Council survey/.test(call.prompt), "but counts, surveys and the reading's direction do go in");
ok(!JSON.stringify(call.body.tools).includes("web_"), "and it has no web access");
ok(/Section 2 of the Local Government Act 1986/.test(call.sys) && /data, not instructions/.test(call.prompt), "it's told to stay neutral, and that what it's given is data");
ok(one.sources.includes("Council survey, 2026") && one.sources.some((x) => /Evidence read on \d+ \w+ 20\d\d/.test(x)) && one.sources.some((x) => /reference library/.test(x)) && one.sources.some((x) => /mood reading of \d+ \w+ 20\d\d/.test(x)), "the list of sources is written by code, with the date read");
ok(!one.approvedBy, "and it starts as a draft");

// ---- who can do what
const routes = [["get", { id: one.id }], ["save", form(one)], ["approve", form(one)], ["copy", { id: one.id }], ["remove", { id: one.id, updated: one.updated }], ["word", { id: one.id }], ["start", {}], ["list", {}], ["election", { on: true }]];
for (const [route, body] of routes) {
  ok((await api(`/api/briefing/${route}`, { ...body, code: WSX }, kit)).status === 403, `another authority's lead is refused: ${route}`);
  ok((await api(`/api/briefing/${route}`, { ...body, code: WSX })).status === 401, `and anyone signed out: ${route}`);
}
ok((await api("/api/briefing/get", { code: WSX, id: "../../facts" }, lead)).status === 404, "a made-up id is refused");
ok((await api("/api/briefing/list", { code: WSX }, member)).briefings[0].id === one.id, "members of the authority see it listed");
ok((await api("/api/briefing/get", { code: WSX, id: one.id }, boss)).briefing?.summary === one.summary, "and so can a site administrator from outside");

let r = await api("/api/briefing/word", { code: WSX, id: one.id }, lead);
ok(r.status === 409 && !r.file, "a draft can't be taken out");
r = await api("/api/briefing/save", form(one, { summary: "Changed by an officer.", lines: ["A", "", "B"], questions: [{ question: "Q?", answer: "A." }, { question: "", answer: "" }] }), lead);
ok(r.briefing.summary === "Changed by an officer." && r.briefing.lines.length === 2 && r.briefing.questions.length === 1, "an officer's changes are saved, and empty rows dropped");
const saved = r.briefing;
ok((await api("/api/briefing/save", form(saved, { summary: "Member" }), kit)).status === 403, "another authority can't change it");
ok(/title/.test((await api("/api/briefing/save", form(saved, { title: "  " }), lead)).error), "it has to keep a title");
ok(/needs its question/.test((await api("/api/briefing/save", form(saved, { questions: [{ question: "", answer: "An answer on its own" }] }), lead)).error), "and an answer can't quietly go with an emptied question");
r = await api("/api/briefing/save", form(one, { summary: "From an older page" }), lead);
ok(r.status === 409 && /changed since/.test(r.error) && stored(one).summary === "Changed by an officer.", "saving from an older page doesn't overwrite a newer edit");

r = await api("/api/briefing/approve", form(saved), boss);
ok(r.status === 403 && /named officer/.test(r.error), "a site administrator from outside can't release it");
ok((await api("/api/briefing/approve", form(saved), ivy)).status === 403, "nor can a site administrator at the authority who isn't a lead");
ok((await api("/api/briefing/approve", form(saved), member)).status === 403, "nor a member who isn't a lead");
ok((await api("/api/briefing/get", { code: WSX, id: one.id }, near)).briefing?.id === one.id, "a lead whose authority's name is merely like this one can read it, as other pages let them");
ok((await api("/api/briefing/approve", form(saved), near)).status === 403, "but can't release it");
r = await api("/api/briefing/approve", form(saved), nameless);
ok(r.status === 403 && /no name/.test(r.error), "nor a lead with no name on their account");
ok(/summary/.test((await api("/api/briefing/approve", form(saved, { summary: "  " }), lead)).error) && stored(one).summary === "Changed by an officer.", "an empty briefing can't be released");

const seen = (await api("/api/briefing/save", form(saved, { summary: "As the lead read it." }), lead)).briefing;
await api("/api/briefing/save", form(seen, { summary: "Slipped in by someone else." }), boss);
r = await api("/api/briefing/approve", form(seen), lead);
ok(r.status === 409 && !stored(one).approvedBy, "nobody can release a version they haven't seen");
const latest = (await api("/api/briefing/get", { code: WSX, id: one.id }, lead)).briefing;
r = await api("/api/briefing/approve", form(latest, { summary: "What the lead released." }), lead);
ok(r.briefing.approvedBy === "Lee Lead" && /^20\d\d-\d\d-\d\d$/.test(r.briefing.approvedOn) && r.briefing.summary === "What the lead released.", "a lead of the authority releases what's on their page, under their name");
const out = r.briefing;
ok((await api("/api/briefing/save", form(out, { summary: "Later" }), lead)).status === 409 && (await api("/api/briefing/approve", form(out), lead)).status === 409 && (await api("/api/briefing/remove", { code: WSX, id: one.id, updated: out.updated }, lead)).status === 409, "what's released stays as it was, and on record");

const raced = await write();
slowStorage.ms = 40; // so the delete reads the briefing just before the release lands
const releasing = api("/api/briefing/approve", form(raced), lead);
await new Promise((done) => setTimeout(done, 60));
const gone = await api("/api/briefing/remove", { code: WSX, id: raced.id, updated: raced.updated }, lead);
const kept = await releasing;
slowStorage.ms = 0;
ok(kept.briefing?.approvedBy && gone.status === 409 && stored(raced).approvedBy, "deleting while releasing can't lose a released briefing");
const staleDelete = await write();
await api("/api/briefing/save", form(staleDelete, { summary: "A colleague's work" }), lead);
ok((await api("/api/briefing/remove", { code: WSX, id: staleDelete.id, updated: staleDelete.updated }, lead)).status === 409 && stored(staleDelete).summary === "A colleague's work", "and a page that's out of date can't delete a colleague's work");

r = await api("/api/briefing/word", { code: WSX, id: one.id }, member);
const words = (reply) => unzip(Buffer.from(reply.file, "base64"))["word/document.xml"].text;
let doc = words(r);
ok(/^west-sussex.*\.docx$/.test(r.name), "it comes out as a Word file");
ok(doc.includes("Released by Lee Lead on") && doc.includes("What the lead released.") && doc.includes("Evidence read on") && doc.includes("Factual lines"), "with who released it, what it says and its sources");

r = await api("/api/briefing/copy", { code: WSX, id: one.id }, lead);
ok(r.briefing.id !== one.id && !r.briefing.approvedBy && r.briefing.summary === "What the lead released." && r.briefing.by === "Lee Lead", "a new draft can start from it");
const copy = r.briefing;
r = await api("/api/briefing/remove", { code: WSX, id: copy.id, updated: copy.updated }, lead);
ok(r.ok && !(await api("/api/briefing/list", { code: WSX }, lead)).briefings.some((x) => x.id === copy.id), "and a draft can be deleted");

// ---- the election setting
ok((await api("/api/briefing/election", { code: WSX, on: true }, member)).status === 403, "a member can't set the election setting");
ok((await api("/api/briefing/election", { code: WSX, on: true }, boss)).status === 403, "nor a site administrator from outside");
ok((await api("/api/briefing/election", { code: WSX, on: true }, ivy)).status === 403, "nor one at the authority who isn't a lead");
ok((await api("/api/briefing/election", { code: WSX, on: true }, near)).status === 403, "nor a lead of a body with a similar name");
ok((await api("/api/works/on", { code: WSX }, near)).status !== 200, "who can't turn on Works and weather either");
ok((await api("/api/briefing/election", { code: WSX }, lead)).status === 400, "and it has to be told on or off");
const draft = await write(), oldForm = await write();
const beforeDoc = await write();
await api("/api/briefing/approve", form(beforeDoc), lead);
const survey = (await api("/api/survey/new", { code: WSX, title: "Autumn", purpose: "How people feel." }, lead)).survey;
await api("/api/survey/save", { code: WSX, id: survey.id, title: "Autumn", purpose: "How people feel.", collector: "West Sussex", sites: "High Street" }, lead);
const opened = (await api("/api/survey/status", { code: WSX, id: survey.id, status: "open" }, lead)).survey;
const answer = { client: "c1", site: "High Street", secs: 60, answers: { c1: "Fairly satisfied" } };
ok(opened?.status === "open" && (await api("/api/s/get", { access: opened.access })).survey?.title === "Autumn", "before it's on, a survey opens and tablets can reach it");
const finished = (await api("/api/survey/new", { code: WSX, title: "Summer", purpose: "How people felt." }, lead)).survey;
await api("/api/survey/status", { code: WSX, id: finished.id, status: "open" }, lead);
await api("/api/survey/status", { code: WSX, id: finished.id, status: "closed" }, lead);
const unopened = (await api("/api/survey/new", { code: WSX, title: "Winter", purpose: "How people feel." }, lead)).survey;
r = await api("/api/briefing/election", { code: WSX, on: true }, lead);
ok(r.election.on && r.election.by === "Lee Lead", "a lead turns the election setting on");

r = await api("/api/briefing/get", { code: WSX, id: draft.id }, lead);
ok(r.briefing.lines.length === 0 && r.briefing.questions.every((q) => q.answer === "") && r.briefing.questions.length === 2 && /Pre-election/.test(r.briefing.electionNote), "older briefings lose their lines and suggested answers on screen");
const during = r.briefing;
doc = words(await api("/api/briefing/word", { code: WSX, id: beforeDoc.id }, lead));
ok(!doc.includes("Factual lines") && !doc.includes("LINE-ONE") && !doc.includes("ANSWER-ONE") && doc.includes("Are roads worse?") && doc.includes("Pre-election period"), "and in a Word copy, even one released before");
r = await api("/api/briefing/copy", { code: WSX, id: beforeDoc.id }, lead);
ok(r.briefing.lines.length === 0 && stored(r.briefing).lines.length === 0 && stored(r.briefing).questions.every((q) => q.answer === ""), "and in a copy, for good");

r = await api("/api/briefing/save", form(oldForm, { summary: "From before the period", lines: ["Sneaked in"] }), lead);
ok(r.status === 409 && /setting has changed/.test(r.error), "a page opened before the period can't save into it");
r = await api("/api/briefing/save", form(during, { hidden: true, title: "Edited", summary: "During", questions: [{ question: "Are roads worse?", answer: "Sneaked in" }, { question: "A different question?", answer: "Sneaked in" }], lines: ["Sneaked in"] }), lead);
let held = stored(draft);
ok(r.briefing.lines.length === 0 && held.lines.length === 2 && held.questions[0].answer === "ANSWER-ONE from the survey." && held.summary === "During", "an edit during the period can't add lines, and doesn't lose the hidden ones");
ok(held.questions[1].question === "A different question?" && held.questions[1].answer === "", "but an answer doesn't stay with a question that's been rewritten");
const trimmed = await write();
const trimmedPage = (await api("/api/briefing/get", { code: WSX, id: trimmed.id }, lead)).briefing;
r = await api("/api/briefing/approve", form(trimmedPage, { hidden: true, questions: [{ question: "", answer: "" }, { question: trimmedPage.questions[1].question, answer: "" }] }), lead);
ok(r.briefing.questions.length === 1 && r.briefing.questions[0].question === "When?", "a question emptied during the period comes out of what's released");

let tool;
const scripted = claude.script.submit_briefing;
claude.script.submit_briefing = (body) => { tool = body.tools[0]; return scripted(body); };
before = claude.calls.length;
const newDuring = await write();
ok(!tool.input_schema.properties.factual_lines && !tool.input_schema.properties.likely_questions.items.properties.answer && /pre-election/.test(claude.calls[before].prompt) && newDuring.lines.length === 0, "a new briefing asks Claude for neither");

const pageDuring = (await api("/api/briefing/get", { code: WSX, id: draft.id }, lead)).briefing;
await api("/api/briefing/election", { code: WSX, on: false }, lead);
r = await api("/api/briefing/save", form(pageDuring, { hidden: true, summary: "After", questions: pageDuring.questions, lines: [] }), lead);
held = stored(draft);
ok(r.status === 409 && held.lines.length === 2 && held.questions[0].answer === "ANSWER-ONE from the survey.", "a page opened during the period can't wipe the hidden text after it");
await api("/api/briefing/election", { code: WSX, on: true }, lead);
await api("/api/briefing/approve", form(pageDuring, { hidden: true }), lead);
await api("/api/briefing/election", { code: WSX, on: false }, lead);
r = await api("/api/briefing/get", { code: WSX, id: draft.id }, lead);
ok(r.briefing.lines.length === 0 && r.briefing.questions.every((q) => q.answer === ""), "lines hidden when one was released don't come back afterwards");
r = await api("/api/briefing/get", { code: WSX, id: beforeDoc.id }, lead);
ok(r.briefing.lines.length === 2, "and one released before the period is whole again after it");

// fieldwork
await api("/api/briefing/election", { code: WSX, on: true }, lead);
ok((await api("/api/briefing/list", { code: KIRK }, kit)).election.on === false, "another authority's setting is left alone");
for (const [path, body, what] of [["/api/s/get", { access: opened.access }, "open a survey on a tablet"], ["/api/s/submit", { access: opened.access, forms: [answer] }, "send forms from a tablet"],
  ["/api/survey/answers", { code: WSX, id: survey.id, forms: [{ form: "1", answers: { c1: "Fairly satisfied" } }] }, "type in paper forms"], ["/api/survey/csv", { code: WSX, id: survey.id, csv: "form,c1\n1,Fairly satisfied\n" }, "upload a file of forms"],
  ["/api/survey/scan", { code: WSX, id: survey.id, files: [] }, "read a scan"], ["/api/survey/status", { code: WSX, id: survey.id, status: "draft" }, "take a survey back to a draft, which would strand tablets' forms"]]) {
  r = await api(path, body, path.startsWith("/api/s/") ? undefined : lead);
  ok(r.status === 409 && /paused/.test(r.error), `during the period nobody can ${what}`);
}
ok((await api("/api/survey/get", { code: WSX, id: survey.id }, lead)).results.total === 0, "so no answers arrive");
r = await api("/api/survey/status", { code: WSX, id: finished.id, status: "open" }, lead);
ok(r.status === 409 && /paused/.test(r.error) && (await api("/api/survey/status", { code: WSX, id: unopened.id, status: "open" }, lead)).status === 409, "and no survey can be opened");
ok((await api("/api/survey/list", { code: WSX }, member)).paused === true && (await api("/api/survey/get", { code: WSX, id: survey.id }, lead)).paused === true, "and the survey pages say so");

// the limit
const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
for (let i = 0; i < 20; i++) putText(`clarion/authorities/${KIRK}/briefings/${today}0000${String(i).padStart(5, "0")}-0000000${(i % 10)}.json`, "{}");
r = await api("/api/briefing/start", { code: KIRK }, kit);
ok(r.status === 429 && /briefings/.test(r.error), "briefings count towards an authority's daily limit");

// ---- the pages
const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8"), tabletHtml = fs.readFileSync(new URL("../public/survey.html", import.meta.url), "utf8");
function browser(page, address, setup) {
  return new JSDOM(page, {
    url: `https://clarion.test/${address}`, runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(w) {
      setup?.(w);
      w.scrollTo = () => {};
      w.print = () => { w.printed = w.document.querySelector(".main")?.textContent ?? ""; };
      w.URL.createObjectURL = (blob) => { w.saved = blob; return "blob:x"; };
      w.URL.revokeObjectURL = () => {};
      w.fetch = async (url, opts = {}) => { const res = await handleRequest(new Request(new URL(url, "https://clarion.test").href, opts)); const text = await res.text(); return { ok: res.ok, status: res.status, json: async () => JSON.parse(text) }; };
    },
  }).window.document;
}
async function open(token, hash, path = "") {
  const d = browser(html, `${path}${hash}`, (w) => w.localStorage.setItem("clarion_token", token));
  await until(() => d.querySelector(".main .page > *"), "the page to start");
  return d;
}
const text = (el) => el.textContent.replace(/\s+/g, " ");
const see = (d, pattern) => until(() => pattern.test(text(d.querySelector(".main"))), `the page to show ${pattern}`);
const button = (d, words) => [...d.querySelectorAll("button")].find((b) => b.textContent.trim() === words);

// surveys while the setting is on, on the officer's page and the tablet
let d = await open(lead, `#survey/${WSX}/${survey.id}/collect`);
await see(d, /Answers so far/);
let main = text(d.querySelector(".main"));
ok(/Street surveys are paused/.test(main) && !/Prepare forms to print/.test(main) && !button(d, "Back to draft") && !d.querySelector('.main input[aria-label="Form number"]'), "the survey page offers no way of adding forms during the period");
ok(main.includes(`/s/${opened.access}`) && button(d, "Close the survey") && /press Try again at least once a week/.test(main), "but keeps the link for reaching forms on tablets, and can still close");
d = await open(lead, `#survey/${WSX}/${unopened.id}/collect`);
await see(d, /can't be opened until the pause ends/);
ok(!button(d, "Open the survey"), "a survey not yet opened can't be");
d = await open(lead, `#survey/${WSX}/${finished.id}/collect`);
await see(d, /can't be opened again until the pause ends/);
ok(!button(d, "Open it again"), "nor one that's closed");
d = await open(lead, `#print/${WSX}/${survey.id}/1/10`);
await see(d, /Street surveys are paused/);
ok(!d.querySelector(".sheet"), "and forms can't be printed");
d = await open(lead, `#surveys/${WSX}`);
await see(d, /Street surveys are paused/);
ok(/Surveys so far/.test(text(d.querySelector(".main"))), "and the list of surveys says so");

const empty = browser(tabletHtml, `s/${opened.access}`, (w) => { w.SEND_EVERY_MS = 25; });
await until(() => /This survey is paused/.test(text(empty.getElementById("app"))), "an empty tablet to say it's paused");
const waiting = [{ client: "tablet-1", site: "High Street", secs: 60, answers: { c1: "Fairly satisfied" } }];
const tablet = browser(tabletHtml, `s/${opened.access}`, (w) => { w.SEND_EVERY_MS = 25; w.localStorage.setItem(`clarion_queue_${opened.access}`, JSON.stringify(waiting)); });
await until(() => /This survey is paused/.test(text(tablet.getElementById("app"))), "the tablet to say it's paused");
ok(/1 form is still on this tablet/.test(text(tablet.getElementById("app"))) && /press Try again at least once a week/.test(text(tablet.getElementById("app"))), "a tablet keeps its forms through a pause, and says so");
const onTablet = () => tablet.defaultView.localStorage.getItem(`clarion_queue_${opened.access}`);
ok(onTablet().includes("tablet-1"), "and they're still there");
await api("/api/briefing/election", { code: WSX, on: false }, lead);
await until(() => /Ready for the next person/.test(text(tablet.getElementById("app"))), "the tablet to carry on by itself");
await until(() => onTablet() === "[]", "the form to send");
ok((await api("/api/survey/get", { code: WSX, id: survey.id }, lead)).results.total === 1, "and they send when the pause ends");
[...empty.querySelectorAll("button")].find((b) => b.textContent === "Try again").click();
await until(() => /Ready for the next person|paused/.test(text(empty.getElementById("app"))), "the empty tablet to answer");
ok(/Ready for the next person/.test(text(empty.getElementById("app"))), "a tablet with nothing waiting can try again too");

// briefings
const members = (d) => button(d, "For members").click();
d = await open(lead, `#briefings/${WSX}`);
await until(() => button(d, "For members"), "the choice of briefing");
members(d);
await see(d, /Briefings so far/);
main = text(d.querySelector(".main"));
ok(button(d, "Write a briefing") && button(d, "Turn this on") && /Released/.test(main) && /Draft/.test(main), "a lead sees the list, and can write one and set the election setting");
ok([...d.querySelectorAll(".rail .nav button")].some((b) => b.textContent === "Briefings"), "it has its place in the menu");
d = await open(boss, `#briefings/${WSX}`);
await until(() => button(d, "For members"), "the choice of briefing");
members(d);
await see(d, /Briefings so far/);
ok(button(d, "Write a briefing") && !button(d, "Turn this on"), "a site administrator can write one, but the setting is the authority's");
d = await open(member, `#briefings/${WSX}`);
await until(() => button(d, "For members"), "the choice of briefing");
members(d);
await see(d, /Briefings so far/);
ok(button(d, "Write a briefing") && !button(d, "Turn this on"), "a member of the authority can write one, but the election setting stays with its lead");

const page = await write();
d = await open(lead, `#briefing/${WSX}/${page.id}`);
await see(d, /Release this briefing/);
const boxes = [...d.querySelectorAll(".main textarea")];
ok(boxes.length === 7 && boxes[0].value.startsWith("Satisfaction") && d.querySelector(".main input").value.includes("councillor briefing"), "a draft opens ready to edit");
ok(!button(d, "Take as Word") && !button(d, "Print or save as PDF"), "and it can't be taken out yet");
ok(/Draft, not released/.test(d.querySelector(".print-only").textContent), "and printing it from the browser says it's a draft");
button(d, "Add a line").click();
ok(d.querySelectorAll(".main textarea").length === boxes.length + 1, "lines can be added");
button(d, "Add a line").click(); button(d, "Add a line").click(); button(d, "Add a line").click();
ok(button(d, "Add a line").disabled, "up to the most that will be kept");
button(d, "Save changes").click();
button(d, "Release this briefing").click();
await see(d, /Saved\./);
ok(!/has changed since/.test(text(d.querySelector(".main"))) && !stored(page).approvedBy, "pressing Release while Save is running does no harm");
d.querySelectorAll(".main textarea")[0].value = "Edited on the page.";
button(d, "Save changes").click();
await see(d, /Saved\./);
d.querySelectorAll(".main textarea")[0].value = "Edited again on the page.";
button(d, "Save changes").click();
await until(async () => stored(page).summary === "Edited again on the page.", "the second save");
await api("/api/briefing/save", form({ ...stored(page), summary: "A colleague's change." }), lead);
button(d, "Release this briefing").click();
await see(d, /has changed since this page was opened/);
ok(!/Saved\./.test(text(d.querySelector(".main"))) && !stored(page).approvedBy, "a stale page says so, and releases nothing");
d = await open(lead, `#briefing/${WSX}/${page.id}`);
await see(d, /Release this briefing/);
d.querySelectorAll(".main textarea")[0].value = "Released from the page.";
button(d, "Release this briefing").click();
await see(d, /Released by Lee Lead/);
const released = (await api("/api/briefing/get", { code: WSX, id: page.id }, lead)).briefing;
ok(released.summary === "Released from the page." && released.lines.length === 2, "releasing keeps what's on the page");
ok(button(d, "Take as Word") && button(d, "Print or save as PDF") && !d.querySelector(".main textarea"), "and a released briefing reads as a document");
button(d, "Take as Word").click();
await until(() => d.defaultView.saved, "the file to be saved");
ok(d.defaultView.saved.type.includes("wordprocessingml"), "Word is saved as a Word file");
button(d, "Print or save as PDF").click();
await until(() => d.defaultView.printed, "the page to print");
ok(d.defaultView.printed.includes("LINE-ONE"), "PDF goes through printing");
d.defaultView.printed = null;
await api("/api/briefing/election", { code: WSX, on: true }, lead);
button(d, "Print or save as PDF").click();
await until(() => d.defaultView.printed, "the page to print again");
ok(!d.defaultView.printed.includes("LINE-ONE") && !d.defaultView.printed.includes("ANSWER-ONE"), "a page left open prints without lines once the setting is on");
await api("/api/briefing/election", { code: WSX, on: false }, lead);
d = await open(lead, `#briefing/${WSX}/${page.id}`);
await see(d, /Start a new draft from this/);
const draftsBefore = files(`clarion/authorities/${WSX}/briefings/`).length;
slowStorage.ms = 5;
const again = button(d, "Start a new draft from this");
again.click(); again.dispatchEvent(new d.defaultView.MouseEvent("click", { bubbles: true }));
await see(d, /Save changes/);
slowStorage.ms = 0;
ok(!text(d.querySelector(".main")).includes("Released by"), "a new draft opens for editing");
ok(files(`clarion/authorities/${WSX}/briefings/`).length === draftsBefore + 1 && stored(page).approvedBy, "just one, however often it's clicked, and the released one stays as it was");

claude.fail = 400;
const failed = (await api("/api/briefing/start", { code: WSX }, lead)).briefing;
await until(async () => (await api("/api/briefing/get", { code: WSX, id: failed.id }, lead)).briefing.status === "failed", "the briefing to fail");
claude.fail = null;
d = await open(lead, `#briefing/${WSX}/${failed.id}`);
await see(d, /Delete this draft/);
button(d, "Delete this draft").click();
await until(() => /Briefings so far/.test(text(d.querySelector(".main"))), "the list again");
ok(!files(`clarion/authorities/${WSX}/briefings/`).some((f) => f.includes(failed.id)), "a draft that stopped can be deleted");

await api("/api/briefing/election", { code: WSX, on: true }, lead);
d = await open(lead, `#briefing/${WSX}/${(await write()).id}`);
await see(d, /hidden, and won't be in what's released/);
ok(!button(d, "Add a line") && !button(d, "Add a question") && !text(d.querySelector(".main")).includes("Factual answer"), "during the period the form asks for neither lines nor answers");
d.querySelectorAll(".main textarea")[0].value = "Saved during the period.";
button(d, "Save changes").click();
await see(d, /Saved\./);
button(d, "Release this briefing").click();
await see(d, /Released by Lee Lead/);
ok(/Saved during the period\./.test(text(d.querySelector(".main"))), "and saving and releasing from it work");
await api("/api/briefing/election", { code: WSX, on: false }, lead);

// the demonstration
const pack = t.buildPack(), packed = (x) => unzip(Buffer.from(x.file, "base64"))["word/document.xml"].text;
ok(packed(pack.briefingWord).includes("Northbridge") && packed(pack.briefingWord).includes("Factual lines") && !packed(pack.briefingWordElection).includes("Factual lines"), "the demonstration's Word files are real, made by the same code");
d = await open("", "#briefings/NORTHBRIDGE", "demo");
await until(() => button(d, "For members"), "the choice of briefing");
members(d);
await see(d, /Briefings so far/);
ok(/northbridge/i.test(d.querySelector(".main .note-row a").textContent), "the demonstration has a briefing");
const beforeDemo = claude.calls.length;
button(d, "Turn this on").click();
await see(d, /Pre-election period/);
d.querySelector(".main .note-row a").click();
d.defaultView.location.hash = d.querySelector(".main .note-row a").getAttribute("href");
await see(d, /Release this briefing/);
button(d, "Release this briefing").click();
await see(d, /Released by Demo officer/);
d.defaultView.location.hash = "#briefings/NORTHBRIDGE";
await see(d, /Turn this off/);
button(d, "Turn this off").click();
await see(d, /Turned off/);
d.defaultView.location.hash = d.querySelector(".main .note-row a").getAttribute("href");
await see(d, /Take as Word/);
ok(!/Factual lines/.test(text(d.querySelector(".main"))), "released during the period, the demonstration's lines stay out");
button(d, "Take as Word").click();
await until(() => d.defaultView.saved, "the demonstration's file");
ok(d.defaultView.saved.size === Buffer.from(pack.briefingWordElection.file, "base64").length && claude.calls.length === beforeDemo, "its Word file matches, and Claude isn't called");

console.log(failures ? `\n${failures} failed` : "\nAll passed");
process.exit(failures ? 1 : 0);
