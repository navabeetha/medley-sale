# S-18: Cutover

| | |
|---|---|
| **Points** | 2 |
| **Slice** | 4: Release |
| **Depends on** | S-16, S-17 |
| **Status** | Backlog |
| **Pod type** | enabling ([D-021](../../decisions/D-021-story-types-and-ready.md)) |
| **Gate** | **G2**. The first and only time anything touches the real sheet |
| **Branch** | `S-18-cutover` |

## Acceptance criteria (brief Section 8, verbatim)

Follow a written runbook, with the seller performing the steps that need her Google account:
1. Announce a short pause in the group, stop taking comment reservations on the real sheet, and back it up.
2. Approve the text fixes.
3. Run the migration and compare counts with the current sheet.
4. Set Script Properties and deploy the script.
5. **Turn off public sharing of the sheet.** Confirm it from a logged-out browser.
6. Test by reserving, backing out and selling a hidden test item, then remove it.
7. Agents draft a short group message. The seller posts it.

## References

- Runbook: [docs/runbook.md](../../runbook.md), G2 section (DRAFT until this story).
- D-011 (turning off sharing is a launch blocker), D-012. Script Properties 4.2 (`SELLER_WHATSAPP`, `SITE_URL`). Text fixes 6.4. Gate G2 10.2. Risk 10.3 (sheet stays public). Stop condition 11.5 (real sheet, real people, posting to the group).

## the seller needs to do

Steps 1, 2, 4 (Script Properties and deploy), 5 and 7, plus approving the counts in step 3. Every step is walked through in 11.7 format.

## Out of scope

Clearing personal data after the sale (N-01, post-MVP, "needed before the move").
