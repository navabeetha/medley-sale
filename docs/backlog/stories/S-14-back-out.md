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

## the seller needs to do

Nothing.

## Out of scope

The seller email (S-16) and the sheet `To do` tab mechanics (S-15).
