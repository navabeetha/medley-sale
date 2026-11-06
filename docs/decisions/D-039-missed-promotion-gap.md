# D-039: The timed repair can't stamp a promotion whose edit was missed (accepted gap)

- **Status:** Proposed (PM, 2026-11-06), from the S-15 red step.
- **Why:** the sheet doesn't record each claim's previous role, so the 10-minute `recalculateAll` can't tell a holder who moved up from one who always held. If it guessed, it would stamp every initial holder and flood the To do tab.

## Decisions

1. **The on-edit trigger stamps `Promoted at`; the timed job doesn't invent promotions.** The timed job repairs Status, Person, Message links, sold details and stale stamps only.
2. **Accepted gap:** if the on-edit trigger misses a release, the waiter who moves up gets no `Promoted at` and so no To do row. They still show as the holder in Person and on their booking page.
3. **Revisit at G1:** if the seller's dropdown edits from the Google Sheets phone app don't fire the installable trigger, add a hidden script-owned "Role" column on Claims (a schema change, one agent at a time) so the timed job can detect role changes and stamp them.
