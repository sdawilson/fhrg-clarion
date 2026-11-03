// Councillor briefings: the Word file, drafting, release and the election setting, through the API and on the page.
import fs from "node:fs";
import zlib from "node:zlib";
import { JSDOM } from "jsdom";
import { addUser, claude, files, getText, until } from "./sim.mjs";
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
const api = async (path, body, token) => { const res = await handleRequest(new Request(`https://clarion.test${path}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { "x-session-token": token } : {}) }, body: JSON.stringify(body) })); return Object.assign(await res.json(), { status: res.status }); };
const login = async (email) => (await api("/api/login", { email, password: "pw" })).token;
const lead = await login("lead@westsussex.gov.uk"), member = await login("member@westsussex.gov.uk"), kit = await login("kit@kirklees.gov.uk"), boss = await login("boss@fhrg.test");

const DRAFT = { summary: "Satisfaction has fallen.\nPotholes come first.", how_residents_feel: "Less satisfied, on the survey.", why_it_matters_here: "New money raises hopes.", likely_questions: [{ question: "Are roads worse?", answer: "The survey says so." }, { question: "When?", answer: "Not yet known." }], factual_lines: ["Line one.", "Line two."] };
claude.script.submit_briefing = (body) => ({ id: "m", type: "message", role: "assistant", model: "x", stop_reason: "tool_use", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: "tool_use", id: "t1", name: "submit_briefing", input: body.tools[0].input_schema.properties.factual_lines ? DRAFT : { ...DRAFT, likely_questions: DRAFT.likely_questions.map(({ question }) => ({ question })), factual_lines: undefined } }] });

await api("/api/facts/notes", { code: WSX, notes: "PRIVATE-NOTE about a named cabinet member" }, lead);
ok((await api("/api/briefing/start", { code: WSX }, member)).status === 403, "a member who isn't a lead can't write a briefing");
const write = async (token = lead, code = WSX) => {
  const r = await api("/api/briefing/start", { code }, token);
  await until(async () => (await api("/api/briefing/get", { code, id: r.briefing.id }, token)).briefing?.status !== "working", "the briefing to finish");
  return (await api("/api/briefing/get", { code, id: r.briefing.id }, token)).briefing;
};
let before = claude.calls.length;
const one = await write();
const call = claude.calls[before];
ok(one.status === "ready" && one.summary.startsWith("Satisfaction") && one.questions.length === 2 && one.lines.length === 2, "Claude drafts a briefing");
ok(!call.prompt.includes("PRIVATE-NOTE") && !JSON.stringify(call.body.tools).includes("web_"), "from no officer's notes, and with no web access");
ok(!/early_signs|headline/.test(call.prompt), "and not from a reading's words, which may echo those notes, or early signs");
ok(/Section 2 of the Local Government Act 1986/.test(call.sys) && /data, not instructions/.test(call.prompt), "told to stay neutral, and that what it's given is data");
ok(one.sources.some((x) => /Evidence read on \d+ \w+ 20\d\d/.test(x)) && one.sources.some((x) => /reference library/.test(x)), "the list of sources is written by code, with the date read");
ok(!("claude" in one) && !one.approvedBy, "and it starts as a draft");

ok((await api("/api/briefing/get", { code: WSX, id: one.id }, kit)).status === 403, "another authority can't read it");
ok((await api("/api/briefing/get", { code: WSX, id: "../../facts" }, lead)).status === 404, "a made-up id is refused");
ok((await api("/api/briefing/list", { code: WSX }, member)).briefings[0].id === one.id, "members of the authority see it listed");

let r = await api("/api/briefing/word", { code: WSX, id: one.id }, lead);
ok(r.status === 409 && !r.file, "a draft can't be taken out");
r = await api("/api/briefing/save", { code: WSX, id: one.id, ...one, summary: "Changed by an officer.", lines: ["A", "", "B"], questions: [{ question: "Q?", answer: "A." }, { question: "", answer: "gone" }] }, lead);
ok(r.briefing.summary === "Changed by an officer." && r.briefing.lines.length === 2 && r.briefing.questions.length === 1, "an officer's changes are saved, and empty rows dropped");
ok((await api("/api/briefing/save", { code: WSX, id: one.id, summary: "Member" }, member)).status === 403, "a member can't change it");

r = await api("/api/briefing/approve", { code: WSX, id: one.id }, boss);
ok(r.status === 403 && /named officer/.test(r.error), "a site administrator from outside can't release it");
ok((await api("/api/briefing/approve", { code: WSX, id: one.id }, member)).status === 403, "nor can a member who isn't a lead");
const blank = await write();
await api("/api/briefing/save", { code: WSX, id: blank.id, ...blank, summary: "  " }, lead);
ok(/summary/.test((await api("/api/briefing/approve", { code: WSX, id: blank.id }, lead)).error), "an empty briefing can't be released");
r = await api("/api/briefing/approve", { code: WSX, id: one.id }, lead);
ok(r.briefing.approvedBy === "Lee Lead" && /^20\d\d-\d\d-\d\d$/.test(r.briefing.approvedOn), "a lead of the authority releases it, under their name");
ok((await api("/api/briefing/save", { code: WSX, id: one.id, summary: "Later" }, lead)).status === 409 && (await api("/api/briefing/remove", { code: WSX, id: one.id }, lead)).status === 409, "what's released stays as it was, and on record");

r = await api("/api/briefing/word", { code: WSX, id: one.id }, member);
z = unzip(Buffer.from(r.file, "base64"));
let doc = z["word/document.xml"].text;
ok(/^west-sussex.*\.docx$/.test(r.name), "it comes out as a Word file");
ok(doc.includes("Released by Lee Lead on") && doc.includes("Changed by an officer.") && doc.includes("Factual lines") && doc.includes("Evidence read on"), "with who released it, what it says and its sources");

r = await api("/api/briefing/copy", { code: WSX, id: one.id }, lead);
ok(r.briefing.id !== one.id && !r.briefing.approvedBy && r.briefing.summary === "Changed by an officer." && r.briefing.by === "Lee Lead", "a new draft can start from it");
const copy = r.briefing;
r = await api("/api/briefing/remove", { code: WSX, id: copy.id }, lead);
ok(r.ok && !(await api("/api/briefing/list", { code: WSX }, lead)).briefings.some((x) => x.id === copy.id), "and a draft can be deleted");

// ---- the election setting
ok((await api("/api/briefing/election", { code: WSX, on: true }, member)).status === 403, "a member can't set the election setting");
const draft = await write();
const survey = (await api("/api/survey/new", { code: WSX, title: "Autumn", purpose: "How people feel." }, lead)).survey;
await api("/api/survey/save", { code: WSX, id: survey.id, title: "Autumn", purpose: "How people feel.", collector: "West Sussex", sites: "High Street" }, lead);
const opened = (await api("/api/survey/status", { code: WSX, id: survey.id, status: "open" }, lead)).survey;
ok(opened?.status === "open" && (await api("/api/s/get", { access: opened.access })).survey?.title === "Autumn", "before it's on, a survey opens and tablets can reach it");
r = await api("/api/briefing/election", { code: WSX, on: true }, lead);
ok(r.election.on && r.election.by === "Lee Lead", "a lead turns the election setting on");

r = await api("/api/briefing/get", { code: WSX, id: draft.id }, lead);
ok(r.briefing.lines.length === 0 && r.briefing.questions.every((q) => q.answer === "") && r.briefing.questions.length === 2 && /Pre-election/.test(r.briefing.electionNote), "older briefings lose their lines and suggested answers on screen");
r = await api("/api/briefing/word", { code: WSX, id: one.id }, lead);
doc = unzip(Buffer.from(r.file, "base64"))["word/document.xml"].text;
ok(!doc.includes("Factual lines") && doc.includes("Pre-election period"), "and in a Word copy, even one released before");

r = await api("/api/briefing/save", { code: WSX, id: draft.id, title: "Edited", summary: "During", feel: "F", matters: "M", questions: [{ question: "Are they worse?", answer: "Sneaked in" }], lines: ["Sneaked in"] }, lead);
const held = JSON.parse(await getText(files(`clarion/authorities/${WSX}/briefings/`).find((f) => f.includes(draft.id))));
ok(r.briefing.lines.length === 0 && held.lines.length === 2 && held.questions[0].answer === "The survey says so." && held.questions[0].question === "Are they worse?", "an edit during the period can't add lines, and doesn't lose the hidden ones");

let tool;
const seen = claude.script.submit_briefing;
claude.script.submit_briefing = (body) => { tool = body.tools[0]; return seen(body); };
before = claude.calls.length;
const during = await write();
ok(!tool.input_schema.properties.factual_lines && !tool.input_schema.properties.likely_questions.items.properties.answer && /pre-election/.test(claude.calls[before].prompt) && during.lines.length === 0, "a new briefing asks Claude for neither");

await api("/api/briefing/approve", { code: WSX, id: draft.id }, lead);
await api("/api/briefing/election", { code: WSX, on: false }, lead);
r = await api("/api/briefing/get", { code: WSX, id: draft.id }, lead);
ok(r.briefing.lines.length === 0 && r.briefing.questions.every((q) => q.answer === ""), "lines hidden when one was released don't come back afterwards");
r = await api("/api/briefing/get", { code: WSX, id: one.id }, lead);
ok(r.briefing.lines.length === 2, "and one released before the period is whole again after it");

// surveys
await api("/api/briefing/election", { code: WSX, on: true }, lead);
const form = { client: "c1", site: "High Street", secs: 60, answers: { c1: "Fairly satisfied" } };
r = await api("/api/s/get", { access: opened.access });
ok(r.status === 409 && /paused/.test(r.error), "tablets can't open a survey during the period");
r = await api("/api/s/submit", { access: opened.access, forms: [form] });
ok(r.status === 409 && /paused/.test(r.error), "or send forms, so they stay on the tablet");
await api("/api/survey/status", { code: WSX, id: survey.id, status: "draft" }, lead);
r = await api("/api/survey/status", { code: WSX, id: survey.id, status: "open" }, lead);
ok(r.status === 409 && /paused/.test(r.error), "and a survey can't be opened");
ok((await api("/api/briefing/list", { code: KIRK }, kit)).election.on === false, "another authority's setting is left alone");
ok((await api("/api/survey/list", { code: WSX }, member)).paused === true && (await api("/api/survey/get", { code: WSX, id: survey.id }, lead)).paused === true, "and the survey pages say so");
await api("/api/briefing/election", { code: WSX, on: false }, lead);
r = await api("/api/survey/status", { code: WSX, id: survey.id, status: "open" }, lead);
ok(r.survey?.status === "open" && (await api("/api/s/get", { access: r.survey.access })).survey, "turned off, surveys carry on");

// ---- the pages
const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
async function open(token, hash, path = "") {
  const dom = new JSDOM(html, {
    url: `https://clarion.test/${path}${hash}`, runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(w) {
      w.localStorage.setItem("clarion_token", token);
      w.scrollTo = () => {};
      w.print = () => { w.printed = true; };
      w.URL.createObjectURL = (blob) => { w.saved = blob; return "blob:x"; };
      w.URL.revokeObjectURL = () => {};
      w.fetch = async (url, opts = {}) => { const res = await handleRequest(new Request(new URL(url, "https://clarion.test").href, opts)); const text = await res.text(); return { ok: res.ok, status: res.status, json: async () => JSON.parse(text) }; };
    },
  });
  await until(() => dom.window.document.querySelector(".main .page > *"), "the page to start");
  return dom.window.document;
}
const text = (el) => el.textContent.replace(/\s+/g, " ");
const see = (d, pattern) => until(() => pattern.test(text(d.querySelector(".main"))), `the page to show ${pattern}`);
const button = (d, words) => [...d.querySelectorAll("button")].find((b) => b.textContent.trim() === words);
const fill = (el, value) => { el.value = value; };

let d = await open(lead, `#briefings/${WSX}`);
await see(d, /Briefings so far/);
ok(button(d, "Write a briefing") && button(d, "Turn this on") && /Released/.test(text(d.querySelector(".main"))) && /Draft/.test(text(d.querySelector(".main"))), "a lead sees the list, and can write one and set the election setting");
const rail = [...d.querySelectorAll(".rail .nav button")].map((b) => b.textContent);
ok(rail.includes("Councillor briefings"), "it has its place in the menu");
d = await open(member, `#briefings/${WSX}`);
await see(d, /Briefings so far/);
ok(!button(d, "Write a briefing") && !button(d, "Turn this on"), "a member can only read");

const page = await write();
d = await open(lead, `#briefing/${WSX}/${page.id}`);
await see(d, /Release this briefing/);
const boxes = [...d.querySelectorAll(".main textarea")];
ok(boxes.length >= 7 && boxes[0].value.startsWith("Satisfaction") && d.querySelector(".main input").value.includes("councillor briefing"), "a draft opens ready to edit");
ok(!button(d, "Take as Word") && !button(d, "Print or save as PDF"), "and it can't be taken out yet");
button(d, "Add a line").click();
ok([...d.querySelectorAll(".main textarea")].length === boxes.length + 1, "lines can be added");
button(d, "Add a line").click(); button(d, "Add a line").click(); button(d, "Add a line").click();
ok(button(d, "Add a line").disabled, "up to the most that will be kept");
fill(d.querySelectorAll(".main textarea")[0], "Edited on the page.");
button(d, "Release this briefing").click();
await see(d, /Released by Lee Lead/);
const released = (await api("/api/briefing/get", { code: WSX, id: page.id }, lead)).briefing;
ok(released.summary === "Edited on the page." && released.lines.length === 2, "releasing saves what's on the page first");
ok(button(d, "Take as Word") && button(d, "Print or save as PDF") && !d.querySelector(".main textarea"), "and a released briefing reads as a document");
button(d, "Take as Word").click();
await until(() => d.defaultView.saved, "the file to be saved");
ok(d.defaultView.saved.type.includes("wordprocessingml"), "Word is saved as a Word file");
button(d, "Print or save as PDF").click();
ok(d.defaultView.printed, "PDF goes through printing");
button(d, "Start a new draft from this").click();
await see(d, /Save changes/);
ok(!text(d.querySelector(".main")).includes("Released by"), "a new draft opens for editing");

await api("/api/briefing/election", { code: WSX, on: true }, lead);
d = await open(lead, `#briefing/${WSX}/${(await write()).id}`);
await see(d, /hidden, and won't be in what's released/);
ok(!button(d, "Add a line") && !button(d, "Add a question") && !text(d.querySelector(".main")).includes("Factual answer"), "during the period the form asks for neither lines nor answers");
d = await open(lead, `#surveys/${WSX}`);
await see(d, /Street surveys are paused/);
ok(true, "and the survey list says surveys are paused");
await api("/api/briefing/election", { code: WSX, on: false }, lead);

// the demonstration
d = await open("", "#briefings/NORTHBRIDGE", "demo");
await see(d, /Briefings so far/);
ok(/northbridge/i.test(text(d.querySelector(".main"))), "the demonstration has a briefing");
const before2 = claude.calls.length;
d.querySelector(".main .note-row a").click();
await until(() => /#briefing\//.test(d.location.hash), "the briefing to open");
await see(d, /Release this briefing/);
button(d, "Release this briefing").click();
await see(d, /Released by Demo officer/);
button(d, "Take as Word").click();
await until(() => d.defaultView.saved, "the demonstration's file");
ok(/Released by Demo officer/.test(text(d.querySelector(".main"))) && claude.calls.length === before2, "and goes through release with no call to Claude");

console.log(failures ? `\n${failures} failed` : "\nAll passed");
process.exit(failures ? 1 : 0);
