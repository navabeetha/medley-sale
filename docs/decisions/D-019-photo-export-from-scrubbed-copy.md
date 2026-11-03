# D-019: The photo export comes from the scrubbed build copy, not the real sheet

- **Status:** Proposed
- **Date:** 2026-11-03
- **Raised by:** PM, docs setup
- **Context:** The S-05 photo tool reads an `.xlsx` export placed in `private/` (7.1, 11.6.4). The brief doesn't say which sheet it's exported from. An export of the real sheet holds neighbours' names and the seller's number, and agents must not read real buyer data before G2.
- **Decision:** Before G2, the seller exports the **build copy, after the G0.3 scrub check**, into `private/`. At cutover, a fresh export (of the real sheet or the build copy) is only needed if she has added photos since. That export is still used only for photos, and stays in `private/`.
- **Why:** This is the smaller option that keeps hard rule 11.6.4 intact.
- **Consequences / revisit if:** Photos added to the real sheet after the build copy was made won't appear until a later export. Brief 7.1 already expects reruns ("Rerunning the tool and pushing publishes them").
