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
| [D-023](D-023-commit-email-privacy.md) | Commits use a GitHub no-reply email | Proposed, **needs the seller at G0** |

**Next free ID: D-027.** Update this line and the index whenever you add a decision.
