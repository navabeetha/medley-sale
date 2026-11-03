# S-11: Reserve API

| | |
|---|---|
| **Points** | 3 |
| **Slice** | 2: Reserve |
| **Depends on** | S-02, S-03 |
| **Status** | Backlog |
| **Pod type** | feature |
| **Gate** | The live staging check needs G0.3 complete |
| **Branch** | `S-11-reserve-api` |

## Acceptance criteria (brief Section 8, verbatim)

- Saves bookings and claims under the script lock, and returns each unit's outcome.
- A repeated idempotency key returns the original booking.
- A sold-out or hidden item is skipped and named in the response. If everything is skipped, no booking is created.
- A formula-like name is stored as plain text.
- Live staging check: 10 parallel requests for a quantity 1 item give 1 holder and 9 waiting, with no lost or duplicate rows.
- Clears the catalogue cache.

## References

- API 4.3 (`POST {action:"reserve"}` returns a token, per-unit outcome, skipped items and the WhatsApp URL. Body as `text/plain`). Queue 6.1 (rule 6: `LockService.getScriptLock()`). Limits 6.3 (basket of 15, 20 active claims per number, idempotency, honeypot answers as a success but saves nothing, spreadsheet safety).
- D-005 (token of at least 128 bits), D-008, D-011 (seller number only inside the returned WhatsApp URL). N-09 note: preventing double booking is MVP and must not be deferred.
- Critical scenarios: **T-01, T-03, T-08, T-09, T-10, T-18** (T-18 is live, not in CI).

## the seller needs to do

Nothing, unless redeploying the staging web app needs her authorisation (the PM walks her through it if so).

## Out of scope

Booking read and back-out calls (S-12, S-14), and the email (S-16).
