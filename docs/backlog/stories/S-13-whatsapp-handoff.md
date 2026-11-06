# S-13: WhatsApp handoff

| | |
|---|---|
| **Points** | 2 |
| **Slice** | 2: Reserve |
| **Depends on** | S-12 |
| **Status** | Backlog |
| **Pod type** | feature |
| **Gate** | Slice 2 demo follows (exit: reserve through to the WhatsApp URL). The `wa.me` format is checked at G1 |
| **Branch** | `S-13-whatsapp-handoff` |

## Acceptance criteria (brief Section 8, verbatim)

- Message matches Section 2.8, correctly encoded for emoji, ₹ and line breaks.
- The browser goes to WhatsApp once, after saving. The button is always present, and returning doesn't reopen WhatsApp by itself.
- Records `WhatsApp opened` where possible.
- A 15-unit booking with long titles stays under the URL limit and keeps the private link.
- Tests assert the URL. No agent sends a real message.

## Seller notes (added after R1)

- **2026-11-06, from the R1 phone check:** the reserve message must say *which* item, not just its name. "Air purifier" alone was ambiguous because there are several. Include the **brand** after the name when the item has one (e.g. "Air purifier (Philips)"), keeping Books as book name then author (4.1). Apply the same rule to R1's per-card "Message to reserve" text ("Hi! I'd like to reserve: <name>") when this message work happens, so the two never disagree.

- **From S-11 QA (PM, 2026-11-06):** the WhatsApp URL is now built on the server (`src/domain/message.ts`, used by `src/api/reserve.ts`), so the 2,000-character limit and "…and N more" (6.3) must be enforced there, not in the site. 15 units with long titles currently gives about 2,300 characters. Also confirm whether waiting lines should show a price (2.8 doesn't).

## Bugfix tickets carried from the S-12/S-14 API QA (PM, 2026-11-06); do these first

- **Q1 (S3):** a blanked or typo'd State cell overwrites the seller's own note, and her text is lost. Write our note only where the cell has no note or already has one of ours, on both the edit and the timed paths.
- **Q2 (S4):** an accepted State change that leads to no write of ours doesn't clear the catalogue cache, so waitingCount can stay stale for minutes. Clear the cache on any accepted State change.
- **Q4 (S4):** pin `markWrote()` before the State write in backOut (mutant M5); export the refusal-reason wording from `queue.ts` and use it in `isOurStateNote` instead of copied regexes (M23); pin that malformed backOut requests answer without taking the lock.
- **Q3 accepted (PM):** a refusal note stays until the seller's next successful edit of that cell. It's harmless; no change.

## References

- Message 2.8 (no seller name. Book name first, then author, 4.1). URL limit 6.3 (under 2,000 characters, "…and N more"). API `waOpened` 4.3.
- D-008 (save first, then same-tab navigation, with a **Send on WhatsApp** button always shown), D-011. Hard rule 11.6.3. Research note 12 (expected `wa.me` format, not confirmed from a primary source).
- Message building lives in `src/domain/`.
- Critical scenarios: **T-13**, and the message half of **T-09** and **T-10**.

## the seller needs to do

Nothing now. At G1 she checks the jump to WhatsApp on her own phone.

## Out of scope

Automatic sending (not planned) and "Ask about this item" (N-04).
