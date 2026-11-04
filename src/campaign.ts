// High-impact issues and the campaign calendar. Clarion proposes issues by a calculation on concern, reach and mood, and
// an officer confirms them and can add their own, each with a key message. A campaign event is placed by date and
// channel, and tied to one or more topics. The election setting holds all of this back: nothing here is shown or
// changed while it's on, and it all comes back when it's off.
//
// File, under ROOT_FOLDER: authorities/<code>/campaign.json

import type { Config } from "./config";
import { savePretty, storageJson } from "./storage";
import { FriendlyError, cleanLong, cleanText, londonToday, withLock } from "./util";

export type Issue = { topic: string; status: "confirmed" | "aside"; key: string; service: string; own: boolean; by: string; at: string };
export type Item = { id: string; title: string; date: string; channel: string; topics: string[]; service: string; origin: string; survey: string; by: string; at: string };
export type Campaign = { issues: Issue[]; items: Item[] };

const MAX_ISSUES = 60;
const MAX_ITEMS = 500;
const KEY_CHARS = 600;
const TITLE_CHARS = 140;
const path = (c: Config, code: string) => `${c.root}authorities/${code}/campaign.json`;
const newId = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

export async function loadCampaign(c: Config, code: string): Promise<Campaign> {
  const held = await storageJson<Partial<Campaign>>(c, path(c, code), {});
  return { issues: Array.isArray(held.issues) ? held.issues : [], items: Array.isArray(held.items) ? held.items : [] };
}
const change = <T>(c: Config, code: string, fn: (held: Campaign) => T): Promise<T> => withLock(path(c, code), async () => {
  const held = await loadCampaign(c, code);
  const out = fn(held);
  await savePretty(c, path(c, code), held);
  return out;
});

export const held = (campaign: Campaign, onElection: boolean): Campaign => (onElection ? { issues: campaign.issues.map((x) => ({ ...x, key: "" })), items: [] } : campaign);

/** Confirms an issue, sets it aside, or changes its key message. */
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

export function saveItem(c: Config, code: string, b: any, service: string, by: string): Promise<Item> {
  const title = cleanText(b?.title, TITLE_CHARS);
  if (!title) throw new FriendlyError("Say what the event is.");
  const date = String(b?.date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date))) throw new FriendlyError("Give the event a date.");
  const topics = (Array.isArray(b?.topics) ? b.topics : []).map((t: unknown) => cleanText(t, 80)).filter(Boolean).slice(0, 8);
  return change(c, code, (all) => {
    const was = b?.id ? all.items.find((x) => x.id === b.id) : null;
    if (b?.id && !was) throw new FriendlyError("That event wasn't found.", 404);
    if (!was && all.items.length >= MAX_ITEMS) throw new FriendlyError(`An authority can plan up to ${MAX_ITEMS} events.`);
    const item: Item = { id: was?.id ?? newId(), title, date, channel: cleanText(b?.channel, 24), topics, service, origin: cleanText(b?.origin ?? was?.origin, 160), survey: cleanText(b?.survey ?? was?.survey, 40), by: was?.by ?? by, at: was?.at ?? londonToday() };
    all.items = was ? all.items.map((x) => (x === was ? item : x)) : [...all.items, item];
    return item;
  });
}
export function removeItem(c: Config, code: string, id: unknown): Promise<void> {
  return change(c, code, (all) => { all.items = all.items.filter((x) => x.id !== id); });
}
