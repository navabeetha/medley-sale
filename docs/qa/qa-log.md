# QA log

One dated entry per story verified (see `docs/qa/README.md`). No real names, numbers, tokens, sheet links or IDs in this file.

## Scenarios

| ID | Story | Automated or live | Last run | Result |
|---|---|---|---|---|
| T-12 (CI half: tracked-file scan) | S-01 | Automated (`npm run pii`) | 2026-11-03 | Pass, with rule gaps listed under S-01 below |

---

## 2026-11-03: S-01 Scaffold, CI and Pages deploy

**Branch:** `S-01-scaffold-ci-pages`, commits `a78bb35..b37f7b5` (6 commits on top of `main`).
**Result:** Pass, with conditions. Sign-off for S-01 except the deploy criterion, which stays a pending manual check (after G0.1).

### What changed

Scaffold (TypeScript, ESLint, Vitest, Playwright), `tools/size-budget.mjs` (gzip budget, D-022), `tools/pii-scan.mjs` (phones, emails, sheet links, secrets, tracked `private/` and `.xlsx`, plus a "blocked word" list read only from gitignored `private/blocked-words.txt` or the `PII_BLOCKED_WORDS` CI secret), placeholder page with the 4.4 meta tags and CSP, `ci.yml` and `deploy.yml`, `.gitignore` additions, and the gate command in `CLAUDE.md`.

### Verified

- **Gate:** `npm ci && npm run check` from a clean `npm ci`, exit 0. Unit 35/35, Playwright 12/12 (Chromium and WebKit, Pixel 7 and iPhone 14 profiles), size 0.7 KB of 50 KB gzipped, pii-scan 59 files, 0 findings, with the local blocked-word list loaded.
- **Criterion 1** (`npm ci && npm test` runs unit and Playwright): pass. Needs `npx playwright install chromium webkit` once per machine.
- **Criterion 2** (CI checks types, lint, tests, size, scan): pass by reading `ci.yml` and `package.json`. `check` chains all five with `&&`. Not yet run on a GitHub runner.
- **Criterion 4** (`.gitignore` covers `private/` and env files): pass, checked with `git check-ignore` for `private/x`, `.env`, `.env.local`, `.clasp.json`, `*.xlsx`.
- **Tests first:** `a78bb35` adds the tests with no `tools/` files; `47f25fb` adds blocked-word tests before `b37f7b5` adds `loadBlockedWords`.
- **History privacy:** `git log main S-01-scaffold-ci-pages -p` plus all messages, scanned with `scanText` and the private blocked-word list: 0 blocked-word hits (substring count also 0). The only phone hits are the scanner's own test fixtures (see finding 3). All author and committer emails are the account's GitHub no-reply address; the only other email is the Claude co-author no-reply address.
- **D-022:** `checkBudgets` gzips each `.html/.css/.js/.mjs` file at level 9 and sums them, skipping `photos/` and non-code files (API JSON). That matches D-022. A raw-bytes mutation would fail the "sums" test.
- **Deploy contents:** `upload-pages-artifact` publishes `dist/` only. `dist/` is `public/` (2 tracked files) plus `main.js`. `private/` is never in the CI checkout. Asset links are relative, so a `/medley-sale/` base path should work (by reading, not served).
- **CSP mutation tests** (scratch copy, not the branch): `script-src 'none'` makes the smoke tests fail (good). CSP meta moved to the end of `<body>`: only Chromium fails, WebKit passes. CSP widened (`script-src 'self' https: data:`, `connect-src *`): all pass. See finding 6.
- **npm audit:** 11 moderate, all from `minimatch` in dev dependencies; `npm audit --omit=dev` finds 0. No runtime dependencies.

### Findings (worst first)

1. **S1 risk, latent: pre-rewrite history is still in the local repo.** `refs/original/refs/heads/{main,S-01-scaffold-ci-pages}` still holds the old commits, and the blocked word appears in them over 100 times (counted, not printed). An `origin` remote already exists and points at an empty GitHub repo. A normal `git push origin main` will not send these refs, but `git push --mirror` or pushing `refs/original/*` would make them public. Fix after the seller agrees: `git update-ref -d` both refs, expire the reflog, then `git gc --prune=now`, and check `git log --all` before the first push.
2. **S2 (guard gap on hard rule 1): bare sheet IDs are not detected.** The scan only flags a Google Sheets URL (docs host plus the spreadsheets path) or a 44-character ID within 80 characters after the word "spreadsheets". Missed when confirmed by probe: an open-by-id call on the spreadsheet service, `const SHEET_ID = '<id>'`, `script.google.com/...?sheetId=<id>`, a bare ID on its own line, Drive/Docs/Forms links. S-03/S-04 Apps Script code is the likely place this shape shows up. Suggest: flag any 40–50 character `[A-Za-z0-9_-]` run containing upper case, lower case and a digit (skip the lockfile), and flag `openById`, `the Drive host`, `docs.google.com/` generally.
3. **S3: scanner test fixtures break hard rule 2.** `test/unit/pii-scan.test.ts` builds numbers that are not in the `+91 90000 000xx` style (a common Indian sample mobile, a UK mobile and a US number outside the 555-01xx fictional range) and splits the strings so the scan can't see them. They could be someone's real number. Suggest positive fixtures from the 90000 series that sits outside the allowlist (for example a `90000 1xxxx` shape), Ofcom's `07700 900xxx` drama range, and US `555-01xx`.
4. **S3: blocked-word guard fails open in CI, and CI is only detective.** With no file and no secret the scan warns and exits 0 (confirmed). Fork PRs get no secrets, so a warning there is right. But a push to `main` and `deploy.yml` run in the owner's repo, where the secret should exist, so they should fail closed (for example `REQUIRE_BLOCKED_WORDS=1` in `deploy.yml` and on `push` events). More important: the repo is public, so by the time CI runs on a push the content is already published. The only control that prevents a leak is local: add a pre-push hook (or document `npm run pii` before every push) that also scans the commit messages being pushed.
5. **S3: commit messages are not scanned.** Hard rule 1 covers commit messages, but `pii-scan` reads only files. Suggest a CI step scanning `git log --format=%B` for the pushed range, plus the pre-push hook above.
6. **S3: other scan gaps, confirmed by probe.** Not flagged: a tracked `.clasp.json` with a `scriptId` (only gitignored, so `git add -f` gets through and `scanPaths` doesn't flag it); `.env`, `.csv`, `.ods` and `.xls` when tracked outside `private/` (CSV content with a phone number is still caught); snake_case secret keys such as `refresh_token`/`access_token` (the `\b` before `token` never matches after `_`); a bare Google OAuth client secret (`GOCSPX-…`); booking-token URLs `#/b/<token>`; numbers with a `0091` prefix or `.` or `/` separators; percent-encoded emails in `mailto:`. Still caught: the 5+5 space form, `+91-XXXXX-XXXXX`, `wa.me`/`api.whatsapp.com` links, `tel:`, numbers in JSON, NBSP separators, plain `mailto:` emails.
7. **S4: CSP e2e assertions are loose.** `toContain("script-src 'self'")` passes when the CSP is widened, and nothing checks `connect-src`, `base-uri`, `form-action`, or that the CSP meta comes before the first resource (WebKit doesn't notice). Suggest asserting the whole `content` string exactly, and that the CSP meta is the first element in `<head>` after `charset`/`viewport`.
8. **S4: `deploy.yml` comment says "Do not enable before Gate G0"**, but the workflow becomes active as soon as it lands on `main` on GitHub. If Pages isn't set to Actions yet, the deploy job fails, which does no harm. Merge to `main` only after G0.1 or accept one red run.
9. **S4: the photo budget only applies under `dist/photos/`.** Images anywhere else are neither budgeted nor counted. The S-05 photo pipeline must write to `photos/` and name thumbnails with `thumb`.

### Not verified (manual or later)

- **Deploy criterion (manual, after G0.1):** set Pages source to GitHub Actions, add the `PII_BLOCKED_WORDS` secret, push `main` (normal push, not `--mirror`). Check that the Actions run is green for both jobs, then open `https://<account>.github.io/medley-sale/` on a phone. The page should show the title and "Coming soon." with no console errors, and view-source should show the referrer, robots and CSP meta tags. Confirm that `/medley-sale/private/` and `/medley-sale/.git/` return 404.
- `npx playwright install --with-deps` on `ubuntu-latest` and Node 24 setup: not yet run on a GitHub runner.
- CLS under 0.1: no check yet (not an S-01 criterion). It needs one before S-06 ships real content.
- 390 px screenshot: no UI story yet; the placeholder only has an overflow check.
- Not examined: ESLint rule set strength, `tsconfig` strictness options, `serve.mjs` path traversal edge cases (dev-only, bound to 127.0.0.1).
