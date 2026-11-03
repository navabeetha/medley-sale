# QA

QA owns the critical test scenarios (brief 8.1), exploratory testing, bug reports and sign-off. QA must not fix a bug and sign off that same fix (11.4).

> **The QA log for this project is `docs/qa/qa-log.md`** (not the default `docs/qa-log.md`).

## What goes here

- **`qa-log.md`:** one dated entry per story verified. Include the story ID, what was checked against each acceptance criterion, the viewports and browsers used (Chromium and WebKit, Pixel and iPhone profiles), 390 px screenshot references for UI changes, the result (pass or fail), and any bugs raised.
- **Scenario results** for T-01 to T-18. Keep a running table in `qa-log.md` or a separate `scenarios.md`: ID, story, automated or live, last run date, result. T-18 is a live staging check, not in CI.
- **Bug reports:** `bug-NNN-<slug>.md`, with the steps to reproduce, expected and actual results, the story, and the severity:
  - **S1:** privacy leak or lost reservation. **Stops release.** The PM must raise it with the seller (stop condition 11.5).
  - **S2:** core journey broken. Fix before launch.
  - **S3:** a workaround exists. The PM decides.
  - **S4:** cosmetic.
  Every fix starts with a failing test.

## Privacy

Nothing in this folder may contain real names, real numbers, booking tokens, sheet links or IDs (11.6). Screenshots use staging data only, which is synthetic after the scrub. Redact any token visible in a URL bar.
