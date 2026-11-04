// High-impact issues, campaigns and actions. Clarion proposes issues by a calculation on concern, reach and mood, and an
// officer confirms them and can add their own. A campaign is aligned with one topic and holds its key messages, its dates
// and a budget, which an officer sets: it's separate from the total of the campaign's actions, so the two can be compared.
// An action is diarised by date and channel, with a planned cost and, once it's known, an actual cost. Each action
// belongs to at most one campaign, so its cost can't count twice, and falls within the campaign's dates unless the
// campaign is Ongoing. An ongoing campaign has a budget for each financial year and a review date.
//
// The election setting holds all of this back: nothing here is shown or changed while it's on, except that an officer
// can still add the actual cost of an action already held. Money stays with the authority's own members.
//
// File, under ROOT_FOLDER: authorities/<code>/campaign.json

import type { Config } from "./config";
import { savePretty, storageJson } from "./storage";
import { FriendlyError, cleanLong, cleanText, londonToday, withLock } from "./util";

export type Issue = { topic: string; status: "confirmed" | "aside"; key: string; service: string; own: boolean; by: string; at: string }; // key: from before campaigns, and starts a campaign's messages
export type Campaign = {
  id: string; name: string; topic: string; service: string; messages: string[]; start: string; end: string; ongoing: boolean; review: string;
  budget: number | null; budgets: Record<string, number>; by: string; at: string;
};
export type Action = {
  id: string; title: string; date: string; channel: string; topics: string[]; service: string; origin: string; survey: string; campaign: string;
  planned: number | null; actual: number | null; by: string; at: string;
};
export type Plans = { issues: Issue[]; campaigns: Campaign[]; actions: Action[] };

const MAX_ISSUES = 60;
const MAX_CAMPAIGNS = 100;
const MAX_ACTIONS = 500;
const MAX_MESSAGES = 5;
const MAX_COST = 100_000_000;
const KEY_CHARS = 600;
const TITLE_CHARS = 140;
const NAME_CHARS = 120;
const path = (c: Config, code: string) => `${c.root}authorities/${code}/campaign.json`;
const newId = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function readDate(v: unknown, words: string): string {
  const date = String(v ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date))) throw new FriendlyError(words);
  return date;
}
export function readCost(v: unknown): number | null {
  const typed = typeof v === "number" ? v : String(v ?? "").replace(/[£,\s]/g, "");
  if (typed === "") return null;
  const n = Number(typed);
  if (!Number.isFinite(n) || n < 0 || n > MAX_COST) throw new FriendlyError("Give a cost in pounds, such as 1,500.");
  return Math.round(n * 100) / 100;
}

export async function loadPlans(c: Config, code: string): Promise<Plans> {
  const held = await storageJson<Partial<Plans> & { items?: Partial<Action>[] }>(c, path(c, code), {});
  const actions = (Array.isArray(held.actions) ? held.actions : Array.isArray(held.items) ? held.items : []) as Action[]; // files from before campaigns called these items
  return {
    issues: Array.isArray(held.issues) ? held.issues : [], campaigns: Array.isArray(held.campaigns) ? held.campaigns : [],
    actions: actions.map((x) => ({ ...x, campaign: x.campaign ?? "", planned: x.planned ?? null, actual: x.actual ?? null })),
  };
}
const change = <T>(c: Config, code: string, fn: (held: Plans) => T): Promise<T> => withLock(path(c, code), async () => {
  const held = await loadPlans(c, code);
  const out = fn(held);
  await savePretty(c, path(c, code), held);
  return out;
});

export const held = (plans: Plans, onElection: boolean): Plans => (onElection ? { issues: plans.issues.map((x) => ({ ...x, key: "" })), campaigns: [], actions: [] } : plans);

/** Confirms an issue, sets it aside, or changes it. */
export function setIssue(c: Config, code: string, b: any, service: string, by: string): Promise<Issue> {
  const topic = cleanText(b?.topic, 80);
  if (!topic) throw new FriendlyError("Say what the issue is.");
  const status = b?.status === "aside" ? "aside" : "confirmed";
  return change(c, code, (all) => {
    const was = all.issues.find((x) => x.topic === topic && x.service === service);
    if (!was && all.issues.length >= MAX_ISSUES) throw new FriendlyError(`An authority can hold up to ${MAX_ISSUES} issues.`);
    const issue: Issue = { topic, status, key: cleanLong(b?.key ?? was?.key ?? "", KEY_CHARS), service, own: was?.own ?? b?.own === true, by, at: new Date().toISOString() };
    all.issues = was ? all.issues.map((x) => (x === was ? issue : x)) : [...all.issues, issue];
    return issue;
  });
}
export function dropIssue(c: Config, code: string, topic: unknown, service: string): Promise<void> {
  return change(c, code, (all) => { all.issues = all.issues.filter((x) => !(x.topic === topic && x.service === service)); });
}

/** Only the authority's own members handle money, so anyone else's save leaves it as it was. */
export function saveCampaign(c: Config, code: string, b: any, service: string, by: string, money: boolean): Promise<Campaign> {
  const name = cleanText(b?.name, NAME_CHARS), topic = cleanText(b?.topic, 80);
  if (!name) throw new FriendlyError("Give the campaign a name.");
  if (!topic) throw new FriendlyError("Choose the topic this campaign is aligned with.");
  const typed = Array.isArray(b?.messages) ? b.messages : [];
  if (typed.some((t: unknown) => String(t ?? "").trim().length > KEY_CHARS)) throw new FriendlyError(`Keep each key message to ${KEY_CHARS} letters.`);
  const messages = typed.map((t: unknown) => cleanLong(t, KEY_CHARS)).filter(Boolean);
  if (messages.length > MAX_MESSAGES) throw new FriendlyError(`A campaign can hold up to ${MAX_MESSAGES} key messages.`);
  const ongoing = b?.ongoing === true, start = readDate(b?.start, "Give the campaign a start date.");
  const end = ongoing ? "" : readDate(b?.end, "Give the campaign an end date, or mark it as ongoing.");
  if (!ongoing && end < start) throw new FriendlyError("A campaign can't end before it starts.");
  const review = ongoing ? readDate(b?.review, "Give an ongoing campaign a review date, so it doesn't run on unchecked.") : "";
  const budget = readCost(b?.budget), budgets = Object.fromEntries(Object.entries(b?.budgets && typeof b.budgets === "object" ? b.budgets : {}).filter(([k]) => /^\d{4}-\d{2}$/.test(k)).slice(0, 30).flatMap(([k, v]) => { const n = readCost(v); return n === null ? [] : [[k, n]]; }));
  return change(c, code, (all) => {
    const was = b?.id ? all.campaigns.find((x) => x.id === b.id && x.service === service) : null;
    if (b?.id && !was) throw new FriendlyError("That campaign wasn't found.", 404);
    if (!was && all.campaigns.length >= MAX_CAMPAIGNS) throw new FriendlyError(`An authority can hold up to ${MAX_CAMPAIGNS} campaigns.`);
    const outside = !was || ongoing ? [] : all.actions.filter((x) => x.campaign === was.id && (x.date < start || x.date > end));
    if (outside.length) throw new FriendlyError(`Those dates would leave ${outside.length === 1 ? "this action" : "these actions"} outside the campaign, so move ${outside.length === 1 ? "it" : "them"} first: ${outside.slice(0, 5).map((x) => `${x.title} (${day(x.date)})`).join(", ")}${outside.length > 5 ? ", and more" : ""}.`);
    const campaign: Campaign = {
      id: was?.id ?? newId(), name, topic, service, messages, start, end, ongoing, review, budget: money ? budget : was?.budget ?? null, budgets: money ? budgets : was?.budgets ?? {},
      by: was?.by ?? by, at: was?.at ?? londonToday(),
    };
    all.campaigns = was ? all.campaigns.map((x) => (x === was ? campaign : x)) : [...all.campaigns, campaign];
    return campaign;
  });
}
const HOLDS_MONEY = "This holds money, so only the authority's own members can take it out.";
export function removeCampaign(c: Config, code: string, id: unknown, money: boolean): Promise<void> {
  return change(c, code, (all) => {
    const was = all.campaigns.find((x) => x.id === id), n = all.actions.filter((x) => x.campaign === id).length;
    if (!money && was && (was.budget !== null || Object.keys(was.budgets).length)) throw new FriendlyError(HOLDS_MONEY, 403);
    if (n) throw new FriendlyError(`Move or take out its ${n === 1 ? "action" : `${n} actions`} first, so no costs are lost.`);
    all.campaigns = all.campaigns.filter((x) => x.id !== id);
  });
}

/** Each message on a survey shows on the calendar under its topic, on the channel for street surveys if there is one. */
export function syncTell(c: Config, code: string, survey: { id: string; title: string; service?: string; tell?: { topic: string }[] }, service: string, channel: string, by: string): Promise<void> {
  const wanted = [...new Set((survey.tell ?? []).map((m) => m.topic).filter(Boolean))], origin = `Message on the survey: ${survey.title}`, today = londonToday();
  return change(c, code, (all) => {
    const theirs = (x: Action) => x.survey === survey.id && x.origin.startsWith("Message on the survey");
    all.actions = all.actions.filter((x) => !theirs(x) || x.topics.some((t) => wanted.includes(t)) || x.planned !== null || x.actual !== null); // costs are never lost by changing a survey
    for (const topic of wanted) {
      if (all.actions.some((x) => theirs(x) && x.topics.includes(topic)) || all.actions.length >= MAX_ACTIONS) continue;
      const running = all.campaigns.find((x) => x.topic === topic && x.service === service && (x.ongoing || (today >= x.start && today <= x.end)));
      all.actions.push({ id: newId(), title: `${topic}: told on the survey`.slice(0, TITLE_CHARS), date: today, channel, topics: [topic], service, origin, survey: survey.id, campaign: running?.id ?? "", planned: null, actual: null, by, at: new Date().toISOString() });
    }
  });
}

export function saveAction(c: Config, code: string, b: any, service: string, by: string, money: boolean): Promise<Action> {
  const title = cleanText(b?.title, TITLE_CHARS);
  if (!title) throw new FriendlyError("Say what the action is.");
  const date = readDate(b?.date, "Give the action a date.");
  const topics = (Array.isArray(b?.topics) ? b.topics : []).map((t: unknown) => cleanText(t, 80)).filter(Boolean).slice(0, 8);
  const planned = money && b?.planned !== undefined ? readCost(b.planned) : undefined, actual = money && b?.actual !== undefined ? readCost(b.actual) : undefined;
  return change(c, code, (all) => {
    const was = b?.id ? all.actions.find((x) => x.id === b.id) : null;
    if (b?.id && !was) throw new FriendlyError("That action wasn't found.", 404);
    if (!was && all.actions.length >= MAX_ACTIONS) throw new FriendlyError(`An authority can plan up to ${MAX_ACTIONS} actions.`);
    const id = cleanText(b?.campaign ?? was?.campaign, 40), owner = id ? all.campaigns.find((x) => x.id === id && x.service === service) : null;
    if (id && !owner) throw new FriendlyError("That campaign wasn't found.", 404);
    if (owner && !owner.ongoing && (date < owner.start || date > owner.end)) throw new FriendlyError(`That date is outside ${owner.name}, which runs from ${day(owner.start)} to ${day(owner.end)}.`);
    const action: Action = {
      id: was?.id ?? newId(), title, date, channel: cleanText(b?.channel, 24), topics, service, origin: cleanText(b?.origin ?? was?.origin, 160), survey: cleanText(b?.survey ?? was?.survey, 40), campaign: owner?.id ?? "",
      planned: planned === undefined ? was?.planned ?? null : planned, actual: actual === undefined ? was?.actual ?? null : actual, by: was?.by ?? by, at: was?.at ?? londonToday(),
    };
    all.actions = was ? all.actions.map((x) => (x === was ? action : x)) : [...all.actions, action];
    return action;
  });
}
export function removeAction(c: Config, code: string, id: unknown, money: boolean): Promise<void> {
  return change(c, code, (all) => {
    const was = all.actions.find((x) => x.id === id);
    if (!money && was && (was.planned !== null || was.actual !== null)) throw new FriendlyError(HOLDS_MONEY, 403);
    all.actions = all.actions.filter((x) => x.id !== id);
  });
}

/** The one change allowed while the election setting is on: what an action already held really cost. */
export function setActual(c: Config, code: string, id: unknown, value: unknown): Promise<Action> {
  const actual = readCost(value);
  return change(c, code, (all) => {
    const action = all.actions.find((x) => x.id === id);
    if (!action) throw new FriendlyError("That action wasn't found.", 404);
    if (action.date > londonToday()) throw new FriendlyError("That action hasn't happened yet.", 409);
    action.actual = actual;
    return action;
  });
}
