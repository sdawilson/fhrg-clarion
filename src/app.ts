// Clarion: gauges how the public in each authority feels about its roads, and how news changes that.
// Stage 1 of the build: a first reading of mood for each pilot authority, and impact notes on announcements.
// See README.md for the whole picture and src/config.ts for the settings.
//
//   GET  /  /<anything>            the page (public/index.html, bundled with the server)
//   GET  /sso#t=<pass>             members arriving from the FHRG website
//   POST /api/config               website address (public)
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
//   POST /api/facts/survey         {code, year, measure, score, outOf, responses, source, url}: leads and admins
//   POST /api/facts/notes          {code, notes}: leads and admins

import { handleLogin, handleLogout, handleSso, signedIn, type Member } from "./accounts";
import { monthSpend } from "./claude";
import { getConfig, missingSettings, type Config } from "./config";
import { addSurvey, loadEvidence, loadFacts, saveNotes } from "./evidence";
import { validId } from "./jobs";
import { getNote, listNotes, readInput, startNote } from "./notes";
import { canEdit, canSee, pilotByCode, pilotsFor, type Pilot } from "./pilots";
import { getReading, latestReadings, startReading } from "./reading";
import { announcements, fixMyStreetUrl } from "./signals";
import { FriendlyError, escapeHtml, json, londonToday, readJsonBody } from "./util";

const PAGE_HEADERS: Record<string, string> = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-cache",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "x-robots-tag": "noindex, nofollow",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
let page: string | null = null;
export function setPage(html: string | null): void { page = html; }

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
  const [evidence, readings] = await Promise.all([loadEvidence(c, p, facts), latestReadings(c, p.code)]);
  return json({
    authority: {
      code: p.code, name: p.name, kind: p.kind, strategicAuthority: p.strategicAuthority, fundingRoute: p.fundingRoute, rating: p.rating,
      reportingRoute: p.reportingRoute, surveyNote: p.surveyNote, fixMyStreetUrl: fixMyStreetUrl(p),
      constituencies: p.constituencies,
    },
    evidence, facts: canEdit(me, p) ? { notes: facts.notes, updated: facts.updated, updatedBy: facts.updatedBy } : {}, canEdit: canEdit(me, p),
    reading: readings.find((r) => r.status === "ready") ?? null, working: readings.find((r) => r.status === "working") ?? null,
  });
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

export async function handleRequest(request: Request): Promise<Response> {
  const c = getConfig();
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  try {
    if (request.method === "GET" || request.method === "HEAD") {
      if (path === "/favicon.ico") return new Response(null, { status: 204 });
      if (path === "/robots.txt") return new Response("User-agent: *\nDisallow: /\n", { headers: { "content-type": "text/plain" } });
      if (path === "/" || path === "/index.html" || /^\/[a-z0-9][a-z0-9-]{0,48}$/i.test(path)) return servePage(c);
    }
    if (request.method === "POST") {
      if (path === "/api/config") return json({ websiteUrl: c.websiteUrl });
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
      }
    }
    return json({ error: "Not found." }, 404);
  } catch (e) {
    if (e instanceof FriendlyError) return json({ error: e.message }, e.status);
    console.log(`[error] ${request.method} ${path}: ${(e as Error)?.stack ?? e}`);
    const message = (e as Error)?.message ?? "";
    return json({ error: /storage/i.test(message) ? message : "Something went wrong. Please try again." }, 500);
  }
}


