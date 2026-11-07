# S-17: QA and privacy pass

| | |
|---|---|
| **Points** | 2 |
| **Slice** | 4: Release |
| **Depends on** | S-08, S-13, S-14, S-15 |
| **Status** | Backlog |
| **Pod type** | enabling, **QA-led** ([D-021](../../decisions/D-021-story-types-and-ready.md)). Bugs found become `bugfix` tickets |
| **Gate** | Any S1 found is a stop condition (11.5). Must pass before G2 |
| **Branch** | `S-17-qa-privacy-pass` |

## Acceptance criteria (brief Section 8, verbatim)

- All scenarios in Section 8.1 pass, with budgets met.
- axe shows no serious issues on all screens.
- QA tries token guessing, script and formula injection in name, and reading other bookings.
- Repo and its full history contain no real names, numbers, tokens or the sheet export.

## References

- Critical scenarios **T-01 to T-18** (T-18 live on staging). Budgets and bug severity 8.1. Hard rules 11.6. Risk 10.3 (personal data committed). Results go in `docs/qa/`.

## the seller needs to do

Nothing, unless an S1 is found (then the PM explains it to her and asks how to proceed).

## Out of scope

A real-device test matrix (not planned).


## Carried S4 notes (PM, 2026-11-06)

From the S-12/S-14 UI QA:
- Cancel stays active while a back-out is pending. Disable it.
- Focus drops to the page body during and after a back-out. Move focus to the unit's status.
- In browse-only (R1) mode, `#/b/<token>` shows a try-again error that can never succeed. Show the catalogue or a plain "reserving isn't open" message instead.
- At 320 px the `.wa` button text touches the button edges. Add side padding.
- Test gaps:
  - Nothing tests `noreferrer` on the wa.me links, or `preventScroll`.
  - The `backOutReply` mock answers `whatsappUrl: null`, but the real API returns the updated URL.

From the S-13 QA:
- Two refusal suffixes with different wording stay on a State note until the next accepted edit. Strip them in a loop.

From G1 (the seller, 2026-11-07):
- A booking that no longer exists stays in My reservations (`medley-sale:bookings:v1`) forever, and the buyer can't remove it. When the booking API answers `not-found` for a saved token, drop that token from the list. Never drop it on a network error or `busy`. Test first.

From the G1-fixes and S-19 QA (2026-11-07), to fix before go-live, test first:
- **S3 F1:** the combined "Send the details" URL goes over 2,000 characters at about 14 or more active bookings, because link lines are never dropped. Fix: after the bullets, also drop link lines from the oldest booking and add "…and N more reservations". Pin it with 15 and 20 tokens.
- **S3 F2:** on `#/mine`, a failed refresh after a successful back-out shows the load error. Fix: keep the redrawn units from the back-out reply and show a soft "couldn't refresh" note.
- **S3 F3:** `#/mine` and `#/b/` route only after the catalogue draws, so a failed catalogue hides them. Fix: route them independently of the catalogue.
- **S4 F4:** in R1/status mode, saved tokens leave the header link showing and `#/mine` stuck on a retry. Treat `not-reserving` as a plain "reserving isn't open" message and hide the link.
- **S4 F5:** the two Back out buttons on a 2-unit line look identical. Show "(1 of 2)" visibly.
- **Test hygiene:** the mine-layout FULL fixture repeats claim ids 11 and 12. Give it distinct ids, then key the confirmation by claim id alone and drop the `startRender` draw count.
- **Uncaught mutants:** `onChanged()` after a back-out on `#/mine`, and the `if (backing) return` guard.
