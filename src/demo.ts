// The Northbridge demonstration, at /demo. Northbridge is fictional and everything here is made up: no account, no
// calls to Claude, and nothing saved. It's one file of data for the page, which reads it in place of the API.
// Survey replies come from a seeded simulation and go through the same calculations as a real survey, so the
// demonstration can't drift from how Clarion works. Links are left blank, so nothing points at a made-up site.

import { packFrom, standFor, type SitesPack } from "./sites";
import { ABOUT, ACCESS_CHECKS, CORE, answersCsv, cellKey, summarise, surveyPage, type Answer, type Census, type Question, type Site, type Survey } from "./surveys";
import { cached } from "./util";

export const DEMO_CODE = "NORTHBRIDGE";
const NAME = "Northbridge";
const COUNCIL = "Northbridge Council";
const WHEN = "2026-10-30T09:00:00.000Z";

// The same seed gives the same replies every time, so the demonstration's figures don't move
function randomiser(seed: number) {
  let a = seed;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T>(options: T[], weights: number[]): T => {
    let left = next() * weights.reduce((x, y) => x + y, 0);
    for (let i = 0; i < options.length; i++) { left -= weights[i]; if (left <= 0) return options[i]; }
    return options[options.length - 1];
  };
  return { next, pick };
}

const AGE_SHARES: [string, number][] = [["16 to 24", 13], ["25 to 34", 15], ["35 to 44", 15], ["45 to 54", 16], ["55 to 64", 16], ["65 to 74", 13], ["75 or over", 12]];
const ADULTS = 312000;
const census: Census = {
  adults: ADULTS,
  cells: Object.fromEntries(AGE_SHARES.flatMap(([age, share]) => [[cellKey(age, "Female"), Math.round((ADULTS * share * 0.51) / 100)], [cellKey(age, "Male"), Math.round((ADULTS * share * 0.49) / 100)]])),
};

const LOCALS: Question[] = [
  { id: "l1", part: "local", kind: "choice", text: "Have you heard about the closure of the Relief Road?", options: ["Yes, and it has affected me", "Yes, but it hasn't affected me", "No", "Don't know"] },
  { id: "l2", part: "local", kind: "choice", text: "How would you rate the condition of the pavements near where you live?", options: ["Very good", "Fairly good", "Fairly poor", "Very poor", "Don't know"] },
];

// A made-up place: a rough grid of neighbourhoods around made-up towns, out at sea so it can't land on a real one,
// run through the same calculations as a real authority. There's no street map under it.
const TOWNS: [string, number, number, number][] = [
  ["Northbridge", 3, 3, 96000], ["Moorside", 1, 1, 21000], ["Dalecross", 6, 1, 26000], ["Kingsmere", 6, 5, 18000], ["Ashvale", 1, 5, 12000], ["Fernley", 4, 0, 9000], ["Thornbeck", 0, 3, 8000], ["Oakhurst", 4, 6, 7500],
];
const place = (col: number, row: number): [number, number] => [2.4 + col * 0.05, 54.4 + row * 0.03];
function demoSites(): SitesPack {
  const r = randomiser(20261103);
  const hoods: Record<string, any>[] = [], shapes: { key: string; rings: number[][][] }[] = [];
  for (let col = 0; col < 8; col++) for (let row = 0; row < 7; row++) {
    if ((col === 0 || col === 7) && (row === 0 || row === 6)) continue; // no square corners
    const [lng, lat] = place(col, row);
    const near = TOWNS.map((t) => ({ name: t[0], d: Math.hypot(t[1] - col, t[2] - row), size: t[3] })).sort((a, b) => a.d - b.d)[0];
    const town = near.d < 1.2, big = near.name === "Northbridge" && town, adults = town ? 7000 + Math.floor(r.next() * 2500) : 4500 + Math.floor(r.next() * 2000);
    const older = (town ? 0.2 : 0.3) + r.next() * 0.08, younger = (big ? 0.34 : town ? 0.26 : 0.19) + r.next() * 0.05;
    const households = Math.round(adults / 1.9), workers = Math.round(adults * 0.55), driving = (big ? 0.45 : town ? 0.55 : 0.65) + r.next() * 0.05, walking = big ? 0.16 : town ? 0.11 : 0.06;
    const key = `N${String(hoods.length).padStart(3, "0")}`;
    hoods.push({
      msoa_code: key, msoa_name: `Northbridge ${key.slice(1)}`, place_name: "", lat, lng, rural: town ? 0 : 1, adults, aged_16_34: Math.round(adults * younger), aged_65_plus: Math.round(adults * older),
      households, households_no_car: Math.round(households * ((big ? 0.3 : town ? 0.2 : 0.09) + r.next() * 0.05)), workers, drive: Math.round(workers * driving), walk_cycle: Math.round(workers * walking), bus_train: Math.round(workers * (big ? 0.08 : 0.03)),
      imd_people: adults, people_most_deprived_20pct: Math.round(adults * (big ? 0.3 + r.next() * 0.2 : town ? r.next() * 0.2 : 0)), town_code: town ? near.name : "",
    });
    const x = 0.025, y = 0.015;
    shapes.push({ key, rings: [[[lng - x, lat - y], [lng + x, lat - y], [lng + x, lat + y], [lng - x, lat + y], [lng - x, lat - y]]] });
  }
  const towns = TOWNS.map(([name, col, row, people]) => { const [lng, lat] = place(col, row); return { town_code: name, town_name: name, lat, lng, people }; });
  return packFrom(COUNCIL, hoods, towns, shapes, false);
}
const SITE_PACK = demoSites();
const SPOTS = [["Market Square, Saturdays 10am to 2pm", "2"], ["Station Approach, weekdays 7am to 9am", "2"], ["Riverside Retail Park, Sundays 11am to 3pm", "2"], ["The library, Tuesdays 10am to 1pm", "1"]];
const SITES: Site[] = standFor(SITE_PACK, SITE_PACK.proposals[4], 30).map((x, i) => ({
  name: x.town.name, when: SPOTS[i][0], interviewers: SPOTS[i][1], share: x.share, ages: x.ages, lat: x.town.lat, lng: x.town.lng,
}));

// In order of public concern: the demonstration ranks topics by how often people raise them, as Clarion will
const COMMENTS: [string, string][] = [
  ["Potholes", "The holes on Bridge Street get filled and open up again within weeks."],
  ["Potholes", "Burst a tyre on Moor Lane in September. Nothing has been done since."],
  ["Potholes", "Too many potholes on the way into town."],
  ["Potholes", "Heard about the extra money but I haven't seen any difference on my road."],
  ["Potholes", "Cycling on Station Road is dangerous because of the holes near the kerb."],
  ["Potholes", "The patching on Mill Hill is poor quality."],
  ["Potholes", "A hole outside [removed] has been there since last winter."],
  ["Potholes", "Saw a crew on the High Street last month, which was good to see."],
  ["Potholes", "Road surfaces have got much worse in the last two years."],
  ["Potholes", "Why do they only repair part of the road?"],
  ["Pavements", "The pavement by the school on Church Lane is broken up and uneven."],
  ["Pavements", "My mother fell on the slabs on Albert Road."],
  ["Pavements", "Hard to use a wheelchair along Queen Street because of the tree roots."],
  ["Pavements", "Nobody talks about pavements, but they're in a worse state than the roads."],
  ["Pavements", "Slabs lifting all along Victoria Terrace."],
  ["Pavements", "I walk everywhere and the footways round here are a trip hazard."],
  ["Pavements", "Pavement outside the shops on Park Road needs redoing."],
  ["Flooding on minor roads", "Water sits across Beck Lane for days after rain."],
  ["Flooding on minor roads", "The road under the railway floods every time it rains hard."],
  ["Flooding on minor roads", "The drains on Ings Road are blocked and nobody clears them."],
  ["Flooding on minor roads", "Had to turn back at Low Green twice this month because of water."],
  ["Flooding on minor roads", "The bottom of Carr Lane is under water most winters now."],
  ["Flooding on minor roads", "Gullies on the back roads never get cleaned."],
  ["Roadworks information", "Roadworks appear with no warning and no idea how long they'll last."],
  ["Roadworks information", "Signs said closed but nobody was working there for a fortnight."],
  ["Roadworks information", "I'd like to know what's planned before the diversions start."],
  ["Roadworks information", "The council website never has the right dates."],
  ["Speed limits", "The 20 limit on Moorside Road is ignored."],
  ["Speed limits", "Cars come too fast past the primary school."],
  ["Speed limits", "Too many changes in the speed limit on the ring road."],
  ["Relief Road closure", "The Relief Road closure has added half an hour to my commute."],
  ["Relief Road closure", "Traffic through the village has been terrible since the Relief Road shut."],
  ["Relief Road closure", "When will the Relief Road reopen?"],
  ["Street lighting", "It's very dark on Hall Lane since the lights went off at midnight."],
  ["Street lighting", "I don't feel safe walking home after the lights go out."],
  ["Parking", "People park on the pavement on Mill Street and block it."],
];

// How often each topic appears in press and sector coverage over the four weeks
const COVERAGE: [string, number, string][] = [
  ["Potholes", 58, "Street survey, fault reports, press"], ["Relief Road closure", 41, "Press"], ["Street lighting", 28, "Press, petition"], ["Roadworks information", 21, "Street survey, press"],
  ["Speed limits", 16, "Press, MPs' questions"], ["Parking", 12, "Press"], ["Pavements", 6, "Street survey, fault reports"], ["Flooding on minor roads", 4, "Street survey"],
];

function replies(): Answer[] {
  const r = randomiser(20261030);
  const q = (id: string) => [...CORE, ...LOCALS, ...ABOUT].find((x) => x.id === id) as Question;
  const said = (id: string, weights: number[]) => r.pick(q(id).options, weights);
  const out: Answer[] = [];
  for (let n = 1; n <= 412; n++) {
    const tablet = n % 5 < 3;
    const answers: Record<string, string> = {
      c1: said("c1", [5, 24, 20, 28, 20, 3]), c2: said("c2", [12, 36, 46, 6]), c4: said("c4", [58, 14, 8, 10, 10]), l1: said("l1", [18, 34, 44, 4]), l2: said("l2", [6, 31, 38, 20, 5]),
      a1: r.pick(AGE_SHARES.map((x) => x[0]), [8, 10, 12, 16, 18, 19, 17]), a2: said("a2", [54, 44, 2]), a3: said("a3", [66, 13, 15, 3, 3]), a4: said("a4", [17, 78, 5]),
    };
    const comment = COMMENTS[n / 11 - 1]; // every eleventh person left a comment
    const topics: Record<string, string> = {}, clean: Record<string, boolean> = {}, checked: Record<string, boolean> = {};
    if (n % 11 === 0 && comment) { answers.c3 = comment[1]; topics.c3 = comment[0]; clean.c3 = true; checked.c3 = n % 110 === 0; }
    out.push({ n, form: tablet ? `T${n}` : String(n), via: tablet ? "tablet" : "paper", site: SITES[Math.floor(r.next() * SITES.length)].name, at: "2026-10-20T10:00:00.000Z", secs: tablet ? 120 + Math.floor(r.next() * 180) : null, answers, topics, clean, checked });
  }
  return out;
}

const survey = (over: Partial<Survey>): Survey => ({
  id: "", code: DEMO_CODE, title: "", purpose: "", status: "draft", access: "", collector: COUNCIL, locals: [], plan: { target: 400, sites: SITES, checks: [...ACCESS_CHECKS], sure: 95, margin: 5, by: "whole", perSite: 30, perHour: 8 },
  created: WHEN, by: "Demo officer", updated: WHEN, openedBy: "", openedOn: "", closedOn: "", printedTo: 0, ...over,
});

// Where a topic sits, from its two ranks. The upper half of each ranking counts as high.
function placeTopic(concern: number, attention: number, count: number): { early: boolean; action: string } {
  const felt = concern <= count / 2, loud = attention <= count / 2;
  return { early: felt && !loud, action: felt && loud ? "Act, and be seen to" : felt ? "Look into it early" : loud ? "Answer it, but don't over-react" : "Keep watching" };
}

export function buildPack() {
  const rows = replies();
  const autumn = survey({
    id: "20261001090000000-de000001", title: "Autumn roads survey", purpose: "How people feel about the state of the roads, and whether the Relief Road closure and the extra pothole money have reached them.",
    status: "closed", locals: LOCALS, openedBy: "Demo officer", openedOn: "2026-10-03", closedOn: "2026-10-24", printedTo: 450,
  });
  const winter = survey({ id: "20261028090000000-de000002", title: "Winter roads survey", purpose: "Whether people have noticed more pothole repairs, and how much pavements and flooding matter to them." });
  const pages = { [autumn.id]: surveyPage(autumn, rows, census, true, true, 4), [winter.id]: surveyPage(winter, [], census, true, true, 4) };
  const street = summarise(autumn, rows, census);
  const counted = new Map<string, number>();
  for (const [topic] of COMMENTS) counted.set(topic, (counted.get(topic) || 0) + 1);
  const byConcern = [...counted.entries()].sort((a, b) => b[1] - a[1]).map((x) => x[0]);
  const topics = COVERAGE.map(([topic, items, kinds], i) => {
    const concern = byConcern.indexOf(topic) + 1;
    return { topic, items, kinds, attention: i + 1, concern, replies: counted.get(topic) || 0, ...placeTopic(concern, i + 1, COVERAGE.length) };
  }).sort((a, b) => a.concern - b.concern);
  const reading = {
    id: "20261030090000000-de000003", code: DEMO_CODE, status: "ready", stage: "Ready", created: WHEN, updated: WHEN, by: "Demo officer",
    headline: "People are less satisfied with their roads than a year ago. Potholes are the main worry, and pavements and flooding matter more than the coverage suggests.",
    level: "Condition of highways scored 29 out of 100.", levelBasis: "Residents' survey 2025", direction: "Worsening", directionNote: "", confidence: "Moderate",
    confidenceReason: "A street survey and public fault reports agree, but a street sample isn't random and press coverage is led by a few stories.",
    drivers: [{ theme: "Potholes", evidence: "Raised most often in the street survey, and most fault reports are about them.", kind: "street survey" }, { theme: "Pavements", evidence: "Second in the street survey, and rising in fault reports, with little coverage.", kind: "actions" }, { theme: "Flooding on minor roads", evidence: "Third in the street survey, named by people on the same few roads.", kind: "street survey" }],
    gaps: ["Fault report counts by category and month"], nextSteps: ["Ask about pavements on their own in the next street survey", "Check the flooding reports against drainage records"], cost: 0,
  };
  const note = {
    id: "20261012090000000-de000004", code: DEMO_CODE, status: "ready", stage: "Ready", created: "2026-10-12T09:00:00.000Z", updated: "2026-10-12T09:00:00.000Z", by: "Demo officer", input: { url: "", title: "", hasText: false },
    change: {
      title: "£4.2m extra for pothole repairs", summary: "The council has announced £4.2m for pothole repairs over two years, with a promise of faster repairs.", instrument: "Funding", announcedBy: COUNCIL, announced: "2026-10-06", amount: "£4.2m", publicMessage: "Faster repairs across Northbridge.", primaryFound: true,
      deadlines: [{ date: "2027-03-31", what: "First £2.1m to be spent" }], conditions: ["Report progress to the cabinet each quarter"], disagreements: [], named: [], sources: [{ url: "", title: "Council press release (made up)", kind: "Primary" }],
    },
    headline: "The extra money raises expectations faster than repairs can meet them.", whyHere: "Many Northbridge residents already say roads are getting worse, so a promise of faster repairs will be judged on their own street.",
    impacts: [{ route: "Reputation", statement: "People may judge the promise on their own street before the work reaches it.", direction: "Worse", size: "Moderate", likelihood: "Likely", confidence: "Moderate", confidenceReason: "Survey answers point this way.", when: "Next 6 months", basis: "Street survey", working: "", action: "Publish where the first repairs will be.", owner: "Communications lead", checkDate: "2027-04-01", challenge: "Stands up." }],
    cut: [], mood: { promise: "Faster repairs", localExperience: "Many say roads have got worse", gap: "Large", likelyReaction: "Not on my road", confidence: "Moderate", surveyQuestion: "Over the past year, have potholes near you been repaired faster, slower or about the same?" },
    questions: ["When will my road be repaired?"], unknowns: ["How much of the £4.2m is new money"], dataUsed: [], cost: 0,
  };
  return {
    status: { user: { name: "Demo viewer", email: "", authority: COUNCIL, siteAdmin: false }, authorities: [{ code: DEMO_CODE, name: NAME }] },
    authority: {
      authority: {
        code: DEMO_CODE, name: NAME, kind: "Unitary authority", strategicAuthority: "", fundingRoute: "DfT pays Northbridge directly: £14.6m for 2026/27 in this made-up example.",
        rating: { overall: "Amber", condition: "Amber", spend: "Green", bestPractice: "Amber", published: "January 2026", url: "" }, reportingRoute: "Fault reports reach the council through its own website and FixMyStreet.", surveyNote: "", fixMyStreetUrl: "", constituencies: [{ name: "Northbridge North" }, { name: "Northbridge South" }, { name: "Dale Valley" }, { name: "Moorside" }],
      },
      evidence: {
        figures: {
          authority: { name: NAME, region: "Made-up region", kind: "Unitary authority" },
          condition: [{ roadClass: "A", fye: 2026, value: 3.1, region: 3.8, england: 3.4, earlier: { fye: 2022, value: 2.7 } }, { roadClass: "B and C", fye: 2026, value: 6.2, region: 5.9, england: 5.6, earlier: { fye: 2022, value: 5.8 } }, { roadClass: "Unclassified", fye: 2026, value: 17.4, region: 16.1, england: 16.8, earlier: { fye: 2022, value: 15.9 } }],
          treatment: [], roadLength: { year: 2024, km: 2840 }, traffic: { year: 2025, changePct: 3.2, sinceYear: 2019 }, seriousCollisions: [{ year: 2024, count: 142 }], allocations: [{ authority: NAME, pot: "Total", years: "2026 to 2027", amount: 14600000, note: "" }], unavailable: [],
          sources: [{ title: "Made-up figures for the demonstration", attribution: "None of these are real.", sourceDate: "" }],
        },
        signals: {
          fixMyStreet: { ok: true, source: "FixMyStreet", url: "", note: "", data: { reports: 64, from: "2026-10-03", to: "2026-10-30", perDay: 2.4, categories: [{ name: "Potholes", count: 31 }, { name: "Pavements", count: 17 }, { name: "Drainage", count: 9 }, { name: "Street lighting", count: 7 }], busiestSquare: 2 } },
          petitions: { ok: true, source: "Parliament petitions", url: "", note: "", data: [{ title: "Keep the lights on at night in Northbridge", url: "", signatures: 1840, local: 1520, localShare: 82.6, fairShare: 0.5 }] },
          questions: { ok: true, source: "MPs' written questions", url: "", note: "", data: [{ date: "2026-10-09", heading: "Roads: Northbridge", member: "The MP for Dale Valley", text: "", url: "" }] },
        },
        surveys: [{ year: 2025, measure: "Condition of highways", score: 29, outOf: 100, responses: 612, source: "Residents' survey 2025" }, { year: 2025, measure: "Overall satisfaction (local)", score: 46, outOf: 100, responses: 612, source: "Residents' survey 2025" }],
        streets: street ? [street] : [], gaps: ["Fault report counts by category and month"], gathered: WHEN,
      },
      facts: { notes: "", updated: "", updatedBy: "" }, canEdit: true, reading, working: null, adults: ADULTS, benchmark: { authorities: 18, satisfied: 34, worse: 41 },
    },
    noteList: [{ id: note.id, status: "ready", stage: "Ready", created: note.created, by: note.by, title: note.change.title, headline: note.headline }],
    note, announcements: [{ title: "£4.2m extra for pothole repairs", url: "", date: "2026-10-06", summary: "" }],
    surveyList: { canEdit: true, surveys: [autumn, winter].map((s) => ({ id: s.id, title: s.title, status: s.status, created: s.created, by: s.by, openedOn: s.openedOn, responses: s.id === autumn.id ? rows.length : 0, target: s.plan.target })) },
    surveys: pages, sites: SITE_PACK,
    suggestions: [
      { text: "Have you heard about the closure of the Relief Road?", kind: "choice", options: ["Yes, and it has affected me", "Yes, but it hasn't affected me", "No", "Don't know"], why: "41 items in four weeks, but nothing yet shows how many people it affects." },
      { text: "Over the past year, have potholes near you been repaired faster, slower or about the same?", kind: "choice", options: ["Faster", "About the same", "Slower", "Don't know"], why: "The council promised faster repairs. This tests whether people believe it." },
      { text: "How much does street lighting at night matter to you?", kind: "choice", options: ["A great deal", "A fair amount", "Not very much", "Not at all", "Don't know"], why: "28 items, most about one campaign. It may be a strong view held by few." },
      { text: "How would you rate the condition of the pavements near where you live?", kind: "choice", options: ["Very good", "Fairly good", "Fairly poor", "Very poor", "Don't know"], why: "Few press items, but fault reports are rising." },
    ],
    exports: { [autumn.id]: { name: "autumn-roads-survey.csv", csv: answersCsv(autumn, rows, census, true) }, [winter.id]: { name: "winter-roads-survey.csv", csv: answersCsv(winter, [], census, true) } },
    media: {
      ready: true, period: "Last 4 weeks", total: COVERAGE.reduce((n, x) => n + x[1], 0), previous: 133, topics: COVERAGE.map(([topic, items]) => ({ topic, items })),
      items: [
        { date: "2026-10-29", source: "The Northbridge Courier", title: "Relief Road closure extended into November", topic: "Relief Road closure" },
        { date: "2026-10-27", source: "Regional Roads Review", title: "Council sets out £4.2m pothole plan", topic: "Potholes" },
        { date: "2026-10-24", source: "The Northbridge Courier", title: "Campaigners call for street lights to stay on", topic: "Street lighting" },
        { date: "2026-10-21", source: "Dale Valley Gazette", title: "Residents' anger at repeat repairs on Bridge Street", topic: "Potholes" },
        { date: "2026-10-17", source: "Northbridge Radio", title: "Traffic chaos as diversions begin", topic: "Roadworks information" },
      ],
    },
    attention: { ready: true, topics, earlySigns: topics.filter((x) => x.early).map((x) => ({ topic: x.topic, concern: x.concern, attention: x.attention, why: x.topic === "Pavements" ? "Fault reports are up by a quarter." : "Named by people on the same few roads." })) },
  };
}

export const demoPack = () => cached("demo-pack", 24 * 60 * 60 * 1000, async () => JSON.stringify(buildPack()));
