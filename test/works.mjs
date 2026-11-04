// Works and weather: the sums on their own, then the link to the Climate Toolkit and the page, against the simulators.
import fs from "node:fs";
import zlib from "node:zlib";
import { JSDOM } from "jsdom";
import { addUser, claude, files, getText, hooks, putText, until } from "./sim.mjs";
const { handleRequest } = await import("./.build/app.mjs");
const t = await import("./.build/internals.mjs");

let failures = 0;
const ok = (cond, what) => { console.log(`${cond ? "PASS" : "FAIL"}  ${what}`); if (!cond) failures++; };
const WSX = "E10000032", KIRK = "E08000034";

// ---- the sums
ok(t.mondayOf("2026-11-03") === "2026-11-02" && t.mondayOf("2026-11-02") === "2026-11-02" && t.mondayOf("2026-11-01") === "2026-10-26", "a date falls in the week starting on its Monday");
ok(t.sourceOf("Customer report") === "public" && t.sourceOf("Web form") === "public" && t.sourceOf("Online") === "public" && t.sourceOf("Safety inspection") === "inspection" && t.sourceOf("Contractor report") === "other" && t.sourceOf("") === "other", "jobs are sorted by who found them, as the Toolkit sorts them");

const COLS = "ref,fn,area,type,pri,src,hier,ward,street,logged,target,safe,done,status,ooh,cost,qty,unit";
const job = (i, date, src, fn, ward) => `SECRET-REF-${i},${fn},Highways,Pothole,P1,${src},2,${ward},"12 Secret Street, Town",${date}T09:30,,,,Done,0,123.45,1,No`;
const dayAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const lines = [COLS];
for (let i = 0; i < 60; i++) lines.push(job(i, dayAgo(10 + (i % 5)), i % 3 ? "Customer report" : "Safety inspection", i % 2 ? "cw" : "dr", i % 4 ? "Moorside" : "Dale End"));
for (let i = 0; i < 4; i++) lines.push(job(100 + i, dayAgo(11), "Customer report", "cw", "Tiny Ward"));
lines.push(job(200, "2019-01-07", "Customer report", "cw", "Old Ward"));
lines.push(`ref-no-date,cw,,,,,,,,,,,,,,,,`);
lines.push(job(300, dayAgo(12), "Customer report", "1 Secret Lane", "Moorside"));
const records = zlib.gzipSync(Buffer.from(`${lines.join("\r\n")}\r\n`));
const asStream = (bytes) => new Blob([bytes]).stream();
const since = dayAgo(490);
let r = await t.tallyRecords(asStream(records), since);
const weekly = r.weeks.reduce((sum, w) => sum + w.public + w.inspection + w.other, 0);
ok(weekly === 65 && r.to >= dayAgo(14) && r.from === "2019-01-07", "records are totalled by week, and old ones left out");
ok(r.weeks.reduce((sum, w) => sum + w.inspection, 0) === 20 && r.weeks.reduce((sum, w) => sum + (w.fns.cw ?? 0), 0) === 34, "by who found the job and by function");
ok(r.wards.Moorside === 46 && r.wards["Dale End"] === 15 && !("Tiny Ward" in r.wards), "and a ward with fewer than 10 jobs isn't kept by name");
ok(!/SECRET|Secret|123\.45/.test(JSON.stringify(r)), "with no street, reference or cost kept");
const weather = (over) => { const n = 60, f = (v) => new Array(n).fill(v); return { start: "2026-01-01", tmax: f(10), tmin: f(5), rain: f(0), gust: f(20), snow: f(0), ...over }; };
const at = (list, day, v) => { const out = [...list]; out[day] = v; return out; };
const W = weather({});
ok(t.weatherEvents(W).length === 0, "ordinary weather makes no events");
let ev = t.weatherEvents(weather({ gust: at(at(W.gust, 10, 55), 11, 62) }));
ok(ev.length === 1 && ev[0].label === "Gale" && ev[0].start === "2026-01-11" && ev[0].end === "2026-01-12" && ev[0].severity === 2 && /62 mph/.test(ev[0].detail), "a gale is found, on the Toolkit's rules");
ev = t.weatherEvents(weather({ rain: at(W.rain, 20, 33) }));
ok(ev[0]?.label === "Heavy rain" && ev[0].severity === 2 && /33 mm/.test(ev[0].detail), "and heavy rain");
ev = t.weatherEvents(weather({ rain: at(at(at(W.rain, 20, 15), 21, 15), 22, 15) }));
ok(ev[0]?.label === "Heavy rain" && ev[0].start <= "2026-01-21", "including over three days");
ok(t.weatherEvents(weather({ tmax: W.tmax.map((v, i) => (i >= 5 && i <= 7 ? 27 : v)) }))[0]?.label === "Heatwave" && t.weatherEvents(weather({ tmax: W.tmax.map((v, i) => (i >= 5 && i <= 6 ? 27 : v)) })).length === 0, "three hot days are a heatwave, and two aren't");
ok(t.weatherEvents(weather({ tmin: W.tmin.map((v, i) => (i >= 5 && i <= 8 ? -3 : v)) }))[0]?.label === "Cold spell or snow" && t.weatherEvents(weather({ tmin: W.tmin.map((v, i) => (i === 5 ? -3 : v)) })).length === 0, "and cold needs to last");
ok(t.weatherEvents(weather({ tmin: W.tmin.map((v, i) => (i >= 5 && i < 15 ? -1 : v)) })).some((e) => e.label === "Freeze and thaw"), "days that freeze and thaw are found");
ok(t.weatherEvents(weather({ gust: at(W.gust, 10, null), rain: W.rain.map(() => null) })).length === 0, "and days with no reading are passed over");
ok(t.weatherEvents(weather({ tmax: W.tmax.map((v, i) => (i >= 5 && i <= 9 ? (i === 7 ? null : 27) : v)) }))[0]?.end === "2026-01-10", "a day or two missing from the temperatures is filled in, as the Toolkit does");
ok(t.weatherEvents(weather({ gust: at(W.gust, 10, 45) }), { gale: 40 }).length === 1, "an authority's own settings in the Toolkit are used");

const week = (date, pub, fns = {}) => ({ week: date, public: pub, inspection: 10, other: 0, fns });
const mondays = Array.from({ length: 20 }, (_, i) => new Date(Date.parse("2026-11-02T12:00:00Z") - (i + 1) * 7 * 86400000).toISOString().slice(0, 10)).reverse();
const held = { on: true, from: "2025-01-01", to: "2026-11-01", weeks: mondays.map((m, i) => week(m, i >= 16 ? 200 : 100, { dr: i >= 16 ? 90 : 10, cw: 40 })), wards: { Big: 50, Bigger: 80 }, events: [{ type: "rain", label: "Heavy rain", start: mondays[15], end: mondays[15], severity: 2, detail: "" }, { type: "storm", label: "Gale", start: "2026-10-30", end: "2026-10-30", severity: 1, detail: "" }] };
const fig = t.worksFigures(held, { [mondays[16]]: 4, [mondays[10]]: 1, [mondays[9]]: 1 }, [{ created: `${mondays[17]}T09:00:00Z`, direction: "Worsening" }], [{ ran: mondays[12], satisfied: 34 }], "2026-11-03", { dr: "Drainage & flooding", cw: "Carriageways" });
const rain = fig.after.find((x) => x.label === "Heavy rain");
ok(fig.weeks.length === 26 && fig.weeks.at(-1).week === "2026-10-26", "the chart covers the last 26 full weeks");
ok(rain.functions[0] === "Drainage & flooding" && rain.functions.length === 1 && rain.mood === "Worsening" && rain.publicChange === 50, "each event shows what rose, by how much against the 8 weeks before, and the mood afterwards");
ok(fig.marks.some((m) => /Survey: 34% satisfied, indicative/.test(m.label)) && fig.marks.some((m) => /Reading: worsening/.test(m.label)), "survey and reading dates are marked");
ok(fig.wards[0].name === "Bigger", "and the busiest wards come first");
ok(rain.pressChange === null, "a rise from next to nothing isn't shown as a percentage");
const lateStart = t.worksFigures({ ...held, from: mondays[13] }, {}, [], [], "2026-11-03", {}).after.find((x) => x.label === "Heavy rain");
const stale = t.worksFigures({ ...held, to: mondays[15] }, {}, [], [], "2026-11-03", {}).after.find((x) => x.label === "Heavy rain");
ok(lateStart.publicChange === null && stale.publicChange === null, "weeks before the records start, or after they stop, aren't taken for weeks with no jobs");
ok(t.publicJobs(held, "2026-11-03") === 800 && t.publicJobs({ ...held, on: false }, "2026-11-03") === 0, "public reports over four weeks are added up for a mood reading");

// ---- through the API
await addUser(1, "lead@westsussex.gov.uk", "Lee Lead", 30, "lead");
await addUser(2, "member@westsussex.gov.uk", "Mo Member", 30, "member");
await addUser(3, "kit@kirklees.gov.uk", "Kit Officer", 20, "lead");
await addUser(4, "boss@fhrg.test", "Bo Boss", 99, "member");
await addUser(7, "admin@westsussex.gov.uk", "Ann Admin", 30, "member", 1);
const api = async (path, body, token) => { const res = await handleRequest(new Request(`https://clarion.test${path}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { "x-session-token": token } : {}) }, body: JSON.stringify(body) })); return { status: res.status, ...(await res.json()) }; };
const login = async (email) => (await api("/api/login", { email, password: "pw" })).token;
const lead = await login("lead@westsussex.gov.uk"), member = await login("member@westsussex.gov.uk"), kit = await login("kit@kirklees.gov.uk"), boss = await login("boss@fhrg.test"), ownAdmin = await login("admin@westsussex.gov.uk");

const asked = [];
let answer = (path) => null;
const FOLDER = "https://storage.bunnycdn.com/toolkit-zone/climate-toolkit/authorities/";
hooks.fetch = async (url, init) => {
  if (!url.startsWith("https://storage.bunnycdn.com/toolkit-zone/")) return null;
  asked.push({ url, key: init.headers?.AccessKey, method: init.method || "GET", redirect: init.redirect });
  return answer(url.slice(FOLDER.length));
};
const json = (x) => new Response(JSON.stringify(x), { status: 200 });
const series = { start: dayAgo(60), tmax: new Array(60).fill(12), tmin: new Array(60).fill(6), rain: at(new Array(60).fill(1), 40, 34), gust: new Array(60).fill(20), snow: new Array(60).fill(0) };
const toolkit = { "30/data/meta.json": () => json({ uploaded: "2026-11-02T10:00:00Z", rows: 66 }), "30/data/records.csv.gz": () => new Response(records), "30/settings.json": () => json({ weatherSource: "era5" }), "30/weather/era5.json": () => json(series) };
answer = (path) => (toolkit[path] ? toolkit[path]() : new Response("", { status: 404 }));

r = await api("/api/works/get", { code: WSX }, member);
ok(r.status === 200 && r.ready === false && !r.on, "with no password set, the page can say it isn't connected");
ok((await api("/api/works/on", { code: WSX }, lead)).status === 400, "and it can't be turned on");
process.env.TOOLKIT_STORAGE_KEY = "toolkit-read-only";
process.env.TOOLKIT_STORAGE_ZONE = "toolkit-zone";
ok((await api("/api/works/get", { code: WSX })).status === 401 && (await api("/api/works/get", { code: WSX }, kit)).status === 403, "this needs a sign-in, for your own authority");
r = await api("/api/works/get", { code: WSX }, member);
ok(r.ready && !r.on && !r.canTurnOn, "a member can't turn it on");
ok((await api("/api/works/on", { code: WSX }, member)).status === 403, "even by asking directly");
ok((await api("/api/works/on", { code: WSX }, boss)).status === 403, "and nor can an administrator from outside the authority");
ok((await api("/api/works/on", { code: WSX }, ownAdmin)).status === 403, "or an administrator inside it who isn't its lead");
ok(asked.length === 0, "nothing is read until it's turned on");
ok((await api("/api/works/on", { code: WSX }, lead)).status === 200, "the authority's lead can");
await until(() => asked.some((x) => x.url.endsWith("era5.json")), "the records to be read");
await until(async () => (await api("/api/works/get", { code: WSX }, member)).figures, "the figures");
// a survey with no interviewers isn't marked on the chart as a survey
{
  const made = (await api("/api/survey/new", { code: WSX, title: "Marks", purpose: "x" }, lead)).survey;
  await api("/api/survey/status", { code: WSX, id: made.id, status: "open" }, lead);
  const surveyFile = files("").find((k) => k.endsWith(`/surveys/${made.id}.json`));
  putText(surveyFile, JSON.stringify({ ...JSON.parse(getText(surveyFile)), openedOn: dayAgo(21) }));
  const rows = (via) => Array.from({ length: 35 }, (_, i) => ({ n: i + 1, form: `F${i + 1}`, via, where: via === "self" ? "here" : undefined, site: "", at: new Date().toISOString(), secs: 100, answers: { c1: "Fairly satisfied" }, topics: {}, clean: {}, checked: {} }));
  const answers = surveyFile.replace("/surveys/", "/survey-answers/");
  putText(answers, JSON.stringify(rows("self")));
  ok(!(await api("/api/works/get", { code: WSX }, member)).figures.marks.some((m) => /^Survey/.test(m.label)), "a survey with no interviewers isn't marked on the chart");
  putText(answers, JSON.stringify(rows("tablet")));
  ok((await api("/api/works/get", { code: WSX }, member)).figures.marks.some((m) => /^Survey: /.test(m.label)), "one with interviewers is");
  putText(answers, "[]");
}
r = await api("/api/works/get", { code: WSX }, member);
ok(asked.every((x) => x.url.startsWith(`${FOLDER}30/`) && x.key === "toolkit-read-only" && x.method === "GET"), "only that authority's folder is read, with the read-only password, and nothing is changed");
ok(asked.every((x) => x.redirect === "error"), "a redirect is refused, so the password can't be handed on");
ok(r.on && r.by === "Lee Lead" && r.figures.weeks.some((w) => w.public > 0) && r.figures.events.some((e) => e.label === "Heavy rain") && r.weatherTo === series.start.slice(0, 0) + r.weatherTo, "the figures and weather events come through");
ok(!r.canTurnOff, "a member can't turn it off");
const stored = getText(files("").find((k) => k.endsWith(`${WSX}/works.json`)));
ok(!/SECRET|Secret|123\.45|Tiny Ward/.test(stored) && stored.includes("Moorside"), "nothing is saved but totals: no streets, references or costs");
const reads = asked.length;
await api("/api/works/get", { code: WSX }, member);
ok(asked.length === reads, "and it's checked at most once a day");
ok((await api("/api/works/get", { code: KIRK }, kit)).on === false, "another authority isn't affected");
const wrongFile = files("").find((k) => k.endsWith(`${WSX}/works.json`)), good = getText(wrongFile);
putText(wrongFile, JSON.stringify({ ...JSON.parse(good), toolkitId: 77, toolkitName: "West Sussex District Council", checked: "2020-01-01T00:00:00Z" }));
const readsBefore = asked.length;
await until(async () => /turning on again/.test((await api("/api/works/get", { code: WSX }, member)).problem), "the link to stop");
ok(asked.length === readsBefore && !getText(wrongFile).includes("Moorside") && !/"toolkitId": 77/.test(getText(wrongFile)), "a link made by an authority with a similar name is stopped, and nothing is read");
putText(wrongFile, good);
ok(!getText(files("").find((k) => k.endsWith(`${WSX}/works.json`))).includes("toolkit-read-only"), "and the password is never saved");

const before = claude.calls.length;
await api("/api/reading/start", { code: WSX }, lead);
await until(() => claude.calls.length > before, "a reading to reach Claude");
const prompt = JSON.stringify(claude.calls.at(-1));
ok(/maintenance_jobs_reported_by_the_public_last_four_weeks/.test(prompt) && !/SECRET-REF|12 Secret Street/.test(prompt), "a mood reading gets the public's reports as one figure");

// ---- the page
const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
async function open(token, hash) {
  const dom = new JSDOM(html, {
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
const see = (d, pattern) => until(() => pattern.test(text(d.querySelector(".main"))), `the page to show ${pattern}`);
const button = (d, name) => [...d.querySelectorAll("button")].find((b) => b.textContent.startsWith(name));
let dom = await open(member, `#attention/${WSX}/works`), d = dom.window.document;
await see(d, /After each weather event/);
let main = text(d.querySelector(".main"));
ok(d.querySelector(".works-chart") && /Jobs reported by the public/.test(main) && /Heavy rain/.test(main) && /Busiest wards/.test(main) && /Moorside/.test(main), "the page shows the chart, the events and the wards");
ok(/Records uploaded to the Climate Toolkit on 2 November 2026/.test(main) && !button(d, "Turn this") && !/\bnull\b|undefined|NaN/.test(main + d.querySelector(".works-chart").outerHTML), "says how up to date it is, and a member can't change it");
dom = await open(kit, `#attention/${KIRK}/works`); d = dom.window.document;
await see(d, /Use our Climate Toolkit records/);
ok(button(d, "Turn this on"), "a lead with it switched off is offered the choice");
dom = await open(lead, `#attention/${WSX}/works`); d = dom.window.document;
await see(d, /After each weather event/);
toolkit["30/data/meta.json"] = () => new Response("", { status: 403 });
button(d, "Turn this off").click();
await until(() => button(d, "Turn this on"), "it to turn off");
const gone = getText(files("").find((k) => k.endsWith(`${WSX}/works.json`)));
ok(!/Moorside|"on": true/.test(gone), "turning it off removes what's held");
button(d, "Turn this on").click();
await until(async () => /refused Clarion's password/.test((await api("/api/works/get", { code: WSX }, lead)).problem), "the refusal");
ok(!(await api("/api/works/get", { code: WSX }, lead)).checked, "a refused password is explained, and it's tried again rather than left until tomorrow");

hooks.fetch = null;
console.log(failures ? `\n${failures} FAILED` : "\nAll passed");
process.exit(failures ? 1 : 0);
