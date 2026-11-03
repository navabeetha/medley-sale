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

---

## 2026-11-03 (re-review): S-01 hardening follow-up

**Branch:** `S-01-scaffold-ci-pages`, the 8 commits after "S-01: QA log entry" (`a55c7bd..84267a3`). Hashes in the entry above are from before a later history rewrite (fixture numbers replaced); they no longer resolve.
**Result:** Not signed off for the first push. One S1 gap in the push barrier (finding R1). Everything else from the first review is fixed or downgraded to S3/S4.

### What changed

Fail-closed blocked-word flag (`--require-blocked-words` / `REQUIRE_BLOCKED_WORDS=1`; always on in `deploy.yml`, on `push` events in `ci.yml`). Commit-message and author/committer scan of everything reachable from HEAD, with `fetch-depth: 0` in both workflows. `.githooks/pre-push` (installed by `npm run prepare` through `core.hooksPath`) runs `tools/pre-push.mjs` (ref policy plus a message/identity scan of the pushed commits), then `pii-scan --require-blocked-words` on the working tree. New rules: Drive/Docs/Forms links, the spreadsheet open-by-id call, bare 40 to 50 character mixed-case-and-digit ids, tracked `.clasp.json`/`.env*`/`.csv`/`.ods`/`.xls`, `*_token`/`*_secret` keys, `GOCSPX-`, `#/b/<token>`, `0091`, `.` and `/` separators, `%40`. The e2e test now checks the exact CSP string and that it comes first in `<head>`. `noreply@github.com` was added to the allowed emails (for GitHub merge commits).

### Verified

- **Gate:** `npm ci && npm run check`, exit 0. Unit 94/94 (6 files), Playwright 16/16, size 0.7 KB of 50 KB, pii-scan 67 files, 0 findings. `core.hooksPath` was already `.githooks` before `npm ci`, so the prepare script changed nothing.
- **Tests first, per group:** I ran Vitest on a `git archive` of each red commit. `a55c7bd`: 4 failing. `cb28f56`: 7 failing. `f49c05c`: 17 failing. `516ab0f`: the new file fails to import. Each red commit is followed by its green commit. The CSP e2e change (`84267a3`) is a characterisation test with no implementation change, which is fine. **No existing test was weakened.** `pii-scan.test.ts` and `size-budget.test.ts` are unchanged since the first review. The only test edit (`597d743`) splits one string literal into pieces, and the value stays the same.
- **Mutation checks** (scratch copy, Vitest): each of these turns a test red. Dropping the `refs/original/` refusal. Making fail-closed never fail. Dropping the CLI history scan. Removing `--require-blocked-words` from the hook. Replacing the update range with `--not --remotes`. **Not caught by any test:** removing `REQUIRE_BLOCKED_WORDS` from `ci.yml` or `deploy.yml`, and removing `fetch-depth: 0`.
- **Ref policy, dry stdin on the real repo:** a push of `refs/original/refs/heads/S-01-scaffold-ci-pages` to `refs/heads/...` is REFUSED. A mirror-style push to `refs/original/...` is refused twice (both rules). A real push in a scratch clone to a scratch bare repo, through the real hook, confirms git's stdin. `refs/original/x:refs/heads/x` and `refs/original/x^0:...` are refused. **`<sha>:refs/heads/y` is accepted** (see R2).
- **Fail-closed events:** `ci.yml` triggers only on `push` and `pull_request`. Push requires the list. PRs don't, which is right for forks, and same-repo PRs follow a push that already required it. `deploy.yml` triggers only on push to `main` and always requires it. There is no `workflow_dispatch` anywhere. If one is added to `ci.yml` later, that run fails open (S4 note).
- **History privacy (main plus branch, 17 commits, counts only):** the blocked word appears 0 times in messages, diffs or identities. The only identity email is the account's GitHub no-reply address. The only email domains in messages and diffs are the Anthropic and GitHub no-reply ones. Phone hits in diffs: 2, both the same fictional 90000-series fixture piece (the `0091` test) (added in `f49c05c`, re-split in `597d743`). Sheet-rule hits: 58 in `package-lock.json` (skipped by design) and 1 in the first QA log entry (`7363bf8`). That entry names the open-by-id call and the Drive host, and the new rule flags it. These are not personal data.
- **Fixtures (old finding 3):** the scanner tests now use only fictional ranges. The other long digit strings are version, IP, date, hex and timestamp negatives.

### Findings (worst first)

R1. **S1: the pre-push hook does not scan file content of the commits being pushed, and neither does CI.** Reproduced in a scratch clone. A commit adds a file with a non-synthetic `+91 90000 1xxxx` number and a blocked word. The next commit deletes it. A push of both commits goes through the real hook with exit 0 ("2 commit(s) ... 0 finding(s)", "pii-scan: 67 files, 0 finding(s)"). Pushing a different branch while a clean branch is checked out also passes. CI's `pii` scans the checked-out tree and commit messages only, so once such a commit is public, nothing ever detects it. This is the normal red/green/fix flow ("committed a real number in a fixture, fixed it in the next commit"), and it defeats hard rule 1. **Fix is small:** in `tools/pre-push.mjs`, for each push line run `git log -p -U0 --format=%x1e%H <same rev-list args>`, pass the `+` lines through `scanText` (track the file from `+++ b/`, skip `package-lock.json`), and pass the added and renamed paths (`--name-only --diff-filter=AR`) through `scanPaths`. Test it in the existing throwaway-repo suite with an add-then-delete case. Do the same in CI over the pushed range. Known snag: `7363bf8`'s QA log line trips the new sheet rule. Either rewrite that line before the first push (history isn't public yet) or allowlist that one commit and path.
R2. **S1 (latent, old finding 1, still open): pre-rewrite history is still local, and the hook can be bypassed by SHA.** `refs/original/refs/heads/S-01-scaffold-ci-pages` still exists. Commits reachable only from reflogs and `refs/original` (22 commits) contain the blocked word 120 times (counted, not printed). None of it is in messages, so the message scan would not stop them. A push by SHA (`git push origin <old-sha>:refs/heads/x`) is not refused, as R1 shows in a scratch repo. The ref-name rule only covers spellings that start with `refs/original/`. Fix, after the seller agrees: delete `refs/original/*`, `git reflog expire --expire=now --all`, `git gc --prune=now`, then confirm `git log --all` and the counts above show 0. With R1 fixed the SHA route is also caught by content.
R3. **S3: false positive on the spreadsheet open-by-id call even when the id comes from a script property.** `SpreadsheetApp.<open-by-id>(PropertiesService.getScriptProperties().getProperty('SHEET_ID'))` is flagged "sheet". If S-03/S-04 use a standalone (not container-bound) script, that is the correct pattern and the scan will block it. Suggest flagging the call only when its argument is a string literal. Not flagged (good): `SpreadsheetApp.getActive()`, `getActiveSpreadsheet().getSheetByName(...)`, `getProperty('SELLER_WHATSAPP')`, `Utilities.getUuid()`, `` `#/b/${token}` ``, `wa.me` template URLs, ISO timestamps, epoch ms, `sha384-`/`sha512-` integrity strings.
R4. **S4: other false positives.** A 40+ character camelCase identifier with a digit (for example a handler or test name like `handle...ForUnit2`) is flagged "sheet". A test fixture `const token = '<16+ chars>'` is flagged "secret". Workarounds exist: shorter names, assembling fixtures from pieces.
R5. **S4: workflow settings have no tests.** Nothing fails if `REQUIRE_BLOCKED_WORDS` or `fetch-depth: 0` is removed from `ci.yml` or `deploy.yml`. A test that reads both YAML files and asserts these lines would close it.
R6. **S4: the hook scans the working tree, not the pushed tip.** It also scans untracked files. Untracked files make it conservative (can block spuriously), but the working tree can belong to a different branch from the one being pushed. R1's fix makes this second-order.
R7. **S4, carried over:** old finding 8 (`deploy.yml` "Do not enable before Gate G0" comment) and old finding 9 (photo budget only under `photos/`) are unchanged. Both are notes for G0.1 and S-05.

### Old findings 1 to 9

1 open (now R2). 2 fixed (new FP R3). 3 fixed. 4 fixed for fail-closed; the hook exists, but R1 limits it. 5 fixed. 6 fixed (17 red tests). 7 fixed (exact `content` and head order, checked by reading and by the red/green structure; I did not re-run the CSP mutation). 8 and 9 open as S4 notes.

### Not verified

- A real push to GitHub, and Actions runs (deploy criterion, still manual after G0.1, steps in the entry above). That includes `fetch-depth: 0` actually giving full history on the runner, and GitHub's PR merge commit identity passing the scan.
- `--no-verify` and fresh clones that never ran `npm install` both skip the hook. There is no server-side control. GitHub push protection or secret scanning was not evaluated.
- The pre-push behaviour on Windows or with a GUI client. Pushing tags. Force-push when the remote sha is unknown locally (that code path was not exercised).
