// The map: everything Clarion holds on a service in a month, arranged as branches, each ending in one mood figure.
//
// Every part of the map has its own method and properties, but each gives one figure from -100 to +100, and the
// branches blend into one mood in the middle. This is all calculation, not Claude's opinion, and it holds no resident's
// words. Authorities are never ranked on it. Weather, the council's own news, published figures and replies by link
// aren't counted: they're shown as things to bear in mind for campaigns. A change in mood is only reported when two
// kinds of signal agree.
//
// The weights are a starting judgement to test in the pilot. Surveys carry the most because they set the level.

import type { Plans } from "./campaign";
import { pieceWeight, type Assessment, type Source } from "./coverage";
import type { Fn, Setup, Weights } from "./setup";
import { DEFAULT_SERVICE, SERVICES, serviceId } from "./setup";
import type { StreetPoint } from "./surveys";

export type Filters = { service: string; month: string; topic: string; bias: string; view: "authority" | "public" | "partners"; partner: string; include: string[] };
export type MapData = {
  today: string; unread: string[]; setup: Setup; weights: Weights; topics: string[]; sources: Source[]; assessments: Assessment[]; streets: StreetPoint[];
  residents: { score: number; outOf: number; year: number; source: string } | null;
  enquiries: Record<string, { total: number; byTopic: Record<string, number> }>; adults: number | null; ageAdults: number[] | null;
  monthly: Record<string, { perDay: number | null; reports: number; petitions?: { title: string; local: number; above: boolean }[]; questions?: { date: string; heading: string }[] }>; // an unread feed leaves its part out
  questions: { date: string; heading: string }[]; rated: Record<string, string>; announcements: { title: string; date: string }[];
  works: { on: boolean; weeks: { week: string; public: number; fns: Record<string, number> }[]; events: { label: string; start: string; end: string; detail?: string }[] };
  notes: { id: string; title: string; date: string; effect: number | null; topic: string; routes: string[] }[];
  posts: { title: string; date: string; topic: string }[];
  published: { name: string; here: string; region: string; england: string }[];
  plans: Plans; election: boolean; channels: { key: string; label: string; rates: number[] }[]; ages: string[];
};

type Def = { id: string; label: string; kids?: Def[]; w?: number; medium?: string; sub?: string; add?: string; types?: string[]; blend?: boolean };
const MEDIA_OF: Record<string, { medium: string; scope: string; sub?: string }> = {
  "Local Television": { medium: "tv", scope: "Local" }, "National Television": { medium: "tv", scope: "National" }, "Local Radio": { medium: "radio", scope: "Local" }, "National Radio": { medium: "radio", scope: "National" },
  "Local Newspaper": { medium: "press", scope: "Local" }, "Local News Website": { medium: "press", scope: "Local" }, "National Newspaper": { medium: "press", scope: "National" },
  "Local Newsletter": { medium: "mags", scope: "Local", sub: "Local" }, "National Magazine": { medium: "mags", scope: "National", sub: "National" }, "Trade Press": { medium: "mags", scope: "National", sub: "Specialist" },
  "Social Media": { medium: "socialm", scope: "Local" }, "Streaming Video": { medium: "video", scope: "Local" }, "Community Event": { medium: "meetings", scope: "Local" }, Other: { medium: "other", scope: "Local" },
};
export const mediaOf = (s: Pick<Source, "type">) => MEDIA_OF[s.type] ?? MEDIA_OF.Other;

const BRANCHES: Def[] = [
  { id: "surveys", label: "Surveys", blend: true, kids: [{ id: "street", label: "Street surveys", w: 3 }, { id: "residents", label: "Residents' survey", w: 2 }, { id: "bylink", label: "Replies by link", w: 0 }] },
  { id: "broadcast", label: "TV and radio", kids: [
    { id: "tv", label: "Television", medium: "tv", add: "channel", types: ["Local Television", "National Television"] },
    { id: "radio", label: "Radio", medium: "radio", add: "station", types: ["Local Radio", "National Radio"] },
  ] },
  { id: "print", label: "Press and magazines", kids: [
    { id: "press", label: "Press", medium: "press", add: "publication", types: ["Local Newspaper", "Local News Website", "National Newspaper"] },
    { id: "mags", label: "Magazines", kids: [
      { id: "mags-local", label: "Local", medium: "mags", sub: "Local", add: "magazine", types: ["Local Newsletter"] },
      { id: "mags-national", label: "National", medium: "mags", sub: "National", add: "magazine", types: ["National Magazine"] },
      { id: "mags-specialist", label: "Specialist", medium: "mags", sub: "Specialist", add: "magazine", types: ["Trade Press"] },
    ] },
    { id: "other", label: "Other sources", medium: "other", add: "source", types: ["Other"] },
  ] },
  { id: "social", label: "Social and video", kids: [
    { id: "socialm", label: "Social media", medium: "socialm", add: "channel", types: ["Social Media"] },
    { id: "video", label: "Streaming video", medium: "video", add: "channel", types: ["Streaming Video"] },
  ] },
  { id: "contact", label: "People getting in touch", blend: true, kids: [
    { id: "enquiries", label: "Enquiries and complaints", w: 3 }, { id: "faults", label: "Fault reports", w: 2 }, { id: "petitions", label: "Petitions", w: 1 }, { id: "mps", label: "MPs' questions", w: 1 },
    { id: "meetings", label: "Community meetings", w: 2, medium: "meetings", add: "meeting place", types: ["Community Event"] },
  ] },
  { id: "events", label: "Events and context", blend: true, kids: [
    { id: "gov", label: "Government announcements", w: 1 }, { id: "works", label: "Works on the network", w: 1 }, { id: "news", label: "Council news", w: 0 }, { id: "weather", label: "Weather", w: 0 }, { id: "published", label: "Published figures", w: 0 },
  ] },
];
const ROOT: Def = { id: "root", label: "", kids: BRANCHES, blend: true };
const find = (id: string, at: Def = ROOT): Def | null => { if (at.id === id) return at; for (const k of at.kids ?? []) { const f = find(id, k); if (f) return f; } return null; };
const pathToDef = (id: string, at: Def = ROOT, trail: string[] = []): string[] => { if (at.id === id) return trail; for (const k of at.kids ?? []) { const f = pathToDef(id, k, [...trail, k.id]); if (f.length) return f; } return []; };
const MEDIA_DEFS: Def[] = []; const gather = (d: Def) => { if (d.medium) MEDIA_DEFS.push(d); (d.kids ?? []).forEach(gather); }; gather(ROOT);
const hasPool = (d: Def): boolean => !!d.medium || (!d.blend && (d.kids ?? []).some(hasPool));

const METHOD: Record<string, { how: string; has: string[] }> = {
  media: { how: "An officer rates each piece. Clarion then weights it by reach and by friendliness to the authority, and gives positive minus negative as a share of all pieces. It needs 5 pieces.", has: ["Editable channels", "Local or national", "Reach", "Relevance", "Prominence", "Political leaning", "Friendliness"] },
  street: { how: "Satisfied minus dissatisfied, weighted to the local population. A street survey counts for a year.", has: ["Sites", "Sample size", "Questions by function", "Groups of 30 or more", "Messages shared"] },
  residents: { how: "A published score out of 100, moved onto the mood scale: the score minus 50, doubled.", has: ["Year", "Region and England"] },
  bylink: { how: "These people chose to reply, so this isn't counted in the mood, but it should inform campaigns.", has: ["Here or elsewhere", "Area counts of 10 or more"] },
  enquiries: { how: "The change against the three months before: doubled, turned into a mood, and capped at 40 either way. Only the direction counts.", has: ["Topic", "Area", "Route", "Counts only"] },
  faults: { how: "The change on the month before: doubled and capped at 40. It's a sample, and it also rises with bad weather and easy reporting.", has: ["Category", "A sample"] },
  petitions: { how: "Each new petition on a road topic takes 10 off, up to 40. Petitions are led by those taking part, so this carries little weight.", has: ["Count", "Local signatures"] },
  mps: { how: "Each question about roads here takes 10 off, up to 40. Names aren't used in a mood.", has: ["Count"] },
  meetings: { how: "An officer rates each meeting's tone. This stands in for word of mouth.", has: ["Officer's rating", "Topic"] },
  gov: { how: "Each impact note gives an expected effect, which an officer confirms. Its forecasts are checked on set dates.", has: ["Nine routes of impact", "Forecast", "Check date"] },
  works: { how: "Jobs reported by the public count from 30 in four weeks: the change on the four weeks before is doubled and capped at 40. Below that, it's only something to bear in mind.", has: ["Weekly totals by function", "Ward totals of 10 or more"] },
  news: { how: "Not counted in the mood, but it should inform campaigns. The council's own news page, read daily, listing posts about roads.", has: ["Road posts only"] },
  weather: { how: "Not counted in the mood, but it should inform campaigns, and it helps to explain a change in mood.", has: ["Gales", "Heavy rain", "Cold", "Freeze and thaw", "Heatwaves"] },
  published: { how: "Not counted in the mood, but they should inform campaigns. Perception is not condition, so these sit beside the mood.", has: ["DfT ratings", "Region and England"] },
};
const CHANNEL_PATHS: Record<string, string[] | null> = {
  word: ["contact", "meetings"], social: ["social", "socialm"], tv: ["broadcast", "tv"], sites: ["print", "press"], bbc: ["broadcast", "tv"], radio: ["broadcast", "radio"], print: ["print", "press"], magazines: ["print", "mags"], messaging: null, search: null, video: ["social", "video"],
};

// ----- plain helpers

export const fmtMood = (v: number | null | undefined) => (v === null || v === undefined ? "–" : v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : "0");
export const leanOf = (v: number | null | undefined) => (v === null || v === undefined ? "none" : v <= -10 ? "down" : v >= 10 ? "up" : "mixed");
export const moodWord = (v: number | null | undefined) => (v === null || v === undefined ? "too little to read" : v <= -40 ? "very negative" : v <= -10 ? "negative" : v < 10 ? "mixed" : v < 40 ? "positive" : "very positive");
const fromChange = (pct: number) => { const v = Math.round(pct * 2); return v === 0 ? 0 : -Math.max(-40, Math.min(40, v)); };
export const changeWords = (c: number) => (c > 0 ? `up ${c}%` : c < 0 ? `down ${Math.abs(c)}%` : "no change");
const mean = (l: number[]) => (l.length ? Math.round(l.reduce((a, b) => a + b, 0) / l.length) : null);
const shareOf = (part: number, whole: number) => (whole ? Math.round((100 * part) / whole) : 0);
// A source graded Small, Medium or Large with no figure counts as that band
const BAND_WEIGHT: Record<string, number> = { Small: 1, Medium: 2, Large: 3 };
const BAND_PEOPLE: Record<string, number> = { Small: 5000, Medium: 50000, Large: 200000 }; // only to put topics in order
const reachBand = (p: Row) => { const n = p.reach ?? p.src.reach; return n === null || n === undefined ? BAND_WEIGHT[p.src.reachBand] ?? 1 : n >= 100000 ? 3 : n >= 20000 ? 2 : 1; };
const peopleOf = (p: Row) => p.reach ?? p.src.reach ?? BAND_PEOPLE[p.src.reachBand] ?? 0;
// Whole percentages that add up to exactly 100
const wholeShares = (weights: number[]) => {
  const total = weights.reduce((a, b) => a + b, 0), exact = weights.map((w) => (total ? (100 * w) / total : 0)), out = exact.map(Math.floor);
  let left = total ? 100 - out.reduce((a, b) => a + b, 0) : 0;
  for (const [, i] of exact.map((e, k) => [e - out[k], k]).sort((a, b) => b[0] - a[0])) { if (left-- <= 0) break; out[i]++; }
  return out;
};
const biasGroup = (l: string) => (/left/i.test(l) ? "left" : /right/i.test(l) ? "right" : l === "Centre" ? "centre" : "none");
const toneOf = (a: Pick<Assessment, "tone">) => (a.tone === "Critical" ? -1 : a.tone === "Supportive" ? 1 : 0);
const MIN_PIECES = 5;
const MIN_CONTACTS = 30;
const MIN_JOBS = 30;
const SURVEY_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

export const shiftMonth = (month: string, by: number) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + by, 1)).toISOString().slice(0, 7);
const monthName = (month: string) => new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-15T12:00:00Z`));
const lastDay = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
export const defaultMonth = (today: string) => shiftMonth(today.slice(0, 7), -1);
export function monthsFor(today: string): { id: string; label: string }[] {
  const now = today.slice(0, 7);
  return [{ id: now, label: "So far this month" }, ...[1, 2, 3, 4, 5, 6].map((n) => { const id = shiftMonth(now, -n); return { id, label: monthName(id) }; })];
}
export function readFilters(b: any, today: string, topics: string[]): Filters {
  const month = /^\d{4}-\d{2}$/.test(String(b?.month ?? "")) && monthsFor(today).some((m) => m.id === b.month) ? b.month : defaultMonth(today);
  const view = b?.view === "public" || b?.view === "partners" ? b.view : "authority";
  return {
    service: serviceId(b?.service), month, topic: topics.includes(b?.topic) ? b.topic : "all", bias: ["left", "centre", "right", "none"].includes(b?.bias) ? b.bias : "all", view,
    partner: typeof b?.partner === "string" ? b.partner : "", include: Array.isArray(b?.include) ? b.include.filter((x: unknown) => typeof x === "string").slice(0, 12) : [],
  };
}

// ----- working out one figure

type Ctx = { d: MapData; f: Filters; byId: Map<string, Source> };
type Row = Assessment & { src: Source };
type Mood = { v: number | null; ctx?: boolean; txt: string; unit: string; lean: string; word: string; tip: string; raw?: number | null; n?: number };

function piecesFor(x: Ctx, o: { month?: string; anyTopic?: boolean; allAbout?: boolean; anyBias?: boolean } = {}): Row[] {
  const month = o.month ?? x.f.month, partner = x.f.partner;
  return x.d.assessments.flatMap((a) => {
    const src = x.byId.get(a.source);
    if (!src || a.relevance === "None" || (a.service ?? DEFAULT_SERVICE) !== x.f.service || a.date.slice(0, 7) !== month) return [];
    if (x.f.topic !== "all" && !o.anyTopic && a.topic !== x.f.topic) return [];
    if (o.allAbout) return [{ ...a, src }];
    if (!o.anyBias && x.f.bias !== "all" && biasGroup(src.leaning) !== x.f.bias) return [];
    const about = x.d.setup.partners.some((q) => q.id === a.about) ? a.about ?? "" : ""; // a partner taken out of Set-up keeps nothing apart
    if (x.f.view === "partners") return about && about === partner ? [{ ...a, src }] : [];
    return !about || x.f.include.includes(about) ? [{ ...a, src }] : [];
  });
}
function scoreOf(list: Row[], least = MIN_PIECES) {
  let rawTop = 0, rawAll = 0, adjTop = 0, adjAll = 0;
  for (const p of list) {
    const w = reachBand(p), a = w * pieceWeight(p.src, p).factor, t = toneOf(p);
    rawTop += w * t; rawAll += w; adjTop += a * t; adjAll += a;
  }
  const enough = list.length >= least && rawAll > 0;
  return { n: list.length, raw: enough ? Math.round((100 * rawTop) / rawAll) : null, adj: enough ? Math.round((100 * adjTop) / adjAll) : null };
}
const inDef = (s: Source, d: Def): boolean => {
  const m = mediaOf(s);
  if (d.medium) return m.medium === d.medium && (!d.sub || m.sub === d.sub);
  return (d.kids ?? []).some((k) => inDef(s, k));
};
const NONE: Mood = { v: null, txt: "–", unit: "", lean: "none", word: moodWord(null), tip: "Nothing held yet" };
const show = (v: number, unit = "", tip = ""): Mood => ({ v, txt: fmtMood(v), unit, lean: leanOf(v), word: moodWord(v), tip });
const context = (n: number, unit: string, tip = "It informs campaigns, and isn't counted in the mood"): Mood => ({ v: null, ctx: true, txt: String(n), unit, lean: n ? "ctx" : "none", word: "informs campaigns", tip });

/** Which functions pull most on public opinion. A piece with no function chosen is about the service overall, so it counts for none of them.
 *  Three signals, each a function's share of the service's total: coverage weighted by reach and leaning critical, dissatisfied replies
 *  in the street survey, and jobs logged by function in the four weeks to the month's end. The pull is the average of the shares that
 *  have anything, so a function nobody has written about can still pull through the survey. A calculation on counts, not Claude's opinion. */
function functionRows(x: Ctx, fns: Fn[]) {
  const pieces = piecesFor(x, { allAbout: false }), street = streetFor(x, x.f.month), end = lastDay(x.f.month);
  const from = new Date(Date.parse(`${end}T12:00:00Z`) - 28 * DAY_MS).toISOString().slice(0, 10);
  const jobsIn = x.d.works.on ? x.d.works.weeks.filter((w) => w.week > from && w.week <= end) : [];
  const ahead = x.d.plans.actions.filter((i) => i.service === x.f.service && i.date >= x.d.today);
  const rows = fns.map((fn) => {
    const list = pieces.filter((p) => (p.functions ?? []).includes(fn.id)), sc = scoreOf(list), q = street?.questions.find((y) => y.fn === fn.id);
    const press = list.reduce((a, p) => a + reachBand(p) * pieceWeight(p.src, p).factor * (1 - toneOf(p)), 0); // critical counts double a neutral piece, supportive nothing
    const jobs = x.d.works.on ? jobsIn.reduce((a, w) => a + (w.fns[fn.id] ?? 0), 0) : null;
    return { id: fn.id, name: fn.name, pieces: list.length, mood: sc.adj, raw: sc.raw, survey: q ? q.sat : null, dis: q ? q.dis : null, press, jobs, actions: ahead.filter((i) => (i.functions ?? []).includes(fn.id)).length };
  });
  const share = (get: (r: (typeof rows)[number]) => number | null) => { const all = rows.reduce((a, r) => a + (get(r) ?? 0), 0); return all > 0 ? rows.map((r) => (100 * (get(r) ?? 0)) / all) : null; };
  const signals = [["coverage", share((r) => r.press)], ["the street survey", share((r) => r.dis)], ["jobs by function", share((r) => r.jobs)]].filter((s): s is [string, number[]] => s[1] !== null);
  return rows.map(({ press: _press, ...r }, i) => ({ ...r, pull: signals.length ? Math.round(signals.reduce((a, s) => a + s[1][i], 0) / signals.length) : null, signals: signals.map((s) => s[0]) }));
}
const streetFor = (x: Ctx, month: string) => {
  const end = lastDay(month), from = new Date(Date.parse(`${end}T12:00:00Z`) - SURVEY_DAYS * DAY_MS).toISOString().slice(0, 10);
  return x.d.streets.find((s) => !s.selfOnly && (s.service ?? DEFAULT_SERVICE) === x.f.service && s.ran && s.ran <= end && s.ran >= from) ?? null;
};
const worksIn = (x: Ctx, month: string) => {
  const end = lastDay(month), start = new Date(Date.parse(`${end}T12:00:00Z`) - 28 * DAY_MS).toISOString().slice(0, 10), before = new Date(Date.parse(`${start}T12:00:00Z`) - 28 * DAY_MS).toISOString().slice(0, 10);
  const sum = (from: string, to: string) => x.d.works.weeks.filter((w) => w.week > from && w.week <= to).reduce((a, w) => a + w.public, 0);
  return { jobs: sum(start, end), earlier: sum(before, start) };
};
const enquiryChange = (x: Ctx, month: string, topic: string | null) => {
  const count = (m: string) => { const e = x.d.enquiries[m]; return e ? (topic ? e.byTopic[topic] ?? 0 : e.total) : undefined; };
  const now = count(month), before = [1, 2, 3].map((i) => count(shiftMonth(month, -i)));
  if (now === undefined || before.some((n) => n === undefined)) return { now, chg: null as number | null };
  const base = (before as number[]).reduce((a, b) => a + b, 0) / 3;
  if (now < MIN_CONTACTS && base < MIN_CONTACTS) return { now, chg: null };
  return { now, chg: base ? Math.round(((now - base) / base) * 100) : 0 };
};

function leaf(x: Ctx, d: Def, month: string): Mood {
  const { f, d: data } = x, t = f.topic !== "all" ? f.topic : null;
  if (f.service !== DEFAULT_SERVICE && !["street", "residents", "bylink"].includes(d.id)) return NONE;
  if (f.view === "partners") return NONE;
  switch (d.id) {
    case "street": {
      const r = streetFor(x, month);
      if (!r) return NONE;
      if (t) { const q = r.questions.find((y) => y.topic === t); return q ? show(q.sat - q.dis, "indicative", `${q.sat}% satisfied, ${q.dis}% dissatisfied`) : NONE; }
      if (f.service !== DEFAULT_SERVICE) { // the core questions are about roads, so only its local ones say anything here
        const own = r.questions.filter((q) => q.id.startsWith("l")), v = mean(own.map((q) => q.sat - q.dis));
        return v === null ? NONE : show(v, "indicative", `From ${own.length} local ${own.length === 1 ? "question" : "questions"}, ${r.responses} replies`);
      }
      return r.satisfied === null || r.dissatisfied === null ? NONE : show(Math.round(r.satisfied - r.dissatisfied), "indicative", `${Math.round(r.satisfied)}% satisfied, ${Math.round(r.dissatisfied)}% dissatisfied, ${r.responses} replies`);
    }
    case "residents": {
      const r = data.residents;
      if (!r || t || f.service !== DEFAULT_SERVICE) return NONE;
      const score = (r.score / r.outOf) * 100;
      return show(Math.round((score - 50) * 2), `${Math.round(score)} of 100`, `Published score: ${Math.round(score)} out of 100, ${r.source}`);
    }
    case "bylink": {
      const r = streetFor(x, month);
      return r && r.byLink.n ? context(r.byLink.n, "replies", "Kept apart: these people chose to reply") : NONE;
    }
    case "enquiries": {
      const { now, chg } = enquiryChange(x, month, t);
      if (now === undefined) return NONE;
      if (month === data.today.slice(0, 7)) return { ...NONE, txt: now.toLocaleString("en-GB"), unit: "so far", tip: "It's too early in the month to compare" };
      return chg === null ? { ...NONE, txt: now.toLocaleString("en-GB"), unit: "contacts", tip: "Not enough history to read a direction" } : show(fromChange(chg), "", `${now.toLocaleString("en-GB")} this month, ${changeWords(chg)}`);
    }
    case "faults": {
      const a = data.monthly[month], b = data.monthly[shiftMonth(month, -1)];
      if (t || !a?.perDay) return NONE;
      if (!b?.perDay) return { ...NONE, txt: String(a.reports), unit: "a sample", tip: "Clarion needs another month to read a direction" };
      const chg = Math.round(((a.perDay - b.perDay) / b.perDay) * 100);
      return show(fromChange(chg), "a sample", `${a.reports} reports in the feed, ${changeWords(chg)}`);
    }
    case "petitions": {
      if (t) return NONE;
      const now = data.monthly[month]?.petitions, before = data.monthly[shiftMonth(month, -1)]?.petitions;
      if (!now) return NONE;
      if (!before) return context(now.length, "open", "Clarion needs another month to see what's new");
      return rated(now.filter((p) => p.above && !before.some((q) => q.title === p.title)).map((p) => data.rated[`petition|${p.title}`]), "new with more than a fair share of signatures here");
    }
    case "mps": return t ? NONE : rated(data.questions.filter((q) => q.date.slice(0, 7) === month).map((q) => data.rated[questionKey(q)]), "questions");
    case "gov": {
      const l = data.notes.filter((n) => n.effect !== null && n.date.slice(0, 7) === month && (!t || n.topic === t)).map((n) => n.effect as number);
      return l.length ? show(mean(l) as number, "", `${l.length} impact notes`) : NONE;
    }
    case "works": {
      if (!data.works.on) return { ...NONE, tip: "Turned off in Set-up" };
      if (t) return NONE;
      const { jobs, earlier } = worksIn(x, month);
      if (jobs < MIN_JOBS) return context(jobs, "jobs", "Under 30 in four weeks, so this is only something to bear in mind");
      if (month === data.today.slice(0, 7)) return context(jobs, "jobs", "It's too early in the month to compare");
      const chg = earlier ? Math.round(((jobs - earlier) / earlier) * 100) : 0;
      return show(fromChange(chg), "jobs", `${jobs} jobs reported by the public in four weeks, ${changeWords(chg)}`);
    }
    case "news": return context(data.posts.filter((p) => p.date.slice(0, 7) === month).length, "posts");
    case "weather": return data.works.on ? context(data.works.events.filter((e) => e.start.slice(0, 7) === month).length, "events") : { ...NONE, tip: "Turned off in Set-up" };
    case "published": return context(data.published.length, "figures");
    default: return NONE;
  }
}
export const questionKey = (q: { date: string; heading: string }) => `question|${q.date}|${q.heading}`;
// Each counts only once an officer has rated its direction: a petition or a question doesn't say which way it leans
function rated(tones: (string | undefined)[], what: string): Mood {
  const done = tones.filter((t) => t === "Critical" || t === "Supportive" || t === "Neutral"), net = done.filter((t) => t === "Supportive").length - done.filter((t) => t === "Critical").length;
  if (!tones.length) return NONE;
  if (!done.length) return { ...NONE, txt: String(tones.length), unit: "to rate", tip: "An officer rates each one for direction before it counts" };
  return show(Math.max(-40, Math.min(40, net * 10)), "", `${tones.length} ${what}, ${done.length} rated`);
}
function moodOf(x: Ctx, d: Def, month = x.f.month): Mood {
  if ((hasPool(d) && !d.blend) || (d === ROOT && x.f.view === "partners")) { // a firm has only what's been said about it
    const least = d.id === "meetings" && x.f.view !== "partners" ? 1 : MIN_PIECES; // one meeting can't speak for a firm
    const list = d === ROOT ? piecesFor(x, { month }) : piecesFor(x, { month }).filter((p) => inDef(p.src, d)), sc = scoreOf(list, least);
    if (!list.length) return NONE;
    if (sc.adj === null) { const unit = list.length === 1 ? "piece" : "pieces"; return { v: null, txt: String(list.length), unit, lean: "none", word: moodWord(null), tip: `A mood needs ${least} pieces` }; }
    return { ...show(sc.adj, "", `${list.length} ${list.length === 1 ? "piece" : "pieces"}. ${fmtMood(sc.raw)} before weighting.`), raw: sc.raw, n: list.length };
  }
  if (d.kids) {
    const rows = d.kids.map((k) => ({ w: d === ROOT ? x.d.weights[k.id as keyof Weights] ?? 0 : k.w ?? 0, m: moodOf(x, k, month) }));
    let top = 0, all = 0;
    for (const r of rows) if (r.w > 0 && r.m.v !== null) { top += r.w * r.m.v; all += r.w; }
    if (all) return show(Math.round(top / all));
    if (d === ROOT) return NONE;
    const held = rows.filter((r) => r.m.lean === "ctx").length;
    return held ? context(held, held === 1 ? "item" : "items") : NONE;
  }
  return leaf(x, d, month);
}

// ----- what's shown

const madeOf = (x: Ctx, d: Def, month = x.f.month) => {
  if (!d.kids) return [];
  const rows = d.kids.map((k) => ({ d: k, m: moodOf(x, k, month), w: d === ROOT ? x.d.weights[k.id as keyof Weights] ?? 0 : k.w ?? 0 })).filter((r) => r.d.id !== "other" || x.d.sources.some((s) => mediaOf(s).medium === "other"));
  if (hasPool(d) && !d.blend) {
    const all = piecesFor(x, { month }).filter((p) => inDef(p.src, d)).length;
    return rows.map((r) => { const n = piecesFor(x, { month }).filter((p) => inDef(p.src, r.d)).length; return { id: r.d.id, label: r.d.label, txt: r.m.txt, raw: r.m.raw ?? null, share: "Pooled", pct: shareOf(n, all), words: all ? `${n} of ${all} pieces` : "" }; });
  }
  if (d === ROOT && x.f.view === "partners") { // a partner's mood pools its pieces, so each part shows its count
    const list = piecesFor(x, { month });
    return rows.map((r) => { const n = list.filter((p) => inDef(p.src, r.d)).length; return { id: r.d.id, label: r.d.label, txt: r.m.txt, raw: r.m.raw ?? null, share: `${n} ${n === 1 ? "piece" : "pieces"}`, pct: shareOf(n, list.length), words: list.length ? `${n} of ${list.length} pieces` : "" }; });
  }
  const shares = wholeShares(rows.map((r) => (r.w > 0 && r.m.v !== null ? r.w : 0)));
  return rows.map((r, i) => {
    const counted = r.w > 0 && r.m.v !== null, pct = counted ? shares[i] : null;
    return { id: r.d.id, label: r.d.label, txt: r.m.txt, raw: r.m.raw ?? null, share: counted ? `${pct}%` : r.m.ctx ? "Context" : "Not counted", pct, words: counted ? `${pct}% of the mood` : r.m.ctx ? "Not in the mood" : "" };
  });
};

type Fact = { title: string; sub: string; tags?: string[]; rate?: string; tone?: string };
function factsFor(x: Ctx, d: Def): Fact[] {
  const { d: data, f } = x, m = f.month;
  if (f.service !== DEFAULT_SERVICE || f.view === "partners") return [];
  const inMonth = (date: string) => date.slice(0, 7) === m;
  switch (d.id) {
    case "petitions": return (data.monthly[m]?.petitions ?? []).map((p) => ({ title: p.title, sub: `${p.local.toLocaleString("en-GB")} local signatures${p.above ? ", more than a fair share" : ""}`, rate: `petition|${p.title}`, tone: data.rated[`petition|${p.title}`] ?? "" }));
    case "mps": return data.questions.filter((q) => inMonth(q.date)).map((q) => ({ title: q.heading || "Question on roads", sub: dayOf(q.date), rate: questionKey(q), tone: data.rated[questionKey(q)] ?? "" }));
    case "gov": return [...data.notes.filter((n) => inMonth(n.date)).map((n) => ({ title: n.title, sub: n.effect === null ? "No expected effect confirmed yet, so it isn't counted." : `Expected effect ${fmtMood(n.effect)}, confirmed by an officer.`, tags: n.routes.length ? n.routes : undefined })),
      ...data.announcements.filter((n) => inMonth(n.date)).slice(0, 6).map((n) => ({ title: n.title, sub: `${dayOf(n.date)}, GOV.UK. Not counted unless it has an impact note.` }))];
    case "news": return data.posts.filter((p) => inMonth(p.date)).map((p) => ({ title: p.title, sub: dayOf(p.date) }));
    case "weather": return data.works.on ? data.works.events.filter((e) => inMonth(e.start)).map((e) => ({ title: e.label, sub: e.start === e.end ? dayOf(e.start) : `${dayOf(e.start)} to ${dayOf(e.end)}` })) : [];
    case "published": return data.published.map((p) => ({ title: p.name, sub: `Here ${p.here}, region ${p.region}, England ${p.england}` }));
    default: return [];
  }
}
function notesFor(x: Ctx, d: Def, m: Mood): string[] {
  const { d: data, f } = x, out: string[] = [];
  if (f.service !== DEFAULT_SERVICE && !["street", "surveys"].includes(d.id)) return [`Nothing collected yet. ${SERVICES.find((s) => s.id === f.service)?.label} needs its keywords and published figures first.`];
  if (f.view === "partners" && !hasPool(d) && d !== ROOT) return ["Held for the authority, not for each partner. For a partner, this shows only what's been said about them."];
  if (d === ROOT && f.view === "partners") out.push("This records what was said about the firm. It isn't a verdict on it.");
  if (d === ROOT && data.unread.length) out.push(`Couldn't be read just now: ${data.unread.join(", ")}. The figures held from them are shown.`);
  if (d.id === "enquiries" && f.topic === "all") out.push("The circles show the 6 largest topics.");
  if (d.id === "mps") out.push("Clarion reads the latest 12 questions, so there may be more.");
  if (d.id === "petitions") out.push("Clarion reads the 6 road petitions with the most signatures, so there may be more.");
  if (d.id === "news") out.push("Clarion reads the latest 8 posts on the news page, so there may be more.");
  if (d.id === "gov") out.push("Clarion shows up to 6 GOV.UK announcements a month, so there may be more.");
  if (hasPool(d) && d !== ROOT) {
    const list = piecesFor(x).filter((p) => inDef(p.src, d));
    if (!list.length) out.push("Nothing recorded for this month yet.");
    else if (m.v === null) out.push(`Too few to read: a mood needs ${d.id === "meetings" && f.view !== "partners" ? 1 : MIN_PIECES} pieces.`);
  }
  if (["print", "press"].includes(d.id)) out.push("An officer posts and rates each piece until NLA confirms which licence covers automatic collection.");
  if (["broadcast", "tv", "radio", "social", "socialm", "video"].includes(d.id)) out.push("Clarion doesn't read this. Officers record and rate each mention.");
  if (["social", "socialm", "video"].includes(d.id)) out.push("Channels are organisations, groups and public pages, never individuals.");
  if (d.id === "street") { const r = streetFor(x, f.month); if (r) out.push(`${r.title}: ${r.responses} replies. ${r.note}`); }
  if (d.id === "residents" && data.residents) out.push(`${data.residents.source}. Results like this set the level, and the other signals mostly suggest direction.`);
  if (d.id === "enquiries") out.push("The officer's browser reads the file and sends only counts.");
  if (d.id === "works" && data.works.on) out.push("No street names, references or job details are kept.");
  if (d.id === "gov") out.push("Before an announcement lands, Clarion tests the expectation gap. After it lands, it compares before and after.");
  return out;
}

export type OutNode = {
  id: string; label: string; sub: string; share: string; pct: number | null; mood: Mood; how: string; has: string[]; notes: string[]; facts: Fact[];
  made: { label: string; txt: string; share: string }[]; add: string; types: string[]; source: string; question?: string; topic?: string; kids: OutNode[]; pool: boolean;
};
function build(x: Ctx, d: Def, words = "", pct: number | null = null): OutNode {
  const m = moodOf(x, d), meth = d === ROOT ? { how: "Each part of the map has its own method, and each gives one figure from −100 to +100. They are blended using the weights in Set-up.", has: [] } : hasPool(d) && !d.blend ? (d.id === "meetings" ? METHOD.meetings : METHOD.media) : METHOD[d.id] ?? { how: "A blend of what's below it, weighted as shown.", has: [] };
  const made = madeOf(x, d);
  const kids = (d.kids ?? []).filter((k) => k.id !== "other" || x.d.sources.some((s) => mediaOf(s).medium === "other")).map((k) => { const row = made.find((r) => r.id === k.id); return build(x, k, row?.words ?? "", row?.pct ?? null); });
  if (d.medium) { // an editable list: each channel or publication, then its pieces
    const all = piecesFor(x).filter((p) => inDef(p.src, d)).length;
    for (const s of x.d.sources.filter((y) => inDef(y, d))) {
      const list = piecesFor(x).filter((p) => p.source === s.id), sc = scoreOf(list), media = mediaOf(s);
      const mood: Mood = !list.length ? NONE : sc.adj === null ? { v: null, txt: String(list.length), unit: list.length === 1 ? "piece" : "pieces", lean: "none", word: moodWord(null), tip: "A mood needs 5 pieces" } : { ...show(sc.adj, "", `${list.length} pieces. ${fmtMood(sc.raw)} before weighting.`), raw: sc.raw, n: list.length };
      kids.push({ id: `s:${s.id}`, label: s.name, sub: [s.platform || media.scope, all ? `${list.length} of ${all} pieces` : ""].filter(Boolean).join(", "), share: "", pct: shareOf(list.length, all), mood, how: METHOD.media.how, has: METHOD.media.has, notes: [`Political leaning: ${s.leaning}. Friendliness: ${s.stance}.`], facts: [], made: [], add: "", types: [], source: s.id, kids: [], pool: true });
    }
  }
  if (d.id === "enquiries" && x.f.topic === "all" && x.f.service === DEFAULT_SERVICE) {
    const held = x.d.enquiries[x.f.month], all = held?.total ?? 0;
    for (const [topic, n] of Object.entries(held?.byTopic ?? {}).filter(([t]) => t && !/^(other|not given)$/i.test(t)).sort((a, b) => b[1] - a[1]).slice(0, 6)) {
      const part = x.f.month === x.d.today.slice(0, 7), { chg } = enquiryChange(x, x.f.month, topic), pct = shareOf(n, all), mood: Mood = chg === null || part ? { ...NONE, txt: n.toLocaleString("en-GB"), unit: "contacts", tip: "Not enough history to read a direction" } : show(fromChange(chg), "", `${n.toLocaleString("en-GB")} this month, ${changeWords(chg)}`);
      kids.push({ id: `e:${topic}`, label: topic, sub: `${pct}% of enquiries`, share: "", pct, mood, how: METHOD.enquiries.how, has: METHOD.enquiries.has, notes: [`${n.toLocaleString("en-GB")} enquiries and complaints this month. Counts only.`], facts: [], made: [], add: "", types: [], source: "", topic, kids: [], pool: false });
    }
  }
  if (d.id === "street") {
    const r = streetFor(x, x.f.month);
    for (const q of r?.questions ?? []) {
      if ((x.f.topic !== "all" && q.topic !== x.f.topic) || (x.f.service !== DEFAULT_SERVICE && !q.id.startsWith("l"))) continue;
      const v = q.sat - q.dis, fn = x.d.setup.functions[x.f.service]?.find((y) => y.id === q.fn)?.name;
      kids.push({ id: `q:${q.id}`, label: q.text.length > 44 ? `${q.text.slice(0, 42)}…` : q.text, sub: fn ?? "Whole service", share: "", pct: null, mood: show(v, "", `${q.sat}% satisfied, ${q.dis}% dissatisfied`), how: "Satisfied minus dissatisfied on this one question.", has: [], notes: [q.text, `${q.sat}% satisfied, ${q.dis}% dissatisfied. A street sample: indicative only.`], facts: [], made: [], add: "", types: [], source: "", question: q.id, topic: q.topic, kids: [], pool: false });
    }
  }
  return { id: d.id, label: d.label, sub: words, share: words, pct, mood: m, how: meth.how, has: meth.has, notes: notesFor(x, d, m), facts: factsFor(x, d), made, add: d.add ?? "", types: d.types ?? [], source: "", kids, pool: hasPool(d) && !d.blend };
}

/** Which way mood has moved: reported only when two kinds of signal agree. */
function directionOf(x: Ctx): { word: string; note: string } {
  if (x.f.month === x.d.today.slice(0, 7)) return { word: "Too early to say", note: "It's too early in the month to say whether it's changing." };
  const before = shiftMonth(x.f.month, -1), talk: Def = { id: "talk", label: "", kids: [find("broadcast")!, find("print")!, find("social")!] };
  const kinds: [string, Def][] = [["street survey", find("street")!], ["actions", find("enquiries")!], ["actions", find("faults")!], ["actions", find("works")!], ["representatives", find("petitions")!], ["representatives", find("mps")!], ["what's being said", talk]];
  const moved = new Map<string, number>();
  for (const [kind, d] of kinds) {
    const a = moodOf(x, d), b = moodOf(x, d, before), was = kind === "representatives" ? b.v ?? 0 : b.v; // no rated petition or question last month is nothing to move from
    if (a.v === null || was === null || moved.has(kind) || Math.abs(a.v - was) < 5) continue;
    moved.set(kind, a.v - was);
  }
  const down = [...moved].filter(([, n]) => n < 0).map(([k]) => k), up = [...moved].filter(([, n]) => n > 0).map(([k]) => k);
  if (down.length >= 2 && up.length >= 2) return { word: "No change reported", note: "Signals are pulling both ways, so no change is reported." };
  const agree = (list: string[]) => `${["", "", "Two", "Three", "Four"][list.length]} kinds of signal agree: ${list.slice(0, -1).join(", ")} and ${list.at(-1)}.`;
  if (down.length >= 2) return { word: "Worsening", note: agree(down) };
  if (up.length >= 2) return { word: "Improving", note: agree(up) };
  return { word: "No change reported", note: "A change needs two kinds of signal to agree." };
}

/** Each topic by concern, reach and mood. A calculation, not a judgement, and it proposes the top three as high-impact issues. */
function topicRows(x: Ctx) {
  const base = piecesFor(x, { anyBias: true, anyTopic: true }), month = x.f.month, street = streetFor(x, month);
  const roads = x.f.service === DEFAULT_SERVICE, enq = roads ? x.d.enquiries[month]?.byTopic ?? {} : {}, comments = roads ? street?.topics ?? [] : []; // enquiries and comments are about roads
  const names = [...new Set([...base.map((p) => p.topic), ...Object.keys(enq), ...comments.map((t) => t.topic)])].filter((t) => t && !/^(other|not given)$/i.test(t));
  const enqAll = Object.values(enq).reduce((a, b) => a + b, 0), comAll = comments.reduce((a, t) => a + t.count, 0);
  const rows = names.map((topic) => {
    const list = base.filter((p) => p.topic === topic), sc = scoreOf(list), said = comments.find((t) => t.topic === topic)?.count ?? 0;
    const shares = [enqAll ? (enq[topic] ?? 0) / enqAll : null, comAll ? said / comAll : null].filter((n): n is number => n !== null);
    return { topic, enquiries: enq[topic] ?? 0, comments: said, concern: shares.length ? shares.reduce((a, b) => a + b, 0) / shares.length : 0, reach: list.reduce((a, p) => a + peopleOf(p), 0), pieces: list.length, mood: sc.adj, raw: sc.raw, rankConcern: 0, rankReach: 0, rankMood: 0, proposed: false };
  });
  const rank = (key: "rankConcern" | "rankReach" | "rankMood", val: (r: typeof rows[number]) => number) => [...rows].sort((a, b) => val(a) - val(b) || a.topic.localeCompare(b.topic)).forEach((r, i) => { r[key] = i + 1; });
  rank("rankConcern", (r) => -r.concern); rank("rankReach", (r) => -r.reach); rank("rankMood", (r) => r.mood ?? 999);
  const sum = (r: typeof rows[number]) => r.rankConcern + r.rankReach + r.rankMood;
  rows.filter((r) => r.mood !== null && r.mood < 0).sort((a, b) => sum(a) - sum(b)).slice(0, 3).forEach((r) => { r.proposed = true; });
  return rows.sort((a, b) => sum(a) - sum(b));
}

/** Not counted in the mood, but these should inform campaigns. */
const dayOf = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
function considerations(x: Ctx) {
  const { d: data, f } = x, m = f.month;
  if (f.service !== DEFAULT_SERVICE) return [];
  const out: { kind: string; title: string; sub: string; topic: string }[] = [];
  if (data.works.on) for (const e of data.works.events.filter((y) => y.start.slice(0, 7) === m)) out.push({ kind: "Weather", title: e.label, sub: e.start === e.end ? dayOf(e.start) : `${dayOf(e.start)} to ${dayOf(e.end)}`, topic: "" });
  for (const p of data.posts.filter((y) => y.date.slice(0, 7) === m)) out.push({ kind: "Council news", title: p.title, sub: dayOf(p.date), topic: p.topic });
  for (const p of data.published) out.push({ kind: "Published figures", title: `${p.name}: ${p.here}`, sub: `Region ${p.region}, England ${p.england}`, topic: "" });
  const r = streetFor(x, m);
  if (r?.byLink.n) out.push({ kind: "Replies by link", title: `${r.byLink.n} people chose to reply${r.byLink.sat === null ? "" : `: ${Math.round(r.byLink.sat)}% satisfied`}`, sub: r.satisfied === null ? "" : `Against ${Math.round(r.satisfied)}% with interviewers`, topic: "" });
  return out;
}

// The Dashboard's counts, for this month
function figuresFor(x: Ctx) {
  const m = x.f.month, part = m === x.d.today.slice(0, 7), { now, chg } = enquiryChange(x, m, null), a = x.d.monthly[m], b = x.d.monthly[shiftMonth(m, -1)];
  return { enquiries: now ?? null, enquiryChange: part ? null : chg, faults: a?.perDay ? a.reports : null, faultChange: a?.perDay && b?.perDay ? Math.round(((a.perDay - b.perDay) / b.perDay) * 100) : null };
}

export function buildMap(data: MapData, f: Filters) {
  const x: Ctx = { d: data, f, byId: new Map(data.sources.map((s) => [s.id, s])) };
  const trailOf = (s: Source) => { const def = MEDIA_DEFS.find((d) => inDef(s, d)); return def ? ["root", ...pathToDef(def.id), `s:${s.id}`] : ["root"]; };
  const names = new Map((data.setup.functions[f.service] ?? []).map((y) => [y.id, y.name]));
  const pieces = piecesFor(x).sort((a, b) => b.date.localeCompare(a.date) || b.at.localeCompare(a.at)).map((p) => ({
    id: p.id, sourceId: p.source, source: p.src.name, date: p.date, summary: p.summary, tone: p.tone, scope: p.scope || mediaOf(p.src).scope, covers: (p.functions ?? []).map((id) => names.get(id)).filter(Boolean), topic: p.topic, about: p.about ?? "", nodes: trailOf(p.src),
  }));
  const leftOut = f.view === "authority" ? data.setup.partners.filter((q) => !f.include.includes(q.id)).map((q) => ({ id: q.id, name: q.name, pieces: piecesFor(x, { allAbout: true }).filter((p) => (p.about ?? "") === q.id).map((p) => trailOf(p.src)) })).filter((q) => q.pieces.length) : [];
  const channelsById = new Map(data.setup.channels.map((c) => [c.id, c]));
  const planned = f.view === "authority" ? data.plans.actions.filter((i) => i.service === f.service && (f.topic === "all" || i.topics.includes(f.topic))).map((i) => {
    const ch = channelsById.get(i.channel), node = ch?.node ? find(ch.node) : null, trail = node ? pathToDef(node.id) : [];
    return { id: i.id, title: i.title, date: i.date, channel: ch?.name ?? "No channel", topics: i.topics, nodes: ["root", ...trail] };
  }) : [];
  const fns = functionRows(x, data.setup.functions[f.service] ?? []);
  const street = streetFor(x, f.month);
  const lastMonths = monthsFor(data.today).slice(0, 5).reverse();
  const heat = [{ id: "root", label: "Mood" }, ...BRANCHES.map((b) => ({ id: b.id, label: b.label }))].map((r) => ({ ...r, cells: lastMonths.map((m) => { const v = moodOf(x, find(r.id)!, m.id); return { month: m.id, txt: v.ctx ? "–" : v.txt, lean: v.v === null ? "none" : v.lean, raw: v.raw ?? null, tip: v.tip }; }) }));
  return {
    today: data.today, unread: data.unread, figures: figuresFor(x), service: f.service, month: f.month, months: monthsFor(data.today), services: SERVICES, topicList: data.topics, heat, heatMonths: lastMonths,
    tree: build(x, ROOT), direction: directionOf(x), pieces, planned, leftOut, partners: data.setup.partners, topics: topicRows(x), functions: fns, considerations: considerations(x), election: data.election,
    street: street ? { id: street.id, title: street.title, worse: street.worse, satisfied: street.satisfied, dissatisfied: street.dissatisfied, responses: street.responses, ran: street.ran } : null,
    public: {
      ages: data.ages, adults: data.ageAdults, channels: data.channels.map((c) => { const trail = CHANNEL_PATHS[c.key], d = trail ? find(trail[trail.length - 1]) : null; return { ...c, path: trail, mood: d ? moodOf(x, d) : null }; }),
      groups: (street?.groups ?? []).filter((g) => g.n >= 30).reduce<Record<string, { label: string; n: number; sat: number | null; dis: number | null }[]>>((all, g) => { (all[g.group] ??= []).push({ label: g.label, n: g.n, sat: g.sat, dis: g.dis }); return all; }, {}),
    },
  };
}
