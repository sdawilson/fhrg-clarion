# Clarion

Clarion gauges how the public in each local highway authority feels about its roads and services, and how news changes that. It has two parts: Media Watch reports what is being said, and Street Surveys ask people directly. Comparing the two shows what neither can show alone.

It runs as one Node program in a bunny.net Magic Container. Members sign in with their FHRG website account. To set it up, follow **[SETUP.md](SETUP.md)**.

## Stage 1 (this version)

For the pilot authorities (Lincolnshire, Kirklees and West Sussex):

- **Evidence:** survey results, DfT ratings, published figures compared with the region and England, public fault reports, petitions and MPs' questions, and what's missing.
- **Mood reading:** Claude writes a reading from that evidence. A change is only reported when two kinds of signal agree.
- **Impact note:** choose an announcement, and Clarion pins down what changed, tests it against nine routes of impact, challenges its own claims, and logs each forecast with a check date.

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
| `src/claude.ts`, `src/jobs.ts`, `src/style.ts` | Claude, background jobs, and the house style |
| `public/index.html` | The page (it ships with the server) |
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
