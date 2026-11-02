// Everything Clarion holds on an authority: what is known already, officers' additions, published figures
// and public signals. Code gathers this, not Claude, so a reading or note starts from checked material.

import type { Config } from "./config";
import { loadFigures, type Figures } from "./library";
import type { Pilot, SurveyResult } from "./pilots";
import { loadSignals, type Signals } from "./signals";
import { savePretty, storageJson } from "./storage";
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

export type Evidence = { figures: Figures; signals: Signals; surveys: SurveyResult[]; gaps: string[]; gathered: string };

export function findGaps(p: Pilot, surveys: SurveyResult[], signals: Signals, figures: Figures): string[] {
  const gaps = [...p.needed.filter((n) => !(surveys.length && /survey/i.test(n)))];
  if (!surveys.length && !gaps.some((g) => /survey/i.test(g))) gaps.unshift("A survey result to anchor the reading");
  if (figures.unavailable.length) gaps.push(`Published figures that couldn't be read just now: ${figures.unavailable.join(", ")}`);
  for (const s of [signals.fixMyStreet, signals.petitions, signals.questions]) if (!s.ok) gaps.push(`${s.source}: couldn't be read just now`);
  gaps.push("A street survey in this authority");
  return gaps;
}

export async function loadEvidence(c: Config, p: Pilot, facts: Facts): Promise<Evidence> {
  const [figures, signals] = await cached(`evidence|${p.code}`, FIGURES_MS, async () => await Promise.all([loadFigures(c, p.code), loadSignals(p)]));
  // a source that was down shouldn't stay missing for hours
  if (figures.unavailable.length || !signals.fixMyStreet.ok || !signals.petitions.ok || !signals.questions.ok) forget(`evidence|${p.code}`);
  const surveys: SurveyResult[] = [...p.surveys, ...facts.surveys].sort((a, b) => b.year - a.year);
  return { figures, signals, surveys, gaps: findGaps(p, surveys, signals, figures), gathered: new Date().toISOString() };
}

// The authority's position, as Claude sees it. Only the assessment and reading steps get this: they have no
// web access, and facts (with the officers' notes) is passed only for the authority's own work.
export function briefing(p: Pilot, e: Evidence, facts: Facts): Record<string, unknown> {
  return {
    authority: p.name, kind: p.kind, strategic_authority: p.strategicAuthority || "none", funding_route: p.fundingRoute,
    dft_rating: p.rating, reporting_route: p.reportingRoute,
    constituencies_shared_with_others: p.constituencies.filter((x) => x.shared).map((x) => `${x.name}: ${x.shared}`),
    survey_results: e.surveys, survey_note: p.surveyNote,
    published_figures: e.figures,
    public_signals: { fix_my_street: e.signals.fixMyStreet.data, petitions: e.signals.petitions.data, mps_written_questions: e.signals.questions.data },
    missing_evidence: e.gaps,
    ...(facts.notes ? { officer_notes: facts.notes } : {}),
  };
}
