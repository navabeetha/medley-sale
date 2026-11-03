# D-020: S-04 timings and other measurements are recorded as new decision files

- **Status:** Proposed
- **Date:** 2026-11-03
- **Raised by:** PM, docs setup
- **Context:** S-04 says to record real cold and warm response times "in the decision log". The brief's Section 5 is read-only.
- **Decision:** S-04 records its timings in a new file in `docs/decisions/` (for example `D-0NN-apps-script-timings.md`), linked to D-001 and D-015. The file includes the date, how the timings were measured, and the go or no-go result for D-001.
- **Why:** This keeps the brief unchanged and puts the evidence where new decisions live.
- **Consequences:** A warm catalogue response over 3 seconds is raised to the seller, with N-05 as the mitigation, as S-04 requires. If Apps Script can't work from Pages at all, that's a stop condition (11.5).
