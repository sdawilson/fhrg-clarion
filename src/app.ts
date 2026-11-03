// Clarion: gauges how the public in each authority feels about its roads, and how news changes that.
// So far: mood readings, impact notes on announcements, and Street Surveys, in three modes: the Northbridge
// demonstration, one authority with an FHRG sign-in, and the position across all of them for FHRG administrators.
// See README.md for the whole picture and src/config.ts for the settings.
//
//   GET  /  /<anything>            the page (public/index.html, bundled with the server)
//   GET  /sso#t=<pass>             members arriving from the FHRG website
//   GET  /s  /s/<access code>      the tablet page for a street survey (public/survey.html); no account needed
//   GET  /s/sw.js                  lets that page reopen without a signal
//   GET  /demo                     the same page, opening the Northbridge demonstration
//   GET  /demo/data.json           the demonstration's made-up data (public; see demo.ts)
//   POST /api/config               website address and whether the demonstration is on (public)
//   POST /api/login | /api/logout
//   POST /api/sso                  {token}: a two-minute, single-use pass signed by the website
//   POST /api/status               the signed-in member and the authorities they can see
//   POST /api/authority            {code}: what Clarion holds on an authority, with its latest reading
//   POST /api/reading/start        {code}: write a new mood reading (runs in the background)
//   POST /api/reading/get          {code, id}
//   POST /api/announcements        recent announcements on roads
//   POST /api/note/start           {code, url, title, text}: write an impact note (runs in the background)
//   POST /api/note/get             {code, id}
//   POST /api/note/list            {code}
//   POST /api/media | /api/attention  {code}: Media Watch and the comparison, which come in a later stage
//   POST /api/admin/overview       site administrators: the position across all authorities
//   POST /api/facts/survey         {code, year, measure, score, outOf, responses, source, url}: leads and admins
//   POST /api/facts/notes          {code, notes}: leads and admins
//
// Street Surveys. Any member of the authority can read; leads and admins do everything else.
//   POST /api/survey/list          {code}
//   POST /api/survey/get           {code, id}: the survey, results, checks and comments with names removed
//   POST /api/survey/new           {code, title, purpose}
//   POST /api/survey/save          {code, id, title, purpose, locals, plan, collector, printedTo}
//   POST /api/survey/status        {code, id, status}: open, closed or draft
//   POST /api/survey/sites         {code}: neighbourhood figures, towns and proposed survey sites
//   POST /api/survey/suggest       {code, id}: Claude suggests local questions (runs in the background)
//   POST /api/survey/wording       {code, id}: Claude checks their wording (runs in the background)
//   POST /api/survey/scan          {code, id, files}: Claude reads scanned forms (runs in the background)
//   POST /api/survey/sort          {code, id}: Claude takes names out of comments and sorts them (background)
//   POST /api/survey/help          {code, id, job}: how a background job is getting on
//   POST /api/survey/answers       {code, id, via, forms}: forms from quick entry or a checked scan
//   POST /api/survey/csv           {code, id, csv}: forms from a file
//   POST /api/survey/form          {code, id, n or form, excluded}: leave a form out, or put it back
//   POST /api/survey/comment       {code, id, n, q, text, topic}: an officer checks a comment
//   POST /api/survey/export        {code, id}: the answers as CSV
// Public, for tablets. The access code is the only key, it only works while a survey is open, and it opens
// nothing but the questions and a way to add answers.
//   POST /api/s/get                {access}
//   POST /api/s/submit             {access, forms}

import { clientIp, handleLogin, handleLogout, handleSso, signedIn, type Member } from "./accounts";
import { adminOverview, benchmark } from "./admin";
import { monthSpend } from "./claude";
import { getConfig, missingSettings, type Config } from "./config";
import { demoPack } from "./demo";
import { addSurvey, loadEvidence, loadFacts, saveNotes } from "./evidence";
import { validId } from "./jobs";
import { getNote, listNotes, readInput, startNote } from "./notes";
import { canEdit, canSee, isMember, pilotByCode, pilotsFor, type Pilot } from "./pilots";
import { getReading, latestReadings, startReading } from "./reading";
import { announcements, fixMyStreetUrl } from "./signals";
import { loadSites } from "./sites";
import { MAX_SCAN_CHARS, getHelp, sortJob, startScan, startSorting, startSuggest, startWording, sweepHelp } from "./surveyai";
import {
  addAnswers, answersCsv, backToDraft, changeAnswer, changeAnswers, closeSurvey, createSurvey, formNumber, listSurveys, loadAnswers,
  loadCensus, loadSurvey, openSurvey, publicSurvey, readCsv, saveSurvey, surveyByAccess, surveyPage, textQuestionIds, validAccess, type Survey,
} from "./surveys";
import { FriendlyError, cleanLong, cleanText, escapeHtml, json, londonToday, readJsonBody } from "./util";

const PAGE_HEADERS: Record<string, string> = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-cache",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "x-robots-tag": "noindex, nofollow",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https://tile.openstreetmap.org; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
let page: string | null = null;
let tabletPage: string | null = null;
export function setPage(html: string | null): void { page = html; }
export function setSurveyPage(html: string | null): void { tabletPage = html; }

// Keeps a tablet's page opening when there's no signal. Survey and answers wait in the tablet's own storage.
const SURVEY_WORKER = `const CACHE = "clarion-survey-1";
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.add("/s")).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return;
  e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put("/s", copy)); } return r; }).catch(() => caches.match("/s")));
});`;

function servePage(c: Config): Response {
  const missing = missingSettings(c);
  if (missing.length) return new Response(`<p>Clarion is not set up yet. Missing settings: ${escapeHtml(missing.join(", "))}.</p>`, { status: 500, headers: PAGE_HEADERS });
  if (!page) return new Response("<p>Clarion's page wasn't found.</p>", { status: 500, headers: PAGE_HEADERS });
  return new Response(page, { headers: PAGE_HEADERS });
}

// Refuses anything the member shouldn't see, in the same words whether or not it exists.
function pilotFor(me: Member, code: unknown): Pilot {
  const p = pilotByCode(code);
  if (!p || !canSee(me, p)) throw new FriendlyError("You don't have access to that authority.", 403);
  return p;
}

const summary = (p: Pilot) => ({ code: p.code, name: p.name });

async function handleStatus(c: Config, request: Request): Promise<Response> {
  const me = await signedIn(c, request);
  const pilots = pilotsFor(me);
  return json({
    user: { name: me.name, email: me.email, authority: me.authority, siteAdmin: me.siteAdmin },
    authorities: pilots.map(summary),
    ...(me.siteAdmin ? { spend: { month: await monthSpend(c), cap: c.monthlyCapUsd } } : {}),
  });
}

async function handleAuthority(c: Config, request: Request): Promise<Response> {
  const me = await signedIn(c, request);
  const b = await readJsonBody(request, 1000);
  const p = pilotFor(me, b.code);
  const facts = await loadFacts(c, p.code);
  const [evidence, readings, census, middle] = await Promise.all([loadEvidence(c, p, facts), latestReadings(c, p.code), loadCensus(c, p.code), benchmark(c).catch(() => null)]);
  return json({
    authority: {
      code: p.code, name: p.name, kind: p.kind, strategicAuthority: p.strategicAuthority, fundingRoute: p.fundingRoute, rating: p.rating,
      reportingRoute: p.reportingRoute, surveyNote: p.surveyNote, fixMyStreetUrl: fixMyStreetUrl(p),
      constituencies: p.constituencies,
    },
    evidence, facts: canEdit(me, p) ? { notes: facts.notes, updated: facts.updated, updatedBy: facts.updatedBy } : {}, canEdit: canEdit(me, p),
    reading: readings.find((r) => r.status === "ready") ?? null, working: readings.find((r) => r.status === "working") ?? null,
    adults: census?.adults ?? null, benchmark: middle,
  });
}

// Media Watch and the comparison come in a later stage. The routes are here so the page has one way to ask.
async function handleNotYet(c: Config, request: Request): Promise<Response> {
  const me = await signedIn(c, request);
  const b = await readJsonBody(request, 1000);
  pilotFor(me, b.code);
  return json({ ready: false });
}

async function handleAdminOverview(c: Config, request: Request): Promise<Response> {
  const me = await signedIn(c, request);
  if (!me.siteAdmin) throw new FriendlyError("Only FHRG site administrators can see this.", 403);
  return json(await adminOverview(c));
}

async function handleReadingStart(c: Config, request: Request): Promise<Response> {
  const me = await signedIn(c, request);
  const b = await readJsonBody(request, 1000);
  return json({ reading: await startReading(c, me, pilotFor(me, b.code)) });
}

async function handleReadingGet(c: Config, request: Request): Promise<Response> {
  const me = await signedIn(c, request);
  const b = await readJsonBody(request, 1000);
  const p = pilotFor(me, b.code);
  if (!validId(b.id)) throw new FriendlyError("That reading wasn't found.", 404);
  const reading = await getReading(c, p.code, b.id);
  if (!reading) throw new FriendlyError("That reading wasn't found.", 404);
  return json({ reading });
}

async function handleAnnouncements(c: Config, request: Request): Promise<Response> {
  await signedIn(c, request);
  try { return json({ announcements: await announcements() }); } catch (e) {
    console.log(`[warn] GOV.UK search: ${(e as Error).message}`);
    return json({ announcements: [], note: "GOV.UK's list couldn't be read just now. Paste a link or the text instead." });
  }
}

async function handleNoteStart(c: Config, request: Request): Promise<Response> {
  const me = await signedIn(c, request);
  const b = await readJsonBody(request, 50_000);
  const p = pilotFor(me, b.code);
  return json({ note: await startNote(c, me, p, readInput(b)) });
}

async function handleNoteGet(c: Config, request: Request): Promise<Response> {
  const me = await signedIn(c, request);
  const b = await readJsonBody(request, 1000);
  const p = pilotFor(me, b.code);
  if (!validId(b.id)) throw new FriendlyError("That note wasn't found.", 404);
  const note = await getNote(c, p.code, b.id);
  if (!note) throw new FriendlyError("That note wasn't found.", 404);
  return json({ note, authority: summary(p) });
}

async function handleNoteList(c: Config, request: Request): Promise<Response> {
  const me = await signedIn(c, request);
  const b = await readJsonBody(request, 1000);
  const p = pilotFor(me, b.code);
  const notes = await listNotes(c, p.code);
  return json({ notes: notes.map((n) => ({ id: n.id, status: n.status, stage: n.stage, created: n.created, by: n.by, title: n.change?.title || n.input.title || "Announcement", headline: n.headline })) });
}

async function editor(c: Config, request: Request, limit: number): Promise<{ me: Member; p: Pilot; b: Record<string, any> }> {
  const me = await signedIn(c, request);
  const b = await readJsonBody(request, limit);
  const p = pilotFor(me, b.code);
  if (!canEdit(me, p)) throw new FriendlyError("Only your authority's FHRG lead or a site administrator can change this.", 403);
  return { me, p, b };
}

async function handleFactsSurvey(c: Config, request: Request): Promise<Response> {
  const { me, p, b } = await editor(c, request, 3000);
  await addSurvey(c, p.code, b, me.name, londonToday());
  return json({ ok: true });
}

async function handleFactsNotes(c: Config, request: Request): Promise<Response> {
  const { me, p, b } = await editor(c, request, 10_000);
  await saveNotes(c, p.code, b.notes, me.name, londonToday());
  return json({ ok: true });
}

// ----- Street Surveys

async function surveyFor(c: Config, p: Pilot, id: unknown): Promise<Survey> {
  const s = validId(id) ? await loadSurvey(c, p.code, id) : null;
  if (!s) throw new FriendlyError("That survey wasn't found.", 404);
  return s;
}

async function reader(c: Config, request: Request, limit = 1000): Promise<{ me: Member; p: Pilot; b: Record<string, any>; s: Survey }> {
  const me = await signedIn(c, request);
  const b = await readJsonBody(request, limit);
  const p = pilotFor(me, b.code);
  return { me, p, b, s: await surveyFor(c, p, b.id) };
}

async function surveyEditor(c: Config, request: Request, limit = 2000): Promise<{ me: Member; p: Pilot; b: Record<string, any>; s: Survey }> {
  const { me, p, b } = await editor(c, request, limit);
  return { me, p, b, s: await surveyFor(c, p, b.id) };
}

async function handleSurveyList(c: Config, request: Request): Promise<Response> {
  const me = await signedIn(c, request);
  const b = await readJsonBody(request, 1000);
  const p = pilotFor(me, b.code);
  const surveys = await listSurveys(c, p.code);
  const counts = await Promise.all(surveys.map((s) => loadAnswers(c, p.code, s.id)));
  return json({
    canEdit: canEdit(me, p),
    surveys: surveys.map((s, i) => ({ id: s.id, title: s.title, status: s.status, created: s.created, by: s.by, openedOn: s.openedOn, responses: counts[i].filter((r) => !r.excluded).length, target: s.plan.target })),
  });
}

async function handleSurveyGet(c: Config, request: Request): Promise<Response> {
  const { me, p, s } = await reader(c, request);
  const edit = canEdit(me, p);
  const [rows, census, sorting] = await Promise.all([loadAnswers(c, p.code, s.id), loadCensus(c, p.code), sortJob(c, p.code, s.id)]);
  return json({
    ...surveyPage(s, rows, census, edit, isMember(me, p), p.constituencies.length),
    sorting: sorting?.status === "working" ? sorting : null, dropped: edit && sorting?.status === "ready" ? sorting.result?.dropped ?? 0 : 0,
  });
}

async function handleSurveyNew(c: Config, request: Request): Promise<Response> {
  const { me, p, b } = await editor(c, request, 5000);
  return json({ survey: await createSurvey(c, me, p, b) });
}

async function handleSurveySave(c: Config, request: Request): Promise<Response> {
  const { b, s } = await surveyEditor(c, request, 30_000);
  return json({ survey: await saveSurvey(c, s, b) });
}

async function handleSurveyStatus(c: Config, request: Request): Promise<Response> {
  const { me, b, s } = await surveyEditor(c, request);
  if (b.status === "open") return json({ survey: await openSurvey(c, me, s) });
  if (b.status === "closed") return json({ survey: await closeSurvey(c, s) });
  if (b.status === "draft") return json({ survey: await backToDraft(c, s) });
  throw new FriendlyError("That isn't a survey status.");
}

async function handleSurveyHelpGet(c: Config, request: Request): Promise<Response> {
  const { p, b, s } = await surveyEditor(c, request);
  const job = typeof b.job === "string" && (validId(b.job)) ? await getHelp(c, p.code, s.id, b.job) : null;
  if (!job) throw new FriendlyError("That wasn't found.", 404);
  return json({ job });
}

async function handleSurveyAnswers(c: Config, request: Request): Promise<Response> {
  const { b, s } = await surveyEditor(c, request, 400_000);
  if (s.status === "draft") throw new FriendlyError("Open the survey before adding answers.");
  return json(await addAnswers(c, s, Array.isArray(b.forms) ? b.forms.slice(0, 200) : [], b.via === "scan" ? "scan" : "paper"));
}

async function handleSurveyCsv(c: Config, request: Request): Promise<Response> {
  const { b, s } = await surveyEditor(c, request, 1_500_000);
  if (s.status === "draft") throw new FriendlyError("Open the survey before adding answers.");
  const forms = readCsv(String(b.csv ?? ""));
  if (forms.length > 5000) throw new FriendlyError("A file can hold up to 5,000 forms.");
  return json(await addAnswers(c, s, forms, "csv"));
}

async function handleSurveyForm(c: Config, request: Request): Promise<Response> {
  const { b, s } = await surveyEditor(c, request);
  const excluded = b.excluded === true;
  await changeAnswers(c, s, (all) => {
    const a = b.n !== undefined ? all.find((x) => x.n === Number(b.n)) : all.find((x) => x.form === formNumber(b.form) && !x.excluded);
    if (!a) throw new FriendlyError("That form wasn't found.", 404);
    if (!excluded && all.some((x) => x !== a && !x.excluded && x.form === a.form)) throw new FriendlyError(`Form ${a.form} has been entered again since, so this copy can't be put back.`);
    a.excluded = excluded;
  });
  return json({ ok: true });
}

async function handleSurveyComment(c: Config, request: Request): Promise<Response> {
  const { me, p, b, s } = await surveyEditor(c, request, 5000);
  if (!isMember(me, p)) throw new FriendlyError("Comments stay with the authority, so only its own members can check them.", 403);
  const q = String(b.q ?? "");
  if (!textQuestionIds(s).includes(q)) throw new FriendlyError("That comment wasn't found.", 404);
  await changeAnswer(c, s, Number(b.n), (a) => {
    if (!a.answers[q] || !a.clean?.[q]) throw new FriendlyError("That comment wasn't found.", 404);
    if (typeof b.text === "string") { const text = cleanLong(b.text, 1000); if (text) a.answers[q] = text; else delete a.answers[q]; }
    if (typeof b.topic === "string" && b.topic.trim()) a.topics = { ...a.topics, [q]: cleanText(b.topic, 80) };
    a.checked = { ...a.checked, [q]: true };
  });
  return json({ ok: true });
}

async function handleSurveyExport(c: Config, request: Request): Promise<Response> {
  const { me, p, s } = await surveyEditor(c, request);
  const [rows, census] = await Promise.all([loadAnswers(c, p.code, s.id), loadCensus(c, p.code)]);
  return json({ name: `${s.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "survey"}.csv`, csv: answersCsv(s, rows, census, isMember(me, p)) });
}

// Public routes: a wrong code costs a storage read, so wrong guesses are limited
const WINDOW_MS = 10 * 60 * 1000;
const MAX_WRONG = 30, MAX_FORMS = 1500;
const tallies = new Map<string, { from: number; n: number }>();
function countOf(key: string): { from: number; n: number } {
  const now = Date.now();
  if (tallies.size > 20_000) for (const [k, v] of tallies) if (now - v.from > WINDOW_MS) tallies.delete(k);
  const seen = tallies.get(key);
  if (seen && now - seen.from <= WINDOW_MS) return seen;
  const fresh = { from: now, n: 0 };
  tallies.set(key, fresh);
  return fresh;
}

async function surveyFromCode(c: Config, request: Request, value: unknown, forms = 1): Promise<Survey> {
  const wrong = countOf(`wrong|${clientIp(request)}`);
  if (wrong.n >= MAX_WRONG) throw new FriendlyError("Too many tries. Please wait a few minutes.", 429);
  const access = String(value ?? "").toUpperCase().replace(/[\s-]/g, "");
  const s = validAccess(access) ? await surveyByAccess(c, access) : null;
  if (!s) { wrong.n++; throw new FriendlyError("That code wasn't recognised. Check it with your officer.", 404); }
  // counted in forms, so a stolen code can't fill a survey in a few requests
  const sent = countOf(`sends|${access}`);
  if (sent.n + forms > MAX_FORMS) throw new FriendlyError("Too many forms at once. Please wait a few minutes.", 429);
  sent.n += forms;
  if (s.status !== "open") throw new FriendlyError("This survey isn't open.", 409);
  return s;
}

async function handlePublicGet(c: Config, request: Request): Promise<Response> {
  const b = await readJsonBody(request, 1000);
  return json({ survey: publicSurvey(await surveyFromCode(c, request, b.access)) });
}

async function handlePublicSubmit(c: Config, request: Request): Promise<Response> {
  const b = await readJsonBody(request, 200_000);
  const forms = Array.isArray(b.forms) ? b.forms.slice(0, 50) : [];
  const s = await surveyFromCode(c, request, b.access, Math.max(1, forms.length));
  return json(await addAnswers(c, s, forms, "tablet"));
}

// What Claude read from a scan shouldn't wait for someone to come back for it
export const sweep = () => sweepHelp(getConfig());

function serveSurveyPage(): Response {
  if (!tabletPage) return new Response("<p>This page wasn't found.</p>", { status: 500, headers: PAGE_HEADERS });
  return new Response(tabletPage, { headers: PAGE_HEADERS });
}

export async function handleRequest(request: Request): Promise<Response> {
  const c = getConfig();
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  try {
    if (request.method === "GET" || request.method === "HEAD") {
      if (path === "/favicon.ico") return new Response(null, { status: 204 });
      if (path === "/robots.txt") return new Response("User-agent: *\nDisallow: /\n", { headers: { "content-type": "text/plain" } });
      if (path === "/demo/data.json") {
        if (!c.demo) return json({ error: "Not found." }, 404);
        return new Response(await demoPack(), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache", "x-content-type-options": "nosniff" } });
      }
      if (path === "/s/sw.js") return new Response(SURVEY_WORKER, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache", "x-content-type-options": "nosniff" } });
      if (path === "/s" || /^\/s\/[a-z0-9]{1,12}$/i.test(path)) return serveSurveyPage();
      if (path === "/" || path === "/index.html" || /^\/[a-z0-9][a-z0-9-]{0,48}$/i.test(path)) return servePage(c);
    }
    if (request.method === "POST") {
      if (path === "/api/config") return json({ websiteUrl: c.websiteUrl, demo: c.demo });
      if (path === "/api/logout") return handleLogout();
      if (missingSettings(c).length) throw new FriendlyError(`Clarion is not set up yet. Missing settings: ${missingSettings(c).join(", ")}.`, 500);
      switch (path) {
        case "/api/login": return await handleLogin(c, request);
        case "/api/sso": return await handleSso(c, request);
        case "/api/status": return await handleStatus(c, request);
        case "/api/authority": return await handleAuthority(c, request);
        case "/api/reading/start": return await handleReadingStart(c, request);
        case "/api/reading/get": return await handleReadingGet(c, request);
        case "/api/announcements": return await handleAnnouncements(c, request);
        case "/api/note/start": return await handleNoteStart(c, request);
        case "/api/note/get": return await handleNoteGet(c, request);
        case "/api/note/list": return await handleNoteList(c, request);
        case "/api/facts/survey": return await handleFactsSurvey(c, request);
        case "/api/facts/notes": return await handleFactsNotes(c, request);
        case "/api/media": case "/api/attention": return await handleNotYet(c, request);
        case "/api/admin/overview": return await handleAdminOverview(c, request);
        case "/api/survey/list": return await handleSurveyList(c, request);
        case "/api/survey/get": return await handleSurveyGet(c, request);
        case "/api/survey/new": return await handleSurveyNew(c, request);
        case "/api/survey/save": return await handleSurveySave(c, request);
        case "/api/survey/status": return await handleSurveyStatus(c, request);
        case "/api/survey/sites": { const { p } = await editor(c, request, 1000); return json(await loadSites(c, p)); }
        case "/api/survey/suggest": { const { me, p, s } = await surveyEditor(c, request); return json({ job: await startSuggest(c, me, p, s) }); }
        case "/api/survey/wording": { const { me, p, s } = await surveyEditor(c, request); return json({ job: await startWording(c, me, p, s) }); }
        case "/api/survey/scan": { const { me, p, b, s } = await surveyEditor(c, request, MAX_SCAN_CHARS + 1000); return json({ job: await startScan(c, me, p, s, b.files) }); }
        case "/api/survey/sort": { const { me, p, s } = await surveyEditor(c, request); return json({ job: await startSorting(c, me, p, s) }); }
        case "/api/survey/help": return await handleSurveyHelpGet(c, request);
        case "/api/survey/answers": return await handleSurveyAnswers(c, request);
        case "/api/survey/csv": return await handleSurveyCsv(c, request);
        case "/api/survey/form": return await handleSurveyForm(c, request);
        case "/api/survey/comment": return await handleSurveyComment(c, request);
        case "/api/survey/export": return await handleSurveyExport(c, request);
        case "/api/s/get": return await handlePublicGet(c, request);
        case "/api/s/submit": return await handlePublicSubmit(c, request);
      }
    }
    return json({ error: "Not found." }, 404);
  } catch (e) {
    if (e instanceof FriendlyError) return json({ error: e.message }, e.status);
    console.log(`[error] ${request.method} ${path}: ${(e as Error)?.stack ?? e}`);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
}


