# Status board

*Maintained by the PM and updated after every story. Last updated: 2026-11-05 (S-03 Done and merged).*

**Scope:** MVP only (brief Section 8), 43 points in 4 slices, worked in order.
**Now:** S-01, S-02 and S-03 Done. S-03 merged to `main` 2026-11-05 after the live run on the build copy: scrub (after [D-027](../decisions/D-027-header-row-detection.md), header row found, not assumed), seller's by-eye check, migrate (after [D-028](../decisions/D-028-books-name-under-brand.md), Books name under `Brand (+ Link)`) and all five post-migrate checks passed. Agents may now read the scrubbed build copy.

**Resume here:** start S-04 (catalogue API) and S-05 (photo pipeline); they can run in parallel (different files). Carry forward from QA:
- **S-04:** export and reuse `itemNameCol` and `findHeaderRow`. Other live tabs may also head their brand column `Brand (+ Link)` (there it means the brand). Live Books has no `Link` column: the link is rich text on the name cell, so build a Books fixture shaped like the live tab. R1 (scrub WARNING is a log line only) should be fixed before S-04 relies on the copy.
- **S-05:** live Books heads the photo column `Photos`, not `Photo`; check every live tab's heading. Needs the seller's `.xlsx` export of the scrubbed copy into `private/` (runbook G0.3 step 4, D-019), asked for when S-05 starts.
- Open S4 follow-ups: D-028 error wording on Books; formula-guard test for the Brand fallback; F-A to F-D and R2 to R6 in the qa-log.

**Live headings (Books row 2):** Author, Brand (+ Link), Available from, Status, Price, Photos, (blank), (blank), Notes, Person.

## Gates

| Gate | Stage | What | Status |
|---|---|---|---|
| G0 | G0.1 | Public GitHub repo, Pages from Actions, commit identity | Done 2026-11-03: secret added, backup cleaned (0 blocked-word hits), first deploy green |
| G0 | G0.2 | Build copy, attached script, `clasp login` | Done 2026-11-03 |
| G0 | G0.3 | Scrub run and checked by eye | Done 2026-11-05: re-run after D-027 fix replaced 10 people, no WARNING; the seller confirmed by eye. Migrate and live checks passed |
| G1 | | Staging review on phone, end of Slice 3 | Not started |
| G2 | | Cutover (S-18) | Not started |

G0 is staged per [D-018](../decisions/D-018-g0-in-stages.md). Steps: [docs/runbook.md](../runbook.md).

## Waiting on the seller

1. Nothing blocking. Review the proposed decisions D-016 to D-023 and D-026 to D-028 when convenient. They stand as proposed meanwhile.
2. (When S-05 starts) export the scrubbed build copy as `.xlsx` into `private/`.

## Board

| Backlog | Ready | In progress | In QA | Done |
|---|---|---|---|---|
| S-06 to S-18 | none | S-04, S-05 | none | S-01, S-02, S-03 |

## Slices

| Slice | Stories | Pts | Done pts | Exit | Status |
|---|---|---|---|---|---|
| 1. See the sale | S-01 to S-08 | 20 | 10 | Catalogue live, and D-001 proven | In progress |
| 2. Reserve | S-09 to S-13 | 11 | 0 | Reserve through to the WhatsApp URL | Not started |
| 3. Back out and sell | S-14 to S-16 | 8 | 0 | Full loop on staging, then G1 | Not started |
| 4. Release | S-17, S-18 | 4 | 0 | Link ready for the group (G2) | Not started |
| **Total** | | **43** | **10** | | |

## Stories

| ID | Title | Pts | Slice | Depends on | Status | Gate |
|---|---|---|---|---|---|---|
| [S-01](stories/S-01-scaffold-ci-pages.md) | Scaffold, CI and Pages deploy | 2 | 1 | none | Done (QA signed off; deploy verified 2026-11-03) | G0.1 done |
| [S-02](stories/S-02-queue-engine.md) | Queue engine with quantity | 5 | 1 | S-01 | Done (QA signed off) | |
| [S-03](stories/S-03-sheet-schema-migration.md) | Sheet schema and migration | 3 | 1 | S-01 | Done (QA signed off; live checks passed 2026-11-05) | G0.3 done |
| [S-04](stories/S-04-catalogue-api.md) | Catalogue API | 2 | 1 | S-02, S-03 | In progress | D-001 go or no-go |
| [S-05](stories/S-05-photo-pipeline.md) | Photo pipeline | 2 | 1 | S-03 | In progress | Export after G0.3 |
| [S-06](stories/S-06-catalogue-screen.md) | Catalogue screen | 3 | 1 | S-04 | Backlog | |
| [S-07](stories/S-07-filter-search.md) | Filter and search | 1 | 1 | S-06 | Backlog | |
| [S-08](stories/S-08-item-view.md) | Item view | 2 | 1 | S-05, S-06 | Backlog | |
| [S-09](stories/S-09-basket.md) | Basket | 2 | 2 | S-06 | Backlog | |
| [S-10](stories/S-10-reservation-form.md) | Reservation form | 2 | 2 | S-09 | Backlog | |
| [S-11](stories/S-11-reserve-api.md) | Reserve API | 3 | 2 | S-02, S-03 | Backlog | |
| [S-12](stories/S-12-booking-page.md) | Booking page | 2 | 2 | S-10, S-11 | Backlog | |
| [S-13](stories/S-13-whatsapp-handoff.md) | WhatsApp handoff | 2 | 2 | S-12 | Backlog | |
| [S-14](stories/S-14-back-out.md) | Back out | 3 | 3 | S-02, S-12 | Backlog | |
| [S-15](stories/S-15-seller-sheet-workflow.md) | Seller sheet workflow | 3 | 3 | S-02, S-03 | Backlog | G1 confirm |
| [S-16](stories/S-16-seller-email-summary.md) | Seller email summary | 2 | 3 | S-11, S-14 | Backlog | |
| [S-17](stories/S-17-qa-privacy-pass.md) | QA and privacy pass | 2 | 4 | S-08, S-13, S-14, S-15 | Backlog | |
| [S-18](stories/S-18-cutover.md) | Cutover | 2 | 4 | S-16, S-17 | Backlog | G2 |

**Parallel work (brief 10.1):** after S-01 and S-02, one dev on API and sheet (S-03, S-04, S-11, S-15), one on UI, and one on photos (S-05). Only one agent changes `src/domain/` or the sheet schema at a time.

## Post-MVP (brief Section 9): not started, only if the seller asks

N-01 Clear personal data and show "Sale closed" (needed before the move) · N-02 Seller phone screen · N-03 Flag slow holds · N-04 "Ask about this item" link · N-05 Instant first load via a snapshot · N-06 Price sort and filter · N-07 Link preview image · N-08 Manual waitlist reorder · N-09 Clearer same-moment booking · N-10 Better seller alert · N-11 Two-way sync experiment.

## Risks

See the brief's Section 10.3 for the risk table. Changes to risks are noted here as they happen. Current: none changed. Watch item: S-04's go or no-go for D-001 (CORS and speed from Pages).

## Decisions

Accepted: D-001 to D-015 (brief Section 5). Proposed: D-016 to D-023 ([docs/decisions/](../decisions/README.md)).
