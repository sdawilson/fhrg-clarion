// Street Surveys in a simulated browser (jsdom): an officer's screens and the tablet page, talking to the real app.
import fs from "node:fs";
import { JSDOM } from "jsdom";
import { addUser, claude, until } from "./sim.mjs";
const { handleRequest } = await import("./.build/app.mjs");

let failures = 0;
const ok = (cond, what) => { console.log(`${cond ? "PASS" : "FAIL"}  ${what}`); if (!cond) failures++; };
const WSX = "E10000032";
await addUser(1, "lead@westsussex.gov.uk", "Lee Lead", 30, "lead");
await addUser(2, "member@westsussex.gov.uk", "Mo Member", 30, "member");
await addUser(3, "boss@fhrg.test", "Bo Boss", 99, "member");
const api = async (path, body, token) => (await handleRequest(new Request("https://clarion.test" + path, { method: "POST", headers: { "content-type": "application/json", "x-session-token": token || "" }, body: JSON.stringify(body) }))).json();
const lead = (await api("/api/login", { email: "lead@westsussex.gov.uk", password: "pw" })).token;
const member = (await api("/api/login", { email: "member@westsussex.gov.uk", password: "pw" })).token;
const boss = (await api("/api/login", { email: "boss@fhrg.test", password: "pw" })).token;

const pages = { main: fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8"), tablet: fs.readFileSync(new URL("../public/survey.html", import.meta.url), "utf8") };
const net = { down: false };
function browser(html, address, setup) {
  return new JSDOM(html, {
    url: address, runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(w) {
      setup?.(w);
      w.scrollTo = () => {};
      w.print = () => { w.printed = true; };
      w.fetch = async (url, opts = {}) => {
        if (net.down) throw new TypeError("Failed to fetch");
        const res = await handleRequest(new Request(new URL(url, "https://clarion.test").href, opts));
        const text = await res.text();
        return { ok: res.ok, status: res.status, json: async () => JSON.parse(text) };
      };
    },
  });
}
async function open(token, hash) {
  const dom = browser(pages.main, `https://clarion.test/${hash}`, (w) => { w.localStorage.setItem("clarion_token", token); w.URL.createObjectURL = (blob) => { w.downloaded = blob; return "blob:x"; }; w.URL.revokeObjectURL = () => {}; });
  await until(() => dom.window.document.querySelector(".main .page > *"), "the page to start");
  dom.window.eval("App.pollMs = 20");
  return dom;
}
const text = (el) => el.textContent.replace(/\s+/g, " ");
const button = (d, name) => [...d.querySelectorAll("button")].find((b) => b.textContent === name);
const see = (d, pattern) => until(() => pattern.test(text(d.querySelector(".main"))), `the page to show ${pattern}`);

// ---- starting a survey
let dom = await open(lead, `#surveys/${WSX}`), d = dom.window.document, w = dom.window;
await see(d, /No surveys yet/);
ok(d.querySelector('.tabs button[aria-current="page"]').textContent === "2Surveys", "Surveys has its own tab");
let f = d.querySelector(".card form");
f.querySelector("input").value = "Autumn roads";
f.querySelector("textarea").value = "How people feel about the A27 works.";
f.dispatchEvent(new w.Event("submit", { cancelable: true, bubbles: true }));
await see(d, /Core questions/);
const id = w.location.hash.split("/")[2];
ok(/How satisfied are you with the condition of roads and pavements/.test(text(d.querySelector(".main"))), "a new survey opens on its set-up, with the fixed core questions");
ok(/Who to reach/.test(text(d.querySelector(".main"))) && [...d.querySelectorAll("td")].some((x) => x.textContent === "75 or over"), "and age and sex targets from the Census");
ok(/Confirm it's right before any real fieldwork/.test(text(d.querySelector(".main"))), "and a reminder to confirm who's collecting the data");
ok([...d.querySelectorAll('input[type="checkbox"]')].length === 7, "and the access checklist");

// suggestions and wording
button(d, "Suggest questions").click();
await see(d, /Have you noticed the work on the A27/);
button(d, "Add this question").click();
ok(d.querySelector('input[aria-label="Local question 1"]').value === "Have you noticed the work on the A27?", "a suggestion can be added with one press");
button(d, "Check the wording").click();
await see(d, /It assumes the roads are bad/);
ok(/Leading/.test(text(d.querySelector(".main"))), "the wording check picks out problems");
button(d, "Use this wording").click();
ok(d.querySelector('input[aria-label="Local question 1"]').value === "How are the roads near you?", "and better wording can be used");
button(d, "Add a question").click();
const second = d.querySelector('input[aria-label="Local question 2"]');
second.value = "What would you change first?"; second.dispatchEvent(new w.Event("input"));
const kind = d.querySelector('select[aria-label="Kind of answer for local question 2"]');
kind.value = "text"; kind.dispatchEvent(new w.Event("change"));
button(d, "Save questions").click();
await see(d, /Saved\./);

// how many people to ask, and where
await see(d, /West Sussex: proposed sites/);
const plain = () => text(d.querySelector(".main"));
ok(/Site survey\s*Suggested/.test(plain()) && /120 replies/.test(plain()) && /4 sites of 30/.test(plain()), "a new survey starts as a site survey: four sites of 30");
ok(/±9\.7 points/.test(plain()) && /About 14 points/.test(plain()) && /15 hours/.test(plain()), "with its margin, the change it can show and the interviewer time");
const pins = () => [...d.querySelectorAll(".map-pin")].map((x) => x.textContent.replace(/^\d+/, ""));
ok(pins().length === 4 && pins()[0] === "Testhaven", "the sites are proposed first, largest town first, on the map");
ok(d.querySelectorAll(".map-shapes path").length === 24 && [...d.querySelectorAll(".map-shapes path")].every((x) => x.getAttribute("fill")), "every neighbourhood is coloured by the site that stands for it");
ok(/stands for \d+% of adults/.test(plain()) && /Ask \d+ aged 16 to 34, \d+ aged 35 to 64 and \d+ aged 65 or over/.test(plain()), "each site shows who it stands for and who to ask");
ok(d.querySelector(".map-credit") && d.querySelector(".map-street img").src.startsWith("https://tile.openstreetmap.org/") && d.querySelector(".map-street img").getAttribute("referrerpolicy") !== "no-referrer", "there's a street map under it, credited, and it can send what the map service requires");
ok(/How well these sites match West Sussex/.test(plain()) && /Households with no car/.test(plain()), "and how well they match the authority");
const aim = () => Number(d.querySelector('input[min="30"]').value);
[...d.querySelectorAll(".map-pin")].at(-1).click();
ok(pins().length === 3 && aim() === 90 && /3 sites of 30/.test(plain()), "taking a site off the map changes the aim");
button(d, "Oldbury").click();
ok(pins().length === 4 && pins().includes("Oldbury") && aim() === 120, "and so does adding a town");
[...d.querySelectorAll("tr")].find((x) => /Standard/.test(x.textContent)).querySelector("button").click();
ok(aim() === 500 && pins().length === 4, "another level sets another aim, and leaves your chosen sites alone");
[...d.querySelectorAll("tr")].find((x) => /Site survey/.test(x.textContent)).querySelector("button").click();
ok(aim() === 120 && d.querySelector("tr.selected").textContent.includes("Site survey"), "and the chosen level is marked");
const group = (label) => [...d.querySelectorAll(".field")].find((x) => x.firstChild?.textContent === label);
const choose = (label, value) => [...group(label).querySelectorAll("button")].find((x) => x.textContent === value).click();
choose("People at each site", "40");
ok(aim() === 160 && /Ask \d+ aged 16 to 34/.test(plain()) && /4 sites of 40/.test(plain()), "more people at each site raises the aim");
choose("People at each site", "30");
button(d, "Go back to the proposed sites").click();
ok(pins().length === 4 && !pins().includes("Oldbury") && aim() === 120, "and the proposed sites can be brought back");
choose("Sites", "5");
ok(pins().length === 5 && aim() === 150, "the number of sites can be changed");
choose("Sites", "4");
[...d.querySelectorAll("tr")].find((x) => /Standard/.test(x.textContent)).querySelector("button").click();
ok(aim() === 500 && /Ask [234]\d aged 16 to 34/.test(plain()), "with a bigger aim, each site's age targets grow to match");
[...d.querySelectorAll("tr")].find((x) => /Site survey/.test(x.textContent)).querySelector("button").click();
button(d, "Add a place that isn't on the map").click();
const site = [...d.querySelectorAll('.site-entry input[placeholder="Market Square, Horsham"]')].at(-1);
site.value = "Market Square"; site.dispatchEvent(new w.Event("input"));
d.querySelector('input[type="checkbox"]').click();
button(d, "Save the plan").click();
await until(() => [...d.querySelectorAll('[role="status"]')].filter((x) => x.textContent === "Saved.").length >= 2, "the plan to save");
const saved = (await api("/api/survey/get", { code: WSX, id }, lead)).survey;
ok(saved.locals.length === 2 && saved.locals[1].kind === "text" && saved.plan.sites.some((x) => x.name === "Market Square") && saved.plan.checks.length === 1, "questions and plan are saved");
button(d, "Go back to the proposed sites").click();
const spot = d.querySelector('.site-entry input[placeholder="The market square on a Saturday"]');
spot.value = "Market hall"; spot.dispatchEvent(new w.Event("input"));
choose("Margin", "±7");
ok(d.querySelector('.site-entry input[placeholder="The market square on a Saturday"]').value === "Market hall", "what's typed against a site survives a change of level");
choose("Margin", "±5");
ok(aim() === 480 && /16 sites of 30/.test(plain()) && /Clarion proposes up to six sites/.test(plain()), "a level needing many sites says so");
choose("Margin", "±10");
choose("How sure", "99%");
choose("Margin", "±3");
choose("Results for", "Each constituency");
ok(aim() > 5000 && /A survey can hold up to 5,000 replies/.test(plain()), "and an aim too large to hold is pointed out");
[...d.querySelectorAll("tr")].find((x) => /Site survey/.test(x.textContent)).querySelector("button").click();
const hand = [...d.querySelectorAll('.site-entry input[placeholder="Market Square, Horsham"]')].at(-1);
ok(hand.value === "Market Square" && aim() === 150, "sites added by hand count towards the aim");
const mapped = saved.plan.sites.filter((x) => x.share);
ok(mapped.length === 4 && Math.abs(mapped.reduce((sum, x) => sum + x.share, 0) - 100) < 0.5 && mapped.every((x) => x.ages.reduce((sum, n) => sum + n, 0) === 30 && x.lat && x.lng), "with each site's share of adults and its age targets");
ok(saved.plan.sure === 90 && saved.plan.margin === 10 && saved.plan.by === "sites" && saved.plan.target === 120, "and the level chosen");

// a plan with two sessions in one town, typed by hand before there was a map
const repeat = (await api("/api/survey/new", { code: WSX, title: "Two sessions" }, lead)).survey.id;
await api("/api/survey/save", { code: WSX, id: repeat, plan: { target: 120, checks: [], by: "whole", sites: [{ name: "Testhaven", when: "Saturday", interviewers: "2" }, { name: "testhaven ", when: "Tuesday", interviewers: "1" }, { name: "The Hall", when: "", interviewers: "" }] } }, lead);
let sessions = await open(lead, `#survey/${WSX}/${repeat}/setup`), e = sessions.window.document;
await until(() => e.querySelector(".map-pin"), "the map");
ok(e.querySelectorAll(".site-entry").length === 3 && e.querySelectorAll(".map-pin").length === 1, "two sessions in one town both stay, with one place on the map");
ok(/Ask \d+ aged 16 to 34/.test(text(e.querySelector(".main"))), "and the page still works");
[...e.querySelectorAll(".site-entry")][1].querySelector(".btn.ghost").click();
ok(e.querySelectorAll(".site-entry").length === 2 && e.querySelectorAll(".map-pin").length === 1, "and one session can be taken off without the other");
await api("/api/survey/status", { code: WSX, id: repeat, status: "open" }, lead);
await api("/api/survey/status", { code: WSX, id: repeat, status: "closed" }, lead);
sessions = await open(lead, `#survey/${WSX}/${repeat}/setup`); e = sessions.window.document;
await until(() => /This survey is closed/.test(text(e.querySelector(".main"))), "the closed survey");
ok(!e.querySelector(".map-pin") && !/Add a place/.test(text(e.querySelector(".main"))) && e.querySelector(".site-entry input").disabled, "a closed survey's sites can't be changed");

// opening
w.location.hash = `#survey/${WSX}/${id}/collect`;
await see(d, /Open the survey/);
ok(/Check that's right before any real fieldwork/.test(text(d.querySelector(".main"))), "opening repeats the reminder about who's named");
button(d, "Open the survey").click();
await see(d, /Close the survey/);
const access = (await api("/api/survey/get", { code: WSX, id }, lead)).survey.access;
ok(text(d.querySelector(".link-box")) === `https://clarion.test/s/${access}`, "the tablet link is shown");
ok(/Answers so far/.test(text(d.querySelector(".main"))), "answers can now come in");

// printing
d.querySelector('.form-grid input').value = "5";
d.querySelectorAll('.form-grid input')[1].value = "7";
button(d, "Prepare forms to print").click();
await see(d, /Forms 5 to 7/);
const sheets = [...d.querySelectorAll(".sheet")];
ok(sheets.length === 3 && /Form 5/.test(text(sheets[0])) && /Form 7/.test(text(sheets[2])), "each printed form has its own number");
ok(/Run by West Sussex County Council/.test(text(sheets[0])) && /16 or over/.test(text(sheets[0])) && /An AI tool/.test(text(sheets[0])) && /don't write anyone's name/.test(text(sheets[0])), "with the notice");
ok(sheets[0].querySelectorAll(".sheet-q").length === 10 && sheets[0].querySelectorAll(".sheet-box").length > 30, "all ten questions, with tick boxes");
ok(/1 ?Very satisfied/.test(text(sheets[0])) && /2 ?Fairly satisfied/.test(text(sheets[0])), "and numbered answers");
ok(!text(sheets[0]).includes(access), "and not the tablet code");
ok(/Form 5/.test(text(sheets[0].querySelector(".sheet-back"))), "and each side carries the form number, in case the sheets are scanned singly");
button(d, "Print").click();
ok(w.printed === true, "and they can be printed");

// typing one in
w.location.hash = `#survey/${WSX}/${id}/collect`;
await see(d, /Type in paper forms/);
ok(d.querySelector('.form-grid input').value === "8" && /Forms up to 7 have been prepared/.test(text(d.querySelector(".main"))), "the next batch of forms carries on from the last, even if none have been entered yet");
const row = [...d.querySelectorAll(".entry-row")];
const type = (i, v) => { const el = row[i].querySelector("input, textarea"); el.value = v; el.dispatchEvent(new w.Event("input")); };
ok(d.querySelector('input[aria-label="Form number"]').value === "1", "typing in starts at form 1");
type(0, "7");
ok(/Choose 1 to 6/.test(text(row[0])) && row[0].querySelector(".echo").className.includes("bad"), "a number that isn't on the form is caught as you type");
const entry = [...d.querySelectorAll("form")].find((x) => x.querySelector('input[aria-label="Form number"]'));
entry.dispatchEvent(new w.Event("submit", { cancelable: true, bubbles: true }));
await see(d, /Check the answers marked in red/);
type(0, "2");
ok(/Fairly satisfied/.test(text(row[0])), "a good one shows the answer it means");
type(2, "<img src=x onerror=\"window.hacked=1\">A hole by the school");
entry.dispatchEvent(new w.Event("submit", { cancelable: true, bubbles: true }));
await see(d, /Form 1 saved/);
ok(d.querySelector('input[aria-label="Form number"]').value === "2" && row[0].querySelector("input").value === "", "and the next form is ready");

// a scan
const scanInput = d.querySelector('input[aria-label="Scanned forms"]');
Object.defineProperty(scanInput, "files", { value: [new w.File(["%PDF-1.4 pretend"], "forms.pdf", { type: "application/pdf" })] });
button(d, "Read the forms").click();
await see(d, /Clarion read 2 forms/);
ok(/2 answers are marked to check/.test(text(d.querySelector(".main"))) && d.querySelectorAll(".unclear").length === 2, "a scan comes back with doubtful answers marked");
d.querySelector('input[aria-label="Form number 1"]').value = "800";
button(d, "Save these forms").click();
await see(d, /2 forms saved/);
ok((await api("/api/survey/get", { code: WSX, id }, lead)).results.bySource.scan === 2, "and is saved once checked, with any corrections");

// a file
ok(/Which column is which/.test(text(d.querySelector(".main"))), "there's a guide to a file's columns");
button(d, "Download the template").click();
ok(w.downloaded && (await w.downloaded.text()).includes("form,site,c1"), "and a template to download");
const csvInput = d.querySelector('input[aria-label="File of forms"]');
Object.defineProperty(csvInput, "files", { value: [new w.File(["form,c1\n900,1\n"], "forms.csv", { type: "text/csv" })] });
button(d, "Add these forms").click();
await see(d, /1 form added/);

// ---- the tablet
function tablet(path) {
  const dom2 = browser(pages.tablet, `https://clarion.test${path}`, (x) => { x.SEND_EVERY_MS = 25; });
  return { dom: dom2, d: dom2.window.document, w: dom2.window };
}
let tb = tablet(`/s/${access}`);
await until(() => button(tb.d, "Start"), "the tablet's first screen");
ok(/Run by West Sussex County Council/.test(text(tb.d.getElementById("app"))) && /16 or over/.test(text(tb.d.getElementById("app"))), "the tablet shows the notice first");
button(tb.d, "Start").click();
ok(/Say where you are first/.test(text(tb.d.getElementById("app"))), "and asks where the interviewer is");
const pick = tb.d.querySelector('select[aria-label="Site"]');
pick.value = "Market Square";
button(tb.d, "Start").click();
ok(/Question 1 of 10/.test(text(tb.d.getElementById("app"))) && tb.d.querySelectorAll(".choice").length === 6, "it shows one question at a time, with large buttons");
button(tb.d, "Very satisfied").click();
ok(/Question 2 of 10/.test(text(tb.d.getElementById("app"))), "a press moves on");
button(tb.d, "Back").click();
ok(button(tb.d, "Very satisfied").getAttribute("aria-pressed") === "true", "and going back shows what was chosen");
button(tb.d, "Very satisfied").click();
button(tb.d, "Skip").click();
const area = tb.d.querySelector("textarea");
area.value = "<b>Bold</b> hole outside Jane Smith's"; area.dispatchEvent(new tb.w.Event("input"));
ok(/leave out anyone's name/.test(text(tb.d.getElementById("app"))), "a written answer comes with a reminder to leave out names");
for (let i = 3; i <= 10; i++) { if (tb.d.querySelector("textarea")) button(tb.d, "Next").click(); else button(tb.d, "Skip").click(); }
await until(() => /Thank you/.test(text(tb.d.getElementById("app"))), "the thank-you");
ok(!/Jane|Bold/.test(text(tb.d.getElementById("app"))), "nothing of that person's stays on the screen");
await until(() => /All sent/.test(text(tb.d.querySelector("header"))), "the form to send");
let answers = (await api("/api/survey/get", { code: WSX, id }, lead));
ok(answers.results.bySource.tablet === 1 && answers.waiting >= 2, "the form reaches Clarion");

// no signal
net.down = true;
button(tb.d, "Next person").click();
button(tb.d, "Start").click();
button(tb.d, "Very dissatisfied").click();
for (let i = 1; i < 10; i++) { if (tb.d.querySelector("textarea")) button(tb.d, "Next").click(); else button(tb.d, "Skip").click(); }
await until(() => /1 form waiting to send/.test(text(tb.d.querySelector("header"))), "the form to wait");
ok(JSON.parse(tb.w.localStorage.getItem(`clarion_queue_${access}`)).length === 1, "with no signal the form stays on the tablet");
const offline = tablet(`/s/${access}`);
await until(() => button(offline.d, "Start") || /no signal/.test(text(offline.d.getElementById("app"))), "the page with no signal");
ok(/hasn't been opened on this tablet before/.test(text(offline.d.getElementById("app"))), "a tablet that's never opened the survey says so");
net.down = false;
await until(() => /All sent/.test(text(tb.d.querySelector("header"))), "the form to send");
ok((await api("/api/survey/get", { code: WSX, id }, lead)).results.bySource.tablet === 2, "and is sent when the signal returns");
ok(JSON.parse(tb.w.localStorage.getItem(`clarion_queue_${access}`)).length === 0, "and is then cleared from the tablet");

// a survey opened before, with no signal now
button(tb.d, "Next person").click();
net.down = true;
const again = browser(pages.tablet, `https://clarion.test/s/${access}`, (x) => { x.SEND_EVERY_MS = 25; x.localStorage.setItem(`clarion_survey_${access}`, tb.w.localStorage.getItem(`clarion_survey_${access}`)); });
await until(() => button(again.window.document, "Start"), "the kept survey");
ok(/Ready for the next person/.test(text(again.window.document.getElementById("app"))), "a tablet that has opened it before carries on without a signal");
net.down = false;

// a full survey: the form stays on the tablet
const realFetch = tb.w.fetch;
tb.w.fetch = async () => ({ ok: true, status: 200, json: async () => ({ added: 0, skipped: 0, problems: ["Full"], done: [] }) });
tb.w.localStorage.setItem(`clarion_queue_${access}`, JSON.stringify([{ client: "refused", site: "x", secs: 100, answers: { c1: "Very satisfied" } }]));
await until(() => /1 form still on this tablet/.test(text(tb.d.querySelector("header"))), "the form to stay");
ok(JSON.parse(tb.w.localStorage.getItem(`clarion_queue_${access}`)).length === 1, "a form Clarion turns down stays on the tablet, and it says so");
tb.w.fetch = realFetch;
await until(() => /All sent/.test(text(tb.d.querySelector("header"))), "the refused form to go");

// closing with forms still on the tablet
await api("/api/survey/status", { code: WSX, id, status: "closed" }, lead);
tb.w.localStorage.setItem(`clarion_queue_${access}`, JSON.stringify([{ client: "stuck", site: "x", secs: 100, answers: { c1: "Very satisfied" } }]));
await until(() => /This survey is closed/.test(text(tb.d.getElementById("app"))), "the closed screen");
ok(/1 form is still on this tablet/.test(text(tb.d.getElementById("app"))), "if the survey closes with forms still on a tablet, it says so and keeps them");
await api("/api/survey/status", { code: WSX, id, status: "open" }, lead);
button(tb.d, "Try again").click();
await until(() => /All sent/.test(text(tb.d.querySelector("header"))), "the forms to send");
ok(button(tb.d, "Start"), "and sends them once it's open again");

// a wrong code, and no code
const wrong = tablet("/s/ZZZZ2222");
await until(() => /wasn't recognised/.test(text(wrong.d.getElementById("app"))), "the wrong code");
ok(wrong.d.querySelector('input[aria-label="Survey code"]'), "a wrong code can be typed again");
const bare = tablet("/s");
await until(() => bare.d.querySelector('input[aria-label="Survey code"]'), "the code box");
ok(!bare.w.localStorage.length, "an interviewer can start from the plain address, by typing the code");

// ---- checking and sorting
w.location.hash = `#survey/${WSX}/${id}/check`;
await see(d, /Written comments/);
ok(/comments? waiting/.test(text(d.querySelector(".main"))), "comments wait to be sorted");
ok(/Only people in the authority/.test(text(d.querySelector(".main"))), "and the page says who can see them");
button(d, "Take out names and sort").click();
await see(d, /Check a sample/);
ok(/No comments waiting/.test(text(d.querySelector(".main"))), "sorting clears the queue");
button(d, "Looks right").click();
await see(d, /Saved\./);
d.querySelector('input[aria-label="Form number to leave out"]').value = "900";
button(d, "Leave out this form").click();
await see(d, /Put back form 900/);
ok(/Put a mistake right/.test(text(d.querySelector(".main"))), "any form can be left out by its number, to put a mistake right");
button(d, "Put back form 900").click();
await until(() => !button(d, "Put back form 900") && button(d, "Leave out this form"), "the form to come back");

// ---- results, for a member of the authority who isn't its lead
await api("/api/s/submit", { access, forms: Array.from({ length: 40 }, (_, i) => ({ client: `n${i}`, site: "Market Square", secs: 200, answers: { c1: "Fairly dissatisfied", a1: "45 to 54", a2: "Female" } })) });
await api("/api/survey/sort", { code: WSX, id }, lead).catch(() => {});
dom = await open(member, `#survey/${WSX}/${id}/results`); d = dom.window.document; w = dom.window;
await see(d, /Indicative only/);
ok(button(d, "Set up") && button(d, "Collect") && button(d, "Check"), "a member of the authority gets every step, like its lead");
ok(/weighted to the local population's age and sex/.test(text(d.querySelector(".main"))), "and results that say how they're weighted");
ok(d.querySelector(".meter span").style.width !== "", "with a bar for each answer");
ok(button(d, "Download the answers"), "and the download of the answers, as comments stay with the authority's own people");
const page = text(d.querySelector(".main"));
ok(/\[removed\]/.test(page) && !/Jane/.test(page), "comments appear with names removed");
ok(/<img src=x/.test(page) && d.querySelector(".comment img") === null && w.hacked === undefined, "anything a resident wrote is shown as text, never run");

dom = await open(lead, `#survey/${WSX}/${id}/results`); d = dom.window.document; w = dom.window;
await see(d, /Indicative only/);
button(d, "Download the answers").click();
await until(() => w.downloaded, "the download");
ok((await w.downloaded.text()).includes("form,site,entered_by,weight"), "a lead can download the answers");
w.location.hash = `#evidence/${WSX}`;
await see(d, /Street samples aren't random/);
ok(d.querySelector(`a[href="#survey/${WSX}/${id}/results"]`), "the authority's page links to the survey");
w.location.hash = `#dash/${WSX}`;
await see(d, /Satisfied with roads and pavements/);
ok(/Indicative/.test(text(d.querySelector(".main"))), "and the summary leads with its result, labelled indicative");

dom = await open(boss, `#survey/${WSX}/${id}/results`); d = dom.window.document;
await see(d, /The comments themselves stay with the authority/);
ok(!d.querySelector(".comment") && !/\[removed\]/.test(text(d.querySelector(".main"))), "a site administrator from outside the authority sees topic counts, not comments");

ok(claude.refused.length === 0, "every call to Claude was one the real service would accept");
console.log(failures ? `\n${failures} FAILED` : "\nAll passed");
process.exit(failures ? 1 : 0);
