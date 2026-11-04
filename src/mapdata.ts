// Gathers what the map needs on one authority. Clarion's own files always arrive. Anything from outside is an extra
// that mustn't hold up the page, so it's asked for briefly and the map says what's missing rather than waiting.

import { loadElection } from "./briefings";
import { held as plansNow, loadPlans } from "./campaign";
import type { Config } from "./config";
import { adultsByAge, channelsFrom, loadAssessments, loadRates, loadRatings, loadSources, type Rate } from "./coverage";
import { enquiriesByMonth, loadEnquiries, readNews } from "./enquiries";
import { loadFacts } from "./evidence";
import { loadFigures } from "./library";
import type { MapData } from "./mood";
import { listNotes } from "./notes";
import type { Pilot } from "./pilots";
import { loadSetup, loadWeights } from "./setup";
import { announcements, loadSignals } from "./signals";
import { savePretty, storageJson } from "./storage";
import { sharedTopics } from "./surveyai";
import { AGES, loadCensus, streetPoints } from "./surveys";
import { briefly, londonToday, withLock } from "./util";
import { loadWorks } from "./works";

type Month = MapData["monthly"][string];
const MONTHS_KEPT = 14;
const monthlyPath = (c: Config, code: string) => `${c.root}authorities/${code}/monthly.json`;

// The feeds only ever show now, so what they say is kept month by month. Counts and published titles only.
type Feed = { month: string; now: Partial<Month>; questions: { date: string; heading: string }[] };
const MAX_QUESTIONS = 60; // in a month
// A feed that couldn't be read leaves what it last said. The questions feed shows only the latest, so each is kept under its own month
export function merged(held: Record<string, Month>, feed: Feed): Record<string, Month> {
  const all = { ...held }, touch = (m: string) => (all[m] = { ...{ perDay: null, reports: 0 }, ...all[m] });
  Object.assign(touch(feed.month), feed.now);
  for (const q of feed.questions) {
    const row = touch(q.date.slice(0, 7));
    if (!row.questions?.some((x) => x.date === q.date && x.heading === q.heading)) row.questions = [...(row.questions ?? []), q].slice(-MAX_QUESTIONS);
  }
  return Object.fromEntries(Object.entries(all).sort(([a], [b]) => b.localeCompare(a)).slice(0, MONTHS_KEPT));
}
async function rememberMonth(c: Config, code: string, feed: Feed | null): Promise<Record<string, Month>> {
  const held = await storageJson<Record<string, Month>>(c, monthlyPath(c, code), {});
  if (!feed || JSON.stringify(merged(held, feed)) === JSON.stringify(held)) return held;
  return await withLock(monthlyPath(c, code), async () => {
    const kept = merged(await storageJson<Record<string, Month>>(c, monthlyPath(c, code), {}), feed);
    await savePretty(c, monthlyPath(c, code), kept);
    return kept;
  });
}

const headlineSurvey = (list: { year: number; measure: string; score: number; outOf: number; source: string }[]) => {
  const best = [...list].sort((a, b) => b.year - a.year);
  return best.find((s) => /condition/i.test(s.measure)) ?? best[0] ?? null;
};

export async function loadMapData(c: Config, p: Pilot): Promise<MapData> {
  const today = londonToday();
  const [setup, weights, topics, sources, assessments, streets, facts, heldEnquiries, works, notes, election, plans, rated] = await Promise.all([
    loadSetup(c, p.code), loadWeights(c), sharedTopics(c), loadSources(c, p.code), loadAssessments(c, p.code), streetPoints(c, p.code), loadFacts(c, p.code),
    loadEnquiries(c, p.code), loadWorks(c, p.code), listNotes(c, p.code), loadElection(c, p.code), loadPlans(c, p.code), loadRatings(c, p.code),
  ]);
  const page = heldEnquiries.page || p.newsPage;
  const [census, rates, signals, posts, figures, gov] = await Promise.all([
    briefly(`census|${p.code}`, null, () => loadCensus(c, p.code), (x) => x === null), briefly("audience-rates", [] as Rate[], () => loadRates(c), (x) => !x.length),
    briefly(`signals|${p.code}`, null, () => loadSignals(p), (x) => !x.fixMyStreet.ok || !x.petitions.ok || !x.questions.ok),
    page ? briefly(`news|${p.code}|${page}`, null, () => readNews(p, page, topics)) : Promise.resolve(null), briefly(`figures|${p.code}`, null, () => loadFigures(c, p.code)), briefly("announcements", null, () => announcements()),
  ]);
  const feed = signals?.fixMyStreet.data;
  const monthly = await rememberMonth(c, p.code, signals ? {
    month: today.slice(0, 7), questions: signals.questions.ok ? (signals.questions.data ?? []).map((q) => ({ date: q.date, heading: q.heading })) : [],
    now: {
      ...(signals.fixMyStreet.ok ? { perDay: feed?.perDay ?? null, reports: feed?.reports ?? 0 } : {}),
      ...(signals.petitions.ok ? { petitions: (signals.petitions.data ?? []).map((x) => ({ title: x.title, local: x.local, above: x.localShare > x.fairShare })) } : {}),
    },
  } : null);
  const unread = [
    ...(signals?.fixMyStreet.ok ? [] : ["FixMyStreet"]), ...(signals?.petitions.ok ? [] : ["petitions"]), ...(signals?.questions.ok ? [] : ["MPs' questions"]),
    ...(gov ? [] : ["GOV.UK"]), ...(figures ? [] : ["published figures"]), ...(page && !posts ? ["the council's news page"] : []),
  ];
  const own = plans.issues.filter((x) => x.own).map((x) => x.topic);
  return {
    today, unread, setup, weights, topics: [...topics, ...own.filter((t) => !topics.includes(t))], sources, assessments, streets, adults: census?.adults ?? null, ageAdults: census ? adultsByAge(census) : null, rated, announcements: (gov ?? []).map((x) => ({ title: x.title, date: x.date })),
    residents: headlineSurvey([...p.surveys, ...facts.surveys]), enquiries: enquiriesByMonth(heldEnquiries, topics), monthly,
    questions: Object.values(monthly).flatMap((m) => m.questions ?? []),
    works: { on: works.on, weeks: works.weeks.map((w) => ({ week: w.week, public: w.public })), events: works.events.map((e) => ({ label: e.label, start: e.start, end: e.end })) },
    notes: notes.filter((n) => n.status === "ready").map((n) => ({ id: n.id, title: n.change?.title || n.input.title, date: n.created.slice(0, 10), effect: n.effect ?? null, topic: n.topic ?? "", routes: [...new Set(n.impacts.map((i) => i.route))] })),
    posts: (posts ?? []).map((x) => ({ title: x.title, date: x.date, topic: x.topic })),
    published: (figures?.condition ?? []).map((x) => ({ name: `${x.roadClass} roads to consider for repair, ${x.fye}`, here: `${x.value}%`, region: x.region === null ? "–" : `${x.region}%`, england: x.england === null ? "–" : `${x.england}%` })),
    plans: plansNow(plans, election.on), election: election.on, channels: channelsFrom(rates), ages: AGES.map(([age]) => age),
  };
}
