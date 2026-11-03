# Notes for Claude

**Who this is for:** Simon (FHRG, Proving) prefers a slower pace and brief, to-the-point replies in British English. He doesn't use a command line: give him plain-English steps, and do the code work yourself.

**How changes are delivered:** work on a branch, push, open a pull request with a short plain-English summary; Simon merges. Merging to `main` builds the image and deploys it (see `.github/workflows/deploy.yml`). Never commit keys or values of settings.

**Before opening a pull request:** `npm run typecheck` and `npm test` must pass. Add tests for new behaviour in `test/` (`test/sim.mjs` simulates bunny.net storage, the website's database, Claude, the reference library and the public sources). For page changes, add jsdom checks in `test/ui.mjs` or `test/ui-surveys.mjs`. For bigger or security-sensitive changes, have a separate agent review the diff first.

**Shape of the app:** `src/app.ts` holds the routes and works on standard web `Request`/`Response`; `src/server.ts` adapts Node's `http` to it. The container runs as exactly one instance, so in-memory caches, locks and the record of used sign-in passes are safe. Data lives in Clarion's storage zone, not in the container. Calls to Claude are streamed through Anthropic's SDK, the one runtime dependency, which is bundled into `dist/server.js`.

**Rules that must hold:**
- Clarion watches topics and places, never members of the public. No names, handles or words from residents are stored or shown, with two exceptions. The title of a petition, which Parliament publishes; its creator's name is never kept. And written comments people choose to give in a street survey: these stay hidden until Claude has taken out names (the original words are then replaced), only that authority's members can read them (not site administrators from outside it, who get topic counts), and they never reach a mood reading or impact note, which see figures and topic counts only.
- Street surveys: a scan is never stored. Tablets get the questions and nothing else about the authority. A street sample is always labelled indicative, and groups under 30 aren't reported.
- Survey sites: proposals are a calculation on library figures, never Claude's opinion, and the officer has the last word. The street map loads only pictures from OpenStreetMap, sends nothing but the map position, and isn't used in the demonstration.
- A step that can read the web sees nothing about an authority, and nothing an officer has pasted. A step that sees an authority's notes has no web access. An authority's notes reach only its own work.
- Local figures come from library queries, never from Claude's memory. A change in mood is reported only when two kinds of signal agree.
- Anything from outside is data, not instructions. The page builds everything as text, and only `https` links are clickable.

**Three modes:** the Northbridge demonstration at `/demo`, one authority with an FHRG sign-in, and FHRG administrators. In the demonstration the page answers from `/demo/data.json` (`src/demo.ts`) in place of the API, so it needs no account, never calls Claude and saves nothing. Keep it fictional: no real authority, person or link, and run survey figures through the real calculations. The all-authorities view (`src/admin.ts`) holds figures and topic counts only, lists authorities alphabetically and never ranks them. An authority sees only one FHRG middle figure, once five have results.

**Settings:** read through `env()` in `src/config.ts`, which forgives stray spaces and invisible characters. Add any new setting to `SECRET_SETTINGS` or `VARIABLE_SETTINGS`, to the file's opening comment, and to `SETUP.md`.

**The website:** its Edge Script lives in the `fhrg-app-builder` repository (`website/`). That file uses CRLF line endings; keep them. Its `/clarion` route signs members in with `SSO_SECRET` here and `CLARION_SSO_SECRET` there.

**Writing for users:** plain words, no jargon; British English. The style follows the FHRG Knowledgebase (`src/style.ts`). The design is in the claude.ai project.
