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
| T-17 (fixture half) | S-03 | Automated (`test/unit/migrate.test.ts`, in-memory fake) | 2026-11-03 | Pass on the fake. Real-adapter behaviour not verified. See S-03 B1 to B4 and F5 |

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
