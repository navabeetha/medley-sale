# S-16: Seller email summary

| | |
|---|---|
| **Points** | 2 |
| **Slice** | 3: Back out and sell |
| **Depends on** | S-11, S-14 |
| **Status** | Backlog |
| **Pod type** | feature |
| **Gate** | Slice 3 ends at **G1** |
| **Branch** | `S-16-seller-email-summary` |

## Acceptance criteria (brief Section 8, verbatim)

- New reservations and back-outs are collected, and a timed job emails the sheet owner one summary at most once an hour, with name, item and outcome.
- No email is sent if nothing happened. Waiters leaving the line and the seller's own edits don't trigger one.
- An email failure never fails the reservation, and unsent events stay queued for the next summary.

## References

- D-013 (email to the account's own address, so no address is stored in code. At most one an hour, and none if nothing happened). Risk 10.3 (neighbour never messages).
- No dedicated critical scenario. Unit tests with a fake mailer, plus a live staging check.

## Notes

- Live checks send only to the build copy owner's own account (The seller's), never to anyone else. Test events use synthetic names only.

## the seller needs to do

Nothing required. Staging summary emails go to the build copy owner's account (hers), so she may see them in her inbox during the build and at G1.

## Out of scope

Any other alert channel (N-10).
