# S-15: Seller sheet workflow

| | |
|---|---|
| **Points** | 3 |
| **Slice** | 3: Back out and sell |
| **Depends on** | S-02, S-03 |
| **Status** | Backlog |
| **Pod type** | feature |
| **Gate** | **G1 confirmation**: The seller checks the dropdown from the Google Sheets phone app |
| **Branch** | `S-15-seller-sheet-workflow` |

## Acceptance criteria (brief Section 8, verbatim)

- An installable on-edit trigger responds to `State` edits on `Claims`, under the lock, and recalculates.
- Writes `Status` and `Person` back to item tabs. For quantity above 1, status shows e.g. "2 left, 1 sold".
- Setting `sold` fills `Sold at` and defaults `Sold price`. An edited price is kept.
- Quantity overflow is reverted with an explanation (rule 6.1.7).
- `Message link` opens WhatsApp to that person with item details and their private link. Rows without a number stay blank until the seller adds one.
- `To do` lists promoted holders until `Notified` is ticked. `Sold` shows the ledger and totals.
- A timed recalculation every 10 minutes repairs anything missed.
- The seller confirms at G1 that the dropdown works from the Google Sheets phone app. If it doesn't trigger there, the timed job still catches it, and the interval can be shortened.

## References

- Sell journey 2.7. Sheet structure 4.1 (`Status` and `Person` are script-written, with protection warnings). Queue 6.1 (rules 3, 4, 6, 7, 8). D-003, D-010. Risk 10.3 (seller sorts `Claims`: logic uses IDs, not row positions). Only one agent changes the sheet schema at a time.
- Critical scenarios: **T-05, T-06, T-07**.

## Notes

- 8 criteria: at the limit. The last one is `manual:` (The seller at G1).
- The trigger behaviour from the phone app is unconfirmed (research note 12).

## Bugfix tickets carried from S-11 QA re-check (PM, 2026-11-06); do these first

- **R1 (S3):** a booking counts as orphaned only when NO row in the raw Claims grid carries its Booking ID, whatever its State. Today a typo'd State (e.g. `Sold `) makes a same-key retry re-create the claims (double-booking).
- **R2 (S4):** `releaseLock` in its own outer `finally`, so a throwing `flush()` still releases the lock.
- **R3 (S4):** trim `SITE_URL` before checking it, so a pasted trailing space or newline doesn't switch reserving off.
- Coverage: a `SITE_URL` with userinfo must give `not-configured` (surviving mutant).

## the seller needs to do

At G1, change a `State` dropdown in the Sheets phone app and confirm the site and `Sold` tab update (see runbook G1).

## Out of scope

A seller phone screen (N-02), manual waitlist reordering (N-08), and flagging slow responders (N-03).

## Note from S-02 (D-026)

The on-edit trigger must call `canMarkSold` and derive `previousRole` from the claims **as they were before the edit** (use the edit event's old value). Passing the after-edit state would revert every sale.
