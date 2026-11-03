# CLAUDE.md: rules for agents on this repo

**Project:** A44 Medley Garage Sale. A mobile-first static site (GitHub Pages, vanilla TypeScript, esbuild) where neighbours reserve garage-sale items, with a per-unit waiting list and self-service back-out. Data is in a private Google Sheet behind an Apps Script web app. Spec: `BUILD_BRIEF.md` (v2.4, **read-only**). Order of authority: The seller's latest instruction, then the brief's Section 5 decisions plus `docs/decisions/`, then story acceptance criteria, then the rest of the brief.

**Scope:** MVP stories S-01 to S-18 only, worked slice by slice. Post-MVP N-01 to N-11 are **not started unless the seller asks**.

## Hard rules (brief 11.6). Breaking one is an S1 bug.

1. **The repo is public.** Never commit the seller's number, buyer names or numbers, tokens, secrets, sheet exports, sheet links or sheet IDs. That includes test fixtures, screenshots, logs and commit messages.
2. Fixtures use only synthetic people and `+91 90000 000xx`-style numbers.
3. Never message real people. WhatsApp checks only assert URLs.
4. Don't read or edit the real sheet before G2. Exports live in `private/` (gitignored). Don't read the build copy's data until `scrubStaging()` has run **and the seller has confirmed it by eye**.
5. Stay light. A new runtime dependency needs a one-line reason in the PR, and client JS needs a strong one.

Also: data display in the site uses `textContent`, never `innerHTML`. All user text written to the sheet is plain text with a leading-apostrophe guard (6.3). Find sheet columns by header name, never by position (4.1). Tokens go in POST bodies, never query strings (4.3).

## Human gates: stop and wait

- **G0** (before S-01 deploys and before S-03 runs): repo, build copy, `clasp login`, scrub check. See `docs/runbook.md`.
- **G1** (end of Slice 3): The seller tries staging on her phone.
- **G2** (S-18): cutover to the real sheet.

Also stop at the Section 11.5 conditions: anything contradicting a Section 5 decision; S-04 showing Apps Script can't work from Pages; a story growing past 5 points or a blocker surviving two attempts; an S1 bug; any cost or new external service; anything involving real names or numbers, real people, the real sheet or the group.

## Roles (brief 11.4)

| Agent | Does | Must not |
|---|---|---|
| PM | Queue, `docs/backlog/STATUS.md`, demos, retros, guiding the seller (11.7 format), risks, decisions | Rewrite accepted decisions, or mark work done without QA |
| Dev (test-author, implementer) | Red, green, refactor. One story per branch, small commits | Merge without QA sign-off, skip tests, expand scope |
| QA | Scenarios T-01 to T-18, exploratory testing, bug reports, sign-off. Log: `docs/qa/qa-log.md` | Fix a bug and sign off that same fix |

## Conventions

- Flow: `Backlog → Ready → In progress → In QA → Done`. One story per dev at a time.
- Branch per story: `S-11-reserve-api`. Commit prefix: `S-11: …`. `main` always deployable.
- **Only one agent changes `src/domain/` or the sheet schema at a time.**
- New decisions: `docs/decisions/D-0NN-<slug>.md` (next free ID is in `docs/decisions/README.md`).
- Layout: `src/domain/` (pure: queue, phone, message; no platform code), `src/api/` (handlers, sheet interface), `src/appscript/` (thin adapter and triggers, esbuild bundle, pushed with clasp), `src/site/` (views, routing, basket), `public/`, `tools/` (photo pipeline), `test/unit`, `test/e2e`, `test/fixtures` (synthetic only).

## Definition of Done (brief 11.3)

- Tests came first, visible in commit history: failing test, implementation, then any refactor.
- All acceptance criteria are covered by tests, or a named live check.
- Types, lint, tests, budgets and the personal-data scan pass.
- QA verified in a phone viewport, with a 390 px screenshot for UI changes.
- Status updated, decisions recorded.

## Tests and budgets (brief 8.1)

- **Unit:** Vitest for domain and API handlers, against an **in-memory fake of the sheet layer**.
- **E2E:** Playwright with a **mocked API**, on Chromium and WebKit, in Pixel and iPhone viewport profiles.
- **Live checks:** against the staging (build copy) deployment only, for behaviour fakes can't prove (T-18, CORS, timings, on-edit triggers). Not in CI.
- **Budgets (CI-enforced):** HTML, CSS and JS 50 KB compressed in total (excluding photos and API data). Thumbnail 12 KB or less. Full photo 120 KB or less. CLS under 0.1.
- **Bug severity:** S1 privacy leak or lost reservation (stops release). S2 core journey broken. S3 workaround exists. S4 cosmetic. Every fix starts with a failing test.

## Gate command

`npm ci && npm run check`

`check` runs, in order: `tsc --noEmit`, `eslint .`, `npm test` (Vitest unit, then Playwright smoke on Chromium and WebKit in Pixel 7 and iPhone 14 profiles), `npm run size` (builds, then the gzip size budget, D-022) and `npm run pii` (personal-data and secrets scan of git-tracked files). First time on a machine: `npx playwright install chromium webkit`. CI and the Pages deploy run the same command.
