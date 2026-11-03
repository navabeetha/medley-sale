# Status board

*Maintained by the PM and updated after every story. Last updated: 2026-11-03 (S-02 done).*

**Scope:** MVP only (brief Section 8), 43 points in 4 slices, worked in order.
**Now:** S-01 and S-02 Done. First push made 2026-11-03; CI and Pages deploy green, site live with placeholder page. **Next:** S-03 (sheet schema, migration and `scrubStaging()`), then G0.3: the seller checks the scrub by eye. Every remaining Slice 1 story depends on S-03.

## Gates

| Gate | Stage | What | Status |
|---|---|---|---|
| G0 | G0.1 | Public GitHub repo, Pages from Actions, commit identity | Done 2026-11-03: secret added, backup cleaned (0 blocked-word hits), first deploy green |
| G0 | G0.2 | Build copy, attached script, `clasp login` | Done 2026-11-03 |
| G0 | G0.3 | Scrub run and checked by eye | Not started |
| G1 | | Staging review on phone, end of Slice 3 | Not started |
| G2 | | Cutover (S-18) | Not started |

G0 is staged per [D-018](../decisions/D-018-g0-in-stages.md). Steps: [docs/runbook.md](../runbook.md).

## Waiting on the seller

1. **G0.3** (after S-03's scrub runs): check the build copy by eye.
2. Review the proposed decisions D-016 to D-023 when convenient. They stand as proposed meanwhile.

## Board

| Backlog | Ready | In progress | In QA | Done |
|---|---|---|---|---|
| S-04 to S-18 | none | S-03 | none | S-01, S-02 |

## Slices

| Slice | Stories | Pts | Done pts | Exit | Status |
|---|---|---|---|---|---|
| 1. See the sale | S-01 to S-08 | 20 | 7 | Catalogue live, and D-001 proven | In progress |
| 2. Reserve | S-09 to S-13 | 11 | 0 | Reserve through to the WhatsApp URL | Not started |
| 3. Back out and sell | S-14 to S-16 | 8 | 0 | Full loop on staging, then G1 | Not started |
| 4. Release | S-17, S-18 | 4 | 0 | Link ready for the group (G2) | Not started |
| **Total** | | **43** | **7** | | |

## Stories

| ID | Title | Pts | Slice | Depends on | Status | Gate |
|---|---|---|---|---|---|---|
| [S-01](stories/S-01-scaffold-ci-pages.md) | Scaffold, CI and Pages deploy | 2 | 1 | none | Done (QA signed off; deploy verified 2026-11-03) | G0.1 done |
| [S-02](stories/S-02-queue-engine.md) | Queue engine with quantity | 5 | 1 | S-01 | Done (QA signed off) | |
| [S-03](stories/S-03-sheet-schema-migration.md) | Sheet schema and migration | 3 | 1 | S-01 | In progress | G0.3 after scrub |
| [S-04](stories/S-04-catalogue-api.md) | Catalogue API | 2 | 1 | S-02, S-03 | Backlog | D-001 go or no-go |
| [S-05](stories/S-05-photo-pipeline.md) | Photo pipeline | 2 | 1 | S-03 | Backlog | Export after G0.3 |
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
