# Clarion

Clarion gauges how the public in each local highway authority feels about its roads and services, and how news changes that. It looks at what's being said and asks people directly in street surveys. Comparing the two shows what neither can show alone.

It runs as one Node program in a bunny.net Magic Container. Members sign in with their FHRG website account. To set it up, follow **[SETUP.md](SETUP.md)**.

## Three modes

- **Demonstration:** `/demo` opens Northbridge, a fictional authority with made-up data. No account, no calls to Claude, and nothing is saved.
- **One authority:** members sign in with their FHRG account and see their own authority. Leads can run surveys and add results.
- **FHRG administrators:** site administrators start on all authorities, with figures and topic counts only, listed alphabetically and never ranked. They can open any authority, but written comments stay with that authority's members.

## What it does so far

For the pilot authorities (Lincolnshire, Kirklees and West Sussex):

- **Evidence:** survey results, DfT ratings, published figures compared with the region and England, public fault reports, petitions and MPs' questions, and what's missing.
- **Mood reading:** Claude writes a reading from that evidence. A change is only reported when two kinds of signal agree.
- **Impact note:** choose an announcement, and Clarion pins down what changed, tests it against nine routes of impact, challenges its own claims, and logs each forecast with a check date.
- **Councillor briefing:** Claude drafts one from figures and topic counts, an officer edits it, and a named officer of the authority releases it, which fixes that version. It then leaves as Word or PDF, through the council's own channels. An election setting takes out lines to take and suggested answers, and pauses street surveys.
- **What's being said:** automatic reading of sources with no licensing issue (GOV.UK, Parliament, FixMyStreet). For press, broadcast and social sources, Clarion can check whether a keyword turns up, keeping only yes or no and the date, and an officer finds the piece and records a guided assessment in their own words. Each assessment shows the likely audience, and allows for the source's stance, with raw and adjusted figures side by side.
- **Street Surveys:** fixed core questions plus up to five local ones, which Claude can suggest and check. Suggested levels for how many people to ask, with a site survey of four sites of 30 as the default. Proposed sites on a map, chosen from Census and deprivation figures, which an officer can change, with age targets for each. A plan with age and sex targets from Census 2021. Numbered A4 forms to print, and a link for tablets that works without a signal. Answers come from tablets, typed-in forms, scans read by Claude and checked by a person, or a CSV file. Claude takes names out of written comments and sorts them into topics. Results are weighted to the local population, always labelled indicative, and feed the mood reading as figures and topic counts.

## What's here

| Path | What it is |
|---|---|
| `src/app.ts` | The routes |
| `src/server.ts` | The web server, and `/health` |
| `src/config.ts` | Settings and the list of trusted sites |
| `src/accounts.ts` | Signing in with FHRG website accounts |
| `src/pilots.ts` | The pilot authorities and what's known about each |
| `src/library.ts` | The FHRG reference library and the headline figures |
| `src/signals.ts` | FixMyStreet, petitions, MPs' questions and GOV.UK |
| `src/evidence.ts` | Everything held on an authority |
| `src/reading.ts`, `src/notes.ts` | The mood reading and the impact note |
| `src/briefings.ts`, `src/docx.ts` | Councillor briefings, the election setting and the Word file |
| `src/surveys.ts`, `src/surveyai.ts` | Street surveys, and what Claude does for them |
| `src/sites.ts` | Proposing survey sites from neighbourhood figures |
| `src/coverage.ts` | What's being said: sources, assessments, audiences and coverage checks |
| `src/enquiries.ts` | An authority's enquiries as counts, and its own news page |
| `src/abc.ts` | ABC's register, pasted in by an administrator |
| `src/comparison.ts` | Attention and concern |
| `src/works.ts` | Works and weather, from the Climate Toolkit |
| `src/demo.ts` | The Northbridge demonstration's made-up data |
| `src/admin.ts` | The position across all authorities |
| `src/claude.ts`, `src/jobs.ts`, `src/style.ts` | Claude, background jobs, and the house style |
| `public/index.html` | The page (it ships with the server) |
| `public/survey.html` | The tablet page for interviewers, at `/s/<code>` |
| `test/` | Tests against simulated services; no keys needed |

## Where things live

- **Settings and keys:** environment variables in Magic Containers. None are in this repository.
- **Data:** Clarion's own storage zone (see `src/storage.ts`). The container keeps nothing of its own.
- **Published data:** the FHRG reference library on the App Builder, read with `FHRG_REF_KEY`.
- **Accounts:** the website's database, read-only.

## Working on it

```
npm ci
npm run typecheck
npm test
npm run build
```

Changes go in as pull requests; merging to `main` builds the image and updates the container.
