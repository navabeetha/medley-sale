# S-14: Back out

| | |
|---|---|
| **Points** | 3 |
| **Slice** | 3: Back out and sell |
| **Depends on** | S-02, S-12 |
| **Status** | Backlog |
| **Pod type** | feature |
| **Gate** | none |
| **Branch** | `S-14-back-out` |

## Acceptance criteria (brief Section 8, verbatim)

- Inline confirmation with the Section 6.4 copy, per unit.
- A holder backing out promotes the next person, and the catalogue updates.
- A waiter leaving updates others' positions, without creating a seller task.
- A repeated request causes no error and no second promotion.
- Offers an optional **Tell the seller** WhatsApp action.

## References

- Back-out journey 2.7. API 4.3 (`POST {action:"backOut", token, claimId}` returns the updated booking and the WhatsApp URL for telling the seller). Queue 6.1 (rules 3, 5, 6). D-010.
- Copy 6.4: "Back out of [item]? If you change your mind, you'll rejoin at the end of the line."
- Critical scenarios: **T-02, T-04, T-05**.

## Notes carried from S-11 (PM, 2026-11-06)

- The D-026 requirement "a waiter promoted by a write gets `Promoted at` (and so a `To do` row)" can't happen on a reserve: new claims join the end of the line. It is pinned here and in S-15 instead. A back-out or a sale that frees a unit must stamp `Promoted at` on the waiter who moves up, using `previousRole` from a recalculation before the write.

## Bugfix tickets carried from S-15 QA re-check (PM, 2026-11-06); do these first

- **F7 (S3):** `syncStateNotes` reads one note per Claims row inside the lock (every timed run and F2 repair). Read the State column's notes in one batch (add a batch `getNotes(col)` to Tab) so a concurrent reserve never waits long enough to answer `busy`.
- **F8 (S3):** a State cleared with Delete on a row with a Claim ID silently drops the claim from the queue. Note a blank State on such rows too (same note mechanism as NOT_A_STATE, with wording that says to choose active, released or sold).
- **F9 (S4):** the F2 staleness check misses a sort that leaves the same State on the edited row. Also compare the row's Claim ID with what the handler read under the lock if possible; otherwise run the full repair whenever the row's claim can't be confirmed.
- **F10 (S4):** an accepted edit clears any note on that State cell, including the seller's own. Clear only our own notes (refusal reason or NOT_A_STATE), now that `getNote` exists.
- Coverage: blank normalisation in the staleness check; the blank-newValue early return; the "needs a Claim ID" condition for the typo note.

## the seller needs to do

Nothing.

## Out of scope

The seller email (S-16) and the sheet `To do` tab mechanics (S-15).
