# S-02: Queue engine with quantity

| | |
|---|---|
| **Points** | 5 |
| **Slice** | 1: See the sale |
| **Depends on** | S-01 |
| **Status** | Backlog (otherwise meets Ready. Becomes Ready when S-01 is Done, per [D-021](../../decisions/D-021-story-types-and-ready.md)) |
| **Pod type** | feature |
| **Gate** | none |
| **Branch** | `S-02-queue-engine` |

## Acceptance criteria (brief Section 8, verbatim)

Pure TypeScript with no Apps Script or sheet dependency.
- Every rule in Section 6.1 has tests.
- Scenarios include: quantity 3 with 5 claims, a holder backing out, one unit sold, undoing a sale, and undoing a release after a promotion.
- A single `recalculate(item, claims)` function produces all holder and promotion results.

## References

- **Section 6.1 queue rules 1 to 8** (each one needs a test). D-004 (one claim per unit), D-010 (no expiry).
- Lives in `src/domain/`. Only one agent changes `src/domain/` at a time.
- Critical scenarios: **T-02, T-04, T-06**. The domain logic behind T-03 (partial hold) and T-07 (overflow detection) is also exercised here, and the sheet and API halves are in S-11 and S-15.

## Notes

- Rule 6.1.6 (script lock) is platform behaviour. In S-02 it's covered by the engine being a pure function that callers run under the lock. The lock itself is tested in S-11 and S-15.
- 5 points is the Ready limit. If it grows, split it (stop condition 11.5).

## the seller needs to do

Nothing.

## Out of scope

Sheet reads and writes, the API, and UI.
