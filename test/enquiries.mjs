// Enquiries and the council's own news: the rules on their own, then the routes and the page against the simulators.
import fs from "node:fs";
import { JSDOM } from "jsdom";
import { addUser, files, getText, hooks, newsTopics, until } from "./sim.mjs";
const { handleRequest } = await import("./.build/app.mjs");
const t = await import("./.build/internals.mjs");

let failures = 0;
const ok = (cond, what) => { console.log(`${cond ? "PASS" : "FAIL"}  ${what}`); if (!cond) failures++; };
const WSX = "E10000032", KIRK = "E08000034";
const TOPICS = ["Potholes and road condition", "Pavements", "Street lighting", "Flooding and drainage", "Winter service", "Parking"];

// ---- the rules
ok(t.topicFor("Road defects", TOPICS) === "Potholes and road condition" && t.topicFor("Street lights", TOPICS) === "Street lighting" && t.topicFor("Gullies", TOPICS) === "Flooding and drainage" && t.topicFor("Footway defects", TOPICS) === "Pavements", "a council's categories are sorted into the shared topics");
ok(t.topicFor("Winter gritting routes confirmed", TOPICS) === "Winter service" && t.topicFor("Robert Plant announces tour", TOPICS) === "" && t.topicFor("parking", TOPICS) === "Parking", "and so are headlines, with anything else left out");
ok(t.topicFor("Traffic signals", TOPICS) === "", "a category with no such shared topic isn't forced into one");

ok(t.trendOf(130, [100, 100, 100]) === "Rising" && t.trendOf(70, [100, 100, 100]) === "Falling" && t.trendOf(110, [100, 100, 100]) === "Steady", "the latest month is compared with the three before");
ok(t.trendOf(130, [100, undefined, 100]) === "Not enough history" && t.trendOf(130, [100]) === "Not enough history", "and it needs all three");
ok(t.trendOf(9, [2, 3, 4]) === "Too few to say", "and more than a handful of contacts");

const month = (over = {}) => ({ categories: { "Road defects": [80, 20], "Street lights": [40, 0], Other: [5, 1] }, areas: { Moorside: 60, "Dale End": 30, Tiny: 9 }, routes: { Online: 90, Phone: 30 }, ...over });
const sent = (months, over = {}) => ({ rows: 146, skipped: 0, months, ...over });
const imported = t.readImport(sent({ "2026-10": month() }), "2026-11");
ok(imported.added === 146 && imported.months["2026-10"].categories["Road defects"][1] === 20, "counts are read back and added up");
const noted = t.readImport(sent({ "2026-10": { categories: { "Road defects": [5, 0], ["x".repeat(61)]: [5, 0], "Call 01234 567890": [5, 0], "a.person@example.com": [5, 0], __proto__x: [1, 0], "['__proto__']": [1, 0] }, areas: { "b.person@example.com": 40 }, routes: {} } }, { rows: 12 }), "2026-11");
ok(!Object.keys(noted.months["2026-10"].categories).some((k) => /x{61}|0123|@/.test(k)) && !Object.keys(noted.months["2026-10"].areas).length, "anything long, or that looks like contact details, is left out even if it's sent");
const refusal = (fn) => { try { fn(); return ""; } catch (e) { return e.message; } };
ok(/future/.test(refusal(() => t.readImport(sent({ "2026-12": month() }), "2026-11"))) && /future/.test(refusal(() => t.readImport(sent({ "20-10": month() }), "2026-11"))), "a month in the future, or that can't be read, is refused");
const free = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`Words number ${i}`, [1, 0]]));
ok(/too many different categories/.test(refusal(() => t.readImport(sent({ "2026-10": { categories: free, areas: {}, routes: {} } }, { rows: 80 }), "2026-11"))), "a column of free text sent as categories is refused");
ok(/nothing was brought in/.test(refusal(() => t.readImport({}, "2026-11"))), "and so is nothing at all");

const held = { months: { "2026-07": month(), "2026-08": month(), "2026-09": month(), "2026-10": month({ categories: { "Road defects": [200, 40], "Street lights": [40, 0], Other: [5, 1] } }) }, matches: {}, imports: [], page: "" };
let v = t.enquiriesView(held, 100000, TOPICS);
const top = v.rows[0];
ok(top.topic === "Potholes and road condition" && top.enquiries === 200 && top.complaints === 40 && top.perThousand === 2.4 && top.trend === "Rising", "each topic shows the latest month, per 1,000 adults, and how it compares");
ok(v.unmatched.categories.join() === "Other" && v.unmatched.enquiries === 5 && v.rows.find((x) => x.topic === "Street lighting").trend === "Steady", "and what hasn't been matched is shown separately");
ok(v.areas.length === 2 && v.hiddenAreas === 1 && !JSON.stringify(v).includes("Tiny"), "an area with fewer than 10 contacts isn't shown");
ok(v.routes[0].name === "Online" && v.routes[0].share === 75, "and the routes in are shown as shares");
ok(t.enquiriesView({ ...held, matches: { Other: "Parking", "Road defects": "" } }, 100000, TOPICS).rows.some((x) => x.topic === "Parking") && !t.enquiriesView({ ...held, matches: { "Road defects": "" } }, 100000, TOPICS).rows.some((x) => x.topic.startsWith("Potholes")), "an officer's own match beats the suggestion");
ok(t.enquiriesView({ ...held, months: {} }, 100, TOPICS).ready === false && t.enquiriesView(held, null, TOPICS).rows[0].perThousand === null, "nothing held says so, and no Census figures means no rate");

ok(t.ownSite("https://www.westsussex.gov.uk/news/", {}) && t.ownSite("https://news.gov.scot/x", {}) && t.ownSite("https://kirkleestogether.co.uk/", { ownSites: ["kirkleestogether.co.uk"] }), "a council's own sites can be read");
ok(!t.ownSite("http://www.westsussex.gov.uk/news/", {}) && !t.ownSite("https://example.com/", {}) && !t.ownSite("https://169.254.169.254/", {}) && !t.ownSite("https://localhost/", {}) && !t.ownSite("https://x.gov.uk.evil.example/", {}) && !t.ownSite("https://x.gov.uk:8443/", {}) && !t.ownSite("https://a@x.gov.uk/", {}) && !t.ownSite("not an address", {}), "and nothing else");

const wsx = `<nav><a href="/news/">News</a><a href="/news/email-alerts-and-newsletters/">Email alerts and eNewsletters</a></nav>
<article><h2><a href="/news/winter-gritting-routes-confirmed-for-west-sussex/">Winter gritting routes confirmed for West Sussex</a></h2><time datetime="2026-11-03T09:00">3 November</time></article>
<article><h2><a href="https://www.westsussex.gov.uk/news/new-timetable-for-changes-to-councils/">New timetable for changes to councils</a></h2><p>Date: 30 October 2026</p></article>
<article><h2><a href="/news/national-awards-for-west-sussex-social-workers/">National awards for West Sussex social workers</a></h2><p>30 October 2026</p></article>
<a href="/news/national-awards-for-west-sussex-social-workers/">Read more</a><a href="https://elsewhere.example/news/some-other-story-here/">Some other story on another site</a>`;
const fromWsx = t.postsFromPage(wsx, "https://www.westsussex.gov.uk/news/");
ok(fromWsx.length === 3 && fromWsx[0].date === "2026-11-03" && fromWsx[1].date === "2026-10-30" && !fromWsx.some((x) => /Email alerts|another site|Read more/.test(x.title)), "posts are picked out of a news page, leaving out navigation and other sites");
const lincs = `<a href="/news/article/3010/north-hykeham-relief-road-november-2026-update"><h3>North Hykeham Relief Road - November 2026 update</h3></a><p>Published: 2nd November 2026</p><a href="/news/article/3011/decision-on-lgr-withdrawn">Decision on LGR in Lincolnshire withdrawn</a><p>Published: 29th October 2026</p><a href="/news/article/3015/help-shape-a-new-youth-strategy">Help shape a new Youth Strategy</a><p>Published: 3rd November 2026</p>`;
ok(t.postsFromPage(lincs, "https://www.lincolnshire.gov.uk/news")[0].date === "2026-11-02" && t.postsFromPage(lincs, "https://www.lincolnshire.gov.uk/news")[0].title.startsWith("North Hykeham"), "whichever way a site lays them out");
const kirk = `<a href="https://kirkleestogether.co.uk/2026/11/03/connecting-kirklees-roadworks-update-for-november-2026/">Connecting Kirklees: Roadworks update for November 2026</a><a href="https://kirkleestogether.co.uk/category/news-and-updates/">News and updates from the council</a><a href="/2026/10/12/were-winter-ready/">We're winter ready, and gritters are out</a><a href="/2026/09/17/food-hall/">Could your food business be part of the Food Hall?</a>`;
ok(t.postsFromPage(kirk, "https://kirkleestogether.co.uk/").length === 3 && t.postsFromPage(kirk, "https://kirkleestogether.co.uk/")[0].date === "2026-11-03", "with the date taken from the address where it's there");
const feed = `<rss><channel><title>News</title><item><title><![CDATA[Roadworks update &amp; closures]]></title><link>https://kirkleestogether.co.uk/2026/11/03/a/</link><pubDate>Tue, 03 Nov 2026 12:00:00 +0000</pubDate></item><item><title>No link here</title></item></channel></rss>`;
ok(t.postsFromFeed(feed).length === 1 && t.postsFromFeed(feed)[0].title === "Roadworks update & closures" && t.postsFromFeed(feed)[0].date === "2026-11-03", "and a site's feed is read if it has one");

// ---- through the API
newsTopics.push("Winter service", "Parking");
await addUser(1, "lead@westsussex.gov.uk", "Lee Lead", 30, "lead");
await addUser(2, "member@westsussex.gov.uk", "Mo Member", 30, "member");
await addUser(3, "officer@kirklees.gov.uk", "Kit Officer", 20, "lead");
const api = async (path, body, token) => { const r = await handleRequest(new Request(`https://clarion.test${path}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { "x-session-token": token } : {}) }, body: JSON.stringify(body) })); return { status: r.status, ...(await r.json()) }; };
const login = async (email) => (await api("/api/login", { email, password: "pw" })).token;
const lead = await login("lead@westsussex.gov.uk"), member = await login("member@westsussex.gov.uk"), other = await login("officer@kirklees.gov.uk");

const pages = new Map();
hooks.fetch = async (url) => (pages.has(url) ? pages.get(url)() : url.includes("westsussex.gov.uk") || url.includes("kirkleestogether") ? new Response("nothing", { status: 404 }) : null);
const page = (html, status = 200, headers = {}) => () => new Response(html, { status, headers });

const lastMonth = (back) => { const d = new Date(); d.setUTCDate(15); d.setUTCMonth(d.getUTCMonth() - back); return d.toISOString().slice(0, 7); };
const M1 = lastMonth(1), M2 = lastMonth(2);
let r = await api("/api/enquiries/get", { code: WSX });
ok(r.status === 401, "this needs a sign-in");
ok((await api("/api/enquiries/get", { code: WSX }, other)).status === 403, "and it's only for your own authority");
r = await api("/api/enquiries/get", { code: WSX }, member);
ok(r.view.ready === false && !r.canEdit && r.website.page === "https://www.westsussex.gov.uk/news/", "a member can read it, and the council's news page is already set");
ok((await api("/api/enquiries/import", { code: WSX, rows: 1, months: { [M1]: month() } }, member)).status === 403, "a member can't bring anything in");
r = await api("/api/enquiries/import", { code: WSX, file: "october.csv", rows: 146, skipped: 2, months: { [M1]: month() } }, lead);
ok(r.import.added === 146 && r.import.months.join() === M1, "a lead can");
r = await api("/api/enquiries/get", { code: WSX }, member);
ok(r.view.ready && r.view.latest === M1 && r.imports[0].file === "october.csv" && r.view.rows.length > 0, "and the figures show");
await api("/api/enquiries/import", { code: WSX, file: "again.csv", rows: 146, months: { [M1]: month() } }, lead);
r = await api("/api/enquiries/get", { code: WSX }, lead);
const potholes = r.view.rows.find((x) => /Pothole/.test(x.topic));
ok(potholes.enquiries === 80 && r.imports.length === 1 && r.imports[0].file === "again.csv", "bringing in the same month again replaces it, rather than counting twice");
await api("/api/enquiries/import", { code: WSX, file: "september.csv", rows: 146, months: { [M2]: month() } }, lead);
r = await api("/api/enquiries/get", { code: WSX }, lead);
ok(r.view.monthsHeld === 2 && r.imports.length === 2, "another month is added");
ok((await api("/api/enquiries/get", { code: KIRK }, other)).view.ready === false, "and another authority sees none of it");
const stored = getText(files("").find((k) => k.endsWith(`${WSX}/enquiries.json`)));
ok(JSON.parse(stored).months[M1].areas.Tiny === 9, "small areas are kept as counts, but aren't shown");
ok((await api("/api/enquiries/match", { code: WSX, category: "Other", topic: "Made up" }, lead)).status === 400, "a category can only go to a real topic");
ok((await api("/api/enquiries/match", { code: WSX, category: "Other", topic: "Parking" }, member)).status === 403, "by a lead");
await api("/api/enquiries/match", { code: WSX, category: "Other", topic: "Parking" }, lead);
r = await api("/api/enquiries/get", { code: WSX }, lead);
ok(r.view.rows.some((x) => x.topic === "Parking" && x.categories.join() === "Other") && !r.view.unmatched.categories.includes("Other"), "and that's kept");
ok((await api("/api/enquiries/remove", { code: WSX, id: "nope" }, lead)).status === 404 && (await api("/api/enquiries/remove", { code: WSX, id: r.imports[0].id }, member)).status === 403, "only a real import can be removed, by a lead");
await api("/api/enquiries/remove", { code: WSX, id: r.imports.find((x) => x.file === "september.csv").id }, lead);
r = await api("/api/enquiries/get", { code: WSX }, lead);
ok(r.view.monthsHeld === 1 && r.imports.length === 1, "taking an import out removes its month");

ok(r.website.read === false && r.website.posts.length === 0, "a news page that can't be read says so");
ok((await api("/api/enquiries/page", { code: WSX, url: "https://example.com/news" }, lead)).status === 400 && (await api("/api/enquiries/page", { code: WSX, url: "http://169.254.169.254/latest" }, lead)).status === 400, "only the council's own site can be set");
ok((await api("/api/enquiries/page", { code: WSX, url: "https://www.westsussex.gov.uk/latest-news/" }, member)).status === 403, "by a lead");
pages.set("https://www.westsussex.gov.uk/latest-news/", page(`<a href="/latest-news/winter-gritting-routes-confirmed-today/">Winter gritting routes confirmed today</a><p>3 November 2026</p><a href="/latest-news/road-closure-on-the-a27-next-week/">Road closure on the A27 next week</a><p>2 November 2026</p><a href="/latest-news/robert-plant-tour-announced-for-2027/">Robert Plant tour announced for 2027</a><p>1 November 2026</p><a href="/latest-news/adult-social-care-awards-announced/">Adult social care awards announced</a><p>31 October 2026</p>`));
ok((await api("/api/enquiries/page", { code: WSX, url: "https://www.westsussex.gov.uk/latest-news/" }, lead)).status === 200, "a lead can change the page");
r = await api("/api/enquiries/get", { code: WSX }, lead);
ok(r.website.read && r.website.posts.length === 2 && r.website.posts[0].title.startsWith("Winter") && r.website.posts.every((x) => x.topic) && !JSON.stringify(r.website).includes("Robert Plant"), "only posts about roads are listed, newest first");
const sources = await api("/api/coverage/get", { code: WSX }, lead);
ok(sources.automatic.some((x) => /news page/.test(x.name) && x.last === "2026-11-03"), "and the sources list shows when it last found one");
pages.set("https://www.westsussex.gov.uk/moved/", page("", 302, { location: "https://example.com/elsewhere" }));
await api("/api/enquiries/page", { code: WSX, url: "https://www.westsussex.gov.uk/moved/" }, lead);
r = await api("/api/enquiries/get", { code: WSX }, lead);
ok(r.website.read === false, "a news page that sends Clarion to another site isn't followed");
await api("/api/enquiries/page", { code: WSX, url: "https://www.westsussex.gov.uk/latest-news/" }, lead);
await api("/api/enquiries/import", { code: WSX, file: "start.csv", rows: 146, months: { [M2]: month() } }, lead);

// ---- the page
const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
async function open(token, hash) {
  const dom = new JSDOM(html, {
    url: `https://clarion.test/${hash}`, runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(w) {
      w.localStorage.setItem("clarion_token", token);
      w.scrollTo = () => {};
      w.sentBodies = [];
      w.fetch = async (url, opts = {}) => { w.sentBodies.push(String(opts.body ?? "")); const res = await handleRequest(new Request(new URL(url, "https://clarion.test").href, opts)); const text = await res.text(); return { ok: res.ok, status: res.status, json: async () => JSON.parse(text) }; };
    },
  });
  await until(() => dom.window.document.querySelector(".main .page > *"), "the page to start");
  return dom;
}
const text = (el) => el.textContent.replace(/\s+/g, " ");
const see = (d, pattern) => until(() => pattern.test(text(d.querySelector(".main"))), `the page to show ${pattern}`);
const button = (d, name) => [...d.querySelectorAll("button")].find((b) => b.textContent === name || b.textContent.startsWith(name));
const choose = (w, input, name, content) => { Object.defineProperty(input, "files", { value: [new w.File([content], name, { type: "text/csv" })], configurable: true }); input.dispatchEvent(new w.Event("change")); };

const CSV = ["Date raised,Customer name,Address,Email,Phone,Service,Ward,Method,Type,Notes"];
for (let i = 0; i < 60; i++) CSV.push(`${String(i % 28 + 1).padStart(2, "0")}/${M1.slice(5)}/${M1.slice(0, 4)},Jane Smith ${i},${i} Acacia Avenue,jane${i}@example.com,0123456${String(1000 + i)},${i % 3 ? "Road defects" : "Street lights"},${i % 2 ? "Moorside" : "Dale End"},${i % 2 ? "Online" : "Phone"},${i % 10 ? "Enquiry" : "Complaint"},"She was very rude, and said ""no"""`);
CSV.push(`not a date,Jane Smith,1 Acacia Avenue,jane@example.com,01234561000,Road defects,Moorside,Online,Enquiry,Hello`);
CSV.push(`,,,,,,,,,`);
const csv = CSV.join("\r\n");

let dom = await open(lead, `#said/${WSX}/enquiries`), d = dom.window.document, w = dom.window;
await see(d, /Bring in enquiries and complaints/);
ok(/Your file stays on this computer/.test(text(d.querySelector(".main"))), "the page says the file stays on the officer's computer");
choose(w, d.querySelector('input[type="file"]'), "october.csv", csv);
await see(d, /Clarion uses it as/);
let main = text(d.querySelector(".main"));
ok((main.match(/Ignored, never sent/g) || []).length === 5 && !d.querySelector('select[aria-label="Use for Address"]') && !d.querySelector('select[aria-label="Use for Customer name"]') && !d.querySelector('select[aria-label="Use for Notes"]'), "columns that look personal can't be chosen at all");
const sel = (name) => d.querySelector(`select[aria-label="Use for ${name}"]`);
ok(sel("Date raised").value === "date" && sel("Service").value === "category" && sel("Ward").value === "area" && sel("Method").value === "route" && sel("Type").value === "kind", "and the others are guessed from their headings");
sel("Service").value = ""; sel("Service").dispatchEvent(new w.Event("change"));
button(d, "Bring in the counts").click();
await see(d, /which column is the date, and which is the category/);
sel("Service").value = "category"; sel("Service").dispatchEvent(new w.Event("change"));
sel("Ward").value = "category"; sel("Ward").dispatchEvent(new w.Event("change"));
button(d, "Bring in the counts").click();
await see(d, /Choose one column only for category/);
sel("Ward").value = "area"; sel("Ward").dispatchEvent(new w.Event("change"));
const before = w.sentBodies.length;
const go = button(d, "Bring in the counts");
go.click(); go.click();
await see(d, /Last import: october\.csv/);
const bodies = w.sentBodies.slice(before).filter((x) => x.includes("months"));
ok(bodies.length === 1, "a double click brings the file in once");
ok(!/Jane|Smith|Acacia|example\.com|0123456|rude/.test(bodies.join("")), "and nothing personal leaves the browser: only counts are sent");
main = text(d.querySelector(".main"));
ok(/61 rows read, 60 added, 1 skipped because they had no date/.test(main), "the page says what was read and what was skipped");
const held2 = JSON.parse(getText(files("").find((k) => k.endsWith(`${WSX}/enquiries.json`))));
ok(held2.months[M1].categories["Road defects"][0] + held2.months[M1].categories["Road defects"][1] === 40 && held2.months[M1].categories["Street lights"][1] > 0 && held2.months[M1].areas.Moorside === 30 && held2.months[M1].routes.Online === 30, "the counts are right, with complaints told apart");
ok(!/Jane|Acacia|rude/.test(JSON.stringify(held2)), "and nothing personal is stored");
ok(/What people contacted you about/.test(main) && /Road defects/.test(main) && /Not enough history/.test(main) && /What's been brought in/.test(main), "the figures appear, by topic");
ok(/Where from/.test(main) && /How people got in touch/.test(main) && /Online: 50%/.test(main), "with where people are and how they got in touch");
ok(/Winter gritting routes confirmed today/.test(main) && d.querySelector('a[href="https://www.westsussex.gov.uk/latest-news/winter-gritting-routes-confirmed-today/"]'), "and the council's own news");
const topicBox = d.querySelector('select[aria-label="Topic for Road defects"]');
ok(topicBox && /Pothole/.test(topicBox.value), "a lead can see each category's topic, to change it");

// free text chosen by hand is stopped in the browser
const wordy = ["Date raised,Service,Ward"];
for (let i = 0; i < 80; i++) wordy.push(`01/${M1.slice(5)}/${M1.slice(0, 4)},Mrs Brown at number ${i} rang us,Moorside`);
choose(w, d.querySelector('input[type="file"]'), "wordy.csv", wordy.join("\n"));
await see(d, /Bring in the counts from 80 rows/);
const sentBefore = w.sentBodies.length;
button(d, "Bring in the counts").click();
await see(d, /looks like free text/);
ok(!w.sentBodies.slice(sentBefore).some((x) => x.includes("Brown")), "a column of free text is stopped before anything is sent");

dom = await open(member, `#said/${WSX}/enquiries`); d = dom.window.document;
await see(d, /What people contacted you about/);
main = text(d.querySelector(".main"));
ok(!d.querySelector('input[type="file"]') && !/What's been brought in/.test(main) && !d.querySelector('select[aria-label="Topic for Road defects"]') && !button(d, "Save the address"), "a member can read the figures but change nothing");
ok(!/\bnull\b/.test(main), "and nothing stray shows on the page");

hooks.fetch = null;
console.log(failures ? `\n${failures} FAILED` : "\nAll passed");
process.exit(failures ? 1 : 0);
