# D-021: Pod types for S-17 and S-18, and applying Ready strictly

- **Status:** Proposed
- **Date:** 2026-11-03
- **Raised by:** PM, docs setup
- **Context:** The pod runs `feature`, `bugfix`, `refactor` or `enabling` compositions. S-17 (QA and privacy pass) and S-18 (cutover) add no new product behaviour. The Definition of Ready (11.2) needs dependencies to be met.
- **Decision:**
  - S-01 is `enabling`. S-02 to S-16 are `feature`.
  - S-17 is `enabling`, **led by QA**. The automated budget, axe and history checks it needs are built test-first. Each bug it finds becomes a `bugfix` ticket (S1 stops release).
  - S-18 is `enabling`. Agents write the runbook and draft the group message, and the seller does the Google-account steps at G2.
  - A story is marked **Ready** only when all its dependencies are **Done**. So S-02 stays in Backlog until S-01 is Done, even though it's otherwise ready.
- **Why:** This uses the smallest set of compositions, and reads 11.2 literally.
- **Consequences:** STATUS.md shows S-01 as the only Ready story right now.
