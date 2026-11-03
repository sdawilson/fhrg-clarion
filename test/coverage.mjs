// What's being said: the rules on their own, then the routes and the screens against the simulators.
import fs from "node:fs";
import { JSDOM } from "jsdom";
import { addUser, files, getText, search, until } from "./sim.mjs";
const { handleRequest } = await import("./.build/app.mjs");
const t = await import("./.build/internals.mjs");

let failures = 0;
const ok = (cond, what) => { console.log(`${cond ? "PASS" : "FAIL"}  ${what}`); if (!cond) failures++; };
const WSX = "E10000032", KIRK = "E08000034";

// ---- the rules
ok(t.cleanDomain("https://www.northbridgecourier.example/news/today?x=1") === "northbridgecourier.example" && t.cleanDomain("not a site") === "" && t.cleanDomain("javascript:alert(1)") === "", "a web address is reduced to its site, and anything else is dropped");
let threw = "";
try { t.readKeywords("one, two, three"); } catch (e) { threw = e.message; }
ok(/up to 2/.test(threw), "a check takes one or two keywords");
ok(t.readKeywords('potholes, "Moor Lane"').join("|") === "potholes|Moor Lane", "and quote marks can't change the search");

const critical = { stance: "Usually critical", campaign: ["Potholes"] }, friendly = { stance: "Usually supportive", campaign: [] }, balanced = { stance: "Balanced", campaign: ["Potholes"] };
const weight = (s, tone, topic = "Parking") => t.pieceWeight(s, { tone, topic }).factor;
ok(weight(critical, "Critical") === 0.5 && weight(critical, "Supportive") === 1.5 && weight(critical, "Neutral") === 1, "a usually critical source counts for less when it's critical, and more when it isn't");
ok(weight(friendly, "Critical") === 1.5 && weight(friendly, "Supportive") === 0.5, "and a friendly one turning critical counts for more");
ok(weight(balanced, "Critical", "Potholes") === 0.5 && weight(balanced, "Critical") === 1, "a topic the source is campaigning on counts half");
ok(weight(critical, "Critical", "Potholes") === 0.5 && weight(critical, "Supportive", "Potholes") === 1.5, "and stance and campaign are never both applied");

const rates = [{ measure: "m", age_from: 16, age_to: 29, value: 10, year: "2025" }, { measure: "m", age_from: 30, age_to: null, value: 40, year: "2025" }, { measure: "m", age_from: 16, age_to: null, value: 99, year: "2024" }];
const bands = t.bandRates(rates, "m");
ok(bands.length === 7 && bands[0] === 10 && bands[6] === 40 && bands[1] === 25, "rates in any age bands are fitted to Clarion's, and the latest year is used");
ok(t.bandRates(rates, "nothing") === null, "a measure with no figures says so");

const census = { adults: 700, cells: Object.fromEntries(["16 to 24", "25 to 34", "35 to 44", "45 to 54", "55 to 64", "65 to 74", "75 or over"].flatMap((age) => [[`${age}|Female`, 50], [`${age}|Male`, 50]])) };
const measures = [["Read news in a local printed newspaper in the last 12 months", [[16, 34, 5], [35, 54, 15], [55, null, 40]]], ["cycle: cycles at least once a week, any purpose", [[16, 54, 20], [55, null, 4]]], ["walk: walks at least once a week, any purpose", [[16, null, 70]]]];
const held = measures.flatMap(([measure, rows]) => rows.map(([age_from, age_to, value]) => ({ measure, age_from, age_to, value, year: "2025" })));
const print = t.audienceFor("Local Newspaper", census, held);
ok(print.known && print.overFiftyFive.audience > print.overFiftyFive.adults && Math.abs(print.audience.reduce((a, b) => a + b, 0) - 100) < 0.5, "a kind of source gets an age profile, here older than all adults");
ok(print.likelihoods.find((x) => x.label.startsWith("Cycles")).reading === "Lower" && print.likelihoods.find((x) => x.label.startsWith("Walks")).reading === "About the same", "and how likely that audience is to act, compared with all adults");
const none = t.audienceFor("Community Event", census, held);
ok(!none.known && /no published age profile/.test(none.note) && !none.likelihoods.length, "a kind of source with no figures says so, rather than guessing");
ok(t.audienceFor("Local Newspaper", null, held) === null && t.audienceFor("Local Newspaper", census, []) === null, "and with no Census or rates there's nothing to show");

const row = (date, topic, tone, relevance, reach, adjusted) => ({ date, topic, tone, relevance, reach, adjusted });
const sum = t.summariseCoverage([row("2026-10-30", "Potholes", "Critical", "High", 1000, 500), row("2026-10-20", "Potholes", "Neutral", "Some", 100, 100), row("2026-10-29", "Parking", "Critical", "None", 900, 900), row("2026-09-20", "Parking", "Neutral", "High", 50, 50), row("2026-06-01", "Parking", "Neutral", "High", 50, 50)], "2026-11-01");
ok(sum.pieces === 2 && sum.previous === 1 && sum.reach === 1100 && sum.adjusted === 600 && sum.topics.length === 1, "the last four weeks are counted against the four before, and a piece with no relevance doesn't count");

const sources = [{ id: "a", reach: 500 }];
const good = { source: "a", date: "2026-10-30", summary: "Item on repairs", topic: "Potholes", relevance: "High", tone: "Critical", prominence: "Inside page", functions: ["cw", "zz"] };
const made = t.readAssessment(good, sources, ["Potholes"], "Lee", "2026-11-01");
ok(made.reach === 500 && made.functions.join() === "cw" && made.by === "Lee", "an assessment takes the source's reach unless told otherwise");
const refused = (over) => { try { t.readAssessment({ ...good, ...over }, sources, ["Potholes"], "Lee", "2026-11-01"); return ""; } catch (e) { return e.message; } };
ok(/don't paste/.test(refused({ summary: "x".repeat(201) })), "a pasted article is refused");
ok(/future/.test(refused({ date: "2026-12-01" })) && /topic/.test(refused({ topic: "Nonsense" })) && /source/.test(refused({ source: "b" })) && /relevance/.test(refused({ tone: "Angry" })), "and so is anything that isn't a real choice");

// ---- through the API
await addUser(1, "lead@westsussex.gov.uk", "Lee Lead", 30, "lead");
await addUser(2, "member@westsussex.gov.uk", "Mo Member", 30, "member");
await addUser(3, "officer@kirklees.gov.uk", "Kit Officer", 20, "lead");
const api = async (path, body, token) => { const r = await handleRequest(new Request(`https://clarion.test${path}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { "x-session-token": token } : {}) }, body: JSON.stringify(body) })); return { status: r.status, ...(await r.json()) }; };
const login = async (email) => (await api("/api/login", { email, password: "pw" })).token;
const lead = await login("lead@westsussex.gov.uk"), member = await login("member@westsussex.gov.uk"), kirk = await login("officer@kirklees.gov.uk");

let r = await api("/api/coverage/get", { code: WSX });
ok(r.status === 401, "this needs a sign-in");
ok((await api("/api/coverage/get", { code: WSX }, kirk)).status === 403, "and it's only for your own authority");
r = await api("/api/coverage/get", { code: WSX }, member);
ok(r.ready && !r.canEdit && !r.searchReady && r.sources.length === 0 && r.automatic.length === 4, "a member can read it, and the automatic sources are listed");
ok(r.audiences["Local Newspaper"].known && r.audiences["Local Newspaper"].likelihoods.length === 5 && r.audiences["Local Newspaper"].likelihoods.every((x) => x.label !== "Likely to vote"), "with the audience worked out from the library");
ok((await api("/api/coverage/source", { code: WSX, name: "X", type: "Local Newspaper" }, member)).status === 403, "a member can't change the sources");
ok((await api("/api/coverage/source", { code: WSX, name: "", type: "Local Newspaper" }, lead)).status === 400 && (await api("/api/coverage/source", { code: WSX, name: "X", type: "Carrier pigeon" }, lead)).status === 400, "a source needs a name and a kind");

r = await api("/api/coverage/source", { code: WSX, name: "The Testhaven Courier", type: "Local Newspaper", domain: "https://www.testhavencourier.example/news", reach: "18,400", reachUnit: "copies", reachFrom: "ABC certificate", leaning: "Centre right", stance: "Usually critical", campaign: ["Potholes", "Made up"] }, lead);
const courier = r.source;
ok(courier.domain === "testhavencourier.example" && courier.reach === 18400 && courier.campaign.join() === "Potholes", "a source is saved, with its reach, stance and campaign");
const radio = (await api("/api/coverage/source", { code: WSX, name: "Regional TV", type: "Local Television", reachBand: "Medium", reachUnit: "copies" }, lead)).source;
ok(radio.reach === null && radio.reachBand === "Medium" && radio.reachUnit === "" && radio.leaning === "Not known" && radio.stance === "Balanced", "and one with no figure can have an estimate instead");
const changed = (await api("/api/coverage/source", { code: WSX, id: radio.id, name: "Regional TV news", type: "Local Television", reach: 90000, reachUnit: "viewers" }, lead)).source;
ok(changed.id === radio.id && changed.name === "Regional TV news" && changed.reach === 90000 && changed.reachBand === "", "a source can be changed");

r = await api("/api/coverage/assess", { code: WSX, source: courier.id, date: "2026-10-30", summary: "Front-page item on repairs", topic: "Potholes", relevance: "High", tone: "Critical", prominence: "Front page or lead", functions: ["cw", "cl"] }, lead);
ok(r.assessment.reach === 18400, "an assessment is saved");
ok((await api("/api/coverage/assess", { code: WSX, source: courier.id, date: "2026-10-30", summary: "x", topic: "Potholes", relevance: "High", tone: "Critical", prominence: "Inside page" }, member)).status === 403, "a member can't add one");
r = await api("/api/coverage/get", { code: WSX }, member);
ok(r.rows.length === 1 && r.rows[0].factor === 0.5 && r.rows[0].adjusted === 9200 && r.rows[0].reach === 18400 && r.rows[0].sourceName === "The Testhaven Courier", "raw and adjusted reach are both shown");
const assessed = r.rows[0].id;
ok((await api("/api/coverage/unsource", { code: WSX, id: courier.id }, lead)).status === 400, "a source with assessments can't be taken off");
ok((await api("/api/coverage/unsource", { code: WSX, id: radio.id }, lead)).status === 200 && (await api("/api/coverage/get", { code: WSX }, lead)).sources.length === 1, "one without can");
ok((await api("/api/coverage/get", { code: KIRK }, kirk)).sources.length === 0, "and another authority sees none of it");

// the search service
r = await api("/api/coverage/check", { code: WSX, keywords: ["potholes"] }, lead);
ok(r.status === 200 && r.ready === false && /find pieces yourself/.test(r.why) && search.calls.length === 0, "with no search key, Clarion says so and officers carry on");
process.env.SEARCH_KEY = "search-key-123";
const recent = new Date(Date.now() - 3 * 86400000).toISOString();
search.hits['site:testhavencourier.example "potholes"'] = [{ url: "https://www.testhavencourier.example/a", title: "SECRET HEADLINE", description: "SECRET EXTRACT", page_age: recent }, { url: "https://elsewhere.example/b", page_age: "2026-01-01T00:00:00" }];
search.hits['site:testhavencourier.example "Moor Lane"'] = [{ url: "https://testhavencourier.example/c", title: "Another" }];
r = await api("/api/coverage/check", { code: WSX, keywords: ["potholes", "Moor Lane"], days: 7 }, lead);
ok(r.ready && r.checks.length === 2 && r.checks[0].result === "Found" && r.checks[0].date === recent.slice(0, 10), "a check reports found and the date");
ok(r.checks[1].result === "Found, no date", "or found with no date");
ok(!/SECRET|https?:/.test(JSON.stringify(r)), "and no headline, extract or link comes back");
ok(search.calls[0].headers["X-Subscription-Token"] === "search-key-123" && /country=GB/.test(search.calls[0].url), "the key goes only to the search service");
ok(![...files().keys()].some((k) => k.includes("check")) && !JSON.stringify([...files().values()].map((v) => v)).includes("SECRET"), "and nothing from a search is stored");
r = await api("/api/coverage/check", { code: WSX, keywords: ["flooding"] }, lead);
ok(r.checks[0].result === "No match", "nothing found says no match");
const before = search.calls.length;
await api("/api/coverage/check", { code: WSX, keywords: ["flooding"] }, lead);
ok(search.calls.length === before, "the same check isn't asked twice in a morning");
ok((await api("/api/coverage/check", { code: WSX, keywords: ["flooding"] }, member)).status === 403, "members can't run checks");
ok((await api("/api/coverage/check", { code: KIRK, keywords: ["flooding"] }, kirk)).status === 400, "a source needs a web address before it can be checked");
search.status = 401;
r = await api("/api/coverage/check", { code: WSX, keywords: ["gritting"] }, lead);
ok(r.status === 502 && /SEARCH_KEY/.test(r.error), "a refused key is explained");
search.status = 500;
r = await api("/api/coverage/check", { code: WSX, keywords: ["cycling"] }, lead);
ok(r.ready && r.checks[0].result === "Not checked", "and a search that fails says it wasn't checked, not that nothing was found");
search.status = 200;
ok((await api("/api/coverage/unassess", { code: WSX, id: assessed }, member)).status === 403 && (await api("/api/coverage/unassess", { code: WSX, id: assessed }, lead)).status === 200, "only a lead can remove an assessment");

// ---- the screens
await api("/api/coverage/assess", { code: WSX, source: courier.id, date: "2026-10-30", summary: "Front-page item on repairs", topic: "Potholes", relevance: "High", tone: "Critical", prominence: "Front page or lead", functions: ["cw"] }, lead);
const page = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
async function open(token, hash) {
  const dom = new JSDOM(page, {
    url: `https://clarion.test/${hash}`, runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(w) {
      w.localStorage.setItem("clarion_token", token);
      w.scrollTo = () => {};
      w.fetch = async (url, opts = {}) => { const res = await handleRequest(new Request(new URL(url, "https://clarion.test").href, opts)); const text = await res.text(); return { ok: res.ok, status: res.status, json: async () => JSON.parse(text) }; };
    },
  });
  await until(() => dom.window.document.querySelector(".main .page > *"), "the page to start");
  return dom;
}
const text = (el) => el.textContent.replace(/\s+/g, " ");
const button = (d, name) => [...d.querySelectorAll("button")].find((b) => b.textContent === name);
const see = (d, pattern) => until(() => pattern.test(text(d.querySelector(".main"))), `the page to show ${pattern}`);
let dom = await open(lead, `#said/${WSX}`), d = dom.window.document, w = dom.window;
await see(d, /Latest assessments/);
let main = text(d.querySelector(".main"));
ok(/West Sussex: what's being said/.test(main) && !/Media Watch/.test(text(d.body.querySelector("#app"))), "the section has its new name, and the old one has gone");
ok(/Front-page item on repairs/.test(main) && /9,200/.test(main) && /18,400 copies/.test(main), "the latest assessments show raw and adjusted reach");
w.location.hash = `#said/${WSX}/sources`;
await see(d, /Checked automatically/);
main = text(d.querySelector(".main"));
ok(/The Testhaven Courier/.test(main) && /Usually critical/.test(main) && /GOV\.UK/.test(main) && /Automatic press searches/.test(main) && /Off/.test(main), "the sources page lists what's automatic, what's assessed, and the NLA option switched off");
const field = (label) => [...d.querySelectorAll(".field")].find((x) => x.firstChild?.textContent === label).querySelector("input, select");
field("Name").value = "Moorside News"; field("Name").dispatchEvent(new w.Event("input"));
field("Type").value = "Local Newsletter"; field("Type").dispatchEvent(new w.Event("change"));
button(d, "Add this source").click();
await see(d, /Moorside News/);
ok(/Add reach/.test(text(d.querySelector(".main"))), "a source with no reach is asked for it");
w.location.hash = `#said/${WSX}/assess`;
await see(d, /Record your assessment/);
main = text(d.querySelector(".main"));
ok(/Who this reaches/.test(main) && /Likely|Drives \(holds a licence\)/.test(main) && !/Likely to vote/.test(main), "assessing shows who the source reaches");
ok(/× 0\.5/.test(main) && /Campaigning on this topic/.test(main) && /9,200/.test(main), "and what allowing for the source does");
const check = button(d, "Check");
d.querySelector('input[aria-label="Keywords"]').value = "potholes";
check.click();
await see(d, /Found/);
ok(/keeps only yes or no and the date/.test(text(d.querySelector(".main"))) && /doesn't mean no coverage/.test(text(d.querySelector(".main"))), "a check explains what it can't show");
button(d, "Assess").click();
const summary = d.querySelector('input[aria-label="In one line, what was it about?"]');
ok(d.querySelector('input[type="date"]').value === recent.slice(0, 10), "assessing a result fills in its date");
summary.value = "A second item"; summary.dispatchEvent(new w.Event("input"));
button(d, "Save and next").click();
await see(d, /Choose its relevance/);
button(d, "Some").click(); button(d, "Critical").click(); button(d, "Inside page").click(); button(d, "Carriageways").click();
await see(d, /Usually critical, critical piece/);
button(d, "Save and next").click();
await see(d, /On to the next one/);
ok(summary.value === "" && d.querySelectorAll('.plates button[aria-pressed="true"]').length === 0, "saving clears the form for the next piece");
const saved = await api("/api/coverage/get", { code: WSX }, lead);
ok(saved.rows.length === 2 && saved.rows.some((x) => x.summary === "A second item" && x.functions.join() === "cw" && x.relevance === "Some"), "and the assessment is saved");
dom = await open(member, `#said/${WSX}`); d = dom.window.document;
await see(d, /Latest assessments/);
ok(!button(d, "Search and assess") && !button(d, "Remove") && button(d, "Sources"), "a member can read but not assess");

console.log(failures ? `\n${failures} FAILED` : "\nAll passed");
process.exit(failures ? 1 : 0);
