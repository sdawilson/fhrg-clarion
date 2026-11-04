// Hosted survey pages: people filling a survey in themselves from a link, the postcode check, and keeping their replies
// apart from interviewers', through the API and on the pages.
import fs from "node:fs";
import { createHash } from "node:crypto";
import { JSDOM } from "jsdom";
import { addUser, claude, files, getText, newsTopics, postcodesDown, putText, until } from "./sim.mjs";
const { handleRequest, setSurveyPage } = await import("./.build/app.mjs");
const t = await import("./.build/internals.mjs");

let failures = 0;
const ok = (cond, what) => { console.log(`${cond ? "PASS" : "FAIL"}  ${what}`); if (!cond) failures++; };
const WSX = "E10000032", KIRK = "E08000034";
const pageHtml = fs.readFileSync(new URL("../public/survey.html", import.meta.url), "utf8"), mainHtml = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const net = { down: false };

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
const fingerprint = (text) => createHash("sha256").update(t.qrCode(text).join("\n")).digest("hex").slice(0, 16);
ok(fingerprint("https://clarion.fhrg.co.uk/r/ABCDEFGHJKMN") === "db2ad8cde4a24479", "and comes out as a real decoder read it");
for (const [letter, length, size, print] of [["a", 10, 1, "72b02bb951d86eea"], ["b", 20, 2, "bedffd0c294095b9"], ["c", 60, 4, "159caa4cf09d92ca"], ["d", 90, 6, "2631e75034562723"], ["e", 130, 8, "d10d8fcfc1691daf"], ["f", 200, 10, "9f65c13b969907d5"], ["g", 70, 5, "392eaa98aab9d06b"], ["h", 110, 7, "f322077ad20e83aa"], ["i", 170, 9, "91459680a46fb885"]]) ok(fingerprint(letter.repeat(length)) === print && t.qrCode(letter.repeat(length)).length === size * 4 + 17, `at size ${size} too`);
let tooLong = false;
try { t.qrCode("x".repeat(300)); } catch { tooLong = true; }
ok(tooLong, "and anything too long for one is refused");
ok(t.scrubComment("It's by RH12 1AB, near the A27") === "It's by [removed], near the A27" && t.scrubComment("rh121ab") === "[removed]" && t.scrubComment("EC1A 1BB") === "[removed]", "a whole postcode is taken out of a comment by code");
ok(["the A27 5pm closure", "M25 3pm", "the A3 2nd junction", "M1 2am", "A1 3rd exit", "B2100 1st bend"].every((x) => t.scrubComment(x) === x), "without taking roads and times with it");
ok(t.scrubContacts("the A27 RH12 1AB") === "the A27 RH12 1AB", "and an officer's own words are left as they were");
const lane = (ip) => t.networkOf(new Request("https://x.test", { headers: { "x-real-ip": ip } }));
ok(lane("2001:db8:1:2::1") === lane("2001:0db8:0001:0002:aaaa:bbbb:cccc:dddd") && lane("2001:db8:1:3::1") !== lane("2001:db8:1:2::1"), "a block of new-style addresses counts as one");
const a = (satisfied, selfOnly = false) => ({ satisfied, worse: null, current: true, selfOnly });
ok(t.benchmarkFrom([[a(0, true), a(30)], [a(40)], [a(50)], [a(60)], [a(70)]]).satisfied === 50, "the FHRG middle figure skips a newer survey with no interviewers");
ok(t.benchmarkFrom([[a(0, true)], [a(40)], [a(50)], [a(60)], [a(70)]]) === null, "and doesn't count such an authority at all");
ok(lane("::ffff:10.1.2.3") === "10.1.2.3" && lane("10.1.2.3") === "10.1.2.3" && lane("2001:db8::1") === "2001:db8:0:0", "and old-style addresses stay as they are");

// ---- through the API
await addUser(1, "lead@westsussex.gov.uk", "Lee Lead", 30, "lead");
await addUser(2, "member@westsussex.gov.uk", "Mo Member", 30, "member");
await addUser(3, "kit@kirklees.gov.uk", "Kit Officer", 20, "lead");
await addUser(4, "boss@fhrg.test", "Bo Boss", 99, "member", 1);
let ip = 0;
const api = async (path, body, token, address) => { const res = await handleRequest(new Request(`https://clarion.test${path}`, { method: "POST", headers: { "content-type": "application/json", "x-real-ip": address ?? `10.0.0.${++ip % 250}`, ...(token ? { "x-session-token": token } : {}) }, body: JSON.stringify(body) })); return Object.assign(await res.json(), { status: res.status }); };
const login = async (email) => (await api("/api/login", { email, password: "pw" })).token;
const raw = async (path, body, headers) => (await handleRequest(new Request(`https://clarion.test${path}`, { method: "POST", headers, body }))).status;
const lead = await login("lead@westsussex.gov.uk"), member = await login("member@westsussex.gov.uk"), kit = await login("kit@kirklees.gov.uk"), boss = await login("boss@fhrg.test");

newsTopics.push("Parking", "Pavements");
const paper = (await api("/api/coverage/source", { code: WSX, name: "A paper", type: "Local Newspaper", reach: 5000 }, lead)).source;
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
await Promise.all([1, 2, 3, 4, 5].map((i) => api("/api/r/submit", reply(`together-${i}`, "HD1 1AA"))));
ok(postcodesDown.asked.filter((x) => x.endsWith("/HD1")).length === 1, "even when replies arrive together");
await api("/api/r/submit", reply("nowhere-1", "ZZ99 9ZZ"));
await api("/api/r/submit", reply("nowhere-2", "ZZ99 9ZZ"));
ok(postcodesDown.asked.filter((x) => x.endsWith("/ZZ99")).length === 1, "an area that doesn't exist isn't asked about again");
const clock = Date.now;
Date.now = () => clock() + 25 * 3600 * 1000;
await api("/api/r/submit", reply("nowhere-3", "ZZ99 9ZZ"));
Date.now = clock;
ok(postcodesDown.asked.filter((x) => x.endsWith("/ZZ99")).length === 2, "at least for a day, in case that was only a fault");
const near = JSON.parse(getText(answersFile()));
near.splice(2);
putText(answersFile(), JSON.stringify(near));
await api("/api/r/submit", reply("c", "M1 1AE", { c3: "Jane Smith at 4 Acacia Avenue" }));
ok(!getText(areaFile()).includes("M1"), "an area outside the authority is never named");
ok(!getText(answersFile()).includes("Acacia") && JSON.parse(getText(answersFile())).at(-1).answers.c1, "and a comment from outside isn't kept, as nobody would check it for names");
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
ok(r.status === 400 && !JSON.parse(getText(answersFile())).some((x) => x.client === "h"), "an empty reply is refused");
ok((await api("/api/r/submit", { ...reply("", "") })).status === 400 && (await api("/api/r/submit", { access: link, answers: { c1: "Fairly satisfied" } })).status === 400 && (await api("/api/r/submit", reply("\u0001", ""))).status === 400, "and so is one with no id, which couldn't safely be sent again");
for (let i = 0; i < 25; i++) r = await api("/api/r/submit", { ...reply(`junk-${i}`, ""), answers: { nonsense: "x" } }, undefined, "10.5.5.5");
ok(r.status === 400 && (await api("/api/r/submit", reply("after-junk", ""), undefined, "10.5.5.5")).ok, "requests with nothing real in them don't use up the limits");
ok(await raw("/api/r/get", JSON.stringify({ access: link }), { "content-type": "application/json; charset=utf-8" }) === 200, "and a real page's request gets through");
const body = JSON.stringify(reply("cross", ""));
ok(await raw("/api/r/submit", body, { "content-type": "text/plain" }) === 403 && await raw("/api/r/submit", body, { "content-type": "application/json", "sec-fetch-site": "cross-site" }) === 403 && await raw("/api/s/submit", JSON.stringify({ access, forms: [] }), { "content-type": "text/plain" }) === 403, "another website can't send replies from its visitors' browsers");
ok(!JSON.parse(getText(answersFile())).some((x) => x.client === "cross"), "and nothing arrives");

for (let i = 0; i < 20; i++) r = await api("/api/r/submit", reply(`same-${i}`, ""), undefined, "10.9.9.9");
const limited = await api("/api/r/submit", reply("same-x", ""), undefined, "10.9.9.9");
ok(r.ok && limited.status === 429, "one address can't send more than 20 in ten minutes");
ok((await api("/api/r/submit", reply("other", ""), undefined, "10.9.9.8")).ok, "others carry on");
let sixFour;
for (let i = 0; i < 21; i++) sixFour = await api("/api/r/submit", reply(`v6-${i}`, ""), undefined, `2001:db8:5:6:${i + 1}::1`);
ok(sixFour.status === 429, "and hopping around one block of new addresses doesn't get round it");
let wide;
for (let i = 0; i < 201; i++) wide = await api("/api/r/submit", reply(`v48-${i}`, ""), undefined, `2001:db8:7:${(i + 1).toString(16)}::1`);
ok(wide.status === 429, "nor does hopping around a bigger block");
for (let i = 0; i < 31; i++) r = await api("/api/r/get", { access: "AAAAAAAAAAAA" }, undefined, "10.8.8.8");
ok(r.status === 429 && (await api("/api/s/get", { access }, undefined, "10.8.8.8")).survey, "guessing at links stops, without locking out an interviewer at the same address");
const busy = (await api("/api/survey/new", { code: WSX, title: "Busy", purpose: "x" }, lead)).survey;
await api("/api/survey/status", { code: WSX, id: busy.id, status: "open" }, lead);
const busyLink = (await api("/api/survey/self", { code: WSX, id: busy.id, on: true }, lead)).survey.self;
let all, taken = 0;
for (let i = 0; all?.status !== 429 && i < 700; i++) { all = await api("/api/r/submit", { ...reply(`burst-${i}`, ""), access: busyLink }, undefined, `10.${50 + Math.floor(i / 20)}.0.1`); if (all.ok) taken++; }
ok(all.status === 429 && taken === 600, "no link takes more than 600 in ten minutes");
ok((await api("/api/r/submit", { access: busyLink, client: "x", answers: {} }, undefined, "10.7.7.7")).status === 400 && (await api("/api/r/get", { access: busyLink }, undefined, "10.7.7.7")).survey, "while reading the questions still works");
ok((await api("/api/r/submit", reply("elsewhere-link", ""), undefined, "10.7.7.6")).ok, "and other surveys' links carry on");

// the cap, so a link can't crowd out interviewers
const beforeCap = getText(answersFile()), full = JSON.parse(beforeCap).slice(0, 8);
const crowd = (n, more = {}) => Array.from({ length: n }, (_, i) => ({ ...full[0], n: 9000 + i, form: `R${9000 + i}`, client: `crowd-${i}`, ...more }));
const fresh3 = () => api("/api/r/submit", reply("cap-d", ""), undefined, "172.16.0.1");
const fresh2 = async (rows, words) => { putText(answersFile(), JSON.stringify(rows)); return await api("/api/r/submit", reply(`cap-${words}`, ""), undefined, `10.60.${++ip % 250}.1`); };
r = await fresh2(crowd(3000), "a");
ok(r.status === 409 && /all the replies/.test(r.error), "replies by link stop at 3,000");
ok((await api("/api/s/submit", { access, forms: [{ client: "t1", site: "High Street", answers: { c1: "Fairly satisfied" } }] })).added === 1, "and interviewers' forms still go in");
const big = Array.from({ length: 4990 }, (_, i) => ({ ...full[0], via: "tablet", n: 1 + i, form: `T${1 + i}`, client: `t-${i}`, site: "High Street" }));
putText(answersFile(), JSON.stringify([...big, ...crowd(3000)]));
ok((await api("/api/s/submit", { access, forms: [{ client: "t2", site: "High Street", answers: { c1: "Fairly satisfied" } }] })).added === 1, "a large survey keeps all of its own 5,000, however many came by link");
r = await fresh2(crowd(3000, { excluded: true }), "b");
ok(r.ok, "a flood that's been left out stops counting");
r = await fresh2(crowd(4000, { excluded: true, dayLeft: true, at: "2026-03-10T10:00:00.000Z" }), "c");
ok(r.status === 409, "though there's a limit on how much is held");
await api("/api/survey/selfday", { code: WSX, id, day: "2026-03-10", action: "delete" }, lead);
ok(JSON.parse(getText(answersFile())).length === 0 && (await fresh3()).ok, "and deleting it for good makes room again");
putText(answersFile(), beforeCap);

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
ok(summary.selfOnly && /chose to reply/.test(summary.note) && summary.satisfied === 0 && summary.responses === 40, "a survey like that is labelled for a reading, without replies from elsewhere");
ok(reader.evidence.gaps.includes("A street survey in this authority"), "and it leaves the gap for a street survey open");
ok(t.kindsHeld({ surveys: [], streets: [{ current: true, selfOnly: true }], signals: { fixMyStreet: { ok: false }, petitions: { ok: false }, questions: { ok: false } } }).length === 0, "it isn't a kind of signal");
ok(t.kindsHeld({ surveys: [], streets: [{ current: true, selfOnly: false }], signals: { fixMyStreet: { ok: false }, petitions: { ok: false }, questions: { ok: false } } }).join() === "street survey", "which one with interviewers is");
ok(t.interviewedOnly([{ id: 1, selfOnly: true }, { id: 2, selfOnly: false }]).map((x) => x.id).join() === "2", "the FHRG middle figure and the rest take only surveys with interviewers");
let admin = await api("/api/admin/overview", {}, boss);
let wsxRow = admin.authorities.find((x) => x.code === WSX);
ok(wsxRow.street === null && wsxRow.reported === 0 && wsxRow.replies === 0 && admin.totals.middle === null && admin.totals.withSurvey === 0, "the all-authorities view doesn't show it as a street survey");
putText(answersFile(), JSON.stringify([...selves.map((x) => ({ ...x, answers: { ...x.answers, c3: "Comment" }, clean: { c3: true }, topics: { c3: "Pavements" } })), ...away]));
admin = await api("/api/admin/overview", {}, boss);
ok(!admin.topics.some((x) => x.topic === "Pavements"), "and its topics stay out of the map");
ok(/street survey or enquiries/.test((await (async () => { for (const [topic, n] of [["Potholes", 3], ["Road safety", 2], ["Parking", 1]]) for (let i = 0; i < n; i++) await api("/api/coverage/assess", { code: WSX, source: paper.id, date: new Date(Date.now() - (2 + i) * 86400000).toISOString().slice(0, 10), summary: "words", topic, relevance: "High", tone: "Critical", prominence: "Inside page" }, lead); return await api("/api/attention", { code: WSX }, lead); })()).needs), "and it can't stand for concern in attention and concern");
reset([...selves, ...away]);

// what a reading and a briefing are told
claude.script.submit_briefing = (body) => ({ id: "m", type: "message", role: "assistant", model: "x", stop_reason: "tool_use", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: "tool_use", id: "t1", name: "submit_briefing", input: { summary: "A summary.", how_residents_feel: "F", why_it_matters_here: "M", likely_questions: [], factual_lines: [] } }] });
const callsBefore = claude.calls.length;
const drafted = (await api("/api/briefing/start", { code: WSX }, lead)).briefing;
await until(async () => (await api("/api/briefing/get", { code: WSX, id: drafted.id }, lead)).briefing.status !== "working", "the briefing");
const briefingDraft = (await api("/api/briefing/get", { code: WSX, id: drafted.id }, lead)).briefing;
ok(/"surveys_people_chose_to_answer":\[\{/.test(claude.calls[callsBefore].prompt) && /"street_surveys":\[\]/.test(claude.calls[callsBefore].prompt) && /never call it a street survey/.test(claude.calls[callsBefore].sys), "a briefing is told it's a survey people chose to answer, not a street survey");
ok(briefingDraft.sources.some((x) => /people who chose to reply \(indicative\)/.test(x)) && !briefingDraft.sources.some((x) => x.startsWith("Street survey")), "and its sources say so");
const issued = (await api("/api/briefing/approve", { code: WSX, id: drafted.id, updated: briefingDraft.updated, hidden: false, title: briefingDraft.title, summary: "A summary.", feel: "F", matters: "M", questions: [], lines: [] }, lead)).briefing;
const word = Buffer.from((await api("/api/briefing/word", { code: WSX, id: issued.id }, lead)).file, "base64").toString();
ok(word.includes("may not be typical") && !word.includes("a street sample"), "and so does the Word copy");
const readingCalls = claude.calls.length;
await api("/api/reading/start", { code: WSX }, lead);
await until(() => claude.calls.length > readingCalls, "a reading");
const readingPrompt = claude.calls.at(-1).prompt;
ok(!/chose_to_answer|chose to reply/.test(readingPrompt) && !/street_surveys/.test(readingPrompt) && /"survey_results"/.test(readingPrompt), "a mood reading isn't given it at all");
const second = (await api("/api/survey/new", { code: WSX, title: "Interviewers' survey", purpose: "x" }, lead)).survey;
await api("/api/survey/status", { code: WSX, id: second.id, status: "open" }, lead);
const secondFile = answersFile().replace(id, second.id);
putText(secondFile, JSON.stringify(inter.slice(0, 35)));
const callsMixed = claude.calls.length;
const both = (await api("/api/briefing/start", { code: WSX }, lead)).briefing;
await until(async () => (await api("/api/briefing/get", { code: WSX, id: both.id }, lead)).briefing.status !== "working", "the second briefing");
const material = JSON.parse(/<evidence>\n([\s\S]*)\n<\/evidence>/.exec(claude.calls[callsMixed].prompt)[1]).position;
ok(material.street_surveys.length === 1 && material.street_surveys[0].responses === 35 && material.surveys_people_chose_to_answer.some((x) => x.responses === 40) && !material.surveys_people_chose_to_answer.some((x) => x.responses === 35), "with both kinds held, a briefing is told which is which");
const bothDraft = (await api("/api/briefing/get", { code: WSX, id: both.id }, lead)).briefing;
const bothOut = (await api("/api/briefing/approve", { code: WSX, id: both.id, updated: bothDraft.updated, hidden: false, title: bothDraft.title, summary: "A summary.", feel: "F", matters: "M", questions: [], lines: [] }, lead)).briefing;
const bothWord = Buffer.from((await api("/api/briefing/word", { code: WSX, id: bothOut.id }, lead)).file, "base64").toString();
ok(bothWord.includes("may not be typical") && bothWord.includes("a street sample isn"), "and a Word copy carries both warnings");
putText(secondFile, "[]");
reset([...inter, ...selves, ...away]);
ok(!(await api("/api/authority", { code: WSX }, lead)).evidence.streets.find((x) => x.id === id).selfOnly, "and a survey with interviewers reports their figure");
ok((await api("/api/authority", { code: WSX }, lead)).evidence.streets.find((x) => x.id === id).satisfied === 100, "unmoved by anyone else's replies");

// comments
const list = (await api("/api/survey/list", { code: WSX }, lead)).surveys.find((x) => x.id === id);
ok(list.responses === 40 && list.byLink === 75, "the list of surveys counts interviewers against the aim, and link replies apart");
const AGES = ["25 to 34", "45 to 54", "65 to 74"];
const varied = inter.map((x, i) => ({ ...x, answers: { ...x.answers, a1: AGES[i % 3], a2: i % 2 ? "Male" : "Female" } }));
reset([...varied, ...selves]);
const alone = (await api("/api/survey/export", { code: WSX, id }, lead)).csv;
reset(varied);
const interOnly = (await api("/api/survey/export", { code: WSX, id }, lead)).csv;
const weightOf = (text, form) => text.split("\n").find((x) => x.startsWith(`${form},`)).split(",")[3];
ok(weightOf(interOnly, "T1") !== "1" && varied.every((x) => weightOf(alone, x.form) === weightOf(interOnly, x.form)), "interviewers' weights don't move when people's own replies arrive");
reset([...inter, ...selves, ...away]);
const twins = Array.from({ length: 6 }, (_, i) => row(i + 500, "tablet", "Fairly satisfied"));
const mixed = twins.flatMap((x, i) => [x, row(i + 600, "self", i % 2 ? "Very satisfied" : "Fairly dissatisfied", { where: "here" })]);
reset(mixed);
ok((await api("/api/survey/get", { code: WSX, id }, lead)).problems.filter((x) => /same answers/.test(x.why)).length === 4, "a run of matching forms is still found, with replies by link in between");
reset([...inter, ...selves, ...away]);
const said = [...inter.slice(0, 2).map((x, i) => ({ ...x, answers: { ...x.answers, c3: `Interviewer comment ${i}` }, clean: { c3: true }, topics: { c3: "Potholes" } })), ...inter.slice(2),
  ...selves.slice(0, 3).map((x, i) => ({ ...x, answers: { ...x.answers, c3: `My own comment ${i}` }, clean: { c3: true }, topics: { c3: "Pavements" } })), ...selves.slice(3), { ...selves[3], n: 400, form: "R400", client: "w", answers: { ...selves[3].answers, c3: "Not cleaned yet, from Jane Smith" } }];
reset(said);
r = await api("/api/survey/get", { code: WSX, id }, member);
ok(r.topics[0].topic === "Potholes" && r.self.topics[0].topic === "Pavements" && r.comments.length === 2 && r.self.comments.length === 3, "comments are kept apart by route too");
ok(!JSON.stringify(r).includes("Jane Smith") && r.waiting === 1, "and a comment stays hidden until its names are out");
r = await api("/api/survey/get", { code: WSX, id }, boss);
ok(r.self.comments.length === 0 && r.self.topics.length === 1, "a site administrator from outside gets topic counts only");

// sorting comments
reset(said);
claude.script.submit_comments = (body) => { const items = JSON.parse(/<comments>\n([\s\S]*)\n<\/comments>/.exec(body.messages[0].content)[1]); return { id: "m", type: "message", role: "assistant", model: "x", stop_reason: "tool_use", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: "tool_use", id: "t1", name: "submit_comments", input: { comments: items.map((x) => ({ ref: x.ref, text: "Sorted, at RH12 1AB", topic: "Other" })) } }] }; };
let job = (await api("/api/survey/sort", { code: WSX, id }, lead)).job;
await until(async () => { const held2 = JSON.parse(getText(answersFile())); return held2.find((x) => x.form === "R400")?.clean?.c3; }, "the comments to be sorted");
held = JSON.parse(getText(answersFile()));
ok(held.find((x) => x.form === "R400").answers.c3 === "Sorted, at [removed]", "a comment is sorted, and any postcode that comes back from Claude is taken out");
const pile = Array.from({ length: 1100 }, (_, i) => ({ ...row(1000 + i, "self", "Very dissatisfied", { where: "here" }), answers: { c1: "Very dissatisfied", c3: `Comment number ${i}` } }));
reset([...pile, { ...inter[0], answers: { ...inter[0].answers, c3: "An interviewer's comment" } }]);
await until(async () => { job = (await api("/api/survey/sort", { code: WSX, id }, lead)).job; return job && job.total !== undefined; }, "the sort to start");
ok(job.total === 1000, "one run sorts up to 1,000, so one click can't use up the month's budget");
await until(async () => JSON.parse(getText(answersFile())).filter((x) => x.clean?.c3).length >= 1000, "that run");
ok(JSON.parse(getText(answersFile())).find((x) => x.form === "T1").clean?.c3, "with interviewers' comments first");
reset([...inter, ...selves, ...away]);

// leaving out a flood
const dayNow = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const older = selves.slice(0, 5).map((x) => ({ ...x, at: "2026-01-02T10:00:00.000Z" })), handLeft = { ...selves[5], excluded: true };
reset([...inter, ...older, handLeft, ...selves.slice(6)]);
ok((await api("/api/survey/selfday", { code: WSX, id, day: dayNow, action: "leave" }, member)).status === 403 && (await api("/api/survey/selfday", { code: WSX, id, day: "nonsense", action: "leave" }, lead)).status === 400 && (await api("/api/survey/selfday", { code: WSX, id, day: dayNow, action: "wipe" }, lead)).status === 400, "only a lead can act on a day's replies");
await api("/api/survey/selfday", { code: WSX, id, day: dayNow, action: "leave" }, lead);
r = await api("/api/survey/get", { code: WSX, id }, lead);
ok(r.self.results.used === 5 && r.self.left === 35 && r.results.used === 40 && r.selfDays.find((x) => x.day === dayNow).left === 35, "leaving out a day leaves out every reply by link that day, and no one else's");
ok(r.excluded.length === 1 && r.excluded[0].form === handLeft.form, "and a form left out by hand keeps its own Put back button");
await api("/api/survey/selfday", { code: WSX, id, day: dayNow, action: "back" }, lead);
r = await api("/api/survey/get", { code: WSX, id }, lead);
ok(r.self.left === 1 && r.excluded[0].form === handLeft.form, "putting the day back leaves that one out");
ok(!(await api("/api/survey/get", { code: WSX, id }, member)).selfDays.length, "a member isn't shown any of this");
const numberGone = { ...selves[6], excluded: true, dayLeft: true };
reset([...inter, { ...selves[7], form: numberGone.form, n: 700, via: "paper" }, numberGone]);
await api("/api/survey/selfday", { code: WSX, id, day: dayNow, action: "back" }, lead);
ok(JSON.parse(getText(answersFile())).find((x) => x.n === numberGone.n).excluded === true, "a form whose number has been taken since stays left out");
reset([{ ...selves[0], at: "2026-06-14T23:30:00.000Z" }]);
r = await api("/api/survey/get", { code: WSX, id }, lead);
ok(r.selfDays[0].day === "2026-06-15", "days are British ones, so half past midnight falls in the right day");
reset(selves.slice(0, 3));
await api("/api/survey/selfday", { code: WSX, id, day: dayNow, action: "leave" }, lead);
r = await api("/api/survey/get", { code: WSX, id }, lead);
ok(r.self?.left === 3, "if every reply by link is left out, the page still says so");
reset(Array.from({ length: 12 }, (_, i) => ({ ...selves[i], answers: { ...selves[i].answers, c3: `Comment ${i}` }, clean: { c3: true }, topics: { c3: "Road safety" } })));
r = await api("/api/survey/get", { code: WSX, id }, lead);
ok(r.sample.length > 0 && r.sample.every((x) => x.form.startsWith("R")), "the sample to check takes in comments from the link");
const sampled = await (async () => { const dom = browser(mainHtml, `/#survey/${WSX}/${id}/check`, (w) => { w.localStorage.setItem("clarion_token", lead); }); await until(() => dom.querySelector('.main select[aria-label="Topic"]'), "the sample"); return dom.querySelector('.main select[aria-label="Topic"]').value; })();
ok(sampled === "Road safety", "and shows each comment's real topic");
reset([...inter, ...selves, ...away]);

// a change to the link doesn't make an old survey count as current again
const oldest = JSON.parse(getText(files(`clarion/authorities/${WSX}/surveys/`).find((f) => f.includes(id))));
const stamp = oldest.updated;
await api("/api/survey/self", { code: WSX, id, on: true }, lead);
ok(JSON.parse(getText(files(`clarion/authorities/${WSX}/surveys/`).find((f) => f.includes(id)))).updated === stamp, "turning the link on or off doesn't make a survey count as recent again");

// ---- the pages
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
        if (w.noQr && String(url).includes("/api/survey/qr")) return { ok: false, status: 500, json: async () => ({ error: "The QR code couldn't be made." }) };
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
ok(/RH12/.test(d.defaultView.sessionStorage.getItem(`clarion_reply_${link}`)) && !/1AB/i.test(d.defaultView.sessionStorage.getItem(`clarion_reply_${link}`)), "with no connection the answers wait in that tab, with only the first half of the postcode");
ok(!Object.keys(d.defaultView.localStorage).some((k) => k.includes("reply")), "and aren't kept beyond it");
net.down = false;
const lastBefore = JSON.parse(getText(answersFile())).length;
button(d, "Try again").click();
await shows(d, /Thank you/);
ok(JSON.parse(getText(answersFile())).length === lastBefore + 1 && JSON.parse(getText(answersFile())).at(-1).where === "here", "and send when it comes back");
ok(d.defaultView.sessionStorage.getItem(`clarion_reply_${link}`) === null && Object.keys(d.defaultView.localStorage).filter((k) => k.includes(link)).join() === `clarion_done_${link}`, "and then nothing of it is left on the device, only a mark that it replied");
const storage = d.defaultView.localStorage.getItem(`clarion_done_${link}`);
d = browser(pageHtml, `/r/${link}`, (w) => { w.localStorage.setItem(`clarion_done_${link}`, storage); });
await shows(d, /already been sent from this device/);
ok(!button(d, "Start"), "the same device can't reply twice");

const waiting = { client: "waited", secs: 90, postcode: "", answers: { c1: "Fairly satisfied", c3: "PRIVATE-WORDS of the last person" } };
const leftBehind = (w, reply = waiting) => { w.sessionStorage.setItem(`clarion_reply_${link}`, JSON.stringify(reply)); };
d = browser(pageHtml, `/r/${link}`, leftBehind);
await shows(d, /An unsent reply is on this device/);
ok(!JSON.parse(getText(answersFile())).some((x) => x.client === "waited") && !text(app(d)).includes("PRIVATE-WORDS"), "a reply left on a shared device isn't sent or shown without asking");
button(d, "Delete it").click();
await shows(d, /Roads survey/);
ok(button(d, "Start") && d.defaultView.sessionStorage.getItem(`clarion_reply_${link}`) === null && !JSON.parse(getText(answersFile())).some((x) => x.client === "waited"), "it can be deleted, and the next person can start");
d = browser(pageHtml, `/r/${link}`, leftBehind);
await shows(d, /An unsent reply is on this device/);
button(d, "Send it").click();
await shows(d, /Thank you/);
ok(JSON.parse(getText(answersFile())).some((x) => x.client === "waited"), "or sent, by someone who says it's theirs");

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
d = browser(pageHtml, `/r/${link}`, leftBehind);
await shows(d, /This survey has closed/);
ok(!button(d, "Start") && d.defaultView.sessionStorage.getItem(`clarion_reply_${link}`) === null && /removed from this device/.test(text(app(d))), "a closed link says so, and clears anything left waiting");
await api("/api/survey/self", { code: WSX, id, on: true }, lead);
d = browser(pageHtml, `/r/${link}`);
await shows(d, /Roads survey/);
button(d, "Start").click();
await shows(d, /Question 1 of/);
d.querySelector(".choice").click();
for (let i = 1; i < total; i++) { await shows(d, new RegExp(`Question ${i + 1} of`)); (button(d, "Skip") ?? button(d, "Next")).click(); }
await shows(d, /first half of your postcode/);
await api("/api/survey/self", { code: WSX, id, on: false }, lead);
button(d, "Send my answers").click();
await shows(d, /removed from this device/);
ok(d.defaultView.sessionStorage.getItem(`clarion_reply_${link}`) === null && /This survey has closed/.test(text(app(d))), "if it closes while someone's filling it in, they're told, and nothing stays behind");
await api("/api/survey/self", { code: WSX, id, on: true }, lead);
await api("/api/briefing/election", { code: WSX, on: true }, lead);
d = browser(pageHtml, `/r/${link}`);
await shows(d, /This survey is paused/);
await api("/api/briefing/election", { code: WSX, on: false }, lead);
d = browser(pageHtml, "/r/ZZZZZZZZZZZZ", (w) => { w.sessionStorage.setItem("clarion_reply_ZZZZZZZZZZZZ", JSON.stringify(waiting)); });
await shows(d, /This link isn't working/);
ok(d.defaultView.sessionStorage.getItem("clarion_reply_ZZZZZZZZZZZZ") === null, "a dead link clears anything left waiting");
d = browser(pageHtml, `/R/${link}`);
await shows(d, /Roads survey/);
ok(button(d, "Start") && !/Where are you/.test(text(app(d))), "a capital letter in the address makes no difference");
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
d.defaultView.HTMLCanvasElement.prototype.getContext = () => ({ fillRect: () => {} });
d.defaultView.HTMLCanvasElement.prototype.toBlob = function (done) { done(new d.defaultView.Blob(["png"], { type: "image/png" })); };
button(d, "Save the QR code").click();
await until(() => d.defaultView.saved, "the picture");
ok(d.defaultView.saved.type === "image/png", "and the code can be saved as a picture");
d = await open(lead, `#survey/${WSX}/${id}/results`);
await see(d, /People who filled it in themselves/);
const results = text(d.querySelector(".main"));
ok(/Interviewers/.test(results) && /Filled in themselves/.test(results) && /may not be typical/.test(results) && /Say it's got worse/.test(results), "results sit side by side");
ok(/live elsewhere/.test(results) || /lives elsewhere/.test(results), "and say who's left out");
ok(!/null|undefined/.test(results), "with nothing broken on the page");
d = await open(lead, `#survey/${WSX}/${id}/check`);
await see(d, /Replies by link, day by day/);
ok(button(d, "Leave out this day"), "the Check tab lists replies by link by day");
button(d, "Leave out this day").click();
await until(() => button(d, "Delete for good"), "the day to be left out");
button(d, "Delete for good").click();
ok(button(d, "Sure? This can't be undone"), "deleting for good asks first");
d = await open(lead, `#survey/${WSX}/${id}/results`);
await see(d, /left out on the Check tab/);
d = await open(lead, `#survey/${WSX}/${id}/check`);
await see(d, /Put this day back/);
button(d, "Put this day back").click();
await until(async () => (await api("/api/survey/get", { code: WSX, id }, lead)).self.left === 0, "the day to come back");
d = await open(lead, `#survey/${WSX}/${id}/collect`);
await see(d, /Filled in by people themselves\s*\d+/);
ok(Number(/Filled in by people themselves\s*(\d+)/.exec(text(d.querySelector(".main")))[1]) >= 75, "the Collect page counts them by route");
reset([...selves]);
d = await open(lead, `#survey/${WSX}/${id}/results`);
await see(d, /Everyone here chose to reply/);
ok(/weaker than a street sample/.test(text(d.querySelector(".main"))), "a survey with no interviewers says so at the top");
ok(!/Interviewers/.test([...d.querySelectorAll("thead")].map(text).join()), "and has nothing to set beside it");
d = await open(lead, `#a/${WSX}`);
await see(d, /how people feel about their roads/);
await new Promise((done) => setTimeout(done, 50));
ok(!/Street survey, \d+ replies/.test(text(d.querySelector(".main"))) && !/\d+ street survey replies/.test(text(d.querySelector(".main"))), "the Summary page doesn't call it a street survey");
d = await open(lead, `#evidence/${WSX}`);
await see(d, /People who chose to reply, with no interviewers/);
await api("/api/r/submit", { ...reply("one-bn", "BN11 1AA"), answers: { c1: "Fairly satisfied" } });
for (let i = 0; i < 12; i++) await api("/api/r/submit", { ...reply(`crowd-rh-${i}`, "RH12"), answers: { c1: "Fairly satisfied" } });
ok(Object.keys(JSON.parse(getText(areaFile()))).join() === "BN11,RH12", "the areas are held in no order that follows the replies");
d = await open(lead, `#survey/${WSX}/${id}/results`);
await see(d, /RH12/);
ok(/Other areas, each under 10/.test(text(d.querySelector(".main"))) && !text(d.querySelector(".main")).includes("BN11"), "small areas are pooled on the page");

// the demonstration
const pack = t.buildPack();
const demoPage = Object.values(pack.surveys).find((x) => x.results.total > 0);
ok(demoPage.self.results.used > 30 && demoPage.results.used === 412 && demoPage.survey.selfOn, "the demonstration has replies from a link, run through the same sums");
d = await open("", `#survey/NORTHBRIDGE/${demoPage.survey.id}/collect`, "/demo");
await see(d, /A link for people to fill in themselves/);
await until(() => d.querySelector("svg.qr"), "the demonstration's QR code");
ok(/no real link/.test(text(d.querySelector(".main"))) && !/https?:/.test(JSON.stringify(pack.qr)), "with no real link");
const noQr = browser(mainHtml, `/#survey/${WSX}/${fresh.id}/collect`, (w) => { w.localStorage.setItem("clarion_token", lead); w.noQr = true; });
await until(() => noQr.querySelector(".main .page > *"), "the page to start");
await see(noQr, /The QR code couldn't be made/);
ok(!noQr.querySelector("svg.qr"), "if the QR code can't be made, the page says so");

console.log(failures ? `\n${failures} failed` : "\nAll passed");
process.exit(failures ? 1 : 0);
