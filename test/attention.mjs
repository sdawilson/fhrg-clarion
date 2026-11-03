// Attention and concern: the calculation on its own, then the route, a mood reading and the pages against the simulators.
import fs from "node:fs";
import { JSDOM } from "jsdom";
import { addUser, claude, newsTopics, until } from "./sim.mjs";
const { handleRequest } = await import("./.build/app.mjs");
const t = await import("./.build/internals.mjs");

let failures = 0;
const ok = (cond, what) => { console.log(`${cond ? "PASS" : "FAIL"}  ${what}`); if (!cond) failures++; };
const WSX = "E10000032", KIRK = "E08000034";

// ---- the calculation
const said = (topic, pieces, adjusted = 100) => ({ topic, pieces, adjusted, critical: 0, supportive: 0 });
const contact = (topic, enquiries, complaints = 0) => ({ topic, enquiries, complaints, trend: "Steady" });
ok(/assessed press/.test(t.compare([], [{ topic: "A", count: 3 }], []).needs), "with nothing assessed, it says what's needed");
ok(/street survey or enquiries/.test(t.compare([said("A", 2)], [], []).needs), "and with no measure of concern");
ok(/at least 3 topics/.test(t.compare([said("A", 2)], [{ topic: "A", count: 3 }], []).needs), "and with too few topics to compare");

ok(t.placeTopic(1, 1, 4).action === "Act, and be seen to" && t.placeTopic(1, 4, 4).early && t.placeTopic(1, 4, 4).action === "Look into it early" && t.placeTopic(4, 1, 4).action === "Answer it, but don't over-react" && t.placeTopic(4, 4, 4).action === "Keep watching" && !t.placeTopic(4, 1, 4).early, "each corner of the chart says what to do");

let c = t.compare([said("Loud", 9), said("Both", 5), said("Quiet", 1), said("Felt", 1, 5)], [{ topic: "Felt", count: 20 }, { topic: "Both", count: 15 }, { topic: "Quiet", count: 2 }, { topic: "Loud", count: 1 }], []);
const row = (name) => c.topics.find((x) => x.topic === name);
ok(c.ready && c.topics[0].topic === "Felt" && row("Felt").concern === 1 && row("Felt").attention === 4 && row("Quiet").attention === 3 && row("Loud").attention === 1 && row("Loud").concern === 4, "topics are ranked on both sides, with reach breaking a tie");
ok(c.earlySigns.map((x) => x.topic).join() === "Felt" && /20 street survey comments, against 1 assessed piece\./.test(c.earlySigns[0].why), "an early sign is felt but not reported, and says why in figures");
ok(c.usesSurvey && !c.usesEnquiries && row("Felt").kinds === "Street survey, Press and media", "and the kinds of signal behind each topic are named");

c = t.compare([said("A", 5), said("B", 3), said("C", 1)], [], [contact("C", 900, 100), contact("A", 90, 10)]);
ok(c.ready && c.topics[0].topic === "C" && row("C").contacts === 1000 && !c.usesSurvey && c.usesEnquiries, "enquiries alone can stand for concern, before any street survey");
ok(c.earlySigns[0]?.topic === "C" && /1,000 enquiries and complaints, against 1 assessed piece\./.test(c.earlySigns[0].why), "and can raise an early sign");

c = t.compare([said("A", 5), said("B", 3), said("C", 1), said("D", 1)], [{ topic: "A", count: 90 }, { topic: "B", count: 10 }], [contact("B", 90), contact("C", 10)]);
ok(row("B").concern === 1 && row("A").concern === 2 && row("C").concern === 3, "with both held, each counts equally, however different their sizes");
c = t.compare([said("A", 2), said("B", 1)], [{ topic: "C", count: 1 }], []);
ok(c.ready && c.topics.length === 3 && row("C").attention === 3 && row("C").pieces === 0, "a topic nobody has reported comes last for attention");

// ---- through the API
newsTopics.push("Parking", "Pavements");
await addUser(1, "lead@westsussex.gov.uk", "Lee Lead", 30, "lead");
await addUser(2, "member@westsussex.gov.uk", "Mo Member", 30, "member");
await addUser(3, "kit@kirklees.gov.uk", "Kit Officer", 20, "lead");
await addUser(4, "boss@fhrg.test", "Bo Boss", 99, "member");
const api = async (path, body, token) => { const r = await handleRequest(new Request(`https://clarion.test${path}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { "x-session-token": token } : {}) }, body: JSON.stringify(body) })); return { status: r.status, ...(await r.json()) }; };
const login = async (email) => (await api("/api/login", { email, password: "pw" })).token;
const lead = await login("lead@westsussex.gov.uk"), member = await login("member@westsussex.gov.uk"), kit = await login("kit@kirklees.gov.uk"), boss = await login("boss@fhrg.test");
const monthsBack = (n) => { const d = new Date(); d.setUTCDate(15); d.setUTCMonth(d.getUTCMonth() - n); return d.toISOString().slice(0, 7); };
const daysBack = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const OFFICER_WORDS = "Officer's own words about the piece";
async function fill(code, token) {
  const src = (await api("/api/coverage/source", { code, name: "A paper", type: "Local Newspaper", reach: 5000 }, token)).source;
  for (const [topic, n] of [["Potholes", 3], ["Road safety", 2], ["Parking", 1]]) for (let i = 0; i < n; i++) await api("/api/coverage/assess", { code, source: src.id, date: daysBack(2 + i), summary: OFFICER_WORDS, topic, relevance: "High", tone: "Critical", prominence: "Inside page" }, token);
}
let r = await api("/api/attention", { code: WSX });
ok(r.status === 401, "this needs a sign-in");
ok((await api("/api/attention", { code: WSX }, kit)).status === 403, "and it's only for your own authority");
r = await api("/api/attention", { code: WSX }, member);
ok(r.ready === false && /assessed press/.test(r.needs), "with nothing held, it says what's needed");
await fill(WSX, lead);
r = await api("/api/attention", { code: WSX }, member);
ok(r.ready === false && /street survey or enquiries/.test(r.needs), "with pieces but nothing on concern, it says that too");
const oldMonths = { [monthsBack(6)]: { categories: { "Street lights": [500, 20], Pavements: [400, 30], "Road defects": [20, 1] }, areas: {}, routes: {} } };
await api("/api/enquiries/import", { code: WSX, file: "old.csv", rows: 971, months: oldMonths }, lead);
r = await api("/api/attention", { code: WSX }, member);
ok(r.ready === false, "enquiries from six months ago don't speak for now");
await api("/api/enquiries/import", { code: WSX, file: "new.csv", rows: 971, months: { [monthsBack(1)]: oldMonths[monthsBack(6)] } }, lead);
r = await api("/api/attention", { code: WSX }, member);
ok(r.ready && r.usesEnquiries && r.topics[0].topic === "Street lighting" && r.earlySigns.some((x) => x.topic === "Street lighting"), "recent enquiries do, and the comparison is worked out");
ok(!JSON.stringify(r).includes(OFFICER_WORDS), "with no officer's words in it");

// a mood reading sees figures and topic counts, never the words
const before = claude.calls.length;
await api("/api/reading/start", { code: WSX }, lead);
await until(() => claude.calls.length > before, "a reading to reach Claude");
const prompt = JSON.stringify(claude.calls.at(-1));
ok(/assessed_press_and_media_last_four_weeks/.test(prompt) && /enquiries_and_complaints_latest_month/.test(prompt) && /signal held here are:[^.]*actions/.test(prompt) && /signal held here are:[^.]*open talk/.test(prompt), "a mood reading gets assessments and enquiries as signals");
ok(!prompt.includes(OFFICER_WORDS), "but never an officer's words");

// across authorities: a count, with no authority named
await fill(KIRK, kit);
await api("/api/enquiries/import", { code: KIRK, file: "k.csv", rows: 971, months: { [monthsBack(1)]: oldMonths[monthsBack(6)] } }, kit);
r = await api("/api/admin/overview", {}, boss);
ok(r.earlySigns.some((x) => x.topic === "Street lighting" && x.authorities === 2), "an early sign in more than one authority is counted across the FHRG");
ok(!JSON.stringify(r.earlySigns).includes("West Sussex") && !JSON.stringify(r.earlySigns).includes("Kirklees") && r.authorities.every((x) => !("early" in x)), "with no authority named, and nothing to tie it to one");

// ---- the pages
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
let dom = await open(member, `#attention/${WSX}`), d = dom.window.document;
await see(d, /What's driving it/);
let main = text(d.querySelector(".main"));
ok(d.querySelector(".quad") && /Street lighting/.test(main) && /for concern/.test(main) && /your enquiries/.test(main) && /Look into it early/.test(main), "the page shows the chart, the early signs and what to do");
ok(!/\bnull\b|undefined/.test(main), "with nothing stray on the page");
dom = await open(member, `#a/${WSX}`); d = dom.window.document;
await see(d, /Early signs/);
ok(d.querySelector(".quad"), "and the Summary page shows it too");
await addUser(5, "lead@lincolnshire.gov.uk", "Lin Lead", 10, "lead");
const lin = await login("lead@lincolnshire.gov.uk");
dom = await open(lin, "#attention/E10000019"); d = dom.window.document;
await see(d, /It needs assessed press and media pieces/);
ok(d.querySelector('a[href="#said/E10000019"]'), "an authority with nothing yet is told what's needed, and where to go");

console.log(failures ? `\n${failures} FAILED` : "\nAll passed");
process.exit(failures ? 1 : 0);
