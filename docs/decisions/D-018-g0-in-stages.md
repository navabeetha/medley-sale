# D-018: Gate G0 is done in three stages

- **Status:** Proposed
- **Date:** 2026-11-03
- **Raised by:** PM, docs setup
- **Context:** Brief 10.2 says G0 comes "before S-01 deploys and S-03 runs". It includes the seller "checks the scrub", but the scrub (`scrubStaging()`) is itself part of S-03, so it can't all happen before S-03 runs.
- **Options:** (a) one big G0 before any S-01 or S-03 work; (b) G0 in stages, each blocking only what needs it.
- **Decision:** (b), with three stages:
  1. **G0.1: GitHub repo.** Blocks S-01's Pages deploy only. S-01 local work and S-02 can go ahead before it.
  2. **G0.2: build copy, script and `clasp login`.** Blocks S-03 running against the build copy. S-03 code and tests against fixtures can go ahead before it.
  3. **G0.3: scrub check.** Agents run only `scrubStaging()` on the build copy. The seller checks it by eye. **No agent reads the build copy's data, or runs anything else on it, until the seller confirms.** That includes the rest of the migration, S-04 and S-05's export.
- **Why:** Each part stays as strict as the brief requires, without making the seller do everything before any code exists. The privacy rule in brief 1.3.2 is unchanged.
- **Consequences:** Steps are in `docs/runbook.md`. STATUS.md tracks each stage separately.
