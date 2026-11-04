// Everything Clarion holds on an authority: what is known already, officers' additions, published figures
// and public signals. Code gathers this, not Claude, so a reading or note starts from checked material.

import type { Config } from "./config";
import { ownSignals, type Contacts, type Said } from "./comparison";
import { loadFigures, type Figures } from "./library";
import type { Pilot, SurveyResult } from "./pilots";
import { loadSignals, type Signals } from "./signals";
import { savePretty, storageJson } from "./storage";
import { streetSummaries, type StreetSummary } from "./surveys";
import { FriendlyError, cached, cleanLong, cleanText, forget, withLock } from "./util";

const FIGURES_MS = 6 * 60 * 60 * 1000;

// Officers' additions. Notes can hold things an authority wouldn't want shared, so they only ever reach
// that authority's own pages, readings and notes, and never a step that can read the web.
export type Facts = { surveys: (SurveyResult & { addedBy: string; addedOn: string })[]; notes: string; updated: string; updatedBy: string };
const emptyFacts = (): Facts => ({ surveys: [], notes: "", updated: "", updatedBy: "" });
const factsPath = (c: Config, code: string) => `${c.root}authorities/${code}/facts.json`;

export async function loadFacts(c: Config, code: string): Promise<Facts> {
  const f = await storageJson<Partial<Facts>>(c, factsPath(c, code), {});
  return { ...emptyFacts(), ...f, surveys: Array.isArray(f.surveys) ? f.surveys : [] };
}

export async function addSurvey(c: Config, code: string, b: Record<string, any>, by: string, today: string): Promise<Facts> {
  const year = Number(b.year), score = Number(b.score), outOf = Number(b.outOf) || 100, responses = Number(b.responses) || undefined;
  const measure = cleanText(b.measure, 120), source = cleanText(b.source, 120), url = cleanText(b.url, 500);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new FriendlyError("Enter the year of the survey.");
  if (!measure) throw new FriendlyError("Say what was measured, for example Condition of highways.");
  if (!Number.isFinite(score) || score < 0 || score > outOf) throw new FriendlyError(`Enter a score between 0 and ${outOf}.`);
  if (!source) throw new FriendlyError("Say where the result came from, for example NHT survey 2025.");
  if (url && !/^https:\/\//i.test(url)) throw new FriendlyError("A link must start with https://");
  return await withLock(factsPath(c, code), async () => {
    const f = await loadFacts(c, code);
    f.surveys.push({ year, measure, score, outOf, ...(responses ? { responses } : {}), source, ...(url ? { url } : {}), addedBy: by, addedOn: today });
    f.updated = today; f.updatedBy = by;
    await savePretty(c, factsPath(c, code), f);
    return f;
  });
}

export async function saveNotes(c: Config, code: string, notes: unknown, by: string, today: string): Promise<Facts> {
  return await withLock(factsPath(c, code), async () => {
    const f = await loadFacts(c, code);
    f.notes = cleanLong(notes, 6000); f.updated = today; f.updatedBy = by;
    await savePretty(c, factsPath(c, code), f);
    return f;
  });
}

export type Evidence = { figures: Figures; signals: Signals; surveys: SurveyResult[]; streets: StreetSummary[]; said?: Said[]; contacts?: Contacts[]; publicJobs?: number; gaps: string[]; gathered: string };

export function findGaps(p: Pilot, surveys: SurveyResult[], signals: Signals, figures: Figures, hasStreetSurvey = false, hasEnquiries = false): string[] {
  const gaps = [...p.needed.filter((n) => !(surveys.length && /survey/i.test(n)) && !(hasEnquiries && /fault report/i.test(n)))];
  if (!surveys.length && !gaps.some((g) => /survey/i.test(g))) gaps.unshift("A survey result to anchor the reading");
  if (figures.unavailable.length) gaps.push(`Published figures that couldn't be read just now: ${figures.unavailable.join(", ")}`);
  for (const s of [signals.fixMyStreet, signals.petitions, signals.questions]) if (!s.ok) gaps.push(`${s.source}: couldn't be read just now`);
  if (!hasStreetSurvey) gaps.push("A street survey in this authority");
  return gaps;
}

export async function loadEvidence(c: Config, p: Pilot, facts: Facts): Promise<Evidence> {
  const [figures, signals] = await cached(`evidence|${p.code}`, FIGURES_MS, async () => await Promise.all([loadFigures(c, p.code), loadSignals(p)]));
  // a source that was down shouldn't stay missing for hours
  if (figures.unavailable.length || !signals.fixMyStreet.ok || !signals.petitions.ok || !signals.questions.ok) forget(`evidence|${p.code}`);
  const surveys: SurveyResult[] = [...p.surveys, ...facts.surveys].sort((a, b) => b.year - a.year);
  // read fresh each time, because answers arrive through the day
  const streets = await streetSummaries(c, p.code).catch((e) => { console.log(`[warn] street surveys: ${(e as Error).message}`); return [] as StreetSummary[]; });
  const { said, contacts, publicJobs } = await ownSignals(c, p).catch((e) => { console.log(`[warn] own signals: ${(e as Error).message}`); return { said: [] as Said[], contacts: [] as Contacts[], publicJobs: 0 }; });
  return { figures, signals, surveys, streets, said, contacts, publicJobs, gaps: findGaps(p, surveys, signals, figures, streets.some((x) => !x.selfOnly), contacts.length > 0), gathered: new Date().toISOString() };
}

// Enough to count as a kind of signal. One piece, or a few contacts, can't be half of a change in mood. A starting judgement
const MIN_PIECES = 5; // assessed in the last four weeks
const MIN_CONTACTS = 30; // enquiries and complaints in the latest month

// The kinds of signal Clarion really holds. Pulse questions come in a later stage of the build, so they can't count
// yet. A national petition only says something about this authority if it draws more than a fair share of its
// signatures from here. Assessed pieces are open talk, and an authority's own enquiries are actions.
export function kindsHeld(e: Evidence): string[] {
  const s = e.signals, pieces = (e.said ?? []).reduce((sum, x) => sum + x.pieces, 0), contacts = (e.contacts ?? []).reduce((sum, x) => sum + x.enquiries + x.complaints, 0);
  return [
    ...(e.surveys.length ? ["survey"] : []),
    ...(e.streets?.some((x) => x.current && !x.selfOnly) ? ["street survey"] : []),
    ...((s.fixMyStreet.ok && s.fixMyStreet.data?.reports) || contacts >= MIN_CONTACTS || (e.publicJobs ?? 0) >= MIN_CONTACTS ? ["actions"] : []),
    ...((s.petitions.ok && s.petitions.data?.some((p) => p.localShare > p.fairShare)) || (s.questions.ok && s.questions.data?.length) ? ["representatives"] : []),
    ...(pieces >= MIN_PIECES ? ["open talk"] : []),
  ];
}

// The authority's position, as Claude sees it. Only the assessment and reading steps get this: they have no
// web access, and facts (with the officers' notes) is passed only for the authority's own work.
export function briefing(p: Pilot, e: Evidence, facts: Facts): Record<string, unknown> {
  return {
    authority: p.name, kind: p.kind, strategic_authority: p.strategicAuthority || "none", funding_route: p.fundingRoute,
    dft_rating: p.rating, reporting_route: p.reportingRoute,
    constituencies_shared_with_others: p.constituencies.filter((x) => x.shared).map((x) => `${x.name}: ${x.shared}`),
    survey_results: e.surveys, survey_note: p.surveyNote,
    ...(e.streets.length ? { street_surveys: e.streets.map(({ id: _id, ...rest }) => rest) } : {}),
    published_figures: e.figures,
    public_signals: { fix_my_street: e.signals.fixMyStreet.data, petitions: e.signals.petitions.data, mps_written_questions: e.signals.questions.data },
    ...(e.said?.length ? { assessed_press_and_media_last_four_weeks: e.said } : {}),
    ...(e.contacts?.length ? { enquiries_and_complaints_latest_month: e.contacts } : {}),
    ...(e.publicJobs ? { maintenance_jobs_reported_by_the_public_last_four_weeks: e.publicJobs } : {}),
    missing_evidence: e.gaps,
    ...(facts.notes ? { officer_notes: facts.notes } : {}),
  };
}
