// What's being said: the press, broadcast, social and community sources an authority follows, and the assessments
// its officers record. Clarion never reads these sources. It can check whether a keyword turns up for a publication,
// keeping only yes or no and the date, and the officer finds the piece for themselves and records what they made of it
// in their own words. Sources with no licensing issue are read automatically, in signals.ts.
//
// Files, under ROOT_FOLDER:
//   authorities/<code>/sources.json        the sources an authority follows
//   authorities/<code>/assessments.json    its officers' assessments
//   usage/searches-<YYYY-MM>.json          coverage checks this month, for all authorities together
//
// The audience estimate is national patterns by age, overlaid on the authority's Census figures. It describes a kind
// of source, not one publication's readers. The weights for a source's stance are a starting judgement, to be tested
// in the pilot, and raw and adjusted figures are always shown side by side.

import type { Member } from "./accounts";
import type { Config } from "./config";
import { refQuery } from "./library";
import type { Pilot } from "./pilots";
import { DEFAULT_SERVICE, FUNCTIONS, loadSetup, serviceId, type Setup } from "./setup";
import { storageJson, savePretty } from "./storage";
import { scrubContacts } from "./surveyai";
import { AGES, cellKey, type Census } from "./surveys";
import { FriendlyError, cached, cleanText, delay, fetchWithTimeout, isCached, londonToday, pickEnum, round, withLock } from "./util";

export const SOURCE_TYPES = ["Local Newspaper", "Local News Website", "National Newspaper", "Local Newsletter", "National Magazine", "Trade Press", "Social Media", "Streaming Video", "Local Television", "National Television", "Local Radio", "National Radio", "Community Event", "Other"] as const;
export const LEANINGS = ["Not known", "None shown", "Left", "Centre left", "Centre", "Centre right", "Right"] as const;
export const STANCES = ["Balanced", "Usually supportive", "Usually critical"] as const;
export const REACH_UNITS = ["copies", "readers", "listeners", "viewers", "members", "people"] as const;
export const REACH_BANDS = ["Small", "Medium", "Large"] as const;
export const REACH_UNIT_FOR: Record<typeof SOURCE_TYPES[number], typeof REACH_UNITS[number]> = {
  "Local Newspaper": "copies", "Local News Website": "readers", "National Newspaper": "copies", "Local Newsletter": "copies", "Social Media": "members",
  "Local Television": "viewers", "National Television": "viewers", "Local Radio": "listeners", "National Radio": "listeners", "Community Event": "people", "Trade Press": "copies", "National Magazine": "copies", "Streaming Video": "viewers", Other: "people",
};
export const RELEVANCE = ["High", "Some", "Little", "None"] as const;
export const TONES = ["Supportive", "Neutral", "Critical"] as const;
export const PROMINENCE = ["Front page or lead", "Inside page", "Passing mention"] as const;
export { FUNCTIONS };

const MAX_SOURCES = 100;
const MAX_ASSESSMENTS = 5000;
const SUMMARY_CHARS = 200;
const PERIOD_DAYS = 28;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_KEYWORDS = 2;
const MAX_CHECKS = 12; // searches in one go
const CHECKS_A_DAY = 50; // searches for each authority, so one authority can't use up the month's
const CHECK_MS = 6 * 60 * 60 * 1000;
const CHECK_RUN_MS = 45000; // one go stops asking after this long
const FAILS_TO_STOP = 2; // or after this many failures in a row
const SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";
const SEARCH_MS = 10000;
const SEARCH_GAP_MS = 1100;
// Sites shared by many sources. A keyword found on one says nothing about a particular page or programme.
const SHARED_SITES = ["facebook.com", "instagram.com", "x.com", "twitter.com", "tiktok.com", "youtube.com", "linkedin.com", "reddit.com", "threads.net", "threads.com", "bsky.app", "nextdoor.com", "nextdoor.co.uk", "bbc.co.uk", "bbc.com", "itv.com", "itvx.com"];

export type Source = {
  id: string; name: string; type: typeof SOURCE_TYPES[number]; domain: string;
  reach: number | null; reachUnit: string; reachBand: string; reachFrom: string;
  leaning: string; stance: string; campaign: string[]; added: string; by: string;
  platform?: string; // for a social or video channel: YouTube, TikTok and so on
};
export type Assessment = {
  id: string; source: string; date: string; summary: string; topic: string; relevance: string; tone: string; prominence: string; functions: string[]; reach: number | null; by: string; at: string;
  service?: string; scope?: string; about?: string; // the service it covers, Local or National if not the source's own, and the key partner it's about
};

const sourcesPath = (c: Config, code: string) => `${c.root}authorities/${code}/sources.json`;
const assessmentsPath = (c: Config, code: string) => `${c.root}authorities/${code}/assessments.json`;
const searchesPath = (c: Config) => `${c.root}usage/searches-${londonToday().slice(0, 7)}.json`;
const newId = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

export async function loadSources(c: Config, code: string): Promise<Source[]> {
  const all = await storageJson<Source[]>(c, sourcesPath(c, code), []);
  return Array.isArray(all) ? all : [];
}
export async function loadAssessments(c: Config, code: string): Promise<Assessment[]> {
  const all = await storageJson<Assessment[]>(c, assessmentsPath(c, code), []);
  return Array.isArray(all) ? all : [];
}

/** A web address reduced to its site, for searching that site alone. Anything else comes back empty. */
export function cleanDomain(v: unknown): string {
  const d = String(v ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(d) ? d : "";
}
/** The site to check for a source. Blank is fine. A typing slip, or a site many sources share, is refused rather than lost. */
function readDomain(v: unknown): string {
  if (!String(v ?? "").trim()) return "";
  const d = cleanDomain(v);
  if (!d) throw new FriendlyError("That web address doesn't look right. Try something like northbridgecourier.co.uk, or leave it blank.");
  if (SHARED_SITES.some((x) => d === x || d.endsWith(`.${x}`))) throw new FriendlyError(`Many sources share ${d}, so a check there wouldn't tell you about this one. Leave the web address blank and find its pieces yourself.`);
  return d;
}
/** A reach as typed. Blank means not given, and anything else that isn't a number is refused rather than lost. */
function readReach(v: unknown): number | null {
  const typed = String(v ?? "").replace(/[,\s]/g, "");
  if (!typed) return null;
  const n = Number(typed);
  if (!Number.isFinite(n) || n < 0 || n > 1e8) throw new FriendlyError("Give the reach as a plain number, such as 18,400.");
  return Math.round(n);
}

export function readSource(b: any, was: Source | null, by: string, today: string, topics: string[]): Source {
  const name = cleanText(b?.name, 100);
  if (!name) throw new FriendlyError("Give the source a name.");
  const type = pickEnum(SOURCE_TYPES, b?.type);
  if (!type) throw new FriendlyError("Choose what kind of source this is.");
  const reach = readReach(b?.reach);
  return {
    id: was?.id ?? newId(), name, type, domain: readDomain(b?.domain), reach, reachUnit: reach === null ? "" : pickEnum(REACH_UNITS, b?.reachUnit) ?? REACH_UNIT_FOR[type],
    reachBand: reach === null ? pickEnum(REACH_BANDS, b?.reachBand) ?? "" : "", reachFrom: cleanText(b?.reachFrom, 80), platform: cleanText(b?.platform, 40),
    leaning: pickEnum(LEANINGS, b?.leaning) ?? "Not known", stance: pickEnum(STANCES, b?.stance) ?? "Balanced",
    campaign: (Array.isArray(b?.campaign) ? b.campaign : []).map((t: unknown) => cleanText(t, 80)).filter((t: string) => topics.includes(t)).slice(0, 5),
    added: was?.added ?? today, by: was?.by ?? by,
  };
}

export async function saveSource(c: Config, me: Member, p: Pilot, b: any, topics: string[]): Promise<Source> {
  return await withLock(sourcesPath(c, p.code), async () => {
    const all = await loadSources(c, p.code);
    const was = b?.id ? all.find((s) => s.id === b.id) ?? null : null;
    if (b?.id && !was) throw new FriendlyError("That source wasn't found.", 404);
    if (!was && all.length >= MAX_SOURCES) throw new FriendlyError(`An authority can follow up to ${MAX_SOURCES} sources.`);
    const source = readSource(b, was, me.name, londonToday(), topics);
    await savePretty(c, sourcesPath(c, p.code), was ? all.map((s) => (s.id === was.id ? source : s)) : [...all, source]);
    return source;
  });
}

// Holds both locks, assessments first, so an assessment can't be saved against a source as it goes
export async function removeSource(c: Config, p: Pilot, id: unknown): Promise<void> {
  await withLock(assessmentsPath(c, p.code), () => withLock(sourcesPath(c, p.code), async () => {
    const held = await loadAssessments(c, p.code);
    if (held.some((a) => a.source === id)) throw new FriendlyError("This source has assessments, so it can't be taken off.");
    const all = await loadSources(c, p.code);
    await savePretty(c, sourcesPath(c, p.code), all.filter((s) => s.id !== id));
  }));
}

export function readAssessment(b: any, sources: Source[], topics: string[], by: string, today: string, setup?: Setup): Assessment {
  const source = sources.find((s) => s.id === b?.source);
  if (!source) throw new FriendlyError("Choose the source first.");
  const date = String(b?.date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date))) throw new FriendlyError("Give the date it appeared.");
  if (date > today) throw new FriendlyError("The date it appeared can't be in the future.");
  const raw = String(b?.summary ?? "").trim();
  if (!raw) throw new FriendlyError("Say in one line what it was about.");
  if (raw.length > SUMMARY_CHARS) throw new FriendlyError(`Keep it to one line in your own words: up to ${SUMMARY_CHARS} letters. Please don't paste the article.`);
  const topic = cleanText(b?.topic, 80);
  if (!topics.includes(topic)) throw new FriendlyError("Choose a topic.");
  const relevance = pickEnum(RELEVANCE, b?.relevance), tone = pickEnum(TONES, b?.tone), prominence = pickEnum(PROMINENCE, b?.prominence);
  if (!relevance || !tone || !prominence) throw new FriendlyError("Choose its relevance, tone and prominence.");
  const service = serviceId(b?.service);
  const known = new Set<string>(setup ? (setup.functions[service] ?? []).map((f) => f.id) : FUNCTIONS.map((f) => f[0]));
  const reach = readReach(b?.reach);
  const about = setup?.partners.find((x) => x.id === b?.about)?.id ?? "";
  const scope = b?.scope === "Local" || b?.scope === "National" ? b.scope : "";
  return {
    id: newId(), source: source.id, date, summary: scrubContacts(cleanText(raw, SUMMARY_CHARS)), topic, relevance, tone, prominence,
    functions: (Array.isArray(b?.functions) ? b.functions : []).filter((f: string) => known.has(f)), reach: reach ?? source.reach, by, at: new Date().toISOString(),
    service, ...(scope ? { scope } : {}), ...(about ? { about } : {}),
  };
}

export async function saveAssessment(c: Config, me: Member, p: Pilot, b: any, topics: string[]): Promise<Assessment> {
  return await withLock(assessmentsPath(c, p.code), async () => {
    const all = await loadAssessments(c, p.code);
    if (all.length >= MAX_ASSESSMENTS) throw new FriendlyError(`An authority can hold up to ${MAX_ASSESSMENTS.toLocaleString("en-GB")} assessments.`);
    const made = readAssessment(b, await loadSources(c, p.code), topics, me.name, londonToday(), await loadSetup(c, p.code));
    await savePretty(c, assessmentsPath(c, p.code), [...all, made]);
    return made;
  });
}

export async function removeAssessment(c: Config, p: Pilot, id: unknown): Promise<void> {
  await withLock(assessmentsPath(c, p.code), async () => {
    const all = await loadAssessments(c, p.code);
    await savePretty(c, assessmentsPath(c, p.code), all.filter((a) => a.id !== id));
  });
}

// ----- allowing for the source

/**
 * A piece against a source's usual line tells you more, and one along it less. A topic the source is campaigning on
 * can look bigger than it is, so it counts half. Stance and campaign are never both applied to one piece.
 */
export function pieceWeight(s: Pick<Source, "stance" | "campaign">, a: Pick<Assessment, "tone" | "topic">): { factor: number; why: string } {
  if (s.stance === "Usually critical" && a.tone === "Critical") return { factor: 0.5, why: "Usually critical, critical piece" };
  if (s.stance === "Usually critical" && a.tone === "Supportive") return { factor: 1.5, why: "Usually critical, supportive piece" };
  if (s.stance === "Usually supportive" && a.tone === "Critical") return { factor: 1.5, why: "Usually supportive, critical piece" };
  if (s.stance === "Usually supportive" && a.tone === "Supportive") return { factor: 0.5, why: "Usually supportive, supportive piece" };
  if (s.campaign.includes(a.topic)) return { factor: 0.5, why: "Campaigning on this topic" };
  return { factor: 1, why: "" };
}

export type Row = Assessment & { sourceName: string; sourceType: string; reachUnit: string; reachBand: string; factor: number; why: string; adjusted: number | null };
export function withWeights(assessments: Assessment[], sources: Source[]): Row[] {
  const byId = new Map(sources.map((s) => [s.id, s]));
  return assessments.flatMap((a) => {
    const s = byId.get(a.source);
    if (!s) return [];
    const { factor, why } = pieceWeight(s, a);
    return [{ ...a, sourceName: s.name, sourceType: s.type, reachUnit: s.reachUnit, reachBand: s.reachBand, factor, why, adjusted: a.reach === null ? null : Math.round(a.reach * factor) }];
  }).sort((x, y) => y.date.localeCompare(x.date) || y.at.localeCompare(x.at));
}

const shiftDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** The last four weeks by topic. A piece marked as having no relevance doesn't count. */
export function summarise(rows: Row[], today: string) {
  const from = shiftDays(today, -PERIOD_DAYS), before = shiftDays(from, -PERIOD_DAYS);
  const counted = rows.filter((r) => r.relevance !== "None");
  const now = counted.filter((r) => r.date > from), earlier = counted.filter((r) => r.date > before && r.date <= from);
  const total = (list: Row[], key: "reach" | "adjusted") => list.reduce((sum, r) => sum + (r[key] ?? 0), 0);
  const names = [...new Set(now.map((r) => r.topic))];
  const topics = names.map((topic) => {
    const list = now.filter((r) => r.topic === topic);
    return { topic, pieces: list.length, reach: total(list, "reach"), adjusted: total(list, "adjusted"), critical: list.filter((r) => r.tone === "Critical").length, supportive: list.filter((r) => r.tone === "Supportive").length };
  }).sort((a, b) => b.pieces - a.pieces || b.adjusted - a.adjusted || a.topic.localeCompare(b.topic));
  const byType = SOURCE_TYPES.map((type) => {
    const list = now.filter((r) => r.sourceType === type);
    return { type, pieces: list.length, critical: list.filter((r) => r.tone === "Critical").length, supportive: list.filter((r) => r.tone === "Supportive").length };
  }).filter((x) => x.pieces);
  return { pieces: now.length, previous: earlier.length, reach: total(now, "reach"), adjusted: total(now, "adjusted"), topics, byType };
}

// ----- who a source reaches

export type Rate = { measure: string; age_from: number | null; age_to: number | null; value: number; publisher: string; year: string };
const LOCAL_NEWS = "Local news in the last month or so"; // Ofcom's Local News and Media Survey
// The first of these that the library holds is used
const AUDIENCES: Partial<Record<Source["type"], { measure: string; note: string }[]>> = {
  "Local Newspaper": [{ measure: "Read news in a local printed newspaper in the last 12 months", note: "" }],
  "Local News Website": [{ measure: "Read news online from a local news publisher in the last 12 months", note: "" }],
  "National Newspaper": [{ measure: "Read news in a national printed newspaper in the last 12 months", note: "" }],
  "Local Newsletter": [{ measure: `${LOCAL_NEWS}: Printed local magazines`, note: "Based on printed local magazines, the closest published figure." }],
  "National Magazine": [{ measure: `${LOCAL_NEWS}: Printed local magazines`, note: "Based on printed local magazines, the closest published figure." }],
  "Streaming Video": [{ measure: `${LOCAL_NEWS}: Video-sharing platforms such as YouTube, Vimeo, etc.`, note: "Based on local news from any video site, not one channel." }],
  "Social Media": [{ measure: `${LOCAL_NEWS}: Social media such as Facebook, X (formerly Twitter) or Instagram, etc.`, note: "Based on local news from any social media, not one group or page." }],
  "Local Television": [{ measure: `${LOCAL_NEWS}: Television`, note: "" }, { measure: "PROXY, not news-specific and not local: watched TV programmes live at the time of broadcast", note: "Based on all live television, the closest published figure." }],
  "Local Radio": [{ measure: `${LOCAL_NEWS}: Radio`, note: "" }, { measure: "PROXY, not news-specific and not local: listened to live radio online through a computer, laptop, tablet or phone", note: "Based on all live radio online, the closest published figure." }],
};
const LIKELIHOODS = [
  { label: "Drives (holds a licence)", measure: "drive: holds a full car driving licence", from: "National Travel Survey" },
  { label: "Walks at least weekly", measure: "walk: walks at least once a week, any purpose", from: "Active Lives Survey" },
  { label: "Cycles at least weekly", measure: "cycle: cycles at least once a week, any purpose", from: "Active Lives Survey" },
  { label: "Politically active", measure: "complain/contact + petition: any civic participation in last 12 months (composite)", from: "Community and Engagement Survey: contacting an official, signing a petition or going to a public meeting" },
  { label: "Contacts the council", measure: "complain/contact: Contacted my local council (ever in last few years)", from: "Scottish Social Attitudes, the closest available" },
];
const SAME_WITHIN = 0.1; // closer than this to all adults, and the two can't be told apart
const OLDEST_AGE = 90;

// The ways people say they get local news. All from one Ofcom question and the same age groups, so they can be set side by side
export const CHANNELS = [
  { key: "word", label: "Word of mouth", measure: `${LOCAL_NEWS}: Word of mouth (family/ friends/ colleagues/ neighbours)` },
  { key: "social", label: "Social media", measure: `${LOCAL_NEWS}: Social media such as Facebook, X (formerly Twitter) or Instagram, etc.` },
  { key: "tv", label: "Television", measure: `${LOCAL_NEWS}: Television` },
  { key: "sites", label: "Local paper websites", measure: `${LOCAL_NEWS}: Websites/ apps of local newspapers` },
  { key: "bbc", label: "BBC and ITV websites", measure: `${LOCAL_NEWS}: Websites/ apps of TV and radio companies such as BBC or ITV/ STV/ UTV/ ITV Wales` },
  { key: "radio", label: "Radio", measure: `${LOCAL_NEWS}: Radio` },
  { key: "print", label: "Printed local papers", measure: `${LOCAL_NEWS}: Printed local newspapers` },
  { key: "magazines", label: "Local magazines", measure: `${LOCAL_NEWS}: Printed local magazines` },
  { key: "messaging", label: "WhatsApp and Nextdoor", measure: `${LOCAL_NEWS}: Messaging or neighbourhood apps like WhatsApp or Nextdoor` },
  { key: "search", label: "Search engines", measure: `${LOCAL_NEWS}: Search engines such as Google, Bing, etc.` },
  { key: "video", label: "YouTube and video sites", measure: `${LOCAL_NEWS}: Video-sharing platforms such as YouTube, Vimeo, etc.` },
];

export const RATE_MEASURES = [...new Set([...Object.values(AUDIENCES).flatMap((a) => a!.map((x) => x.measure)), ...LIKELIHOODS.map((l) => l.measure), ...CHANNELS.map((x) => x.measure)])];

export async function loadRates(c: Config): Promise<Rate[]> {
  try {
    return await cached("audience-rates", DAY_MS, async () => {
      const measures = RATE_MEASURES;
      const r = await refQuery(c, `SELECT measure, age_from, age_to, value, publisher, year FROM audience_rates WHERE group_type = 'age' AND measure IN (${measures.map(() => "?").join(",")})`, measures);
      return r.rows as Rate[];
    });
  } catch (e) {
    console.log(`[warn] audience rates: ${(e as Error).message}`);
    return [];
  }
}

/** Rates for one measure, averaged over the ages in Clarion's bands. Sources use different bands, so each year of age is looked up. */
export function bandRates(rates: Rate[], measure: string): number[] | null {
  const held = rates.filter((r) => r.measure === measure && r.age_from !== null);
  if (!held.length) return null;
  const latest = held.map((r) => String(r.year)).sort().at(-1);
  const rows = held.filter((r) => String(r.year) === latest).sort((a, b) => (a.age_from as number) - (b.age_from as number));
  const at = (age: number) => (rows.find((r) => age <= (r.age_to ?? 200)) ?? rows[rows.length - 1]).value;
  return AGES.map(([, from, to]) => {
    const last = Math.min(to, OLDEST_AGE);
    let sum = 0;
    for (let age = from; age <= last; age++) sum += at(age);
    return sum / (last - from + 1);
  });
}

/** How likely each age group is to get local news each way. A national pattern, for comparing, not a measure of any authority. */
export const channelsFrom = (rates: Rate[]) => CHANNELS.flatMap(({ key, label, measure }) => { const by = bandRates(rates, measure); return by ? [{ key, label, rates: by.map((n) => Math.round(n)) }] : []; });

export function adultsByAge(census: Census): number[] {
  return AGES.map(([age]) => (census.cells[cellKey(age, "Female")] || 0) + (census.cells[cellKey(age, "Male")] || 0));
}

export type Audience = {
  known: boolean; note: string; ages: string[]; audience: number[]; adults: number[]; overFiftyFive: { audience: number; adults: number };
  likelihoods: { label: string; audience: number; adults: number; reading: string; from: string }[];
};

/** The likely make-up of a kind of source's audience here. The figures are for comparing, not probabilities. */
export function audienceFor(type: Source["type"], census: Census | null, rates: Rate[]): Audience | null {
  if (!census || !rates.length) return null;
  const people = adultsByAge(census), all = people.reduce((sum, n) => sum + n, 0) || 1;
  const adults = people.map((n) => (n / all) * 100);
  const best = (AUDIENCES[type] ?? []).find((a) => bandRates(rates, a.measure));
  const use = best ? bandRates(rates, best.measure) : null;
  const weighted = use ? people.map((n, i) => n * use[i]) : null;
  const total = weighted ? weighted.reduce((sum, n) => sum + n, 0) || 1 : 1;
  const audience = weighted ? weighted.map((n) => (n / total) * 100) : adults;
  const blend = (mix: number[], rate: number[]) => mix.reduce((sum, share, i) => sum + (share / 100) * rate[i], 0);
  const older = (mix: number[]) => mix.slice(4).reduce((sum, n) => sum + n, 0);
  return {
    known: !!use, note: best ? best.note : "There's no published age profile for this kind of source, so this shows all adults.",
    ages: AGES.map(([age]) => age), audience: audience.map((n) => round(n)), adults: adults.map((n) => round(n)), overFiftyFive: { audience: Math.round(older(audience)), adults: Math.round(older(adults)) },
    likelihoods: use ? LIKELIHOODS.flatMap(({ label, measure, from }) => {
      const rate = bandRates(rates, measure);
      if (!rate) return [];
      const here = blend(audience, rate), everyone = blend(adults, rate), ratio = here / (everyone || 1);
      return [{ label, audience: Math.round(here), adults: Math.round(everyone), reading: ratio > 1 + SAME_WITHIN ? "Higher" : ratio < 1 - SAME_WITHIN ? "Lower" : "About the same", from }];
    }) : [],
  };
}

// ----- checking for coverage

export type Check = { source: string; name: string; keyword: string; result: "Found" | "Found, no date" | "No match" | "Not checked"; date: string };

const checksToday = new Map<string, number>();
const checksLeft = (code: string) => CHECKS_A_DAY - (checksToday.get(`${code}|${londonToday()}`) ?? 0);
function countChecks(code: string, n: number): void {
  const key = `${code}|${londonToday()}`;
  const used = checksToday.get(key) ?? 0;
  if (used + n > CHECKS_A_DAY) throw new FriendlyError("Your authority has used today's coverage checks. Try again tomorrow, or with fewer publications.", 429);
  checksToday.set(key, used + n);
}

// The month's count is kept in storage, because a new deployment clears what's in memory
async function searchesThisMonth(c: Config): Promise<number> {
  return Number((await storageJson<{ searches?: number }>(c, searchesPath(c), {})).searches) || 0;
}
async function addSearches(c: Config, n: number): Promise<number> {
  return await withLock(searchesPath(c), async () => {
    const total = (await searchesThisMonth(c)) + n;
    if (n) await savePretty(c, searchesPath(c), { searches: total });
    return total;
  });
}

export function readKeywords(v: unknown): string[] {
  const list = (Array.isArray(v) ? v : String(v ?? "").split(",")).map((k) => cleanText(k, 40).replace(/["“”]/g, "")).filter(Boolean);
  if (!list.length) throw new FriendlyError("Give one or two keywords.");
  if (list.length > MAX_KEYWORDS) throw new FriendlyError(`Use up to ${MAX_KEYWORDS} keywords.`);
  return list;
}

/**
 * Asks a search service whether a site has anything on a keyword. Only yes or no and the date are read from the
 * answer: headlines, extracts and links are thrown away unseen, and Claude isn't involved.
 */
async function searchSite(c: Config, domain: string, keyword: string, from: string, to: string): Promise<{ found: boolean; date: string }> {
  const url = `${SEARCH_URL}?${new URLSearchParams({ q: `site:${domain} "${keyword}"`, country: "GB", count: "10", freshness: `${from}to${to}` })}`;
  const res = await fetchWithTimeout(url, { headers: { Accept: "application/json", "X-Subscription-Token": c.searchKey } }, SEARCH_MS);
  // A wrong key can come back as 422, which is also what the service says when it doesn't like a question
  const refused = res.status === 401 || res.status === 403 || (res.status === 422 && /SUBSCRIPTION_TOKEN/.test(await res.text().catch(() => "")));
  if (refused) throw new FriendlyError("The search service refused Clarion's key. Check SEARCH_KEY.", 502);
  if (!res.ok) throw new Error(`the search service answered ${res.status}`);
  const d: any = await res.json().catch(() => null);
  // An answer with nothing found can leave out the results altogether, but it's still an answer. Anything else isn't.
  if (!d || typeof d !== "object" || !(d.type === "search" || d.web || d.query)) throw new Error("the search service sent something unexpected");
  const hits = (Array.isArray(d.web?.results) ? d.web.results : []).filter((r: any) => {
    try { const host = new URL(String(r?.url)).hostname; return host === domain || host.endsWith(`.${domain}`); } catch { return false; }
  });
  const dates = hits.map((r: any) => String(r?.page_age ?? "").slice(0, 10)).filter((x: string) => /^\d{4}-\d{2}-\d{2}$/.test(x) && x >= from && x <= to).sort();
  return { found: hits.length > 0, date: dates.at(-1) ?? "" };
}

// A petition or an MP's question has no direction of its own, so an officer rates it. Only the rating is kept here.
const ratingsPath = (c: Config, code: string) => `${c.root}authorities/${code}/ratings.json`;
export const loadRatings = (c: Config, code: string) => storageJson<Record<string, string>>(c, ratingsPath(c, code), {});
export async function saveRating(c: Config, code: string, key: unknown, tone: unknown): Promise<void> {
  const k = cleanText(key, 260);
  if (!/^(petition|question)\|/.test(k)) throw new FriendlyError("That can't be rated.");
  await withLock(ratingsPath(c, code), async () => {
    const held = await loadRatings(c, code);
    if ((TONES as readonly unknown[]).includes(tone)) held[k] = tone as string; else delete held[k];
    await savePretty(c, ratingsPath(c, code), held);
  });
}

// A coverage check keeps only yes or no and the date, for each source
export type LastCheck = { found: boolean; date: string; on: string };
const checksPath = (c: Config, code: string) => `${c.root}authorities/${code}/coverage-checks.json`;
export const loadChecks = (c: Config, code: string) => storageJson<Record<string, LastCheck>>(c, checksPath(c, code), {});
async function keepChecks(c: Config, code: string, checks: Check[], on: string): Promise<void> {
  const done = checks.filter((x) => x.result !== "Not checked");
  if (!done.length) return;
  await withLock(checksPath(c, code), async () => {
    const held = await loadChecks(c, code);
    for (const id of new Set(done.map((x) => x.source))) {
      const rows = done.filter((x) => x.source === id), hit = rows.find((x) => x.result !== "No match");
      held[id] = { found: !!hit, date: hit?.date ?? "", on };
    }
    await savePretty(c, checksPath(c, code), held);
  });
}

export async function checkCoverage(c: Config, p: Pilot, b: any): Promise<{ ready: boolean; why: string; from: string; to: string; left: number; checks: Check[] }> {
  const days = [7, 14, 30].includes(b?.days) ? b.days : 14;
  const to = londonToday(), from = shiftDays(to, -days);
  if (!c.searchKey) return { ready: false, why: "The search service isn't set up yet, so find pieces yourself and record them below.", from, to, left: 0, checks: [] };
  const keywords = readKeywords(b?.keywords);
  const chosen: unknown[] | null = Array.isArray(b?.sources) ? b.sources : null;
  if (chosen && !chosen.length) throw new FriendlyError("Tick at least one publication.");
  const sources = (await loadSources(c, p.code)).filter((s) => s.domain && (!chosen || chosen.includes(s.id)));
  if (!sources.length) throw new FriendlyError("Add a web address to a source first, so Clarion knows where to look.");
  const pairs = sources.flatMap((s) => keywords.map((keyword) => ({ s, keyword, key: `check|${s.domain}|${keyword.toLowerCase()}|${from}|${to}` })));
  if (pairs.length > MAX_CHECKS) throw new FriendlyError(`That's too many at once. Choose fewer publications: up to ${MAX_CHECKS} checks at a time.`);
  const needed = pairs.filter((x) => !isCached(x.key, CHECK_MS)).length; // an answer already held costs nothing
  if (needed && (await searchesThisMonth(c)) + needed > c.searchesAMonth) throw new FriendlyError("Clarion has used this month's coverage checks. They start again on the 1st, and you can still find pieces yourself and record them below.", 429);
  countChecks(p.code, needed);
  const checks: Check[] = [], stopAt = Date.now() + CHECK_RUN_MS;
  let fails = 0, made = 0, monthTotal = 0;
  try {
    for (const { s, keyword, key } of pairs) {
      const row = { source: s.id, name: s.name, keyword };
      if ((fails >= FAILS_TO_STOP || Date.now() > stopAt) && !isCached(key, CHECK_MS)) { checks.push({ ...row, result: "Not checked", date: "" }); continue; }
      let asked = false;
      try {
        const r = await cached(key, CHECK_MS, async () => { asked = true; made++; return await searchSite(c, s.domain, keyword, from, to); });
        checks.push({ ...row, result: !r.found ? "No match" : r.date ? "Found" : "Found, no date", date: r.date });
        if (asked) fails = 0;
      } catch (e) {
        if (e instanceof FriendlyError) throw e;
        console.log(`[warn] coverage check: ${(e as Error).message}`);
        checks.push({ ...row, result: "Not checked", date: "" });
        fails++;
      }
      if (asked) await delay(SEARCH_GAP_MS);
    }
  } finally {
    countChecks(p.code, Math.min(0, made - needed)); // only searches really made count
    monthTotal = await addSearches(c, made).catch((e) => { console.log(`[warn] searches not counted: ${(e as Error).message}`); return 0; });
  }
  await keepChecks(c, p.code, checks, to).catch((e) => { console.log(`[warn] coverage checks not kept: ${(e as Error).message}`); });
  return { ready: true, why: "", from, to, left: Math.max(0, Math.min(checksLeft(p.code), c.searchesAMonth - monthTotal)), checks };
}
