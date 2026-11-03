// What's being said: the rules on their own, then the routes and the screens against the simulators.
import fs from "node:fs";
import { JSDOM } from "jsdom";
import { addUser, files, getText, search, slowStorage, until } from "./sim.mjs";
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
const asSource = (over) => { try { return t.readSource({ name: "X", type: "Local Radio", ...over }, null, "Lee", "2026-11-01", []); } catch (e) { return e.message; } };
ok(/doesn't look right/.test(asSource({ domain: "not a site" })) && asSource({ domain: "" }).domain === "", "a mistyped web address is refused, and a blank one is fine");
ok(/Many sources share facebook\.com/.test(asSource({ domain: "https://www.facebook.com/northbridgeforum" })) && /Many sources share bbc\.co\.uk/.test(asSource({ domain: "bbc.co.uk/news/england/sussex" })), "a site many sources share is refused, so \"Found\" means this source");
ok(asSource({ domain: "https://www.courier.example/news" }).domain === "courier.example", "a publication's own page comes down to its site");
ok(asSource({ reach: " " }).reach === null && asSource({ reach: "," }).reach === null && asSource({ reach: 0 }).reach === 0 && asSource({ reach: "41,000" }).reach === 41000, "blank reach isn't taken for nought");
ok(/plain number/.test(asSource({ reach: "about 5000" })) && /plain number/.test(asSource({ reach: "12k" })) && /plain number/.test(asSource({ reach: -5 })), "and a reach that can't be read is refused, not lost");
ok(asSource({ reach: "41,000" }).reachUnit === "listeners" && asSource({ reach: 9, type: "Local Television" }).reachUnit === "viewers" && asSource({ reach: 9, reachUnit: "people" }).reachUnit === "people", "with no unit given, reach is counted in the source's own kind of unit");

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
const ofcom = (name, values) => values.map((value, i) => ({ measure: `Local news in the last month or so: ${name}`, age_from: 16 + (i ? i * 10 - 1 : 0), age_to: i === 6 ? null : 24 + i * 10, value, year: "2026" }));
const stand = [{ measure: "PROXY, not news-specific and not local: watched TV programmes live at the time of broadcast", age_from: 16, age_to: null, value: 50, year: "2024" }];
const telly = t.audienceFor("Local Television", census, [...held, ...stand, ...ofcom("Television", [25, 29, 38, 39, 51, 59, 64])]);
ok(telly.known && telly.note === "" && telly.overFiftyFive.audience > 50, "local television uses Ofcom's figures for local news");
ok(/all live television/.test(t.audienceFor("Local Television", census, [...held, ...stand]).note), "and falls back to the stand-in, saying so, until the library has them");
const social = t.audienceFor("Social Media", census, [...held, ...ofcom("Social media such as Facebook, X (formerly Twitter) or Instagram, etc.", [59, 59, 52, 52, 40, 38, 26])]);
ok(social.known && social.overFiftyFive.audience < social.overFiftyFive.adults && /any social media/.test(social.note), "social media gets an age profile, younger than all adults");
ok(/printed local magazines/.test(t.audienceFor("Local Newsletter", census, [...held, ...ofcom("Printed local magazines", [5, 9, 9, 13, 15, 14, 23])]).note), "and so does a newsletter, saying what it's based on");

const row = (date, topic, tone, relevance, reach, adjusted) => ({ date, topic, tone, relevance, reach, adjusted });
const sum = t.summariseCoverage([row("2026-10-30", "Potholes", "Critical", "High", 1000, 500), row("2026-10-20", "Potholes", "Neutral", "Some", 100, 100), row("2026-10-29", "Parking", "Critical", "None", 900, 900), row("2026-09-20", "Parking", "Neutral", "High", 50, 50), row("2026-06-01", "Parking", "Neutral", "High", 50, 50)], "2026-11-01");
ok(sum.pieces === 2 && sum.previous === 1 && sum.reach === 1100 && sum.adjusted === 600 && sum.topics.length === 1, "the last four weeks are counted against the four before, and a piece with no relevance doesn't count");

const sources = [{ id: "a", reach: 500 }];
const good = { source: "a", date: "2026-10-30", summary: "Item on repairs", topic: "Potholes", relevance: "High", tone: "Critical", prominence: "Inside page", functions: ["cw", "zz"] };
const made = t.readAssessment(good, sources, ["Potholes"], "Lee", "2026-11-01");
ok(made.reach === 500 && made.functions.join() === "cw" && made.by === "Lee", "an assessment takes the source's reach unless told otherwise");
ok(t.readAssessment({ ...good, reach: "750" }, sources, ["Potholes"], "Lee", "2026-11-01").reach === 750 && t.readAssessment({ ...good, reach: "" }, sources, ["Potholes"], "Lee", "2026-11-01").reach === 500, "and blank means the source's");
ok(t.readAssessment({ ...good, summary: "Call 01234 567890 or a.resident@example.com" }, sources, ["Potholes"], "Lee", "2026-11-01").summary === "Call [removed] or [removed]", "a phone number or email address in a summary is taken out");
const refused = (over) => { try { t.readAssessment({ ...good, ...over }, sources, ["Potholes"], "Lee", "2026-11-01"); return ""; } catch (e) { return e.message; } };
ok(/don't paste/.test(refused({ summary: "x".repeat(201) })), "a pasted article is refused");
ok(/future/.test(refused({ date: "2026-12-01" })) && /topic/.test(refused({ topic: "Nonsense" })) && /source/.test(refused({ source: "b" })) && /relevance/.test(refused({ tone: "Angry" })), "and so is anything that isn't a real choice");
ok(/plain number/.test(refused({ reach: "12k" })), "including a reach that can't be read");

// waiting for something from outside
const never = new Promise(() => {});
let started = 0, began = Date.now();
ok(await t.briefly("test-hung", "without", () => { started++; return never; }, undefined, 20) === "without" && Date.now() - began < 500, "a page carries on without something slow");
ok(await t.briefly("test-hung", "without", () => { started++; return never; }, undefined, 20) === "without" && started === 1, "and doesn't start it a second time while it's running");
ok(await t.briefly("test-fine", "without", async () => "found") === "found", "what's ready in time is used");
let tries = 0;
await t.briefly("test-broken", "without", async () => { tries++; throw new Error("down"); });
await t.briefly("test-broken", "without", async () => { tries++; throw new Error("down"); });
await t.briefly("test-empty", "without", async () => { tries++; return null; }, (x) => x === null);
await t.briefly("test-empty", "without", async () => { tries++; return null; }, (x) => x === null);
ok(tries === 2, "and something that's failing is left alone for a while, rather than tried on every click");
await t.briefly("test-part", "without", async () => ({ ok: false, part: "held" }), (x) => !x.ok);
ok((await t.briefly("test-part", "without", async () => { tries++; return null; }, (x) => !x.ok)).part === "held" && tries === 2, "what it did manage is used in the meantime");

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
ok(r.audiences["Social Media"].known && r.audiences["Local Television"].known && r.audiences["Local Television"].note === "", "including Ofcom's local news figures");
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
const brief = await (async () => { const real = globalThis.fetch, outside = []; globalThis.fetch = (u, i) => { if (!String(u.url ?? u).includes("storage.bunnycdn.com")) outside.push(String(u.url ?? u)); return real(u, i); }; const res = await api("/api/coverage/summary", { code: WSX }, member); globalThis.fetch = real; return { res, outside }; })();
ok(brief.res.summary.topics.length === 1 && !brief.outside.some((u) => /gov\.uk|parliament|fixmystreet|\/query|\/ref/i.test(u)), "the Summary page's figures come from Clarion's own storage, so it waits on nobody else");
ok((await api("/api/coverage/summary", { code: WSX }, kirk)).status === 403 && (await api("/api/coverage/summary", { code: WSX })).status === 401, "and they keep to the usual access rules");
const spare = (await api("/api/coverage/source", { code: WSX, name: "Short-lived", type: "Local Radio" }, lead)).source;
slowStorage.ms = 15;
const [added, gone] = await Promise.all([api("/api/coverage/assess", { code: WSX, source: spare.id, date: "2026-10-30", summary: "Overlap", topic: "Potholes", relevance: "High", tone: "Neutral", prominence: "Inside page" }, lead), api("/api/coverage/unsource", { code: WSX, id: spare.id }, lead)]);
slowStorage.ms = 0;
const after = await api("/api/coverage/get", { code: WSX }, lead), heldNow = JSON.parse(getText(files("").find((k) => k.endsWith(`${WSX}/assessments.json`))));
ok(added.status === 200 && gone.status === 400 && after.sources.some((x) => x.id === spare.id) && after.rows.some((x) => x.summary === "Overlap"), "saving a piece as its source is taken off can't lose the piece");
ok(heldNow.every((x) => after.sources.some((s) => s.id === x.source)), "and every assessment still has its source");
await api("/api/coverage/unassess", { code: WSX, id: after.rows.find((x) => x.summary === "Overlap").id }, lead);
await api("/api/coverage/unsource", { code: WSX, id: spare.id }, lead);

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
ok(files("").some((k) => k.endsWith("sources.json")) && !files("").some((k) => k.includes("check")) && !files("").some((k) => getText(k)?.includes("SECRET")), "and nothing from a search is stored");
r = await api("/api/coverage/check", { code: WSX, keywords: ["flooding"] }, lead);
ok(r.checks[0].result === "No match", "nothing found says no match");
const before = search.calls.length;
await api("/api/coverage/check", { code: WSX, keywords: ["flooding"] }, lead);
ok(search.calls.length === before, "the same check isn't asked twice in a morning");
ok((await api("/api/coverage/check", { code: WSX, keywords: ["flooding"] }, member)).status === 403, "members can't run checks");
ok((await api("/api/coverage/check", { code: KIRK, keywords: ["flooding"] }, kirk)).status === 400, "a source needs a web address before it can be checked");
r = await api("/api/coverage/check", { code: WSX, keywords: ["flooding"], sources: [] }, lead);
ok(r.status === 400 && /Tick at least one/.test(r.error) && search.calls.length === before, "with nothing ticked, nothing is searched");
search.status = 401;
r = await api("/api/coverage/check", { code: WSX, keywords: ["gritting"] }, lead);
ok(r.status === 502 && /SEARCH_KEY/.test(r.error), "a refused key is explained");
search.status = 422; search.body = JSON.stringify({ type: "ErrorResponse", error: { status: 422, code: "SUBSCRIPTION_TOKEN_INVALID", detail: "The provided subscription token is invalid." } });
r = await api("/api/coverage/check", { code: WSX, keywords: ["gritting"] }, lead);
ok(r.status === 502 && /SEARCH_KEY/.test(r.error), "and so is the way the search service really says it");
search.body = JSON.stringify({ type: "ErrorResponse", error: { status: 422, code: "VALIDATION", detail: "Unable to validate request parameter(s)" } });
r = await api("/api/coverage/check", { code: WSX, keywords: ["gritting"] }, lead);
ok(r.ready && r.checks[0].result === "Not checked", "but it doesn't blame the key for anything else");
search.status = 500; search.body = null;
r = await api("/api/coverage/check", { code: WSX, keywords: ["cycling"] }, lead);
ok(r.ready && r.checks[0].result === "Not checked", "and a search that fails says it wasn't checked, not that nothing was found");
search.status = 200;
for (const body of ["{}", "not json", JSON.stringify({ type: "ErrorResponse" })]) {
  search.body = body;
  r = await api("/api/coverage/check", { code: WSX, keywords: ["cycling"] }, lead);
  ok(r.ready && r.checks[0].result === "Not checked", `an odd answer (${body.slice(0, 12)}) isn't taken for no match`);
}
search.body = null;
r = await api("/api/coverage/check", { code: WSX, keywords: ["cycling"] }, lead);
ok(r.checks[0].result === "No match", "and isn't remembered, so the next check asks again");
const second = (await api("/api/coverage/source", { code: WSX, name: "Second paper", type: "Local Newspaper", domain: "second.example" }, lead)).source;
const third = (await api("/api/coverage/source", { code: WSX, name: "Third paper", type: "Local Newspaper", domain: "third.example" }, lead)).source;
const spent = (await api("/api/coverage/check", { code: WSX, keywords: ["signs"] }, lead)).left; // these answers are now held
search.status = 429;
const asked = search.calls.length;
r = await api("/api/coverage/check", { code: WSX, keywords: ["lines", "kerbs"] }, lead);
const tried = search.calls.slice(asked);
ok(r.checks.length === 6 && r.checks.every((x) => x.result === "Not checked") && tried.length === 2, "after two failures in a row Clarion stops asking");
ok(tried[1].at - tried[0].at >= 1000, "and it waits between tries even when they fail");
ok(r.left === spent - 2, "and only the searches really made count towards the day's allowance");
const askedNext = search.calls.length;
r = await api("/api/coverage/check", { code: WSX, keywords: ["signs", "bollards"] }, lead);
ok(search.calls.length === askedNext + 2 && r.checks.filter((x) => x.keyword === "signs").every((x) => x.result === "No match") && r.checks.filter((x) => x.result === "Not checked").length === 3, "an answer already held doesn't hide a run of failures, and is still given after Clarion stops asking");
search.status = 200;
await api("/api/coverage/unsource", { code: WSX, id: second.id }, lead);
await api("/api/coverage/unsource", { code: WSX, id: third.id }, lead);
const countFile = files("").find((k) => /usage\/searches-\d{4}-\d{2}\.json$/.test(k));
ok(countFile && JSON.parse(getText(countFile)).searches === search.calls.length, "the month's searches are counted in storage, so a new deployment doesn't lose them");
process.env.SEARCHES_A_MONTH = String(search.calls.length);
const atLimit = search.calls.length;
r = await api("/api/coverage/check", { code: WSX, keywords: ["verges"] }, lead);
ok(r.status === 429 && /this month's coverage checks/.test(r.error) && search.calls.length === atLimit, "once the month's searches are used, Clarion says so and asks nothing");
ok((await api("/api/coverage/check", { code: WSX, keywords: ["cycling"] }, lead)).status === 200, "an answer already held still comes back");
process.env.SEARCHES_A_MONTH = String(search.calls.length + 3);
r = await api("/api/coverage/check", { code: WSX, keywords: ["verges"] }, lead);
ok(r.status === 200 && r.left === 2, "and the figure for what's left allows for the month's limit");
delete process.env.SEARCHES_A_MONTH;
const already = search.calls.length;
let bought = true;
for (let i = 0; i < 210; i++) bought = bought && (await api("/api/coverage/check", { code: WSX, keywords: ["cycling"] }, lead)).status === 200;
ok(bought && search.calls.length === already, "an answer already held doesn't use up the day's allowance");
ok((await api("/api/coverage/unassess", { code: WSX, id: assessed }, member)).status === 403 && (await api("/api/coverage/unassess", { code: WSX, id: assessed }, lead)).status === 200, "only a lead can remove an assessment");

// ---- the screens
await api("/api/coverage/assess", { code: WSX, source: courier.id, date: "2026-10-30", summary: "Front-page item on repairs", topic: "Potholes", relevance: "High", tone: "Critical", prominence: "Front page or lead", functions: ["cw"] }, lead);
const page = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
async function open(token, hash, refuse = "") {
  const dom = new JSDOM(page, {
    url: `https://clarion.test/${hash}`, runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(w) {
      w.localStorage.setItem("clarion_token", token);
      w.scrollTo = () => {};
      w.fetch = async (url, opts = {}) => { if (refuse && url === refuse) return { ok: false, status: 500, json: async () => ({ error: "Out of order" }) }; const res = await handleRequest(new Request(new URL(url, "https://clarion.test").href, opts)); const text = await res.text(); return { ok: res.ok, status: res.status, json: async () => JSON.parse(text) }; };
    },
  });
  await until(() => dom.window.document.querySelector(".main .page > *"), "the page to start");
  return dom;
}
const text = (el) => el.textContent.replace(/\s+/g, " ");
const button = (d, name) => [...d.querySelectorAll("button")].find((b) => b.textContent === name);
const see = (d, pattern) => until(() => pattern.test(text(d.querySelector(".main"))), `the page to show ${pattern}`);
const typeIn = (w, el, value) => { el.value = value; el.dispatchEvent(new w.Event("input")); };
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
ok(/testhavencourier\.example/.test(text(d.querySelector(".main"))), "and the sources list shows which site is checked");
field("Name").value = "Moorside Radio"; field("Name").dispatchEvent(new w.Event("input"));
field("Type").value = "Local Radio"; field("Type").dispatchEvent(new w.Event("change"));
ok(field("Reach is counted in").value === "listeners", "choosing radio counts its reach in listeners");
field("Reach is counted in").value = "people"; field("Reach is counted in").dispatchEvent(new w.Event("change"));
field("Type").value = "Local Television"; field("Type").dispatchEvent(new w.Event("change"));
ok(field("Reach is counted in").value === "people", "until an officer chooses otherwise");
typeIn(w, field("Name"), ""); field("Type").value = "Local Newspaper"; field("Type").dispatchEvent(new w.Event("change"));
button(d, "Add reach").click();
ok(field("Reach is counted in").value === "copies" && field("Name").value === "Moorside News", "adding a reach starts from the right unit, not a blank");
button(d, "Cancel").click();
w.location.hash = `#said/${WSX}/assess`;
await see(d, /Record your assessment/);
main = text(d.querySelector(".main"));
ok(/Who this reaches/.test(main) && /Likely|Drives \(holds a licence\)/.test(main) && !/Likely to vote/.test(main), "assessing shows who the source reaches");
ok(/× 0\.5/.test(main) && /Campaigning on this topic/.test(main) && /9,200/.test(main), "and what allowing for the source does");
const check = button(d, "Check");
const reachBox = () => [...d.querySelectorAll(".field")].find((x) => x.firstChild?.textContent === "Reach this time").querySelector("input");
typeIn(w, reachBox(), "");
await see(d, /18,400/);
ok(/18,400/.test(text(d.querySelector(".g3"))), "left blank, a piece shows the source's reach, as it will be saved");
typeIn(w, reachBox(), "18400");
d.querySelector('input[aria-label="Keywords"]').value = "potholes";
const ticked = [...d.querySelectorAll('.check input[type="checkbox"]')];
ticked.forEach((x) => { x.checked = false; });
check.click();
await see(d, /Tick at least one/);
ticked.forEach((x) => { x.checked = true; });
check.click();
await see(d, /Found/);
ok(/keeps only yes or no and the date/.test(text(d.querySelector(".main"))) && /doesn't mean no coverage/.test(text(d.querySelector(".main"))), "a check explains what it can't show");
ok(!/\bnull\b/.test(text(d.querySelector(".main"))), "and nothing stray shows on the page");
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
ok(summary.value === "" && d.querySelectorAll('.plates button[aria-pressed="true"]').length === 0 && reachBox().value === "18400", "saving clears the form for the next piece, with the source's reach back");
const saved = await api("/api/coverage/get", { code: WSX }, lead);
ok(saved.rows.length === 2 && saved.rows.some((x) => x.summary === "A second item" && x.functions.join() === "cw" && x.relevance === "Some" && x.reach === 18400), "and the assessment is saved");
ok(summary.maxLength < 0, "the one-line box doesn't quietly cut anything off");
typeIn(w, summary, "An article pasted in. ".repeat(40));
button(d, "Some").click(); button(d, "Critical").click(); button(d, "Inside page").click();
button(d, "Save and next").click();
await see(d, /Please don't paste the article/);
ok((await api("/api/coverage/get", { code: WSX }, lead)).rows.length === 2, "so a pasted article is refused, not saved in part");
typeIn(w, summary, "Clicked twice");
typeIn(w, reachBox(), "99999");
const again = button(d, "Save and next"), waiting = (await api("/api/coverage/get", { code: WSX }, lead)).rows.length;
again.click(); again.click();
await see(d, /On to the next one/);
ok((await api("/api/coverage/get", { code: WSX }, lead)).rows.length === waiting + 1 && reachBox().value === "18400", "a double click saves once, and a reach typed for one piece doesn't carry over");
dom = await open(member, `#said/${WSX}`); d = dom.window.document;
await see(d, /Latest assessments/);
ok(!button(d, "Search and assess") && !button(d, "Remove") && button(d, "Sources"), "a member can read but not assess");
dom = await open(member, `#a/${WSX}`, "/api/coverage/summary"); d = dom.window.document;
await see(d, /how people feel about their roads/);
ok(!/Out of order/.test(text(d.querySelector(".main"))), "the Summary page still opens if the assessments can't be read");

console.log(failures ? `\n${failures} FAILED` : "\nAll passed");
process.exit(failures ? 1 : 0);
