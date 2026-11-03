// Street Surveys: asking people directly, on questions the authority chooses. Paper comes first, because most
// forms are completed by hand, and the same survey opens at a link on tablets.
//
//   1. An officer writes the purpose. Claude can suggest local questions and check their wording.
//   2. The plan sets sites, times and a target, with age and sex targets from Census 2021.
//   3. Opening the survey gives it an access code. Interviewers use that, not an FHRG account.
//   4. Answers arrive from tablets, the quick entry screen, a scan read by Claude, or a CSV file.
//   5. Claude takes names out of written comments and sorts them into topics. An officer checks a sample.
//   6. Results are weighted to the local population, and always labelled indicative.
//
// Files, under ROOT_FOLDER:
//   authorities/<code>/surveys/<id>.json             the survey: questions, plan and status
//   authorities/<code>/survey-answers/<id>.json      its answers
//   authorities/<code>/survey-sorts/<id>.json        the job that sorts its comments
//   authorities/<code>/survey-help/<job>.json        Claude's help with wording and scans, kept for a day at most
//   system/survey-codes/<ACCESS CODE>.json           which survey an access code opens
//
// A street sample isn't random, and groups under 30 people aren't reported. Written comments stay with the
// authority, and are held back from every page until their names have been taken out.

import type { Member } from "./accounts";
import type { Config } from "./config";
import { newJobId } from "./jobs";
import { refQuery } from "./library";
import type { Pilot } from "./pilots";
import { storageDelete, storageJson, storageList, storagePut, savePretty } from "./storage";
import { FriendlyError, cached, cleanLong, cleanText, londonToday, pickEnum, round, withLock } from "./util";

export const MAX_LOCAL = 5;
export const MIN_GROUP = 30;
export const WEIGHT_CAP = 5;
const MAX_ANSWERS = 5000;
const MAX_SITES = 40;
const DEFAULT_TARGET = 120; // four sites of 30
const DEFAULT_PER_SITE = 30;
const DEFAULT_PER_HOUR = 8;
const QUICK_SECS = 30;
const CURRENT_DAYS = 365; // an older survey is still evidence, but it no longer counts towards a change in mood
const DAY_MS = 24 * 60 * 60 * 1000;

export type Question = { id: string; text: string; kind: "choice" | "text"; options: string[]; part: "core" | "local" | "about" };

// The fixed core, so that results compare across time and authorities
export const CORE: Question[] = [
  { id: "c1", part: "core", kind: "choice", text: "How satisfied are you with the condition of roads and pavements around here?", options: ["Very satisfied", "Fairly satisfied", "Neither satisfied nor dissatisfied", "Fairly dissatisfied", "Very dissatisfied", "Don't know"] },
  { id: "c2", part: "core", kind: "choice", text: "Over the past year, have they got better, worse or stayed the same?", options: ["Better", "Stayed the same", "Worse", "Don't know"] },
  { id: "c3", part: "core", kind: "text", text: "What, if anything, have you seen or heard about roads recently, and where?", options: [] },
  { id: "c4", part: "core", kind: "choice", text: "Who do you think is responsible for this road?", options: ["The local council", "National Highways", "The Government", "A utility company or developer", "Don't know"] },
];
export const ABOUT: Question[] = [
  { id: "a1", part: "about", kind: "choice", text: "Which age group are you in?", options: ["16 to 24", "25 to 34", "35 to 44", "45 to 54", "55 to 64", "65 to 74", "75 or over", "Prefer not to say"] },
  { id: "a2", part: "about", kind: "choice", text: "Are you…", options: ["Female", "Male", "Prefer not to say"] },
  { id: "a3", part: "about", kind: "choice", text: "How do you mostly get around?", options: ["Car or van", "Bus or train", "Walking or wheelchair", "Cycling", "Something else"] },
  { id: "a4", part: "about", kind: "choice", text: "Do you have a health condition or disability that affects how you get around?", options: ["Yes", "No", "Prefer not to say"] },
];
export const AGES: [string, number, number][] = [["16 to 24", 16, 24], ["25 to 34", 25, 34], ["35 to 44", 35, 44], ["45 to 54", 45, 54], ["55 to 64", 55, 64], ["65 to 74", 65, 74], ["75 or over", 75, 200]] as const;

export const ACCESS_CHECKS = [
  "Permission from whoever owns or manages each site",
  "Level, step-free places to stand, out of the way of the footway and traffic",
  "A risk assessment for each site",
  "Identification and a contact number for every interviewer",
  "A way to take part for people who can't read the form, or who prefer another language",
  "Large-print forms to hand",
  "Times that reach people at work, older people and younger people, not only weekday mornings",
];

// A site picked on the map also holds the share of adults it stands for and its age targets (16 to 34, 35 to 64, 65+)
export type Site = { name: string; when: string; interviewers: string; share?: number; ages?: number[]; lat?: number; lng?: number };
export type Plan = {
  target: number; sites: Site[]; checks: string[];
  sure?: number; margin?: number; by?: "sites" | "whole" | "areas"; perSite?: number; perHour?: number;
};
export type Survey = {
  id: string; code: string; title: string; purpose: string; status: "draft" | "open" | "closed"; access: string; collector: string;
  locals: Question[]; plan: Plan;
  created: string; by: string; updated: string; openedBy: string; openedOn: string; closedOn: string; printedTo: number;
};
export type Answer = {
  n: number; form: string; via: "tablet" | "paper" | "scan" | "csv"; site: string; at: string; secs: number | null; client?: string;
  answers: Record<string, string>; topics: Record<string, string>; clean: Record<string, boolean>; checked: Record<string, boolean>; excluded?: boolean;
};

const surveyPath = (c: Config, code: string, id: string) => `${c.root}authorities/${code}/surveys/${id}.json`;
const answersPath = (c: Config, code: string, id: string) => `${c.root}authorities/${code}/survey-answers/${id}.json`;
export const sortPath = (c: Config, code: string, id: string) => `${c.root}authorities/${code}/survey-sorts/${id}.json`;
const accessPath = (c: Config, access: string) => `${c.root}system/survey-codes/${access}.json`;

export const allQuestions = (s: Pick<Survey, "locals">): Question[] => [...CORE, ...s.locals, ...ABOUT];

export async function loadSurvey(c: Config, code: string, id: string): Promise<Survey | null> {
  return await storageJson<Survey | null>(c, surveyPath(c, code, id), null);
}
export async function loadAnswers(c: Config, code: string, id: string): Promise<Answer[]> {
  const all = await storageJson<Answer[]>(c, answersPath(c, code, id), []);
  return Array.isArray(all) ? all : [];
}
export async function listSurveys(c: Config, code: string): Promise<Survey[]> {
  const names = (await storageList(c, `${c.root}authorities/${code}/surveys/`)).filter((n) => n.endsWith(".json")).sort().reverse();
  const all = await Promise.all(names.map((n) => loadSurvey(c, code, n.replace(/\.json$/, ""))));
  return all.filter((s): s is Survey => !!s);
}

export async function createSurvey(c: Config, me: Member, p: Pilot, b: Record<string, any>): Promise<Survey> {
  const title = cleanText(b.title, 120);
  if (!title) throw new FriendlyError("Give the survey a title.");
  const now = new Date().toISOString();
  const s: Survey = {
    id: newJobId(), code: p.code, title, purpose: cleanLong(b.purpose, 2000), status: "draft", access: "", collector: `${p.name} ${p.kind === "County council" ? "County Council" : "Council"}`,
    locals: [], plan: { target: DEFAULT_TARGET, sites: [], checks: [], sure: 90, margin: 10, by: "sites", perSite: DEFAULT_PER_SITE, perHour: DEFAULT_PER_HOUR }, created: now, by: me.name, updated: now, openedBy: "", openedOn: "", closedOn: "", printedTo: 0,
  };
  await savePretty(c, surveyPath(c, p.code, s.id), s);
  return s;
}

export function readLocals(v: unknown): Question[] {
  const list = Array.isArray(v) ? v : [];
  if (list.length > MAX_LOCAL) throw new FriendlyError(`A survey can have up to ${MAX_LOCAL} local questions.`);
  return list.map((q: any, i: number) => {
    const text = cleanText(q?.text, 200);
    if (!text) throw new FriendlyError(`Local question ${i + 1} has no wording.`);
    const kind = q?.kind === "text" ? "text" : "choice";
    const options = kind === "text" ? [] : (Array.isArray(q?.options) ? q.options : []).map((o: unknown) => cleanText(o, 80)).filter(Boolean).slice(0, 8);
    if (kind === "choice" && options.length < 2) throw new FriendlyError(`Local question ${i + 1} needs at least two answers to choose from.`);
    return { id: `l${i + 1}`, part: "local" as const, kind, text, options };
  });
}

const inRange = (v: unknown, lo: number, hi: number): number | undefined => {
  const n = typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n >= lo && n <= hi ? n : undefined;
};

function readSite(x: any): Site {
  const site: Site = { name: cleanText(x?.name, 80), when: cleanText(x?.when, 80), interviewers: cleanText(x?.interviewers, 80) };
  const share = inRange(x?.share, 0, 100), lat = inRange(x?.lat, 49, 61.5), lng = inRange(x?.lng, -9, 2.5);
  const ages = Array.isArray(x?.ages) ? x.ages.map((n: unknown) => inRange(n, 0, MAX_ANSWERS)).filter((n: number | undefined) => Number.isInteger(n)) : [];
  if (share !== undefined) site.share = share;
  if (ages.length === 3) site.ages = ages;
  if (lat !== undefined && lng !== undefined) { site.lat = lat; site.lng = lng; }
  return site;
}

function readPlan(b: any, was: Plan): Plan {
  const target = Number(b?.target);
  if (b?.target !== undefined && !(Number.isInteger(target) && target >= MIN_GROUP && target <= MAX_ANSWERS)) throw new FriendlyError(`Aim for between ${MIN_GROUP} and ${MAX_ANSWERS.toLocaleString("en-GB")} replies.`);
  return {
    target: b?.target === undefined ? was.target : target,
    sites: (Array.isArray(b?.sites) ? b.sites : []).map(readSite).filter((x: Site) => x.name).slice(0, MAX_SITES),
    checks: (Array.isArray(b?.checks) ? b.checks : []).filter((x: unknown) => ACCESS_CHECKS.includes(x as string)),
    sure: [90, 95, 99].includes(b?.sure) ? b.sure : was.sure,
    margin: [3, 5, 7, 10].includes(b?.margin) ? b.margin : was.margin,
    by: ["sites", "whole", "areas"].includes(b?.by) ? b.by : was.by,
    perSite: Number.isInteger(inRange(b?.perSite, 5, 500)) ? b.perSite : was.perSite,
    perHour: Number.isInteger(inRange(b?.perHour, 1, 60)) ? b.perHour : was.perHour,
  };
}

// Questions can only change while a survey is a draft, as they decide what every answer means. The plan can
// change at any time, because sites and times often do.
export async function saveSurvey(c: Config, s: Survey, b: Record<string, any>): Promise<Survey> {
  return await withLock(surveyPath(c, s.code, s.id), async () => {
    const now = (await loadSurvey(c, s.code, s.id)) as Survey;
    // Sites decide how replies are weighted, so a closed survey's are fixed and its results stay as they are
    if (b.plan) now.plan = { ...readPlan(b.plan, now.plan), ...(now.status === "closed" ? { sites: now.plan.sites } : {}) };
    if (typeof b.collector === "string") now.collector = cleanText(b.collector, 160) || now.collector;
    if (Number.isInteger(b.printedTo) && b.printedTo > 0 && b.printedTo < 1e7) now.printedTo = Math.max(now.printedTo || 0, b.printedTo);
    if (now.status === "draft") {
      if (typeof b.title === "string") now.title = cleanText(b.title, 120) || now.title;
      if (typeof b.purpose === "string") now.purpose = cleanLong(b.purpose, 2000);
      if (b.locals !== undefined) now.locals = readLocals(b.locals);
    } else if (b.locals !== undefined || typeof b.title === "string") throw new FriendlyError("This survey is open or closed, so its questions can't change.");
    now.updated = new Date().toISOString();
    await savePretty(c, surveyPath(c, s.code, s.id), now);
    return now;
  });
}

// Easy to read aloud and to type on a tablet: no 0, O, 1, I or L
const ACCESS_LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function newAccess(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => ACCESS_LETTERS[b % ACCESS_LETTERS.length]).join("");
}
export const validAccess = (v: unknown): v is string => typeof v === "string" && /^[A-HJKMNP-Z2-9]{8}$/.test(v);

export async function openSurvey(c: Config, me: Member, s: Survey): Promise<Survey> {
  return await withLock(surveyPath(c, s.code, s.id), async () => {
    const now = (await loadSurvey(c, s.code, s.id)) as Survey;
    if (now.status === "open") return now;
    if (!now.access) {
      now.access = newAccess();
      await savePretty(c, accessPath(c, now.access), { code: now.code, id: now.id });
    }
    now.status = "open"; now.closedOn = "";
    if (!now.openedOn) { now.openedBy = me.name; now.openedOn = londonToday(); }
    now.updated = new Date().toISOString();
    await savePretty(c, surveyPath(c, s.code, s.id), now);
    return now;
  });
}

export async function closeSurvey(c: Config, s: Survey): Promise<Survey> {
  return await withLock(surveyPath(c, s.code, s.id), async () => {
    const now = (await loadSurvey(c, s.code, s.id)) as Survey;
    now.status = "closed"; now.closedOn = londonToday(); now.updated = new Date().toISOString();
    await savePretty(c, surveyPath(c, s.code, s.id), now);
    return now;
  });
}

// Before anyone has answered, questions can still be changed. Afterwards they can't, so answers keep their
// meaning. The code goes too, because a tablet with no signal could still hold forms for the old questions.
export async function backToDraft(c: Config, s: Survey): Promise<Survey> {
  return await withLock(surveyPath(c, s.code, s.id), async () => {
    if ((await loadAnswers(c, s.code, s.id)).length) throw new FriendlyError("This survey has answers, so it can't go back to a draft.");
    const now = (await loadSurvey(c, s.code, s.id)) as Survey;
    if (now.access) await storageDelete(c, accessPath(c, now.access));
    now.status = "draft"; now.access = ""; now.updated = new Date().toISOString();
    await savePretty(c, surveyPath(c, s.code, s.id), now);
    return now;
  });
}

export async function surveyByAccess(c: Config, access: string): Promise<Survey | null> {
  const where = await storageJson<{ code?: string; id?: string } | null>(c, accessPath(c, access), null);
  return where?.code && where.id ? await loadSurvey(c, where.code, where.id) : null;
}

// All that a tablet is given: never the officer's purpose, the authority's plan or anyone's answers
export const publicSurvey = (s: Survey) => ({ title: s.title, collector: s.collector, sites: s.plan.sites.map((x) => x.name), questions: allQuestions(s) });

// ----- answers

// Takes what was sent and keeps only real answers to this survey's questions. A choice can be its words or its
// number on the form. Anything else comes back in `problems`, so a person can look at it.
export function readAnswers(s: Pick<Survey, "locals">, raw: unknown): { answers: Record<string, string>; problems: string[] } {
  const got = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const answers: Record<string, string> = {};
  const problems: string[] = [];
  for (const q of allQuestions(s)) {
    const v = got[q.id];
    if (v === undefined || v === null || v === "") continue;
    if (q.kind === "text") { const t = cleanLong(v, 1000); if (t) answers[q.id] = t; continue; }
    const said = String(v).trim();
    const picked = pickEnum(q.options, said) ?? (/^\d+$/.test(said) ? q.options[Number(said) - 1] : undefined);
    if (picked) answers[q.id] = picked; else problems.push(`${q.text} "${said.slice(0, 40)}" isn't one of the answers.`);
  }
  return { answers, problems };
}

// Form 0012, form 12 and "Form 12" are the same form
export const formNumber = (v: unknown) => cleanText(v, 30).replace(/^(?:form|no\.?|number)\s*/i, "").replace(/^0+(?=\d)/, "").slice(0, 20).toUpperCase();

export type Incoming = { form?: unknown; site?: unknown; answers?: unknown; secs?: unknown; client?: unknown };

// One writer at a time, so forms arriving together all count. A tablet can safely send the same form twice:
// each carries its own id, and one that has already arrived is skipped. `done` lists the ids Clarion has dealt
// with, so a tablet only ever forgets a form that really arrived.
export async function addAnswers(c: Config, s: Survey, items: Incoming[], via: Answer["via"]): Promise<{ added: number; skipped: number; problems: string[]; done: string[] }> {
  const path = answersPath(c, s.code, s.id);
  return await withLock(path, async () => {
    const all = await loadAnswers(c, s.code, s.id);
    // a form left out can be entered again, which is how a mistake on one gets put right
    const forms = new Set(all.filter((a) => !a.excluded).map((a) => a.form)), clients = new Set(all.map((a) => a.client).filter(Boolean));
    let next = all.reduce((most, a) => Math.max(most, a.n), 0) + 1, added = 0, skipped = 0;
    const problems: string[] = [], done: string[] = [];
    for (const item of items) {
      const client = cleanText(item?.client, 60);
      if (client && clients.has(client)) { skipped++; done.push(client); continue; }
      if (all.length >= MAX_ANSWERS) { problems.push(`This survey has reached its limit of ${MAX_ANSWERS} answers.`); break; }
      while (via === "tablet" && forms.has(`T${next}`)) next++;
      const form = via === "tablet" ? `T${next}` : formNumber(item?.form); // a tablet can't take a paper form's number
      if (!form) { problems.push("A form has no number."); continue; }
      if (forms.has(form)) { problems.push(`Form ${form} has already been entered.`); continue; }
      const read = readAnswers(s, item?.answers);
      problems.push(...read.problems.map((x) => `Form ${form}: ${x}`));
      if (!Object.keys(read.answers).length) { problems.push(`Form ${form} has no answers.`); if (client) done.push(client); continue; }
      const secs = Number(item?.secs);
      all.push({ n: next++, form, via, site: cleanText(item?.site, 80), at: new Date().toISOString(), secs: item?.secs !== undefined && item.secs !== null && Number.isFinite(secs) && secs >= 0 ? Math.round(secs) : null, ...(client ? { client } : {}), answers: read.answers, topics: {}, clean: {}, checked: {} });
      forms.add(form);
      if (client) { clients.add(client); done.push(client); }
      added++;
    }
    if (added) await storagePut(c, path, JSON.stringify(all));
    return { added, skipped, problems, done };
  });
}

export async function changeAnswer(c: Config, s: Survey, n: number, change: (a: Answer) => void): Promise<void> {
  const path = answersPath(c, s.code, s.id);
  await withLock(path, async () => {
    const all = await loadAnswers(c, s.code, s.id);
    const a = all.find((x) => x.n === n);
    if (!a) throw new FriendlyError("That form wasn't found.", 404);
    change(a);
    await storagePut(c, path, JSON.stringify(all));
  });
}

export async function changeAnswers(c: Config, s: Survey, change: (all: Answer[]) => void): Promise<void> {
  const path = answersPath(c, s.code, s.id);
  await withLock(path, async () => {
    const all = await loadAnswers(c, s.code, s.id);
    change(all);
    await storagePut(c, path, JSON.stringify(all));
  });
}

// A small CSV reader: quoted fields, doubled quotes, and line breaks inside quotes. A quote mark only opens a
// quoted field at the start of one, so a stray one can't swallow the rows after it.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { field += '"'; i++; } else if (ch === '"') quoted = false; else field += ch;
    } else if (ch === '"' && !field) quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (quoted) throw new FriendlyError("The file has a quote mark that's never closed, so it can't be read safely. Check it and try again.");
  row.push(field);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

// A file with a heading row: form, site, then one column for each question id
export function readCsv(text: string): Incoming[] {
  const [head, ...rows] = parseCsv(text);
  const names = (head ?? []).map((x) => x.trim().toLowerCase());
  if (!names.includes("form")) throw new FriendlyError("The file needs a column called form. Download the template to see the layout.");
  return rows.map((r) => {
    const at = (name: string) => r[names.indexOf(name)] ?? "";
    return { form: at("form"), site: names.includes("site") ? at("site") : "", answers: Object.fromEntries(names.map((name, i) => [name, r[i]]).filter(([name]) => name !== "form" && name !== "site")) };
  });
}

// ----- targets and weights, from Census 2021

export type Census = { cells: Record<string, number>; adults: number };
export const cellKey = (age: string, sex: string) => `${age}|${sex}`;
const ageBand = (from: number) => AGES.find(([, a, b]) => from >= a && from <= b)?.[0];

export async function loadCensus(c: Config, code: string): Promise<Census | null> {
  try {
    return await cached(`census|${code}`, DAY_MS, async () => {
      const r = await refQuery(c, "SELECT age_from, sex, SUM(people) AS people FROM census_age_sex_la WHERE la_code = ? AND age_from >= 16 GROUP BY age_from, sex", [code]);
      const cells: Record<string, number> = {};
      for (const x of r.rows) {
        const band = ageBand(Number(x.age_from));
        if (band) cells[cellKey(band, String(x.sex))] = (cells[cellKey(band, String(x.sex))] || 0) + Number(x.people);
      }
      const adults = Object.values(cells).reduce((sum, n) => sum + n, 0);
      return adults ? { cells, adults } : null;
    });
  } catch (e) {
    console.log(`[warn] Census for ${code}: ${(e as Error).message}`);
    return null;
  }
}

export function ageSexTargets(census: Census | null, target: number): { age: string; female: number; male: number }[] {
  if (!census) return [];
  const share = (age: string, sex: string) => Math.round(((census.cells[cellKey(age, sex)] || 0) / census.adults) * target);
  return AGES.map(([age]) => ({ age, female: share(age, "Female"), male: share(age, "Male") }));
}

// Each age and sex group counts for its share of local adults. People who didn't say keep a weight of 1, and no
// one counts for more than WEIGHT_CAP people, so a few replies in a rare group can't swing a result. What the
// cap takes off is spread over everyone else in those groups, so they keep their fair share of the total.
function weightsByPeople(rows: Answer[], census: Census | null): { weights: Map<number, number>; weighted: boolean } {
  const weights = new Map<number, number>(rows.map((r) => [r.n, 1]));
  const key = (r: Answer) => cellKey(r.answers.a1 ?? "", r.answers.a2 ?? "");
  const known = rows.filter((r) => census?.cells[key(r)]);
  if (!census || known.length < MIN_GROUP) return { weights, weighted: false };
  const seen = new Map<string, number>();
  for (const r of known) seen.set(key(r), (seen.get(key(r)) || 0) + 1);
  const coveredPeople = [...seen.keys()].reduce((sum, k) => sum + (census.cells[k] || 0), 0);
  let w = known.map((r) => ((census.cells[key(r)] / coveredPeople) * known.length) / (seen.get(key(r)) as number));
  for (let round = 0; round < 20 && w.some((x) => x > WEIGHT_CAP + 1e-9); round++) {
    const atCap = w.filter((x) => x >= WEIGHT_CAP).length;
    const room = known.length - atCap * WEIGHT_CAP, rest = w.filter((x) => x < WEIGHT_CAP).reduce((sum, x) => sum + x, 0);
    w = w.map((x) => (x >= WEIGHT_CAP ? WEIGHT_CAP : room > 0 && rest > 0 ? (x * room) / rest : x));
  }
  known.forEach((r, i) => weights.set(r.n, Math.min(WEIGHT_CAP, w[i])));
  return { weights, weighted: true };
}

// Each site then counts for the share of adults it stands for, however many people were asked there, without
// undoing the balance of age and sex: the two are adjusted in turn until both settle. Sites with no share, such as
// one added by hand, are left as they are. The cap still holds, so a site with very few replies can fall short.
const siteKey = (name: string) => name.trim().toLowerCase();
const BALANCING_ROUNDS = 6;
export function weightsFor(rows: Answer[], census: Census | null, sites: Site[] = []): { weights: Map<number, number>; weighted: boolean; bySite: boolean } {
  const { weights, weighted } = weightsByPeople(rows, census);
  const shares = new Map(sites.filter((x) => x.share).map((x) => [siteKey(x.name), x.share as number]));
  const placed = rows.filter((r) => shares.has(siteKey(r.site)));
  const seen = [...new Set(placed.map((r) => siteKey(r.site)))];
  if (seen.length < 2 || placed.length < MIN_GROUP) return { weights, weighted, bySite: false };
  const wanted = seen.reduce((sum, name) => sum + (shares.get(name) as number), 0);
  const sumOf = (list: Answer[]) => list.reduce((sum, r) => sum + (weights.get(r.n) as number), 0);
  const groupOf = (r: Answer) => cellKey(r.answers.a1 ?? "", r.answers.a2 ?? "");
  const groups = weighted ? [...new Set(rows.map(groupOf))].map((key) => { const list = rows.filter((r) => groupOf(r) === key); return { list, aim: sumOf(list) }; }) : [];
  for (let round = 0; round < BALANCING_ROUNDS; round++) {
    const total = sumOf(placed);
    for (const name of seen) {
      const here = placed.filter((r) => siteKey(r.site) === name), factor = (((shares.get(name) as number) / wanted) * total) / sumOf(here);
      for (const r of here) weights.set(r.n, (weights.get(r.n) as number) * factor);
    }
    for (const g of groups) {
      const factor = g.aim / (sumOf(g.list) || 1);
      for (const r of g.list) weights.set(r.n, (weights.get(r.n) as number) * factor);
    }
  }
  for (const r of rows) weights.set(r.n, Math.min(WEIGHT_CAP, weights.get(r.n) as number));
  return { weights, weighted, bySite: true };
}

// ----- results

export type OptionResult = { label: string; count: number; pct: number };
export type QuestionResult = { id: string; text: string; answered: number; range: number | null; options: OptionResult[]; held: boolean };
export type GroupResult = { group: string; label: string; answered: number; satisfied: number | null; dissatisfied: number | null };
export type Results = {
  total: number; used: number; excluded: number; weighted: boolean; bySite: boolean; questions: QuestionResult[]; groups: GroupResult[]; bySource: Record<string, number>; targetMet: { age: string; got: number; want: number }[];
};

const SATISFIED = new Set(["Very satisfied", "Fairly satisfied"]);
const DISSATISFIED = new Set(["Fairly dissatisfied", "Very dissatisfied"]);
// The range a random sample of this size would give, which a street sample can only be a guide to
export const likelyRange = (pct: number, n: number) => (n ? round(1.96 * Math.sqrt(((pct / 100) * (1 - pct / 100)) / n) * 100, 0) : null);
// Uneven weights mean a sample tells you less than its size suggests
const effectiveSize = (w: number[]) => { const sum = w.reduce((a, b) => a + b, 0), squares = w.reduce((a, b) => a + b * b, 0); return squares ? (sum * sum) / squares : 0; };

export function surveyResults(s: Pick<Survey, "locals" | "plan">, rows: Answer[], census: Census | null): Results {
  const used = rows.filter((r) => !r.excluded);
  const { weights, weighted, bySite } = weightsFor(used, census, s.plan.sites);
  const weightOf = (r: Answer) => weights.get(r.n) ?? 1;
  const questions = allQuestions(s).filter((q) => q.kind === "choice").map((q): QuestionResult => {
    const answered = used.filter((r) => r.answers[q.id]);
    const totalWeight = answered.reduce((sum, r) => sum + weightOf(r), 0);
    const held = answered.length < MIN_GROUP;
    const options = held ? [] : q.options.map((label) => {
      const those = answered.filter((r) => r.answers[q.id] === label);
      return { label, count: those.length, pct: round((those.reduce((sum, r) => sum + weightOf(r), 0) / (totalWeight || 1)) * 100) };
    });
    const top = Math.max(0, ...options.map((o) => o.pct));
    return { id: q.id, text: q.text, answered: answered.length, held, options, range: held ? null : likelyRange(top, effectiveSize(answered.map(weightOf))) };
  });
  const groups: GroupResult[] = [];
  const breakdown = (group: string, of: (r: Answer) => string, labels: string[]) => {
    for (const label of labels) {
      const those = used.filter((r) => of(r) === label && r.answers.c1); // Don't know counts, as it does in the headline
      const enough = those.length >= MIN_GROUP;
      if (!enough && group === "Site") continue; // a site's name is only worth showing once it has a result
      const pct = (set: Set<string>) => (enough ? round((those.filter((r) => set.has(r.answers.c1)).reduce((sum, r) => sum + weightOf(r), 0) / (those.reduce((sum, r) => sum + weightOf(r), 0) || 1)) * 100) : null);
      groups.push({ group, label, answered: those.length, satisfied: pct(SATISFIED), dissatisfied: pct(DISSATISFIED) });
    }
  };
  breakdown("Age", (r) => r.answers.a1, ABOUT[0].options.slice(0, -1));
  breakdown("How people get around", (r) => r.answers.a3, ABOUT[2].options);
  breakdown("Health condition or disability", (r) => r.answers.a4, ["Yes", "No"]);
  breakdown("Site", (r) => r.site, [...new Set(used.map((r) => r.site).filter(Boolean))]);
  const bySource: Record<string, number> = {};
  for (const r of used) bySource[r.via] = (bySource[r.via] || 0) + 1;
  const wanted = ageSexTargets(census, s.plan.target);
  const targetMet = wanted.map((w) => ({ age: w.age, want: w.female + w.male, got: used.filter((r) => r.answers.a1 === w.age).length }));
  return { total: rows.length, used: used.length, excluded: rows.length - used.length, weighted, bySite, questions, groups, bySource, targetMet };
}

// Things a person should look at. Nothing is removed automatically, and matching replies can be genuine.
export function findProblems(s: Pick<Survey, "locals">, rows: Answer[]): { n: number; form: string; why: string }[] {
  const ids = textQuestionIds(s);
  const out: { n: number; form: string; why: string }[] = [];
  const written = new Map<string, Answer>();
  let run = 1, last = "";
  for (const r of rows) {
    if (r.excluded) continue;
    if (r.secs !== null && r.secs < QUICK_SECS) out.push({ n: r.n, form: r.form, why: `Completed in under ${QUICK_SECS} seconds.` });
    if (Object.keys(r.answers).length < 3) out.push({ n: r.n, form: r.form, why: "Very few questions answered." });
    const pattern = JSON.stringify(Object.entries(r.answers).sort());
    run = pattern === last ? run + 1 : 1;
    last = pattern;
    if (run >= 3) out.push({ n: r.n, form: r.form, why: `The same answers as the ${run - 1} forms before it.` });
    for (const id of ids) {
      const t = r.answers[id];
      if (!t || t.length < 20) continue;
      const twin = written.get(t);
      if (twin) out.push({ n: r.n, form: r.form, why: `The same written answer as form ${twin.form}.` }); else written.set(t, r);
    }
  }
  return out;
}

// A spreadsheet treats a cell that starts with one of these as a formula, and anything a resident wrote is
// untrusted, so a leading mark keeps it as text.
function csvCell(v: unknown): string {
  const s = String(v ?? "");
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
const csvLine = (cells: unknown[]) => cells.map(csvCell).join(",");

export const templateCsv = (s: Pick<Survey, "locals">) => `${csvLine(["form", "site", ...allQuestions(s).map((q) => q.id)])}\n`;

// One row for each form used. Comments appear only once their names have been taken out, and only for the
// authority's own members.
export function answersCsv(s: Pick<Survey, "locals"> & Partial<Pick<Survey, "plan">>, rows: Answer[], census: Census | null, withComments: boolean): string {
  const used = rows.filter((r) => !r.excluded);
  const { weights } = weightsFor(used, census, s.plan?.sites);
  const qs = allQuestions(s);
  const line = (r: Answer) => csvLine([r.form, r.site, r.via, round(weights.get(r.n) ?? 1, 3), ...qs.map((q) => (q.kind === "text" && (!withComments || !r.clean?.[q.id]) ? "" : r.answers[q.id] ?? ""))]);
  return `${[csvLine(["form", "site", "entered_by", "weight", ...qs.map((q) => q.id)]), ...used.map(line)].join("\n")}\n`;
}

// ----- written comments

export type Comment = { n: number; form: string; question: string; id: string; text: string; topic: string; checked: boolean };

export function textQuestionIds(s: Pick<Survey, "locals">): string[] {
  return allQuestions(s).filter((q) => q.kind === "text").map((q) => q.id);
}

// Only comments that have had their names taken out ever leave this file
export function cleanComments(s: Pick<Survey, "locals">, rows: Answer[]): Comment[] {
  const ids = textQuestionIds(s);
  const out: Comment[] = [];
  for (const r of rows) for (const id of ids) {
    if (r.answers[id] && r.clean?.[id]) out.push({ n: r.n, form: r.form, id, question: allQuestions(s).find((q) => q.id === id)?.text ?? "", text: r.answers[id], topic: r.topics?.[id] ?? "Other", checked: !!r.checked?.[id] });
  }
  return out;
}

export const waitingComments = (s: Pick<Survey, "locals">, rows: Answer[]) => {
  const ids = textQuestionIds(s);
  return rows.reduce((sum, r) => sum + ids.filter((id) => r.answers[id] && !r.clean?.[id]).length, 0);
};

// One comment in ten, for an officer to check
export const commentSample = (all: Comment[]) => all.filter((_, i) => i % 10 === 0);

export function topicCounts(all: Comment[]): { topic: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const x of all) counts.set(x.topic, (counts.get(x.topic) || 0) + 1);
  return [...counts].map(([topic, count]) => ({ topic, count })).sort((a, b) => b.count - a.count);
}

// ----- for readings and the page

export type StreetSummary = {
  title: string; id: string; status: string; ran: string; current: boolean; responses: number; weighted: boolean; satisfied: number | null; dissatisfied: number | null; better: number | null; worse: number | null;
  blameCouncil: number | null; topics: { topic: string; count: number }[]; note: string;
};

const pctOf = (r: Results, id: string, labels: string[]) => {
  const q = r.questions.find((x) => x.id === id);
  return !q || q.held ? null : round(q.options.filter((o) => labels.includes(o.label)).reduce((sum, o) => sum + o.pct, 0));
};

// A survey with enough answers to the main question to report. Figures and topic counts only: residents' words
// stay on the survey's own page.
export function summarise(s: Survey, all: Answer[], census: Census | null): StreetSummary | null {
  const rows = all.filter((r) => !r.excluded);
  const results = surveyResults(s, rows, census);
  const satisfied = pctOf(results, "c1", [...SATISFIED]);
  if (satisfied === null) return null;
  return {
    title: s.title, id: s.id, status: s.status, ran: s.openedOn, current: Date.now() - Date.parse(s.updated) < CURRENT_DAYS * DAY_MS, responses: results.used, weighted: results.weighted,
    satisfied, dissatisfied: pctOf(results, "c1", [...DISSATISFIED]), better: pctOf(results, "c2", ["Better"]), worse: pctOf(results, "c2", ["Worse"]), blameCouncil: pctOf(results, "c4", ["The local council"]),
    topics: topicCounts(cleanComments(s, rows)),
    note: "A street sample, not a random one, so this is indicative only.",
  };
}

export async function streetSummaries(c: Config, code: string): Promise<StreetSummary[]> {
  const surveys = (await listSurveys(c, code)).filter((s) => s.status !== "draft");
  if (!surveys.length) return [];
  const census = await loadCensus(c, code);
  const out: StreetSummary[] = [];
  for (const s of surveys) {
    const summary = summarise(s, await loadAnswers(c, code, s.id), census);
    if (summary) out.push(summary);
  }
  return out.sort((a, b) => b.ran.localeCompare(a.ran)); // the latest to go into the field comes first
}

// Everything a survey's page shows. `edit`: a lead or site administrator. `own`: a member of the authority, the
// only people who get the words of a comment. Topic counts go to everyone who can see the survey.
export function surveyPage(s: Survey, rows: Answer[], census: Census | null, edit: boolean, own: boolean, areas = 0) {
  const used = rows.filter((r) => !r.excluded);
  const cleaned = cleanComments(s, used);
  const comments = own ? cleaned : [];
  const numbers = rows.map((r) => Number(r.form)).filter(Number.isInteger);
  return {
    survey: edit ? s : { ...s, access: "" }, canEdit: edit, core: CORE, about: ABOUT, maxLocal: MAX_LOCAL, questions: allQuestions(s), accessChecks: ACCESS_CHECKS,
    template: edit ? templateCsv(s) : "",
    census: census ? { adults: census.adults } : null, areas, targets: ageSexTargets(census, s.plan.target),
    results: surveyResults(s, rows, census), topics: topicCounts(cleaned), comments, ownComments: own, waiting: waitingComments(s, used),
    problems: edit ? findProblems(s, rows) : [], excluded: edit ? rows.filter((r) => r.excluded).map((r) => ({ n: r.n, form: r.form })) : [],
    sample: edit && own ? commentSample(comments) : [], nextForm: numbers.length ? Math.max(...numbers) + 1 : 1,
  };
}
