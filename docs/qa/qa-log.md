# QA log

One dated entry per story verified (see `docs/qa/README.md`). No real names, numbers, tokens, sheet links or IDs in this file.

## Scenarios

| ID | Story | Automated or live | Last run | Result |
|---|---|---|---|---|
| T-12 (CI half: tracked-file scan) | S-01 | Automated (`npm run pii`) | 2026-11-03 | Pass, with rule gaps listed under S-01 below |
| T-02 (domain half) | S-02 | Automated (`test/unit/queue.test.ts`) | 2026-11-03 | Pass |
| T-03 (domain half: partial hold) | S-02 | Automated | 2026-11-03 | Pass. Booking grouping is S-11 |
| T-04 (domain half) | S-02 | Automated | 2026-11-03 | Pass. New higher ID is S-11's job |
| T-06 (domain half) | S-02 | Automated | 2026-11-03 | Pass for the cases tested. See S-02 F1 (a restored claim is never stamped) |
| T-07 (domain half: overflow detection) | S-02 | Automated (`canMarkSold`) | 2026-11-03 | Pass. Revert and cell note are S-15. See S-02 F2 (NaN quantity) |
| T-17 (fixture half) | S-03 | Automated (`test/unit/migrate*.test.ts`, in-memory fake) | 2026-11-04 | Pass on the fake; B1 to B4 and F5 closed (re-check). Live half after G0.3 |

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

---

## 2026-11-03 (final re-review): S-01 fixes for R1 to R7

**Branch:** `S-01-scaffold-ci-pages` at `3b14f98`, 26 commits on main plus branch. History was rewritten again before this review (fixture literal split, history allowlist emptied), so hashes in earlier entries no longer resolve.
**Result:** Not signed off for merge or first push. The new pushed-content scan closes the exact R1 case, but merges get around it (finding F1, S1).

### Verified

- **Gate:** `npm ci && npm run check`, exit 0. Vitest 121/121 (10 files), Playwright 16/16 (Chromium and WebKit, Pixel and iPhone), size 0.7 KB of 50 KB, `pii-scan: 72 files, 0 finding(s)`. The WebKit teardown crash did not happen this run (it is logged as an S4 environment flake, macOS Screen Time KVO in Playwright WebKit).
- **R1 probe through the real `.githooks/pre-push`** (scratch clone, scratch bare remote, synthetic blocked word through `PII_BLOCKED_WORDS`). Commit 1 adds a non-synthetic number and the word, commit 2 deletes them. Pushing that branch is REFUSED (phone and blocked-word findings for the add commit, exit 1). Pushing `<sha>:refs/heads/x` while a clean branch is checked out is REFUSED. Pushing only the add commit by SHA is REFUSED. A clean push of main plus the branch (26 commits) is accepted with 0 findings.
- **History mode:** `node tools/pii-scan.mjs --require-blocked-words` gives 0 findings. `scanRevisions(main, branch, --full-history)` gives 0 findings. `tools/pii-history-allow.txt` has no active lines. The repo has no merge commits, so F1 hides nothing in it today.
- **History counts, main plus branch (counts only, no values printed):** blocked word 0 in messages, identities, full patches (+ and -) and every commit tree. The scanner's rules over all patch lines (lockfile excluded) and all messages: 0. The only number-pattern hit is the fictional 90000-series negative-test line. No emails other than the GitHub user no-reply, `noreply@github.com` and `noreply@anthropic.com`. Every author and committer uses the user no-reply address.
- **Tests first:** I ran Vitest on a `git archive` of each commit. Content-scan group: red at `dd02fc2` (12 new failures), green at `761d567`. False-positive group: red at `86febbd` (2 new failures), green at `9665574`. Workflow group: `60d017e` pins the existing settings (passing) and has 1 failing stale-comment check, which turns green at `fc8def2`. The 2 fail-closed CLI failures in every archive come from the archive having no `.git`. They also fail at the green commits, and they pass in the real gate.
- **Edited pre-existing test** (`pii-scan-ids.test.ts`, the variable argument changed to a literal `'id'`): legitimate. The old assertion encoded the R3 false positive. The literal case is still asserted, and `pii-scan-fp.test.ts` now asserts that the variable and script-property forms pass.

### Findings (worst first)

F1. **S1: merge commits get past the pushed-content scan (pre-push and CI history mode).** Reproduced in a scratch repo, and the push went through the real hook with exit 0:
  (a) A side branch adds a number and the word and then deletes them. It is merged with `--no-ff`, and the merge branch is pushed: `pre-push: 3 commit(s) ... 0 finding(s)`. The blob reached the remote. Cause: `scanRevisions` passes the pathspec `-- . :(exclude,glob)**/package-lock.json`. Any pathspec turns on git's history simplification, and a merge that is TREESAME to its first parent hides the whole side branch. Without the pathspec, or with `--full-history`, the same log shows both hits. `node tools/pii-scan.mjs` on that branch also reports 0.
  (b) An evil merge: content added in the merge commit itself, then deleted in the next commit. Pushed with 0 findings. Cause: `git log -p` shows no diff for merge commits by default.
  Fix: add `--full-history --diff-merges=first-parent` to both `git log` calls in `scanRevisions`, with add-then-delete-via-merge and evil-merge cases in `pii-scan-history-content.test.ts`. Developers merge `main` back into story branches, and GitHub creates merge commits, so this is the normal workflow, not an edge case.
F2. **S3: `scanPatchLog` attributes added lines to the wrong file.** After a hunk, the next `diff --git` line is not treated as a file boundary (the `!inHunk` guard), so `flush()` does not run. Added lines from file A collect under the next file's name. Reproduced: a number in `test/a-first.txt` is reported as `test/b-second.txt`. Nothing is lost today, because the lockfile is excluded by pathspec. **But if F1 is fixed by dropping the pathspec and relying on `SKIP_CONTENT`, the content of any file that sorts just before `package-lock.json` in the same commit would be skipped silently.** The wrong name can also make a history allowlist entry excuse the wrong file. Fix: treat `diff --git` as a boundary whatever the hunk state, and add a two-file test.
F3. **S4: the CLI history mode fails open on git errors.** `try { ... scanRevisions(["HEAD"]) } catch { /* no commits */ }` swallows any failure, for example maxBuffer or a shallow clone. Then the CI history scan is skipped with exit 0. The pre-push path fails closed (it throws). Suggest catching only "no commits".
F4. **S4: a nested `**/package-lock.json` is excluded from history content.** The working-tree scan skips only the root lockfile.
F5. **S4: binary file content is not scanned** (in history or the working tree), for example screenshots or PDFs. Path rules cover the sheet-export extensions only. Screenshots need a manual look (hard rule 1 includes screenshots).
Noted by the implementer and not re-probed: EISDIR crash on untracked symlinked directories; false positive on a 16+ character string assigned to `token`.

### Status of R1 to R7

R1: fixed for linear history (probe refused). Reopened as F1 for merges. R2: **open**, `refs/original/` still exists, and 77 commits reachable through `--all --reflog` hold the blocked word 120 times (counted). Waits for the owner's consent to delete. R3: fixed (literal-only, tested). R4: camelCase part fixed; the `token` false positive remains (S4). R5: fixed (`workflows.test.ts`). R6: fixed in effect (the pushed range is scanned by content; the working-tree scan stays as an extra). R7: fixed (deploy comment, photo convention in CLAUDE.md).

### Sign-off

- Merge to main: **no**, until F1 is fixed with a failing test first (F2 at the same time is advised). After that, a re-check of the merge probes is enough.
- First push: **no**, until F1 is fixed, plus R2 cleanup (delete `refs/original/*`, expire reflogs, `gc --prune=now`, recount 0 across `--all --reflog`) and the `PII_BLOCKED_WORDS` repository secret.

### Not verified

A real push to GitHub and Actions runs (the deploy criterion, manual after G0.1, steps in the first entry). Tag pushes. Force-push over an unknown remote sha. Windows or GUI clients. `--no-verify` and clones that never ran `npm install` skip the hook entirely. There is no server-side control, and GitHub push protection was not evaluated. ESLint and tsconfig strictness were not reviewed again.

---

## 2026-11-03 (narrow re-check): F1 to F3 fix

**Branch:** `S-01-scaffold-ci-pages` at `157e9a4`. Red commit `0fa0d0c` adds `test/unit/pii-scan-merge.test.ts`. Fix commit `157e9a4` changes only `tools/pii-scan.mjs`. The owner limited the scope: this checks only the merge case and the fixes that came with it. Other leftovers go to S-17.
**Result:** Pass. Signed off for merge to main. Signed off for first push on two conditions: R2 cleanup and the `PII_BLOCKED_WORDS` secret.

### Verified

- **Gate:** `npm ci && npm run check`, exit 0, first run (no WebKit teardown crash). Vitest 131/131 (11 files), Playwright 16/16, size 0.7 KB of 50 KB, `pii-scan: 73 files, 0 finding(s)`.
- **Red to green:** I ran Vitest on a `git archive` of each commit, for the new file only. `0fa0d0c`: 7 failed, 3 passed. The failures are the two-file attribution test, the file next to the lockfile, F1a scanRevisions plus pre-push, F1b scanRevisions plus pre-push, and the CLI failing closed on a missing object. `157e9a4`: 10/10. `git diff 0fa0d0c^ HEAD -- test/` shows only the new file. No existing test was edited.
- **Fix, by reading the diff:** both `git log` calls in `scanRevisions` use `--full-history --diff-merges=first-parent` with no pathspec. Any `diff --git` line now starts a new file, even inside a hunk (it can't be a hunk line, because hunk lines start with `+`, `-`, space or `\`). The lockfile skip is an exact basename match (`package-lock.json` or `*/package-lock.json`). The CLI history scan runs only when `rev-parse --verify HEAD^{commit}` succeeds. Any git error after that is thrown, and stderr is inherited.
- **Probes through the real `.githooks/pre-push`** (scratch clone of the project, scratch bare remote, synthetic blocked word in `PII_BLOCKED_WORDS`, non-synthetic `+91 90000 1xxxx` number):
  - F1a (a side branch adds and then deletes, merged `--no-ff`): push REFUSED, exit 1, phone and blocked-word findings reported for the side commit's `docs/leak.txt`. `node tools/pii-scan.mjs` (CI history mode): exit 1, the same 2 findings.
  - F1b (an evil merge adds content, the next commit deletes it): push REFUSED, exit 1, findings reported for the merge commit's `docs/evil.txt`. CLI: exit 1, the same 2 findings.
  - F2 (one commit, number in `docs/a-first.txt`, clean `docs/b-second.txt`): push REFUSED with the correct file name, `docs/a-first.txt`.
  - Clean push of main plus branch to a fresh bare remote, with the remote-tracking refs deleted so nothing counts as "already pushed": ACCEPTED, exit 0, `pre-push: 29 commit(s) ... 0 finding(s)`. When the tracking refs are still there, the hook correctly counts 0 new commits.
- **Probe-setup note:** my first attempt symlinked `node_modules` into the scratch clone. The working-tree scan then crashed with EISDIR, so the push was blocked, and the CLI printed a stack trace but exited **0**. This is the known S-17 EISDIR item. The exit-0 part is new information (see below). The probes above were rerun without the symlink.

### Deferred to S-17 (owner decision, not chased)

- F4: a nested `**/package-lock.json` is skipped in history content, but the working-tree scan skips only the root lockfile.
- F5: binary content (screenshots, PDFs) is not scanned. Screenshots need a manual look.
- EISDIR: an untracked symlinked directory crashes the working-tree scan. I saw it here as a side effect. Run directly (`node tools/pii-scan.mjs`), the crash exited with **status 0**, which is fail-open. Through the hook the push was still blocked. Not re-probed to isolate the cause. The S-17 fix should make the crash exit non-zero and skip directories.
- False positive: a 16+ character string literal assigned to `token` is flagged "secret".
- Carried over: there are no tests for `ci.yml` and `deploy.yml` beyond `workflows.test.ts`. Tag pushes and force-push over an unknown remote sha have not been exercised. `--no-verify` and clones without `npm install` skip the hook.

### Still open, outside S-17

- R2: `refs/original/*` still exists (1 ref, checked today). The pre-rewrite commits it reaches hold the blocked word. The owner must delete it before the first push: `git update-ref -d` each `refs/original/*` ref, `git reflog expire --expire=now --all`, `git gc --prune=now`, then count the blocked word across `git log --all --reflog -p` and confirm it is 0.
- The `PII_BLOCKED_WORDS` repository secret must exist on GitHub before the first push, or `ci.yml` push runs and `deploy.yml` fail closed (by design).

### Sign-off

- Merge S-01 to main: **yes**.
- First push to GitHub: **yes, if and only if** (i) the R2 cleanup above is done and recounted to 0, and (ii) the `PII_BLOCKED_WORDS` secret exists. Use a normal push (`git push origin main`), not `--mirror`.

### Not verified

A real GitHub push and Actions runs (the deploy criterion is still manual after G0.1, with the steps in the first entry). Anything outside the F1 to F3 fix: per the owner's scope, I did not re-review the rest of the diff, lint or tsconfig, or the other scan rules.

---

## 2026-11-03: S-02 Queue engine with quantity

**Branch:** `S-02-queue-engine` compared with `main`. Red commit `b95811d` adds `test/unit/queue.test.ts` (53 tests). Green commit `43ee0fd` adds `src/domain/queue.ts`, about 100 lines. No test changed between red and green.
**Result:** Not signed off yet. The engine itself is correct for the rules as the proposal states them. What's missing: the proposed decisions aren't recorded (DoD), the F1 rule needs a decision, and two small test gaps remain. Details below.

### Verified

- **Gate:** `npm run check`, exit 0 on the first run (no WebKit teardown flake). Vitest 184/184 (12 files), Playwright 16/16, size 0.7 KB of 50 KB, `pii-scan: 77 files, 0 finding(s)`.
- **Red, then green:** I ran `b95811d` from a `git archive` copy. It fails with "Cannot find module ../../src/domain/queue", so every test is red only because the module is new. At `43ee0fd`, 53/53 pass.
- **Diff hygiene:** only the two files changed. No console or debugger statements, no `.only` or `.skip`, no new dependencies. All test data is synthetic (numeric IDs and ISO timestamps, no people).
- **Purity:** no clock, no platform imports. `now` is passed in. Tests check that inputs are not mutated and that input order doesn't change roles.
- **Signature:** `recalculate(item, claims, now)`. This is the story's single `recalculate(item, claims)` with `now` passed in, which the brief allows. `canMarkSold(item, claims, claimId)` is a separate validator for rule 7. It doesn't produce holder or promotion results, so it doesn't break the "single function" criterion.
- **Mutation run** on a scratch copy of the branch (`git archive`), with `queue.test.ts` run after each mutant:

| Mutant | Result |
|---|---|
| M1: sort by string ID | Red, 2 tests |
| M2: `active < unitsLeft` (off by one) | Red, 26 tests |
| M3: `unitsLeft + 1` | Red, 28 tests |
| M4: keep `promotedAt` on demotion | Red, 3 tests (including both T-06 tests) |
| M5: stamp holders who were never waiting (creation holders) | Red, 5 tests |
| M6: drop the `max(0, …)` clamp | Red, 1 test |
| M7: `soldOut = unitsLeft === 0` (ignores whether anything was sold) | **Survives**, 53/53 |
| M8: `canMarkSold` uses `>` instead of `>=` | Red, 2 tests (T-07) |
| M9: no sort at all | Red, 2 tests |
| M10: keep `promotedAt` on a released claim | Red, 1 test |
| M11: a holder keeps the `promotedAt` it came in with, whatever its `previousRole` | **Survives**, 53/53 |
| M12: never report demotions | Red, 4 tests |
| M13: refuse to sell a waiting claim | Red, 1 test |

- **Rule coverage, 6.1.1 to 6.1.8:**
  - **Rule 1:** tested (M1, M9).
  - **Rule 2:** tested (M2, M3).
  - **Rule 3:** tested (M4, M5, M10, M12), apart from M11.
  - **Rules 4 and 5:** tested. Both follow from ordering by ID, so the M1 and M9 tests cover them too.
  - **Rule 6:** the lock belongs to the caller. Here it's covered by the purity and idempotence tests, as the story says.
  - **Rule 7:** tested (M8, M13).
  - **Rule 8:** tested, apart from M7.

### Findings (worst first)

- **F1 (S3, design): a restored claim is never stamped, even when it is newly holding.** Rule 4 covers undoing a sale or a release. The caller passes `previousRole: null` for the restored claim, so the engine can't tell it from a brand-new claim, and it never gets `Promoted at`. Reproduced: quantity 2, claims 1 and 2 released, claim 3 restored (was waiting, then sold by mistake, then undone), claim 4 waiting. Result: 3 and 4 are both holders, but only 4 is stamped, and `promoted` is `[4]`. Claim 3 never held a unit before, yet it gets no `To do` row, so the seller has no prompt to message that person. Workaround: the buyer's booking page shows the hold, and the seller can see it in `Claims`. Because of D-010 (no expiry), a hold nobody knows about can sit unclaimed indefinitely. **Recommended smaller rule:** widen `previousRole` to `"holder" | "waiting" | "sold" | "ended" | null` and stamp on any change into holder from anything except `"holder"` or `null`, where `null` means only "created in this write". A restored claim then comes in as `"sold"` or `"ended"` and is stamped if it lands as a holder. A T-06 original holder that regains its place is also stamped. The brief doesn't forbid that: T-06 only asks that the *other* claim be cleared. One extra message after a seller's own mistake costs less than a hold nobody acts on. If the PM wants original holders left unstamped, the engine needs the claim's role from before it left the line, which means storing more data. That's the larger option.
- **F2 (S3): a NaN quantity turns off the overflow check.** I confirmed `canMarkSold({quantity: NaN}, …)` returns `{ok: true}`, because `NaN <= 0` and `sold >= NaN` are both false. `recalculate` then returns `unitsLeft: NaN`, makes every claim waiting, and sets `soldOut` to false. A blank or text `Quantity` cell parsed with `Number()` could slip past rule 7. A quantity of 2.5 produces 2 holders and "2.5 left". Fix: treat a quantity that isn't a non-negative whole number as invalid in both functions, starting with a failing test. This is cheap now and could also be guarded in S-15.
- **F3 (S3, contract risk for S-11 and S-15): `previousRole` has nowhere to live.** The `Claims` columns in brief 4.1 don't include a role. If a caller passes `null` for everyone, nobody is ever stamped: the `To do` tab stays empty and T-02's notification fails silently. Callers should work out `previousRole` by running `recalculate` on the claims as they were before the change, under the lock. That approach also produces `"sold"` and `"ended"`, which fits the F1 rule. Alternatively, add a script-written role column, which is an S-03 schema change. The PM should record which approach is chosen.
- **F4 (S3, contract risk for S-15): `canMarkSold` assumes the claim isn't sold yet.** It rejects a target that isn't `active`. When the seller edits the sheet, the on-edit trigger sees `State` already set to `sold`. If S-15 passes the claims as they are after the edit, every sale is reverted with "Only an active reservation…". This is unconfirmed because S-15 doesn't exist yet. Document the expected input (the claims before the edit), or add an after-edit check (`sold > quantity`).
- **F5 (S4, coverage): M7 survives.** No test checks `soldOut` for quantity 0 with nothing sold, so proposed decision 3 isn't locked in. Add `expect(r.soldOut).toBe(false)` (and `itemSold` false) to the quantity-0 test.
- **F6 (S4, coverage): M11 survives.** No test feeds a holder with `previousRole` `null` or `"waiting"` together with an existing, stale `promotedAt`.
- **F7 (S4, docs):** `docs/decisions/README.md` says "Next free ID: D-024", but D-024 and D-025 already exist. The next free ID is D-026.

### Proposed design decisions

1. **Stamp only on a waiting-to-holder change; creation holders are not stamped.** Agreed. It matches rule 3 ("newly promoted") and the meaning of `To do`: a buyer who holds from the start already saw "held" on the confirmation screen. M5 confirms it's tested. The cost is F3: the caller must supply `previousRole`.
2. **Restored claims come in as `null` and are never stamped.** Not agreed. See F1 and its recommended rule.
3. **`soldOut` only when at least one unit is sold and `unitsLeft` is 0.** This fits 6.2 for the "Sold" label: an item that sold nothing shouldn't say "Sold". But with quantity 0 and nothing sold, 6.2 then shows "Reserved, N waiting, Join waiting list", even with 0 claims. That's misleading, and joining that list goes nowhere. Recommendation: quantity 0 means "not for sale". Hide it from the list like a sold-out item, and have the direct link say it isn't available. The engine should flag this explicitly (for example `unavailable: true`) rather than display code reading it from `freeUnits`. This needs a PM decision before S-06. It's untested now (F5).
4. **`unitsLeft = max(0, quantity − sold)` on bad data.** Agreed and tested (M6). `freeUnits` is clamped too. Bad data shows "sold out" rather than a negative count. It doesn't cover NaN (F2).

### Sign-off

- Merge S-02: **not yet.** I'll re-review when (a) the PM has recorded the S-02 decisions (D-026 or later) for points 1 to 3 and the F3 `previousRole` source, (b) F1 is either fixed with the recommended rule plus a failing-first test, or explicitly accepted in that decision, and (c) the F5 test is added. F2 should be fixed in this story. F6 is optional.

### Not verified

- Anything to do with sheets, triggers, the lock, or the API (S-11, S-15).
- Duplicate claim IDs: the engine returns the same ID twice, as both holder and waiting. Rule 1 makes unique IDs the caller's guarantee, so I tested this but didn't raise it as a finding.
- I didn't run the mutants against the whole suite, only `queue.test.ts`.
- There's no UI, so no viewport or screenshot checks.

---

## 2026-11-03 (re-review): S-02 after D-026

**Branch:** `S-02-queue-engine`, the three commits after the first S-02 entry (`cf9a241`): `8dcea2e` (PM records D-026), `c12f2b8` (red tests), `adefd76` (implementation).
**Result:** **Signed off for merge to `main`.** No S1 to S3 findings. Everything the first review asked for is done. Four S4 notes below can be picked up later.

### What changed

D-026 sets these rules. **Promotion:** any change into holder from a `previousRole` other than `"holder"` or `null` counts as a promotion. `null` means only "created in this write". **Role source:** callers rerun `recalculate` on the claims as they were before the change, so there is no schema change. `canMarkSold` also takes the claims from before the edit, and a note about this was added to S-15. **Quantity 0 or not a whole number:** `unavailable: true`, with no holders. `canMarkSold` refuses these items. The decisions README now gives D-027 as the next free ID. In the engine, `previousRole` gains `"sold"` and `"ended"`, `RecalcResult` gains `unavailable`, and a `validQuantity` guard is used in both functions.

### Verified

- **Gate:** `npm run check`, exit 0 on the first run with no WebKit flake, so no rerun was needed. Vitest 218/218 (12 files), Playwright 16/16, size 0.7 KB of 50 KB, `pii-scan: 78 files, 0 finding(s)`.
- **Red, then green:** I ran `queue.test.ts` on `git archive` copies of each commit. At `c12f2b8`, 26 tests fail and 61 pass (87 total). Every failure is an `AssertionError` on the new behaviour: `unavailable` is undefined, `promotedAt` is null where `now` is expected, `promoted` is `[]` where `[1]` is expected, and `canMarkSold` accepts NaN, 2.5 or `"3"`. There are no import, type or compile errors. At `adefd76`, 87/87 pass. `adefd76` touches only `src/domain/queue.ts`, with no test edits.
- **The 4 changed tests are legitimate, not weakened:**
  - Three T-06 tests and the "undo a release, formerly waiting" test now pass `"sold"`/`"ended"` instead of `null` for the restored claim. This is the input contract in D-026 §2.
  - Each test keeps all of its old role, demotion and cleared-`promotedAt` assertions. The only flipped expectation is the restored claim's own stamp: from `null`/`promoted: []` to `now`/`promoted: [id]`. That is the "accepted cost" written in D-026 §1.
  - Two tests gained assertions (claim 2's original `promotedAt` is kept, and the exact `changes` value is checked).
  - The idempotence test now persists `out.role` directly. It previously mapped sold/ended to `null`. This follows D-026 §2 and still asserts that the second run gives no changes.
- **D-026 matches the tests:**
  - §1: covered by the F1 repro, the restored-from-ended test, restored claims landing as waiters (not stamped), `"holder"` not promoted, and `null` not stamped.
  - §2: this is the caller's contract. It shows up in the test header comment and the idempotence test.
  - §3: quantity 0 gives `unavailable` true and `soldOut` false, and invalid quantities (NaN, ±Infinity, -1, 2.5, `"3"`, undefined, null) give `unavailable`, no holders, and a `canMarkSold` refusal with a plain reason that doesn't contain NaN, undefined or Infinity. All tested. One wording mismatch is listed under S4-a.
- **Mutation run** on a scratch copy of `adefd76`, running `queue.test.ts` (87 tests) after each mutant. The script is at a scratch script outside the repo (not kept).

| Mutant | Result |
|---|---|
| M1 sort by string ID | Red, 2 |
| M2 `active < unitsLeft` | Red, 36 |
| M3 `unitsLeft + 1` | Red, 31 |
| M4 keep `promotedAt` on demotion | Red, 14 |
| M5 / N1 treat `previousRole` null as a promotion | Red, 5 |
| M6 drop the `max(0, …)` clamp | Red, 1 |
| M7 `soldOut = unitsLeft === 0` (**survived before**) | **Red, 4** |
| M8 `canMarkSold` `>` instead of `>=` | Red, 2 |
| M9 no sort | Red, 2 |
| M10 keep `promotedAt` on a released claim | Red, 1 |
| M11a a new holder keeps a stale `promotedAt` (**survived before**) | **Red, 1** |
| M11b a promoted holder keeps a stale `promotedAt` (`?? now`) | **Red, 2** |
| M12 never report demotions | Red, 6 |
| M13 refuse to sell a waiting claim | Red, 1 |
| N2 `"sold"` previousRole is not a promotion | Red, 5 |
| N3 `"ended"` previousRole is not a promotion | Red, 6 |
| N4 `"sold"`/`"ended"` handled like `null` | Red, 9 |
| N5 accept non-integers (2.5 available) | Red, 2 |
| N6 coerce numeric strings (`"3"`) | Red, 2 |
| N7 quantity 0 not unavailable | Red, 2 |
| N8 `canMarkSold` skips the validity check | Red, 6 |
| N9 `canMarkSold` skips the quantity-0 check | Survives (still refused, see S4-b) |
| N10 `soldOut` ignores `unavailable` | Survives (see S4-c) |
| N11 unavailable waiters get `itemSold` | Red, 1 |
| N12 allow negatives (`>= -1`) | Red, 1 |
| N13 `freeUnits` not clamped | Red, 11 |
| N14 unavailable items still get holders | Red, 3 |
| N15 `validQuantity` rejects 0 too (only changes the message) | Survives (see S4-b) |

Both mutants that survived the first review (M7, M11) now fail. 25 of 28 are killed. The 3 survivors change only a refusal message or the `soldOut` value on an item that is already hidden as unavailable.

- **Hygiene:** the diff since `cf9a241` covers 5 files, all expected. There are no `console`, `debugger`, `.only` or `.skip` lines and no new dependencies. Test data is synthetic: numeric IDs, ISO timestamps, no people.

### Findings (worst first)

None at S1 to S3.

- **S4-a (docs): D-026 §3 says quantity 0 means "no holders, no waiting list", but the engine keeps claims as `waiting` with positions and reports `waitingCount`.** The test file explains this on purpose ("data is kept and restoring the quantity restores the line"), and I think that behaviour is right. The decision text should say it, so that S-06/S-11 know not to show "N waiting" or allow joins when `unavailable` is true. The API must refuse new reservations on an unavailable item: the engine doesn't block joins.
- **S4-b (coverage of messages): no test pins which reason `canMarkSold` gives for quantity 0.** If the quantity-0 branch is deleted, the item is still refused, but with "All 0 units are already sold. Undo another sale first." (N9). If 0 is treated as invalid, the reason becomes "isn't a whole number" (N15). Both messages mislead the seller, but the item is still refused. Separately, -1 is refused with "isn't a whole number", which is inaccurate wording for a negative number.
- **S4-c: when an item has quantity 0 and at least one sold claim, `soldOut` is false, and no test fixes that value.** Mutant N10 survives. D-026 says unavailable wins, and the item is hidden either way. Pin it with a test if S-06 ever reads `soldOut` before `unavailable`.
- **S4-d (docs): the decisions README index has no rows for D-024, D-025 or D-026.** Only the "next free ID" line was updated. The README says to update both.
- **Observation, not a finding:** a temporary bad `Quantity` value (for example, text typed by mistake) demotes all holders and clears their `promotedAt`. Fixing the value promotes them again with a new stamp and new `To do` rows. Line order is kept, so no reservation is lost. This follows from D-026 ("nobody gets a hold on bad data"), but the seller should know about it at G1.

### Sign-off

- Merge S-02 to `main`: **yes.** S4-a and S4-d are PM doc edits and can go in any later commit. S4-b and S4-c are optional tests.

### Not verified

- The caller side of D-026 §2 (rerunning `recalculate` on the claims from before the change under the lock, and S-15 rebuilding those claims from the edit event's old value). This can't be tested until S-11, S-14 and S-15 exist. It is the main integration risk: if callers pass `null` for everyone, nobody is ever stamped. S-11 and S-15 need an API-level test that a waiter promoted by a back-out or sale gets `Promoted at` and a `To do` row.
- Mutants were run against `queue.test.ts` only, not the whole suite.
- No UI, so no viewport or screenshot checks. Sheets, triggers and the lock were not examined.

## 2026-11-03: S-01 deploy check after first push (PM, live check)

- R2 closed: `refs/original` removed, reflog expired, gc run by the seller; blocked-word count over all refs, reflog and messages is 0.
- First push of `main` (pre-push hook: 40 commits, 0 findings). CI and Deploy to GitHub Pages both green; deploy ran fail-closed, so the blocked-words secret is present and non-empty.
- Live site returns 200 with title, viewport, referrer, robots and CSP meta tags. `/private/`, `/.git/`, `/.git/config`, `/BUILD_BRIEF.md` return 404.
- `playwright install --with-deps` works on the runner.
- Phone-viewport rendering covered by the CI e2e profiles; an on-device look is left to G1.

## 2026-11-04: S-03 Sheet schema and migration (scrubStaging, migrate, Apps Script adapter)

Branch `S-03-sheet-schema-migration`, commits f162cae (red), 601408e (green), ea37f67 (adapter and build), diffed against `main` 4fdb806. QA by the QA agent. No clasp was run and no sheet was touched. Every probe used the synthetic fixture and `+91 90000 000xx`-style digits.

### What changed

- `src/api/sheet.ts`: a minimal Spreadsheet/Tab interface. `src/api/migrate.ts`: `scrubStaging()` and `migrate()`, which are pure and run over that interface.
- `test/fixtures/fake-sheet.ts`, `test/fixtures/staging-fixture.ts`: an in-memory fake and a synthetic fixture. `test/unit/scrub-staging.test.ts` and `test/unit/migrate.test.ts` cover T-17.
- `src/appscript/adapter.ts` and `main.ts`: the SpreadsheetApp adapter, entry points and the token source from `Utilities.getUuid()`. `tools/build-gas.mjs` builds an IIFE bundle with top-level `scrubStaging`/`migrateSheet`. `tools/push-gas.mjs` runs clasp 3.4.1 through npx. `@types/google-apps-script` was added as a dev dependency and stated in the commit message. The size budget now skips `dist/appscript`.

### Verified

- **Gate:** I ran `npm ci && npm run check` fresh and it exited 0. Results: Vitest 14 files and 283 tests passed, Playwright 16 passed, size 0.7 KB of 50 KB gzipped, and `pii-scan: 89 files, 0 finding(s)`. npm audit reports 11 moderate issues in dev dependencies (not new to S-03, not chased).
- **Tests first:** f162cae contains only stubs and tests, then 601408e adds the implementation. `.clasp.json` and `dist/` are gitignored and untracked. `.clasp.json` has `rootDir: dist/appscript`, so a push cannot upload repo files.
- **Bundle:** `npm run build:gas` produces exactly two top-level functions, `scrubStaging` (listed first) and `migrateSheet`. Everything else is inside `var A44`. The bundle has three `console.log` calls, and all of them log counts only.
- **Token randomness:** I took `randomBytes` out of the built bundle and ran it with a stubbed `Utilities.getUuid` backed by `crypto.randomUUID`. It produced 200,000 tokens of 16 bytes, using exactly 2 UUIDs per token. Indexes 12 and 16 of the dash-free UUID are the version and variant nibbles, so the extraction is correct. The worst per-byte chi-squared across the 16 positions was 296 (critical value about 330), and the worst per-nibble value was 27.3 (critical about 37.7). No byte is constant or biased. Without the drop, byte 6's high nibble would always be 4 (a 20,000/20,000 run), and no unit test would catch that (F8).
- **Refusal:** the BUILD COPY check runs before any write, the check is case-sensitive, and the error contains no data. All of this is tested.
- **Logs:** the scrub and migrate results and logs contain counts only, and this is tested with console spies.
- **Adapter vs real SpreadsheetApp:** this was a desk check, not run live.
  - `getGrid` guards empty tabs before `getDataRange`.
  - Indexes are 1-based throughout.
  - `getTitle()` maps to `Spreadsheet.getName()`, which is the file title.
  - `requireValueInList(list, true)` is used correctly.
  - `getSheets()` includes hidden tabs.
  - Merged cells hold their value in the top-left cell, so they are read and written correctly.
  - A scrub that crashes partway is safe to rerun: Person cells are simply overwritten again.
- **Mutants:** I ran them against a scratch copy, using the two S-03 test files. Killed: phone regex needing 11+ digits, Sold written as active, and the scrub filling blank Person cells. **Survived:**
  - removing `guardText` from the scrub
  - scanning row 2 of every tab
  - giving Available rows that have a Person a claim
  - removing `claimed.add`
  - a phone regex that accepts 9 digits
  - treating `""` as a valid status (the tests use `null` for a blank, but real Sheets returns `""`)
  - giving every synthetic name the same value
  - skipping the first row when collecting used IDs

### Findings (worst first)

**Blockers. These must be fixed before the scrub is pushed and run on the build copy:**

- **B1 (S1 latent): `migrateSheet` has no guard, and running it before the scrub leaves real names in Claims and Bookings after a "successful" scrub.** The scrub replaces only `Person` columns. `migrate` copies Person into `Name` in both new tabs.
  - Reproduced on the fixture: running migrate then scrub returned `peopleReplaced: 6`, and all three synthetic buyer names were still in the sheet.
  - Scenario: the seller picks `migrateSheet` from the Run dropdown by mistake (the two entries sit side by side), notices, and runs `scrubStaging`. She checks Person, the README and the headers as G0.3 asks, then says "scrub checked". Agents can then read real names from Claims and Bookings.
  - Fix: `migrate` refuses unless the title contains BUILD COPY **and** the scrub has visibly run (for example, every non-blank item-tab Person matches `^Test Person \d+$`, which the fake can test). Also make `scrubStaging` scrub (or refuse on) the `Name`/`Number` columns of existing Claims and Bookings tabs.
  - **My view on the guard: yes, add a BUILD COPY guard to `migrateSheet` now.** The brief (4.2) says the real sheet "stays public and in daily use… Nothing about it changes during the build". If the seller ever pastes the wrong script ID into `.clasp.json`, or copies the code into the real sheet, an unguarded migrate adds columns and tabs there and writes bearer tokens into a link-shared sheet. S-18 should lift the guard deliberately, for example with a Script Property holding the exact sheet name as confirmation, and record that in a decision.
- **B2 (S1 latent): the scrub skips a number stored as a number.** It only checks `typeof cell === "string"`. Sheets turns an unspaced number typed alone in a cell (for example `+919000000001` or `9000000001`) into a numeric cell.
  - Reproduced: a numeric README cell and a numeric header cell were both unchanged, and they were not counted.
  - The phone regex `/\+?\d(?:[\s-]?\d){9,}/` also misses these synthetic forms: `90000  00001` (double space), `90000 - 00001`, `90000.00001`, `90000/00001`, `90000–00001` (en dash), `+91 (90000) 00001`, and full-width digits.
  - It does catch: `+91-90000 00001`, the leading-zero 11-digit forms (spaced and unspaced), `(+91) 90000 00001` (leaves `(+91) [removed]`), `wa.me/91…`, `wa.me/+91-…`, `api.whatsapp.com/send?phone=91…`, and non-breaking spaces.
  - False positives are harmless because only the README and headers are touched. For example, an ISBN or a 13-digit order number becomes `[removed]`.
  - Fix: match on `String(cell)` for numbers. Count digits across a run with any short non-alphanumeric separators (1 to 3 characters, including `.`, `/`, `()` and dashes), and flag 10 or more.
- **B3 (S1 latent): the scrub never sees a number hidden in a hyperlink or formula.** `getValues()` returns displayed values only.
  - Scenario: a README cell reads "Message me on WhatsApp" and is a rich-text link (or `=HYPERLINK`) to `wa.me/91…`. The scrub reports 0 numbers, and the seller's by-eye check sees no number. D-019 then exports the copy to `.xlsx` and hyperlinks go with it. The brief (4.1) confirms the sheet uses rich-text links.
  - Fix, either one:
    - in code: for the README and header rows, also scan `getFormulas()` and every `getRichTextValues()` run's `getLinkUrl()`, and drop or rewrite any matching link;
    - or in the runbook: add a G0.3 step to open every link in the README and headers and remove any WhatsApp or phone link.
- **B4 (S2): the scrub fails open and reports success when it can't find what it should scrub.**
  - Reproduced: if a tab's Person header is `person`, `Person name`, `Reserved by` or `Buyer`, or a title row sits above the header, that tab's names are left untouched. The total still looks plausible (3 instead of 6), with no warning.
  - Also reproduced: if the README tab is named anything but exactly `README` (for example `Read me`), only its first row is scanned, and every number below it stays.
  - Agents may not look at the real header names, so the code can't be tuned to them.
  - Fix: log per-tab counts, using tab names only. Name every tab where no `Person` column was found, and say whether a `README` tab was found. Before G0.3, tell the seller the expected count from brief section 3 (7 Reserved + 3 Sold, so about 10 people).

**Follow-ups (not blocking the scrub):**

- **F5 (S2, must be fixed before S-18/G2): a rerun after deleting a row reuses the freed Item ID.** That attaches the old claim to a different item and drops the new reservation.
  - Reproduced: migrate, delete the Tripod row (I-0002, claim active), add a Reserved "Kettle" row, then migrate again. Kettle gets I-0002, 0 claims are created, and Claims shows Tripod's active claim (old name) under Kettle's ID.
  - Cause: `usedIds` is seeded only from the current item rows, not from `Claims` Item IDs.
  - Fix: seed `usedIds` from Claims as well, or allocate above the maximum ID ever issued.
  - Related edge, by design but undocumented: a sold-then-relisted item reserved again by hand is never migrated, because any existing claim for that Item ID blocks it. Write down that migrate is meant to run once per sheet, plus reruns to reconcile.
- **F6 (S3): rows that make no sense are skipped without any count.**
  - A Reserved or Sold row with a blank Person gets no claim. Reproduced: 5 claims instead of 6, with no message. After cutover, the API would treat that unit as free, which is a lost hold.
  - An Available row with a Person is ignored. Mutant M3 (claiming such rows) survives, so the current skip is not pinned by any test.
  - A Sold row whose price is text gets a blank Sold price.
  - Fix: log a count of each case, and add tests.
- **F7 (S3, unconfirmed): some notes and comments may survive the scrub.**
  - `clearNote()` runs on `getDataRange()` only. A note on an otherwise empty cell outside the data range is probably neither counted nor cleared. Use the full `getRange(1,1,maxRows,maxCols)`.
  - Threaded comments can't be removed by the script. The log tells the seller "Comments panel, Delete all". I'm not sure Sheets has a "Delete all" control: check the wording, and mention resolved comments.
- **F8 (S3): `randomBytes` in `main.ts` is logic in an untested file.** I verified it statistically (above), but a regression such as dropping the nibble filter or reading only one UUID would ship unnoticed. Move it to a module with `getUuid` injected, and test the length, nibble removal and the count of UUIDs used.
- **F9 (S4): the OAuth scope is broader than it needs to be.** There are no `oauthScopes` and no `@OnlyCurrentDoc`, so the seller will be asked to grant access to *all* her spreadsheets, the real sheet included. Add `@OnlyCurrentDoc` or the `spreadsheets.currentonly` scope. That lowers what any bug or `openById` could reach, and makes the consent screen less alarming.
- **F10 (S4): two problems with how clasp is pinned and pushed.**
  - The scanner workaround in `tools/push-gas.mjs` (building `name@version` at runtime) has no data risk. But it teaches "split the string to get past the scanner". Fix the scanner instead: an "email" whose domain is all numeric segments (`3.4.1`) is not an email.
  - `npx -y` fetches clasp with no lockfile integrity, and clasp holds the seller's Google OAuth token. Make it a pinned dev dependency, which only needs a one-line reason under rule 5.
- **F11 (S4): the fake doesn't behave like real Sheets in four ways.**
  - `sheet.ts` says "Strings are stored exactly as given". Real `setValue`/`appendRow` parse input: the guard apostrophe is not returned by `getValue`, `1/2` becomes a date, and `00123` becomes 123. A hex token is all digits, or digits with one `e`, about once in 10^6 tokens, and Sheets would then read it as a number.
  - The fake keeps `null` for blank cells, where real Sheets returns `""`.
  - The fake keeps ragged rows, where real Sheets returns rectangular ones.
  - The fake writes a new column at the header row's length. Real Sheets writes it at `getLastColumn()+1`. Real is the safer behaviour, but the tests don't model it.
  - S-04 onwards must not rely on the fake's version of any of these.
- **F12 (S4): small test and code gaps.**
  - The fixture comment promises "a quantity-3 row" that doesn't exist.
  - `idsAssigned` is only asserted as `>= 11`.
  - The surviving mutants are listed above.
  - `tsconfig` makes the Apps Script globals visible to `src/site` code too.
  - migrate reads the whole grid once per row (O(n²)). That is fine at 65 rows.
- **Observation:** the build copy's version history will keep the pre-scrub values. Agents must never open it. Owner-only sharing and the `.xlsx` export (which has no history) keep it contained.

### Verdict

**Blocked for pushing and running the scrub** until B1 to B4 are fixed, each starting with a failing test:

1. `migrate` refuses unless the title contains BUILD COPY and the scrub has run, and the scrub handles Claims/Bookings `Name`/`Number`.
2. Numeric cells are scanned, and the separators the regex accepts are widened.
3. Hyperlink URLs and formulas in the README and headers are scrubbed, or G0.3 gets an explicit step to check links by hand.
4. The scrub logs per-tab counts and names any tab with no Person column and a missing README tab.

F5 must be fixed before S-18. F6 to F12 can follow. The pure logic is otherwise sound, and the token source is correct.

### Not verified (manual or later)

- Nothing was run against real SpreadsheetApp. These adapter behaviours are desk-checked only:
  - `clearNote` scope
  - apostrophe handling
  - `appendRow` parsing
  - data validation on rows 2 to 1000
  - the To do / Sold formulas evaluating
  - object (chart) sheets in `getSheets()`
- **G0.3 manual check, after the blockers are fixed.** The seller runs `scrubStaging` alone, then:
  - reads the per-tab log against about 10 people;
  - opens every item tab, the Template and any extra tab, and checks that every Person cell reads `Test Person N`;
  - reads every README cell and every header, including hidden tabs, rows and columns;
  - hovers over or opens every link in the README and the headers;
  - checks that there are no notes, and deletes every comment thread, including resolved ones;
  - confirms no Claims or Bookings tabs exist yet.
- After the migration on the build copy (a live check):
  - the To do and Sold formulas render;
  - State validation rejects other values;
  - a formula-like name shows as text;
  - a second run reports all zeros.
- The npm audit moderates were not reviewed.

## 2026-11-04 (re-check): S-03 fix round for B1 to B4 and F5 to F12

Commits 7f73603 (red), f08f0fe, 7de5275 and c01426a (implementation), and 91e0d5f (two test defects fixed). QA agent. No clasp was run and no sheet was touched. Synthetic data only.

### Verified

- **Gate:** I ran `npm ci && npm run check` fresh and it exited 0. Vitest: 17 files, 366 tests. Playwright: 16. Size: 0.7 KB of 50 KB. `pii-scan: 93 files, 0 finding(s)`. `npm run build:gas` gives two top-level functions (`scrubStaging`, `migrateSheet`) and a manifest with only `spreadsheets.currentonly`. `allowUnscrubbed` appears in the bundle only as the check inside `migrate`. The entry point never passes it.
- **Tests first:** 7f73603 holds the red tests.
- **My first-review reproductions, rerun on the new code (fixture, synthetic):**
  - **B1 closed.**
    - migrate before the scrub: refused, and no Claims tab is created.
    - Title without BUILD COPY: refused, even with `allowUnscrubbed`.
    - Migrate (forced) and then scrub: no original name is left anywhere. Claims shows 6 names replaced.
    - Scrub then migrate: runs, and no names are left.
    - `Test Person 1 ` with a trailing space: refused, because the check is anchored.
  - **B2 closed.** A numeric README cell and a numeric header cell both become `[removed]`. The pattern now catches all of these:
    - a double space between the halves
    - ` - `
    - dot, slash and en-dash separators
    - `+91 (90000) 00001`
    - full-width digits
  - **B3 closed (on the fake).** A README cell whose rich-text link points to `wa.me/91…` keeps its text and loses the link. A `=HYPERLINK("https://wa.me/91…","Chat")` cell becomes the plain text `Chat`. No links or formulas are left, and the README count is 5.
  - **B4 closed as a warning.**
    - A Person header of `person` or `Reserved by`, or a title row above the headers, puts the tab in `tabsWithoutPerson` and logs `WARNING … names NOT replaced, check by hand`. The names in that tab are deliberately left, so the warning is the safeguard (R1).
    - A README named `Read me` gives `readmeFound: false` and a warning, and every cell in it is scanned.
  - **F5 closed.** After a row is deleted, the new Reserved row gets I-0012, not the freed I-0002, and its own claim.
- **Mutants:** 23 run against the four S-03 test files. The baseline is 135 tests, all green. **20 killed**, covering:
  - every first-round survivor except two
  - the title guard and the scrubbed-name guard
  - the anchored name match
  - link and formula removal
  - Claims/Bookings name and number scrubbing
  - numeric cells
  - full-width digits
  - the separator width
  - `tabsWithoutPerson` and `readmeFound`
  - Claims-seeded IDs
  - the three F6 counts

  **3 survive, all in the over-scrub direction and harmless:**
  - also scanning row 2 of item tabs
  - also scanning links and formulas in item-tab data rows
  - removing `claimed.add`, since Item IDs are unique within a run
- **F6 to F12:**
  - F6: the three counts are in the result and the log, and are tested.
  - F7: notes are now read and cleared across the whole tab, and the final log line now explains how to delete threaded comments by hand.
  - F8: `uuidsToBytes` is pure and tested, including a check for constant bits. `randomBytes` asks for one UUID per 30 digits, so if the loop is ever miscounted, `uuidsToBytes` throws rather than padding.
  - F9: the scope is set.
  - F10: clasp is a pinned dev dependency, the workaround is gone, and the scanner ignores all-digit "domains" (tested).
  - F11: the comment is fixed.
  - F12: the fixture comment is fixed and `tsconfig` is split. Apps Script globals are visible only to `src/appscript` and `src/api`.

### Adapter vs real Apps Script (desk check against the documented behaviour, not run)

- **`getRichTextValues()` on number and formula cells.** The docs say `getRichTextValue` returns null when the cell value is not text. Numbers, dates and booleans therefore give null, and `getLinks` skips nulls without crashing. Formula cells with a text result return a value. Whatever `getLinkUrl()` reports for `=HYPERLINK`, the URL is caught anyway by `getFormulas()`, which is how B3 removes it.
  - Remaining gap: a link attached to a cell whose value is a **number** is invisible to `getLinks` (R2).
  - `setLink(null)` rewrites the cell as rich text from `getDisplayValue()`. That is always plain text, so it can't turn into a formula.
- **Whole-tab notes (`getMaxRows` × `getMaxColumns`).** Each tab costs one batched `getNotes()` and, if any notes exist, one `clearNote()`. A default tab is 1,000 × 26 (26,000 cells), so each call should take well under a second. With about 6 tabs, the run should take seconds, not close to the 6-minute limit. It would only matter for tabs of millions of cells. Not measured live.
- **`spreadsheets.currentonly`.** Everything the scrub and migrate call works on the bound file:
  - `getActive`, `getSheets`, `getSheetByName`, `insertSheet`
  - `getRange`, values, `setValue`, `appendRow`, `setFormula`
  - notes
  - `setDataValidation`, `setRichTextValue`
  - The builders (`newDataValidation`, `newRichTextValue`) and `Utilities.getUuid`/`console` need no scope.
  - Only `openById`, `openByUrl` and `create` need the full spreadsheets scope, and none is used.
  - This depends on the script being **bound** to the build copy, which the runbook says it is.
  - Later stories must add scopes explicitly: MailApp (D-013) needs `script.send_mail`, and installable triggers need `script.scriptapp`. S-04 should confirm that `getActive()` works in the web-app context.

### Findings (worst first)

None at S1 or S2.

- **R1 (S3): "fail loud" is a log line only.** The run still ends green when `tabsWithoutPerson` is not empty or the README is missing. A non-technical seller could miss a WARNING line in the middle of the execution log. Suggested fix: `scrubStagingRun` throws a final summary error, with tab names only, after doing its work, so the editor shows red. For now, the G0.3 step below covers it.
- **R2 (S3, unconfirmed): a hyperlink on a number cell is not detected.** If the number is itself a phone number, the value is replaced, but whether `setValue` also drops the link is undocumented. Covered by the link step in G0.3.
- **R3 (S4): the phone pattern misses some forms.** It misses Devanagari digits and separators longer than 3 characters, such as a line break plus indentation. It over-matches date and time runs in the README, which then become `[removed]`. That's accepted, and affects the build copy only.
- **R4 (S4): side effects of scrubbing again after migrate.** It renumbers the Claims and Bookings names, so they no longer match Person. It could also write into the spill range of the To do and Sold FILTERs if a spilled cell held a phone number. Staging only: migrate writes Number blank anyway.
- **R5 (S4): two small inaccuracies.** The `MigrateResult` doc "All zero on a rerun" is no longer true, because the F6 counts repeat. `numbersRemoved` counts a Claims Number cell twice if it holds a phone number.
- **R6 (S4): pinning clasp brings 2 high (zod, memory exhaustion) and more moderate advisories into the dev tree.** It's a local CLI, never shipped. Revisit when clasp releases a fix.

### Verdict

**Sign-off with follow-ups.** The code may be pushed to the build copy and `scrubStaging()` run. R1 and R2 are covered by the manual steps below, and R1 should be fixed before S-04 relies on the copy. R3 to R6 are optional. S-03 becomes Done only after G0.3 is confirmed and the post-migrate live check passes. Merging to `main` doesn't depend on those.

### G0.3: exact steps for the seller

1. In the build copy, open Extensions > Apps Script. Choose `scrubStaging` in the function list (not `migrateSheet`), then press Run. Accept the permission prompt. It should ask only about **the spreadsheet this script is installed in**. If it asks for all your spreadsheets, stop and tell the PM.
2. Read the Execution log to the end.
   - If any line says **WARNING**, stop and tell the PM which tab names it lists. Don't say "scrub checked".
   - The last count should be about 10 people.
3. Open every tab, including hidden ones (right-click the tab bar). In each tab, check every row of the Person column: each one should read `Test Person` and a number, or be blank. Also look through the Notes column for real names.
4. Read every cell of the README tab, and the top row of every tab. Your phone number should appear nowhere. `[removed]` is expected.
5. Hover over or click every link in the README and in the header rows. None should open WhatsApp or show a phone number. Remove any that do.
6. Open the Comments panel (the speech-bubble icon, top right). Delete every comment thread, including resolved ones in the comment history. Then check that no cell has a small black corner triangle, which marks a note.
7. Check that there are no tabs called Claims or Bookings yet.
8. Tell the PM "scrub checked". Don't open version history in the build copy, and don't share the copy.

### Not verified

- Nothing has run on real Sheets. The rich-text, note, scope and timing points above are desk checks.
- After migrating the build copy, a live check still needs to show that:
  - the formulas show results
  - State validation works
  - a formula-like name shows as text
  - a rerun creates nothing
- Mutants were run against the S-03 test files only.

## 2026-11-05: S-03 bug fix D-027 (header row found, not assumed to be row 1)

Commits since 27a99fa: f475615 (red tests), 27b6708 (`findHeaderRow` in `src/api/header-row.ts`, used throughout `src/api/migrate.ts`), c32758a (sheet.ts comment) and 6c0fe2e (two test corrections). QA agent. No clasp was run and no sheet was touched. Synthetic data only.

Why this exists: the first live `scrubStaging` on the build copy logged `WARNING no Person column found` for Tech, Gym & Sport, Home Things, Books and Template, replaced 0 people and cleared 13 number cells. The real tabs have a title on row 1 and the headers on row 2. Every S-03 path read `grid[0]` as the header. D-027 is the spec.

### Verified

- **Gate:** `npm run check` run fresh (without `npm ci`; the dependencies were already installed). Exit 0. Vitest: 18 files, 403 tests. Playwright: 16 passed. Size: 0.7 KB of 50 KB. `pii-scan: 97 files, 0 finding(s)`.
- **Tests first:** f475615 contains only the tests and the fixture. The implementation follows in 27b6708.
- **Test corrections in 6c0fe2e are right.** `quantitiesSet = ids.length + 1` matches migrate.test.ts (11 + 1, the +1 being Template's example row), and my simulation gives 12. The inverted hardening test ("title row above headers" is no longer flagged and its Person is replaced) is what D-027 rule 1 requires.
- **No row-1 assumption is left on item tabs or Template in `src/`.** I grepped for `grid[0]`, `slice(1)`, `r = 1` and `setCell(1`. What's left is only on Claims, Bookings, To do and Sold (row 1 by D-027 rule 6), plus the `tabsWithoutPerson` "has data" check (`grid.slice(1)`), which is harmless. No other module in `src/` reads item tabs yet: `header-row.ts`, `migrate.ts`, `random.ts`, `sheet.ts`, and the adapter has no logic.
- **The re-run the seller will actually do, simulated.** I took the titled fixture, ran the **old** scrub (27a99fa) once, then the new scrub twice, then migrate.
  - Run 1 (old code) reproduced the live symptom: WARNING for all 5 tabs, 0 people.
  - Run 2 (new code): 6 of 6 people replaced, 0 numbers, 0 notes, no WARNING lines. No fixture buyer name is left anywhere.
  - Run 3: the same counts. It renumbers the same cells, so it's idempotent in effect.
  - Migrate after that passes the preflight: 10 columns, 4 tabs, 11 IDs, 12 quantities, 6 claims.
- **The migrate preflight (question 4)** checks only the rows below the detected header. A name in a row above the header is never a data row. `validateTab`, ID and quantity filling, and claim creation all start at `hr + 1`, so it can't become a claim. Pinned by the "does not read title rows as items" and "writes nothing into row 1" tests, and by the mutants below.
- **Template with its header on row 3** (not covered by the tests; I ran it by hand). ID and Quantity land on row 3, the note row 2 is untouched, and the example row on row 4 gets Quantity 1 and no ID. Correct.
- **Width (question 3).** The real adapter's `getGrid` is `getDataRange().getValues()`, which is rectangular. So `head.length` is the tab's last used column across **all** rows, and ID and Quantity land just to the right of the rightmost content anywhere in the tab (title row included). That never overwrites data, but it's K and L only if nothing sits to the right of the last header. On the fake, rows can be ragged. A header shorter than a data row would overwrite that data cell in the fake, but this can't happen on the real adapter. The behaviour is the same as before D-027.
- **Hidden tabs:** `getSheets()` returns hidden sheets, so they are scrubbed. (Desk check of the Apps Script docs, not run.)
- **Mutants:** 14 run against the full unit suite (baseline 403 green). **11 killed**:
  - search window 4 and 6
  - dropping `trim`
  - always returning row 0
  - scanning numbers on row 1 only
  - replacing people from the header row itself
  - the preflight skipping the first data row, or using `slice(1)`
  - writing the ID header to row 1
  - ID seeding skipping the first data row
  - `validateTab` skipping the first data row

  **3 survive:**
  - Formula and link keys limited to row 1. This only affects formula or link cells missing from `getGrid`. On the real adapter all three use `getDataRange`, so this is equivalent there.
  - Template's quantity loop starting at index 1. Equivalent when the header is on row 2, because the header's own Quantity cell isn't blank. It would write `1` into a note row if Template's header were on row 3 or lower (see F-B).
  - A case-insensitive `person` match. D-027 says "exactly", but no test pins it.

### Findings (worst first)

None at S1 or S2.

- **F-A (S3, reproduced on the fake, latent): a stray cell reading exactly `Person` above the real header silently defeats the scrub for that tab.** I put `Person` in Tech L1. `findHeaderRow` picked row 1 and `personCol` became L. The scrub then reported `Tech: 0 people` with **no WARNING**, and 2 buyer names were left in Tech. When the stray cell is in the same column as the real Person header, the real header cell on row 2 is overwritten with `Test Person 1`. Migrate does refuse afterwards (`Tab "Tech" has no "Item" column`), so nothing reaches Claims. D-027's Cost section accepts this case, but only for migrate. The scrub has no equivalent loud failure.
  - **Live risk is very low:** the first live run read `grid[0]` and found no `Person` in row 1 of any tab, so row 1 is known to be clean. Rows 3 to 5 could only matter if a tab's header is below row 2.
  - Covered by the by-eye check. Suggested fix: the scrub warns when the detected header row has no `Status` (or item-name) cell, or when a tab with data replaces 0 people.
- **F-B (S4): coverage gaps.**
  - Template with its header on row 3 or lower is untested. It works, but the survivor above means a regression would go unnoticed.
  - Exact-case `Person` isn't pinned.
  - A formula or link on the header row that's absent from `getGrid` isn't pinned (fake-only).
- **F-C (S4): first-run side effect the seller may notice.** Run 1 scanned **every** cell of the five tabs, data rows included, because no Person column was found. That cleared 13 cells, so some data cells may now read `[removed]` (for example an ISBN, a long price or code, or a link with digits). This is harmless on the build copy, but the seller shouldn't read it as a fault of the re-run.
- **F-D (S4): nit.** The `headerIdx` helper comment in `header-row.test.ts` says "within `limit`", but it has no limit.
- Earlier R1 (WARNING is a log line only) still stands.

### Verdict

**Sign-off with follow-ups.** The D-027 fix may be pushed to the build copy and `scrubStaging()` re-run. F-A is latent, the live evidence makes it unlikely, and the by-eye check plus migrate's refusal cover it. Fix it (or the earlier R1) before S-04 relies on the copy. F-B to F-D are optional.

### G0.3: exact steps for the seller re-run (replaces step 2 of the 2026-11-04 list; steps 1 and 3 to 8 are unchanged)

1. As before, run **only** `scrubStaging` on the build copy.
2. Read the Execution log to the end. It should have this shape. The tab order follows your tabs, and N is your own count per tab:
   ```
   scrubStaging: tab "README": 0 people, 0 numbers, 0 notes
   scrubStaging: tab "Tech": N people, 0 numbers, 0 notes
   scrubStaging: tab "Gym & Sport": N people, 0 numbers, 0 notes
   scrubStaging: tab "Home Things": N people, 0 numbers, 0 notes
   scrubStaging: tab "Books": N people, 0 numbers, 0 notes
   scrubStaging: tab "Template": 0 people, 0 numbers, 0 notes
   scrubStaging: README tab found (every cell scanned)
   scrubStaging: ~10 people replaced, 0 cells cleared of numbers, 0 notes removed
   ```
   - **There must be no line containing WARNING.** If there is one, stop and tell the PM which tabs it names.
   - **Each item tab's people count should match the number of filled Person cells you know it has.** If a tab you know has reservations shows `0 people`, stop and tell the PM, even without a WARNING (F-A).
   - **Numbers and notes should be 0 or close to it,** because the first run already cleared them. A non-zero count isn't a failure, but tell the PM which tab it was on.
   - Template can show 1 person if its example row has a Person filled in. That's fine.
3. In the by-eye check (step 3 of the earlier list), also check **row 1 (the title row) of every tab**. No real name or phone number should appear there, because a name in a title row is not replaced.
4. Cells reading `[removed]` in data rows are from the first run (F-C). Leave them.

### Not verified

- Nothing has run on real Sheets. The width, hidden-tab and `getDataRange` points are desk checks of the adapter and the Apps Script docs.
- The exact live counts. They depend on the seller's data, which QA must not read.
- Tabs other than Tech and Books actually having their header on row 2 (the seller confirmed only those two). Any row from 1 to 5 works. Row 6 or lower gives the WARNING.
- The post-migrate live checks listed on 2026-11-04 are still outstanding.
- I did not run Playwright beyond the gate, or `build:gas`.

## 2026-11-05: S-03 live run on the build copy (PM, live check)

Seller ran everything from the Apps Script editor. Logs are counts only. No agent read the copy's data.

- **scrubStaging, first run:** WARNING on all 5 item tabs, 0 people replaced, 13 numbers cleared. Cause: headers on row 2. Fixed as D-027.
- **scrubStaging, second run (after D-027):** README 0, Tech 9 people, Gym & Sport 1, Home Things 0, Books 0, Template 0. 10 people in total, 0 numbers, 0 notes, no WARNING. The seller confirmed that Home Things and Books have no reserved or sold names, did the by-eye check, and said "scrub checked".
- **migrateSheet, runs 1 and 2:** refused at preflight with `Tab "Books" has no "Item" column`, writing nothing. Books' name heading is `Brand (+ Link)`. Fixed as D-028. The first D-028 fix accepted only `Brand` and failed live in the same way.
- **migrateSheet, after D-028:** the four new tabs exist. The successful run's log wasn't captured: the seller ran it more than once, and only a later re-run's log was pasted. That re-run logged all zeros (`0 columns added, 0 tabs created, … 0 claims created`), which passes the "a rerun creates nothing" check.
- **Post-migrate checks by eye, all yes (seller):**
  1. Tech row 2 ends with ID and Quantity, with `I-NNNN` IDs and quantity 1, and nothing new in row 1.
  2. Claims has about 10 rows, with `Test Person N` names and sensible item names.
  3. State validation rejects `banana`.
  4. To do and Sold render without errors, and Sold shows Total sold.
  5. Books `Brand (+ Link)` holds titles.
- **Evidence for the re-run reading (added the same day):** the seller's Executions view shows the 17:04:44 run took 53.7 s. That alone didn't prove it was a no-op, because a no-op still calls `getGrid` once per item row. The first Claims row's `Created` is `2026-11-05T11:34:01.711Z`, which is 17:04:01 IST. That's before the 17:04:44 run started, so an earlier run did the work, and the all-zeros run was a true re-run. The counts are not wrong. Side note for S-04/S-11: per-row `getGrid` calls make migrate slow on the live sheet (S4, performance only).
- **Not checked live:** "a formula-like name shows as text". The scrubbed copy has no formula-like names, so this stays covered by unit tests only. The successful run's exact counts weren't seen.
- **Owed:** QA review of the D-028 commits (8707627, 7382abc, the red test for `Brand (+ Link)`, and the follow-up fix).

## 2026-11-05: S-03 QA of D-028 (Books name under "Brand (+ Link)")

Reviewed commits 8707627, 7382abc, 42803f0, c601e07 (made inline by the PM).

### Verified

- Gate `npm run check`: tsc, eslint, Vitest 19 files / 408 tests passed, Playwright 16 passed, size 0.7 KB of 50 KB, pii-scan 99 files 0 findings.
- Tests came first: at 42803f0 (red test, before c601e07) the D-028 file runs 2 failed / 3 passed, failing on `"Brand (+ Link)"`. 8707627 precedes 7382abc.
- Fallback is Books-only: `itemNameCol` returns the `Item` match, or 0 for any tab not named `Books`. The "other tabs" test is meaningful because the Tech fixture already has a `Brand` column, so it throws only if Brand is refused.
- `Item` preferred: the both-columns test adds an empty `Brand` column; if Brand won, the claim name would be blank and "Slow Rivers" missing.
- Both reads of the item name in `src/api/migrate.ts` (preflight line ~277, claim build line ~462) go through `itemNameCol`. No other `ITEM_NAME_HEADERS`/`findCol` read of the name. `guardText` still wraps the item name.
- Privacy: no real data, headings only. The live heading `Brand (+ Link)` is not personal data.

### Findings

- S4: on Books the preflight error still says `has no "Item" column`, though `Brand (+ Link)`/`Brand` would also do. Misleading if the seller renames it again. Not blocking.
- S4 (coverage): no test that a formula-like book name under the Brand fallback gets the apostrophe guard. It shares the same line as the Item path, so a regression is unlikely.
- Inherit in S-04: the catalogue API must reuse `itemNameCol` (export it, don't copy it). Other live tabs may also head the brand column `Brand (+ Link)`, and on them it is the brand, not the name. Fixtures still say `Brand` and have a separate `Link` column. Live Books has no `Link` column (the link is rich text on the name cell), so S-04 should test against a live-shaped Books fixture.
- Inherit in S-05: live Books heads photos `Photos`, but fixtures use `Photo`. Confirm the heading on every live tab before the photo pipeline looks it up by name.

### Verdict

D-028 passes QA. S-03 can merge on D-028's account.

### Not verified

- Live data (QA must not read it). I relied on the seller's by-eye check that titles sit under `Brand (+ Link)`.
- The headings on other live tabs beyond Tech and Books.
- `build:gas` and the clasp bundle.

## 2026-11-05: S-04 QA of the catalogue API (branch S-04-catalogue-api)

Reviewed commits 5efe4d5 (red tests), c613efc (D-030), 5ebed6c (`src/api/catalogue.ts`, `itemNameCol` exported), b1cdf80 (`doGet`, build wrapper, manifest `webapp` section, 30 s CacheService), 8f0831a (key-scan regex no longer bans `name`). Against the S-04 story, brief 4.1, 4.3, 6, 10.3 and D-026 to D-028, D-030.

### Verified

- Gate `npm run check` on a fresh run: tsc, eslint, Vitest 20 files / 448 tests passed, Playwright 16 passed, size 0.7 KB of 50 KB, pii-scan 102 files, 0 findings (no blocked-words list configured locally). `npm run build:gas` builds `dist/appscript/`.
- Test-first order: red tests (5efe4d5) come before the handler (5ebed6c). 8f0831a edits a test, but only the key regex, which banned the `name` key that D-030 rule 1 requires. The new regex still bans `buyer*`, `person*`, `*_name`, `number`, `phone`, `token`, `booking*`, `claim*`, `holder*` and `status`.
- Privacy (S1), by reading the code: the response is built field by field from an allow-list. Claims supplies only Claim ID, Item ID and State to the queue engine, and only counts come back out. Bookings is never read. Person and Status are never read. Rows above the header row (D-027) are skipped, so a title row is never output. The cache holds the same JSON string as the response, nothing more. The `unknown action` error does not echo its input. T-12 tests check the JSON against every private Claims and Bookings cell and every Person cell, and include a guard test showing the scan is not empty.
- Notes are meant to be public. Brief 7 (item view "full notes") and S-08 ("Shows photos, notes") show them, and the real sheet shows them publicly today. They are not a code leak. See F2 for what's left.
- Web-app surface: the bundle's top-level functions are `scrubStaging`, `migrateSheet` and `doGet` (plus the `A44` global). A web app only ever calls `doGet`/`doPost`. There is no `doPost` and no HtmlService page (so no `google.script.run`). `doGet` can't reach migrate or scrub. `action` is checked with strict equality against `"catalogue"`, and other parameters are ignored. Scope stays `spreadsheets.currentonly`.
- Header row (D-027) through `findHeaderRow`, Books name through the shared `itemNameCol` (D-028, not copied), and `Brand (+ Link)` as the brand on non-Books tabs (it.each covers both headings).
- Mutation run (23 hand mutants on `catalogue.ts`, each against `catalogue.test.ts`; the file was restored and the tree is clean). Killed: dropping the sold-out or unavailable exclusion, Books detection off, Books link taken from the brand column, http(s) filter removed, https refused, date not ISO or stringified, sold claims ignored, link row off by one, header row fixed at 0, photos always 0, notes null, `Brand (+ Link)` dropped. Survivors are under Findings or are equivalent (author read on every tab, blank-item-ID claims, Template exclusion, because the Template example row has no ID).

### Findings (worst first)

- **F1, S3 (very likely; confirm live): date cells come out one day early.** Apps Script's `getValues()` returns a date cell as midnight in the spreadsheet's time zone. With Asia/Kolkata, 2 Dec 2026 becomes `2026-12-01T18:30:00.000Z` after `toISOString()` (checked in Node: `new Date("2026-12-02T00:00:00+05:30").toISOString()`). The unit test passes only because its fixture uses `Date.UTC`. Its own assertion, `/^2026-12-02/`, would fail on the live value. Anyone (S-06) who reads the first 10 characters, or a browser outside IST, shows 1 Dec. Fix: format date cells as `yyyy-MM-dd` in the spreadsheet time zone (for example, the adapter passes `getSpreadsheetTimeZone()`, or the handler takes a formatter), with a test using a non-UTC midnight. Or the PM records in D-030 that `availableFrom` is an instant and S-06 must format it in Asia/Kolkata. QA has not fixed this.
- **F2, S3 (process): free text is published as-is.** `notes`, `name` and `brand` are whatever the seller typed. The scrub replaced only Person values and numbers, so the build copy's Notes could still hold a real buyer name (for example "kept for …"). With `ANYONE_ANONYMOUS`, the staging deployment publishes them as soon as it's deployed. No code fix. Live check 2 below covers it.
- **F3, S3: errors are not JSON.** `doGet` has no try/catch. A sheet or CacheService exception (a timeout, or a `put` over the size limit) returns Google's HTML error page, probably without CORS headers. So the site sees an opaque network failure, not `{error}`. Brief 4.3 says "All responses are JSON". By reading, I found no message that carries cell content: our code throws nothing that contains data. Platform messages also hold no data, but they can include a script line number. S-06 must treat a non-JSON or failed response as "API down".
- **F4, S4: tab deny-list.** Any tab not in `README, Template, Claims, Bookings, To do, Sold` that has `Person`, `ID` and a name column is published. That includes a hidden tab or "Copy of Template". This matches migrate's approach and the brief's "all four tabs", but an allow-list of the four would fail closed. Check the live tab names (live check 9).
- **F5, S4 (coverage gaps, from surviving mutants):** no test with several links in one cell. The first-link split could be removed, and the link would then be "url1 url2". No test with a text price ("₹1,000" becomes null, "Ask"), or with a price passed through as a string. No test with a text Quantity ("2" is hidden as unavailable). A coerced quantity also goes uncaught. No catalogue test with headers on row 1 or row 3 (fixing the header at row 1 survives; only `findHeaderRow`'s own tests cover it). No test with padded headers (`" Price "`, `trim` removable). No test with a junk Claims State.
- **F6, S4: `doGet` is untested** (adapter code, as is the convention). Action validation and the cache-or-miss logic are unit-untested. The size guard counts UTF-16 characters, not bytes. That is fine at the current ~65 items.
- **Inherit (S-11/S-14/S-15):** clear `CATALOGUE_CACHE_KEY` in every write handler, and in S-15's on-edit trigger too. Seller edits in the Sheets app (marking sold) are writes, and otherwise show up only after 30 s. D-030 rule 7 says so; nothing enforces it yet.
- **Note:** a brand or book link is published as-is if it's http(s). A link to a Google Sheet or Drive file, or a `wa.me` link holding a number, would be public. I didn't check this against data. Live check 4 covers it.

### Verdict

Privacy (T-12) and web-app surface: **pass**. Code can merge once F1 is fixed (with a non-UTC test) or the PM records the instant-in-IST decision. Not Done until the live checks below pass (CORS go or no-go for D-001, and timings recorded per D-020).

### Live checks still needed (staging deployment only, after the seller deploys)

1. `?action=catalogue` returns JSON. `?action=x` and no parameters return `{"error":"unknown action"}`. Items come from all four tabs: Tech, Gym & Sport, Home Things and Books. Gym & Sport and Home Things header rows are still unconfirmed.
2. Seller reads the JSON by eye for any real name or number in `name`, `brand`, `notes` and `author`, and searches it for `Test Person` (should find none) (F2).
3. CORS: on the Pages origin, in DevTools console, `fetch("<url>?action=catalogue").then(r => r.json())` resolves. It follows the 302 to `script.googleusercontent.com`. Do this in desktop Chrome, iPhone Safari and Android Chrome, and once while signed in to two Google accounts. **Go or no-go for D-001: raise a failure right away.**
4. Links: a Tech brand link and a Books title link appear as `https://…`. Compare the count with the staging sheet's linked cells. No link points at a Google Docs, Sheets or Drive host, or at wa.me.
5. Dates: check the build copy's File > Settings time zone, then the `availableFrom` of the 2 Dec books (F1). Expect `2026-12-01T18:30:00.000Z` if unfixed.
6. Prices: only *Free Fall* (and any genuinely blank price) is `null`. No text prices became `null` by accident.
7. Timings (D-020): use `curl -sL -o /dev/null -w "%{time_total}\n" "<url>?action=catalogue"`. Cold: 5 runs, the first after a new deployment or more than 10 min idle. Warm cache-miss: wait 31 s between runs. Warm cache-hit: within 30 s. Record them in a new `D-0NN-apps-script-timings.md`. Raise warm over 3 s with the seller (N-05).
8. Cache: change a staging price, then fetch again within 30 s (old value) and after 30 s (new value).
9. Tab list: the staging (and later the real) sheet has no tabs, hidden ones included, other than the four item tabs and README, Template, Claims, Bookings, To do and Sold (F4).
10. Sold-out items (the 3 Sold rows) are absent. A Reserved item shows `freeUnits: 0`.

### Not verified

- Anything on real Apps Script: CORS, redirects, timings, rich-text runs, date values, CacheService behaviour, error pages. I read these from the code and from known platform behaviour only.
- The live headings on Gym & Sport and Home Things, and whether any live tab has a separate plain `Link` column (the catalogue ignores it).
- The queue engine itself (covered by S-02 QA). I used it through `recalculate` only.
- Playwright beyond the gate. No UI changed in S-04, so no screenshot is needed.
- The pii-scan with the private blocked-words list (not configured in this worktree).

## 2026-11-05: S-04 QA re-check (F1, F3, F4, F5 fixes)

Reviewed e67e641 (D-030 rules 6, 8, 9 and 10 amended), 1653299 (red tests `catalogue-qa.test.ts`, `handle-get.test.ts`, exact date assertions) and 4e108fa (injected `formatDate`, pure `src/api/handle-get.ts`, tab allow-list, thinner `doGet`).

### Verified

- Gate `npm run check` (fresh run): exit 0. Vitest 22 files / 489 tests, Playwright 16 passed, size 0.7 KB of 50 KB, pii-scan 105 files, 0 findings. `npm run build:gas` builds. The bundle's top-level functions are still only `scrubStaging`, `migrateSheet` and `doGet`.
- Red tests came before the fix (1653299, then 4e108fa).
- **F1 fixed.** `availableFrom` is `YYYY-MM-DD`. The adapter injects `Utilities.formatDate(d, getSpreadsheetTimeZone(), "yyyy-MM-dd")`. Tests use the real IST-midnight instant (`2026-12-01T18:30Z`) and expect exactly `2026-12-02`. They also pin the UTC default, invalid dates, "Now" and blank (the formatter is not called for text or blank).
- **F3 fixed.** `handleGet` is pure and every path returns JSON. A failing catalogue gives `{"error":"unavailable"}` with no message text, and nothing is cached. A failing cache read or write falls back to a fresh build. The unknown action is not echoed. Tests cover a non-Error throw and an action with a name and number in it.
- **F4 fixed.** Only Tech, Gym & Sport, Home Things and Books are published, matched exactly and case-sensitively. Tests cover "Copy of Template", "Copy of Tech", "tech", "Garden" and "Archive". Tab names match the names the S-03 live scrub log printed.
- **F5 guards bite.** I ran 37 hand mutants (28 on `catalogue.ts`, 9 on `handle-get.ts`) against the three test files. **All 37 were killed.** Last time's survivors are now killed: the first-link split (and "any http run"), text price passthrough or `Number()` coercion, text Quantity coercion, header fixed at row 2, header `trim`, and any Claims state accepted. Also killed: allow-list replaced by the old deny-list, made case-insensitive, or missing a tab; the formatter ignored, or the default formatter producing a full ISO string; and in `handle-get.ts`, the action trimmed or echoed, cache hit ignored, TTL or key changed, no put, error message leaked, outer try removed, cache get not guarded. The files were restored and the tree is clean.
- `doGet` wiring, by reading: `e?.parameter ?? {}` handles a missing event or parameter. The MIME type is `ContentService.MimeType.JSON`. `GetCache` (`get(k): string|null`, `put(k, v, secs)`) fits `CacheService.getScriptCache()`, and tsc accepts it. The removed 90 KB guard is now covered by the caught `put`. The spreadsheet and the time zone are read inside the guarded `catalogue` closure.

### Findings (worst first)

- S4: `CacheService.getScriptCache()` (and `ContentService`) are called outside `handleGet`'s try. If the cache service itself fails to load, the response is Google's HTML error page, not JSON. This is rare, and S-06 must handle non-JSON anyway.
- S4: failures are now silent. `{"error":"unavailable"}` returns no trace, and nothing goes to the Executions log, so a live failure is hard to diagnose. One option is to `console.error` the error's name (not its message) in `doGet`.
- S4: `getSpreadsheetTimeZone()` is called once per date cell. That's 4 calls today. It's cheap, but it could be read once per request.
- None of these block.

### Verdict

F1, F3 and F4 are fixed, and the F5 guards bite. **S-04 code passes QA and can merge.** S-04 is Done only after the live checks pass: CORS (the D-001 go or no-go) and timings (D-020).

### Live-check list: changes from the 2026-11-05 entry

- Check 1 also: `?action=Catalogue` and `?action=catalogue%20` return `{"error":"unknown action"}`.
- Check 5 now expects **exactly `"2026-12-02"`** for the 2 Dec books (no time part). If the value is a day off, check the build copy's File > Settings time zone.
- Check 9 changes: other tabs can no longer leak. Instead confirm that all four tabs appear, which proves the names match exactly (for example "Gym & Sport" with no trailing space).
- New: a failure path can't easily be forced on staging. If any request returns `{"error":"unavailable"}`, look in the Executions view and report it.

### Not verified

- Everything on real Apps Script: CORS, timings, `Utilities.formatDate` output, the CacheService size limit, and error-page behaviour.
- The `doGet` adapter itself, which has no unit test (by convention). I checked it by reading only.

## 2026-11-05: S-05 QA of the photo pipeline (T-16)

Reviewed commits 2340bc8 (red tests), 517c28c (D-029), b7dfba4 (pipeline, CLI, `npm run photos`, runbook) and a9cbe8f (D-029 edge-case tests), against S-05, brief 7.1 and 8.1, and D-019, D-027, D-028 and D-029. All probes used synthetic images and workbooks generated in a scratch folder. Nothing in `private/` was opened or run.

### Verified

- Gate: `npm ci && npm run check` passed. tsc, eslint, Vitest 19 files / 408 tests, Playwright 16 passed, size 0.7 KB of 50 KB, pii-scan 106 files with 0 findings (no blocked words configured locally). `npm run test:photos`: 33 passed, and 5 more runs were also green (no flakiness).
- Red first for the core: 2340bc8 adds the tests with no `pipeline.py`, and b7dfba4 adds the code. The D-029 edge-case tests (a9cbe8f) came **after** the code that implements them (see findings).
- **T-16 metadata strip, beyond the shipped tests.** Each output's RIFF chunks were only `VP8 `, with no EXIF, XMP, ICCP or marker bytes and an empty `info` (only Pillow's decoder defaults, `loop` and `background`). Sources tried:
  - a PNG with tEXt, iTXt, zTXt, eXIf (with GPS) and iCCP;
  - a JPEG with EXIF (make, GPS, MakerNote 0x927C), XMP, an IPTC APP13 segment, a COM comment and ICC APP2;
  - a WebP with EXIF, XMP and ICCP chunks.
- Contact sheet: labels are `<ID> #n` only. `run()` refuses a sheet path inside the output folder. The CLI writes it to `private/contact-sheet.jpg`, and `private/` is gitignored. The CLI prints counts, tab names, row numbers and IDs, never other cell text.
- Stale removal is a non-recursive `out_dir.glob("*.webp")`. Nested files, non-WebP files and files outside the folder survive (tested, and the mutant using `rglob` is caught).
- Formats through `process()`: RGBA and P-with-transparency are flattened onto **white**. A CMYK JPEG keeps its colour. An animated GIF uses its first frame. 1-bit images and 12 MP JPEGs are fine.
- Budgets: a realistic noisy 2000×1500 photo meets them at the first quality (thumb q80 about 6 KB, full q82 about 56 KB). `tools/size-budget.mjs` naming is compatible: `<id>-<n>-thumb.webp` is checked at 12 KB, `<id>-<n>.webp` and `manifest.json` at 120 KB, and the check fails on over-budget files of both kinds. IDs containing "thumb" are renamed (`thmb`).
- System tabs (Claims, To do, Sold, Bookings) have no `Person` or `ID` header, so the pipeline ignores them. The duplicate-ID check can't trip on Claims' `Item ID`.
- The S-03 "Photos vs Photo" heading concern doesn't apply: images map by anchor row, not by column.
- Smart crop on portrait items (synthetic scenes). At 3:4, the subject was kept 100% in all 5 scenes, including over a textured floor. At 9:16 a busy floor pulled the window down and cut 12% off the top of a subject near the top. That's acceptable, and it's what the contact sheet is for.

### Mutation results (29 mutants, each in a fresh copy)

- **Caught (20):** skipping `exif_transpose`; passing icc/exif to save; dropping stale removal; recursive stale removal; anchor row −1 and +1; centre crop instead of smart; upscaling; full autocontrast (divides by zero on flat images); header search of 1 row; no duplicate check; writing before the duplicate check; no thumb rename; no contact-sheet guard; alt = ID; no Books fallback; the CLI printing alt text; a longest side of 1024.
- **Survived (9):**
  - Removing both `info.clear()` calls. This is equivalent on Pillow 11.3, which saves WebP metadata only from explicit arguments. The output-level T-16 assertions would still catch a Pillow that changed this.
  - **Budget loop never shrinks, full budget doubled, thumb budget doubled.** No test input is big enough to need a second quality step, so the loop is untested.
  - Skipping ICC→sRGB conversion.
  - Flattening onto black instead of white.
  - **No levels at all.** Only "levels are light" is tested, never "levels do something".
  - Ignoring the column in the left-to-right sort. The fixture inserts images in column order, so the test passes anyway.
  - Allowing an image on the header row itself. Only a title-row image is tested.
  - Header search of 6 rows.
  - Contact sheet labelled with item names instead of IDs (private file, low stakes).

### Findings (worst first)

No S1 or S2 found.

1. **S3, orientation lost for non-JPEG/PNG/GIF media.** `extract_images` uses openpyxl's `img._data()`, which re-encodes any other format to PNG and drops EXIF. Reproduced: an MPO (what Pillow calls a JPEG carrying an MPF block, which is common for recent phone photos) with orientation 6 comes out 200×100 (sideways) via the xlsx, but 100×200 when passed to `process()` directly. A WebP with orientation fails the same way. Whether Google's export contains such files is **unconfirmed** (live check 1). Suggested fix: read the raw bytes from the zip (`xl/media/...` via the drawing rels) instead of `_data()`. Metadata stays safe either way, because the output is re-encoded.
2. **S3, `absoluteAnchor` crashes the run.** It raises `AttributeError: 'AbsoluteAnchor' object has no attribute '_from'` as a traceback (reproduced). It fails loudly and writes nothing. It should be skipped and reported like the others.
3. **S3, images can disappear silently.**
   - Media that Pillow can't decode (EMF/WMF, garbage) is dropped by openpyxl with only a Python `UserWarning`, and isn't in `skipped` or the counts (reproduced).
   - Images placed *in* a cell (Excel/Sheets "image in cell", stored as richData) aren't seen by openpyxl at all (not reproduced, suspicion based on openpyxl's scope). The brief says floating images and the audit confirmed anchors, so this applies only if the seller uses in-cell images.
   - Suggested fix: compare the number of `xl/media/*` files with the number extracted, and report the difference.
4. **S3, an export with no images wipes `public/photos/`.** Reproduced: a run on a workbook with 0 images deletes every existing photo and writes `{}`, reporting only "0 photos … (2 stale files removed)". Git can restore them, and the seller reviews the diff before pushing, but a wrong export, such as one converted without images, would unpublish everything. Suggest refusing when 0 images are found, or when a large share would be removed, unless forced.
5. **S4, over-budget output is silent.** If the quality loop reaches q2 without fitting, `_encode_webp` returns the last (over-budget) bytes with no error. Reproduced with synthetic noise at 1000×1000: 287 KB and 219 KB. The CLI says success, and `npm run size` catches it at `check`. Realistic photos fit at the first step, so this is unlikely. It also has no quality floor, so a hard image could silently drop to very low quality. Suggest raising when the budget isn't met.
6. **S4, D-028 deviation.** `_read_tab` falls back to `Brand (+ Link)`/`Brand` for alt text on **every** tab. D-028 rule 3 says other tabs never fall back to Brand. This only matters on a non-Books tab with no `Item` column, so the impact is alt text only.
7. **S4, 16-bit greyscale PNG clips to white** (`I;16` to RGB with no scaling, reproduced). 16-bit RGB PNGs open as 8-bit RGB in Pillow, so they aren't affected. Unlikely in a Sheets export.
8. **S4 (process), the D-029 tests came after the code.** b7dfba4 implements D-029 rules 1 and 3–5, and a9cbe8f adds their tests afterwards, so they were never red. The DoD asks for tests first. The mutants above show they do constrain the code.
9. **S4, the CLI paths are relative to the working directory.** `npm run photos` runs from the repo root, so it's fine. Running `python tools/photos/pipeline.py` from another folder would create `public/photos` and `private/` there.
10. Note, out of scope: the pipeline publishes every anchored image on an item row, whatever its column (Notes, Person). It does no content checks, so a photo showing a face, a name label, a house number or a receipt would be published. The contact-sheet review is the only control. Ask the seller to look for people and addresses as well as crops.

### Coverage gaps

These behaviours have no test that would fail on regression: the budget quality loop (finding 5); flattening onto white; ICC→sRGB; levels actually being applied; left-to-right order when images aren't inserted in column order; an image on the header row itself; absolute anchors; dropped or unreadable media; contact-sheet labels being IDs only.

### CI recommendation

Make D-029 rule 6 explicit and add a CI step now. The suite is fast (about 2 s) and has no network or real-data dependency:

- `actions/setup-python@v5` with `python-version: "3.9"`, matching the pin;
- `pip install -r tools/photos/requirements.txt`;
- `python -m pytest tools/photos -q`.

Keep it out of `npm run check` if a local venv shouldn't be required, but run it in `ci.yml` beside `check`. Consider splitting pytest into a dev-only requirements file.

### Verdict

S-05 **passes QA** for merge. The acceptance criteria are met: the output matches 7.1, the GPS-removal fixture test exists and is strong, and the contact sheet is produced outside `public/`. T-16 holds across every metadata container tried. Findings 1–4 are S3 and should be fixed (each starting with a failing test) **before the seller's first real run**, or that run should be checked as in live checks 1–3. They don't block merging, because the tool hasn't been run on real data yet.

### Live checks needed (on the seller's real export of the scrubbed build copy)

1. The seller runs `unzip -l private/<export>.xlsx | grep xl/media` and reports **only the file extensions and their count**. Any `.mpo`, `.webp`, `.tif`, `.bmp`, `.emf` or `.wmf` means findings 1 and 3 apply. Also check whether `xl/richData/` exists (in-cell images).
2. The seller runs `npm run photos private/<export>.xlsx`. The printed photo count should match the photos she knows of (the audit says 31), with no Python warnings, no traceback and an expected skipped list.
3. The seller opens `private/contact-sheet.jpg` and checks that every photo is upright (portrait items look portrait), the crop keeps the item, no thumbnail shows a person, a name or an address, and every item with photos appears.
4. `git status`/`git diff --stat public/photos` shows only `.webp` files and `manifest.json`, and `npm run check` passes (the size budget on the real output).
5. A second run changes nothing in git (determinism on real data).

### Not verified

- Real Google Sheets export structure (anchor types and offsets, media formats, in-cell images): QA must not open it.
- Visual quality of levels and crops on real photos.
- Display of photos in the site (S-06, S-08, out of scope).
- Pillow and openpyxl versions other than the pins, and Python versions other than 3.9.6.
- Decompression-bomb-sized images (over 89 MP).
- Behaviour when `public/photos` is a symlink.

## 2026-11-05: S-05 QA re-check of D-031 hardening (4f383aa, a35dcac, b60b944)

All probes used synthetic workbooks in a scratch folder. Nothing in `private/` was opened or run.

### Verified

- Gate: `npm run check` is green (Vitest 408, Playwright 16, size 0.7 KB, pii-scan 111 files, 0 findings). `npm run test:photos`: 55 passed, with 1 harmless openpyxl `UserWarning`.
- Red first: at a35dcac, 11 failed and 44 passed.
- Earlier findings 1–6 are fixed. Each was reproduced first and is now green:
  1. MPO and WebP in the xlsx keep their orientation; raw bytes are now read from `xl/media`.
  2. An `absoluteAnchor` picture goes into `skipped` and the run continues.
  3. Undecodable media is skipped with a reason, and extra unreferenced media is counted in `unplaced_media`.
  4. A zero-image export refuses to run when photos are already published.
  5. The quality floor is 30, and the run raises rather than write an over-budget file. Synthetic noise now stops with "does not fit 120 KB even at quality 30".
  6. The Brand fallback for alt text applies to Books only.
- T-16 still holds on the raw-bytes path, end to end through `run()`. The output had only `VP8 ` chunks, no marker bytes and no metadata in `info` for every container tried:
  - a PNG with tEXt, iTXt, zTXt, eXIf (GPS) and iCCP;
  - a JPEG with EXIF (MakerNote, GPS), XMP, IPTC APP13, COM and ICC;
  - a WebP with EXIF, XMP and ICCP;
  - an MPO with EXIF, a MakerNote and ICC;
  - a TIFF with an ImageDescription, EXIF and ICC;
  - a GIF with a comment.
- Zip path traversal: `ZipFile.read` only reads entries inside the archive. A rel target can only be read as an image if it names an `xl/media/` entry. Targets tried:
  - `../../../../etc/passwd`, `../sharedStrings.xml` and an external `file:///etc/passwd` raise `KeyError` (from openpyxl's own load in `map_to_items`). The run stops with a traceback and writes nothing. No host file is read.
  - A literal entry named `xl/media/../sharedStrings.xml` holding non-image bytes is skipped as undecodable.
- CI: a `photos` job on Python 3.9 with pip caching keyed on `requirements.txt`, running `pytest`. Workflow permissions stay `contents: read`, and the job needs no secrets.
- Mutants: 25 run against b60b944, 21 caught. All 9 survivors from the first review except ICC→sRGB are now caught.

### Findings (worst first)

1. **S2 (blocks merge), orientation is lost whenever the image also has an ICC profile.** `process()` calls `_to_srgb()` before `ImageOps.exif_transpose()`. `ImageCms.profileToProfile` returns a new image without the EXIF, so the transpose does nothing.
   - Reproduced: a JPEG with orientation 6 and no ICC comes out (100, 200), which is correct. With an sRGB ICC it comes out (200, 100), sideways. Through `run()`, PNG, JPEG, WebP and MPO sources with ICC plus orientation all came out unrotated.
   - Phone cameras embed both an ICC profile (for example Display P3) and an orientation tag, and the audit says the photos are mostly portrait. So if the export keeps original bytes, most rotated photos would ship sideways.
   - This bug was present at the first review and I missed it: my metadata probes had both ICC and orientation, but I checked only metadata, not dimensions.
   - Fix: transpose first, or carry the EXIF across. Start with a failing test: orientation 6 plus ICC gives a portrait image.
   - Rated S2 rather than S3 because brief 7.1 says "respect orientation", so the acceptance criterion isn't met for typical phone photos.
2. **S3 (blocks merge), a test artefact is committed under `public/photos/`.** b60b944 adds `public/photos/manifest.json` (`tech-001`, alt `Zebra Lamp Secret Name`), `tech-001-1.webp` and `tech-001-1-thumb.webp`. These are the synthetic CLI-test fixture, apparently produced by running the CLI by hand from the repo root, and the commit message doesn't mention them.
   - Not real data, so not S1. But `build.mjs` copies `public/` to `dist/`, so the junk would deploy to Pages.
   - It also means the first real run will treat it as "already published" content.
   - Remove the files, and consider a test or pii-scan rule against fixture names under `public/`.
3. **S4, a picture wrapped in `mc:AlternateContent` is reported as "absolute anchor".** Its `from` element is nested, so the scan doesn't find it. It's skipped visibly rather than silently, but the reason is wrong. Whether Sheets exports pictures this way is unknown.
4. **S4, a broken rels target crashes with a traceback.** It's a `KeyError` from openpyxl, not a clean "Stopped:" message. It's loud and writes nothing.
5. **S4 (coverage), some mutants survive:**
   - skipping ICC→sRGB (the conversion is never tested, which is how finding 1 hid);
   - letting a header-row image through (`row <= header` changed to `<`): the new header-row test passes anyway, probably because the row has no ID;
   - a quality floor of 50 instead of 30;
   - the CLI ignoring `--allow-empty`.
6. **S4, CI pins Python 3.9, which reached end of life in October 2025.** setup-python may eventually drop it. Plan a move to 3.12 together with the pins.
7. Still open from the first review: finding 7 (16-bit greyscale clips to white) and finding 9 (cwd-relative paths, accepted by the PM).

### Verdict

**Does not pass.** Return S-05 to the dev for findings 1 and 2, each starting with a failing test (finding 2 needs a guard). D-031's rules are otherwise correctly implemented and tested.

### Live checks needed

Unchanged from the first S-05 entry, plus:

- On the contact sheet, every photo the seller knows to be portrait must be portrait.
- The seller reports whether `unplaced_media` and `skipped` are empty.

### Not verified

- Real export structure.
- Python versions other than 3.9.6.
- A real CI run of the new job (it hasn't been pushed).

## 2026-11-05: S-05 QA second re-check (4f87f80, 9fb7270)

All probes used synthetic files in a scratch folder. Nothing in `private/` was opened or run.

### Verified

- Gate: `npm run check` is green (Vitest 408, Playwright 16, size 0.7 KB, pii-scan 109 files, 0 findings). `npm run test:photos`: 70 passed. Red first: at 4f87f80, 9 failed and 61 passed. `git ls-files public/photos` is empty.
- **The ICC plus orientation fix works.** A JPEG with orientation 6 and an sRGB profile now comes out upright (100, 200). Through `run()`, PNG, JPEG, WebP and MPO sources with a profile and orientation 6 all come out 400×300.
- **T-16 still holds with rotation running first.** Rotation keeps the source's EXIF and profile in memory, but the later steps clear them before saving. Every output from the earlier probe set had only `VP8 ` chunks, no marker bytes and no metadata in `info`:
  - PNG with tEXt, iTXt, zTXt, eXIf and iCCP;
  - JPEG with EXIF (maker note, GPS), XMP, IPTC, a comment and ICC;
  - WebP with EXIF, XMP and ICCP;
  - MPO, TIFF and GIF.
- Path-traversal probes behave as before: reads stay inside the archive, and bad targets stop the run with a `KeyError`.
- Mutants: 27 run against 9fb7270, 26 caught. All four survivors from the last re-check are now killed (ICC→sRGB, the header-row image, a quality floor of 50, the CLI ignoring `--allow-empty`). Putting the colour conversion back before rotation is caught by 9 tests.
  - In my scratch copies, `test_no_synthetic_fixture_output_is_tracked_under_public_photos` also fails, because the copy isn't a git repo, so it fails closed. I counted a mutant as caught only when a second, specific test failed too.
- Header-row mutant: I **accept** that it is killed only by the reason text. With `<` instead of `<=`, the picture on the header row still isn't published; it falls through to "no ID in this row", because `_read_tab` only records rows below the header. The outcome is the same, and the reason is the only observable difference. The seller acts on that reason text, so asserting on it is legitimate.
- The fixture guard test can't trip on real output: real IDs are `I-NNNN`, and none of the fixture prefixes match them.

### Findings

1. **S3, an `mc:AlternateContent` picture can land on the wrong row.** `_scan` takes the picture (`blip`) from anywhere inside the wrapper, but the row from the **first** nested `from`. Each wrapper is one element, so there is **no double counting**: one picture per wrapper, whichever branches contain it. Probes:
   - Choice and Fallback the same: correct row.
   - Choice at row 3, Fallback at row 4: Choice row 3 is used, which is correct (Choice is the preferred branch).
   - **Choice holds a non-picture shape anchored at row 5, Fallback holds the picture at row 3: the picture is attached to the row 5 item (`t-003`).** Wrong item, and nothing reports it.
   - Choice holds an absolute-anchored picture, Fallback a picture at row 4: placed on row 4.

   The new code has no test: the mutant that reverts to a direct-child `from` survives, apart from the scratch-copy artefact above. Fix: take the `from` from the same anchor element that contains the picture, with a test. How likely this is depends on whether the export uses `AlternateContent` at all (live check below). Without it, the bug can't trigger.
2. Still open, S4, not blocking: 16-bit greyscale clips to white; a broken rels target gives a traceback; Python 3.9 is end of life; cwd-relative paths are accepted by the PM.

### Verdict

**Passes QA for merge.** Both blockers from the last re-check are fixed and tested, and T-16 holds. Finding 1 is S3. It doesn't block merge, because the tool hasn't run on real data. But it should be fixed, starting with a failing test, **before the seller's first real run, unless live check 1 shows no `AlternateContent`**.

### Live checks needed

As in the first S-05 entry, plus:

1. The seller runs `unzip -p private/<export>.xlsx 'xl/drawings/*.xml' | grep -c AlternateContent` and reports only the number. If it's 0, finding 1 can't occur.
2. On the contact sheet, every portrait photo is upright, and each photo sits under the right ID.

### Not verified

- Real export structure.
- A real CI run of the `photos` job (nothing has been pushed).
- Python versions other than 3.9.6.

## 2026-11-05: S-05 QA third re-check (e3a2f11, 05f3bf5)

All probes used synthetic files in a scratch folder. Nothing in `private/` was opened or run.

### Verified

- Gate: `npm run check` is green (Vitest 408, Playwright 16, size 0.7 KB, pii-scan 110 files, 0 findings). `npm run test:photos`: 75 passed.
- Red first: at e3a2f11, the two new AlternateContent tests fail. A third test also fails in my scratch copy, but only because the copy isn't a git repo.
- **The AlternateContent row bug is fixed.** In `ac.py`, the case of a non-picture shape in Choice at row 5 and the picture in Fallback at row 3 now places the picture on **row 3** (`t-001`). The other cases:
  - Choice and Fallback the same: row 3, one image.
  - Choice at row 3, Fallback at row 4: row 3, one image.
  - Choice holds an absolute-anchored picture: skipped as an absolute anchor. Choice is preferred, so the Fallback is ignored, which is acceptable.
- **No double counting.** Extra probes in `ac2.py`:
  - Distinct pictures in Choice and Fallback: only the Choice picture is placed, and the unused Fallback media counts as `unplaced_media` = 1.
  - Two pictures in Choice and one in Fallback: both Choice pictures are placed, each on its own row.
  - An empty first Choice followed by a second Choice with a picture: the second Choice is used.
- **T-16 still holds.** `meta.py` and `recheck.py` were re-run (PNG, JPEG, WebP, MPO, TIFF, GIF). Every output had only `VP8 ` chunks, no marker bytes and no metadata in `info`. `icc_orient.py` is upright with and without a colour profile. The path-traversal probes are unchanged.
- **Mutants: 31 run against 05f3bf5, 30 caught.** That's the mut3 set plus five new AlternateContent mutants: no `break`, Fallback first, ignoring the picture check, skipping the wrapper, and reverting to a nested `from`. I counted a mutant as caught only when a specific test failed, not just the scratch-copy git artefact.
- The one survivor, reverting the row lookup to a nested-`from` search, is **equivalent** now. `_anchors` yields the picture's own anchor, and that anchor's first `from` (in document order) is its own direct child, so the nested search can't reach a neighbour's.

### Findings

No new findings. Open S4s carried over, not blocking: 16-bit greyscale clips to white; a broken rels target gives a traceback; Python 3.9 is end of life; cwd-relative paths are accepted by the PM.

### Verdict

**Passes QA for merge.** No S1, S2 or S3 open.

### Live checks needed

As in the earlier S-05 entries: report the media extensions and the `AlternateContent` count; run `npm run photos` and report the counts, `skipped` and `unplaced_media`; review the contact sheet for orientation, crops, the right ID under each photo, and no people, names or addresses; run `npm run check` on the real output; a second run should change nothing.

### Not verified

- Real export structure.
- A real CI run of the `photos` job (nothing has been pushed).
- Python versions other than 3.9.6.

## 2026-11-05 — S-05 D-032 photo size fallback (`_fit_full`)

**Change:** commits 8683442 (D-032 decision + tests; three give-up tests now force `pipeline.FULL_MAX_BYTES = 1024`) and cd14d9a (`_fit_full`: if the 1000 px image can't fit 120 KB at any quality, shrink the longest side 10% at a time, always resampled from the leveled 1000 px image, down to 600 px; raise if still over).

**Verified:**
- Test came first: at 8683442, 1 failed / 76 passed (`test_photo_too_detailed_for_1000px_is_shrunk_in_steps_but_never_below_600`). At HEAD `npm run test:photos` 77 passed; `npm run check` green (16 e2e passed, 0.7 KB gz, pii-scan 0 findings).
- Read the code: it stops because `longest` gets strictly smaller each step and is held at 600 or more; an image already at or below 600 px raises on its first failure. Bytes are only returned from a successful `_encode_webp`, so it never returns an over-budget file. The returned image is what was encoded, so manifest w/h = file size (checked by a test). Metadata path (`_encode_webp`) unchanged.
- Monkeypatching the module global takes effect: `_fit_full` reads `FULL_MAX_BYTES` when it is called. Shown by the mutants below that go red only under the 1024 patch, and by a direct run: a 400 px noise source with the 1 KB budget raises `ValueError`.
- Mutants (each run in a scratch worktree, never in the main checkout): shrink factor 1.0 -> suite hangs (killed by a 150 s alarm), so it shows up as a hang, not a clean failure; min side 0 -> red; swap width/height -> red; returning bytes at the floor instead of raising -> red; **resample from candidate instead of full -> survives** (expected: the only difference is extra blur, which byte or size tests can't see).

**Findings:** none blocking. S4: no per-test timeout, so a regression that stops it ending hangs the suite (and CI) instead of failing. S4: no test pins "resample from the 1000 px original". S4: there is no direct test that a source under 600 px raises; this review checked it by hand.

**PM real run (reported, not re-run by QA):** 31 photos / 25 items, two shrunk to ~810 px (119 / 115 KB), no metadata, rerun byte-identical, size budget passes.

**Not verified:** real photo output (public/photos/ untouched and unread, as instructed); how sharp the shrunk photos look on a phone, which needs the seller's visual review; CI.

**Verdict:** passes QA.

## 2026-11-05: S-05 live run on the seller's export (PM, live check)

Export of the scrubbed build copy in `private/build-copy.xlsx` (gitignored, D-019).

- **Media:** 31 `jpg`, no `AlternateContent`, no `absoluteAnchor`, no `xl/richData/`. QA findings 1, 2, 3 and the S3 AlternateContent issue can't occur on this file.
- **First run:** stopped at photo 1 of `I-0020` ("does not fit 120 KB even at quality 30"), writing nothing. Two detailed close-ups were 150 KB and 136 KB at 1000 px and q30. Fixed as D-032 (shrink in 10% steps, down to 600 px); QA passed it (entry above).
- **Second run:** 31 photos for 25 items, 0 skipped, 0 unplaced. `I-0020` came out 810×780 (119 KB) and `I-0021` 740×810 (115 KB). The largest full image is 119 KB and the largest thumbnail 6 KB. No output file has EXIF, XMP or ICC. `npm run size` passes, and `npm run pii` finds 0.
- **Rerun:** byte-identical output.
- **Seller's contact-sheet review:** "all the products upright, in center and under their IDs. No faces." She's relaxed about incidental details in her photos (memory: privacy level). Buyer data rules are unchanged.
- **Open:** the two shrunk photos haven't been viewed on a phone yet (to be seen at G1 on staging).

## 2026-11-05: R1 browse-only release backend (D-034, D-035), QA

**Change:** branch `R1-browse-release-api`, commits 42609b3 (red tests), df0f2c6 (implementation), f8bad4e (empty Claims tab in `catalogue-qa.test.ts` fixtures so those tests stay in engine mode). Status mode in `src/api/catalogue.ts` (no Claims tab: Status decides), top-level `contactUrl` from Script Property `SELLER_WHATSAPP`, new `addIdColumns` (`src/api/add-id-columns.ts`), new `warmCatalogue` (`src/api/warm-catalogue.ts`), cache 30 s to 600 s, helpers exported from `migrate.ts`, two new top-level wrappers in `tools/build-gas.mjs`.

**Verified:**
- Gate, fresh run at f8bad4e: `npm run check` green: 563 unit, 16 e2e, 0.7 KB gz, pii-scan 188 files 0 findings. Note: run without blocked words configured, so the pii scan is the weak local form (the pre-push hook enforces the strict one).
- Tests came first: 42609b3 holds only tests, then df0f2c6 the implementation.
- Diff: no debug leftovers, no secrets, no sheet IDs, no new dependency. Only synthetic `+91 90000 000xx` numbers. `console.log` appears only in the Apps Script wrappers, and it logs counts.
- Built bundle (`node tools/build-gas.mjs`; `dist/` is gitignored): the top-level functions are exactly `scrubStaging`, `migrateSheet`, `addIdColumns`, `warmCatalogue` and `doGet`, plus the `var A44` namespace. `oauthScopes` is only `spreadsheets.currentonly`.
- Warm job: it writes `CATALOGUE_CACHE_KEY` ("catalogue"), the same constant `handleGet` reads. `doGet` and the warm job share one `buildCatalogue()`. A failed build or a failed put leaves the previous body in place and doesn't throw; covered by tests.
- Scratch probes (synthetic, deleted afterwards):
  - Status is an exact match. Only `Available` and `Reserved` are listed. `available`, `AVAILABLE`, `Available `, ` Available`, `Reserved `, `reserved`, `Sold ` and `sold` are all hidden.
  - In status mode, Quantity blank, `""`, `"2"`, `"abc"`, 0, -1, 1.5 and `true` all hide the row. Only a positive whole number is listed.
  - `addIdColumns`:
    - It throws on a missing tab, and on a tab with no header in the top 5 rows. When it throws, the sheet is byte-identical (nothing written).
    - A row with an unknown Status still gets an ID. So does a row holding only a Person value.
    - A second run gives zeros and an identical snapshot.
  - T-12-style check on an unscrubbed, real-shaped fixture after `addIdColumns`, in status mode: 6 Person values (including a formula), 0 found in the JSON.
- Mutation checks, one at a time, restored with `git checkout -- src`:
  - Dropping `calc.unavailable` in engine mode: caught (1 test).
  - Dropping the status-mode Quantity check: caught (5 tests).
  - **Survived:** case-folding or trimming Status; removing `addIdColumns`' all-tabs pre-check; narrowing contactUrl to 10-15 digits; skipping Person-only rows in `addIdColumns`.

**Findings (worst first):**
1. **S3: `contactUrl` accepts a number with no country code** (`catalogue.ts`, `contactUrl()`, `/^\d{8,15}$/`).
   - Repro: `catalogue(ss, { sellerWhatsapp: "9000000001" }).contactUrl` gives `https://wa.me/9000000001`, which WhatsApp reads as country code 90.
   - A national number with its leading 0 kept is published with the 0. A +91 number written with the trunk 0 keeps the 0 after 91 (13 digits). Text such as "ext 2" after the number has its digits joined on. All three are dead links. Repro: the synthetic fixture number in those three forms.
   - If the seller enters her 10-digit number without 91, every "Message to reserve" goes to a dead number or to a stranger abroad. That would be an S2 in practice. It's rated S3 because it only happens at setup, and correct entry plus manual check 2 below avoids it.
   - No test covers 8 to 10 digits or a leading 0. Suggest: require 11 to 15 digits and reject a leading 0, and say "with country code" in the runbook.
2. **S3: Status matching is exact, silently, and not pinned.** A trailing space or a lowercase "available" typed into the real sheet hides the item, with no log or count. Fail-closed matches D-035's table, so this is not a privacy issue. But nothing tells the seller an item vanished, and no test pins the choice either way (the case-fold mutant survives). PM to decide whether to trim whitespace; then pin it with a test.
3. **S3: `addIdColumns`' atomic pre-check is unpinned.**
   - The code is correct (probe above). But deleting the "check all four tabs first" loop leaves every test green.
   - Without that loop, a tab with no header crashes mid-run after earlier tabs got headers: a half-numbered real sheet.
   - No test covers the missing-tab or no-header throw.
4. **S3 (risk): IDs match the build copy only if both sheets have the same item rows and tabs.**
   - Probe: one extra row in Tech shifts every later ID. An extra item tab in the build copy outside the four allow-listed tabs (migrate numbers it, `addIdColumns` doesn't) shifts every ID (staged first Tech ID `I-0002` against real `I-0001`).
   - Published photos are named by build-copy ID.
   - D-035's PM name-per-ID comparison is the only safeguard. It must cover every ID, not a sample.
5. **S3: items the seller adds after setup get no ID, so they never appear** until she reruns `addIdColumns`. This isn't in the runbook.
6. **S4: an unusable Quantity hides the row in status mode** (blank, text, 0, negative, fraction). This is consistent with D-026 and engine mode, and setup fills blanks with 1. A quantity cleared later hides the item silently. Text quantity isn't tested in status mode (null, 0, 1.5 and -2 are). QA would keep the behaviour; PM to confirm.
7. **S4: engine-mode coverage drift.**
   - `catalogue.test.ts` `build()` has no Claims tab. Its no-claims, field and quantity-0/1.5 tests now run in status mode and pass for a different reason.
   - Engine D-026 exclusion is still caught, but by only one test (in `catalogue-qa.test.ts`).
   - Suggest an empty Claims tab in `build()` as in f8bad4e.
8. **S4: nothing pins the bundle footer or the OAuth scope.** Checked by hand this time.
9. **S4: `addIdColumns` reads Person cells for blankness** (Person-only rows get an ID), which is what migrate does. D-035 says "never reads Person". It never emits or writes Person; the wording should be tightened.

**No regression found in engine mode.** The full suite passes. With a Claims tab, Status is ignored as before (tests in `catalogue-status-mode.test.ts`). No Person value leaks in either mode.

**Manual checks still required (live, not in CI):**
1. Install the 5-minute trigger on `warmCatalogue`.
   - Executions screen: runs succeed, log "cache refreshed", no auth prompt beyond the current scope.
   - Then time a few GETs: about 2 s.
2. After `SELLER_WHATSAPP` is set, fetch `?action=catalogue`. `contactUrl` must be `https://wa.me/91` followed by 10 digits. The seller compares it with her number by eye. Nobody sends a message.
3. With the property deleted: `contactUrl` is `null` and the response is otherwise normal.
4. On the real sheet (backup first), run `addIdColumns`.
   - The log shows counts only. A second run logs zeros.
   - The PM compares name per ID against staging for **every** ID.
5. The seller reads the real sheet's Notes column and the brand/book-name links for buyer names or numbers. These cells are published verbatim, and the real sheet was never scrubbed. The probe confirmed that a phone-like Notes string reaches the JSON.
6. The seller checks that the number of Available plus Reserved rows equals the item count in the response (this catches finding 2).

**Not examined:** the site (no site code in this change), the real sheet and its data (rule 4), live Apps Script behaviour (triggers, CacheService 100 KB value limit, Script Properties), CI.

**Verdict:** passes QA. No S1 or S2 found. Before the link is shared, close findings 1 and 5 (runbook or code) and do manual checks 2, 4 and 5.

## 2026-11-05: S-06 catalogue screen (D-034 browse-only)

**Change:** c8e4364 (red tests; PM swapped the 1x1 WebP in `test/e2e/helpers.ts` from base64 to hex to avoid a pii-scan false positive), 0dc2a20 (`src/site/config.ts`, `src/site/view-model.ts`), 0bc7393 (`src/site/main.ts`, `public/style.css`). Branch `S-06-catalogue-screen`.

**Gate (fresh `npm ci && npm run check`, QA run):** exit 0. Vitest 514 passed (23 files); Playwright 154 passed, 2 skipped (CLS is Chromium-only); 2.8 KB gzipped of 50 KB; pii-scan 188 files, 0 findings.

**How probed:** temporary Playwright specs in `test/e2e/` (deleted before this commit, tree clean), run on all four projects (Chromium and WebKit, Pixel 7 and iPhone 14). Mocked API and manifest only; synthetic data only.

**Verified correct:**
- XSS: all data goes through `textContent`; no `innerHTML` in `src/site/`. The existing hostile-name test passes, and hrefs are set as properties.
- `link` is not rendered anywhere (an item with `link: "javascript:alert(1)"` produced no anchor besides the reserve links).
- contactUrl allow-list: `javascript:…`, `https://evil.example/`, `http://wa.me/1` and `https://wa.me.evil.example/1` all give no links. `https://wa.me/@evil.example` is accepted, but its host is still wa.me, so that's harmless.
- Reserve text encoding: the decoded `?text=` equals `Hi! I'd like to reserve: <name>` exactly, with a single `text` parameter and no fragment, for `Pots & Pans #2`, `Lamp 🌟 big`, `50% off + more`, `a?b=c&d` and curly quotes, on both engines.
- Bundle: `dist/main.js` contains no digits after `wa.me/` and no 10-digit run. The API URL is public by design (brief 4.2). The seller's number reaches the DOM only through the `contactUrl` href, which D-034 intends.
- Layout: no horizontal overflow at 390 px or 320 px with 100+ character unbroken names and brands (overflow 0 on all four projects), including in the error state.
- Tap targets: every "Message to reserve" link is 148x44 and "Try again" is 102x44. (The fallback WhatsApp link is the exception; see F3.)
- Empty catalogue: shows "Nothing is listed right now. Please check back soon.", with no notes and no blank page.
- Manifest 404: rows render with no `<img>`.
- A failed refresh keeps the cached list visible, with the error box above it.
- Non-JSON cache (`{not json`) is ignored (existing test).
- Blocked storage works (T-14, existing tests).
- Timeout: 20 s is fine against D-033's 13 s worst warm miss. Pinned by the 14 s and 31 s clock test.

### Findings

**F1, S3: list rendering waits on `photos/manifest.json`, and that fetch has no timeout.** `show()` does `await manifest` before rendering anything, both the cached list and the fresh one.
- (a) If the manifest request stalls, nothing ever renders, even after the API has answered. The loading line stays forever, with no error and no retry. That breaks brief 7, "every failure has a retry".
- (b) On a repeat visit the cached list waits a full manifest round trip, which weakens the AC "cached… shown right away".
- Repro (a): route `**/photos/manifest.json` to a handler that never fulfils, mock the API `ok()`, then `goto("/")`. There are 0 rows after 8 s on all four projects.
- Repro (b): first load normally. Then delay the manifest 3 s and make the API hang, and reload. The cached rows appear only after about 3.3 s on all four projects.
- Suggested direction: render without photos straight away and add thumbnails when the manifest arrives, or give the manifest a short timeout.
- Regression test needed: a manifest that hangs, with the cached and the fresh list each still rendering.

**F2, S3: one malformed item poisons the cache, and every later visit is a blank page.**
- `parseCatalogue` checks only that `items` is an array.
- `load()` calls `writeCache(c)` before `show(c)`. If rendering then throws (for example on a `null` item), the bad data is already cached.
- On the next visit, `void show(cached).then(() => load())` rejects, so `load()` never runs. The result is no loading line, no error box, no retry and no API request, until the user clears site data.
- The same happens with any valid-JSON cache entry holding a non-object item.
- Repro: mock the API as `{"items":[{"id":"I-1","name":"x"},null],"contactUrl":null}` and `goto("/")`. The fallback shows, but localStorage already holds the bad payload. `reload()` gives a page with only the h1 and the early note, and the pageerror `TypeError: null is not an object (evaluating 'o.freeUnits')` (WebKit iPhone). Changing the API to `ok()` doesn't help, because it's never called.
- Likelihood is low (our own handler emits typed items), but there's no in-app recovery.
- Related, S4: an item missing `freeUnits` (undefined) is silently dropped by `sortItems`, because it's in neither the `> 0` nor the `<= 0` group.

**F3, S4: the fallback "Or message me on WhatsApp" link is 216x19 px**, not 44 px tall (brief 7). Repro: load once with `ok()`, then reload with `serverError`, and measure `[data-testid=catalogue-error] a` (WebKit iPhone and Pixel). It has no `.reserve`-style min-height.

**F4, S4: a contactUrl that already has a query string gives a malformed link.** `https://wa.me/919000000001?text=hi` becomes `…?text=hi?text=Hi!%20I'd…`. The server is meant to send a bare URL (D-034 item 4), so this is defensive only. Either reject a `?` in the allow-list or use `URL`/`searchParams`.

**F5, S4: a malformed manifest gives `src="photos/undefined"` and `alt="undefined"`.** Repro: manifest `{"I-9001":"str","I-9002":[{"thumb":"a.webp"}]}`. The manifest is our own generated file, so the risk is low.

**F6, S4 (copy and decision, not a defect):**
- On first visit with the API down, the fallback has no WhatsApp link, because the number isn't in the repo. That's deliberate and tested. D-034 item 3 says the fallback comes "with the WhatsApp link", so the PM or seller should confirm that this gap is acceptable, or pick a public alternative.
- With a cached list on screen, the box says "We couldn't load the sale just now", while the list is visible and could be stale. Consider "Couldn't refresh; showing the last saved list."
- **Seller to confirm the copy** the implementer wrote: "All prices negotiable." and "Books: Free for libraries and students." (from brief 6.4), and the reserve message "Hi! I'd like to reserve: <name>". Books messages carry only the name, not the author.
- The background is `#fff`, not the brief's "warm off-white". That's pre-existing.

### Coverage gaps (no test would go red)

- Removing the `wa.me` allow-list in `parseCatalogue` breaks no test: there's no test with a non-wa.me `contactUrl`.
- There is no test for manifest failure (404, hang or junk). F1 is the consequence.
- There is no test for a valid-JSON but malformed cache or API item. F2 is the consequence.
- No test checks the fallback link's tap target.

### Screenshots (scratchpad, not in the repo; synthetic data)

`<scratchpad>/shots/`:
- 390 px list: `s06-390-webkit-iphone.png`, plus the chromium-iphone, chromium-pixel and webkit-pixel versions.
- 320 px list with long names: `s06-320-*.png`.
- First-visit error: `s06-390-error-*.png`.
- Cached list with a failed refresh: `s06-390-stale-plus-error-*.png`.

Reviewed by eye: no overflow, long names wrap, and status is shown as text and not by colour alone.

### Manual checks still needed (live or device)

- On a real phone on staging (G1): the cached list on a second visit appears with no visible wait.
- Tapping "Message to reserve" opens WhatsApp with the prefilled text, including an item with `&` or emoji. Assert the URL only; don't send.
- Lazy thumbnails load on scroll on iOS Safari and Android Chrome.

### Not verified

- Real API or staging behaviour.
- Real photos or the real manifest (not read).
- Contrast measured with a tool (only by eye; the colours look AA).
- Screen-reader output.
- CI.

### Verdict

**Does not pass QA yet.** There is no S1 or S2. F1 makes the AC "cached… shown right away" depend on a second network request, and a stalled manifest leaves the loading line up for good with no retry (brief 7). F2 can leave a returning visitor on a blank page with no recovery. Both are small fixes in `main.ts`, and each needs a failing test first. F3 to F6 are S4s for the PM; F6 needs the seller's copy confirmation.

## 2026-11-05: S-06 re-check of QA fixes (commits 9a97453, 0c7c95c, ffef800)

**What changed:** `main.ts` renders without waiting on the manifest (3 s manifest timeout, cached manifest, thumbnails applied when it arrives, 72 px slot reserved when `photos > 0`); items validated (`isValidItem`: string id/name, numeric freeUnits/unitsLeft); a cache with any invalid item is dropped whole (PM decision), API items filtered one by one; `reserveUrl` uses `URL`/`searchParams`; `.error a` gets 44 px; manifest entries checked; refresh-failed copy is "Couldn't refresh just now — showing the last saved list."

**Gate:** `npm run check` re-run fresh in the worktree: tsc, eslint, unit, 294 Playwright passed / 2 skipped (the Chromium-only CLS test on WebKit), 3.3 KB gzipped, pii 0 findings.

**Repros re-run** (temporary scratch spec, deleted afterwards; chromium-iphone and webkit-iphone):
- F1 fixed. Manifest that never answers: 4 rows within 3 s. Cached rows with API hanging and manifest delayed 3 s: rows in 15–20 ms.
- F2 fixed. API `[{"id":"I-1","name":"x"}, null, ...4 good]`: 4 rows, and after reload still 4 rows, no pageerror.
- F3 fixed. Fallback link is 224x44.
- F4 fixed. `https://wa.me/…?text=hi` gives one `text` param, the reserve message.
- F5 fixed. Junk manifest entries give no `<img>` and no "undefined" in the page.
- F6 copy: refresh-failed notice reads as the PM decided. Seller copy confirmation is still open.

**CLS (Chromium only, real-shaped data: photos > 0 on items in the manifest, manifest delayed 2 s):** 0 (also 0 with the API delayed 500 ms). API says photos 0 but manifest has entries: 0.045 (the shift the implementer mentioned; acceptable, under 0.1, and only from a data mismatch). photos > 0 on every item but the manifest has entries for only 2: 0.026 (empty slots are removed, rows shift left). All under 0.1.

**Regressions checked, all fine:** hostile `<img onerror>` name stays as text, no dialog; `link` not rendered; 320 px with 140-char unbroken name and brand: no overflow; every reserve link is 44 px tall or more; allow-list rejects `javascript:`, `https://evil.example/`, `http://wa.me/1`, `https://wa.me.evil.example/1` (no anchors); empty catalogue shows "Nothing is listed right now. Please check back soon."

**Screenshot:** `<scratchpad>/shots/s06-recheck-390-{webkit,chromium}-iphone.png` (synthetic data). Looked at the WebKit one: thumbnails aligned, long text wraps, reserve links clear, no overflow.

### New findings

**F7, S3 (low likelihood): an item that passes `isValidItem` but has no `price` key blanks the whole list.** `formatPrice(undefined)` throws (`undefined !== null`, then `.toLocaleString`). On a first visit that means 0 rows and the "couldn't load" box. Retry will hit the same error, though the WhatsApp link is shown because `contactUrl` is set before the throw. On a repeat visit the cached list stays, with the refresh notice, so the stale list never updates. That contradicts the PM's "API answers filtered item by item". Repro: mock API `{items:[{...ITEMS[0], id:"I-7", price: undefined}, ...ITEMS], contactUrl:null}` (JSON drops the key), goto `/`: 0 rows, error box shown, on both engines. Fix direction: validate `price` (number or null) and the other fields the view reads, or render rows defensively. It needs a failing test first. Our handler emits typed items, so this case shouldn't happen in practice.

**F8, S4: a manifest slower than 3 s leaves empty 72 px gaps for the session.** The fetch aborts, `applyPhotos` never runs, and the reserved slots for `photos > 0` items stay blank. Repro: manifest delayed 4 s with real-shaped data: 0 imgs, 2 empty slots after 5 s. On slow mobile data this is plausible on a first visit. A repeat visit uses the cached manifest.

**F9, S4 / manual check: the reserve text is now `+`-encoded** (`Hi%21+I%27d+like+to+reserve%3A+Test+Kettle`, from `URLSearchParams`), where before it was `%20`. Decoding with `URLSearchParams` gives the exact text, so the tests pass, but WhatsApp's handling of `+` hasn't been verified on a device. Manual check (G1): tap "Message to reserve" on iOS and Android and confirm the spaces show as spaces (don't send).

### Coverage gaps
- No test for a valid-looking item that's missing `price` or `tab` (F7).
- No test for a manifest that arrives after the timeout (F8).
- The CLS test still uses `photos: 0` fixtures and an undelayed manifest, so it doesn't cover the delayed-manifest case measured above. Suggest adding a version with real-shaped data.

### Not verified
Pixel profiles for the scratch repros (iPhone profiles only; the gate covers all four for the committed tests); real device or staging; WhatsApp `+` decoding; screen readers.

### Verdict
**Passes QA.** F1–F5 are fixed and pinned by tests, there are no regressions, and CLS is under 0.1 with a delayed manifest. F7 (S3, a server-typed payload makes it unlikely) and F8/F9 (S4) go to the PM as follow-ups; F7 should get a failing test and fix before G1. The F6 seller copy confirmation is still open.

## 2026-11-06: D-037 link tracking strip (branch R1-link-tracking, commits 7f550b9 red, 1f53c7b green)

**What changed:** `safeLink()` in `src/api/catalogue.ts` now passes http(s) links through `stripTracking()`. Amazon hosts (`amazon.<tld>` or a subdomain of one) lose the whole query string. Other hosts lose only the D-037 tracker names (case-insensitive). The fragment is kept, and the `?` goes if nothing is left. It is plain regex and string code, because Apps Script has no `URL` class. The tests are the `tracking parameters (D-037)` block in `test/unit/catalogue.test.ts`, 14 cases.

**Gate (fresh `npm run check`, exit 0):** tsc ok, eslint ok, Vitest 31 files / 757 tests passed, Playwright 352 passed / 4 skipped, size 3.4 KB of 50 KB gzipped, pii-scan 203 files / 0 findings. Red-then-green order is visible in the history.

**Apps Script bundle:** `npm run build:gas` was rebuilt fresh. The new code in `dist/appscript/Code.js` uses only regex, `split`, `filter`, destructuring and a template string. It contains no `new URL(`, `URLSearchParams`, `?.` or `??` (esbuild lowers these). There is no `g` flag on the module-level regexes, so no `lastIndex` state can carry over between calls.

**Exploratory probe:** I bundled the real handler against the fake sheet in a scratch dir and fed it 32 synthetic links. Results:
- Fine: uppercase host and scheme; port (`:443` on Amazon, `:8080` elsewhere); trailing-dot host; `evilamazon.in` and `notamazon.in` (not treated as Amazon); `?` alone; `?#x`; params without `=` (`gclid` dropped, `id` kept); `?` inside the fragment (left alone); `;` separators (left alone; the whole `id=1;gclid=2` is one param); `ftp:`, `javascript:` and `mailto:` still give null.
- Very long links don't crash or slow down: a 200 KB query with 10,000 trackers took 2 ms, a 140 KB host 0 ms, and a 100 KB path 0 ms.
- No input crashed the catalogue.

**Mutation check** (scratch copy, D-037 block only):
- Caught: dropping the `(^|\.)` boundary (the `notamazon.example` case goes red) and allowing only single-label TLDs.
- Survived: making the Amazon regex case-sensitive, removing the port strip, and keeping empty params.

### Findings

**F1, S3 (low likelihood): a non-Amazon host with an `amazon.` label in it is treated as Amazon and loses its whole query.** `AMAZON_HOST = /(^|\.)amazon\.[a-z.]+$/i` accepts any run of labels after `amazon.`, so `amazon.in.evil.example` and `www.amazon.in.evil.example` match. That is wider than D-037.1 ("`amazon.<tld>` or a subdomain"). A functional param on such a host would be removed, and the link might stop working. Repro: `https://amazon.in.evil.example/p?id=7&gclid=1` gives `https://amazon.in.evil.example/p` (expected `…/p?id=7`). This is unlikely on the seller's sheet. Fix direction: restrict the TLD part, e.g. `amazon\.(?:com?\.)?[a-z]{2,3}$`, with a failing test first.

**F2, spec note for the PM (S3 if such links exist): Amazon links that aren't product links lose their working query.** D-037.1 assumes nothing functional lives in an Amazon query. That holds for `/dp/<ASIN>`, but not for search or listing pages. Repro: `https://www.amazon.in/s?k=lamp&ref=nb` gives `https://www.amazon.in/s`, a generic page. The code follows the spec. The PM should confirm on the live response (T-12 scan; QA may not read the real sheet) that every Amazon link is a `/dp/` or `/gp/product/` link.

**F3, S4: two tracker forms slip through.**
- An Amazon host behind userinfo is not recognised, so its query is kept. Repro: an `https://` link to `amazon.in/dp/X?a=1` with a userinfo part (user name, then the at sign) before the host comes back unchanged.
- Percent-encoded tracker names are not matched. Repro: `https://shop.example/p?utm%5Fsource=x&id=1` comes back unchanged.

Both forms would only carry the seller's own tracking, which is what D-037 removes, and neither is plausible from copy-pasted shop links.

**F4, S4 (note only): empty params are normalised away.** Repro: `https://shop.example/p?a=1&&gclid=2&` gives `https://shop.example/p?a=1`. This is harmless and arguably intended.

### Coverage gaps (no test would go red)
- Amazon host matching ignores case: there is no uppercase-host case, and the case-sensitive mutant survived.
- The port strip before the Amazon test: there is no `amazon.<tld>:port` case, and the mutant survived.
- The empty-param filter (`p !== ""`): there is no `?&a=1` case, and the mutant survived.
- No test pins F1, the spec boundary on the right-hand side (`amazon.in.evil.example` must keep its query).

### Manual checks still needed
- On the live catalogue response after the push: no item link contains `hvlocphy`, `gclid`, `utm_` or `gad_`, and every Amazon link is a `/dp/` style product link (F2). Open two or three stripped links on a phone and confirm they land on the right product.

### Not verified
- The real sheet or live response (rule 4 / PM's T-12 scan).
- Running the bundle inside the actual Apps Script runtime (checked statically only).
- Non-ASCII or IDN hosts.
- Links with whitespace inside a single URL (pre-existing `safeLink` behaviour takes the first run).

### Verdict
**Passes QA (sign-off)**, with F1 (S3, low likelihood, a spec deviation) and the three coverage gaps going to the PM as follow-ups. F1 should get a failing test and a fix before any wider sharing. F2 needs a PM check on the live response. Note: during this review `docs/backlog/STATUS.md` showed an uncommitted edit made by another agent. QA did not touch it.
