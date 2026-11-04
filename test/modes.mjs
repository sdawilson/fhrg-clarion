// Clarion's three modes: the Northbridge demonstration, one authority, and FHRG administrators.
import fs from "node:fs";
import { JSDOM } from "jsdom";
import { addUser, claude, files, getJson, store, until } from "./sim.mjs";
const { handleRequest } = await import("./.build/app.mjs");
const t = await import("./.build/internals.mjs");

let failures = 0;
const ok = (cond, what) => { console.log(`${cond ? "PASS" : "FAIL"}  ${what}`); if (!cond) failures++; };
const R = "clarion/", WSX = "E10000032";
await addUser(1, "lead@westsussex.gov.uk", "Lee Lead", 30, "lead");
await addUser(2, "member@westsussex.gov.uk", "Mo Member", 30, "member");
await addUser(3, "kirk@kirklees.gov.uk", "Kay Lead", 20, "lead");
await addUser(5, "boss@fhrg.test", "Bo Boss", 99, "member");
const raw = (path, body, token) => handleRequest(new Request("https://clarion.test" + path, { method: "POST", headers: { "content-type": "application/json", ...(token ? { "x-session-token": token } : {}) }, body: JSON.stringify(body ?? {}) }));
const api = async (path, body, token) => { const r = await raw(path, body, token); return { status: r.status, ...(await r.json()) }; };
const login = async (email) => (await api("/api/login", { email, password: "pw" })).token;
const lead = await login("lead@westsussex.gov.uk"), member = await login("member@westsussex.gov.uk"), kirk = await login("kirk@kirklees.gov.uk"), boss = await login("boss@fhrg.test");

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const asked = [];
async function open(address, token, broken = "") {
  const dom = new JSDOM(html, {
    url: `https://clarion.test${address}`, runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(w) {
      if (token) w.localStorage.setItem("clarion_token", token);
      w.scrollTo = () => {};
      w.print = () => { w.printed = true; };
      w.URL.createObjectURL = (blob) => { w.downloaded = blob; return "blob:x"; };
      w.URL.revokeObjectURL = () => {};
      w.fetch = async (url, opts = {}) => {
        asked.push(String(url));
        if (broken && String(url).includes(broken)) return { ok: false, status: 503, json: async () => ({}) };
        const res = await handleRequest(new Request(new URL(url, "https://clarion.test").href, opts));
        const body = await res.text();
        return { ok: res.ok, status: res.status, json: async () => JSON.parse(body) };
      };
    },
  });
  await until(() => dom.window.document.querySelector(broken ? "#app .err" : "#app > *:not(.busy)"), "the page to start");
  dom.window.eval("App.pollMs = 20");
  return dom;
}
const text = (el) => el.textContent.replace(/\s+/g, " ");
const button = (d, name) => [...d.querySelectorAll("button")].find((b) => b.textContent === name);
const see = (d, pattern) => until(() => pattern.test(text(d.querySelector(".main"))), `the page to show ${pattern}`);

// ---- the demonstration's data
const packResponse = await handleRequest(new Request("https://clarion.test/demo/data.json"));
const packText = await packResponse.text();
const pack = JSON.parse(packText);
ok(packResponse.status === 200, "the demonstration's data is public, with no account");
ok(!/West Sussex|Lincolnshire|Kirklees|E1000|E0800/.test(packText), "and holds nothing about a real authority");
ok(!/https?:/.test(packText), "and no links, so nothing points at a made-up site");
ok(!/\b(Jane|Smith)\b/.test(packText) && /\[removed\]/.test(packText), "and no names in its comments");
const page = Object.values(pack.surveys).find((x) => x.results.total > 0);
ok(page.results.used === 412 && page.results.total === 532 && page.self.results.used < 120 && page.results.weighted && page.results.questions.find((q) => q.id === "c1").range > 0, "412 made-up replies go through the real calculations, with weighting");
ok(page.results.groups.every((g) => g.answered >= 30 || g.satisfied === null), "and groups under 30 aren't reported");
ok(pack.attention.topics.length === 8 && pack.attention.earlySigns.map((x) => x.topic).sort().join() === "Flooding on minor roads,Pavements", "topics are placed by rank, which finds the early signs");
ok(pack.coverage.summary.pieces === pack.coverage.summary.topics.reduce((n, x) => n + x.pieces, 0) && pack.coverage.summary.pieces > 5, "the coverage figures add up");
ok(pack.coverage.sources.every((x) => /\.example$|^$/.test(x.domain)) && pack.coverage.audiences["Local Newspaper"].known, "its sources are made up, and its audience figures come from the same sums");
const street = pack.authority.evidence.streets[0];
ok(street.responses === 412 && street.satisfied > 20 && street.satisfied < 45, "the survey result feeds the summary");
ok(JSON.stringify(t.buildPack()) === packText, "and building it again gives the same figures");
ok(page.topics.find((x) => x.topic === "Potholes").count === 10 && pack.attention.topics.find((x) => x.topic === "Potholes").replies === 10, "the comments and the comparison agree");

// ---- the demonstration's map is as made up as the rest of it
const places = pack.sites.towns.map((x) => x.name);
ok(pack.sites.ready && pack.sites.tiles === false && places.includes("Northbridge") && pack.sites.proposals[4].length === 4, "the demonstration proposes sites from the same sums, with no street map");
ok(pack.sites.hoods.every((m) => m[0] > 2 && m[1] > 54), "its map sits out at sea, so it can't land on a real place");
const planned = Object.values(pack.surveys)[0].survey.plan.sites;
ok(planned.length === 4 && planned.every((x) => places.includes(x.name) && x.share > 0), "and its survey's sites are the ones proposed");

// ---- the demonstration in the browser
const before = store.size, spendCalls = claude.calls.length;
let dom = await open("/demo"), d = dom.window.document, w = dom.window;
await see(d, /Northbridge: how people feel about their roads/);
let main = text(d.querySelector(".main"));
ok(/Demonstration\. Northbridge is fictional/.test(main) && d.querySelector(".demo-banner"), "the demonstration opens with no sign-in, under a banner");
ok(/Worsening/.test(main) && /412 street survey replies/.test(main) && /Early signs/.test(main), "the summary shows mood, the survey and early signs");
ok(d.querySelector(".quad") && d.querySelectorAll(".q-dot").length === 8 && d.querySelectorAll(".q-dot.early").length === 2, "the comparison chart places eight topics, two of them early signs");
ok(/Pavements/.test(text(d.querySelector(".quiet-row"))) && /for concern, 7th in the media/.test(main), "early signs are explained in ranks");
ok(/What's driving it/.test(main), "and there's a table of the same topics");
ok(/Demonstration: made-up data/.test(text(d.querySelector(".rail"))) && !button(d, "Sign out"), "the rail says so, with no way to sign out");
w.location.hash = "#said/NORTHBRIDGE";
await see(d, /Latest assessments/);
ok(/Front-page item on the Relief Road closure/.test(text(d.querySelector(".main"))), "What's being said shows made-up assessments");
w.location.hash = "#said/NORTHBRIDGE/assess";
await see(d, /Record your assessment/);
d.querySelector('input[aria-label="Keywords"]').value = "potholes, nonsense";
[...d.querySelectorAll("button")].find((x) => x.textContent === "Check").click();
await see(d, /No match/);
const demoCheck = text(d.querySelector(".main"));
ok(/nonsense\s*No match/.test(demoCheck) && /potholes\s*Found/.test(demoCheck) && !/Moor Lane/.test(demoCheck), "the demonstration's check follows what's typed");
const demoSaid = pack.coverage;
ok(["Local Newspaper", "Local News Website", "National Newspaper", "Local Newsletter", "Social Media", "Local Television", "Local Radio"].every((x) => demoSaid.audiences[x].known) && !demoSaid.audiences["Community Event"].known, "the demonstration's audiences come from the same figures");
ok(demoSaid.rows.every((x) => demoSaid.topics.includes(x.topic)) && demoSaid.sources.every((x) => x.campaign.every((c) => demoSaid.topics.includes(c))), "every topic in the demonstration's coverage can be chosen");
w.location.hash = "#said/NORTHBRIDGE/enquiries";
await see(d, /What people contacted you about/);
const demoEnq = text(d.querySelector(".main"));
ok(/Road defects/.test(demoEnq) && /Rising/.test(demoEnq) && /Winter gritting routes confirmed/.test(demoEnq) && !d.querySelector('.main a[href*="northbridge"]'), "the demonstration shows made-up enquiries and council news, with no links");
w.location.hash = "#attention/NORTHBRIDGE";
await see(d, /What's driving it/);
w.location.hash = "#attention/NORTHBRIDGE/works";
await see(d, /After each weather event/);
const demoWorks = text(d.querySelector(".main"));
ok(d.querySelector(".works-chart") && /Heavy rain/.test(demoWorks) && /Drainage & flooding/.test(demoWorks) && !/Turn this/.test(demoWorks), "the demonstration shows made-up works and weather, with nothing to switch");
w.location.hash = "#evidence/NORTHBRIDGE";
await see(d, /Published data/);
ok(/Road length/.test(text(d.querySelector(".main"))) && /Made-up figures/.test(text(d.querySelector(".main"))), "the evidence page works, and owns up to its figures");
w.location.hash = "#about/NORTHBRIDGE";
await see(d, /About this demonstration/);
ok(/Claude isn't used in the demonstration/.test(text(d.querySelector(".main"))) && /Attention and concern/.test(text(d.querySelector(".main"))), "it says how the demonstration works, and how the comparison is made");
ok(pack.authority.benchmark.satisfied === 34, "and its FHRG figure is made up too");
w.location.hash = "#notes/NORTHBRIDGE";
await see(d, /£4\.2m extra for pothole repairs/);
d.querySelector(".note-row a").click();
w.location.hash = d.querySelector(".note-row a").getAttribute("href");
await see(d, /Likely effect on public mood/);
w.location.hash = "#surveys/NORTHBRIDGE";
await see(d, /Autumn roads survey/);
const [autumn, winter] = pack.surveyList.surveys;
w.location.hash = `#survey/NORTHBRIDGE/${autumn.id}/results`;
await see(d, /Indicative only/);
main = text(d.querySelector(".main"));
ok(/\[removed\]/.test(main) && /weighted to the local population/.test(main), "a finished survey shows its results and comments");
button(d, "Download the answers").click();
await until(() => w.downloaded, "the download");
ok((await w.downloaded.text()).includes("form,site,entered_by,weight"), "and its answers can be downloaded");
w.location.hash = `#survey/NORTHBRIDGE/${autumn.id}/collect`;
await see(d, /Prepare forms to print/);
d.querySelectorAll('.form-grid input')[0].value = "1";
d.querySelectorAll('.form-grid input')[1].value = "2";
button(d, "Prepare forms to print").click();
await until(() => d.querySelectorAll(".sheet").length === 2, "the forms");
w.location.hash = `#survey/NORTHBRIDGE/${autumn.id}x/results`;
await see(d, /That survey wasn't found/);
w.location.hash = `#survey/NORTHBRIDGE/${winter.id}/results`;
await see(d, /Indicative only/);
w.downloaded = null;
button(d, "Download the answers").click();
await until(() => w.downloaded, "the empty download");
ok(!/Very satisfied/.test(await w.downloaded.text()), "a survey with no replies has none to download");
w.location.hash = `#survey/NORTHBRIDGE/${winter.id}/setup`;
await see(d, /Core questions/);
button(d, "Suggest questions").click();
await see(d, /How would you rate the condition of the pavements/);
ok(/fault reports are rising/.test(text(d.querySelector(".main"))), "suggested questions are prepared, with no call to Claude");
w.location.hash = "#a/NORTHBRIDGE";
await see(d, /Write a new reading/);
button(d, "Write a new reading").click();
await see(d, /nothing is saved and Claude isn't used here/);
ok(store.size === before && claude.calls.length === spendCalls, "nothing is saved and Claude isn't called");
ok(asked.every((u) => /\/demo\/data\.json|\/api\/config/.test(u)), "the demonstration asks the server for nothing else");
ok(!files(`${R}authorities/NORTHBRIDGE`).length, "and there's no Northbridge in storage");

// a signed-in member who opens the demonstration
dom = await open("/demo", member); d = dom.window.document; w = dom.window;
await see(d, /Northbridge: how people feel about their roads/);
ok(d.querySelector(".demo-banner") && !/West Sussex/.test(text(d.getElementById("app"))), "a signed-in member gets the demonstration, not their own data");
ok(w.localStorage.getItem("clarion_token") === member, "and stays signed in");

// the demonstration's file can't be read
dom = await open("/demo", boss, "/demo/data.json"); d = dom.window.document;
await until(() => /couldn't start/.test(text(d.getElementById("app"))), "the message");
ok(!d.querySelector(".main") && !/All authorities/.test(text(d.getElementById("app"))), "if the demonstration can't start, real figures never appear in its place");

// turning it off
process.env.DEMO = "off";
ok((await handleRequest(new Request("https://clarion.test/demo/data.json"))).status === 404 && (await api("/api/config")).demo === false, "DEMO=off turns the demonstration off");
dom = await open("/demo"); d = dom.window.document;
await until(() => d.querySelector("#si-email"), "the sign-in form");
ok(![...d.querySelectorAll("a")].some((a) => /Northbridge/.test(a.textContent)), "and its button goes");
delete process.env.DEMO;

// ---- FHRG administrators
for (const token of [member, lead, kirk]) ok((await api("/api/admin/overview", {}, token)).status === 403, "only site administrators can see all authorities");
ok((await api("/api/admin/overview")).status === 401, "and nobody signed in can");
let r = await api("/api/admin/overview", {}, boss);
ok(r.status === 200 && r.authorities.map((x) => x.name).join() === "Kirklees,Lincolnshire,West Sussex", "authorities are listed alphabetically");
ok(r.totals.using === 0 && r.totals.middle === null && r.topics.length === 0, "with nothing to report yet");

// real activity in one authority, with a comment in it
const id = (await api("/api/survey/new", { code: WSX, title: "Autumn roads" }, lead)).survey.id;
const access = (await api("/api/survey/status", { code: WSX, id, status: "open" }, lead)).survey.access;
await api("/api/s/submit", { access, forms: Array.from({ length: 40 }, (_, i) => ({ client: `c${i}`, site: "Square", secs: 200, answers: { c1: i < 10 ? "Very satisfied" : "Very dissatisfied", c2: "Worse", ...(i === 0 ? { c3: "A hole by the Jane Smith memorial on Park Lane" } : {}), a1: "45 to 54", a2: "Female" } })) });
r = await api("/api/admin/overview", {}, boss);
ok(!JSON.stringify(r).includes("Park Lane"), "a comment waiting for its names to go doesn't appear");
await api("/api/survey/sort", { code: WSX, id }, lead);
await until(async () => (await api("/api/survey/help", { code: WSX, id, job: id }, lead)).job.status !== "working", "the sorting");
const reading = await api("/api/reading/start", { code: WSX }, lead);
await until(async () => (await api("/api/reading/get", { code: WSX, id: reading.reading.id }, lead)).reading.status === "ready", "the reading");
r = await api("/api/admin/overview", {}, boss);
const text2 = JSON.stringify(r);
const row = r.authorities.find((x) => x.name === "West Sussex");
ok(r.totals.using === 1 && r.totals.withSurvey === 1 && r.totals.replies === 40 && r.totals.surveys === 1, "the totals count what's happened");
ok(row.street.responses === 40 && row.street.satisfied === r.totals.middle && row.direction, "and the authority's row shows its figures");
ok(r.regions.find((g) => g.name === "South East").authorities === 1 && r.topics.length === 1 && r.topics[0].regions.reduce((a, b) => a + b, 0) === 1, "top topics are counted by region");
ok(!/Park Lane|Jane|\[removed\]/.test(text2) && !text2.includes("A hole"), "no resident's words reach the FHRG view");
ok(r.use.readings === 1 && r.use.spend > 0 && r.use.cap === 40, "use and spend are shown");
ok(!text2.includes(access), "and no tablet code");

dom = await open("/", boss); d = dom.window.document; w = dom.window;
await see(d, /Core questions by authority/);
main = text(d.querySelector(".main"));
ok(/FHRG administration/.test(text(d.querySelector(".rail"))) && d.querySelector('.nav button[aria-current="page"]').textContent === "All authorities", "a site administrator lands on all authorities");
await see(d, /No titles held yet/);
ok(/ABC circulation figures/.test(text(d.querySelector(".main"))), "an administrator can paste in ABC's list");
d.querySelector('textarea[aria-label="ABC\'s table"]').value = "Jan - Dec 2025\tTest Herald\tOwner\tRegional Publication\t1234\tCirculation (average per issue)";
button(d, "Save the list").click();
await see(d, /Saved 1 title\./);
ok(/1 of 3/.test(main) && /Figures and topic counts only/.test(main) && /not ranked/.test(main), "with the totals, and how to read them");
ok(/Early signs in more than one authority/.test(main) && /No authority is named here/.test(main), "and early signs are shown without naming anyone");
ok(d.querySelector("table.heat"), "topics are shown by region");
button(d, "Download the figures").click();
await until(() => w.downloaded, "the download");
ok((await w.downloaded.text()).includes("West Sussex"), "the figures can be downloaded");
d.querySelector(`a[href="#a/${WSX}"]`).click();
w.location.hash = `#a/${WSX}`;
await see(d, /West Sussex: how people feel about their roads/);
ok(/West Sussex/.test(text(d.querySelector(".brand-sub"))) && button(d, "All authorities"), "an authority's row opens its own view, with a way back");

const later = (await api("/api/survey/new", { code: WSX, title: "Winter roads" }, lead)).survey.id;
const laterCode = (await api("/api/survey/status", { code: WSX, id: later, status: "open" }, lead)).survey.access;
await api("/api/s/submit", { access: laterCode, forms: Array.from({ length: 35 }, (_, i) => ({ client: `w${i}`, site: "Square", secs: 200, answers: { c1: "Very satisfied", c2: "Better" } })) });
ok((await api("/api/admin/overview", {}, boss)).authorities.find((x) => x.name === "West Sussex").street.title === "Winter roads", "an authority's latest survey is the one shown");

dom = await open("/#all", member); d = dom.window.document;
await see(d, /West Sussex: how people feel about their roads/);
ok(!button(d, "All authorities") && !d.querySelector('select[aria-label="Open an authority"]'), "a member can't reach all authorities, even by its address");
const both = await api("/api/admin/overview", {}, boss);
ok(both.totals.replies === 75 && both.totals.surveys === 2, "replies are counted from every survey with results, not only the latest");
await api("/api/survey/new", { code: "E08000034", title: "Just a draft" }, kirk);
ok((await api("/api/admin/overview", {}, boss)).totals.using === 1, "and a draft nobody has opened doesn't count as using Clarion");
await see(d, /35 street survey replies/);
ok(true, "and their summary leads with their latest survey");

// ---- what an authority sees of the others
ok(t.middleFigure(Array.from({ length: 4 }, () => ({ satisfied: 30, worse: 40 }))) === null, "fewer than five authorities gives no FHRG figure");
const middle = t.middleFigure([20, 30, 40, 50, 60].map((satisfied) => ({ satisfied, worse: null })));
ok(middle.satisfied === 40 && middle.worse === null && middle.authorities === 5 && !("name" in middle), "five give a middle figure, with nobody named");
ok(t.middleFigure([{ satisfied: 20, worse: 61 }, ...[30, 40, 50, 60].map((satisfied) => ({ satisfied, worse: null }))]).worse === null, "and one authority's answer can't pass as the middle figure");
r = await api("/api/authority", { code: WSX }, member);
ok(r.benchmark === null && r.adults > 0, "an authority's page carries its adults, and no FHRG figure yet");
ok((await api("/api/coverage/get", { code: WSX }, member)).ready === true && (await api("/api/coverage/get", { code: WSX }, kirk)).status === 403 && (await api("/api/attention", { code: WSX })).status === 401, "what's being said and the comparison keep to the usual access rules");

console.log(failures ? `\n${failures} FAILED` : "\nAll passed");
process.exit(failures ? 1 : 0);
