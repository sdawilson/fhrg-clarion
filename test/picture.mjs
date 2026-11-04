// The two pictures on the Summary page: what shapes opinion, and one resident.
import fs from "node:fs";
import { JSDOM } from "jsdom";
import { addUser, files, putText, until } from "./sim.mjs";
const { handleRequest } = await import("./.build/app.mjs");
const t = await import("./.build/internals.mjs");

let failures = 0;
const ok = (cond, what) => { console.log(`${cond ? "PASS" : "FAIL"}  ${what}`); if (!cond) failures++; };
const WSX = "E10000032";
const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

// ---- the sums
const piece = (type, tone, relevance = "High", date = new Date().toISOString().slice(0, 10)) => ({ sourceType: type, tone, relevance, date, topic: "Potholes", reach: 100, adjusted: 100 });
const today = new Date().toISOString().slice(0, 10), old = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
const summary = t.summariseCoverage([piece("Local Radio", "Critical"), piece("Local Radio", "Critical"), piece("Local Radio", "Supportive"), piece("Social Media", "Neutral"), piece("Social Media", "Critical", "None"), piece("Local Newspaper", "Critical", "High", old)], today);
ok(summary.byType.map((x) => `${x.type}:${x.pieces}:${x.critical}:${x.supportive}`).join() === "Social Media:1:0:0,Local Radio:3:2:1", "pieces are counted by kind of source, leaving out old ones and any marked as not relevant");
const SEVEN = [[16, 24], [25, 34], [35, 44], [45, 54], [55, 64], [65, 74], [75, null]];
const row = (measure, values) => values.map((value, i) => ({ measure, age_from: SEVEN[i][0], age_to: SEVEN[i][1], value, publisher: "", year: "2026" }));
const channels = t.channelsFrom(row("Local news in the last month or so: Radio", [18, 17, 27, 26, 28, 31, 33]));
ok(channels.length === 1 && channels[0].label === "Radio" && channels[0].rates.join() === "18,17,27,26,28,31,33", "each way of getting news keeps its seven age groups");
ok(t.channelsFrom([]).length === 0, "and one the library doesn't hold is left out");

// ---- the route
await addUser(1, "lead@westsussex.gov.uk", "Lee Lead", 30, "lead");
await addUser(3, "kit@kirklees.gov.uk", "Kit Officer", 20, "lead");
const api = async (path, body, token) => { const res = await handleRequest(new Request(`https://clarion.test${path}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { "x-session-token": token } : {}) }, body: JSON.stringify(body) })); return Object.assign(await res.json(), { status: res.status }); };
const login = async (email) => (await api("/api/login", { email, password: "pw" })).token;
const lead = await login("lead@westsussex.gov.uk"), kit = await login("kit@kirklees.gov.uk");
ok((await api("/api/picture", { code: WSX })).status === 401, "the picture needs a sign-in");
ok((await api("/api/picture", { code: WSX }, kit)).status === 403, "and it's only for your own authority");
let r = await api("/api/picture", { code: WSX }, lead);
ok(r.ages.length === 7 && r.adults?.length === 7 && r.channels.length >= 3 && r.channels.every((x) => x.rates.length === 7), "it gives age groups, local adults and how each age gets news");
ok(r.channels[0].key === "word" && r.channels[0].rates.join() === "42,49,49,61,55,60,63", "from the library");
ok(r.weather === null, "and no weather until Works and weather is on");

// ---- the pages
function browser(address, token, setup) {
  return new JSDOM(html, {
    url: `https://clarion.test${address}`, runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(w) {
      if (token) w.localStorage.setItem("clarion_token", token);
      w.scrollTo = () => {};
      w.fetch = async (url, opts = {}) => {
        if (w.noPicture && String(url).includes("/api/picture")) return { ok: false, status: 500, json: async () => ({ error: "No" }) };
        if (w.noChannels && String(url).includes("/api/picture")) { const res = await handleRequest(new Request(new URL(url, "https://clarion.test").href, opts)); const body = await res.json(); return { ok: true, status: 200, json: async () => ({ ...body, channels: [] }) }; }
        const res = await handleRequest(new Request(new URL(url, "https://clarion.test").href, opts));
        const text = await res.text();
        return { ok: res.ok, status: res.status, json: async () => JSON.parse(text) };
      };
      setup?.(w);
    },
  }).window.document;
}
const text = (el) => (el?.textContent ?? "").replace(/\s+/g, " ");
const shows = (d, pattern) => until(() => pattern.test(text(d.querySelector(".main"))), `the page to show ${pattern}`);
const tab = (d, words) => [...d.querySelectorAll(".pic-card [role=tab]")].find((b) => b.textContent === words);
const age = (d, words) => [...d.querySelectorAll(".age-pick button")].find((b) => b.textContent === words);
const spot = (d, words) => [...d.querySelectorAll(".spot")].find((x) => x.querySelector(".spot-label").textContent.startsWith(words));
const plate = (d, words) => spot(d, words).querySelector(".plate").textContent;

// the demonstration
const pack = t.buildPack();
let d = browser("/demo", "");
await shows(d, /What shapes opinion/);
await until(() => d.querySelector(".pic .spot"), "the map");
ok(text(d.querySelector(".pic-middle")).includes("Northbridge") && /Mood: worsening/.test(text(d.querySelector(".pic-middle"))), "the authority sits in the middle, with its mood");
const papers = pack.coverage.summary.byType.find((x) => x.type === "Local Newspaper");
ok(plate(d, "Local papers") === String(papers.pieces) && spot(d, "Local papers").classList.contains("lean-down"), "local papers show their pieces, marked as mostly critical");
ok(spot(d, "Local papers").getAttribute("aria-label").includes("Mostly critical") && spot(d, "Local papers").querySelector(".spot-label").textContent.includes("▼"), "and that isn't shown by colour alone");
ok(spot(d, "Fault reports").getAttribute("href") === "#evidence/NORTHBRIDGE" && spot(d, "Street survey").getAttribute("href").includes("/results"), "each circle leads to what's behind it");
ok(plate(d, "Street survey") === `${Math.round(pack.authority.evidence.streets[0].satisfied)}%`, "the street survey shows its real figure");
ok(/^\d\.\dk$/.test(plate(d, "Enquiries")) && /^\d,\d{3} enquiries/.test(spot(d, "Enquiries").querySelector(".spot-tip").textContent), "a big number is shortened to fit its circle, with the whole number beside it");
const points = [...d.querySelectorAll(".pic .spot")].map((x) => [parseFloat(x.style.left), parseFloat(x.style.top)]);
ok(points.every(([x, y]) => x > 15 && x < 85 && y > 5 && y < 95), "everything sits inside the picture");
ok(new Set([...d.querySelectorAll(".pic .spot")].map((x) => x.className.split(" ")[1])).size >= 3, "with labels pointing outwards");
ok(d.querySelectorAll(".pic-hub").length === 5 && d.querySelectorAll(".pic-lines .road").length === 5, "five roads lead in");
ok(!/null|undefined|NaN/.test(text(d.querySelector(".pic-card"))), "with nothing broken on the page");

tab(d, "One resident").click();
await until(() => d.querySelector(".age-pick"), "the age groups");
const held = pack.picture, all = held.adults.reduce((n, x) => n + x, 0), everyone = (key) => Math.round(held.adults.reduce((n, x, i) => n + x * held.channels.find((c) => c.key === key).rates[i], 0) / all);
ok(text(d.querySelector(".pic-middle")).includes("Everyone here") && plate(d, "Television") === `${everyone("tv")}%`, "one resident starts with everyone here, weighted by local ages");
ok(d.querySelectorAll(".pic .spot").length === 11, "surrounded by eleven ways of getting news");
age(d, "16 to 24").click();
ok(plate(d, "Social media") === "59%" && plate(d, "Television") === "25%", "choosing an age changes the numbers");
ok(spot(d, "Social media").classList.contains("band-4") && spot(d, "Television").classList.contains("band-2"), "and the colours");
const young = parseInt(spot(d, "Television").style.getPropertyValue("--d"), 10);
const spokeOf = (name) => [...d.querySelectorAll(".spoke")][[...d.querySelectorAll(".pic .spot")].indexOf(spot(d, name))].style.strokeWidth;
const thin = parseFloat(spokeOf("Television"));
ok(/social media, word of mouth/.test(text(d.querySelector(".pic-line"))) && /Aged 16 to 24/.test(text(d.querySelector(".pic-middle"))), "and says who's most likely to reach them");
ok(/% of adults here/.test(text(d.querySelector(".pic-middle"))), "and how many people that age live here");
ok(/more in every 100 than everyone here|fewer in every 100 than everyone here/.test(spot(d, "Social media").querySelector(".spot-tip").textContent), "with the difference from everyone here");
age(d, "75 or over").click();
ok(plate(d, "Television") === "64%" && spot(d, "Television").classList.contains("band-5") && age(d, "75 or over").getAttribute("aria-pressed") === "true" && age(d, "16 to 24").getAttribute("aria-pressed") === "false", "another age changes them again");
ok(parseInt(spot(d, "Television").style.getPropertyValue("--d"), 10) > young && parseFloat(spokeOf("Television")) > thin, "and the circle and its road grow with the number");
ok(/national pattern by age from Ofcom/i.test(text(d.querySelector(".pic-card"))) && /doesn't measure Northbridge/.test(text(d.querySelector(".pic-card"))), "it says this is a national pattern, not a measure of the authority");
ok(d.querySelectorAll(".pic-card details table tbody tr").length === 11, "and there's a table of every age");
const remembered = d.defaultView;
remembered.location.hash = "#evidence/NORTHBRIDGE";
await shows(d, /Published figures|Evidence/);
remembered.location.hash = "#a/NORTHBRIDGE";
await until(() => d.querySelector(".age-pick"), "the same view again");
ok(tab(d, "One resident").getAttribute("aria-selected") === "true", "the page remembers which picture you were looking at");

// a real authority, with nothing much held
d = browser(`/#a/${WSX}`, lead);
await until(() => d.querySelector(".pic .spot"), "the real map");
ok(/West Sussex/.test(text(d.querySelector(".pic-middle"))) && /Mood not read yet/.test(text(d.querySelector(".pic-middle"))), "a real authority shows in the middle");
ok(spot(d, "Press and media").classList.contains("lean-none") && plate(d, "Press and media") === "–", "with nothing assessed, it invites you to start");
ok(spot(d, "Street survey").classList.contains("lean-none") && spot(d, "Street survey").getAttribute("href") === `#surveys/${WSX}`, "and points to planning a street survey");
ok(spot(d, "Weather events").getAttribute("href") === `#attention/${WSX}/works`, "and to Works and weather");
ok(!/null|undefined|NaN/.test(text(d.querySelector(".pic-card"))), "with nothing broken on the page");
tab(d, "One resident").click();
await until(() => d.querySelector(".age-pick"), "the age groups");
ok(d.querySelectorAll(".pic .spot").length === 3, "one resident shows only what the library holds");

// a survey with no interviewers isn't shown as a street survey
const made = (await api("/api/survey/new", { code: WSX, title: "By link", purpose: "x" }, lead)).survey;
await api("/api/survey/status", { code: WSX, id: made.id, status: "open" }, lead);
const rows = Array.from({ length: 35 }, (_, i) => ({ n: i + 1, form: `R${i + 1}`, via: "self", where: "here", site: "", at: new Date().toISOString(), secs: 100, answers: { c1: "Fairly satisfied" }, topics: {}, clean: {}, checked: {} }));
const answers = files("").find((k) => k.endsWith(`/surveys/${made.id}.json`)).replace("/surveys/", "/survey-answers/");
putText(answers, JSON.stringify(rows));
d = browser(`/#a/${WSX}`, lead);
await until(() => d.querySelector(".pic .spot"), "the map again");
ok(spot(d, "Street survey").classList.contains("lean-none") && !/% satisfied/.test(text(d.querySelector(".pic-middle"))), "a survey with no interviewers isn't shown as a street survey");
putText(answers, JSON.stringify(rows.map((x) => ({ ...x, via: "tablet", where: undefined, form: `T${x.n}` }))));
d = browser(`/#a/${WSX}`, lead);
await until(() => d.querySelector(".pic .spot"), "the map once more");
ok(plate(d, "Street survey") === "100%" && spot(d, "Street survey").classList.contains("lean-up") && /100% satisfied/.test(text(d.querySelector(".pic-middle"))), "one with interviewers is");

// when something can't be read
d = browser(`/#a/${WSX}`, lead, (w) => { w.noPicture = true; });
await until(() => d.querySelector(".pic .spot"), "the map without extras");
ok(plate(d, "Government news") === "–" && spot(d, "Government news").classList.contains("lean-none"), "the map still draws if the extras can't be read");
tab(d, "One resident").click();
await shows(d, /aren't available just now/);
d = browser(`/#a/${WSX}`, lead, (w) => { w.noChannels = true; });
await until(() => tab(d, "One resident"), "the tabs");
tab(d, "One resident").click();
await shows(d, /aren't available just now/);
ok(!d.querySelector(".age-pick"), "and one resident says so if the figures aren't there");

console.log(failures ? `\n${failures} failed` : "\nAll passed");
process.exit(failures ? 1 : 0);
