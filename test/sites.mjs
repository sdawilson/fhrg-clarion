// Survey sites: the proposals on their own, then through the API against the simulators.
import { addUser, lib } from "./sim.mjs";
const { handleRequest } = await import("./.build/app.mjs");
const t = await import("./.build/internals.mjs");

let failures = 0;
const ok = (cond, what) => { console.log(`${cond ? "PASS" : "FAIL"}  ${what}`); if (!cond) failures++; };

// ---- the proposals
const grid = (cols, rows, town) => Array.from({ length: cols * rows }, (_, i) => {
  const col = i % cols, row = Math.floor(i / cols);
  return { msoa_code: `M${i}`, place_name: `Place ${i}`, lat: 52 + row * 0.05, lng: -1 + col * 0.08, rural: 0, adults: 6000, aged_16_34: 1200 + col * 100, aged_65_plus: 1500 - col * 50, households: 2500, households_no_car: 300 + row * 40, workers: 3000, drive: 1600, walk_cycle: 300, bus_train: 100, imd_people: 6000, people_most_deprived_20pct: 0, town_code: town ? town(col, row) : "" };
});
const town = (code, col, row, people) => ({ town_code: code, town_name: code, lat: 52 + row * 0.05, lng: -1 + col * 0.08, people });
const nearest = (col, row) => (col < 3 ? (row < 3 ? "North" : "South") : row < 3 ? "East" : "West");
const shapes = [];
let pack = t.packFrom("Testshire", grid(6, 6, nearest), [town("North", 1, 1, 90000), town("East", 4, 1, 60000), town("South", 1, 4, 40000), town("West", 4, 4, 30000), town("Middle", 2.5, 2.5, 20000), town("Edge", 5, 5, 15000), town("Tiny", 0, 5, 2000)], shapes, false);
ok(pack.ready && pack.hoods.length === 36 && pack.measures.length === 7 && pack.adults === 216000, "a pack holds every neighbourhood and the seven measures");
ok(pack.towns.every((x) => x.people >= 7000) && pack.towns.length === 6, "a town too small for 30 interviews isn't offered");
for (const n of [3, 4, 5, 6]) ok(pack.proposals[n].length === n && new Set(pack.proposals[n]).size === n && pack.proposals[n][0] === 0, `${n} sites are proposed, with the largest town first and no repeats`);
const four = t.standFor(pack, pack.proposals[4], 30);
ok(Math.abs(four.reduce((sum, x) => sum + x.share, 0) - 100) < 0.5, "the sites' shares of adults add up to everyone");
ok(four.every((x) => x.ages.length === 3 && x.ages.reduce((sum, n) => sum + n, 0) === 30), "each site's age targets add up to the people asked there");
ok(new Set(pack.proposals[4].map((i) => pack.towns[i].name)).size === 4 && pack.proposals[4].map((i) => pack.towns[i].name).join() === t.packFrom("Testshire", grid(6, 6, nearest), [town("North", 1, 1, 90000), town("East", 4, 1, 60000), town("South", 1, 4, 40000), town("West", 4, 4, 30000), town("Middle", 2.5, 2.5, 20000), town("Edge", 5, 5, 15000), town("Tiny", 0, 5, 2000)], [], false).proposals[4].map((i) => pack.towns[i].name).join(), "the same figures always give the same proposal");
ok(t.ageTargets(20, 30, 30).join() === "6,15,9" && t.ageTargets(33.4, 33.3, 40).reduce((sum, n) => sum + n, 0) === 40, "age targets round to whole people without losing anyone");

const close = t.packFrom("Crowded", grid(6, 6, nearest), [town("Big", 2.5, 2.5, 90000), town("Suburb", 2.8, 2.5, 30000), town("Satellite", 3.5, 2.5, 8000), town("Far", 0, 0, 20000), town("Other", 5, 5, 20000), town("Third", 0, 5, 20000), town("Fourth", 5, 0, 20000)], [], false);
const proposed = (close.proposals[6] ?? []).map((i) => close.towns[i].name);
ok(!proposed.includes("Suburb") && !proposed.includes("Satellite") && close.towns.some((x) => x.name === "Suburb"), "a place on the edge of a town isn't proposed as well, but can still be picked by hand");

const city = t.packFrom("One City", grid(5, 5, () => "City"), [town("City", 2, 2, 500000)], [], false);
ok(city.towns.length > 5 && city.towns.slice(1).every((x) => /^Place/.test(x.name)) && city.proposals[4].length === 4, "where one town is the whole authority, its neighbourhoods are offered instead");
const tiny = t.packFrom("Tiny", grid(2, 2), [town("Only", 0, 0, 4000)], [], false);
ok(tiny.towns.length >= 2 && Object.keys(tiny.proposals).length >= 1, "a very small authority still gets a proposal");
const spill = t.packFrom("Spill", grid(4, 4, (col) => (col === 0 ? "Bigcity" : "")), [{ town_code: "Bigcity", town_name: "Bigcity", lat: 52, lng: -2, people: 40000 }, town("A", 2, 2, 9000), town("B", 3, 0, 9000), town("C", 3, 3, 9000), town("D", 1, 3, 9000), town("E", 2, 0, 9000)], [], false);
ok(spill.towns[0].lng > -1.1, "a town spilling over the boundary has its site in the part that's inside");

// ---- weighting by site
const row = (n, site) => ({ n, form: String(n), via: "paper", site, secs: null, answers: {}, topics: {}, clean: {}, checked: {} });
const replies = [...Array.from({ length: 30 }, (_, i) => row(i + 1, "Big")), ...Array.from({ length: 30 }, (_, i) => row(i + 31, "Small")), row(61, "By hand")];
const sum = (w, list) => list.reduce((x, r) => x + w.get(r.n), 0);
let w = t.weightsFor(replies, null, [{ name: "Big", when: "", interviewers: "", share: 75 }, { name: "Small", when: "", interviewers: "", share: 25 }, { name: "By hand", when: "", interviewers: "" }]);
ok(w.bySite && !w.weighted && Math.abs(sum(w.weights, replies.slice(0, 30)) / sum(w.weights, replies.slice(30, 60)) - 3) < 0.01, "each site counts for the share of adults it stands for, however many were asked there");
ok(w.weights.get(61) === 1, "a site added by hand is left as it is");
ok(!t.weightsFor(replies, null, []).bySite && !t.weightsFor(replies.slice(0, 30), null, [{ name: "Big", when: "", interviewers: "", share: 75 }, { name: "Small", when: "", interviewers: "", share: 25 }]).bySite, "no shares, or only one site heard from, means no weighting by site");
w = t.weightsFor(replies, null, [{ name: "Big", when: "", interviewers: "", share: 99.9 }, { name: "Small", when: "", interviewers: "", share: 0.1 }]);
ok(Math.max(...w.weights.values()) <= 5, "no one counts for more than five people");

w = t.weightsFor(replies.map((r) => ({ ...r, site: r.site.toUpperCase() + " " })), null, [{ name: "Big", when: "", interviewers: "", share: 75 }, { name: "Small", when: "", interviewers: "", share: 25 }]);
ok(w.bySite, "a site typed in different capitals still counts as that site");
// age and sex stay balanced: the young are all at one site, and the older people mostly at the other
const person = (n, site, a1, a2) => ({ ...row(n, site), answers: { a1, a2 } });
const mixed = [...Array.from({ length: 40 }, (_, i) => person(i + 1, "Big", "16 to 24", "Female")), ...Array.from({ length: 10 }, (_, i) => person(i + 41, "Big", "65 to 74", "Female")), ...Array.from({ length: 10 }, (_, i) => person(i + 51, "Small", "16 to 24", "Female")), ...Array.from({ length: 40 }, (_, i) => person(i + 61, "Small", "65 to 74", "Female"))];
const people = { cells: { "16 to 24|Female": 500, "65 to 74|Female": 500 }, adults: 1000 };
w = t.weightsFor(mixed, people, [{ name: "Big", when: "", interviewers: "", share: 70 }, { name: "Small", when: "", interviewers: "", share: 30 }]);
const all = sum(w.weights, mixed), young = sum(w.weights, mixed.filter((r) => r.answers.a1 === "16 to 24")), big = sum(w.weights, mixed.filter((r) => r.site === "Big"));
ok(w.weighted && w.bySite && Math.abs(young / all - 0.5) < 0.02 && Math.abs(big / all - 0.7) < 0.02, "and both the sites and the balance of age and sex come out right");

// ---- odd authorities
const fine = (cols, rows, step) => Array.from({ length: cols * rows }, (_, i) => ({ ...grid(1, 1)[0], msoa_code: `C${i}`, place_name: `Spot ${i}`, lat: 52 + Math.floor(i / cols) * step, lng: -1 + (i % cols) * step * 1.6, aged_16_34: 1000 + (i % 7) * 200, town_code: "Bigcity" }));
const compact = t.packFrom("Compact City", fine(6, 6, 0.012), [{ town_code: "Bigcity", town_name: "Bigcity", lat: 52.03, lng: -0.95, people: 300000 }], [], false);
ok(compact.proposals[4]?.length === 4, "a compact city still gets a full set of sites");
ok(Object.entries(t.packFrom("Small", grid(3, 1), [town("A", 0, 0, 12000), town("B", 2, 0, 9000)], [], false).proposals).every(([size, list]) => Number(size) === list.length), "a small authority isn't offered sizes it can't fill");
const gaps = t.packFrom("Gaps", [...grid(4, 4), { ...grid(1, 1)[0], msoa_code: "X", lat: null, lng: null }], [town("A", 1, 1, 20000), town("A", 2, 2, 15000), town("B", 3, 3, 12000), town("C", 0, 3, 12000), town("D", 3, 0, 12000), town("E", 2, 0, 12000), town("F", 0, 0, 12000)], [], false);
ok(gaps.hoods.length === 16, "a neighbourhood with no location is left off the map, not put at nought degrees");
ok(gaps.towns.filter((x) => x.name === "A").length === 1, "and two places with the same name are offered once");

// ---- through the API
const WSX = "E10000032", KIRK = "E08000034";
await addUser(1, "lead@westsussex.gov.uk", "Lee Lead", 30, "lead");
await addUser(2, "member@westsussex.gov.uk", "Mo Member", 30, "member");
await addUser(3, "officer@kirklees.gov.uk", "Kit Officer", 20, "lead");
const api = async (path, body, token) => { const r = await handleRequest(new Request(`https://clarion.test${path}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { "x-session-token": token } : {}) }, body: JSON.stringify(body) })); return { status: r.status, headers: r.headers, ...(await r.json()) }; };
const login = async (email) => (await api("/api/login", { email, password: "pw" })).token;
const leadToken = await login("lead@westsussex.gov.uk"), memberToken = await login("member@westsussex.gov.uk"), kirkToken = await login("officer@kirklees.gov.uk");

let r = await api("/api/survey/sites", { code: WSX }, null);
ok(r.status === 401, "survey sites need a sign-in");
r = await api("/api/survey/sites", { code: WSX }, memberToken);
ok(r.status === 200 && r.ready === true, "and anyone from the authority can plan a survey");
r = await api("/api/survey/sites", { code: WSX }, kirkToken);
ok(r.status === 403 || r.status === 404, "and only for your own authority");
r = await api("/api/survey/sites", { code: WSX }, leadToken);
ok(r.status === 200 && r.ready === true && r.tiles === true && r.towns[0].name === "Testhaven" && r.proposals[4].length === 4 && r.shapes.length === r.hoods.length, "the lead gets the neighbourhoods, the towns and the proposals");
ok(lib.queries.some((q) => /FROM neighbourhoods/.test(q.sql) && q.args?.[0] === WSX), "from the data library, for that authority");
const before = lib.queries.length;
await api("/api/survey/sites", { code: WSX }, leadToken);
ok(lib.queries.length === before, "and it's kept for a day, not asked for each time");
r = await api("/api/survey/sites", { code: KIRK }, kirkToken);
ok(r.status === 200 && r.ready === false && /by hand/.test(r.why), "an authority with no figures yet is told so, and can still add sites by hand");

const made = await api("/api/survey/new", { code: WSX, title: "Autumn roads" }, leadToken);
const id = made.survey.id;
ok(made.survey.plan.target === 120 && made.survey.plan.by === "sites" && made.survey.plan.sure === 90 && made.survey.plan.margin === 10 && made.survey.plan.perSite === 30, "a new survey starts as a site survey of 120");
r = await api("/api/survey/save", { code: WSX, id, plan: { target: 120, checks: [], sure: 91, margin: 4, by: "everywhere", perSite: 3, perHour: 900, sites: [
  { name: "Testhaven", when: "Saturday", interviewers: "2", share: 40.5, ages: [9, 13, 8], lat: 50.9, lng: -0.8, secret: "x" },
  { name: "Seaton", when: "", interviewers: "", share: 400, ages: [1, 2], lat: 10, lng: 300 },
  { name: "", when: "no name", interviewers: "" },
] } }, leadToken);
const saved = (await api("/api/survey/get", { code: WSX, id }, leadToken)).survey;
ok(saved.plan.sites.length === 2 && saved.plan.sites[0].share === 40.5 && saved.plan.sites[0].ages.join() === "9,13,8" && saved.plan.sites[0].lat === 50.9 && !("secret" in saved.plan.sites[0]), "a site keeps its share, age targets and place");
ok(!("share" in saved.plan.sites[1]) && !("ages" in saved.plan.sites[1]) && !("lat" in saved.plan.sites[1]), "and impossible figures are dropped");
ok(saved.plan.sure === 90 && saved.plan.margin === 10 && saved.plan.by === "sites" && saved.plan.perSite === 30 && saved.plan.perHour === 8, "and so are impossible settings");

r = await api("/api/survey/save", { code: WSX, id, plan: { target: 21015, sites: saved.plan.sites, checks: [] } }, leadToken);
ok(r.status === 400 && /5,000/.test(r.error), "an aim too large to hold is refused, not quietly ignored");

await api("/api/survey/status", { code: WSX, id, status: "open" }, leadToken);
const access = (await api("/api/survey/get", { code: WSX, id }, leadToken)).survey.access;
r = await api("/api/s/get", { access });
ok(r.survey.sites.join() === "Testhaven,Seaton" && !JSON.stringify(r).includes("40.5"), "a tablet gets the site names and nothing else about them");

await api("/api/survey/status", { code: WSX, id, status: "closed" }, leadToken);
r = await api("/api/survey/save", { code: WSX, id, plan: { target: 200, checks: [], sites: [{ name: "Elsewhere", when: "", interviewers: "", share: 90 }] } }, leadToken);
const shut = (await api("/api/survey/get", { code: WSX, id }, leadToken)).survey;
ok(r.status === 200 && shut.plan.sites.map((x) => x.name).join() === "Testhaven,Seaton" && shut.plan.target === 200, "a closed survey's sites are fixed, so its results can't shift");

const page = await handleRequest(new Request("https://clarion.test/", { method: "GET" }));
const csp = page.headers.get("content-security-policy");
ok(/img-src[^;]*https:\/\/tile\.openstreetmap\.org/.test(csp) && !/default-src[^;]*openstreetmap/.test(csp) && !/connect-src[^;]*openstreetmap/.test(csp), "the page may load map pictures from the street map, and nothing else from it");

process.exit(failures ? 1 : 0);
