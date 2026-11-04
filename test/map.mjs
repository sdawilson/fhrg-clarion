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
ok(kid(map.tree, "weather").mood.ctx && kid(map.tree, "news").mood.ctx && kid(map.tree, "published").mood.ctx && kid(map.tree, "bylink").mood.ctx, "weather, news, published figures and replies by link aren't in the mood");
ok(map.considerations.some((x) => x.kind === "Weather") && map.considerations.some((x) => x.kind === "Council news") && map.considerations.some((x) => x.kind === "Published figures") && map.considerations.some((x) => x.kind === "Replies by link"), "they're things to bear in mind instead");
ok(map.considerations.every((x) => !/\d{4}-\d{2}-\d{2}/.test(`${x.title} ${x.sub}`)), "with dates in plain words");
ok(map.direction.word === "Worsening" && /kinds of signal agree/.test(map.direction.note), "a change is reported when two kinds of signal agree");
ok(t.demoMap({ month: "2026-11" }).direction.word === "Too early to say", "and it's too early to say in the current month");
ok(map.topics.filter((x) => x.proposed).length >= 2 && map.topics.filter((x) => x.proposed).length <= 3 && map.topics.filter((x) => x.proposed).every((x) => x.mood < 0), "Clarion proposes up to three issues with a negative mood");
ok(map.topics.find((x) => x.topic === "Relief Road closure").pieces === 6, "a partner's pieces stay out of an issue's figures until they're added");
ok(t.demoMap({ include: ["dale"] }).topics.find((x) => x.topic === "Relief Road closure").pieces === 10, "and come in with them");
ok(t.demoMap({ bias: "right" }).topics.find((x) => x.topic === "Potholes").pieces === map.topics.find((x) => x.topic === "Potholes").pieces, "the leaning filter doesn't change which issues are proposed");
ok(counted.reduce((n, k) => n + k.pct, 0) === 100, "the shares add up to exactly 100");
ok(map.heat.flatMap((r) => r.cells).some((c) => c.raw !== null) && map.tree.made.some((r) => r.raw !== null), "month by month and what makes up a mood carry the raw figure too");
ok(map.figures.enquiries === 1976 + 685 + 537 + 340 || map.figures.enquiries > 0, "the Dashboard's counts are figures in their own right");
ok(kid(map.tree, "enquiries").notes.some((n) => /6 largest/.test(n)), "and the enquiry circles say they're the largest few");
ok(t.demoOfficers({}).briefing.parts[1].bullets.every((b) => /before weighting/.test(b) || !/mood/.test(b)), "the officers' briefing gives raw figures beside adjusted ones");
ok(map.topics.every((x) => "raw" in x) && map.functions.every((x) => "raw" in x), "raw figures stay with the adjusted ones");
ok(t.demoMap({ bias: "right" }).pieces.length < map.pieces.length && t.demoMap({ bias: "right" }).pieces.every((p) => p), "the leaning filter narrows the pieces");
ok(t.demoMap({ topic: "Potholes" }).pieces.every((p) => p.topic === "Potholes") && t.demoMap({ topic: "Potholes" }).planned.length === 3, "a topic narrows pieces and actions");
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
ok(held.election === true && held.planned.length === 0, "the election setting takes actions off the map");
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
r = await api("/api/action/save", { code: WSX, title: "Pothole week", date: "2027-01-12", channel: "x", topics: ["Potholes"], origin: "Mention: Gazette" }, lead);
const item = r.action.id;
ok(item && r.action.origin === "Mention: Gazette" && r.action.campaign === "", "an action says where it came from, and needn't be in a campaign");
ok((await api("/api/action/save", { code: WSX, title: "", date: "2027-01-12" }, lead)).status === 400, "and needs a title");
ok((await api("/api/action/save", { code: WSX, title: "x", date: "soon" }, lead)).status === 400, "and a date");
ok((await api("/api/campaign/get", { code: WSX }, member)).actions.length === 1, "a member can read the calendar");
ok((await api("/api/campaign/get", { code: WSX, service: "waste" }, lead)).actions.length === 0, "which follows the service");

// ---- campaigns
const plan = (extra) => ({ code: WSX, name: "Pothole promise", topic: "Potholes", messages: ["We are fixing more."], start: "2027-01-01", end: "2027-02-28", budget: "12,500", ...extra });
ok((await api("/api/campaign/save", plan(), member)).status === 403, "a member can't start a campaign");
ok((await api("/api/campaign/save", plan({ name: "" }), lead)).status === 400 && (await api("/api/campaign/save", plan({ topic: "" }), lead)).status === 400, "a campaign needs a name and a topic");
ok((await api("/api/campaign/save", plan({ end: "" }), lead)).status === 400, "and an end date");
ok((await api("/api/campaign/save", plan({ end: "2026-12-01" }), lead)).status === 400, "that isn't before it starts");
ok((await api("/api/campaign/save", plan({ messages: ["a", "b", "c", "d", "e", "f"] }), lead)).status === 400, "and up to five key messages");
ok((await api("/api/campaign/save", plan({ budget: "lots" }), lead)).status === 400 && (await api("/api/campaign/save", plan({ budget: -5 }), lead)).status === 400, "a budget has to be a sum of money");
const promise = (await api("/api/campaign/save", plan(), lead)).campaign;
ok(promise.budget === 12500 && promise.messages[0] === "We are fixing more." && promise.ongoing === false, "a campaign holds its topic, key messages, dates and budget");
const act = (extra) => ({ code: WSX, title: "Radio piece", date: "2027-01-15", channel: "x", topics: ["Potholes"], campaign: promise.id, planned: "1,500.50", ...extra });
r = await api("/api/action/save", act(), lead);
const first = r.action;
ok(first.campaign === promise.id && first.planned === 1500.5 && first.actual === null, "an action belongs to a campaign, with a planned cost");
ok((await api("/api/action/save", act({ date: "2026-12-31" }), lead)).status === 400 && (await api("/api/action/save", act({ date: "2027-03-01" }), lead)).status === 400, "an action can't fall outside its campaign's dates");
ok(/outside Pothole promise/.test((await api("/api/action/save", act({ date: "2027-03-01" }), lead)).error), "and it says why");
ok((await api("/api/action/save", act({ date: "2027-01-01" }), lead)).action && (await api("/api/action/save", act({ date: "2027-02-28" }), lead)).action, "its first and last days are inside");
ok((await api("/api/action/save", { ...act(), planned: "a lot" }, lead)).status === 400, "a cost has to be a sum of money");
ok((await api("/api/action/save", act({ campaign: "nope" }), lead)).status === 404, "and the campaign has to exist");
r = await api("/api/campaign/save", plan({ id: promise.id, end: "2027-01-10" }), lead);
ok(r.status === 400 && /move them first/.test(r.error) && /Radio piece/.test(r.error), "shortening a campaign can't leave its actions outside it");
ok((await api("/api/campaign/remove", { code: WSX, id: promise.id }, lead)).status === 400, "and a campaign with actions can't be taken out, so no costs are lost");
ok((await api("/api/campaign/get", { code: WSX }, lead)).campaigns.find((x) => x.id === promise.id).end === "2027-02-28", "so it stays as it was");
ok((await api("/api/campaign/save", plan({ name: "Forever", ongoing: true, end: "" }), lead)).status === 400, "an ongoing campaign needs a review date");
const forever = (await api("/api/campaign/save", plan({ name: "Forever", ongoing: true, end: "", review: "2027-06-01", budgets: { "2026-27": "5,000", junk: "9" }, budget: "" }), lead)).campaign;
ok(forever.ongoing && forever.end === "" && forever.budgets["2026-27"] === 5000 && !("junk" in forever.budgets), "and a budget for each financial year");
ok((await api("/api/action/save", act({ campaign: forever.id, date: "2031-01-01" }), lead)).action?.campaign === forever.id, "and has no date limits");
const spare = (await api("/api/campaign/save", plan({ name: "Spare" }), lead)).campaign;
ok((await api("/api/campaign/remove", { code: WSX, id: spare.id }, lead)).ok && !(await api("/api/campaign/get", { code: WSX }, lead)).campaigns.some((x) => x.id === spare.id), "a campaign with no actions can be taken out");
ok((await api("/api/action/save", act({ service: "waste" }), lead)).status === 404, "and another service's campaign can't be used");
// money stays with the authority's own members
r = await api("/api/campaign/get", { code: WSX }, member);
ok(r.money === true && r.campaigns.find((x) => x.id === promise.id).budget === 12500 && r.actions.find((x) => x.id === first.id).planned === 1500.5, "the authority's own members can read the money");
r = await api("/api/campaign/get", { code: WSX }, boss);
ok(r.money === false && r.campaigns.every((x) => x.budget === null && !Object.keys(x.budgets).length) && r.actions.every((x) => x.planned === null && x.actual === null), "a site administrator from outside can't");
await api("/api/action/save", { ...act(), id: first.id, title: "Radio interview", planned: 1, actual: 2 }, boss);
await api("/api/campaign/save", plan({ id: promise.id, name: "Pothole promises", budget: 1 }), boss);
r = await api("/api/campaign/get", { code: WSX }, lead);
ok(r.actions.find((x) => x.id === first.id).title === "Radio interview" && r.actions.find((x) => x.id === first.id).planned === 1500.5 && r.actions.find((x) => x.id === first.id).actual === null, "and can't change it, though they can help with the rest");
ok(r.campaigns.find((x) => x.id === promise.id).name === "Pothole promises" && r.campaigns.find((x) => x.id === promise.id).budget === 12500, "on a campaign either");
await api("/api/campaign/save", plan({ id: promise.id }), lead);
const noMoney = JSON.stringify(await api("/api/map", { code: WSX }, lead)) + JSON.stringify(await api("/api/briefing/officers", { code: WSX }, lead));
ok(!/budget|1500\.5/.test(noMoney), "money isn't on the map or in the officers' briefing");
ok(!/budget/i.test(JSON.stringify(await api("/api/admin/overview", {}, boss))), "or in all authorities");
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10), tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const heldOne = (await api("/api/action/save", { code: WSX, title: "Already held", date: yesterday, topics: ["Potholes"], planned: 500 }, lead)).action;
const comingOne = (await api("/api/action/save", { code: WSX, title: "Still to come", date: tomorrow, topics: ["Potholes"] }, lead)).action;
// files from before campaigns
putText("clarion/authorities/E08000034/campaign.json", JSON.stringify({ issues: [{ topic: "Potholes", status: "confirmed", key: "An old message", service: "highways", own: false, by: "x", at: "x" }], items: [{ id: "old", title: "Old event", date: "2026-11-20", channel: "c", topics: ["Potholes"], service: "highways", origin: "", survey: "", by: "x", at: "x" }] }));
r = await api("/api/campaign/get", { code: "E08000034" }, kit);
ok(r.actions.length === 1 && r.actions[0].title === "Old event" && r.actions[0].campaign === "" && r.actions[0].planned === null && r.issues[0].key === "An old message", "what was saved before campaigns carries on");
ok((await api("/api/campaign/get", { code: "E08000034" }, lead)).status === 403, "and it's your own authority's");

// the election setting
await api("/api/briefing/election", { code: WSX, on: true }, lead);
r = await api("/api/campaign/get", { code: WSX }, lead);
ok(r.election === true && r.actions.length === 0 && r.campaigns.length === 0 && r.issues.every((x) => x.key === ""), "the election setting holds back campaigns, actions and key messages");
ok((await api("/api/map", { code: WSX }, lead)).planned.length === 0, "on the map too");
ok((await api("/api/action/save", { code: WSX, title: "x", date: "2027-01-12" }, lead)).status === 409 && (await api("/api/issue/set", { code: WSX, topic: "Potholes" }, lead)).status === 409 && (await api("/api/action/remove", { code: WSX, id: item }, lead)).status === 409, "and nothing can be changed");
ok((await api("/api/campaign/save", plan(), lead)).status === 409 && (await api("/api/campaign/remove", { code: WSX, id: promise.id }, lead)).status === 409, "campaigns included");
ok(r.held.length === 1 && r.held[0].title === "Already held" && Object.keys(r.held[0]).sort().join() === "actual,date,id,planned,title", "but actions already held are listed, for their costs");
ok((await api("/api/campaign/get", { code: WSX }, boss)).held.length === 0, "for the authority's own members only");
ok((await api("/api/action/actual", { code: WSX, id: heldOne.id, actual: "480" }, lead)).action.actual === 480, "so what one really cost can still be added");
ok((await api("/api/action/actual", { code: WSX, id: comingOne.id, actual: "1" }, lead)).status === 409, "but not for one that hasn't happened");
ok((await api("/api/action/actual", { code: WSX, id: heldOne.id, actual: "1" }, boss)).status === 403 && (await api("/api/action/actual", { code: WSX, id: heldOne.id, actual: "1" }, member)).status === 403, "or by anyone but the authority's own leads");
ok(!(await api("/api/campaign/get", { code: WSX }, lead)).actions.length, "and the campaign stays held back");
await api("/api/briefing/election", { code: WSX, on: false }, lead);
r = await api("/api/campaign/get", { code: WSX }, lead);
ok(r.actions.length > 1 && r.campaigns.some((x) => x.id === promise.id) && r.actions.find((x) => x.id === heldOne.id).actual === 480 && r.issues.find((x) => x.topic === "Potholes").key === "We are fixing more.", "it all comes back when it's off");

// ---- petitions and questions
const Q = await api("/api/map", { code: WSX, month }, lead);
ok((await api("/api/rate", { code: WSX, key: "petition|A", tone: "Critical" }, member)).status === 403, "a member can't rate a petition");
ok((await api("/api/rate", { code: WSX, key: "something|else", tone: "Critical" }, lead)).status === 400, "and only petitions and questions can be rated");
ok((await api("/api/rate", { code: WSX, key: "petition|A", tone: "Critical" }, lead)).ok === true && JSON.parse(getText(`clarion/authorities/${WSX}/ratings.json`))["petition|A"] === "Critical", "an officer's rating is kept");
const mapWith = (rated, monthly, questions = []) => t.buildMap({ ...t.demoMap && baseData(), rated, monthly, questions }, t.readFilters({}, "2026-11-02", []));
const nothing = t.buildMap(baseData(), t.readFilters({}, "2026-11-02", []));
ok(nothing.tree.mood.txt === "–" && nothing.tree.mood.v === null && !nothing.tree.mood.ctx, "an authority with nothing held shows no mood, rather than a count that looks like one");
ok(kid(nothing.tree, "news").mood.lean === "none", "and nothing to bear in mind");
const onlyNews = t.buildMap({ ...baseData(), posts: [{ title: "A post", date: "2026-10-10", topic: "" }] }, t.readFilters({}, "2026-11-02", []));
ok(onlyNews.tree.mood.txt === "–" && kid(onlyNews.tree, "news").mood.txt === "1", "nor does holding only things to bear in mind give it a mood");
const even = t.buildMap({ ...baseData(), weights: { surveys: 1, contact: 1, print: 0, broadcast: 0, social: 0, events: 1 }, streets: [point("2026-10-10", 60, 20)], questions: [{ date: "2026-10-09", heading: "Roads" }], rated: { "question|2026-10-09|Roads": "Critical" }, notes: [{ id: "n", title: "T", date: "2026-10-05", effect: 20, topic: "", routes: [] }] }, t.readFilters({}, "2026-11-02", []));
ok(even.tree.kids.filter((k) => k.pct !== null).length === 3 && even.tree.kids.reduce((n, k) => n + (k.pct ?? 0), 0) === 100, "three equal shares still add up to 100");
let m = t.buildMap({ ...baseData(), unread: ["FixMyStreet"] }, t.readFilters({}, "2026-11-02", []));
ok(m.tree.notes.some((n) => /Couldn't be read just now: FixMyStreet/.test(n)) && m.unread.join() === "FixMyStreet", "the map says when a feed wasn't read");
// a source graded by band
const band = (name, reachBand, reach = null) => ({ id: name, name, type: "Local Newspaper", domain: "", reach, reachUnit: "", reachBand, reachFrom: "", platform: "", leaning: "Not known", stance: "Balanced", campaign: [], added: "", by: "" });
const bp = (source, tone, i) => ({ id: `${source}${i}`, source, date: "2026-10-10", summary: "x", topic: "Potholes", relevance: "High", tone, prominence: "Inside page", functions: [], reach: null, by: "x", at: "2026-01-01T00:00:00Z" });
const banded = t.buildMap({ ...baseData(), sources: [band("big", "Large"), band("small", "", 500)], assessments: [...[1, 2, 3].map((i) => bp("big", "Critical", i)), ...[1, 2, 3].map((i) => bp("small", "Supportive", i))] }, t.readFilters({}, "2026-11-02", []));
ok(kid(banded.tree, "press").mood.v < -20, "a source graded Large with no figure counts as large");
ok(banded.topics[0].reach >= 600000, "and its reach counts towards an issue");
// part of a month
const partly = { ...baseData(), enquiries: { "2026-08": { total: 900, byTopic: {} }, "2026-09": { total: 900, byTopic: {} }, "2026-10": { total: 900, byTopic: {} }, "2026-11": { total: 300, byTopic: { Potholes: 300 } } }, works: { on: true, weeks: [{ week: "2026-11-09", public: 40 }], events: [] } };
m = t.buildMap(partly, t.readFilters({ month: "2026-11" }, "2026-11-02", []));
ok(kid(m.tree, "enquiries").mood.v === null && /too early/.test(kid(m.tree, "enquiries").mood.tip) && kid(m.tree, "enquiries").mood.txt === "300", "part of a month isn't compared with whole ones");
ok(kid(m.tree, "works").mood.v === null, "for works either");
ok(kid(m.tree, "enquiries").kids.every((k) => k.mood.v === null) && m.figures.enquiries === 300 && m.figures.enquiryChange === null, "or for each topic, and the count still shows");
// a survey of another service
const wasteDay = { id: "w", title: "Bins", status: "closed", ran: "2026-10-10", current: true, responses: 400, weighted: true, satisfied: 25, dissatisfied: 75, better: null, worse: null, blameCouncil: null, topics: [], note: "", selfOnly: false, service: "waste", groups: [], byLink: { n: 0, sat: null } };
m = t.buildMap({ ...baseData(), streets: [{ ...wasteDay, questions: [{ id: "c1", text: "Roads", fn: "", topic: "", sat: 25, dis: 75 }] }] }, t.readFilters({ service: "waste" }, "2026-11-02", []));
ok(kid(m.tree, "street").mood.v === null && !kid(m.tree, "street").kids.length, "a roads answer isn't taken for another service's mood");
m = t.buildMap({ ...baseData(), streets: [{ ...wasteDay, questions: [{ id: "l1", text: "Collections", fn: "", topic: "", sat: 70, dis: 20 }] }] }, t.readFilters({ service: "waste" }, "2026-11-02", []));
ok(kid(m.tree, "street").mood.v === 50, "its own local questions are");
function baseData() { return { today: "2026-11-02", unread: [], setup: { functions: { highways: [] }, partners: [], channels: [] }, weights: { surveys: 40, contact: 20, print: 15, broadcast: 10, social: 10, events: 5 }, topics: [], sources: [], assessments: [], streets: [], adults: null, ageAdults: null, residents: null, enquiries: {}, monthly: {}, questions: [], rated: {}, announcements: [], works: { on: false, weeks: [], events: [] }, notes: [], posts: [], published: [], plans: { issues: [], campaigns: [], actions: [] }, election: false, channels: [], ages: [] }; }
const pet = (title, above = true) => ({ title, local: 500, above });
m = mapWith({}, { "2026-09": { perDay: null, reports: 0, petitions: [] }, "2026-10": { perDay: null, reports: 0, petitions: [pet("New one")] } });
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

// what's kept month by month, as the feeds show only now
let months = t.mergedMonths({}, { month: "2026-10", now: { perDay: 2, reports: 40, petitions: [pet("One")] }, questions: [{ date: "2026-09-02", heading: "A" }, { date: "2026-10-02", heading: "B" }] });
ok(months["2026-10"].reports === 40 && months["2026-09"].questions[0].heading === "A" && months["2026-10"].questions[0].heading === "B", "each question is kept under its own month");
months = t.mergedMonths(months, { month: "2026-10", now: { perDay: 3, reports: 50 }, questions: [{ date: "2026-10-02", heading: "B" }] });
ok(months["2026-10"].petitions.length === 1 && months["2026-10"].reports === 50 && months["2026-10"].questions.length === 1, "a feed that couldn't be read leaves what it last said, and nothing is kept twice");
months = t.mergedMonths(Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`2025-${String((i % 12) + 1).padStart(2, "0")}-${i}`, { perDay: 1, reports: 1 }])), { month: "2026-10", now: {}, questions: [] });
ok(Object.keys(months).length <= 14 && months["2026-10"], "and only so many months are kept");
await api("/api/map", { code: WSX }, lead);
ok(Object.values(JSON.parse(getText(`clarion/authorities/${WSX}/monthly.json`))).some((x) => x.reports !== undefined), "a load keeps what the feeds said");

// direction: two up and two down isn't a change
function point(ran, sat, dis) { return { id: "s", title: "S", status: "closed", ran, current: true, responses: 400, weighted: true, satisfied: sat, dissatisfied: dis, better: null, worse: null, blameCouncil: null, topics: [], note: "", selfOnly: false, service: "highways", questions: [], groups: [], byLink: { n: 0, sat: null } }; }
m = t.buildMap({ ...baseData(), enquiries: { "2026-06": { total: 100, byTopic: {} }, "2026-07": { total: 100, byTopic: {} }, "2026-08": { total: 100, byTopic: {} }, "2026-09": { total: 100, byTopic: {} }, "2026-10": { total: 100, byTopic: {} } } }, t.readFilters({}, "2026-11-02", []));
ok(m.direction.word === "No change reported", "nothing moving reports no change");
const paper = { id: "p", name: "Paper", type: "Local Newspaper", domain: "", reach: 20000, reachUnit: "copies", reachBand: "", reachFrom: "", platform: "", leaning: "Not known", stance: "Balanced", campaign: [], added: "", by: "" };
const said = (date, tone, i) => ({ id: `${date}-${i}`, source: "p", date, summary: "x", topic: "Potholes", relevance: "High", tone, prominence: "Inside page", functions: [], reach: 20000, by: "x", at: "2026-01-01T00:00:00Z" });
const steady = Object.fromEntries(["2026-06", "2026-07", "2026-08", "2026-09"].map((k) => [k, { total: 100, byTopic: {} }]));
const both = { ...baseData(), sources: [paper], assessments: [...[1, 2, 3, 4, 5].map((i) => said("2026-09-10", "Critical", i)), ...[1, 2, 3, 4, 5].map((i) => said("2026-10-10", "Supportive", i))], streets: [point("2026-10-10", 60, 20), point("2026-09-10", 40, 40)], enquiries: { ...steady, "2026-10": { total: 200, byTopic: {} } }, questions: [{ date: "2026-10-09", heading: "Roads" }], rated: { "question|2026-10-09|Roads": "Critical" } };
m = t.buildMap(both, t.readFilters({}, "2026-11-02", []));
ok(m.direction.word === "No change reported" && /pulling both ways/.test(m.direction.note), "two signals up and two down isn't a change");
m = t.buildMap({ ...both, questions: [], rated: {}, streets: [] }, t.readFilters({}, "2026-11-02", []));
ok(m.direction.word === "No change reported" && /needs two kinds/.test(m.direction.note), "one up and one down isn't either");
m = t.buildMap({ ...both, streets: [point("2026-10-10", 20, 60), point("2026-09-10", 40, 40)], assessments: [...[1, 2, 3, 4, 5].map((i) => said("2026-09-10", "Supportive", i)), ...[1, 2, 3, 4, 5].map((i) => said("2026-10-10", "Critical", i))] }, t.readFilters({}, "2026-11-02", []));
ok(m.direction.word === "Worsening" && /Four kinds of signal agree/.test(m.direction.note), "and when they all agree, it says so");

// ---- a survey tells people things
ok(t.readTell([{ text: "  Report a pothole online. ", topic: "Potholes", how: ["Printed on the form", "nonsense"], aware: true }])[0].how.join() === "Printed on the form", "a message keeps only real ways of telling people");
let threw = ""; try { t.readTell([{ text: "" }]); } catch (e) { threw = e.message; }
ok(/no wording/.test(threw), "and needs wording");
threw = ""; try { t.readTell([{ text: "x".repeat(241) }]); } catch (e) { threw = e.message; }
ok(/too long/.test(threw), "a message that's too long is refused, not cut short in front of the public");
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
const told = r.actions.filter((x) => x.survey === made.id);
ok(told.length === 1 && told[0].topics.join() === "Potholes" && told[0].campaign === forever.id, "a message tied to a topic shows on the calendar as an action in a running campaign, and can open its survey");
await api("/api/survey/save", { code: WSX, id: made.id, tell: [{ text: "You can report a pothole online.", topic: "Potholes", how: ["Read out by the interviewer", "On the tablet after the last question"], aware: true }, { text: "Diversions are on one page.", topic: "", how: ["On the page after replying by link", "Printed on the form"], aware: false }] }, lead);
ok((await api("/api/campaign/get", { code: WSX }, lead)).actions.filter((x) => x.survey === made.id).length === 1, "saved again, it doesn't appear twice");
await api("/api/briefing/election", { code: WSX, on: true }, lead);
ok((await api("/api/survey/save", { code: WSX, id: made.id, tell: [] }, lead)).status === 409, "messages can't change during the election setting");
r = await api("/api/survey/get", { code: WSX, id: made.id }, member);
ok(!r.survey.tell.length && !r.questions.some((q) => /^k\d/.test(q.id)) && !/report a pothole online/.test(JSON.stringify(r)), "and a survey's page holds them back");
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

// a survey or a piece on another service stays out of the road figures
const bins = (await api("/api/survey/list", { code: WSX }, lead)).surveys.find((s) => s.title === "Bins");
const binsCode = (await api("/api/survey/status", { code: WSX, id: bins.id, status: "open" }, lead)).survey.access;
await api("/api/s/submit", { access: binsCode, forms: Array.from({ length: 40 }, (_, i) => ({ client: `b${i}`, site: "", secs: 200, answers: { c1: "Very dissatisfied" } })) });
r = await api("/api/authority", { code: WSX }, lead);
ok(r.evidence.streets.every((x) => x.title !== "Bins"), "a survey of another service isn't a road survey");
ok((await api("/api/admin/overview", {}, boss)).authorities.find((x) => x.code === WSX).street?.title !== "Bins", "for all authorities either");
const other = (await api("/api/map", { code: WSX }, lead)).topicList.find((x) => x !== "Potholes" && x !== "Our own worry");
const wastePiece = (await api("/api/coverage/assess", piece({ service: "waste", topic: other }), lead)).assessment;
ok(wastePiece?.service === "waste", "a piece can be on another service");
ok(!(await api("/api/coverage/summary", { code: WSX }, lead)).summary.topics.some((x) => x.topic === other), "and it isn't in the summary of roads");
const attention = await api("/api/attention", { code: WSX }, lead);
ok(!(attention.topics ?? []).some((x) => x.topic === other && x.attention), "or in attention and concern");
const signals = await t.ownSignals(t.getConfig(), t.PILOTS.find((x) => x.code === WSX));
ok(!signals.said.some((x) => x.topic === other), "or in what a mood reading and a briefing are given");
ok((await api("/api/coverage/get", { code: WSX, service: "waste" }, lead)).rows.every((x) => x.topic === other) && !(await api("/api/coverage/get", { code: WSX }, lead)).rows.some((x) => x.topic === other), "and the Sources page follows the service");

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
ok(r.briefing.parts.map((p) => p.heading).join() === "Where we are,High-impact issues,Campaigns,Early signs to check,Coming up,Bear in mind for campaigns,What's missing", "it has seven parts");
ok(/We are fixing more/.test(JSON.stringify(r.briefing)), "with confirmed issues, and campaigns and their key messages");
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
d.querySelector(".panel textarea").value = "Half typed";
[...d.querySelectorAll(".chip")].find((b) => b.textContent === "Left").click();
await until(() => [...d.querySelectorAll(".chip")].find((b) => b.textContent === "Left").getAttribute("aria-pressed") === "true", "the filter");
ok(d.querySelector(".panel textarea").value === "Half typed", "a half-typed mention survives a filter");
[...d.querySelectorAll(".chip")].find((b) => b.textContent === "All sources").click();
await until(() => [...d.querySelectorAll(".chip")].find((b) => b.textContent === "All sources").getAttribute("aria-pressed") === "true", "the filter back");
button(d, "Cancel").click();
go(d, "#a/NORTHBRIDGE");

// the Dashboard always shows the authority, whatever the map was showing
[...d.querySelectorAll(".seg button")].find((b) => b.textContent === "Key partners")?.click();
await new Promise((done) => setTimeout(done, 30));
go(d, "#dash/NORTHBRIDGE");
await shows(d, /Very negative|Negative/);
await shows(d, /What's driving it/);
ok(/−26/.test(text(d.querySelector(".mood-big"))) && /Worsening/.test(text(d.querySelector(".main"))), "the Dashboard shows the authority's mood, whatever the map was on");
let main = text(d.querySelector(".main"));
ok(/Before weighting/.test(main) && /\d+ before/.test(main) && /Street survey, indicative/.test(main) && /Say roads have got worse/.test(main) && /Adults in the authority/.test(main) && /FHRG middle figure/.test(main) && /Enquiries and complaints/.test(main) && /Fault reports/.test(main), "with raw figures and every tile");
ok(/Published evidence/.test(main) && /What's missing/.test(main) && d.querySelector(".foot a") && clean(d), "and published evidence, what's missing, and the way to the rest");
ok(d.querySelector(".heat-grid .heat-c") && !d.querySelector("table .heat-c"), "month by month has its own layout");
ok(d.querySelector(".quad radialGradient") && d.querySelector(".q-back").getAttribute("fill") === "url(#q-heat)" && /Early signs: felt, not reported/.test(text(d.querySelector(".quad"))), "the chart is shaded out from the early signs corner, and its labels still say what each part means");
d.querySelectorAll(".pickers select")[0].value = "waste"; d.querySelectorAll(".pickers select")[0].dispatchEvent(new d.defaultView.Event("change"));
await shows(d, /Nothing collected yet/);
ok(!/Mood reading/.test(text(d.querySelector(".main"))) && !/Satisfied with roads/.test(text(d.querySelector(".main"))), "another service shows no roads figures");
d.querySelectorAll(".pickers select")[0].value = "highways"; d.querySelectorAll(".pickers select")[0].dispatchEvent(new d.defaultView.Event("change"));
await shows(d, /What's driving it/);

// issues and the calendar
go(d, "#issues/NORTHBRIDGE");
await shows(d, /Proposed by Clarion/);
ok(/Confirmed/.test(text(d.querySelector(".main"))) && /Potholes/.test(text(d.querySelector(".main"))) && /before weighting/.test(text(d.querySelector(".main"))) && clean(d), "issues show concern, reach and mood, raw and adjusted");
ok(/Fixing potholes faster/.test(text(d.querySelector(".main"))) && [...d.querySelectorAll(".main a")].some((x) => x.textContent === "Start a campaign"), "and their campaigns, with a way to start one");
const firstProposed = d.querySelector(".main article h3").textContent;
button(d, "Confirm").click();
await until(() => [...d.querySelectorAll(".main section:nth-child(2) h3")].some((x) => x.textContent === firstProposed), "the issue to move");
ok(true, "confirming moves an issue across");
go(d, "#campaign/NORTHBRIDGE");
await until(() => d.querySelector(".cal"), "the calendar");
ok(d.querySelectorAll(".ev").length >= 4 && /Mood −/.test(text(d.querySelector(".cal"))) && /Fixing potholes faster/.test(text(d.querySelector(".cal"))) && clean(d), "the calendar lists actions by campaign, with each topic's mood");
ok(!/[Cc]ampaign events?\b/.test(text(d.getElementById("app"))), "they're called actions");
main = text(d.querySelector(".main"));
ok(/Budget/.test(main) && /£12,000/.test(main) && /£6,300/.test(main) && /£5,700/.test(main), "each campaign shows its budget, what's planned and what's left");
ok(/£20,000/.test(main) && /£3,250/.test(main) && /£14,250/.test(main), "what's left counts an actual cost once it's known");
const later = button(d, "Later");
later.click();
await until(() => /From Mon 30 Nov|From Mon 28 Dec/.test(text(d.querySelector(".cal"))) && !/From Mon 2 Nov/.test(text(d.querySelector(".cal"))), "the next weeks");
button(d, "Later").click();
await until(() => /From Mon 25 Jan/.test(text(d.querySelector(".cal"))) || /From Mon 28 Dec/.test(text(d.querySelector(".cal"))), "later weeks");
button(d, "Later").click();
await until(() => d.querySelector(".cal-c.off"), "weeks past the campaign's end");
ok(!d.querySelector(".cal-c.off .ev-add"), "weeks outside a campaign are marked, and nothing can be added to them");
for (let i = 0; i < 3; i++) { button(d, "Earlier").click(); await new Promise((done) => setTimeout(done, 15)); }
await until(() => /From Mon 2 Nov/.test(text(d.querySelector(".cal"))), "back to the start");
[...d.querySelectorAll(".cal-name")].find((b) => b.textContent === "Fixing potholes faster").click();
await until(() => /Key messages, one on each line/.test(text(d.querySelector(".panel"))), "the campaign");
ok(/Must|Budget/.test(text(d.querySelector(".panel"))) && /Its actions/.test(text(d.querySelector(".panel"))) && d.querySelector(".panel .scorebox"), "a campaign opens with its totals and its actions");
button(d, "Take it out").click();
await until(() => /Move or take out/.test(text(d.querySelector(".panel"))), "the refusal");
ok(true, "a campaign with actions can't be taken out");
button(d, "Cancel").click();
await until(() => button(d, "New campaign"), "the side panel");
button(d, "New campaign").click();
await until(() => /Key messages, one on each line/.test(text(d.querySelector(".panel"))), "the form");
const form = d.querySelector(".panel"), boxesOf = () => [...form.querySelectorAll("input, select, textarea")];
form.querySelector('input[type="checkbox"]').click();
await until(() => /Budget for 2026-27/.test(text(d.querySelector(".panel"))), "the ongoing form");
ok(/Budget for 2026-27/.test(text(form)) && [...form.querySelectorAll("label")].find((x) => /End date/.test(x.textContent)).hidden && ![...form.querySelectorAll("label")].find((x) => /Review date/.test(x.textContent)).hidden, "an ongoing campaign asks for a review date and a year's budget");
form.querySelector('input[type="checkbox"]').click();
boxesOf()[0].value = "Pavements first"; form.querySelector("select").value = "Pavements";
[...form.querySelectorAll("label")].find((x) => /End date/.test(x.textContent)).querySelector("input").value = "2027-03-31";
[...form.querySelectorAll("label")].find((x) => /^Budget/.test(x.textContent)).querySelector("input").value = "100";
button(d, "Save").click();
await until(() => /Pavements first/.test(text(d.querySelector(".cal"))), "the new campaign");
ok(/£100/.test(text(d.querySelector(".main"))), "a new campaign joins the calendar, with its budget");
const pavedRow = [...d.querySelectorAll(".cal-r")].find((x) => /Pavements first/.test(x.textContent));
const addHere = d.querySelector(`.ev-add[aria-label^="Add to Pavements first"]`);
addHere.click();
await until(() => /Must fall within/.test(text(d.querySelector(".panel"))), "the new action");
const costBox = [...d.querySelectorAll(".panel label")].find((x) => /Planned cost/.test(x.textContent)).querySelector("input");
costBox.value = "250"; costBox.dispatchEvent(new d.defaultView.Event("change"));
await until(() => /£150 over/.test(text(d.querySelector(".main"))), "the overspend");
ok(true, "costs add up to the campaign, and an overspend shows before it happens");
const dateBox = [...d.querySelectorAll(".panel label")].find((x) => /^Date/.test(x.textContent)).querySelector("input"), wasDate = dateBox.value;
dateBox.value = "2030-01-01"; dateBox.dispatchEvent(new d.defaultView.Event("change"));
await new Promise((done) => setTimeout(done, 40));
ok([...d.querySelectorAll(".panel label")].find((x) => /^Date/.test(x.textContent)).querySelector("input").value === wasDate, "a date outside the campaign doesn't stick");
button(d, "Done").click();
await until(() => /Not counted in the mood/.test(text(d.querySelector(".panel"))), "the list");
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
ok([...d.querySelectorAll(".main .chip")].some((b) => /^Key message: We are repairing more potholes/.test(b.textContent)) && [...d.querySelectorAll(".main .chip")].some((b) => /^Key message: We will tell you about roadworks/.test(b.textContent)), "a survey can use a campaign's key messages");
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
const was = pos(), mapEl = d.querySelector(".spot-box");
d.querySelector('[aria-label="Move the pin north"]').click();
await until(() => pos()[0] > was[0], "the pin to move");
ok(d.querySelector(".spot-box") === mapEl, "the pin moves in small steps, and the map stays as it was");
for (let i = 0; i < 80; i++) d.querySelector('[aria-label="Move the pin east"]').click();
await until(() => /outside the general location/.test(text(d.querySelector(".main"))), "the warning");
ok(true, "and it warns when it leaves the general location");
ok(d.querySelector(`a[href="#plan/NORTHBRIDGE/${ids[1]}"]`), "there's a site plan to print");
const pinned = () => /General location only/.test(text(d.querySelector(".site-entry"))) === false;
ok(pinned(), "a pinned site says so");
[...d.querySelectorAll(".seg button")].find((b) => b.textContent === "99%").click();
await new Promise((done) => setTimeout(done, 20));
ok(d.querySelectorAll(".site-entry").length && pinned(), "and changing the level doesn't lose it");
go(d, `#plan/NORTHBRIDGE/${ids[0]}`);
await shows(d, /Site plan/);
ok(/Read this to each person at the end/.test(text(d.querySelector(".main"))) && /You can report a pothole online/.test(text(d.querySelector(".main"))) && /Outside the library/.test(text(d.querySelector(".main"))) && d.querySelector(".plan-site .spot-box") && clean(d), "the plan has each site's map, exact spot and what to read out");

// briefings
go(d, "#briefings/NORTHBRIDGE");
await shows(d, /Where we are/);
main = text(d.querySelector(".main"));
ok(/Highways: officers' briefing, October 2026/.test(main) && /Mood is negative, at −26/.test(main) && /Early signs to check/.test(main) && /Coming up/.test(main) && clean(d), "the officers' briefing opens first");
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

// several changes in a row are all saved
d = browser(`/#setup/${WSX}`, lead);
await shows(d, /Functions for Highways/);
await until(() => d.querySelectorAll(".er input").length > 3, "the rows");
const boxes = [...d.querySelectorAll(".card .er input")].filter((x) => !x.placeholder).slice(0, 3);
const renames = ["One", "Two", "Three"];
for (let i = 0; i < 3; i++) { boxes[i].value = renames[i]; boxes[i].dispatchEvent(new d.defaultView.Event("change")); await new Promise((done) => setTimeout(done, 30)); }
await until(async () => true, "the saves");
await new Promise((done) => setTimeout(done, 60));
const savedNames = (await api("/api/setup/get", { code: WSX }, lead)).setup.functions.highways.map((x) => x.name);
ok(renames.every((x) => savedNames.includes(x)), "renaming several in a row saves them all");
// what's been typed against a proposed site stays when the level changes
const fresh = (await api("/api/survey/new", { code: WSX, title: "Sites test" }, lead)).survey;
d = browser(`/#survey/${WSX}/${fresh.id}/setup`, lead);
await until(() => d.querySelectorAll(".site-entry").length >= 3, "the proposed sites");
[...d.querySelectorAll(".seg button")].find((b) => b.textContent === "±7").click();
await until(() => d.querySelectorAll(".site-entry").length >= 5, "more proposed sites");
const entries = [...d.querySelectorAll(".site-entry")], typed = entries.map((x, i) => { const box = x.querySelector(".site-row input"); box.value = `Saturday ${i}`; box.dispatchEvent(new d.defaultView.Event("input")); return box.value; });
[...d.querySelectorAll(".seg button")].find((b) => b.textContent === "±10").click();
await new Promise((done) => setTimeout(done, 30));
const after = [...d.querySelectorAll(".site-row input")].map((x) => x.value);
ok(typed.every((x) => after.includes(x)), "changing the level doesn't lose what's been typed against a site");
d = browser(`/#survey/${WSX}/${fresh.id}/setup`, lead);
await until(() => d.querySelectorAll(".site-entry").length >= 3 && button(d, "Pinpoint"), "the proposed sites again");
[...d.querySelectorAll(".seg button")].find((b) => b.textContent === "±7").click();
await until(() => d.querySelectorAll(".site-entry").length >= 5, "more proposed sites again");
const pins = [...d.querySelectorAll(".site-entry")];
pins.at(-1).querySelector("button[aria-pressed]").click();
await until(() => button(d, "Put the pin in the middle"), "the close-up map");
button(d, "Put the pin in the middle").click();
await until(() => /Position: /.test(text(d.querySelector(".main"))), "the pin");
const pinnedName = /Pinpoint the spot in (.+?)(?= Map|$)/.exec(d.querySelector(".spot-box").previousSibling.textContent)?.[1];
[...d.querySelectorAll(".seg button")].find((b) => b.textContent === "±10").click();
await new Promise((done) => setTimeout(done, 30));
ok(pinnedName && [...d.querySelectorAll(".site-name strong")].some((x) => x.textContent === pinnedName), "or a site that's been pinned");
// a double click plans one event
d = browser(`/#a/${WSX}`, lead);
await until(() => d.querySelector(".stage"), "the lead's map");
const planned0 = (await api("/api/campaign/get", { code: WSX }, lead)).actions.length;
d.defaultView.eval(`planFrom({ code: "${WSX}" }, "Potholes", "Test"); planFrom({ code: "${WSX}" }, "Potholes", "Test");`);
await until(() => d.querySelector(".cal"), "the calendar");
ok((await api("/api/campaign/get", { code: WSX }, lead)).actions.length === planned0 + 1, "a double click plans one action");
await api("/api/setup/save", { code: WSX, part: "functions", service: "highways", list: t.standardFunctions("highways") }, lead);

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

// the election setting in the demonstration
d = browser("/demo", "");
await until(() => d.querySelector(".stage"), "the map again");
d.defaultView.eval("Demo.election.on = true");
go(d, "#campaign/NORTHBRIDGE");
await until(() => /Campaigns, actions and key messages are held back/.test(text(d.querySelector(".main"))), "the held calendar");
ok(!d.querySelector(".ev") && !/Fixing potholes/.test(text(d.querySelector(".main"))) && /Actual costs for actions already held/.test(text(d.querySelector(".main"))) && /Diversions page launched/.test(text(d.querySelector(".main"))), "the election setting holds campaigns back, but past costs can still be added");

// the tablet shows what to tell people, once the last question is done
const tb = browser(`/s/${opened.access}`, "", tablet), tw = tb.defaultView;
await until(() => tw.eval("!!(S.survey && S.survey.questions)"), "the tablet");
tw.eval(`S.form = { client: "t1", site: "", started: Date.now(), answers: { c1: "Fairly satisfied" } }; finish();`);
await until(() => /Thank you/.test(text(tb.body)), "the end of the form");
ok(/Interviewer: please read this out/.test(text(tb.body)) && /You can report a pothole online/.test(text(tb.body)), "the tablet shows what to read out");
ok(/What West Sussex County Council would like you to know/.test(text(tb.body)), "and what the person can read for themselves");
const lk = browser(`/r/${self}`, "", tablet), lw = lk.defaultView;
await until(() => lw.eval("!!(S.survey && S.survey.questions)"), "the page for people with the link");
await lw.eval(`sendSelf({ client: "self-1", secs: 100, answers: { c1: "Fairly satisfied" }, postcode: "" })`);
await until(() => /Your answers have been sent/.test(text(lk.body)), "the reply to send");
ok(/Diversions are on one page/.test(text(lk.body)) && !/You can report a pothole online/.test(text(lk.body)), "someone replying by link sees only what's meant for that page");
ok(!/Diversions/.test(tablet), "and neither page holds any message of its own");

// the routes stay shut when the demonstration is off, and it never calls Claude
ok(claude.refused.length === 0, "every call to Claude was one the real service would accept");
process.env.DEMO = "off";
ok((await api("/demo/map", {})).status === 404 && (await api("/demo/officers", {})).status === 404, "DEMO=off turns off the demonstration's map too");

console.log(failures ? `\n${failures} FAILED` : "\nAll passed");
process.exit(failures ? 1 : 0);
