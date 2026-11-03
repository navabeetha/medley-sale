# D-025: Push barrier finished with one narrow fix; leftovers deferred to S-17

- **Status:** Accepted (the seller, 2026-11-03)
- **Context:** S-01's personal-data guard needed three QA rounds (R1, then F1 on merge commits). Section 11.5 says a blocker surviving two attempts goes to the seller.
- **Options:** A) one final narrow fix for merge commits, QA re-checks only that; B) refuse merge commits instead; C) push with the known gap.
- **Decision:** A. Remaining S4 items move to S-17's privacy pass: nested lockfile skip (F4), binary files not scanned (F5), EISDIR crash on untracked symlinked dirs (and that crash exiting 0), `token` literal false positive, untested tag pushes and `--no-verify`.
- **Consequence:** S-01 grew well past 2 points; recorded in the slice 1 retro.
