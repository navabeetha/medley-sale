# Status board

*Maintained by the PM and updated after every story. Last updated: 2026-11-06 late afternoon (S-09, S-11, S-15 Done and merged; S-10 and S-12/14-API red steps running; paused for usage until 7pm).*

**Scope:** MVP only (brief Section 8), 43 points in 4 slices, worked in order.
**Now:** **Release R1 is live (2026-11-06)**: https://navabeetha.github.io/medley-sale/ reads the seller's real sheet through the "R1 catalogue" web app (browse-only, [D-034](../decisions/D-034-browse-only-first-release.md) to [D-036](../decisions/D-036-r1-qa-hardening.md)). S-01 to S-06 Done. Nothing has been posted to the group yet; when to share is the seller's call.

**R1 release record (2026-11-06):**
- **Seller setup, all done:** backup copy (kept in her Drive); the real sheet's script ID in a separate gitignored clasp config (`.clasp.real.json`; push with `npx clasp -P .clasp.real.json push -f`); `addIdColumns` gave 8 columns, 65 IDs, 65 quantities; `SELLER_WHATSAPP` set; `warmCatalogue` every 5 minutes; web app deployed (Execute as Me, Anyone); Notes and links read by her.
- **PM checks, all passed:** 62 live items match staging by ID, name, tab and photos (the 3 extra IDs are rows the catalogue hides, as on staging); T-12 clean apart from 4 Amazon tracking-query links (no neighbour data; led to D-037); `contactUrl` is `wa.me/91` + 10 digits; CORS `*` on both hops; 1.4 to 2.1 s warm. Gate 743 unit, 352 e2e, 3.4 KB, pii clean. Pages deploy green; a WebKit iPhone run on the live page showed 62 reserve links in 2.6 s, 0.3 s on a second visit, prefill correct.
- **Seller phone check, passed.** Two notes: (1) the reserve message should include the **brand** ("Air purifier" alone was ambiguous); recorded on [S-13](stories/S-13-whatsapp-handoff.md) for the message work. (2) Strip link tracking: [D-037](../decisions/D-037-strip-link-tracking.md), QA signed off (F1 fixed on re-check), merged and live 2026-11-06. The "R1 catalogue" deployment is now version 2 at the same URL. The live response has no tracker parameters and no Amazon queries (only a functional `region_id` remains), and 4 shortened links return 200.

**Resume here:**
1. **Seller's order (2026-11-06):** (a) complete the customer journey (reserving), (b) an easier way to add new items and make their cards (new scope, not in the brief; scope it with her after the MVP), (c) search and filter, which she'd take earlier if it's quick. **PM plan:** S-07 first (1 pt, red tests parked on `S-07-filter-search`, ships on R1 with no seller steps), then S-08 (needed before S-17), then Slices 2 to 4 (S-09 to S-18). Reserving goes live only at G2 together with back-out and the sell workflow, because it replaces comment-claiming on the real sheet. Fold the brand-in-message note into S-13. **Seller chose the fast path ([D-038](../decisions/D-038-fast-path-to-reserving.md)):** S-07, S-08 and S-16 postponed; wave 1 is S-11 (API track) and S-09 (UI track) in parallel.
   - **Progress (2026-11-06 evening):** S-09 basket Done (QA sign-off, plus a follow-up bugfix round signed off). S-11 reserve API Done (QA found an S1, a partial write replayed as success, before anything shipped; fixed in a bugfix round and re-checked). Both merged to `main`, local, **not pushed** (push at the next milestone; the basket shows only when the catalogue says `reserving: true`). Gate on main: 1039 unit, 524 e2e, 5.4 KB, pii clean.
   - **S-15 Done** (QA NOT YET → bugfix round → sign-off; F7–F10 carried to S-14). Merged to `main` (unpushed). D-039 records the accepted missed-promotion gap.
   - **Paused mid-wave (usage), resume here:** UI worktree branch `S-10-reservation-form`: red step (test-author) was running; check whether it committed (`git log` there), verify (vitest, pii, Playwright counts), then implementer → QA. API worktree branch `S-12-14-api`: red step for F7–F10 + booking API + backOut API was running; same procedure. Then the UI story for the S-12/S-14 screens, then S-13, then G1 prep (seller sets staging `SITE_URL`; push bundle; new staging deployment; live checks incl. the S-15 G1 checklist in the qa-log), S-17, S-18. Sibling worktrees: `../a44GarageSale-api` and `../a44GarageSale-ui` (node_modules symlinked; `node_modules` is in `.git/info/exclude`; only one checkout may run Playwright at a time, because port 4173 is fixed and reused).
   - **Before G1 (staging live checks):** push the S-11+ bundle to the build copy and deploy a new staging web-app version with doPost; set `SITE_URL` in staging Script Properties (seller step, absolute https); T-18 (10 parallel reserves), OAuth scope with LockService, `appendRows` placement, apostrophe read-back, text/plain POST CORS.
2. **Carry-over follow-ups:** D-037 S4 notes (a trailing-dot Amazon host or a percent-encoded tracker name keeps its query); `pii-scan`'s tracked-clasp path rule still matches only `.clasp.json` (the gitignore now covers `.clasp*.json`); D-028 error wording; 16-bit greyscale; broken rels traceback; Python 3.9 end of life; migrate's per-row `getGrid` slowness; `doGet` cache/ContentService outside the try; silent `unavailable` errors; F-A to F-D and R2 to R6.

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
| S-07, S-08, S-12 to S-14, S-16 to S-18 | none | S-10, S-15 | none | S-01 to S-06, S-09, S-11 |

## Slices

| Slice | Stories | Pts | Done pts | Exit | Status |
|---|---|---|---|---|---|
| 1. See the sale | S-01 to S-08 | 20 | 17 | Catalogue live, and D-001 proven | In progress (R1 live; S-07, S-08 left) |
| 2. Reserve | S-09 to S-13 | 11 | 5 | Reserve through to the WhatsApp URL | Not started |
| 3. Back out and sell | S-14 to S-16 | 8 | 3 | Full loop on staging, then G1 | Not started |
| 4. Release | S-17, S-18 | 4 | 0 | Link ready for the group (G2) | Not started |
| **Total** | | **43** | **25** | | |

## Stories

| ID | Title | Pts | Slice | Depends on | Status | Gate |
|---|---|---|---|---|---|---|
| [S-01](stories/S-01-scaffold-ci-pages.md) | Scaffold, CI and Pages deploy | 2 | 1 | none | Done (QA signed off; deploy verified 2026-11-03) | G0.1 done |
| [S-02](stories/S-02-queue-engine.md) | Queue engine with quantity | 5 | 1 | S-01 | Done (QA signed off) | |
| [S-03](stories/S-03-sheet-schema-migration.md) | Sheet schema and migration | 3 | 1 | S-01 | Done (QA signed off; live checks passed 2026-11-05) | G0.3 done |
| [S-04](stories/S-04-catalogue-api.md) | Catalogue API | 2 | 1 | S-02, S-03 | Done (live checks passed on the real sheet 2026-11-06) | D-001 go |
| [S-05](stories/S-05-photo-pipeline.md) | Photo pipeline | 2 | 1 | S-03 | Done (live run and seller review passed 2026-11-05) | Export done |
| [S-06](stories/S-06-catalogue-screen.md) | Catalogue screen | 3 | 1 | S-04 | Done (seller phone check passed 2026-11-06) | |
| [S-07](stories/S-07-filter-search.md) | Filter and search | 1 | next | S-06 | Backlog (postponed, D-038) | |
| [S-08](stories/S-08-item-view.md) | Item view | 2 | next | S-05, S-06 | Backlog (postponed, D-038) | |
| [S-09](stories/S-09-basket.md) | Basket | 2 | 2 | S-06 | Done (QA signed off 2026-11-06, follow-ups too) | |
| [S-10](stories/S-10-reservation-form.md) | Reservation form | 2 | 2 | S-09 | In progress | |
| [S-11](stories/S-11-reserve-api.md) | Reserve API | 3 | 2 | S-02, S-03 | Done (QA signed off after bugfix round 2026-11-06; T-18 live check pending) | |
| [S-12](stories/S-12-booking-page.md) | Booking page | 2 | 2 | S-10, S-11 | Backlog | |
| [S-13](stories/S-13-whatsapp-handoff.md) | WhatsApp handoff | 2 | 2 | S-12 | Backlog | |
| [S-14](stories/S-14-back-out.md) | Back out | 3 | 3 | S-02, S-12 | Backlog | |
| [S-15](stories/S-15-seller-sheet-workflow.md) | Seller sheet workflow | 3 | 3 | S-02, S-03 | Done (QA signed off after bugfix round 2026-11-06; G1 live checks pending) | G1 confirm |
| [S-16](stories/S-16-seller-email-summary.md) | Seller email summary | 2 | 3 | S-11, S-14 | Backlog (postponed, D-038) | |
| [S-17](stories/S-17-qa-privacy-pass.md) | QA and privacy pass | 2 | 4 | S-08, S-13, S-14, S-15 | Backlog | |
| [S-18](stories/S-18-cutover.md) | Cutover | 2 | 4 | S-16, S-17 | Backlog | G2 |

**Parallel work (brief 10.1):** after S-01 and S-02, one dev on API and sheet (S-03, S-04, S-11, S-15), one on UI, and one on photos (S-05). Only one agent changes `src/domain/` or the sheet schema at a time.

## Post-MVP (brief Section 9): not started, only if the seller asks

N-01 Clear personal data and show "Sale closed" (needed before the move) · N-02 Seller phone screen · N-03 Flag slow holds · N-04 "Ask about this item" link · N-05 Instant first load via a snapshot · N-06 Price sort and filter · N-07 Link preview image · N-08 Manual waitlist reorder · N-09 Clearer same-moment booking · N-10 Better seller alert · N-11 Two-way sync experiment.

## Risks

See the brief's Section 10.3 for the risk table. Changes to risks are noted here as they happen. Current: none changed. Watch item: S-04's go or no-go for D-001 (CORS and speed from Pages).

## Decisions

Accepted: D-001 to D-015 (brief Section 5). Proposed: D-016 to D-023 ([docs/decisions/](../decisions/README.md)).
