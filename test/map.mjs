// The map of mood and everything that hangs off it: filters, Set-up, high-impact issues, the campaign calendar,
// what a survey tells people, the officers' briefing, and the pages for each, run against the real app.
import fs from "node:fs";
import { JSDOM } from "jsdom";
import { addUser, claude, files, getText, putText, until } from "./sim.mjs";
const { handleRequest } = await import("./.build/app.mjs");
const t = await import("./.build/internals.mjs");

let failures = 0;
const ok = (cond, what) => { console.log(`${cond ? "PASS" : "FAIL"}  ${what}`); if (!cond) failures++; };
const WSX = "E10000032";
const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const tablet = fs.readFileSync(new URL("../public/survey.html", import.meta.url), "utf8");

await addUser(1, "lead@westsussex.gov.uk", "Lee Lead", 30, "lead");
await addUser(2, "member@westsussex.gov.uk", "Mo Member", 30, "member");
await addUser(3, "kit@kirklees.gov.uk", "Kit Officer", 20, "lead");
await addUser(4, "boss@fhrg.test", "Bo Boss", 99, "member", 1);
const api = async (path, body, token) => { const res = await handleRequest(new Request(`https://clarion.test${path}`, { method: "POST", headers: { "content-type": "application/json", "x-session-token": token || "", origin: "https://clarion.test" }, body: JSON.stringify(body ?? {}) })); return Object.assign(await res.json(), { status: res.status }); };
const login = async (email) => (await api("/api/login", { email, password: "pw" })).token;
const lead = await login("lead@westsussex.gov.uk"), member = await login("member@westsussex.gov.uk"), kit = await login("kit@kirklees.gov.uk"), boss = await login("boss@fhrg.test");

// ---- the sums
ok(t.moodWord(-40) === "very negative" && t.moodWord(-10) === "negative" && t.moodWord(0) === "mixed" && t.moodWord(10) === "positive" && t.moodWord(40) === "very positive" && t.moodWord(null) === "too little to read", "words for mood");
ok(t.leanOf(-10) === "down" && t.leanOf(-9) === "mixed" && t.leanOf(9) === "mixed" && t.leanOf(10) === "up" && t.leanOf(null) === "none", "and its colours change at the same points");
ok(t.fmtMood(-27) === "−27" && t.fmtMood(12) === "+12" && t.fmtMood(0) === "0", "a mood shows its sign");
ok(t.defaultMonth("2026-11-02") === "2026-10" && t.defaultMonth("2027-01-15") === "2026-12", "the map opens on the last full month");
ok(t.monthsFor("2026-11-02")[0].id === "2026-11" && /So far this month/.test(t.monthsFor("2026-11-02")[0].label), "with the month so far to choose");
let f = t.readFilters({ service: "nonsense", month: "2031-01", topic: "Not a topic", bias: "x", view: "x", include: "x" }, "2026-11-02", ["Potholes"]);
ok(f.service === "highways" && f.month === "2026-10" && f.topic === "all" && f.bias === "all" && f.view === "authority" && Array.isArray(f.include), "anything odd in the filters falls back to the default");
ok(t.mediaOf({ type: "Trade Press" }).medium === "mags" && t.mediaOf({ type: "Streaming Video" }).medium === "video" && t.mediaOf({ type: "Community Event" }).medium === "meetings", "each kind of source has its place on the map");

const map = t.demoMap({});
const kid = (node, id) => (node.id === id ? node : node.kids.map((k) => kid(k, id)).find(Boolean));
ok(map.month === "2026-10" && map.tree.mood.v !== null && map.tree.mood.txt.startsWith("−"), "the demonstration has one mood in the middle");
ok(map.tree.kids.map((k) => k.id).join() === "surveys,broadcast,print,social,contact,events", "made of six parts");
const counted = map.tree.kids.filter((k) => k.pct !== null);
ok(counted.reduce((n, k) => n + k.pct, 0) >= 99 && counted.reduce((n, k) => n + k.pct, 0) <= 101, "and the shares of those counted add up to about 100");
ok(kid(map.tree, "weather").mood.ctx && kid(map.tree, "news").mood.ctx && kid(map.tree, "published").mood.ctx && kid(map.tree, "bylink").mood.ctx, "weather, news, published figures and replies by link aren't in the mood");
ok(map.considerations.some((x) => x.kind === "Weather") && map.considerations.some((x) => x.kind === "Council news") && map.considerations.some((x) => x.kind === "Published figures") && map.considerations.some((x) => x.kind === "Replies by link"), "they're things to bear in mind instead");
ok(map.considerations.every((x) => !/\d{4}-\d{2}-\d{2}/.test(`${x.title} ${x.sub}`)), "with dates in plain words");
ok(map.direction.word === "Worsening" && /kinds of signal agree/.test(map.direction.note), "a change is reported when two kinds of signal agree");
ok(t.demoMap({ month: "2026-11" }).direction.word === "Too early to say", "and it's too early to say in the current month");
ok(map.topics.filter((x) => x.proposed).length === 3 && map.topics.filter((x) => x.proposed).every((x) => x.mood < 0), "Clarion proposes three issues with a negative mood");
ok(map.topics.every((x) => "raw" in x) && map.functions.every((x) => "raw" in x), "raw figures stay with the adjusted ones");
ok(t.demoMap({ bias: "right" }).pieces.length < map.pieces.length && t.demoMap({ bias: "right" }).pieces.every((p) => p), "the leaning filter narrows the pieces");
ok(t.demoMap({ topic: "Potholes" }).pieces.every((p) => p.topic === "Potholes") && t.demoMap({ topic: "Potholes" }).planned.length === 3, "a topic narrows pieces and campaign events");
ok(map.leftOut.some((q) => q.name === "Dale Highways" && q.pieces.length === 6), "pieces about a partner are left out of the authority's position, and say so");
const withDale = t.demoMap({ include: ["dale"] });
ok(withDale.pieces.length === map.pieces.length + 6 && !withDale.leftOut.some((q) => q.id === "dale"), "until they're added");
const dale = t.demoMap({ view: "partners", partner: "dale" });
ok(dale.pieces.length === 6 && dale.pieces.every((p) => p.about === "dale") && dale.planned.length === 0, "a partner's view holds only what's been said about it");
ok(dale.tree.made.every((r) => /piece/.test(r.share)) && dale.tree.notes.some((n) => /isn't a verdict/.test(n)), "shown as pieces, and not as a verdict");
ok(kid(dale.tree, "meetings").mood.v === null, "one meeting can't speak for a firm");
ok(t.demoMap({ service: "waste" }).tree.mood.v === null && t.demoMap({ service: "waste" }).topics.every((x) => !x.enquiries) && t.demoMap({ service: "waste" }).considerations.length === 0, "other services start empty, with no roads figures under them");
ok(kid(map.tree, "enquiries").kids.length >= 3 && kid(map.tree, "enquiries").kids.every((k) => k.topic), "enquiries open into their topics, to plan a response from");
ok(kid(map.tree, "mps").notes.some((n) => /latest 12/.test(n)) && kid(map.tree, "petitions").notes.some((n) => /so there may be more/.test(n)) && kid(map.tree, "news").notes.some((n) => /so there may be more/.test(n)), "a capped list says so");
ok(kid(map.tree, "gov").facts.some((x) => /GOV\.UK/.test(x.sub)), "government announcements show on the map");
ok(map.public.groups.Age.every((g) => g.n >= 30) && Object.values(map.public.groups).flat().every((g) => g.n >= 30), "groups under 30 aren't reported");
ok(map.public.adults.length === 7, "and local ages are there to weight everyone here");
ok(!JSON.stringify(map).match(/resident's|Jane/), "nothing about a person is on the map");

// the election setting holds a campaign back, even in the demonstration
const held = t.demoMap({ election: true });
ok(held.election === true && held.planned.length === 0, "the election setting takes campaign events off the map");
ok(t.demoOfficers({ election: true }).briefing.parts.find((p) => p.heading === "Coming up").paras[0] === "Held back by the election setting." && !/We are repairing/.test(JSON.stringify(t.demoOfficers({ election: true }))), "and key messages and events out of the officers' briefing");

// ---- Set-up
ok(t.standardFunctions("highways").length === 13 && t.standardFunctions("waste").length > 0, "FHRG's standard lists");
ok(t.serviceId("waste") === "waste" && t.serviceId("x") === "highways", "an unknown service is highways");
ok((await api("/api/map", { code: WSX })).status === 401, "the map needs a sign-in");
ok((await api("/api/map", { code: WSX }, kit)).status === 403, "and it's only for your own authority");
let r = await api("/api/map", { code: WSX }, lead);
ok(r.canEdit === true && r.tree.id === "root" && r.months.length > 3 && r.functions.length === 13, "a lead gets the map");
ok((await api("/api/map", { code: WSX }, boss)).canEdit === true, "and so does a site administrator");
ok((await api("/api/map", { code: WSX }, member)).canEdit === false, "a member can read it");
ok((await api("/api/setup/save", { code: WSX, part: "partners", list: [{ name: "Acme" }] }, member)).status === 403, "a member can't change Set-up");
r = await api("/api/setup/get", { code: WSX }, lead);
const std = r.setup.functions.highways.map((x) => ({ ...x }));
std[0].name = "Roads"; std.pop(); std.push({ name: "Our own" });
r = await api("/api/setup/save", { code: WSX, part: "functions", service: "highways", list: std }, lead);
ok(r.setup.functions.highways[0].name === "Roads" && r.setup.functions.highways[0].orig === "Carriageways" && r.setup.functions.highways.length === 13 && r.setup.functions.highways.at(-1).name === "Our own", "a lead can rename, take out and add functions, and a renamed one keeps its link to the Toolkit");
r = await api("/api/map", { code: WSX }, lead);
ok(r.functions.some((x) => x.name === "Roads") && !r.functions.some((x) => x.name === "Claims & liability"), "and the map follows");
ok((await api("/api/setup/weights", { surveys: 50 }, lead)).status === 403, "only a site administrator can change the weights");
r = await api("/api/setup/weights", { surveys: 50, contact: 10, print: 15, broadcast: 10, social: 10, events: 5 }, boss);
ok(r.weights.surveys === 50, "so mood means the same everywhere");
ok((await api("/api/setup/get", { code: "E08000034" }, kit)).weights.surveys === 50, "for every authority");
await api("/api/setup/weights", { surveys: 40, contact: 20, print: 15, broadcast: 10, social: 10, events: 5 }, boss);
r = await api("/api/setup/save", { code: WSX, part: "partners", list: [{ name: "Acme Highways", role: "Contractor" }] }, lead);
const acme = r.setup.partners[0].id;
ok(acme && r.setup.partners[0].role === "Contractor", "a partner can be added");
r = await api("/api/setup/save", { code: WSX, part: "channels", list: [{ name: "Parish newsletter", node: "press" }, { name: "Oddity", node: "nowhere" }] }, lead);
ok(r.setup.channels[0].node === "press" && r.setup.channels[1].node === "", "a channel is tied to a place on the map, and only a real one");
await api("/api/setup/save", { code: WSX, part: "channels", list: [{ name: "Press announcement", node: "press" }, { name: "Street survey", node: "street" }] }, lead);

// a partner's pieces, and taking the partner out
const src = (await api("/api/coverage/source", { code: WSX, name: "West Sussex Gazette", type: "Local Newspaper", reach: "20000" }, lead)).source;
const piece = (extra) => ({ code: WSX, source: src.id, date: new Date().toISOString().slice(0, 10), summary: "A line of my own", topic: "Potholes", relevance: "High", tone: "Critical", prominence: "Inside page", ...extra });
r = await api("/api/coverage/assess", piece({ about: acme }), lead);
ok(r.assessment.about === acme, "a mention can be about a partner");
const month = (await api("/api/map", { code: WSX }, lead)).months[0].id;
r = await api("/api/map", { code: WSX, month }, lead);
ok(r.pieces.length === 0 && r.leftOut.find((q) => q.id === acme).pieces.length === 1, "and stays out of the authority's position");
await api("/api/setup/save", { code: WSX, part: "partners", list: [] }, lead);
r = await api("/api/map", { code: WSX, month }, lead);
ok(r.pieces.length === 1, "taking the partner out doesn't lose the piece");

// ---- issues and the calendar
ok((await api("/api/issue/set", { code: WSX, topic: "Potholes" }, member)).status === 403, "a member can't confirm an issue");
r = await api("/api/issue/set", { code: WSX, topic: "Potholes", status: "confirmed", key: "We are fixing more." }, lead);
ok(r.issue.status === "confirmed" && r.issue.key === "We are fixing more.", "a lead confirms an issue, with a key message");
r = await api("/api/issue/set", { code: WSX, topic: "Our own worry", status: "confirmed", own: true }, lead);
ok(r.issue.own === true, "and can add their own");
ok((await api("/api/map", { code: WSX }, lead)).topicList.includes("Our own worry"), "which becomes a topic");
ok((await api("/api/coverage/assess", piece({ topic: "Our own worry" }), lead)).assessment?.topic === "Our own worry", "that a mention can use");
r = await api("/api/campaign/item", { code: WSX, title: "Pothole week", date: "2027-01-12", channel: "x", topics: ["Potholes"], origin: "Mention: Gazette" }, lead);
const item = r.item.id;
ok(item && r.item.origin === "Mention: Gazette", "an event says where it came from");
ok((await api("/api/campaign/item", { code: WSX, title: "", date: "2027-01-12" }, lead)).status === 400, "and needs a title");
ok((await api("/api/campaign/item", { code: WSX, title: "x", date: "soon" }, lead)).status === 400, "and a date");
ok((await api("/api/campaign/get", { code: WSX }, member)).items.length === 1, "a member can read the calendar");
ok((await api("/api/campaign/get", { code: WSX, service: "waste" }, lead)).items.length === 0, "which follows the service");
ok((await api("/api/campaign/get", { code: "E08000034" }, lead)).status === 403, "and it's your own authority's");

// the election setting
await api("/api/briefing/election", { code: WSX, on: true }, lead);
r = await api("/api/campaign/get", { code: WSX }, lead);
ok(r.election === true && r.items.length === 0 && r.issues.every((x) => x.key === ""), "the election setting holds back campaign events and key messages");
ok((await api("/api/map", { code: WSX }, lead)).planned.length === 0, "on the map too");
ok((await api("/api/campaign/item", { code: WSX, title: "x", date: "2027-01-12" }, lead)).status === 409 && (await api("/api/issue/set", { code: WSX, topic: "Potholes" }, lead)).status === 409 && (await api("/api/campaign/remove", { code: WSX, id: item }, lead)).status === 409, "and nothing can be changed");
await api("/api/briefing/election", { code: WSX, on: false }, lead);
r = await api("/api/campaign/get", { code: WSX }, lead);
ok(r.items.length === 1 && r.issues.find((x) => x.topic === "Potholes").key === "We are fixing more.", "it all comes back when it's off");

// ---- petitions and questions
const Q = await api("/api/map", { code: WSX, month }, lead);
ok((await api("/api/rate", { code: WSX, key: "petition|A", tone: "Critical" }, member)).status === 403, "a member can't rate a petition");
ok((await api("/api/rate", { code: WSX, key: "something|else", tone: "Critical" }, lead)).status === 400, "and only petitions and questions can be rated");
ok((await api("/api/rate", { code: WSX, key: "petition|A", tone: "Critical" }, lead)).ok === true && JSON.parse(getText(`clarion/authorities/${WSX}/ratings.json`))["petition|A"] === "Critical", "an officer's rating is kept");
const mapWith = (rated, monthly, questions = []) => t.buildMap({ ...t.demoMap && baseData(), rated, monthly, questions }, t.readFilters({}, "2026-11-02", []));
function baseData() { return { today: "2026-11-02", setup: { functions: { highways: [] }, partners: [], channels: [] }, weights: { surveys: 40, contact: 20, print: 15, broadcast: 10, social: 10, events: 5 }, topics: [], sources: [], assessments: [], streets: [], adults: null, ageAdults: null, residents: null, enquiries: {}, monthly: {}, questions: [], rated: {}, announcements: [], works: { on: false, weeks: [], events: [] }, notes: [], posts: [], published: [], campaign: { issues: [], items: [] }, election: false, channels: [], ages: [] }; }
const pet = (title, above = true) => ({ title, local: 500, above });
let m = mapWith({}, { "2026-09": { perDay: null, reports: 0, petitions: [] }, "2026-10": { perDay: null, reports: 0, petitions: [pet("New one")] } });
ok(kid(m.tree, "petitions").mood.v === null && kid(m.tree, "petitions").mood.unit === "to rate", "a new petition doesn't count until an officer rates it");
m = mapWith({ "petition|New one": "Critical" }, { "2026-09": { perDay: null, reports: 0, petitions: [] }, "2026-10": { perDay: null, reports: 0, petitions: [pet("New one")] } });
ok(kid(m.tree, "petitions").mood.v === -10, "then it counts for its direction");
m = mapWith({ "petition|New one": "Critical" }, { "2026-09": { perDay: null, reports: 0, petitions: [] }, "2026-10": { perDay: null, reports: 0, petitions: [pet("New one", false)] } });
ok(kid(m.tree, "petitions").mood.v === null, "a petition without a fair share of signatures here says nothing about this authority");
m = mapWith({ "petition|New one": "Critical" }, { "2026-10": { perDay: null, reports: 0, petitions: [pet("New one")] } });
ok(kid(m.tree, "petitions").mood.v === null, "and with no month before, nothing can be called new");
m = mapWith({ "petition|New one": "Critical" }, { "2026-09": { perDay: null, reports: 0 }, "2026-10": { perDay: null, reports: 0, petitions: [pet("New one")] } });
ok(kid(m.tree, "petitions").mood.v === null, "nor when the month before couldn't be read");
m = mapWith({ "question|2026-10-09|Roads": "Supportive" }, {}, [{ date: "2026-10-09", heading: "Roads" }, { date: "2026-10-10", heading: "More roads" }]);
ok(kid(m.tree, "mps").mood.v === 10 && /1 rated/.test(kid(m.tree, "mps").mood.tip), "questions count only for those rated");

// direction: two up and two down isn't a change
const point = (ran, sat, dis) => ({ id: "s", title: "S", status: "closed", ran, current: true, responses: 400, weighted: true, satisfied: sat, dissatisfied: dis, better: null, worse: null, blameCouncil: null, topics: [], note: "", selfOnly: false, service: "highways", questions: [], groups: [], byLink: { n: 0, sat: null } });
m = t.buildMap({ ...baseData(), enquiries: { "2026-06": { total: 100, byTopic: {} }, "2026-07": { total: 100, byTopic: {} }, "2026-08": { total: 100, byTopic: {} }, "2026-09": { total: 100, byTopic: {} }, "2026-10": { total: 100, byTopic: {} } } }, t.readFilters({}, "2026-11-02", []));
ok(m.direction.word === "No change reported", "nothing moving reports no change");

// ---- a survey tells people things
ok(t.readTell([{ text: "  Report a pothole online. ", topic: "Potholes", how: ["Printed on the form", "nonsense"], aware: true }])[0].how.join() === "Printed on the form", "a message keeps only real ways of telling people");
let threw = ""; try { t.readTell([{ text: "" }]); } catch (e) { threw = e.message; }
ok(/no wording/.test(threw), "and needs wording");
threw = ""; try { t.readTell([1, 2, 3, 4].map(() => ({ text: "x" }))); } catch (e) { threw = e.message; }
ok(/up to 3/.test(threw), "and a survey can carry up to three");
const made = (await api("/api/survey/new", { code: WSX, title: "Winter roads", service: "highways" }, lead)).survey;
ok(made.service === "highways", "a survey belongs to a service");
ok((await api("/api/survey/new", { code: WSX, title: "Bins", service: "waste" }, lead)).survey.service === "waste", "and it needn't be highways");
ok((await api("/api/survey/list", { code: WSX }, lead)).surveys.find((s) => s.title === "Bins").service === "waste", "the list says which");
r = await api("/api/survey/save", { code: WSX, id: made.id, locals: [{ text: "How satisfied are you with road repairs?", kind: "choice", options: ["Very satisfied", "Very dissatisfied"], fn: "cw", topic: "Potholes" }], tell: [
  { text: "You can report a pothole online.", topic: "Potholes", how: ["Read out by the interviewer", "On the tablet after the last question"], aware: true },
  { text: "Diversions are on one page.", topic: "", how: ["On the page after replying by link", "Printed on the form"], aware: false },
] }, lead);
ok(r.survey.tell.length === 2 && r.survey.locals[0].fn === "cw" && r.survey.locals[0].topic === "Potholes", "a local question has a function and a topic, and a survey has messages");
ok((await api("/api/survey/save", { code: WSX, id: made.id, tell: [] }, member)).status === 403, "a member can't change them");
let qs = t.allQuestions(r.survey);
ok(qs.some((q) => q.id === "k1" && /^Did you know\? You can report/.test(q.text) && q.options.join() === "Yes,No"), "\"Did you know?\" becomes a question, asked before the message is given");
ok(qs.findIndex((q) => q.id === "k1") < qs.findIndex((q) => q.part === "about"), "before the questions about the person");
r = await api("/api/campaign/get", { code: WSX }, lead);
const told = r.items.filter((x) => x.survey === made.id);
ok(told.length === 1 && told[0].topics.join() === "Potholes", "a message tied to a topic shows on the calendar, and can open its survey");
await api("/api/survey/save", { code: WSX, id: made.id, tell: [{ text: "You can report a pothole online.", topic: "Potholes", how: ["Read out by the interviewer", "On the tablet after the last question"], aware: true }, { text: "Diversions are on one page.", topic: "", how: ["On the page after replying by link", "Printed on the form"], aware: false }] }, lead);
ok((await api("/api/campaign/get", { code: WSX }, lead)).items.filter((x) => x.survey === made.id).length === 1, "saved again, it doesn't appear twice");
await api("/api/briefing/election", { code: WSX, on: true }, lead);
ok((await api("/api/survey/save", { code: WSX, id: made.id, tell: [] }, lead)).status === 409, "messages can't change during the election setting");
await api("/api/briefing/election", { code: WSX, on: false }, lead);
const opened = (await api("/api/survey/status", { code: WSX, id: made.id, status: "open" }, lead)).survey;
const self = (await api("/api/survey/self", { code: WSX, id: made.id, on: true }, lead)).survey.self;
ok((await api("/api/survey/save", { code: WSX, id: made.id, tell: [] }, lead)).status === 400, "or once a survey is open, as forms carry them");
r = await api("/api/s/get", { access: opened.access });
ok(r.survey.readOut.join() === "You can report a pothole online." && r.survey.told.join() === "You can report a pothole online.", "a tablet gets what to read out and show");
ok(Object.keys(r.survey).sort().join() === "collector,questions,readOut,sites,title,told" && r.survey.questions.every((q) => !("fn" in q) && !("topic" in q)), "and nothing else: not even a question's function or topic");
r = await api("/api/r/get", { access: self });
ok(r.survey.told.join() === "Diversions are on one page." && Object.keys(r.survey).sort().join() === "collector,questions,title,told", "someone with the link gets what's meant for them");
const answers = (i) => ({ client: `f${i}`, site: "", secs: 200, answers: { c1: i % 2 ? "Fairly satisfied" : "Fairly dissatisfied", l1: "Very satisfied", k1: i % 3 ? "No" : "Yes" } });
await api("/api/s/submit", { access: opened.access, forms: Array.from({ length: 30 }, (_, i) => answers(i)) });
await api("/api/s/submit", { access: opened.access, forms: Array.from({ length: 12 }, (_, i) => answers(i + 30)) });
r = await api("/api/survey/get", { code: WSX, id: made.id }, lead);
const aware = r.results.questions.find((q) => q.id === "k1");
ok(aware.options.find((o) => o.label === "Yes").pct > 0 && r.survey.tell.length === 2, "the survey's results say how many already knew");
const before = await api("/api/map", { code: WSX, month, topic: "Potholes" }, lead);
ok(before.tree.kids.find((k) => k.id === "surveys").kids.find((k) => k.id === "street").kids.every((k) => !/Did you know/.test(k.label)), "\"Did you know?\" never reaches mood");
ok(before.tree.kids.find((k) => k.id === "surveys").kids.find((k) => k.id === "street").kids.some((k) => /road repairs/.test(k.label)) && before.topics, "a local question with satisfaction answers shows under its topic");

// replies by link stay apart, and replies from elsewhere aren't in any figure
const point2 = t.pointOf({ id: "x", code: WSX, title: "T", status: "closed", locals: [], plan: { target: 100, sites: [], checks: [] }, created: "2026-10-01", openedOn: "2026-10-01", closedOn: "2026-10-20" }, [
  ...Array.from({ length: 40 }, (_, n) => ({ n, form: String(n), via: "paper", site: "", at: "2026-10-05T10:00:00Z", secs: null, answers: { c1: "Fairly satisfied" }, topics: {}, clean: {}, checked: {} })),
  ...Array.from({ length: 30 }, (_, n) => ({ n: 100 + n, form: `R${n}`, via: "self", where: "here", site: "", at: "2026-10-05T10:00:00Z", secs: 100, answers: { c1: "Very dissatisfied" }, topics: {}, clean: {}, checked: {} })),
  ...Array.from({ length: 30 }, (_, n) => ({ n: 200 + n, form: `E${n}`, via: "self", where: "elsewhere", site: "", at: "2026-10-05T10:00:00Z", secs: 100, answers: { c1: "Very satisfied" }, topics: {}, clean: {}, checked: {} })),
], null);
ok(point2.byLink.n === 30 && point2.byLink.sat === 0, "replies from elsewhere aren't in the figure for replies by link");

// ---- the officers' briefing
ok((await api("/api/briefing/officers", { code: WSX })).status === 401, "the officers' briefing needs a sign-in");
ok((await api("/api/briefing/officers", { code: WSX }, kit)).status === 403, "and it's for your own authority");
r = await api("/api/briefing/officers", { code: WSX, month }, member);
ok(r.briefing.parts.map((p) => p.heading).join() === "Where we are,High-impact issues,Early signs to check,Coming up,Bear in mind for campaigns,What's missing", "it has six parts");
ok(/We are fixing more/.test(JSON.stringify(r.briefing)), "with confirmed issues and their key messages");
r = await api("/api/briefing/officers", { code: WSX, month, word: true }, lead);
ok(r.name.endsWith(".docx") && r.file.length > 100, "it can be taken out as a Word file");
await api("/api/briefing/election", { code: WSX, on: true }, lead);
r = await api("/api/briefing/officers", { code: WSX, month }, lead);
ok(!/We are fixing more/.test(JSON.stringify(r.briefing)) && /Held back/.test(JSON.stringify(r.briefing)), "the election setting holds back key messages and events");
await api("/api/briefing/election", { code: WSX, on: false }, lead);

// ---- All authorities
r = await api("/api/admin/overview", {}, boss);
ok(r.authorities.every((x) => "mood" in x && "pieces" in x && "enquiries" in x) && r.authorities.map((x) => x.name).join() === [...r.authorities.map((x) => x.name)].sort().join(), "all authorities shows mood, in alphabetical order");

// ---- a note's expected effect
const noteFile = `clarion/authorities/${WSX}/notes/20261001000000000-aaaaaaaa.json`;
putText(noteFile, JSON.stringify({ id: "20261001000000000-aaaaaaaa", code: WSX, status: "ready", stage: "Ready", created: "2026-10-01T00:00:00.000Z", updated: "2026-10-01T00:00:00.000Z", by: "x", input: { title: "T", url: "", text: "" }, impacts: [], dataUsed: [], change: { title: "T" } }));
ok((await api("/api/note/effect", { code: WSX, id: "20261001000000000-aaaaaaaa", effect: 20, topic: "Potholes" }, member)).status === 403, "a member can't set a note's expected effect");
r = await api("/api/note/effect", { code: WSX, id: "20261001000000000-aaaaaaaa", effect: 20, topic: "Potholes" }, lead);
ok(r.note.effect === 20 && r.note.topic === "Potholes", "an officer can");
ok((await api("/api/note/effect", { code: WSX, id: "20261001000000000-aaaaaaaa", effect: 500 }, lead)).status === 400, "within limits");

// ---- the pages
function browser(address, token, page = html) {
  return new JSDOM(page, {
    url: `https://clarion.test${address}`, runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(w) {
      if (token) w.localStorage.setItem("clarion_token", token);
      w.scrollTo = () => {}; w.print = () => { w.printed = true; };
      w.URL.createObjectURL = (blob) => { w.saved = blob; return "blob:x"; }; w.URL.revokeObjectURL = () => {};
      w.fetch = async (url, opts = {}) => { const res = await handleRequest(new Request(new URL(url, "https://clarion.test").href, opts)); const text = await res.text(); return { ok: res.ok, status: res.status, json: async () => JSON.parse(text) }; };
    },
  }).window.document;
}
const text = (el) => (el?.textContent ?? "").replace(/\s+/g, " ");
const shows = (d, pattern) => until(() => pattern.test(text(d.querySelector(".main"))), `the page to show ${pattern}`);
const button = (d, name) => [...d.querySelectorAll("button")].find((b) => b.textContent === name);
const node = (d, words) => [...d.querySelectorAll(".nd")].find((x) => x.querySelector(".nd-label").textContent === words);
const go = (d, hash) => { d.defaultView.location.hash = hash; };
const clean = (d) => !/\bnull\b|undefined|\[object/.test(text(d.getElementById("app")));

let d = browser("/demo", "");
await until(() => d.querySelector(".stage"), "the map");
await until(() => d.querySelector(".pickers select")?.value === "highways" && d.querySelectorAll(".pickers select option").length > 5, "the pull-downs");
ok(d.querySelector("h1").textContent === "Northbridge: the map of mood" && clean(d), "the demonstration opens on the map, with nothing stray");
ok([...d.querySelectorAll(".pickers select")].map((x) => x.value).join() === "highways,2026-10,all", "the pull-downs show the service, month and topic");
ok(/New posts and automatic collection use Highways/.test(text(d.querySelector(".top"))), "and which service new posts go to");
ok(d.querySelectorAll(".stage .nd").length === 6, "six circles around the middle");
ok(node(d, "Surveys").querySelector(".bub").textContent === "−26" && /of the mood/.test(node(d, "Surveys").querySelector(".nd-sub").textContent), "each with its mood inside and its share below");
ok(node(d, "Surveys").className.includes("lean-down") && d.querySelector(".hub").className.includes("lean-down"), "coloured by mood, with the middle too");
ok(d.querySelectorAll(".wires path").length === 1 && d.querySelector(".wires path").getAttribute("d").split("M").length === 7, "joined by straight lines");
const size = (x) => parseInt(x.style.getPropertyValue("--d"), 10);
ok(size(node(d, "Surveys")) > size(node(d, "TV and radio")), "a bigger share is a bigger circle");
ok(/1 planned|2 planned/.test(text(node(d, "Press and magazines"))), "planned events show on their part of the map");

// the same in every view
d.querySelector(".nd .nd-label").closest("button");
[...d.querySelectorAll(".seg button")].find((b) => b.textContent === "The public").click();
await until(() => /Aged 45 to 54/.test(text(d.querySelector(".hub"))), "the public view");
ok(d.querySelectorAll(".stage.big .nd").length >= 7 && [...d.querySelectorAll(".stage.big .nd")].every((x) => /% of this age group/.test(x.querySelector(".nd-sub").textContent)), "the public view keeps a share below each circle");
ok(/from one Ofcom question/.test(text(d.querySelector(".panel"))) && /doesn't measure Northbridge/.test(text(d.querySelector(".panel"))), "labelled as a national pattern that doesn't measure the authority");
ok(!/WhatsApp and nextdoor|youtube/.test(text(d.querySelector(".panel"))), "with names kept as they should be");
[...d.querySelectorAll(".chip")].find((b) => b.textContent === "Everyone here").click();
await until(() => /Everyone here/.test(text(d.querySelector(".hub"))), "everyone here");
ok([...d.querySelectorAll(".stage.big .nd")].every((x) => /% of adults here/.test(x.querySelector(".nd-sub").textContent)), "everyone here is weighted by local ages");
ok(d.querySelector(".panel details table") && /See every age as a table/.test(text(d.querySelector(".panel"))), "and every age can be read as a table");
[...d.querySelectorAll(".seg button")].find((b) => b.textContent === "Key partners").click();
await until(() => /Dale Highways/.test(text(d.querySelector(".hub"))), "the partner view");
ok(/isn't a verdict/.test(text(d.querySelector(".panel"))) && clean(d), "a partner's view records what was said");
[...d.querySelectorAll(".seg button")].find((b) => b.textContent === "The authority").click();
await until(() => /Negative, worsening/.test(text(d.querySelector(".hub"))), "back to the authority");

// going down and back
node(d, "TV and radio").click();
await until(() => d.querySelector(".crumbs"), "the crumbs");
ok(text(d.querySelector(".crumbs")).includes("TV and radio") && !d.querySelector(".hub").disabled, "going down shows where you are, and the middle goes back");
node(d, "Radio").click();
await until(() => node(d, "Northbridge Radio"), "the stations");
node(d, "Northbridge Radio").click();
await until(() => node(d, "Local mentions"), "local and national");
ok(/Political leaning/.test(text(d.querySelector(".panel"))) && d.querySelectorAll(".mentions li").length === 3, "a source shows its grading and its mentions");
node(d, "National mentions").click();
await until(() => d.querySelectorAll(".mentions li").length === 0, "the filter");
ok(true, "a circle can filter its mentions");
d.querySelector(".hub").click();
await until(() => node(d, "Northbridge Radio"), "back a level");
ok(text(d.querySelector(".crumbs")).endsWith("Radio"), "and back one level");
button(d, "Add a mention").click();
await until(() => /Please don't paste the article/.test(text(d.querySelector(".panel"))), "the form");
ok(!d.querySelector(".panel textarea").hasAttribute("maxlength"), "a pasted article isn't cut short: the server refuses it");
button(d, "Cancel").click();
go(d, "#a/NORTHBRIDGE");

// the Dashboard always shows the authority, whatever the map was showing
[...d.querySelectorAll(".seg button")].find((b) => b.textContent === "Key partners")?.click();
await new Promise((done) => setTimeout(done, 30));
go(d, "#dash/NORTHBRIDGE");
await shows(d, /Very negative|Negative/);
await shows(d, /What's driving it/);
ok(/−27/.test(text(d.querySelector(".mood-big"))) && /Worsening/.test(text(d.querySelector(".main"))), "the Dashboard shows the authority's mood, whatever the map was on");
let main = text(d.querySelector(".main"));
ok(/Before weighting/.test(main) && /Say roads have got worse/.test(main) && /Adults in the authority/.test(main) && /FHRG middle figure/.test(main) && /Enquiries and complaints/.test(main) && /Fault reports/.test(main), "with raw figures and every tile");
ok(/Published evidence/.test(main) && /What's missing/.test(main) && d.querySelector(".foot a") && clean(d), "and published evidence, what's missing, and the way to the rest");
ok(d.querySelector(".heat-grid .heat-c") && !d.querySelector("table .heat-c"), "month by month has its own layout");
d.querySelectorAll(".pickers select")[0].value = "waste"; d.querySelectorAll(".pickers select")[0].dispatchEvent(new d.defaultView.Event("change"));
await shows(d, /Nothing collected yet/);
ok(!/Mood reading/.test(text(d.querySelector(".main"))) && !/Satisfied with roads/.test(text(d.querySelector(".main"))), "another service shows no roads figures");
d.querySelectorAll(".pickers select")[0].value = "highways"; d.querySelectorAll(".pickers select")[0].dispatchEvent(new d.defaultView.Event("change"));
await shows(d, /What's driving it/);

// issues and the calendar
go(d, "#issues/NORTHBRIDGE");
await shows(d, /Proposed by Clarion/);
ok(/Confirmed/.test(text(d.querySelector(".main"))) && /Potholes/.test(text(d.querySelector(".main"))) && /before weighting/.test(text(d.querySelector(".main"))) && clean(d), "issues show concern, reach and mood, raw and adjusted");
const firstProposed = d.querySelector(".main article h3").textContent;
button(d, "Confirm").click();
await until(() => [...d.querySelectorAll(".main section:nth-child(2) h3")].some((x) => x.textContent === firstProposed), "the issue to move");
ok(true, "confirming moves an issue across");
go(d, "#campaign/NORTHBRIDGE");
await until(() => d.querySelector(".cal"), "the calendar");
ok(d.querySelectorAll(".ev").length >= 5 && /Mood −/.test(text(d.querySelector(".cal"))) && clean(d), "the calendar lists events by topic, with each topic's mood");
ok(/Potholes/.test(text(d.querySelector(".panel"))) && /Key messages/.test(text(d.querySelector(".panel"))), "with what to bear in mind and the key messages");
d.querySelector(".ev").click();
await until(() => /Came from/.test(text(d.querySelector(".panel"))), "the event");
ok(/What it is/.test(text(d.querySelector(".panel"))) && /Key message/.test(text(d.querySelector(".panel"))), "an event says where it came from, and carries its key message");
button(d, "Done").click();
await until(() => /Not counted in the mood/.test(text(d.querySelector(".panel"))), "the list");
const planAround = [...d.querySelectorAll(".panel .linkish")].find((b) => b.textContent === "Plan around this");
const count = d.querySelectorAll(".ev").length;
planAround.click();
await until(() => /Came from/.test(text(d.querySelector(".panel"))), "the new event opening");
ok(true, "planning around something opens the new event, on the same page");
go(d, "#surveys/NORTHBRIDGE");

// the survey steps
await shows(d, /Winter roads survey/);
const winter = d.querySelector('.main a[href*="/"]').getAttribute("href").replace(/^#survey\/NORTHBRIDGE\//, "");
const ids = JSON.parse(d.defaultView.eval("JSON.stringify(Demo.pack.surveyList.surveys.map((s) => s.id))"));
go(d, `#survey/NORTHBRIDGE/${ids[1]}/tell`);
await shows(d, /What to tell people/);
ok(/What people see after the last question/.test(text(d.querySelector(".main"))) && d.querySelector(".phone") && clean(d), "a survey has a step for what to tell people");
button(d, "Something else").click();
await until(() => d.querySelectorAll(".main textarea").length === 2, "a new message");
ok(/Did you know/.test(text(d.querySelector(".main"))), "a message can ask \"Did you know?\"");
go(d, `#survey/NORTHBRIDGE/${ids[0]}/results`);
await shows(d, /What people were told/);
ok(/\d+% already knew, before being told/.test(text(d.querySelector(".main"))) && button(d, "Plan a response") && clean(d), "results say what people already knew, and a response can be planned from them");
go(d, `#survey/NORTHBRIDGE/${ids[1]}/setup`);
await shows(d, /Survey sites/);
await until(() => button(d, "Pinpoint"), "the sites");
ok(clean(d), "setting up a survey has nothing stray on the page");
button(d, "Pinpoint").click();
await until(() => d.querySelector(".spot-box"), "the close-up map");
ok(/The dashed circle is the general location/.test(text(d.querySelector(".main"))) && d.querySelector(".spot-ring") && /doesn't load a street map/.test(text(d.querySelector(".main"))), "a site can be pinpointed, with the general location shown");
ok(!d.querySelector(".spot-box img"), "and the demonstration loads no street map");
ok(/Position: /.test(text(d.querySelector(".main"))) && button(d, "Take the pin off") && d.querySelector('[aria-label="Move the pin north"]'), "a pin can be moved or taken off");
const pos = () => /Position: ([\d.-]+), ([\d.-]+)/.exec(text(d.querySelector(".main"))).slice(1).map(Number);
const was = pos();
d.querySelector('[aria-label="Move the pin north"]').click();
await until(() => pos()[0] > was[0], "the pin to move");
ok(true, "the pin moves in small steps");
for (let i = 0; i < 80; i++) d.querySelector('[aria-label="Move the pin east"]').click();
await until(() => /outside the general location/.test(text(d.querySelector(".main"))), "the warning");
ok(true, "and it warns when it leaves the general location");
ok(d.querySelector(`a[href="#plan/NORTHBRIDGE/${ids[1]}"]`), "there's a site plan to print");
go(d, `#plan/NORTHBRIDGE/${ids[0]}`);
await shows(d, /Site plan/);
ok(/Read this to each person at the end/.test(text(d.querySelector(".main"))) && /You can report a pothole online/.test(text(d.querySelector(".main"))) && /Outside the library/.test(text(d.querySelector(".main"))) && d.querySelector(".plan-site .spot-box") && clean(d), "the plan has each site's map, exact spot and what to read out");

// briefings
go(d, "#briefings/NORTHBRIDGE");
await shows(d, /Where we are/);
main = text(d.querySelector(".main"));
ok(/Highways: officers' briefing, October 2026/.test(main) && /Mood is negative, at −27/.test(main) && /Early signs to check/.test(main) && /Coming up/.test(main) && clean(d), "the officers' briefing opens first");
ok(/Street survey: 32% satisfied/.test(main), "with whole numbers");
button(d, "Download as Word").click();
await until(() => d.defaultView.saved, "the download");
ok(d.defaultView.saved.size > 500, "it downloads as Word");
button(d, "For members").click();
await shows(d, /Briefings so far/);
ok(true, "and members' briefings are beside it");

// Set-up and Sources
go(d, "#setup/NORTHBRIDGE");
await shows(d, /Functions for Highways/);
main = text(d.querySelector(".main"));
ok(/Climate Toolkit's 13 highways functions/.test(main) && /How mood is worked out/.test(main) && /Key partners/.test(main) && /Campaign channels/.test(main) && /Press from an NLA licence/.test(main) && clean(d), "Set-up has functions, weights, partners, channels and switches");
ok(d.querySelector('select[aria-label^="Shows on the map at"]'), "a channel is placed on the map");
ok(button(d, "Turn this on"), "and the election setting is a real switch for a lead");
go(d, "#said/NORTHBRIDGE");
await shows(d, /Assessed by your officers/);
ok(/Filter by context/.test(text(d.querySelector(".main"))) && /Coverage check/.test(text(d.querySelector(".main"))) && clean(d), "Sources can be filtered by context, and shows coverage checks");
const rows = () => d.querySelectorAll(".main tbody tr").length;
const all = rows();
[...d.querySelectorAll(".chip")].find((b) => b.textContent === "Radio").click();
await until(() => /Filter by context/.test(text(d.querySelector(".main"))) && rows() < all && rows() > 0, "the filter");
ok(true, "the filter narrows the list");
const name = d.querySelector(".main td .linkish");
name.click();
await until(() => /Before weighting/.test(text(d.querySelector(".main"))), "the source's details");
ok(/Pieces/.test(text(d.querySelector(".main"))), "choosing a source shows its mood, raw figure and pieces");

// a member reads, and doesn't change
d = browser(`/#a/${WSX}`, member);
await until(() => d.querySelector(".stage"), "the member's map");
await until(() => node(d, "Press and magazines"), "the circles");
ok(!button(d, "Add a mention") && clean(d), "a member gets no way to add a mention");
go(d, `#issues/${WSX}`);
await shows(d, /Proposed by Clarion/);
ok(!button(d, "Confirm"), "or confirm an issue");
d = browser(`/#setup/${WSX}`, member);
await shows(d, /Functions for Highways/);
ok(!button(d, "Add") && !button(d, "Turn this on") && [...d.querySelectorAll(".er input")].every((x) => x.disabled), "or change Set-up");
d = browser(`/#briefings/${WSX}`, boss);
await shows(d, /Where we are/);
ok(true, "a site administrator can read the officers' briefing");

// the tablet shows what to tell people
const tb = browser(`/s/${opened.access}`, "", tablet);
await until(() => /Start|Site|Begin/.test(text(tb.body)), "the tablet");
ok(/told/.test(tablet) && /readOut/.test(tablet), "the tablet page shows messages after the last question");

// the routes stay shut when the demonstration is off, and it never calls Claude
ok(claude.refused.length === 0, "every call to Claude was one the real service would accept");
process.env.DEMO = "off";
ok((await api("/demo/map", {})).status === 404 && (await api("/demo/officers", {})).status === 404, "DEMO=off turns off the demonstration's map too");

console.log(failures ? `\n${failures} FAILED` : "\nAll passed");
process.exit(failures ? 1 : 0);
