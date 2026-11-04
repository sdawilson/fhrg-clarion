// Hosted survey pages: people filling a survey in themselves from a link, the postcode check, and keeping their replies
// apart from interviewers', through the API and on the pages.
import fs from "node:fs";
import { createHash } from "node:crypto";
import { JSDOM } from "jsdom";
import { addUser, claude, files, getText, postcodesDown, putText, until } from "./sim.mjs";
const { handleRequest, setSurveyPage } = await import("./.build/app.mjs");
const t = await import("./.build/internals.mjs");

let failures = 0;
const ok = (cond, what) => { console.log(`${cond ? "PASS" : "FAIL"}  ${what}`); if (!cond) failures++; };
const WSX = "E10000032", KIRK = "E08000034";

// ---- the sums
ok(t.outcodeOf("RH12 1AB") === "RH12" && t.outcodeOf("rh121ab") === "RH12" && t.outcodeOf(" rh12 ") === "RH12" && t.outcodeOf("M1 1AE") === "M1" && t.outcodeOf("EC1A 1BB") === "EC1A" && t.outcodeOf("SW1A1AA") === "SW1A", "the first half of a postcode is found, however it's typed");
ok(t.outcodeOf("") === null && t.outcodeOf("my house") === null && t.outcodeOf("123") === null && t.outcodeOf(undefined) === null && t.outcodeOf("../../etc") === null, "and anything else is ignored");
const wsx = { name: "West Sussex" };
ok(t.whereIs(wsx, { districts: ["Horsham"], counties: ["Surrey", "West Sussex"] }) === "here" && t.whereIs({ name: "Kirklees" }, { districts: ["Kirklees"], counties: [] }) === "here", "an area that touches the authority counts as here, by county or district");
ok(t.whereIs(wsx, { districts: ["Manchester"], counties: [] }) === "elsewhere" && t.whereIs(wsx, null) === "unknown", "another area is elsewhere, and an unknown one stays unknown");
const areas = t.areaRows({ RH12: 14, BN11: 10, PO19: 9, GU28: 1 });
ok(areas.named.map((x) => x.area).join() === "RH12,BN11" && areas.pooled === 10, "areas with fewer than 10 replies are pooled");

// checked against a real decoder when it was written, so this notices if it ever changes
const qr = t.qrCode("https://clarion.fhrg.co.uk/r/ABCDEFGHJKMN");
ok(qr.length === 29 && qr.every((r) => r.length === 29) && qr[0].startsWith("1111111") && qr[6].startsWith("1111111") && qr[0].endsWith("1111111") && qr[28].startsWith("1111111"), "a QR code has its three corner squares");
ok(createHash("sha256").update(qr.join("\n")).digest("hex").startsWith("db2ad8cde4a24479"), "and comes out as the decoder read it");

// ---- through the API
await addUser(1, "lead@westsussex.gov.uk", "Lee Lead", 30, "lead");
await addUser(2, "member@westsussex.gov.uk", "Mo Member", 30, "member");
await addUser(3, "kit@kirklees.gov.uk", "Kit Officer", 20, "lead");
await addUser(4, "boss@fhrg.test", "Bo Boss", 99, "member", 1);
let ip = 0;
const api = async (path, body, token, address) => { const res = await handleRequest(new Request(`https://clarion.test${path}`, { method: "POST", headers: { "content-type": "application/json", "x-real-ip": address ?? `10.0.0.${++ip % 250}`, ...(token ? { "x-session-token": token } : {}) }, body: JSON.stringify(body) })); return Object.assign(await res.json(), { status: res.status }); };
const login = async (email) => (await api("/api/login", { email, password: "pw" })).token;
const lead = await login("lead@westsussex.gov.uk"), member = await login("member@westsussex.gov.uk"), kit = await login("kit@kirklees.gov.uk"), boss = await login("boss@fhrg.test");

const made = (await api("/api/survey/new", { code: WSX, title: "Roads survey", purpose: "PRIVATE-PURPOSE of the officer" }, lead)).survey;
const id = made.id;
await api("/api/survey/save", { code: WSX, id, plan: { sites: [{ name: "High Street", share: 1 }] } }, lead);
ok((await api("/api/survey/self", { code: WSX, id, on: true }, lead)).status === 400, "a draft can't have a link, as its questions can still change");
await api("/api/survey/status", { code: WSX, id, status: "open" }, lead);
ok((await api("/api/survey/self", { code: WSX, id, on: true }, member)).status === 403 && (await api("/api/survey/self", { code: WSX, id, on: true }, kit)).status === 403, "only a lead of the authority can turn the link on");
let r = await api("/api/survey/self", { code: WSX, id, on: true }, lead);
const link = r.survey.self, access = r.survey.access;
ok(r.survey.selfOn && /^[A-HJKMNP-Z2-9]{12}$/.test(link) && link !== access, "turned on, it has its own long code, apart from interviewers'");
ok((await api("/api/survey/get", { code: WSX, id }, member)).survey.self === "" && (await api("/api/survey/get", { code: WSX, id }, boss)).survey.self, "a member isn't shown it");
r = await api("/api/survey/qr", { code: WSX, id, origin: "https://clarion.fhrg.co.uk" }, lead);
ok(r.url === `https://clarion.fhrg.co.uk/r/${link}` && r.rows.length > 20, "it comes with a QR code");
ok((await api("/api/survey/qr", { code: WSX, id, origin: "javascript:alert(1)" }, lead)).status === 400 && (await api("/api/survey/qr", { code: WSX, id, origin: "https://x" }, member)).status === 403, "for its own officers, and a proper address");

r = await api("/api/r/get", { access: link });
ok(Object.keys(r.survey).sort().join() === "collector,questions,title" && !JSON.stringify(r).includes("PRIVATE-PURPOSE") && !JSON.stringify(r).includes("High Street"), "someone with the link gets the questions and nothing else");
ok((await api("/api/r/get", { access })).status === 404 && (await api("/api/s/get", { access: link })).status === 404, "and neither code opens the other's page");
ok((await api("/api/r/get", { access: "AAAAAAAAAAAA" })).status === 404, "a made-up link is refused");
setSurveyPage(fs.readFileSync(new URL("../public/survey.html", import.meta.url), "utf8"));
const page = await handleRequest(new Request(`https://clarion.test/r/${link}`));
ok(page.status === 200 && (await page.text()).includes("noindex"), "the page opens with no sign-in, and search engines are asked to leave it out");

const reply = (client, postcode, more = {}, c1 = "Fairly dissatisfied") => ({ access: link, client, secs: 200, postcode, answers: { c1, c2: "Worse", a1: "45 to 54", a2: "Female", ...more } });
const answersFile = () => files(`clarion/authorities/${WSX}/survey-answers/`).find((f) => f.includes(id));
const areaFile = () => files(`clarion/authorities/${WSX}/survey-areas/`).find((f) => f.includes(id));
r = await api("/api/r/submit", reply("a", "RH12 1AB secret"));
ok(r.ok, "a reply is taken");
let held = JSON.parse(getText(answersFile()));
ok(held.length === 1 && held[0].via === "self" && held[0].where === "here" && held[0].form.startsWith("R") && held[0].site === "", "labelled as filled in themselves, and as living here");
ok(!getText(answersFile()).includes("RH12") && !getText(answersFile()).includes("1AB") && !getText(answersFile()).includes("postcode"), "with no postcode on the reply");
ok(JSON.parse(getText(areaFile())).RH12 === 1 && !getText(areaFile()).includes("1AB"), "and the area counted apart, first half only");
ok(postcodesDown.asked.at(-1).endsWith("/outcodes/RH12"), "postcodes.io is sent the first half only");
await api("/api/r/submit", reply("a", "RH12 1AB"));
ok(JSON.parse(getText(answersFile())).length === 1 && JSON.parse(getText(areaFile())).RH12 === 1, "sending a reply twice counts it once");
const asked = postcodesDown.asked.length;
await api("/api/r/submit", reply("b", "rh12"));
ok(postcodesDown.asked.length === asked && JSON.parse(getText(areaFile())).RH12 === 2, "each area is looked up once");
await api("/api/r/submit", reply("c", "M1 1AE"));
await api("/api/r/submit", reply("d", ""));
await api("/api/r/submit", reply("e", "ZZ99 9ZZ"));
postcodesDown.on = true;
r = await api("/api/r/submit", reply("f", "BN11 1AA"));
postcodesDown.on = false;
held = JSON.parse(getText(answersFile()));
ok(held.map((x) => x.where).join() === "here,here,elsewhere,unknown,unknown,unknown" && r.ok, "elsewhere and not given are told apart, and a lookup that fails loses no reply");
ok(!getText(areaFile()).includes("ZZ99"), "a made-up area isn't counted");
ok((await api("/api/r/submit", { ...reply("g", ""), where: "here", answers: { c1: "Fairly satisfied" }, via: "tablet", site: "High Street" })).ok && JSON.parse(getText(answersFile())).at(-1).where === "unknown" && JSON.parse(getText(answersFile())).at(-1).via === "self" && JSON.parse(getText(answersFile())).at(-1).site === "", "the sender can't set the route, the site or where they live");
r = await api("/api/r/submit", { ...reply("h", ""), answers: {} });
ok(r.ok && !JSON.parse(getText(answersFile())).some((x) => x.client === "h"), "an empty reply isn't kept");

for (let i = 0; i < 20; i++) r = await api("/api/r/submit", reply(`same-${i}`, ""), undefined, "10.9.9.9");
const limited = await api("/api/r/submit", reply("same-x", ""), undefined, "10.9.9.9");
ok(r.ok && limited.status === 429, "one address can't send more than 20 in ten minutes");
ok((await api("/api/r/submit", reply("other", ""), undefined, "10.9.9.8")).ok, "others carry on");

// the cap, so a link can't crowd out interviewers
const before = getText(answersFile()), full = JSON.parse(before);
const crowd = Array.from({ length: 3000 }, (_, i) => ({ ...full[0], n: 9000 + i, form: `R${9000 + i}`, client: `crowd-${i}` }));
putText(answersFile(), JSON.stringify([...full, ...crowd]));
r = await api("/api/r/submit", reply("too-many", ""));
ok(r.status === 409 && /all the replies/.test(r.error), "replies by link stop at 3,000");
ok((await api("/api/s/submit", { access, forms: [{ client: "t1", site: "High Street", answers: { c1: "Fairly satisfied" } }] })).added === 1, "and interviewers' forms still go in");
putText(answersFile(), before);

await api("/api/survey/self", { code: WSX, id, on: false }, lead);
r = await api("/api/r/get", { access: link });
ok(r.status === 409 && /closed/.test(r.error) && (await api("/api/r/submit", reply("off", ""))).status === 409, "turned off, the link closes");
await api("/api/survey/self", { code: WSX, id, on: true }, lead);
ok((await api("/api/r/get", { access: link })).survey, "turned back on, the same link works");
ok((await api("/api/survey/get", { code: WSX, id }, lead)).survey.self === link, "with the same code");
await api("/api/survey/status", { code: WSX, id, status: "closed" }, lead);
ok((await api("/api/r/submit", reply("shut", ""))).status === 409, "it closes with the survey");
await api("/api/survey/status", { code: WSX, id, status: "open" }, lead);
await api("/api/briefing/election", { code: WSX, on: true }, lead);
r = await api("/api/r/get", { access: link });
ok(r.status === 409 && /paused/.test(r.error) && (await api("/api/r/submit", reply("elect", ""))).status === 409, "and it pauses during a pre-election period");
ok((await api("/api/survey/self", { code: WSX, id, on: true }, lead)).status === 409, "when it can't be turned on");
ok((await api("/api/survey/self", { code: WSX, id, on: false }, lead)).survey.selfOn === false, "though it can be turned off");
await api("/api/survey/self", { code: WSX, id: id, on: false }, lead);
await api("/api/briefing/election", { code: WSX, on: false }, lead);
await api("/api/survey/self", { code: WSX, id, on: true }, lead);

// a survey that hasn't been answered can go back, and its link goes too
const spare = (await api("/api/survey/new", { code: WSX, title: "Spare", purpose: "x" }, lead)).survey;
await api("/api/survey/status", { code: WSX, id: spare.id, status: "open" }, lead);
const spareLink = (await api("/api/survey/self", { code: WSX, id: spare.id, on: true }, lead)).survey.self;
await api("/api/survey/status", { code: WSX, id: spare.id, status: "draft" }, lead);
ok((await api("/api/r/get", { access: spareLink })).status === 404, "back to draft, the link goes for good");

// ---- two routes, kept apart
const reset = (rows) => putText(answersFile(), JSON.stringify(rows));
const row = (n, via, c1, more = {}) => ({ n, form: `${via === "self" ? "R" : "T"}${n}`, via, site: via === "self" ? "" : "High Street", at: new Date().toISOString(), secs: 200, answers: { c1, c2: "Worse", a1: "45 to 54", a2: "Female" }, topics: {}, clean: {}, checked: {}, ...more });
const inter = Array.from({ length: 40 }, (_, i) => row(i + 1, "tablet", "Fairly satisfied"));
const selves = Array.from({ length: 40 }, (_, i) => row(i + 100, "self", "Very dissatisfied", { where: i % 4 === 3 ? "unknown" : "here" }));
const away = Array.from({ length: 35 }, (_, i) => row(i + 200, "self", "Very satisfied", { where: "elsewhere" }));
reset([...inter, ...selves, ...away]);
r = await api("/api/survey/get", { code: WSX, id }, lead);
const pct = (res, id2, label) => res.questions.find((q) => q.id === id2).options.find((o) => o.label === label).pct;
ok(r.results.used === 40 && pct(r.results, "c1", "Fairly satisfied") === 100, "the headline stays the interviewers' figure");
ok(r.self.results.used === 40 && pct(r.self.results, "c1", "Very dissatisfied") === 100 && !r.selfOnly, "with people's own replies beside it, and those from elsewhere left out of both");
ok(r.self.here === 30 && r.self.notSaid === 10 && r.self.elsewhere === 35, "and counted");
ok(r.results.total === 115 && r.results.bySource.self === 75 && r.results.bySource.tablet === 40, "every reply counts towards the totals by route");
const csv = (await api("/api/survey/export", { code: WSX, id }, lead)).csv.split("\n");
ok(csv[0].startsWith("form,site,entered_by,weight,lives,") && csv.some((x) => /^R100,,self,[\d.]+,here,/.test(x)) && csv.some((x) => /^R200,,self,1,elsewhere,/.test(x)) && csv.some((x) => /^T1,High Street,tablet,[\d.]+,,/.test(x)), "the export labels each reply by route");

reset([...selves, ...away]);
r = await api("/api/survey/get", { code: WSX, id }, lead);
ok(r.selfOnly && r.results.used === 40 && pct(r.results, "c1", "Very dissatisfied") === 100 && r.self.results === null, "with no interviewers, people's own replies become the headline, still without those from elsewhere");
const reader = await api("/api/authority", { code: WSX }, lead);
const summary = reader.evidence.streets.find((x) => x.id === id);
ok(summary.selfOnly && /chose to reply/.test(summary.note), "a survey like that is labelled for a reading");
ok(!/street survey/.test(reader.kinds?.join() ?? "") && t.kindsHeld({ surveys: [], streets: [{ current: true, selfOnly: true }], signals: { fixMyStreet: { ok: false }, petitions: { ok: false }, questions: { ok: false } } }).length === 0, "and isn't a kind of signal");
ok(t.kindsHeld({ surveys: [], streets: [{ current: true, selfOnly: false }], signals: { fixMyStreet: { ok: false }, petitions: { ok: false }, questions: { ok: false } } }).join() === "street survey", "which one with interviewers is");
reset([...inter, ...selves, ...away]);
ok(!(await api("/api/authority", { code: WSX }, lead)).evidence.streets.find((x) => x.id === id).selfOnly, "and a survey with interviewers reports their figure");
ok((await api("/api/authority", { code: WSX }, lead)).evidence.streets.find((x) => x.id === id).satisfied === 100, "unmoved by anyone else's replies");

// comments
const said = [...inter.slice(0, 2).map((x, i) => ({ ...x, answers: { ...x.answers, c3: `Interviewer comment ${i}` }, clean: { c3: true }, topics: { c3: "Potholes" } })), ...inter.slice(2),
  ...selves.slice(0, 3).map((x, i) => ({ ...x, answers: { ...x.answers, c3: `My own comment ${i}` }, clean: { c3: true }, topics: { c3: "Pavements" } })), ...selves.slice(3), { ...selves[3], n: 400, form: "R400", client: "w", answers: { ...selves[3].answers, c3: "Not cleaned yet, from Jane Smith" } }];
reset(said);
r = await api("/api/survey/get", { code: WSX, id }, member);
ok(r.topics[0].topic === "Potholes" && r.self.topics[0].topic === "Pavements" && r.comments.length === 2 && r.self.comments.length === 3, "comments are kept apart by route too");
ok(!JSON.stringify(r).includes("Jane Smith") && r.waiting === 1, "and a comment stays hidden until its names are out");
r = await api("/api/survey/get", { code: WSX, id }, boss);
ok(r.self.comments.length === 0 && r.self.topics.length === 1, "a site administrator from outside gets topic counts only");
reset([...inter, ...selves, ...away]);

// ---- the pages
const pageHtml = fs.readFileSync(new URL("../public/survey.html", import.meta.url), "utf8"), mainHtml = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const net = { down: false };
function browser(html, address, setup) {
  return new JSDOM(html, {
    url: `https://clarion.test${address}`, runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(w) {
      setup?.(w);
      w.scrollTo = () => {};
      w.URL.createObjectURL = (blob) => { w.saved = blob; return "blob:x"; };
      w.URL.revokeObjectURL = () => {};
      w.fetch = async (url, opts = {}) => {
        if (net.down) throw new TypeError("Failed to fetch");
        const res = await handleRequest(new Request(new URL(url, "https://clarion.test").href, { ...opts, headers: { ...(opts.headers || {}), "x-real-ip": `10.1.1.${++ip % 250}` } }));
        const text = await res.text();
        return { ok: res.ok, status: res.status, json: async () => JSON.parse(text) };
      };
    },
  }).window.document;
}
const text = (el) => el.textContent.replace(/\s+/g, " ");
const button = (d, words) => [...d.querySelectorAll("button")].find((b) => b.textContent.trim() === words);
const app = (d) => d.getElementById("app");
const shows = (d, pattern) => until(() => pattern.test(text(app(d))), `the page to show ${pattern}`);

let d = browser(pageHtml, `/r/${link}`);
await shows(d, /Roads survey/);
ok(/16 or over/.test(text(app(d))) && /first half of your postcode/.test(text(app(d))) && /Run by/.test(text(app(d))), "the reply page says what it's for first");
ok(!/waiting to send|All sent/.test(text(app(d))) && !/Where are you/.test(text(app(d))), "with nothing meant for interviewers");
button(d, "Start").click();
await shows(d, /Question 1 of/);
const total = (await api("/api/r/get", { access: link })).survey.questions.length;
for (let i = 0; i < total; i++) {
  await shows(d, new RegExp(`Question ${i + 1} of`));
  const choice = d.querySelector(".choice");
  if (choice) choice.click(); else button(d, "Next").click();
}
await shows(d, /first half of your postcode/);
ok(d.querySelector("input").getAttribute("maxlength") === "8", "the postcode comes last");
d.querySelector("input").value = "rh12 1ab";
d.querySelector("input").dispatchEvent(new d.defaultView.Event("input"));
net.down = true;
button(d, "Send my answers").click();
await shows(d, /haven't been sent yet/);
ok(/rh12|RH12/.test(d.defaultView.localStorage.getItem(`clarion_reply_${link}`)) && !/1AB/i.test(d.defaultView.localStorage.getItem(`clarion_reply_${link}`)), "with no connection the answers wait, with only the first half of the postcode");
net.down = false;
const lastBefore = JSON.parse(getText(answersFile())).length;
button(d, "Try again").click();
await shows(d, /Thank you/);
ok(JSON.parse(getText(answersFile())).length === lastBefore + 1 && JSON.parse(getText(answersFile())).at(-1).where === "here", "and send when it comes back");
ok(d.defaultView.localStorage.getItem(`clarion_reply_${link}`) === "null", "and then nothing is left on the device");
const storage = d.defaultView.localStorage.getItem(`clarion_done_${link}`);
d = browser(pageHtml, `/r/${link}`, (w) => { w.localStorage.setItem(`clarion_done_${link}`, storage); });
await shows(d, /already been sent from this device/);
ok(!button(d, "Start"), "the same device can't reply twice");

const waiting = { client: "waited", secs: 90, postcode: "", answers: { c1: "Fairly satisfied" } };
d = browser(pageHtml, `/r/${link}`, (w) => { w.localStorage.setItem(`clarion_reply_${link}`, JSON.stringify(waiting)); });
await shows(d, /Thank you/);
ok(JSON.parse(getText(answersFile())).some((x) => x.client === "waited"), "a reply left waiting goes when the page next opens");

d = browser(pageHtml, `/r/${link}`);
await shows(d, /Roads survey/);
button(d, "Start").click();
await shows(d, /Question 1 of/);
for (let i = 0; i < total; i++) { await shows(d, new RegExp(`Question ${i + 1} of`)); button(d, "Skip") ? button(d, "Skip").click() : button(d, "Next").click(); }
await shows(d, /first half of your postcode/);
button(d, "Skip").click();
await shows(d, /didn't answer any questions/);
ok(button(d, "Start"), "someone who skips everything sends nothing");

await api("/api/survey/self", { code: WSX, id, on: false }, lead);
d = browser(pageHtml, `/r/${link}`);
await shows(d, /This survey has closed/);
ok(!button(d, "Start"), "a closed link says so");
await api("/api/survey/self", { code: WSX, id, on: true }, lead);
await api("/api/briefing/election", { code: WSX, on: true }, lead);
d = browser(pageHtml, `/r/${link}`);
await shows(d, /This survey is paused/);
await api("/api/briefing/election", { code: WSX, on: false }, lead);
d = browser(pageHtml, "/r/AAAAAAAAAAAA");
await shows(d, /This link isn't working/);
d = browser(pageHtml, `/s/${access}`);
await shows(d, /Ready for the next person/);
ok(/Where are you/.test(text(app(d))) && /All sent|waiting to send/.test(text(app(d))), "interviewers' tablets carry on as before");

async function open(token, hash, path = "/") {
  const dom = browser(mainHtml, `${path}${hash}`, (w) => { w.localStorage.setItem("clarion_token", token); });
  await until(() => dom.querySelector(".main .page > *"), "the page to start");
  return dom;
}
const see = (dom, pattern) => until(() => pattern.test(text(dom.querySelector(".main"))), `the page to show ${pattern}`);
const fresh = (await api("/api/survey/new", { code: WSX, title: "Fresh survey", purpose: "x" }, lead)).survey;
await api("/api/survey/status", { code: WSX, id: fresh.id, status: "open" }, lead);
d = await open(lead, `#survey/${WSX}/${fresh.id}/collect`);
await see(d, /A link for people to fill in themselves/);
ok(button(d, "Turn on the link") && /Clarion never sees the list/.test(text(d.querySelector(".main"))), "the Collect page offers the link");
button(d, "Turn on the link").click();
await until(() => d.querySelector("svg.qr"), "the QR code");
const code = (await api("/api/survey/get", { code: WSX, id: fresh.id }, lead)).survey.self;
ok(text(d.querySelector(".main")).includes(`/r/${code}`) && d.querySelector("svg.qr path").getAttribute("d").length > 500, "turned on, it shows the link and a QR code");
ok([...d.querySelectorAll("textarea")].some((x) => x.value.includes(`/r/${code}`)), "and wording for an email, with the link in it");
ok(button(d, "Save the QR code"), "and the code can be saved");
d = await open(lead, `#survey/${WSX}/${id}/results`);
await see(d, /People who filled it in themselves/);
const results = text(d.querySelector(".main"));
ok(/Interviewers/.test(results) && /Filled in themselves/.test(results) && /may not be typical/.test(results) && /Say it's got worse/.test(results), "results sit side by side");
ok(/live elsewhere/.test(results) || /lives elsewhere/.test(results), "and say who's left out");
ok(!/null|undefined/.test(results), "with nothing broken on the page");
d = await open(lead, `#survey/${WSX}/${id}/collect`);
await see(d, /Filled in by people themselves\s*\d+/);
ok(Number(/Filled in by people themselves\s*(\d+)/.exec(text(d.querySelector(".main")))[1]) >= 75, "the Collect page counts them by route");
reset([...selves]);
d = await open(lead, `#survey/${WSX}/${id}/results`);
await see(d, /Everyone here chose to reply/);
ok(/weaker than a street sample/.test(text(d.querySelector(".main"))), "a survey with no interviewers says so at the top");
ok(!/Interviewers/.test([...d.querySelectorAll("thead")].map(text).join()), "and has nothing to set beside it");
await see(d, /Postcode area|didn't say/);
ok(!d.querySelector(".main").textContent.includes("RH12 1"), "and no whole postcode");
await new Promise((done) => setTimeout(done, 50));
ok(claude.calls.length === 0, "none of this calls Claude");
const tallied = JSON.parse(getText(areaFile()));
for (let i = 0; i < 12; i++) await api("/api/r/submit", { ...reply(`crowd-rh-${i}`, "RH12"), answers: { c1: "Fairly satisfied" } });
d = await open(lead, `#survey/${WSX}/${id}/results`);
await see(d, /RH12/);
ok(/Other areas, each under 10/.test(text(d.querySelector(".main"))) && !/\bM1\b/.test(text(d.querySelector(".main"))) && tallied.M1 === 1, "small areas are pooled on the page");

// the demonstration
const pack = t.buildPack();
const demoPage = Object.values(pack.surveys).find((x) => x.results.total > 0);
ok(demoPage.self.results.used > 30 && demoPage.results.used === 412 && demoPage.survey.selfOn, "the demonstration has replies from a link, run through the same sums");
d = await open("", `#survey/NORTHBRIDGE/${demoPage.survey.id}/collect`, "/demo");
await see(d, /A link for people to fill in themselves/);
await until(() => d.querySelector("svg.qr"), "the demonstration's QR code");
ok(/no real link/.test(text(d.querySelector(".main"))) && !/https?:/.test(JSON.stringify(pack.qr)), "with no real link");

console.log(failures ? `\n${failures} failed` : "\nAll passed");
process.exit(failures ? 1 : 0);
