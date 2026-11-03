# S-17: QA and privacy pass

| | |
|---|---|
| **Points** | 2 |
| **Slice** | 4: Release |
| **Depends on** | S-08, S-13, S-14, S-15 |
| **Status** | Backlog |
| **Pod type** | enabling, **QA-led** ([D-021](../../decisions/D-021-story-types-and-ready.md)). Bugs found become `bugfix` tickets |
| **Gate** | Any S1 found is a stop condition (11.5). Must pass before G2 |
| **Branch** | `S-17-qa-privacy-pass` |

## Acceptance criteria (brief Section 8, verbatim)

- All scenarios in Section 8.1 pass, with budgets met.
- axe shows no serious issues on all screens.
- QA tries token guessing, script and formula injection in name, and reading other bookings.
- Repo and its full history contain no real names, numbers, tokens or the sheet export.

## References

- Critical scenarios **T-01 to T-18** (T-18 live on staging). Budgets and bug severity 8.1. Hard rules 11.6. Risk 10.3 (personal data committed). Results go in `docs/qa/`.

## the seller needs to do

Nothing, unless an S1 is found (then the PM explains it to her and asks how to proceed).

## Out of scope

A real-device test matrix (not planned).
