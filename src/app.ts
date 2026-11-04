// Clarion: gauges how the public in each authority feels about its roads, and how news changes that.
// So far: mood readings, impact notes on announcements, and Street Surveys, in three modes: the Northbridge
// demonstration, one authority with an FHRG sign-in, and the position across all of them for FHRG administrators.
// See README.md for the whole picture and src/config.ts for the settings.
//
//   GET  /  /<anything>            the page (public/index.html, bundled with the server)
//   GET  /sso#t=<pass>             members arriving from the FHRG website
//   GET  /s  /s/<access code>      the tablet page for a street survey (public/survey.html); no account needed
//   GET  /s/sw.js                  lets that page reopen without a signal
//   GET  /r/<link code>            the same page, for someone filling a survey in themselves; no account needed
//   GET  /demo                     the same page, opening the Northbridge demonstration
//   GET  /demo/data.json           the demonstration's made-up data (public; see demo.ts)
//   POST /demo/map                 {service, month, topic, bias, view, partner, include}: the map worked out from that data
//   POST /demo/officers            {service, month, word}: the officers' briefing from that data
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
//   POST /api/briefing/list        {code}: councillor briefings, and the election setting
//   POST /api/briefing/get         {code, id}
//   POST /api/briefing/start       {code}: draft one (runs in the background)
//   POST /api/briefing/save        {code, id, updated, hidden, title, summary, feel, matters, questions, lines}: an officer's changes
//   POST /api/briefing/approve     as save: a lead of the authority releases what's on their page, which fixes it
//   POST /api/briefing/copy        {code, id}: a new draft from one
//   POST /api/briefing/remove      {code, id, updated}: only a draft
//   POST /api/briefing/word        {code, id}: a released briefing as a Word file
//   POST /api/briefing/election    {code, on}: the pre-election setting
//   POST /api/coverage/get         {code}: sources, assessments, and what's been read automatically
//   POST /api/coverage/summary     {code}: the last four weeks' assessments, for the Summary page
//   POST /api/coverage/source      {code, ...source}: add or change a source
//   POST /api/coverage/unsource    {code, id}: take a source off
//   POST /api/coverage/assess      {code, ...assessment}: record an assessment
//   POST /api/coverage/unassess    {code, id}: remove an assessment
//   POST /api/coverage/check       {code, keywords, sources, days}: does a keyword turn up for these publications?
//   POST /api/enquiries/get        {code}: what people contacted the authority about, and its own news
//   POST /api/enquiries/import     {code, file, rows, skipped, months}: counts from a file read in the browser
//   POST /api/enquiries/remove     {code, id}: take an import back out
//   POST /api/enquiries/match      {code, category, topic}: sort one of the authority's categories into a topic
//   POST /api/enquiries/page       {code, url}: the authority's news page
//   POST /api/works/get            {code}: works and weather from the Climate Toolkit
//   POST /api/works/on             {code}: a lead turns that on
//   POST /api/works/off            {code}: turns it off, and removes what's held
//   POST /api/abc/find             {code, q}: titles in ABC's register that match what's been typed
//   POST /api/abc/status           ABC titles held (site administrators)
//   POST /api/abc/save             {text}: ABC's table, pasted (site administrators)
//   POST /api/attention            {code}: each topic by public concern and media attention
//   POST /api/admin/overview       site administrators: the position across all authorities
//   POST /api/map                  {code, service, month, topic, bias, view, partner, include}: the map, and what the Dashboard needs
//   POST /api/rate                 {code, key, tone}: an officer's rating of a petition or an MP's question
//   POST /api/setup/get            {code}: functions, partners and channels, and the mood weights
//   POST /api/setup/save           {code, part, service, list}: leads and admins
//   POST /api/setup/weights        {...weights}: site administrators
//   POST /api/briefing/officers    {code, service, month, word}: the officers' briefing, or as a Word file
//   POST /api/campaign/get         {code, service}: issues and campaign events, held back by the election setting
//   POST /api/issue/set            {code, service, topic, status, key, own}: confirm, set aside or change a key message
//   POST /api/issue/drop           {code, service, topic}
//   POST /api/campaign/item        {code, service, id, title, date, channel, topics, origin, survey}: add or change an event
//   POST /api/campaign/remove      {code, id}
//   POST /api/note/effect          {code, id, effect, topic}: what an officer expects a note to do to mood
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
//   POST /api/r/get                {access}
//   POST /api/r/submit             {access, client, secs, answers, postcode}: one person's reply
//   POST /api/survey/self          {code, id, on}: turns the self-completion link on or off
//   POST /api/survey/qr            {code, id, origin}: that link, and its QR code
//   POST /api/survey/selfday       {code, id, day, action}: leave out, put back or delete a day's replies by link

import { handleLogin, handleLogout, handleSso, networkOf, signedIn, type Member } from "./accounts";
import { findTitles, saveTitles, titlesHeld } from "./abc";
import { loadWorks, refreshWorks, turnOff, turnOn, worksPage } from "./works";
import { enquiriesView, loadEnquiries, readNews, removeImport, saveImport, saveMatch, savePage } from "./enquiries";
import { adminOverview, benchmark } from "./admin";
import { MAX_LISTED, PAUSED, approveBriefing, canApprove, copyBriefing, forReader, getBriefing, listBriefings, loadElection, removeBriefing, saveBriefing, setElection, startBriefing, wordCopy, type Briefing, type Election } from "./briefings";
import { loadComparison } from "./comparison";
import {
  FUNCTIONS, LEANINGS, PROMINENCE, REACH_BANDS, REACH_UNITS, REACH_UNIT_FOR, RELEVANCE, SOURCE_TYPES, STANCES, TONES, adultsByAge, audienceFor, channelsFrom, checkCoverage, loadAssessments, loadChecks, loadRates, loadSources,
  removeAssessment, removeSource, saveAssessment, saveRating, saveSource, summarise, withWeights, type Rate,
} from "./coverage";
import { monthSpend } from "./claude";
import { getConfig, missingSettings, type Config } from "./config";
import { demoMap, demoOfficers, demoPack } from "./demo";
import { addSurvey, loadEvidence, loadFacts, saveNotes } from "./evidence";
import { validId } from "./jobs";
import { getNote, listNotes, readInput, setEffect, startNote } from "./notes";
import { loadMapData } from "./mapdata";
import { buildMap, readFilters } from "./mood";
import { officersBriefing, officersWord } from "./officers";
import { DEFAULT_SERVICE, SERVICES, loadSetup, loadWeights, saveSetup, saveWeights, serviceId, standardFunctions } from "./setup";
import { dropIssue, held as heldCampaign, loadCampaign, removeItem, saveItem, setIssue, syncTell } from "./campaign";
import { canEdit, canSee, isMember, isOwnLead, pilotByCode, pilotsFor, type Pilot } from "./pilots";
import { getReading, latestReadings, startReading } from "./reading";
import { areaOf, outcodeOf, whereIs } from "./postcodes";
import { qrCode } from "./qr";
import { announcements, fixMyStreetUrl, loadSignals } from "./signals";
import { loadSites } from "./sites";
import { MAX_SCAN_CHARS, getHelp, sharedTopics, sortJob, startScan, startSorting, startSuggest, startWording, sweepHelp } from "./surveyai";
import {
  AGES, addAnswers, answersCsv, backToDraft, changeAnswer, changeAnswers, changeDay, closeSurvey, countArea, createSurvey, formNumber, listSurveys, loadAnswers, loadAreas,
  loadCensus, loadSurvey, openSurvey, publicSelf, publicSurvey, readAnswers, readCsv, saveSurvey, setSelf, surveyByAccess, surveyBySelf, surveyPage, textQuestionIds, validAccess, validSelf, type Survey,
} from "./surveys";
import { FriendlyError, briefly, tryAgainNow, cleanLong, cleanText, escapeHtml, json, londonToday, readJsonBody } from "./util";

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

// The shared topics, and any an authority has added as its own high-impact issue
async function topicsHere(c: Config, code: string): Promise<string[]> {
  const [shared, campaign] = await Promise.all([sharedTopics(c), loadCampaign(c, code)]);
  return [...shared, ...campaign.issues.filter((x) => x.own && !shared.includes(x.topic)).map((x) => x.topic)];
}

async function handleMap(c: Config, request: Request): Promise<Response> {
  const me = await signedIn(c, request);
  const b = await readJsonBody(request, 2000);
  const p = pilotFor(me, b.code);
  const data = await loadMapData(c, p);
  return json({ ...buildMap(data, readFilters(b, data.today, data.topics)), canEdit: canEdit(me, p), isLead: isOwnLead(me, p) });
}

async function handleSetup(c: Config, request: Request): Promise<Response> {
  const me = await signedIn(c, request);
  const b = await readJsonBody(request, 1000);
  const p = pilotFor(me, b.code);
  const [setup, weights, election] = await Promise.all([loadSetup(c, p.code), loadWeights(c), loadElection(c, p.code)]);
  return json({ setup, weights, election: election.on, canApprove: canApprove(me, p), services: SERVICES, standard: Object.fromEntries(SERVICES.map((s) => [s.id, standardFunctions(s.id)])), canEdit: canEdit(me, p), isLead: isOwnLead(me, p), canWeigh: me.siteAdmin });
}

// Everything held back while the election setting is on, and nothing can be changed
async function notInElection(c: Config, code: string): Promise<void> {
  if ((await loadElection(c, code)).on) throw new FriendlyError("The election setting is on, so nothing can be planned until it's off.", 409);
}

async function handleOfficers(c: Config, request: Request): Promise<Response> {
  const me = await signedIn(c, request);
  const b = await readJsonBody(request, 1000);
  const p = pilotFor(me, b.code);
  const data = await loadMapData(c, p), map = buildMap(data, readFilters({ service: b.service, month: b.month }, data.today, data.topics));
  const [readings, comparison] = await Promise.all([latestReadings(c, p.code), briefly(`comparison|${p.code}`, { ready: false as const }, () => loadComparison(c, p))]);
  const signs = comparison.ready ? comparison.earlySigns.map((x: { topic: string }) => x.topic) : [];
  const roads = map.service === DEFAULT_SERVICE, reading = roads ? readings.find((r) => r.status === "ready") ?? null : null;
  const issues = data.campaign.issues.filter((x) => x.status === "confirmed" && x.service === map.service);
  const briefing = officersBriefing(map, issues, reading, roads ? signs : [], data.today);
  return json(b.word === true ? officersWord(briefing) : { briefing });
}

async function handleCampaign(c: Config, request: Request): Promise<Response> {
  const me = await signedIn(c, request);
  const b = await readJsonBody(request, 1000);
  const p = pilotFor(me, b.code);
  const service = serviceId(b.service);
  const [campaign, setup, election] = await Promise.all([loadCampaign(c, p.code), loadSetup(c, p.code), loadElection(c, p.code)]);
  const now = heldCampaign(campaign, election.on);
  return json({ issues: now.issues.filter((x) => x.service === service), items: now.items.filter((x) => x.service === service), channels: setup.channels, election: election.on, canEdit: canEdit(me, p) });
}

async function handleAttention(c: Config, request: Request): Promise<Response> {
  const me = await signedIn(c, request);
  const b = await readJsonBody(request, 1000);
  return json(await loadComparison(c, pilotFor(me, b.code)));
}

async function handleCoverage(c: Config, request: Request): Promise<Response> {
  const me = await signedIn(c, request);
  const b = await readJsonBody(request, 1000);
  const p = pilotFor(me, b.code);
  // The audience figures and the automatic sources are extras: a slow outside service mustn't hold up the page
  const [sources, assessments, topics, census, rates, gov, signals, enquiries] = await Promise.all([
    loadSources(c, p.code), loadAssessments(c, p.code), sharedTopics(c),
    briefly(`census|${p.code}`, null, () => loadCensus(c, p.code), (x) => x === null), briefly("audience-rates", [] as Rate[], () => loadRates(c), (x) => !x.length),
    briefly("announcements", null, () => announcements()), briefly(`signals|${p.code}`, null, () => loadSignals(p), (x) => !x.fixMyStreet.ok || !x.petitions.ok || !x.questions.ok), loadEnquiries(c, p.code),
  ]);
  const posts = await councilNews(p, enquiries.page || p.newsPage, topics);
  const rows = withWeights(assessments, sources);
  const faults = signals?.fixMyStreet.data, petitions = signals?.petitions.data, questions = signals?.questions.data;
  const unread = "Couldn't be read just now";
  return json({
    ready: true, canEdit: canEdit(me, p), today: londonToday(), searchReady: !!c.searchKey, adults: census?.adults ?? null, sources, rows, summary: summarise(rows, londonToday()), checks: await loadChecks(c, p.code),
    topics, functions: FUNCTIONS, types: SOURCE_TYPES, leanings: LEANINGS, stances: STANCES, reachUnits: REACH_UNITS, reachUnitFor: REACH_UNIT_FOR, reachBands: REACH_BANDS, relevance: RELEVANCE, tones: TONES, prominence: PROMINENCE,
    audiences: Object.fromEntries(SOURCE_TYPES.map((t) => [t, audienceFor(t, census, rates)])),
    automatic: [
      { name: "GOV.UK: DfT and National Highways", type: "Government announcement", last: gov?.[0]?.date ?? "", note: gov ? "" : unread },
      { name: "Parliament: MPs' written questions", type: "Parliament", last: questions?.[0]?.date ?? "", note: questions ? "" : unread },
      { name: "Parliament: petitions", type: "Parliament", last: "", note: !petitions ? unread : petitions.length ? `${petitions.length} on road topics` : "" },
      { name: "FixMyStreet public reports", type: "Public reports", last: faults?.to ?? "", note: faults ? "" : unread },
      { name: "Your council's news page", type: "Council website", last: posts?.[0]?.date ?? "", note: posts ? "" : unread },
    ],
    latest: (gov ?? []).slice(0, 6),
  });
}

// Only what the Summary page needs, from Clarion's own storage, so it never waits on anyone else
async function handleCoverageSummary(c: Config, request: Request): Promise<Response> {
  const me = await signedIn(c, request);
  const b = await readJsonBody(request, 1000);
  const p = pilotFor(me, b.code);
  const [sources, assessments] = await Promise.all([loadSources(c, p.code), loadAssessments(c, p.code)]);
  return json({ summary: summarise(withWeights(assessments, sources), londonToday()) });
}

async function handleAdminOverview(c: Config, request: Request): Promise<Response> {
  const me = await signedIn(c, request);
  if (!me.siteAdmin) throw new FriendlyError("Only FHRG site administrators can see this.", 403);
  return json(await adminOverview(c));
}

// The news page is an extra: it's read at most daily, and a slow site mustn't hold up the page
const councilNews = (p: Pilot, address: string, topics: string[]) => (address ? briefly(`news|${p.code}|${address}`, null, () => readNews(p, address, topics)) : Promise.resolve(null));

async function handleEnquiries(c: Config, request: Request): Promise<Response> {
  const me = await signedIn(c, request);
  const b = await readJsonBody(request, 1000);
  const p = pilotFor(me, b.code);
  const [held, census, topics] = await Promise.all([loadEnquiries(c, p.code), briefly(`census|${p.code}`, null, () => loadCensus(c, p.code), (x) => x === null), sharedTopics(c)]);
  const page = held.page || p.newsPage, posts = await councilNews(p, page, topics);
  return json({
    canEdit: canEdit(me, p), adults: census?.adults ?? null, topics, view: enquiriesView(held, census?.adults ?? null, topics), imports: held.imports,
    website: { page, posts: posts ?? [], read: posts !== null },
  });
}

async function handleWorks(c: Config, request: Request): Promise<Response> {
  const me = await signedIn(c, request);
  const b = await readJsonBody(request, 1000);
  const p = pilotFor(me, b.code);
  // Records can take a while to read, so the page doesn't wait: it shows what's held, and the work carries on
  if ((await loadWorks(c, p.code)).on) await briefly(`works|${p.code}`, null, () => refreshWorks(c, p), (x) => !!x.problem);
  return json(await worksPage(c, me, p, await loadWorks(c, p.code), Object.fromEntries(FUNCTIONS.map(([id, name]) => [id, name]))));
}

async function handleAbc(c: Config, request: Request, what: "find" | "status" | "save"): Promise<Response> {
  const me = await signedIn(c, request);
  const b = await readJsonBody(request, what === "save" ? 2000000 : 1000);
  if (what === "find") { pilotFor(me, b.code); return json({ titles: await findTitles(c, b.q) }); }
  if (!me.siteAdmin) throw new FriendlyError("Only FHRG site administrators can do this.", 403);
  return json(what === "save" ? await saveTitles(c, me, b.text) : await titlesHeld(c));
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

// Fieldwork stops while the election setting is on. Paper waits as tablets do, because forms can't be told apart by when
// they were filled in. Sorting and checking what's held carries on, as it adds nothing
async function notPaused(c: Config, code: string): Promise<void> {
  if ((await loadElection(c, code)).on) throw new FriendlyError(PAUSED, 409);
}

const briefingPage = (me: Member, p: Pilot, x: Briefing, election: Election) => json({ briefing: forReader(x, election), canEdit: canEdit(me, p), canApprove: canApprove(me, p), election });

async function handleBriefingList(c: Config, request: Request): Promise<Response> {
  const me = await signedIn(c, request);
  const b = await readJsonBody(request, 1000);
  const p = pilotFor(me, b.code);
  const [all, election] = await Promise.all([listBriefings(c, p.code), loadElection(c, p.code)]);
  return json({ briefings: all.map(({ id, status, stage, created, by, title, approvedBy, approvedOn }) => ({ id, status, stage, created, by, title, approvedBy, approvedOn })), canEdit: canEdit(me, p), canApprove: canApprove(me, p), election, more: all.length >= MAX_LISTED });
}

async function briefingFor(c: Config, request: Request): Promise<{ me: Member; p: Pilot; x: Briefing; election: Election }> {
  const me = await signedIn(c, request);
  const b = await readJsonBody(request, 1000);
  const p = pilotFor(me, b.code);
  const [x, election] = await Promise.all([getBriefing(c, p.code, b.id), loadElection(c, p.code)]);
  if (!x) throw new FriendlyError("That briefing wasn't found.", 404);
  return { me, p, x, election };
}

async function handleBriefingChange(c: Config, request: Request, step: (me: Member, p: Pilot, b: Record<string, any>, election: Election) => Promise<Briefing>): Promise<Response> {
  const { me, p, b } = await editor(c, request, 60_000);
  const election = await loadElection(c, p.code);
  return briefingPage(me, p, await step(me, p, b, election), election);
}

async function handleSurveyList(c: Config, request: Request): Promise<Response> {
  const me = await signedIn(c, request);
  const b = await readJsonBody(request, 1000);
  const p = pilotFor(me, b.code);
  const surveys = await listSurveys(c, p.code);
  const [counts, election] = await Promise.all([Promise.all(surveys.map((s) => loadAnswers(c, p.code, s.id))), loadElection(c, p.code)]);
  return json({
    paused: election.on,
    canEdit: canEdit(me, p),
    surveys: surveys.map((s, i) => { const used = counts[i].filter((r) => !r.excluded); return { id: s.id, title: s.title, service: s.service ?? DEFAULT_SERVICE, status: s.status, created: s.created, by: s.by, openedOn: s.openedOn, responses: used.filter((r) => r.via !== "self").length, byLink: used.filter((r) => r.via === "self").length, target: s.plan.target }; }),
  });
}

async function handleSurveyGet(c: Config, request: Request): Promise<Response> {
  const { me, p, s } = await reader(c, request);
  const edit = canEdit(me, p);
  const [rows, census, sorting, election, tally] = await Promise.all([loadAnswers(c, p.code, s.id), loadCensus(c, p.code), sortJob(c, p.code, s.id), loadElection(c, p.code), loadAreas(c, p.code, s.id)]);
  return json({
    paused: election.on,
    ...surveyPage(s, rows, census, edit, isMember(me, p), p.constituencies.length, tally),
    sorting: sorting?.status === "working" ? sorting : null, dropped: edit && sorting?.status === "ready" ? sorting.result?.dropped ?? 0 : 0,
  });
}

async function handleSurveyNew(c: Config, request: Request): Promise<Response> {
  const { me, p, b } = await editor(c, request, 5000);
  return json({ survey: await createSurvey(c, me, p, b) });
}

async function handleSurveySave(c: Config, request: Request): Promise<Response> {
  const { me, b, s } = await surveyEditor(c, request, 30_000);
  if (b.tell === undefined) return json({ survey: await saveSurvey(c, s, b) });
  await notPaused(c, s.code); // messages are held back with the rest of a campaign
  const saved = await saveSurvey(c, s, b), { channels } = await loadSetup(c, s.code);
  await syncTell(c, s.code, saved, saved.service ?? DEFAULT_SERVICE, channels.find((x) => x.node === "street")?.id ?? "", me.name);
  return json({ survey: saved });
}

async function handleSurveyStatus(c: Config, request: Request): Promise<Response> {
  const { me, b, s } = await surveyEditor(c, request);
  if (b.status === "open") { await notPaused(c, s.code); return json({ survey: await openSurvey(c, me, s) }); }
  if (b.status === "closed") return json({ survey: await closeSurvey(c, s) });
  if (b.status === "draft") { await notPaused(c, s.code); return json({ survey: await backToDraft(c, s) }); } // its forms may be waiting on tablets
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
  await notPaused(c, s.code);
  return json(await addAnswers(c, s, Array.isArray(b.forms) ? b.forms.slice(0, 200) : [], b.via === "scan" ? "scan" : "paper"));
}

async function handleSurveyCsv(c: Config, request: Request): Promise<Response> {
  const { b, s } = await surveyEditor(c, request, 1_500_000);
  if (s.status === "draft") throw new FriendlyError("Open the survey before adding answers.");
  await notPaused(c, s.code);
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
const MAX_WRONG = 30, MAX_FORMS = 1500, MAX_SELF_PER_ADDRESS = 20, MAX_SELF_PER_BLOCK = 200, MAX_SELF_REPLIES = 600;
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

// Survey pages only ever post JSON from their own address, so another website can't send replies from its visitors' browsers
function fromOurPage(request: Request): void {
  if (!/^application\/json/i.test(request.headers.get("content-type") ?? "") || request.headers.get("sec-fetch-site") === "cross-site") throw new FriendlyError("That wasn't sent from a survey page.", 403);
}

async function surveyFromCode(c: Config, request: Request, value: unknown, forms = 1): Promise<Survey> {
  fromOurPage(request);
  const wrong = countOf(`wrong|${networkOf(request)}`);
  if (wrong.n >= MAX_WRONG) throw new FriendlyError("Too many tries. Please wait a few minutes.", 429);
  const access = String(value ?? "").toUpperCase().replace(/[\s-]/g, "");
  const s = validAccess(access) ? await surveyByAccess(c, access) : null;
  if (!s) { wrong.n++; throw new FriendlyError("That code wasn't recognised. Check it with your officer.", 404); }
  // counted in forms, so a stolen code can't fill a survey in a few requests
  const sent = countOf(`sends|${access}`);
  if (sent.n + forms > MAX_FORMS) throw new FriendlyError("Too many forms at once. Please wait a few minutes.", 429);
  sent.n += forms;
  if (s.status !== "open") throw new FriendlyError("This survey isn't open.", 409);
  await notPaused(c, s.code);
  return s;
}

// The self-completion link. It's meant to travel, so nothing about it is secret, and the limits are on how fast replies
// can arrive: a campaign can't fill a survey in a few minutes, and most of a shared office can still reply
async function surveyFromSelf(c: Config, request: Request, value: unknown): Promise<Survey> {
  fromOurPage(request);
  const wrong = countOf(`wronglink|${networkOf(request)}`); // apart from tablets, so an old poster can't lock out an interviewer
  if (wrong.n >= MAX_WRONG) throw new FriendlyError("Too many tries. Please wait a few minutes.", 429);
  const link = String(value ?? "").toUpperCase();
  const s = validSelf(link) ? await surveyBySelf(c, link) : null;
  if (!s || s.self !== link) { wrong.n++; throw new FriendlyError("This link isn't right. Check it with whoever sent it.", 404); }
  if (s.status !== "open" || !s.selfOn) throw new FriendlyError("This survey has closed.", 409);
  await notPaused(c, s.code);
  return s;
}

function countReply(request: Request, link: string): void {
  const person = countOf(`self|${networkOf(request)}`), block = countOf(`selfblock|${networkOf(request, 3)}`), all = countOf(`selfall|${link}`);
  if (person.n >= MAX_SELF_PER_ADDRESS || block.n >= MAX_SELF_PER_BLOCK || all.n >= MAX_SELF_REPLIES) throw new FriendlyError("A lot of replies are arriving at once. Please try again in a few minutes.", 429);
  person.n++; block.n++; all.n++;
}

async function handleSelfSubmit(c: Config, request: Request): Promise<Response> {
  const b = await readJsonBody(request, 20_000);
  const s = await surveyFromSelf(c, request, b.access);
  // before anything is counted, so a request with nothing real in it can't use up the limits
  if (!cleanText(b.client, 60) || !Object.keys(readAnswers(s, b.answers).answers).length) throw new FriendlyError("That reply has no answers.");
  countReply(request, s.self as string);
  const outcode = outcodeOf(b.postcode), p = pilotByCode(s.code);
  const where = p && outcode ? whereIs(p, await areaOf(c, outcode)) : "unknown";
  const r = await addAnswers(c, s, [{ client: b.client, secs: b.secs, answers: b.answers, where }], "self");
  if (!r.done.length) throw new FriendlyError(r.problems[0] ?? "That reply couldn't be saved.", 409);
  if (r.added && outcode && where === "here") await countArea(c, s, outcode); // an area outside the authority is never named, only counted as elsewhere
  return json({ ok: true });
}

async function handleSurveyQr(c: Config, request: Request): Promise<Response> {
  const { b, s } = await surveyEditor(c, request);
  if (!s.self) throw new FriendlyError("Turn on the link first.", 404);
  if (!/^https?:\/\/[a-z0-9.:-]+$/i.test(String(b.origin))) throw new FriendlyError("That address isn't right.");
  const url = `${b.origin}/r/${s.self}`;
  return json({ url, rows: qrCode(url) });
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
      if (path === "/s" || /^\/s\/[a-z0-9]{1,12}$/i.test(path) || /^\/r\/[a-z0-9]{12}$/i.test(path)) return serveSurveyPage();
      if (path === "/" || path === "/index.html" || /^\/[a-z0-9][a-z0-9-]{0,48}$/i.test(path)) return servePage(c);
    }
    if (request.method === "POST") {
      if (path === "/api/config") return json({ websiteUrl: c.websiteUrl, demo: c.demo });
      if (path === "/demo/map" || path === "/demo/officers") {
        if (!c.demo) return json({ error: "Not found." }, 404);
        const b = await readJsonBody(request, 2000);
        return json(path === "/demo/map" ? demoMap(b) : demoOfficers(b));
      }
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
        case "/api/briefing/list": return await handleBriefingList(c, request);
        case "/api/briefing/get": { const { me, p, x, election } = await briefingFor(c, request); return briefingPage(me, p, x, election); }
        case "/api/briefing/start": { const { me, p } = await editor(c, request, 1000); return json({ briefing: await startBriefing(c, me, p) }); }
        case "/api/briefing/save": return await handleBriefingChange(c, request, (_me, p, b, election) => saveBriefing(c, p, b, election));
        case "/api/briefing/approve": return await handleBriefingChange(c, request, (me, p, b, election) => approveBriefing(c, me, p, b, election));
        case "/api/briefing/copy": return await handleBriefingChange(c, request, (me, p, b, election) => copyBriefing(c, me, p, b.id, election));
        case "/api/briefing/remove": { const { p, b } = await editor(c, request, 1000); await removeBriefing(c, p, b); return json({ ok: true }); }
        case "/api/briefing/word": { const { x, election } = await briefingFor(c, request); return json(wordCopy(x, election)); }
        case "/api/briefing/election": { const me = await signedIn(c, request); const b = await readJsonBody(request, 1000); return json({ election: await setElection(c, me, pilotFor(me, b.code), b.on) }); }
        case "/api/facts/survey": return await handleFactsSurvey(c, request);
        case "/api/facts/notes": return await handleFactsNotes(c, request);
        case "/api/attention": return await handleAttention(c, request);
        case "/api/map": return await handleMap(c, request);
        case "/api/rate": { const { p, b } = await editor(c, request, 1000); await saveRating(c, p.code, b.key, b.tone); return json({ ok: true }); }
        case "/api/setup/get": return await handleSetup(c, request);
        case "/api/setup/save": { const { me, p, b } = await editor(c, request, 20000); return json({ setup: await saveSetup(c, p.code, b, me.name) }); }
        case "/api/setup/weights": { const me = await signedIn(c, request); if (!me.siteAdmin) throw new FriendlyError("Only FHRG site administrators can do this.", 403); return json({ weights: await saveWeights(c, await readJsonBody(request, 1000)) }); }
        case "/api/briefing/officers": return await handleOfficers(c, request);
        case "/api/campaign/get": return await handleCampaign(c, request);
        case "/api/issue/set": { const { me, p, b } = await editor(c, request, 3000); await notInElection(c, p.code); return json({ issue: await setIssue(c, p.code, b, serviceId(b.service), me.name) }); }
        case "/api/issue/drop": { const { p, b } = await editor(c, request, 1000); await notInElection(c, p.code); await dropIssue(c, p.code, b.topic, serviceId(b.service)); return json({ ok: true }); }
        case "/api/campaign/item": { const { me, p, b } = await editor(c, request, 3000); await notInElection(c, p.code); return json({ item: await saveItem(c, p.code, b, serviceId(b.service), me.name) }); }
        case "/api/campaign/remove": { const { p, b } = await editor(c, request, 1000); await notInElection(c, p.code); await removeItem(c, p.code, b.id); return json({ ok: true }); }
        case "/api/note/effect": { const { p, b } = await editor(c, request, 1000); if (!validId(b.id)) throw new FriendlyError("That note wasn't found.", 404); return json({ note: await setEffect(c, p.code, b.id, b.effect, b.topic) }); }
        case "/api/enquiries/get": return await handleEnquiries(c, request);
        case "/api/enquiries/import": { const { me, p, b } = await editor(c, request, 3000000); return json({ import: await saveImport(c, me, p, b) }); }
        case "/api/enquiries/remove": { const { p, b } = await editor(c, request, 1000); await removeImport(c, p, b.id); return json({ ok: true }); }
        case "/api/enquiries/match": { const { p, b } = await editor(c, request, 1000); await saveMatch(c, p, b, await sharedTopics(c)); return json({ ok: true }); }
        case "/api/enquiries/page": { const { p, b } = await editor(c, request, 1000); await savePage(c, p, b.url); return json({ ok: true }); }
        case "/api/works/get": return await handleWorks(c, request);
        case "/api/works/on": { const me = await signedIn(c, request); const b = await readJsonBody(request, 1000); const p = pilotFor(me, b.code); await turnOn(c, me, p); tryAgainNow(`works|${p.code}`); await briefly(`works|${p.code}`, null, () => refreshWorks(c, p), (x) => !!x.problem); return json({ ok: true }); }
        case "/api/works/off": { const { p } = await editor(c, request, 1000); await turnOff(c, p); return json({ ok: true }); }
        case "/api/abc/find": return await handleAbc(c, request, "find");
        case "/api/abc/status": return await handleAbc(c, request, "status");
        case "/api/abc/save": return await handleAbc(c, request, "save");
        case "/api/coverage/get": return await handleCoverage(c, request);
        case "/api/coverage/summary": return await handleCoverageSummary(c, request);
        case "/api/coverage/source": { const { me, p, b } = await editor(c, request, 3000); return json({ source: await saveSource(c, me, p, b, await sharedTopics(c)) }); }
        case "/api/coverage/unsource": { const { p, b } = await editor(c, request, 1000); await removeSource(c, p, b.id); return json({ ok: true }); }
        case "/api/coverage/assess": { const { me, p, b } = await editor(c, request, 3000); return json({ assessment: await saveAssessment(c, me, p, b, await topicsHere(c, p.code)) }); }
        case "/api/coverage/unassess": { const { p, b } = await editor(c, request, 1000); await removeAssessment(c, p, b.id); return json({ ok: true }); }
        case "/api/coverage/check": { const { p, b } = await editor(c, request, 3000); return json(await checkCoverage(c, p, b)); }
        case "/api/admin/overview": return await handleAdminOverview(c, request);
        case "/api/survey/list": return await handleSurveyList(c, request);
        case "/api/survey/get": return await handleSurveyGet(c, request);
        case "/api/survey/new": return await handleSurveyNew(c, request);
        case "/api/survey/save": return await handleSurveySave(c, request);
        case "/api/survey/status": return await handleSurveyStatus(c, request);
        case "/api/survey/sites": { const { p } = await editor(c, request, 1000); return json(await loadSites(c, p)); }
        case "/api/survey/suggest": { const { me, p, s } = await surveyEditor(c, request); return json({ job: await startSuggest(c, me, p, s) }); }
        case "/api/survey/wording": { const { me, p, s } = await surveyEditor(c, request); return json({ job: await startWording(c, me, p, s) }); }
        case "/api/survey/scan": { const { me, p, b, s } = await surveyEditor(c, request, MAX_SCAN_CHARS + 1000); await notPaused(c, s.code); return json({ job: await startScan(c, me, p, s, b.files) }); }
        case "/api/survey/sort": { const { me, p, s } = await surveyEditor(c, request); return json({ job: await startSorting(c, me, p, s) }); }
        case "/api/survey/help": return await handleSurveyHelpGet(c, request);
        case "/api/survey/answers": return await handleSurveyAnswers(c, request);
        case "/api/survey/csv": return await handleSurveyCsv(c, request);
        case "/api/survey/form": return await handleSurveyForm(c, request);
        case "/api/survey/comment": return await handleSurveyComment(c, request);
        case "/api/survey/export": return await handleSurveyExport(c, request);
        case "/api/s/get": return await handlePublicGet(c, request);
        case "/api/s/submit": return await handlePublicSubmit(c, request);
        case "/api/r/get": { const b = await readJsonBody(request, 1000); return json({ survey: publicSelf(await surveyFromSelf(c, request, b.access)) }); }
        case "/api/r/submit": return await handleSelfSubmit(c, request);
        case "/api/survey/self": { const { b, s } = await surveyEditor(c, request); if (b.on === true) await notPaused(c, s.code); return json({ survey: await setSelf(c, s, b.on === true) }); }
        case "/api/survey/qr": return await handleSurveyQr(c, request);
        case "/api/survey/selfday": { const { b, s } = await surveyEditor(c, request); await changeDay(c, s, b.day, b.action); return json({ ok: true }); }
      }
    }
    return json({ error: "Not found." }, 404);
  } catch (e) {
    if (e instanceof FriendlyError) return json({ error: e.message }, e.status);
    console.log(`[error] ${request.method} ${path}: ${(e as Error)?.stack ?? e}`);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
}


