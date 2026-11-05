# Decisions

**Accepted decisions D-001 to D-015 live in [BUILD_BRIEF.md](../../BUILD_BRIEF.md), Section 5.** They are not copied here. Only the seller can change an accepted decision.

New decisions are recorded here, one file each: `D-016-<slug>.md`, `D-017-<slug>.md`, and so on.

## Format

```markdown
# D-0NN: <title>
- **Status:** Proposed | Accepted (by the seller, <date>) | Superseded by D-0NN
- **Date:** YYYY-MM-DD
- **Raised by:** PM | Dev | QA, in <story>
- **Context:** what was ambiguous or needed deciding
- **Options:** what was considered
- **Decision:** what we're doing
- **Why:** reasoning (the brief says to take the smaller option when it's ambiguous)
- **Consequences / revisit if:** …
```

**Proposed** means an agent took the smaller option so work could continue (brief 1.1, 11.5). It stands until the seller accepts or changes it. **Accepted** means the seller has agreed.

## Index

| ID | Title | Status |
|---|---|---|
| [D-016](D-016-repo-name-medley-sale.md) | GitHub repo name is `medley-sale`. Git is set up at G0 | Proposed |
| [D-017](D-017-decision-numbering.md) | New decision IDs start at D-016. Section 5 ordering is cosmetic | Proposed |
| [D-018](D-018-g0-in-stages.md) | Gate G0 is done in three stages | Proposed |
| [D-019](D-019-photo-export-from-scrubbed-copy.md) | The photo export comes from the scrubbed build copy, not the real sheet | Proposed |
| [D-020](D-020-measurements-recorded-here.md) | S-04 timings and other measurements are recorded as new decision files | Proposed |
| [D-021](D-021-story-types-and-ready.md) | Pod types for S-17 and S-18, and applying Ready strictly | Proposed |
| [D-022](D-022-size-budget-gzip.md) | The 50 KB budget is measured with gzip | Proposed |
| [D-023](D-023-commit-email-privacy.md) | Commits use a GitHub no-reply email | Accepted by default; the seller may override |
| [D-024](D-024-owner-name-out-of-public-repo.md) | Owner's name kept out of the public repo | Accepted (the seller) |
| [D-025](D-025-push-barrier-scope.md) | Push barrier: one narrow fix, leftovers to S-17 | Accepted (the seller) |
| [D-026](D-026-queue-promotion-rules.md) | Queue promotion rule, role source, unavailable items | Proposed |
| [D-027](D-027-header-row-detection.md) | Item tabs' header row is found (first of the top 5 with `Person`), not assumed to be row 1 | Proposed |
| [D-028](D-028-books-name-under-brand.md) | On Books, the book name is the `Brand` column when there is no `Item` column | Proposed |
| [D-029](D-029-photo-pipeline-edge-cases.md) | Photo pipeline edge cases: no upscaling, stale files removed, duplicate IDs stop the run | Proposed |
| [D-030](D-030-catalogue-shape.md) | Catalogue response fields, freeUnits, calendar dates, JSON errors, tab allow-list, http(s) links only | Proposed |
| [D-031](D-031-photo-pipeline-hardening.md) | Photo pipeline hardening: raw media, reported skips, empty-export guard, hard budgets | Proposed |
| [D-032](D-032-photo-size-fallback.md) | A photo that won't fit at 1000 px shrinks in 10% steps (down to 600 px), not refused | Proposed |
| [D-033](D-033-catalogue-timings.md) | Catalogue live timings: hits ~1.7 s, cache misses ~12 s (over 3 s, raised); CORS works (D-001 GO) | Measured |
| [D-034](D-034-browse-only-first-release.md) | Browse-only first release (Slice 1), warm catalogue every 5 min, WhatsApp link from Script Properties | Accepted (the seller) |

**Next free ID: D-035.** Update this line and the index whenever you add a decision.
