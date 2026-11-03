# S-01: Scaffold, CI and Pages deploy

| | |
|---|---|
| **Points** | 2 |
| **Slice** | 1: See the sale |
| **Depends on** | none |
| **Status** | Ready |
| **Pod type** | enabling |
| **Gate** | **G0.1** blocks only the Pages deploy criterion. Everything else can be built before it ([D-018](../../decisions/D-018-g0-in-stages.md)) |
| **Branch** | `S-01-scaffold-ci-pages` |

## Acceptance criteria (brief Section 8, verbatim)

- `npm ci && npm test` runs unit and Playwright smoke suites.
- CI checks types, lint, tests, size budget and a scan for personal data and secrets.
- A push to `main` deploys to GitHub Pages through Actions, after Gate G0.
- `.gitignore` covers `private/` and any env files.

## References

- Repo structure 11.1. Hard rules 11.6. Definition of Done 11.3.
- Test levels and budgets 8.1 (Vitest, Playwright on Chromium and WebKit, Pixel and iPhone profiles. 50 KB, 12 KB and 120 KB budgets, CLS under 0.1).
- D-001 (GitHub Pages), D-002 (vanilla TypeScript, esbuild). Site meta tags 4.4.
- Proposed: [D-022](../../decisions/D-022-size-budget-gzip.md) (gzip budget), [D-016](../../decisions/D-016-repo-name-medley-sale.md) (repo name and base path).
- Critical scenarios: supports **T-12** (the personal-data scan is the CI half of it).

## Notes

- `.gitignore` already exists from docs setup. S-01 confirms it and adds to it if needed.
- S-01 replaces the "Gate command" placeholder in `CLAUDE.md` with the exact command.
- The deploy criterion is a live check after G0.1. It is marked `manual:` until the repo exists: push to `main`, then the Pages URL serves the smoke page.

## the seller needs to do

G0.1 (runbook): confirm the commit identity, create the public `medley-sale` repo, set Pages source to Actions, and sign this computer in to GitHub. Only the deploy step waits for this.

## Out of scope

Any product screen, the API, Apps Script code, and the photo tool.
