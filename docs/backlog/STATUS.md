# Status board

*Maintained by the PM and updated after every story. Last updated: 2026-11-05 (S-05 Done, photos published; S-04 waits on the web-app URL).*

**Scope:** MVP only (brief Section 8), 43 points in 4 slices, worked in order.
**Now:** S-01, S-02, S-03 and S-05 Done. S-04 (catalogue API, [D-030](../decisions/D-030-catalogue-shape.md)) and S-05 (photo pipeline, [D-029](../decisions/D-029-photo-pipeline-edge-cases.md), [D-031](../decisions/D-031-photo-pipeline-hardening.md)) passed QA (several fix rounds, see the qa-log) and are merged to `main` 2026-11-05. **S-04 isn't Done until its live checks pass.** The S-04 script is pushed to the build copy (2026-11-05 17:49).

**Release R1, browse-only, target evening of 2026-11-06 ([D-034](../decisions/D-034-browse-only-first-release.md), [D-035](../decisions/D-035-browse-only-on-real-sheet.md)).** The seller chose: Slice 1 only (S-06, S-07, S-08), "Message to reserve" by WhatsApp, the catalogue kept warm every 5 minutes, reading her **real sheet** (ID and Quantity columns only, status mode without Claims). She'll decide afterwards whether to wait for online reserving before posting widely.
- **Building in parallel:** S-06 catalogue screen (branch `S-06-catalogue-screen`); R1 backend (branch `R1-browse-release-api`) with status mode, `contactUrl`, `addIdColumns` and `warmCatalogue`.
- **Seller's steps tomorrow** (about 15 minutes, 11.7 format):
  - back up the real sheet;
  - give the script ID;
  - run `addIdColumns`;
  - set `SELLER_WHATSAPP`;
  - add the 5-minute trigger;
  - deploy the web app;
  - hand-fix the text typos if she wants.
- **PM checks before sharing:**
  - IDs match the build copy, so the photos land on the right items;
  - the T-12 scan on the live response;
  - CORS from Pages;
  - timings.

**Resume here:**
- **S-04:**
  - Waiting for the seller to deploy the web app (Deploy > New deployment > Web app, Execute as Me, access Anyone) and paste the `/exec` URL.
  - Then the PM runs the live checks in the S-04 QA entries: CORS from the Pages origin (the D-001 go or no-go), cold and warm timings recorded per D-020, dates exactly `2026-12-02`, cache, links.
  - The seller reads the JSON once by eye for real names in Notes (QA F2).
- **S-05: Done 2026-11-05.** Real export run: 31 photos for 25 items published to `public/photos/`. Two close-ups were shrunk per [D-032](../decisions/D-032-photo-size-fallback.md), and the seller approved the contact sheet. To refresh photos: the seller re-exports into `private/build-copy.xlsx`, then `npm run photos private/build-copy.xlsx`, then commit and push.
- **Open S4 follow-ups:** D-028 error wording; 16-bit greyscale; broken rels traceback; Python 3.9 end of life; CLI cwd-relative paths (accepted); migrate's per-row `getGrid` slowness; `doGet` cache/ContentService outside the try; silent `unavailable` errors; F-A to F-D and R2 to R6.
- **Carry to S-06/S-08:** treat a non-JSON or `{"error"}` response as "API down"; the photo count comes from `public/photos/manifest.json` (D-030 rule 3); lazy loading. **S-11, S-14 and S-15** must clear `CATALOGUE_CACHE_KEY`.

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

## Board

| Backlog | Ready | In progress | In QA | Done |
|---|---|---|---|---|
| S-06 to S-18 | none | none | S-04 (merged; live checks pending) | S-01, S-02, S-03, S-05 |

## Slices

| Slice | Stories | Pts | Done pts | Exit | Status |
|---|---|---|---|---|---|
| 1. See the sale | S-01 to S-08 | 20 | 12 | Catalogue live, and D-001 proven | In progress |
| 2. Reserve | S-09 to S-13 | 11 | 0 | Reserve through to the WhatsApp URL | Not started |
| 3. Back out and sell | S-14 to S-16 | 8 | 0 | Full loop on staging, then G1 | Not started |
| 4. Release | S-17, S-18 | 4 | 0 | Link ready for the group (G2) | Not started |
| **Total** | | **43** | **12** | | |

## Stories

| ID | Title | Pts | Slice | Depends on | Status | Gate |
|---|---|---|---|---|---|---|
| [S-01](stories/S-01-scaffold-ci-pages.md) | Scaffold, CI and Pages deploy | 2 | 1 | none | Done (QA signed off; deploy verified 2026-11-03) | G0.1 done |
| [S-02](stories/S-02-queue-engine.md) | Queue engine with quantity | 5 | 1 | S-01 | Done (QA signed off) | |
| [S-03](stories/S-03-sheet-schema-migration.md) | Sheet schema and migration | 3 | 1 | S-01 | Done (QA signed off; live checks passed 2026-11-05) | G0.3 done |
| [S-04](stories/S-04-catalogue-api.md) | Catalogue API | 2 | 1 | S-02, S-03 | In QA: merged, live checks pending | D-001 go or no-go |
| [S-05](stories/S-05-photo-pipeline.md) | Photo pipeline | 2 | 1 | S-03 | Done (live run and seller review passed 2026-11-05) | Export done |
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
