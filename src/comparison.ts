// Attention and concern: what's being said against what people feel. Each topic's place comes from a calculation, not
// from Claude, and ranks are used because a press count and a survey share aren't on one scale. Early signs are pointers
// for officers to check, not findings.
//
//   Attention is assessed pieces in the last four weeks, then their reach after allowing for the source.
//   Concern is the topic's share of street survey comments and of enquiries, averaged over whichever of the two are held.

import type { Config } from "./config";
import { loadAssessments, loadSources, summarise as summariseCoverage, withWeights } from "./coverage";
import { enquiriesView, loadEnquiries } from "./enquiries";
import type { Pilot } from "./pilots";
import { sharedTopics } from "./surveyai";
import { loadCensus, streetSummaries } from "./surveys";
import { londonToday } from "./util";

const SURVEY_DAYS = 365; // a street survey counts as a signal for a year
const ENQUIRY_MONTHS = 3; // enquiries older than this don't speak for now
const MIN_TOPICS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export type Said = { topic: string; pieces: number; adjusted: number; critical: number; supportive: number };
export type Street = { topic: string; count: number };
export type Contacts = { topic: string; enquiries: number; complaints: number; trend: string };

/** Where a topic sits, from its two ranks. The upper half of each ranking counts as high. */
export function placeTopic(concern: number, attention: number, count: number): { early: boolean; action: string } {
  const felt = concern <= count / 2, loud = attention <= count / 2;
  return { early: felt && !loud, action: felt && loud ? "Act, and be seen to" : felt ? "Look into it early" : loud ? "Answer it, but don't over-react" : "Keep watching" };
}

const plural = (n: number, one: string) => `${n.toLocaleString("en-GB")} ${one}${n === 1 ? "" : "s"}`;

export function compare(said: Said[], street: Street[], contacts: Contacts[]) {
  const names = [...new Set([...said.map((x) => x.topic), ...street.map((x) => x.topic), ...contacts.map((x) => x.topic)])];
  const needs = !said.length ? "assessed press and media pieces from the last four weeks" : !street.length && !contacts.length ? "a street survey or enquiries" : names.length < MIN_TOPICS ? `at least ${MIN_TOPICS} topics` : "";
  if (needs) return { ready: false as const, needs };
  const comments = new Map(street.map((x) => [x.topic, x.count])), contactsOf = (t: string) => { const x = contacts.find((y) => y.topic === t); return x ? x.enquiries + x.complaints : 0; };
  const pieces = (t: string) => said.find((x) => x.topic === t)?.pieces ?? 0, adjusted = (t: string) => said.find((x) => x.topic === t)?.adjusted ?? 0;
  const allComments = street.reduce((sum, x) => sum + x.count, 0), allContacts = contacts.reduce((sum, x) => sum + x.enquiries + x.complaints, 0);
  const sharesHeld = [allComments, allContacts].filter(Boolean).length || 1;
  const concernScore = (t: string) => ((allComments ? (comments.get(t) ?? 0) / allComments : 0) + (allContacts ? contactsOf(t) / allContacts : 0)) / sharesHeld;
  const byConcern = [...names].sort((a, b) => concernScore(b) - concernScore(a) || (comments.get(b) ?? 0) - (comments.get(a) ?? 0) || a.localeCompare(b));
  const byAttention = [...names].sort((a, b) => pieces(b) - pieces(a) || adjusted(b) - adjusted(a) || a.localeCompare(b));
  const topics = byConcern.map((topic, i) => {
    const attention = byAttention.indexOf(topic) + 1, replies = comments.get(topic) ?? 0, reached = contactsOf(topic);
    const kinds = [replies ? "Street survey" : "", reached ? "Enquiries" : "", pieces(topic) ? "Press and media" : ""].filter(Boolean).join(", ");
    return { topic, concern: i + 1, attention, pieces: pieces(topic), replies, contacts: reached, kinds, ...placeTopic(i + 1, attention, names.length) };
  });
  const earlySigns = topics.filter((x) => x.early).map((x) => ({
    topic: x.topic, concern: x.concern, attention: x.attention,
    why: `${[x.replies ? plural(x.replies, "street survey comment") : "", x.contacts ? plural(x.contacts, "enquiry or complaint").replace("enquiry or complaints", "enquiries and complaints") : ""].filter(Boolean).join(" and ")}, against ${plural(x.pieces, "assessed piece")}.`,
  }));
  return { ready: true as const, topics, earlySigns, usesSurvey: !!allComments, usesEnquiries: !!allContacts };
}

/** The authority's own signals, as figures and topic counts only. An officer's words stay on their own page. */
export async function ownSignals(c: Config, p: Pilot): Promise<{ said: Said[]; contacts: Contacts[] }> {
  const [sources, assessments, held, census, topics] = await Promise.all([loadSources(c, p.code), loadAssessments(c, p.code), loadEnquiries(c, p.code), loadCensus(c, p.code), sharedTopics(c)]);
  const view = enquiriesView(held, census?.adults ?? null, topics), today = londonToday();
  const oldest = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 - ENQUIRY_MONTHS, 1)).toISOString().slice(0, 7);
  return {
    said: summariseCoverage(withWeights(assessments, sources), today).topics.map(({ topic, pieces, adjusted, critical, supportive }) => ({ topic, pieces, adjusted, critical, supportive })),
    contacts: view.ready && view.latest >= oldest ? view.rows.map(({ topic, enquiries, complaints, trend }) => ({ topic, enquiries, complaints, trend })) : [],
  };
}

export async function loadComparison(c: Config, p: Pilot) {
  const [{ said, contacts }, streets] = await Promise.all([ownSignals(c, p), streetSummaries(c, p.code)]);
  const latest = streets.find((s) => Date.now() - Date.parse(s.ran) < SURVEY_DAYS * DAY_MS);
  return compare(said, latest?.topics ?? [], contacts);
}
